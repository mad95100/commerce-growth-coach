/**
 * « Voici ce que je ferais maintenant si cette entreprise était la mienne. »
 *
 * POURQUOI CE MODULE. Le centre de pilotage affichait les trois problèmes au
 * plus haut score. C'était faux dès que la chaîne causale a existé : le
 * deuxième de la liste pouvait être la conséquence directe du premier, et le
 * marchand se voyait proposer de corriger un symptôme dont la cause était
 * encore là. Corriger dans cet ordre ne produit rien, et le problème
 * réapparaît au diagnostic suivant.
 *
 * Ce que ce module ajoute au classement de `finding-graph.ts` : l'état
 * d'avancement. Un problème n'est exécutable que si tout ce qui le cause est
 * déjà corrigé. Le plan se recompose donc tout seul à mesure que le marchand
 * avance — c'est la boucle « corriger → mesurer → réanalyser » rendue visible,
 * sans nouvel appel au modèle.
 *
 * Il répond à quatre questions, dans cet ordre :
 *   1. Qu'est-ce que je fais MAINTENANT, et pourquoi celui-là ?
 *   2. Qu'est-ce qui vient ensuite ?
 *   3. Qu'est-ce qui attend, et qu'est-ce qui l'attend ?
 *   4. Qu'est-ce que je ne sais pas encore, et qui pourrait tout changer ?
 *
 * Module PUR : aucune entrée-sortie. Les lignes lui arrivent telles que la
 * base les rend, `jsonb` compris, et il ne fait aucune confiance à leur forme —
 * `audit_findings` est modifiable depuis le navigateur.
 */

import {
  BAND_RANK,
  toEpistemicLevel,
  toPriorityBand,
  type PriorityBand,
} from "@/lib/finding-graph";
import { formatMinutes } from "@/lib/scoring";

/** Ligne d'`audit_findings` telle qu'elle sort de PostgREST. */
export type PlannableFinding = {
  id: string;
  title: string;
  category: string;
  status: string;
  finding_key?: string | null;
  /** Colonne `jsonb` : peut être n'importe quoi. */
  caused_by?: unknown;
  priority_score?: number | null;
  priority_band?: string | null;
  priority_reason?: string | null;
  epistemic_level?: string | null;
  estimated_gain_min?: number | null;
  estimated_gain_max?: number | null;
  time_minutes?: number | null;
  blocks_count?: number | null;
  auto_correction?: unknown;
  sort_order?: number | null;
  audit_id?: string | null;
};

export type PlannedMove = {
  id: string;
  auditId: string | null;
  title: string;
  category: string;
  band: PriorityBand | null;
  /** La justification calculée à l'audit. Reprise telle quelle, jamais réécrite. */
  reason: string | null;
  gainMin: number | null;
  gainMax: number | null;
  timeMinutes: number | null;
  /** Titres des problèmes que cette correction fait tomber. */
  unlocks: string[];
  /** Ce qu'il faudra regarder, et sur quelle fenêtre, pour savoir si ça a marché. */
  measure: string;
  hasAutoFix: boolean;
};

export type BlockedMove = {
  id: string;
  title: string;
  /** Titres des problèmes à corriger avant celui-ci. */
  blockedBy: string[];
};

export type NextMovePlan = {
  /** Le seul geste à faire maintenant. `null` si tout est fait. */
  now: PlannedMove | null;
  /** Les deux suivants, une fois `now` corrigé. */
  then: PlannedMove[];
  blocked: BlockedMove[];
  /** Conclusions que l'audit n'a pas pu établir : à vérifier, pas à corriger. */
  unknowns: Array<{ id: string; title: string }>;
  /** La réponse du directeur, en français, prête à afficher. */
  rationale: string;
};

/**
 * Ce qu'on regarde après une correction, par domaine.
 *
 * La fenêtre fait partie de la réponse : sur sept jours un taux de conversion
 * bouge, sur deux il ne fait que du bruit. Annoncer la mesure sans son horizon
 * revient à inviter le marchand à conclure trop tôt — et à défaire une
 * correction qui marchait.
 */
export const MEASURE_BY_CATEGORY: Record<string, string> = {
  offre: "le taux d'ajout au panier, sur 7 jours",
  produit: "le taux d'ajout au panier de cette fiche, sur 7 jours",
  boutique: "le nombre de pages vues par visite et le taux de rebond, sur 7 jours",
  conversion: "le taux de conversion et le taux d'abandon de panier, sur 7 jours",
  acquisition: "le coût par achat et le ROAS, sur 7 jours — pas moins, en dessous c'est du bruit",
  retention: "la part de clients qui repassent commande, sur 30 jours",
  rentabilite: "la marge une fois la publicité payée, sur 30 jours",
  operations: "le délai de livraison moyen et le nombre de réclamations, sur 30 jours",
};

const DEFAULT_MEASURE = "le chiffre d'affaires et le taux de conversion, sur 7 jours";

const DONE = "done";

function isDone(finding: PlannableFinding): boolean {
  return finding.status === DONE;
}

/** Lit `caused_by` sans rien supposer : la colonne vient d'un `jsonb` ouvert au client. */
function causesOf(finding: PlannableFinding): string[] {
  if (!Array.isArray(finding.caused_by)) return [];
  return finding.caused_by.filter(
    (key): key is string => typeof key === "string" && key.length > 0,
  );
}

/** Du plus urgent au moins urgent, à égalité l'ordre décidé à l'audit. */
function byUrgency(a: PlannableFinding, b: PlannableFinding): number {
  const score = (b.priority_score ?? 0) - (a.priority_score ?? 0);
  if (score !== 0) return score;
  const bandA = toPriorityBand(a.priority_band);
  const bandB = toPriorityBand(b.priority_band);
  const rank =
    (BAND_RANK[bandA ?? "optimisation"] ?? 3) - (BAND_RANK[bandB ?? "optimisation"] ?? 3);
  if (rank !== 0) return rank;
  return (a.sort_order ?? 0) - (b.sort_order ?? 0);
}

function toMove(finding: PlannableFinding, unlocks: string[]): PlannedMove {
  return {
    id: finding.id,
    auditId: finding.audit_id ?? null,
    title: finding.title,
    category: finding.category,
    band: toPriorityBand(finding.priority_band),
    reason: finding.priority_reason ?? null,
    gainMin: finding.estimated_gain_min ?? null,
    gainMax: finding.estimated_gain_max ?? null,
    timeMinutes: finding.time_minutes ?? null,
    unlocks,
    measure: MEASURE_BY_CATEGORY[finding.category] ?? DEFAULT_MEASURE,
    hasAutoFix: Boolean(finding.auto_correction),
  };
}

/** Énumère en français : « A », « A et B », « A, B et C ». */
function enumerate(items: string[]): string {
  const quoted = items.map((item) => `« ${item} »`);
  if (quoted.length <= 1) return quoted[0] ?? "";
  return `${quoted.slice(0, -1).join(", ")} et ${quoted[quoted.length - 1]}`;
}

/**
 * Compose le plan.
 *
 * Tolère les données des audits antérieurs, qui ne portent ni clé ni lien de
 * causalité : tout y est exécutable, et le plan retombe sur un simple ordre de
 * priorité. C'est le comportement d'avant, ce qui est exactement ce qu'il faut.
 */
export function buildNextMovePlan(findings: PlannableFinding[]): NextMovePlan {
  const pending = findings.filter((f) => !isDone(f));

  if (pending.length === 0) {
    return {
      now: null,
      then: [],
      blocked: [],
      unknowns: [],
      rationale:
        "Tout ce que le dernier diagnostic avait relevé est corrigé. Relance-en un : c'est en mesurant l'effet des corrections qu'on trouve le prochain levier.",
    };
  }

  // Une cause déjà corrigée ne bloque plus rien. Seules comptent celles qui
  // restent en attente dans ce même audit.
  const pendingByKey = new Map<string, PlannableFinding>();
  for (const finding of pending) {
    if (finding.finding_key) pendingByKey.set(finding.finding_key, finding);
  }

  const blockersOf = (finding: PlannableFinding): PlannableFinding[] =>
    causesOf(finding)
      .map((key) => pendingByKey.get(key))
      .filter((blocker): blocker is PlannableFinding => Boolean(blocker) && blocker !== finding);

  let actionable = pending.filter((f) => blockersOf(f).length === 0);

  // Aucun problème exécutable alors qu'il en reste : les liens de causalité de
  // ces lignes ne tiennent pas debout (la table est modifiable depuis le
  // navigateur). Plutôt que de ne rien proposer, on les ignore et on retombe
  // sur le classement seul — mieux vaut un ordre imparfait qu'un écran vide.
  if (actionable.length === 0) actionable = [...pending];

  const ranked = [...actionable].sort(byUrgency);

  // Ce que chaque correction fait tomber : les problèmes en attente qui la
  // citent comme cause, directement.
  const unlocksOf = (finding: PlannableFinding): string[] =>
    finding.finding_key
      ? pending
          .filter((other) => other !== finding && causesOf(other).includes(finding.finding_key!))
          .map((other) => other.title)
      : [];

  const now = toMove(ranked[0], unlocksOf(ranked[0]));
  const then = ranked.slice(1, 3).map((f) => toMove(f, unlocksOf(f)));

  const blocked: BlockedMove[] = pending
    .filter((f) => blockersOf(f).length > 0)
    .sort(byUrgency)
    .map((f) => ({
      id: f.id,
      title: f.title,
      blockedBy: blockersOf(f).map((blocker) => blocker.title),
    }));

  const unknowns = pending
    .filter((f) => toEpistemicLevel(f.epistemic_level) === "donnee_manquante")
    .sort(byUrgency)
    .map((f) => ({ id: f.id, title: f.title }));

  // --- La réponse du directeur ---------------------------------------------
  const parts = [`Si cette boutique était la mienne, je commencerais par « ${now.title} ».`];
  if (now.reason) parts.push(now.reason);
  if (now.unlocks.length > 0) {
    parts.push(
      now.unlocks.length === 1
        ? `Le corriger fait tomber ${enumerate(now.unlocks)} du même coup.`
        : `Le corriger fait tomber ${enumerate(now.unlocks)} du même coup — ${now.unlocks.length} problèmes réglés en une fois.`,
    );
  }
  if (now.timeMinutes) parts.push(`Compte ${formatMinutes(now.timeMinutes)}.`);
  parts.push(`Ensuite, regarde ${now.measure} : c'est ça qui dira si ça a marché.`);
  if (unknowns.length > 0) {
    parts.push(
      unknowns.length === 1
        ? `Une réserve : sur ${enumerate([unknowns[0].title])}, je n'ai pas la donnée pour trancher. Vérifie avant d'y mettre du budget.`
        : `Une réserve : sur ${unknowns.length} points, je n'ai pas la donnée pour trancher. Vérifie-les avant d'y mettre du budget.`,
    );
  }

  return { now, then, blocked, unknowns, rationale: parts.join(" ") };
}
