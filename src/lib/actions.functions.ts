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
  // La boutique est lue avec le client de l'appelant : RLS ne renvoie rien
  // s'il ne la possède pas, et aucun jeton n'est alors chargé.
  const { data: owned } = await supabase
    .from("stores")
    .select("id")
    .eq("id", storeId)
    .maybeSingle();
  if (!owned) return {};

  // Les colonnes de jetons ne sont plus lisibles par `authenticated` : elles ne
  // doivent jamais être servies à un navigateur. Lecture par le rôle de service.
  const { supabaseAdmin: secrets } = await import("@/integrations/supabase/client.server");
  const { data: conns } = await secrets
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
    const { supabase, userId } = context;

    const { finding, store, storeId } = await loadFindingContext(supabase, data.findingId);
    const channels = await loadChannels(supabase, storeId);

    // Décompté avant l'appel au modèle, qui est la partie payante.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { consumeQuota, refundQuota } = await import("@/lib/billing.server");
    await consumeQuota(supabaseAdmin, userId, "fixes");

    const { planFixAcrossChannels } = await import("@/lib/apply-fix.server");
    let plan;
    try {
      plan = await planFixAcrossChannels({ store, finding, ...channels });
    } catch (err) {
      // L'appel a échoué : rien n'a été livré, l'unité est rendue.
      await refundQuota(supabaseAdmin, userId, "fixes");
      throw err;
    }

    if (plan.kind === "no_action") {
      // Le modèle n'a rien trouvé à corriger : facturer ce non-résultat
      // reviendrait à faire payer une réponse vide.
      await refundQuota(supabaseAdmin, userId, "fixes");
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
    // Le journal `actions` n'est plus modifiable depuis le navigateur : ses
    // écritures passent par le rôle de service. L'appartenance reste garantie
    // par les lectures qui précèdent, elles, soumises à RLS avec le client de
    // l'utilisateur — une action qu'il ne possède pas n'est jamais lue, donc
    // jamais écrite.
    const { supabaseAdmin: journal } = await import("@/integrations/supabase/client.server");
    const row = await insertProposal(journal as never, {
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
    // Le journal `actions` n'est plus modifiable depuis le navigateur : ses
    // écritures passent par le rôle de service. L'appartenance reste garantie
    // par les lectures qui précèdent, elles, soumises à RLS avec le client de
    // l'utilisateur — une action qu'il ne possède pas n'est jamais lue, donc
    // jamais écrite.
    const { supabaseAdmin: journal } = await import("@/integrations/supabase/client.server");

    // Lecture avec le client de l'utilisateur : c'est elle qui prouve
    // l'appartenance, RLS refusant toute action d'une autre boutique.
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
    const claimed = await claimProposal(journal as never, data.actionId);
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
      await markFailed(journal as never, data.actionId, message);
      throw err;
    }

    // Réversibilité constatée après coup, jamais présumée.
    const revert = result.revert ?? { supported: false, data: {} };
    await finalizeApplied(
      journal as never,
      data.actionId,
      {
        ...(proposal.after_value ?? {}),
        ...revert.data,
        applied_detail: result.detail ?? null,
        admin_url: result.adminUrl ?? null,
      },
      revert.supported,
    );

    // Double écriture temporaire : l'UI existante lit encore audit_findings.
    //
    // `result` porte un bloc `revert` dont les données sont typées
    // `Record<string, unknown>` : le compilateur refuse de l'écrire dans une
    // colonne `jsonb`, et il a raison — rien ne garantit que ce contenu soit
    // sérialisable. On n'écrit donc que ce que cette colonne doit contenir,
    // c'est-à-dire ce que l'interface affiche.
    // Exactement les champs que l'écran d'audit lit — ni plus, ni moins.
    const appliedResult = {
      action: result.action,
      summary: result.summary,
      detail: result.detail ?? null,
      adminUrl: result.adminUrl ?? null,
      channel: result.channel ?? null,
    };
    await supabase
      .from("audit_findings")
      .update({
        applied_at: new Date().toISOString(),
        applied_result: appliedResult,
        status: "done",
      })
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

    // Réponse volontairement restreinte : les données d'annulation restent côté
    // serveur, dans la ligne `actions`. Le client n'en a pas besoin.
    return {
      action: result.action as string,
      channel: (result.channel ?? null) as string | null,
      summary: result.summary as string,
      detail: (result.detail ?? null) as string | null,
      adminUrl: (result.adminUrl ?? null) as string | null,
    };
  });

/**
 * Annule une action appliquée.
 *
 * Idempotent : la transition `applied` → `reverted` est gardée, une seconde
 * annulation n'exécute rien. En cas d'échec, la ligne redevient `applied` avec le
 * motif — un échec n'est jamais présenté comme une annulation réussie.
 */
export const revertAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ACTION_INPUT.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { loadProposal, claimRevert, restoreAfterFailedRevert } =
      await import("@/lib/actions.server");
    // Le journal `actions` n'est plus modifiable depuis le navigateur : ses
    // écritures passent par le rôle de service. L'appartenance reste garantie
    // par les lectures qui précèdent, elles, soumises à RLS avec le client de
    // l'utilisateur — une action qu'il ne possède pas n'est jamais lue, donc
    // jamais écrite.
    const { supabaseAdmin: journal } = await import("@/integrations/supabase/client.server");

    // Lecture avec le client de l'utilisateur : elle prouve l'appartenance.
    const action = await loadProposal(supabase as never, data.actionId);
    if (!action) throw new Error("Cette action est introuvable.");
    if (action.status !== "applied") {
      throw new Error(
        action.status === "reverted"
          ? "Cette correction a déjà été annulée."
          : "Cette action n'a pas été appliquée : il n'y a rien à annuler.",
      );
    }
    if (!action.finding_id) throw new Error("Action incomplète : problème d'origine inconnu.");

    const { finding, store, storeId } = await loadFindingContext(supabase, action.finding_id);
    const channels = await loadChannels(supabase, storeId);

    // Verrou d'idempotence : une seule annulation peut réserver l'action.
    const claimed = await claimRevert(journal as never, data.actionId);
    if (!claimed) {
      throw new Error("Cette correction vient d'être annulée, ou n'est pas annulable.");
    }

    const { executeRevert } = await import("@/lib/revert.server");

    let result;
    try {
      result = await executeRevert(
        { store, finding, ...channels },
        {
          tool: action.tool_name,
          targetRef: action.target_ref,
          beforeValue: action.before_value,
          afterValue: action.after_value,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await restoreAfterFailedRevert(journal as never, data.actionId, message);
      throw err;
    }

    // Double écriture temporaire : l'UI existante lit encore audit_findings. On ne
    // rouvre le problème que si plus aucune action n'y reste appliquée.
    const { data: stillApplied } = await supabase
      .from("actions")
      .select("id")
      .eq("finding_id", finding.id)
      .eq("status", "applied")
      .limit(1);
    if (!stillApplied || stillApplied.length === 0) {
      await supabase
        .from("audit_findings")
        .update({ applied_at: null, applied_result: null, status: "todo" })
        .eq("id", finding.id);
    }

    return result;
  });

/** Actions liées à une liste de problèmes, pour afficher l'état dans le rapport. */
export const listActionsForFindings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ findingIds: z.array(z.string().uuid()).max(100) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.findingIds.length === 0) return [];
    const { data: rows, error } = await context.supabase
      .from("actions")
      .select(
        "id, finding_id, tool_name, title, target_label, channel, status, applied_at, reverted_at, revertible, error_message",
      )
      .in("finding_id", data.findingIds)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (rows ?? []) as Array<{
      id: string;
      finding_id: string | null;
      tool_name: string;
      title: string;
      target_label: string | null;
      channel: ActionChannel;
      status: "proposed" | "applied" | "failed" | "reverted";
      applied_at: string | null;
      reverted_at: string | null;
      revertible: boolean;
      error_message: string | null;
    }>;
  });

/**
 * Plan et quotas de l'utilisateur connecté, pour affichage.
 *
 * Lecture seule : l'interface montre le solde, elle ne le décide pas. La
 * décision reste prise côté serveur au moment d'agir, où elle est opposable.
 */
export const getEntitlements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadEntitlements } = await import("@/lib/billing.server");
    const e = await loadEntitlements(supabaseAdmin, context.userId);
    return {
      tier: e.tier,
      periodStart: e.periodStart,
      used: e.used,
      remaining: e.remaining,
    };
  });
