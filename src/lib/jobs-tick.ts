import { isClaimable, readJob } from "@/lib/audit-jobs";

/**
 * Règle de sélection des audits à faire avancer, sans aucune entrée-sortie.
 *
 * Séparée du module serveur pour la même raison que `audit-jobs.ts` l'est de
 * `audit-jobs.server.ts` : c'est la règle qui décide ce qu'on exécute et donc ce
 * qu'on facture au fournisseur d'IA. Une règle pareille doit être vérifiable
 * sans base de données.
 */

/**
 * Nombre d'audits traités par passage.
 *
 * Une invocation planifiée est bornée en temps de calcul : mieux vaut avancer
 * de quelques audits chaque minute que d'en tenter trente et d'être interrompu
 * au milieu du dernier. Les autres attendent le passage suivant, ce qui ne coûte
 * rien puisque leur état est en base.
 */
export const MAX_AUDITS_PER_TICK = 3;

/**
 * Fenêtre de recherche.
 *
 * Un audit qu'aucun passage n'a réussi à terminer en une journée relève d'un
 * problème de fond, pas d'un incident passager : le relancer indéfiniment
 * consommerait des appels facturés sans jamais aboutir.
 */
export const LOOKBACK_MS = 24 * 60 * 60 * 1000;

export type PendingAudit = {
  id: string;
  created_by: string | null;
  input_snapshot: unknown;
};

/**
 * Retient les audits qu'un passage doit tenter, dans l'ordre reçu.
 *
 * DEUX FILTRES, DEUX RAISONS :
 *   - `isClaimable` écarte ce qui est terminé, déjà en cours sous bail valide,
 *     ou a épuisé ses tentatives. C'est la même règle que celle appliquée par
 *     la réclamation atomique — la dupliquer en SQL garantirait qu'un jour les
 *     deux divergent.
 *   - un audit sans `created_by` est écarté : on ne saurait ni à quel profil
 *     adapter l'analyse, ni à qui appartient le résultat.
 *
 * Le plafond est appliqué ici et non par l'appelant, pour que « combien
 * d'audits un passage peut-il lancer » se lise et se teste en un seul endroit.
 */
export function selectTickCandidates(
  rows: readonly PendingAudit[],
  now: Date = new Date(),
  max: number = MAX_AUDITS_PER_TICK,
): PendingAudit[] {
  const selected: PendingAudit[] = [];
  for (const row of rows) {
    if (selected.length >= max) break;
    if (!row.created_by) continue;
    if (!isClaimable(readJob(row.input_snapshot), now)) continue;
    selected.push(row);
  }
  return selected;
}

/** Borne basse de la fenêtre de recherche, au format attendu par PostgREST. */
export function lookbackFloor(now: Date = new Date()): string {
  return new Date(now.getTime() - LOOKBACK_MS).toISOString();
}
