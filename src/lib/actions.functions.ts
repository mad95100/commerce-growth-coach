import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  PROPOSAL_TTL_MINUTES,
  isProposalExpired,
  type ActionChannel,
  type ProposeOutcome,
} from "@/lib/action-plan";
// Import de type uniquement : effacé à la compilation, donc aucun code serveur
// n'atterrit dans le bundle client.
import type { Db } from "@/lib/actions.server";

const FINDING_INPUT = z.object({ findingId: z.string().uuid() });
const ACTION_INPUT = z.object({ actionId: z.string().uuid() });

type StoreInfo = { name: string; niche: string | null; url: string | null };

type FindingInfo = {
  id: string;
  category: string;
  severity: string;
  title: string;
  root_cause: string | null;
  impact_description: string | null;
  estimated_gain_min: number | null;
  estimated_gain_max: number | null;
};

/** Canaux actifs de la boutique, sous la forme attendue par le moteur d'application. */
async function loadChannels(supabase: Db, storeId: string) {
  const { data: conns } = await supabase
    .from("data_connections")
    .select("provider, account_id, access_token_ciphertext, refresh_token_ciphertext, status")
    .eq("store_id", storeId)
    .eq("status", "active");

  const active = (conns ?? []) as Array<{
    provider: string;
    account_id: string | null;
    access_token_ciphertext: string | null;
    refresh_token_ciphertext: string | null;
  }>;
  const shopify = active.find((c) => c.provider === "shopify");
  const meta = active.find((c) => c.provider === "meta_ads");
  const google = active.find((c) => c.provider === "google_ads");

  if (!shopify && !meta && !google) {
    throw new Error(
      "Connecte d'abord Shopify, Meta Ads ou Google Ads pour que je puisse appliquer les corrections directement.",
    );
  }

  return {
    ...(shopify?.account_id && shopify.access_token_ciphertext
      ? { shopify: { shop: shopify.account_id, encryptedToken: shopify.access_token_ciphertext } }
      : {}),
    ...(meta?.account_id && meta.access_token_ciphertext
      ? { meta: { accountId: meta.account_id, encryptedToken: meta.access_token_ciphertext } }
      : {}),
    ...(google?.account_id && google.refresh_token_ciphertext
      ? {
          google: {
            customerId: google.account_id,
            encryptedRefreshToken: google.refresh_token_ciphertext,
          },
        }
      : {}),
  };
}

/** Charge le problème, sa boutique et vérifie l'appartenance (via RLS). */
async function loadFindingContext(
  supabase: Db,
  findingId: string,
): Promise<{ finding: FindingInfo; store: StoreInfo; storeId: string }> {
  const { data: finding, error } = await supabase
    .from("audit_findings")
    .select("*, audits(store_id, stores(name, url, niche))")
    .eq("id", findingId)
    .single();
  if (error || !finding) throw new Error("Problème introuvable");

  const rel = finding.audits as { store_id: string; stores: StoreInfo };
  return {
    finding: {
      id: finding.id,
      category: finding.category,
      severity: finding.severity,
      title: finding.title,
      root_cause: finding.root_cause,
      impact_description: finding.impact_description,
      estimated_gain_min: finding.estimated_gain_min,
      estimated_gain_max: finding.estimated_gain_max,
    },
    store: rel.stores,
    storeId: rel.store_id,
  };
}

/**
 * Prépare une correction SANS rien écrire chez Shopify / Meta / Google.
 *
 * Chemin : IA → validation → baseline → ligne `actions` en `proposed` → aperçu.
 * Aucun appel d'écriture externe ne se trouve sur ce chemin.
 */
export const proposeFix = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => FINDING_INPUT.parse(input))
  .handler(async ({ data, context }): Promise<ProposeOutcome> => {
    const { supabase } = context;

    const { finding, store, storeId } = await loadFindingContext(supabase, data.findingId);
    const channels = await loadChannels(supabase, storeId);

    const { planFixAcrossChannels } = await import("@/lib/apply-fix.server");
    const plan = await planFixAcrossChannels({ store, finding, ...channels });

    if (plan.kind === "no_action") {
      return { kind: "no_action", reason: plan.reason };
    }

    // Photo « avant » prise pendant la proposition, donc réellement avant l'écriture.
    // Elle n'est versée dans `fix_outcomes` qu'à la confirmation, pour ne pas polluer
    // le suivi avec des propositions jamais confirmées.
    const { captureStoreMetrics } = await import("@/lib/metrics.server");
    const baseline = await captureStoreMetrics(channels).catch(() => null);

    const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MINUTES * 60_000).toISOString();
    const d = plan.description;

    const { insertProposal } = await import("@/lib/actions.server");
    const row = await insertProposal(supabase as never, {
      storeId,
      findingId: finding.id,
      channel: d.channel,
      toolName: plan.tool,
      title: d.title,
      reason: plan.reason,
      targetRef: d.targetRef,
      targetLabel: d.targetLabel,
      beforeValue: d.beforeValue,
      afterValue: d.afterValue,
      revertible: plan.revertible,
      payload: {
        raw_args: plan.rawArgs,
        lines: d.lines,
        baseline,
        expected_gain_min: finding.estimated_gain_min,
        expected_gain_max: finding.estimated_gain_max,
        expires_at: expiresAt,
      },
    });

    return {
      kind: "proposal",
      proposal: {
        actionId: row.id,
        tool: plan.tool,
        channel: d.channel,
        title: d.title,
        targetLabel: d.targetLabel,
        reason: plan.reason,
        revertible: plan.revertible,
        lines: d.lines,
        expiresAt,
      },
    };
  });

/**
 * Applique une correction précédemment proposée, après confirmation explicite.
 *
 * Tout est rejoué : arguments re-validés contre les garde-fous, cible re-résolue
 * dans un état fraîchement collecté, et refus si l'état amont a bougé depuis
 * l'aperçu montré à l'utilisateur.
 */
export const confirmAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ACTION_INPUT.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { loadProposal, claimProposal, markFailed, finalizeApplied } =
      await import("@/lib/actions.server");

    const proposal = await loadProposal(supabase as never, data.actionId);
    if (!proposal) throw new Error("Cette proposition est introuvable.");
    if (proposal.status !== "proposed") {
      throw new Error(
        proposal.status === "applied"
          ? "Cette correction a déjà été appliquée."
          : "Cette proposition n'est plus applicable. Relance la correction.",
      );
    }
    if (!proposal.finding_id)
      throw new Error("Proposition incomplète : problème d'origine inconnu.");
    if (proposal.payload?.expires_at && isProposalExpired(proposal.payload.expires_at)) {
      throw new Error(
        `Cette proposition a plus de ${PROPOSAL_TTL_MINUTES} minutes : l'état de ton compte a pu changer. Relance la correction.`,
      );
    }

    const { finding, store, storeId } = await loadFindingContext(supabase, proposal.finding_id);
    const channels = await loadChannels(supabase, storeId);

    // Verrou d'idempotence : une seule confirmation peut réserver la proposition.
    const claimed = await claimProposal(supabase as never, data.actionId);
    if (!claimed)
      throw new Error("Cette correction vient d'être appliquée. Rien n'a été fait deux fois.");

    const { executePlannedAction } = await import("@/lib/apply-fix.server");

    let result;
    try {
      result = await executePlannedAction(
        { store, finding, ...channels },
        {
          tool: proposal.tool_name as never,
          rawArgs: proposal.payload?.raw_args,
          expectedBefore: proposal.before_value,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markFailed(supabase as never, data.actionId, message);
      throw err;
    }

    await finalizeApplied(supabase as never, data.actionId, {
      ...(proposal.after_value ?? {}),
      applied_detail: result.detail ?? null,
      admin_url: result.adminUrl ?? null,
    });

    // Double écriture temporaire : l'UI existante lit encore audit_findings.
    await supabase
      .from("audit_findings")
      .update({ applied_at: new Date().toISOString(), applied_result: result, status: "done" })
      .eq("id", finding.id);

    const { recordFixBaseline } = await import("@/lib/tracking.server");
    await recordFixBaseline(supabase as never, {
      findingId: finding.id,
      storeId,
      expectedGainMin: proposal.payload?.expected_gain_min ?? finding.estimated_gain_min ?? null,
      expectedGainMax: proposal.payload?.expected_gain_max ?? finding.estimated_gain_max ?? null,
      creds: channels,
      baseline: (proposal.payload?.baseline as never) ?? null,
    });

    return result;
  });

/** Actions déjà appliquées pour un problème donné (pour l'affichage du rapport). */
export const listFindingActions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => FINDING_INPUT.parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("actions")
      .select("id, tool_name, title, target_label, channel, status, applied_at, revertible")
      .eq("finding_id", data.findingId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (rows ?? []) as Array<{
      id: string;
      tool_name: string;
      title: string;
      target_label: string | null;
      channel: ActionChannel;
      status: string;
      applied_at: string | null;
      revertible: boolean;
    }>;
  });
