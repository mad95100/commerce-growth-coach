import type { Db } from "@/lib/actions.server";
import {
  captureStoreMetrics,
  computeDeltas,
  type ChannelCredentials,
  type StoreMetrics,
} from "@/lib/metrics.server";
import { measureOutcome } from "@/lib/measure";
import { attemptSignature } from "@/lib/attempt-history";

// Même type de client que le journal des actions : le redéclarer
// réintroduirait des `any` déjà assumés une fois ailleurs.

/**
 * Récupère les identifiants chiffrés des canaux actifs d'une boutique.
 *
 * Les colonnes de jetons ne sont plus lisibles par le rôle `authenticated` :
 * elles ne doivent jamais être servies à un navigateur. La lecture passe donc
 * par le rôle de service, qui contourne RLS — l'appartenance de la boutique est
 * donc vérifiée explicitement ici, et non déléguée à la base.
 */
export async function loadChannelCredentials(
  supabase: Db,
  storeId: string,
): Promise<ChannelCredentials> {
  // La boutique est lue avec le client de l'appelant : si celui-ci ne la
  // possède pas, RLS ne renvoie rien et aucun jeton n'est chargé.
  const { data: owned } = await supabase
    .from("stores")
    .select("id")
    .eq("id", storeId)
    .maybeSingle();
  if (!owned) return {};

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: conns } = await supabaseAdmin
    .from("data_connections")
    .select("provider, account_id, access_token_ciphertext, refresh_token_ciphertext")
    .eq("store_id", storeId)
    .eq("status", "active");

  type ConnRow = {
    provider: string;
    account_id: string | null;
    access_token_ciphertext: string | null;
    refresh_token_ciphertext: string | null;
  };
  const active = (conns ?? []) as ConnRow[];
  const shopify = active.find((c) => c.provider === "shopify");
  const meta = active.find((c) => c.provider === "meta_ads");
  const google = active.find((c) => c.provider === "google_ads");

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

/**
 * Enregistre l'instantané « avant » d'une correction.
 *
 * `baseline` permet de fournir une photo prise AVANT l'écriture (au moment de la
 * proposition) : c'est la seule façon d'avoir un vrai « avant ». Sans elle, la
 * mesure est prise à l'instant de l'appel.
 */
export async function recordFixBaseline(
  supabase: Db,
  params: {
    findingId: string;
    storeId: string;
    expectedGainMin: number | null;
    expectedGainMax: number | null;
    creds: ChannelCredentials;
    baseline?: StoreMetrics | null;
  },
): Promise<void> {
  try {
    const baseline = params.baseline ?? (await captureStoreMetrics(params.creds));
    const { supabaseAdmin: journal } = await import("@/integrations/supabase/client.server");
    await journal.from("fix_outcomes").upsert(
      {
        finding_id: params.findingId,
        store_id: params.storeId,
        applied_at: new Date().toISOString(),
        expected_gain_min: params.expectedGainMin,
        expected_gain_max: params.expectedGainMax,
        baseline,
        latest: null,
        delta: null,
        status: "measuring",
        alert_message: null,
        checked_at: null,
      },
      { onConflict: "finding_id" },
    );
  } catch {
    /* le suivi ne doit jamais faire échouer la correction */
  }
}

/** Re-mesure tous les suivis d'une boutique et met à jour écarts, statut et alertes. */
export async function refreshStoreOutcomes(supabase: Db, storeId: string) {
  const { data: rows, error } = await supabase
    .from("fix_outcomes")
    // Le domaine du problème corrigé détermine quelles métriques comptent :
    // une réécriture de fiche produit ne se juge pas au ROAS.
    .select("*, audit_findings(title, category, finding_key)")
    .eq("store_id", storeId);
  if (error) throw error;
  if (!rows || rows.length === 0) return { updated: 0, regressions: [] };

  const creds = await loadChannelCredentials(supabase, storeId);
  if (!creds.shopify && !creds.meta && !creds.google) {
    throw new Error(
      "Connecte au moins Shopify, Meta Ads ou Google Ads pour mesurer l'impact des corrections.",
    );
  }

  const latest = await captureStoreMetrics(creds);

  // `fix_outcomes` n'est plus modifiable par le navigateur : les mesures sont
  // écrites par le serveur. Les lignes viennent d'être lues avec le client de
  // l'appelant, donc filtrées par RLS sur ses propres boutiques.
  const { supabaseAdmin: journal } = await import("@/integrations/supabase/client.server");

  // Forme exploitée d'une ligne de suivi, nommée plutôt que laissée en `any` :
  // le compilateur signale alors toute colonne mal orthographiée.
  type OutcomeRow = {
    id: string;
    finding_id: string;
    baseline: StoreMetrics | null;
    applied_at: string;
    expected_gain_min: number | null;
    verdict: string | null;
    audit_findings: { title: string; category: string; finding_key: string | null } | null;
  };
  const outcomes = (rows ?? []) as OutcomeRow[];

  // Comment la correction a été appliquée, quand elle est passée par une
  // action automatique. L'outil dit quelles métriques regarder — couper un
  // ensemble de publicités et réécrire une fiche produit ne se jugent pas de
  // la même façon — et `revertible` dit si l'annulation part d'un bouton.
  const { data: actionRows } = await supabase
    .from("actions")
    .select("id, finding_id, tool_name, revertible, applied_at")
    .eq("store_id", storeId)
    .eq("status", "applied")
    .in(
      "finding_id",
      outcomes.map((o) => o.finding_id),
    )
    .order("applied_at", { ascending: false });

  type ActionRow = {
    id: string;
    finding_id: string | null;
    tool_name: string | null;
    revertible: boolean | null;
  };
  // La plus récente par problème : c'est celle qui est encore en vigueur.
  const actionByFinding = new Map<string, ActionRow>();
  for (const action of (actionRows ?? []) as ActionRow[]) {
    if (action.finding_id && !actionByFinding.has(action.finding_id)) {
      actionByFinding.set(action.finding_id, action);
    }
  }

  // Régressions APPARUES pendant ce passage. Le passage périodique s'en sert
  // pour prévenir le marchand — et seulement de celles-là : renotifier à
  // chaque mesure une régression déjà signalée revient à ne plus être écouté.
  const regressions: Array<{ findingId: string; title: string; headline: string }> = [];

  for (const row of outcomes) {
    const baseline = (row.baseline ?? {}) as StoreMetrics;
    const deltas = computeDeltas(baseline, latest);
    const action = actionByFinding.get(row.finding_id);
    const outcome = measureOutcome({
      deltas,
      appliedAt: row.applied_at,
      category: row.audit_findings?.category ?? null,
      tool: action?.tool_name ?? null,
      revertible: action?.revertible === true,
    });

    await journal
      .from("fix_outcomes")
      .update({
        latest,
        delta: deltas,
        // L'ancienne colonne reste renseignée : elle porte l'énumération que
        // l'interface historique et les notifications lisent encore.
        status: outcome.legacyStatus,
        // Seule une régression mérite d'alerter. Un impact faible ou nul est
        // une information, pas une alarme — sonner pour tout revient à ne
        // plus être écouté quand ça compte.
        alert_message: outcome.verdict === "regression" ? outcome.headline : null,
        verdict: outcome.verdict,
        headline: outcome.headline,
        explanation: outcome.explanation,
        coverage: outcome.coverage,
        measured_days: outcome.days,
        rollback_recommended: outcome.rollback.recommended,
        rollback_possible: outcome.rollback.possible,
        rollback_reason: outcome.rollback.reason,
        drivers: outcome.drivers,
        guards: outcome.guards,
        tool_name: action?.tool_name ?? null,
        action_id: action?.id ?? null,
        checked_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    // MÉMOIRE. Écrite à chaque mesure, à l'échelle de la boutique et non de
    // l'audit : c'est ce qui permet au diagnostic SUIVANT de savoir que cette
    // correction a déjà été tentée, et ce qu'elle a donné. Sans elle, chaque
    // audit reproposerait ce qui a échoué le mois précédent.
    const signature = attemptSignature({
      key: row.audit_findings?.finding_key,
      title: row.audit_findings?.title,
    });
    if (signature) {
      const { error: memoryError } = await journal.from("fix_attempts").upsert(
        {
          store_id: storeId,
          signature,
          finding_id: row.finding_id,
          finding_key: row.audit_findings?.finding_key ?? null,
          title: row.audit_findings?.title ?? "Correction appliquée",
          category: row.audit_findings?.category ?? null,
          tool_name: action?.tool_name ?? null,
          applied_at: row.applied_at,
          verdict: outcome.verdict,
          headline: outcome.headline,
          rollback_recommended: outcome.rollback.recommended,
          rollback_possible: outcome.rollback.possible,
          measured_at: new Date().toISOString(),
        },
        { onConflict: "store_id,signature" },
      );
      // La mémoire est un confort de diagnostic, pas une condition de la
      // mesure : une écriture ratée ne doit pas perdre le verdict qui vient
      // d'être calculé.
      if (memoryError) console.error("[mesure] mémoire non écrite :", memoryError);
    }

    if (outcome.verdict === "regression" && row.verdict !== "regression") {
      regressions.push({
        findingId: row.finding_id,
        title: row.audit_findings?.title ?? "Correction appliquée",
        headline: outcome.headline,
      });
    }
  }

  return { updated: outcomes.length, regressions };
}
