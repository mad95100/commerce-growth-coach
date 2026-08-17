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
  isTechnicalOnlyEvidence,
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
  /**
   * Colonne `jsonb` : la preuve citée par le moteur. On n'en lit que
   * `based_on`, et sans rien présumer de sa forme.
   */
  evidence?: unknown;
  /**
   * Ce que la mémoire de la boutique disait de cette piste au moment de
   * l'audit : `proposer`, `prioriser`, `reformuler` ou `ecarter`.
   */
  history_action?: string | null;
  history_note?: string | null;
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
  /** Ce que la mémoire dit de cette piste. `null` si elle est neuve. */
  historyNote: string | null;
};

export type BlockedMove = {
  id: string;
  title: string;
  /** Titres des problèmes à corriger avant celui-ci. */
  blockedBy: string[];
};

/**
 * Verdict d'une correction déjà appliquée, tel que `measure.ts` l'a rendu et
 * que la base le restitue.
 */
export type MeasuredOutcome = {
  findingId: string;
  title: string;
  /** `confirme` | `insuffisant` | `nul` | `regression` | `en_cours`. */
  verdict: string | null;
  headline: string | null;
  rollbackRecommended?: boolean | null;
  rollbackPossible?: boolean | null;
  /** Action à annuler, quand l'annulation est automatisable. */
  actionId?: string | null;
};

/** Une correction qui a dégradé la situation, et ce qu'on peut y faire. */
export type RollbackAlert = {
  findingId: string;
  title: string;
  headline: string | null;
  /** `true` si l'annulation part d'un bouton, `false` s'il faut la main. */
  automatic: boolean;
  actionId: string | null;
};

export type NextMovePlan = {
  /**
   * Ce qui passe AVANT tout le reste : une correction qui a fait reculer la
   * boutique. Annuler un dégât prime sur tout gain potentiel.
   */
  alert: RollbackAlert | null;
  /** Le seul geste à faire maintenant. `null` si tout est fait. */
  now: PlannedMove | null;
  /** Les deux suivants, une fois `now` corrigé. */
  then: PlannedMove[];
  blocked: BlockedMove[];
  /** Conclusions que l'audit n'a pas pu établir : à vérifier, pas à corriger. */
  unknowns: Array<{ id: string; title: string }>;
  /**
   * Constats techniques dont l'effet commercial n'est pas mesuré.
   *
   * Ils ne sont ni cachés ni proposés comme LE geste : ils sont listés à part,
   * avec ce qui manque pour trancher. Les taire ferait disparaître un défaut
   * réel ; les mettre en tête ferait passer une lenteur de serveur devant une
   * fuite chiffrée sur les commandes.
   */
  technical: Array<{ id: string; title: string }>;
  /** Corrections dont l'effet est prouvé. Ce qui marche, et qu'on garde. */
  proven: Array<{ findingId: string; title: string; headline: string | null }>;
  /** Corrections appliquées sans effet mesurable : le diagnostic était à côté. */
  ineffective: Array<{ findingId: string; title: string; headline: string | null }>;
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

/**
 * Cette ligne n'est-elle qu'un constat technique ?
 *
 * Lecture tolérante d'une colonne `jsonb` ouverte : tout ce qui n'a pas la
 * forme attendue vaut « non », c'est-à-dire aucune restriction. Se tromper dans
 * ce sens ne fait que laisser une conclusion à sa place ; se tromper dans
 * l'autre effacerait un vrai problème du plan.
 */
export function isTechnicalConstat(finding: PlannableFinding): boolean {
  const evidence = finding.evidence;
  if (!evidence || typeof evidence !== "object") return false;
  return isTechnicalOnlyEvidence((evidence as { based_on?: unknown }).based_on);
}

/** Cette ligne porte-t-elle un montant, donc une conséquence commerciale chiffrée ? */
function hasAmount(finding: PlannableFinding): boolean {
  return (finding.estimated_gain_max ?? 0) > 0 || (finding.estimated_gain_min ?? 0) > 0;
}

/** Du plus urgent au moins urgent, à égalité l'ordre décidé à l'audit. */
function byUrgency(a: PlannableFinding, b: PlannableFinding): number {
  // Ce que la mémoire impose passe avant le score : réparer une régression
  // n'est pas une question de rentabilité, et reproposer sans discernement ce
  // qui ressemble à un échec passé est ce qui fait perdre confiance.
  const memory = historyRank(a) - historyRank(b);
  if (memory !== 0) return memory;
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
    historyNote: finding.history_note ?? null,
  };
}

/**
 * Ordre imposé par la mémoire, avant tout calcul de priorité.
 *
 * Une piste marquée `prioriser` vient d'une correction qui a fait reculer la
 * boutique : elle passe devant, quel que soit son score. Une piste
 * `reformuler` ressemble à quelque chose qui a déjà échoué — on la garde, mais
 * derrière ce qui est neuf, parce qu'elle demande d'abord de justifier en quoi
 * elle diffère.
 */
const HISTORY_RANK: Record<string, number> = {
  prioriser: 0,
  proposer: 1,
  reformuler: 2,
  ecarter: 3,
};

function historyRank(finding: PlannableFinding): number {
  return HISTORY_RANK[finding.history_action ?? "proposer"] ?? 1;
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
export function buildNextMovePlan(
  findings: PlannableFinding[],
  outcomes: MeasuredOutcome[] = [],
): NextMovePlan {
  const pending = findings.filter((f) => !isDone(f));

  // --- Ce que les corrections déjà appliquées ont produit -------------------
  // Une régression prime sur tout : réparer un dégât passe avant n'importe quel
  // gain potentiel. On ne retient que les régressions dont l'annulation est
  // RECOMMANDÉE — `measure.ts` ne la recommande jamais à la légère.
  const alerts = outcomes.filter(
    (o) => o.verdict === "regression" && o.rollbackRecommended === true,
  );
  const alert: RollbackAlert | null =
    alerts.length > 0
      ? {
          findingId: alerts[0].findingId,
          title: alerts[0].title,
          headline: alerts[0].headline ?? null,
          automatic: alerts[0].rollbackPossible === true,
          actionId: alerts[0].actionId ?? null,
        }
      : null;

  const proven = outcomes
    .filter((o) => o.verdict === "confirme")
    .map((o) => ({ findingId: o.findingId, title: o.title, headline: o.headline ?? null }));

  // « Aucun impact » n'est pas un échec de la correction : c'est un échec du
  // DIAGNOSTIC. Reproposer la même correction serait absurde ; ce qu'il faut,
  // c'est chercher ailleurs. Le distinguer de la régression est tout l'intérêt
  // d'avoir quatre verdicts plutôt que deux.
  const ineffective = outcomes
    .filter((o) => o.verdict === "nul")
    .map((o) => ({ findingId: o.findingId, title: o.title, headline: o.headline ?? null }));

  if (pending.length === 0) {
    const parts: string[] = [];
    if (alert) parts.push(rollbackSentence(alert));
    parts.push(
      "Tout ce que le dernier diagnostic avait relevé est corrigé.",
      ...learningSentences(proven, ineffective),
      "Relancez un diagnostic : c'est en mesurant l'effet des corrections qu'on trouve le prochain levier.",
    );
    return {
      alert,
      now: null,
      then: [],
      blocked: [],
      unknowns: [],
      technical: [],
      proven,
      ineffective,
      rationale: parts.join(" "),
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

  // ═════════════════════════════════════════════════════════════════════════
  // UN CONSTAT TECHNIQUE NE PASSE PAS DEVANT UNE PERTE MESURÉE
  // ═════════════════════════════════════════════════════════════════════════
  // Le moteur prive déjà un constat purement technique de tout montant et lui
  // interdit la bande « critique ». Cela ne suffisait pas ici : le classement
  // se fait d'abord sur le score, où la sévérité pèse. Une lenteur de serveur
  // annoncée « high » pouvait donc être proposée comme LE geste à faire
  // maintenant, devant une fuite chiffrée sur les commandes réelles.
  //
  // La règle est contextuelle, et c'est ce qui la rend juste. Le constat
  // technique n'est relégué que s'il existe, ailleurs dans le plan, une
  // conclusion qui porte un montant. Sur une boutique où rien n'est chiffrable,
  // il reste le meilleur geste disponible — et le proposer est alors la bonne
  // réponse, pas un pis-aller.
  const measuredExists = actionable.some((f) => !isTechnicalConstat(f) && hasAmount(f));
  const demoted = new Set(measuredExists ? actionable.filter((f) => isTechnicalConstat(f)) : []);

  const ranked = [...actionable].sort((a, b) => {
    const technical = Number(demoted.has(a)) - Number(demoted.has(b));
    if (technical !== 0) return technical;
    return byUrgency(a, b);
  });

  // Ils ne disparaissent pas pour autant : les taire ferait disparaître un
  // défaut réel du rapport.
  const technical = pending
    .filter((f) => isTechnicalConstat(f))
    .sort(byUrgency)
    .map((f) => ({ id: f.id, title: f.title }));

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
  const parts: string[] = [];

  // La régression parle en premier. Le geste prévu vient après, sans être
  // annulé pour autant : on répare, puis on continue d'avancer.
  if (alert) parts.push(rollbackSentence(alert));
  parts.push(...learningSentences(proven, ineffective));

  parts.push(
    alert
      ? `Ensuite, nous reprendrions par « ${now.title} ».`
      : `Si cette boutique était la nôtre, nous commencerions par « ${now.title} ».`,
  );
  if (now.reason) parts.push(now.reason);
  if (now.unlocks.length > 0) {
    parts.push(
      now.unlocks.length === 1
        ? `Le corriger fait tomber ${enumerate(now.unlocks)} du même coup.`
        : `Le corriger fait tomber ${enumerate(now.unlocks)} du même coup — ${now.unlocks.length} problèmes réglés en une fois.`,
    );
  }
  // Pourquoi cette action-là et pas une redite : la mémoire l'explique.
  if (now.historyNote) parts.push(now.historyNote);

  // Pourquoi PAS le constat technique, alors qu'il est peut-être plus visible.
  // Le dire vaut mieux que de le laisser disparaître en bas de liste : le
  // marchand qui voit son site lent doit comprendre qu'on ne l'ignore pas, on
  // le classe.
  if (demoted.size > 0) {
    const names = enumerate([...demoted].slice(0, 2).map((f) => f.title));
    parts.push(
      demoted.size === 1
        ? `${names} est un constat technique réel, mais rien ne mesure encore ce qu'il coûte : nous ne le faisons pas passer devant une perte chiffrée.`
        : `${names} et ${demoted.size - 2 > 0 ? `${demoted.size - 2} autre(s) constat(s) technique(s)` : "l'autre constat technique"} sont réels, mais rien ne mesure encore ce qu'ils coûtent : ils ne passent pas devant une perte chiffrée.`,
    );
  }
  // TUTOIEMENT RÉSIDUEL, PASSÉ SOUS LES DEUX CONTRÔLES. « Compte » n'était pas
  // dans la liste des impératifs surveillés, et « regarde » se trouvait en
  // milieu de phrase, là où la recherche en tête de phrase ne va pas. Ces deux
  // lignes tutoyaient donc au beau milieu d'un briefing qui vouvoie partout
  // ailleurs — dans la phrase la plus lue du produit, celle qui dit quoi faire.
  if (now.timeMinutes) parts.push(`Comptez ${formatMinutes(now.timeMinutes)}.`);
  parts.push(`Ensuite, regardez ${now.measure} : c'est ça qui dira si ça a marché.`);
  if (unknowns.length > 0) {
    parts.push(
      unknowns.length === 1
        ? `Une réserve : sur ${enumerate([unknowns[0].title])}, nous n'avons pas la donnée pour trancher. Vérifiez avant d'y mettre du budget.`
        : `Une réserve : sur ${unknowns.length} points, nous n'avons pas la donnée pour trancher. Vérifiez-les avant d'y mettre du budget.`,
    );
  }

  return {
    alert,
    now,
    then,
    blocked,
    unknowns,
    technical,
    proven,
    ineffective,
    rationale: parts.join(" "),
  };
}

/** Ce qu'on dit d'une correction qui a fait reculer la boutique. */
function rollbackSentence(alert: RollbackAlert): string {
  const constat = alert.headline
    ? `Avant tout : « ${alert.title} » a dégradé la situation. ${alert.headline}`
    : `Avant tout : « ${alert.title} » a dégradé la situation.`;
  return alert.automatic
    ? `${constat} Annulez cette correction — un bouton suffit, l'état d'avant est connu.`
    : `${constat} Revenez en arrière à la main dans votre compte : cette correction ne s'annule pas toute seule.`;
}

/**
 * APPRENDRE : ce que les mesures ont enseigné.
 *
 * Deux enseignements de nature différente. Une correction confirmée dit quel
 * levier fonctionne sur CETTE boutique. Une correction sans effet dit que le
 * diagnostic s'est trompé de cause — et c'est une information plus utile
 * qu'elle n'en a l'air, parce qu'elle empêche de creuser au même endroit.
 */
function learningSentences(
  proven: Array<{ title: string }>,
  ineffective: Array<{ title: string }>,
): string[] {
  const parts: string[] = [];
  if (proven.length > 0) {
    parts.push(
      proven.length === 1
        ? `${enumerate([proven[0].title])} a bien produit son effet : c'est prouvé, on garde.`
        : `${proven.length} corrections ont produit leur effet, dont ${enumerate([proven[0].title])} : c'est prouvé, on garde.`,
    );
  }
  if (ineffective.length > 0) {
    parts.push(
      ineffective.length === 1
        ? `En revanche ${enumerate([ineffective[0].title])} n'a rien changé — ce n'était pas le vrai blocage, inutile d'y revenir.`
        : `En revanche ${ineffective.length} corrections n'ont rien changé, dont ${enumerate([ineffective[0].title])} — ce n'étaient pas les vrais blocages, inutile d'y revenir.`,
    );
  }
  return parts;
}
