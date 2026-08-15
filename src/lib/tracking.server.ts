import type { Db } from "@/lib/actions.server";
import {
  captureStoreMetrics,
  computeDeltas,
  type ChannelCredentials,
  type StoreMetrics,
} from "@/lib/metrics.server";
import { measureOutcome } from "@/lib/measure";
import { hasSomethingToLearn, type MeasurableOutcome } from "@/lib/measure-tick";
import { attemptSignature } from "@/lib/attempt-history";

/**
 * Forme exploitée d'une ligne de suivi, nommée plutôt que laissée en `any` : le
 * compilateur signale alors toute colonne mal orthographiée.
 */
type MeasurableRow = MeasurableOutcome & {
  finding_id: string;
  baseline: StoreMetrics | null;
  expected_gain_min: number | null;
  audit_findings: { title: string; category: string; finding_key: string | null } | null;
};

/** Verdicts qui ne bougeront plus. Voir `settled_at` dans la migration. */
const FINAL_VERDICTS = new Set(["confirme", "nul", "regression"]);

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
  } catch (err) {
    // Le suivi ne doit jamais faire échouer la correction — mais une correction
    // sans ligne de suivi ne sera JAMAIS mesurée, et personne ne le saurait si
    // l'échec restait muet.
    console.error("[mesure] instantané « avant » non enregistré :", err);
  }
}

/**
 * Re-mesure les suivis d'une boutique et met à jour écarts, verdicts et alertes.
 *
 * Ne touche que les lignes qui ont encore quelque chose à apprendre. Une
 * correction dont le verdict est définitif n'est pas recalculée : des semaines
 * plus tard, la fenêtre glissante ne recouvre plus le geste, et la « mesure »
 * porterait sur la saison.
 */
export async function refreshStoreOutcomes(supabase: Db, storeId: string, now: Date = new Date()) {
  const { data: rows, error } = await supabase
    .from("fix_outcomes")
    // Le domaine du problème corrigé détermine quelles métriques comptent :
    // une réécriture de fiche produit ne se juge pas au ROAS.
    .select("*, audit_findings(title, category, finding_key)")
    .eq("store_id", storeId);
  if (error) throw error;
  if (!rows || rows.length === 0) return { updated: 0, skipped: 0, regressions: [] };

  // Tri AVANT tout appel réseau : si tous les verdicts sont définitifs, il n'y a
  // aucune raison d'interroger Shopify, Meta et Google.
  const measurable = (rows as MeasurableRow[]).filter((row) => hasSomethingToLearn(row, now));
  const skipped = rows.length - measurable.length;
  if (measurable.length === 0) return { updated: 0, skipped, regressions: [] };

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

  const outcomes = measurable;

  // Comment la correction a été appliquée, quand elle est passée par une
  // action automatique. L'outil dit quelles métriques regarder — couper un
  // ensemble de publicités et réécrire une fiche produit ne se jugent pas de
  // la même façon — et `revertible` dit si l'annulation part d'un bouton.
  const { data: actionRows } = await supabase
    .from("actions")
    .select("id, finding_id, tool_name, revertible, applied_at")
    .eq("store_id", storeId)
    .eq("status", "applied")
    // `applied_at` n'est posé qu'au retour du partenaire. L'exiger écarte les
    // écritures encore en vol ou interrompues, dont on ignore si elles sont
    // parties : attribuer un verdict à l'outil d'une action qui n'a peut-être
    // jamais eu lieu fausserait la mesure et la mémoire. C'est aussi ce qui
    // évite qu'une telle ligne, triée en tête faute de date, se fasse passer
    // pour la correction en vigueur.
    .not("applied_at", "is", null)
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

  const measuredAt = new Date().toISOString();

  // Dates de règlement déjà connues, lues en une fois. `settled_at` doit être
  // écrit UNE SEULE FOIS ; l'upsert réécrivant la ligne entière, il faut
  // reporter la valeur existante à chaque mesure ultérieure sous peine de
  // l'effacer — et de relancer la boucle de réanalyse qu'elle vient d'arrêter.
  const { data: knownAttempts } = await journal
    .from("fix_attempts")
    .select("signature, settled_at")
    .eq("store_id", storeId);
  const settledBySignature = new Map(
    ((knownAttempts ?? []) as Array<{ signature: string; settled_at: string | null }>).map((a) => [
      a.signature,
      a.settled_at,
    ]),
  );

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
        // Un passage est UNE mesure : toutes ses lignes portent le même instant.
        checked_at: measuredAt,
        attempted_at: measuredAt,
      })
      .eq("id", row.id);

    // MÉMOIRE. Écrite à chaque mesure, à l'échelle de la boutique et non de
    // l'audit : c'est ce qui permet au diagnostic SUIVANT de savoir que cette
    // correction a déjà été tentée, et ce qu'elle a donné. Sans elle, chaque
    // audit reproposerait ce qui a échoué le mois précédent.
    // Le verdict devient-il définitif MAINTENANT ? La distinction porte tout le
    // bouclage : c'est elle qui dit si la boutique a réellement appris quelque
    // chose depuis son dernier diagnostic.
    const signature = attemptSignature({
      key: row.audit_findings?.finding_key,
      title: row.audit_findings?.title,
    });
    const settledBefore = settledBySignature.get(signature) ?? null;
    const settledNow = !settledBefore && FINAL_VERDICTS.has(outcome.verdict);
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
          measured_at: measuredAt,
          // Écrit UNE SEULE FOIS, au passage où le verdict devient définitif.
          // `measured_at` est réécrit deux fois par jour ; s'en servir pour
          // répondre à « qu'a-t-on appris depuis le dernier diagnostic ? »
          // faisait repasser pour neuf un verdict déjà intégré, et relançait
          // un audit payant, indéfiniment.
          settled_at: settledNow ? measuredAt : settledBefore,
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

  return { updated: outcomes.length, skipped, regressions };
}
