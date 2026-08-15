/**
 * Quelles corrections re-mesurer, et quand.
 *
 * LE PROBLÈME QUE CELA RÈGLE. La mesure existait, mais elle ne partait que si
 * le marchand ouvrait la page de suivi et cliquait sur « Remesurer ». Autrement
 * dit : l'outil ne savait dire « cette correction a fait reculer ta boutique »
 * qu'à quelqu'un qui pensait déjà à venir demander. Une régression pouvait
 * courir des semaines sans que personne ne la voie.
 *
 * Ce module est la règle de sélection du passage périodique. Elle est
 * volontairement pure et séparée : ce qu'elle décide coûte des appels facturés
 * aux API partenaires, et une règle qu'on peut exercer sans réseau est une
 * règle qu'on peut vérifier.
 *
 * TROIS RAISONS DE NE PAS MESURER, et elles comptent autant que la mesure :
 *
 * 1. **Trop tôt depuis la dernière fois.** Les indicateurs sont des cumuls sur
 *    30 jours ; entre deux mesures espacées d'une heure, moins d'un trois
 *    centième de la fenêtre a changé. Mesurer plus souvent que deux fois par
 *    jour ne produit aucune information nouvelle et brûle du quota partenaire.
 *
 * 2. **Le verdict est définitif.** Une fois la fenêtre entièrement postérieure
 *    à la correction et le verdict tranché, continuer ne dit plus rien sur
 *    cette correction : la comparaison porterait sur deux fenêtres disjointes,
 *    et mesurerait la saison plutôt que le geste.
 *
 * 3. **Le suivi est trop vieux.** Passé un mois et demi, la ligne appartient à
 *    l'histoire. La laisser réclamer des mesures indéfiniment ferait grossir le
 *    coût du passage périodique sans fin.
 */

/** Une ligne de `fix_outcomes`, réduite à ce que la sélection regarde. */
export type MeasurableOutcome = {
  id: string;
  store_id: string;
  applied_at: string;
  /** Dernière mesure. `null` si la correction n'a jamais été mesurée. */
  checked_at: string | null;
  /** Verdict courant, `null` avant la première mesure. */
  verdict: string | null;
  /** Part de la fenêtre postérieure à la correction, entre 0 et 1. */
  coverage: number | null;
};

/** Deux fois par jour suffit sur une fenêtre glissante de trente jours. */
export const MEASURE_INTERVAL_MS = 12 * 3_600_000;

/** Au-delà, la ligne n'est plus re-mesurée : elle appartient à l'histoire. */
export const MAX_TRACKING_DAYS = 45;

/**
 * Boutiques traitées par passage.
 *
 * Le plafond porte sur les BOUTIQUES et non sur les corrections : une mesure
 * interroge Shopify, Meta et Google une fois pour toute la boutique, et sert
 * ensuite tous ses suivis. Compter en corrections surestimerait le coût d'un
 * facteur égal au nombre de corrections suivies.
 */
export const MAX_STORES_PER_MEASURE_TICK = 2;

/** Verdicts qui ne bougeront plus une fois la fenêtre pleine. */
const FINAL_VERDICTS = new Set(["confirme", "nul", "regression"]);

function millis(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

/**
 * Ce suivi a-t-il encore quelque chose à apprendre d'une mesure ?
 *
 * Tolérant aux valeurs illisibles : `fix_outcomes` reste modifiable depuis le
 * navigateur, et une date corrompue ne doit ni faire échouer le passage, ni
 * ouvrir la porte à des mesures en boucle. Une date d'application illisible
 * écarte la ligne — sans elle, aucun verdict n'a de sens de toute façon.
 */
export function isMeasurable(row: MeasurableOutcome, now: Date): boolean {
  const appliedAt = millis(row.applied_at);
  if (appliedAt === null) return false;

  const ageDays = (now.getTime() - appliedAt) / 86_400_000;
  if (ageDays < 0 || ageDays > MAX_TRACKING_DAYS) return false;

  // Fenêtre pleine ET verdict tranché : il n'y a plus rien à en tirer.
  if ((row.coverage ?? 0) >= 1 && FINAL_VERDICTS.has(row.verdict ?? "")) return false;

  const checkedAt = millis(row.checked_at);
  if (checkedAt === null) return true;
  return now.getTime() - checkedAt >= MEASURE_INTERVAL_MS;
}

/**
 * Boutiques à mesurer pendant ce passage.
 *
 * Les moins récemment mesurées d'abord : sans cet ordre, une boutique portant
 * beaucoup de suivis passerait systématiquement devant les autres et les
 * affamerait. Une boutique jamais mesurée passe avant toutes les autres.
 */
export function selectStoresToMeasure(
  rows: MeasurableOutcome[],
  now: Date,
  max: number = MAX_STORES_PER_MEASURE_TICK,
): string[] {
  const oldestByStore = new Map<string, number>();

  for (const row of rows) {
    if (!row.store_id || !isMeasurable(row, now)) continue;
    // Jamais mesurée : priorité absolue, d'où `-Infinity`.
    const checkedAt = millis(row.checked_at) ?? Number.NEGATIVE_INFINITY;
    const known = oldestByStore.get(row.store_id);
    if (known === undefined || checkedAt < known) oldestByStore.set(row.store_id, checkedAt);
  }

  return [...oldestByStore.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(0, max))
    .map(([storeId]) => storeId);
}
