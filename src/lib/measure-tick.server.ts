import { selectStoresToMeasure, type MeasurableOutcome } from "@/lib/measure-tick";

/**
 * Re-mesure les corrections appliquées, sans navigateur.
 *
 * LE PROBLÈME QUE CELA RÈGLE. Le verdict d'une correction ne se calculait que
 * si le marchand ouvrait la page de suivi et cliquait sur « Remesurer ».
 * L'outil ne savait donc annoncer « cette correction a fait reculer ta
 * boutique » qu'à quelqu'un venu le demander — c'est-à-dire à quelqu'un qui
 * soupçonnait déjà quelque chose. Une régression pouvait courir des semaines.
 *
 * Ce module ferme la boucle : le passage périodique mesure, tranche, et
 * PRÉVIENT. C'est la différence entre un outil qu'on pense à consulter et un
 * directeur qui vient vous voir.
 *
 * CE QU'IL NE FAIT PAS. Il ne crée aucune correction, n'en annule aucune, et
 * n'écrit rien chez les partenaires : il lit des indicateurs et pose un
 * verdict. L'annulation reste un geste que seul le marchand déclenche.
 *
 * COÛT. Chaque boutique traitée interroge Shopify, Meta et Google. Le plafond
 * porte donc sur les boutiques, la cadence est de deux mesures par jour au
 * plus, et un suivi dont le verdict est définitif n'est plus mesuré du tout.
 */

export { MAX_STORES_PER_MEASURE_TICK } from "@/lib/measure-tick";

export type MeasureTickResult = {
  /** Boutiques retenues par la règle de sélection. */
  stores: number;
  /** Suivis effectivement re-mesurés. */
  measured: number;
  /** Régressions apparues pendant ce passage. */
  regressions: number;
  /** Notifications réellement créées. */
  notified: number;
  /** Boutiques dont la mesure a échoué — canal déconnecté, API en panne. */
  failed: number;
};

/**
 * Un passage complet.
 *
 * Ne lève jamais. Une boutique dont le canal est déconnecté fait échouer sa
 * propre mesure et rien d'autre : les suivantes doivent avancer, et une
 * invocation planifiée qui se termine par une exception ne laisse aucune trace
 * exploitable.
 */
export async function runMeasureTick(now: Date = new Date()): Promise<MeasureTickResult> {
  const result: MeasureTickResult = {
    stores: 0,
    measured: 0,
    regressions: 0,
    notified: 0,
    failed: 0,
  };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data, error } = await supabaseAdmin
    .from("fix_outcomes")
    .select("id, store_id, applied_at, checked_at, attempted_at, verdict, coverage")
    // Les plus anciennement approchés d'abord : la sélection retrie, mais la
    // limite ci-dessous tronque, et il vaut mieux tronquer les plus frais.
    // `attempted_at` et non `checked_at` : une boutique qui échoue à chaque
    // passage doit reculer dans la file comme une boutique mesurée, sinon elle
    // occupe un créneau pour toujours.
    .order("attempted_at", { ascending: true, nullsFirst: true })
    .limit(200);

  if (error) {
    console.error("[mesure] lecture des suivis impossible :", error);
    return result;
  }

  const storeIds = selectStoresToMeasure((data ?? []) as MeasurableOutcome[], now);
  result.stores = storeIds.length;
  if (storeIds.length === 0) return result;

  const { refreshStoreOutcomes } = await import("@/lib/tracking.server");

  for (const storeId of storeIds) {
    // La tentative est datée AVANT l'appel. Une boutique qui échoue — canal
    // déconnecté, API en panne, jeton expiré — recule alors dans la file comme
    // une boutique mesurée, au lieu de monopoliser un créneau à chaque passage.
    const { error: stampError } = await supabaseAdmin
      .from("fix_outcomes")
      .update({ attempted_at: now.toISOString() })
      .eq("store_id", storeId);
    if (stampError) {
      // Sans cette date, la boutique reviendra au prochain passage. Ce n'est pas
      // une raison de ne pas la mesurer maintenant.
      console.error(`[mesure] tentative non datée sur ${storeId} :`, stampError);
    }

    try {
      const outcome = await refreshStoreOutcomes(supabaseAdmin, storeId);
      result.measured += outcome.updated;
      result.regressions += outcome.regressions.length;
      if (outcome.regressions.length > 0) {
        result.notified += await notifyRegressions(supabaseAdmin, storeId, outcome.regressions);
      }
    } catch (err) {
      // Cas le plus fréquent, et parfaitement normal : plus aucun canal
      // connecté sur cette boutique. Rien à réparer, rien à alerter.
      console.error(
        `[mesure] boutique ${storeId} non mesurée :`,
        err instanceof Error ? err.message : String(err),
      );
      result.failed += 1;
    }
  }

  return result;
}

/**
 * Prévient le propriétaire d'une régression qui vient d'apparaître.
 *
 * Une seule notification par correction et par apparition : `refreshStoreOutcomes`
 * ne signale que les passages EN régression, pas les régressions déjà connues.
 * Sonner à chaque mesure reviendrait à ne plus être écouté quand ça compte.
 */
async function notifyRegressions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  storeId: string,
  regressions: Array<{ findingId: string; title: string; headline: string }>,
): Promise<number> {
  const { data: store } = await supabase
    .from("stores")
    .select("id, name, owner_id")
    .eq("id", storeId)
    .maybeSingle();
  // Sans propriétaire, il n'y a personne à prévenir. La mesure reste écrite :
  // elle sera visible à la prochaine ouverture de la page de suivi.
  if (!store?.owner_id) return 0;

  const rows = regressions.map((regression) => ({
    user_id: store.owner_id,
    store_id: storeId,
    kind: "alert" as const,
    severity: "critical" as const,
    title: `${regression.title} a fait reculer ${store.name}`,
    body: regression.headline,
    action_label: "Voir la mesure",
    action_href: `/tracking/${storeId}`,
  }));

  const { error } = await supabase.from("notifications").insert(rows);
  if (error) {
    console.error("[mesure] notification non créée :", error);
    return 0;
  }
  return rows.length;
}
