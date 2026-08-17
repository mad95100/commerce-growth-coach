/**
 * CORRIGER → MESURER → PROUVER. Le verdict d'une correction appliquée.
 *
 * POURQUOI CE MODULE REMPLACE `judgeOutcome`. L'ancien jugement avait trois
 * défauts, chacun capable de faire annuler une correction qui marchait :
 *
 * 1. **Il ignorait la dilution.** Toutes les métriques sont des cumuls
 *    glissants sur 30 jours. Trois jours après la correction, 27 des 30 jours
 *    mesurés lui sont ANTÉRIEURS : un vrai +30 % n'apparaît que comme +3 %.
 *    L'ancien seuil déclarait « gains absents » en dessous de +3 %. Il
 *    condamnait donc systématiquement les corrections récentes qui marchaient.
 *
 * 2. **Il regardait les mêmes métriques pour tout.** Le CA, le ROAS, le taux de
 *    conversion Google, le CTR Meta — quelle que soit la correction. Or une
 *    réécriture de fiche produit ne se juge pas au ROAS, et une mise en pause
 *    d'ensemble de publicités améliore MÉCANIQUEMENT le ROAS tout en tuant le
 *    volume. Jugée au ROAS seul, la pire décision passait pour un succès.
 *
 * 3. **Il n'avait pas de garde-fou.** Rien ne détectait qu'un indicateur monte
 *    au prix de l'effondrement d'un autre.
 *
 * Ce module corrige les trois : métriques choisies selon CE QUI A ÉTÉ CORRIGÉ,
 * dilution compensée, métriques de garde qui peuvent renverser le verdict à
 * elles seules, et une recommandation d'annulation quand c'est justifié ET
 * techniquement possible.
 *
 * Il ne conclut jamais trop tôt : tant que la fenêtre n'est pas assez couverte,
 * le verdict est « mesure en cours ». Un verdict prématuré est pire qu'une
 * absence de verdict — il fait défaire ce qui commençait à produire son effet.
 *
 * Module PUR : aucune entrée-sortie, aucun accès réseau.
 */

import { METRIC_WINDOW_DAYS, type MetricDelta } from "@/lib/metrics";

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

export const VERDICTS = ["en_cours", "confirme", "insuffisant", "nul", "regression"] as const;

export type Verdict = (typeof VERDICTS)[number];

export const VERDICT_EMOJI: Record<Verdict, string> = {
  en_cours: "⏳",
  confirme: "✅",
  insuffisant: "⚠️",
  nul: "❌",
  regression: "🔴",
};

export const VERDICT_LABELS: Record<Verdict, string> = {
  en_cours: "Mesure en cours",
  confirme: "Amélioration confirmée",
  insuffisant: "Impact insuffisant",
  nul: "Aucun impact",
  regression: "Régression",
};

/**
 * Correspondance avec l'énumération `tracking_status` déjà en base.
 *
 * Les cinq verdicts n'y tiennent pas : l'énumération en compte quatre, et lui
 * ajouter une valeur demande un `ALTER TYPE` que `supabase db push` exécute
 * dans une transaction — ce que PostgreSQL refuse. Le verdict complet est donc
 * écrit dans une colonne texte à part, et l'ancienne colonne continue d'être
 * renseignée pour ne rien casser de ce qui la lit.
 */
export const LEGACY_STATUS: Record<
  Verdict,
  "measuring" | "on_track" | "underperforming" | "regressed"
> = {
  en_cours: "measuring",
  confirme: "on_track",
  insuffisant: "underperforming",
  nul: "underperforming",
  regression: "regressed",
};

// ---------------------------------------------------------------------------
// Quelles métriques regarder, selon ce qui a été corrigé
// ---------------------------------------------------------------------------

/**
 * `drivers` : ce que la correction est censée améliorer.
 * `guards`  : ce qu'elle ne doit surtout pas dégrader.
 *
 * La distinction porte tout le module. Un indicateur qui monte pendant qu'un
 * autre s'effondre n'est pas un succès, et c'est le cas le plus fréquent en
 * publicité : couper la moitié des ensembles fait monter le ROAS et disparaître
 * le chiffre d'affaires.
 */
export type MetricRoles = { drivers: string[]; guards: string[] };

/**
 * Par outil d'exécution — le plus précis, donc prioritaire.
 *
 * Chaque entrée encode un piège connu :
 * - `create_discount_code` fait MÉCANIQUEMENT baisser le panier moyen. Le
 *   surveiller sans le compter comme un échec attendu.
 * - `meta_pause_adset` et `google_pause_campaign` améliorent mécaniquement les
 *   ratios en supprimant du volume. Le volume est donc la garde.
 * - Les changements de budget se jugent au volume obtenu, la dépense étant la
 *   garde : dépenser deux fois plus pour deux fois plus d'achats n'est pas un
 *   progrès.
 */
export const ROLES_BY_TOOL: Record<string, MetricRoles> = {
  update_product: { drivers: ["orders_30d", "revenue_30d"], guards: ["aov"] },
  create_discount_code: { drivers: ["orders_30d", "revenue_30d"], guards: ["aov"] },
  meta_update_budget: { drivers: ["meta_purchases", "meta_roas"], guards: ["meta_spend"] },
  meta_pause_adset: { drivers: ["meta_roas"], guards: ["meta_purchases", "revenue_30d"] },
  meta_update_targeting: { drivers: ["meta_roas", "meta_ctr"], guards: ["meta_purchases"] },
  meta_update_creative: { drivers: ["meta_ctr", "meta_roas"], guards: ["meta_purchases"] },
  google_update_budget: { drivers: ["google_conversions"], guards: ["google_cost"] },
  google_pause_campaign: {
    drivers: ["google_conv_rate"],
    guards: ["google_conversions", "revenue_30d"],
  },
  google_add_negative_keywords: {
    drivers: ["google_conv_rate", "google_ctr"],
    guards: ["google_conversions"],
  },
  google_update_rsa: {
    drivers: ["google_ctr", "google_conv_rate"],
    guards: ["google_conversions"],
  },
};

/** Par domaine du problème corrigé — le repli quand aucun outil n'est connu. */
export const ROLES_BY_CATEGORY: Record<string, MetricRoles> = {
  offre: { drivers: ["orders_30d", "aov"], guards: ["revenue_30d"] },
  produit: { drivers: ["orders_30d", "revenue_30d"], guards: ["aov"] },
  boutique: { drivers: ["orders_30d", "revenue_30d"], guards: [] },
  conversion: { drivers: ["orders_30d", "revenue_30d"], guards: ["aov"] },
  acquisition: {
    drivers: ["meta_roas", "google_conv_rate", "meta_purchases", "google_conversions"],
    guards: ["revenue_30d", "meta_spend", "google_cost"],
  },
  retention: { drivers: ["orders_30d", "revenue_30d"], guards: [] },
  rentabilite: { drivers: ["aov", "revenue_30d"], guards: ["meta_spend", "google_cost"] },
  operations: { drivers: ["orders_30d"], guards: ["revenue_30d"] },
};

/** Dernier repli : la correction touche au commerce, on regarde le commerce. */
export const DEFAULT_ROLES: MetricRoles = {
  drivers: ["revenue_30d", "orders_30d"],
  guards: ["aov"],
};

/** L'outil l'emporte sur le domaine, le domaine sur le repli. */
export function rolesFor(input: { tool?: string | null; category?: string | null }): MetricRoles {
  if (input.tool && ROLES_BY_TOOL[input.tool]) return ROLES_BY_TOOL[input.tool];
  if (input.category && ROLES_BY_CATEGORY[input.category]) return ROLES_BY_CATEGORY[input.category];
  return DEFAULT_ROLES;
}

// ---------------------------------------------------------------------------
// Seuils
// ---------------------------------------------------------------------------

/**
 * Part minimale de la fenêtre qui doit être postérieure à la correction.
 *
 * En deçà, l'extrapolation amplifierait le bruit autant que le signal : à un
 * jour sur trente, une variation de 1 % due au hasard deviendrait 30 %. Un
 * quart de la fenêtre, soit une semaine et demie sur trente jours, est le
 * minimum où l'extrapolation dit quelque chose.
 */
export const MIN_COVERAGE = 0.25;

/** En deçà, l'écart n'est pas distinguable du bruit hebdomadaire ordinaire. */
export const NOISE_PCT = 5;

/** Au-delà, l'amélioration est réelle et vaut d'être annoncée comme telle. */
export const CONFIRM_PCT = 10;

/** Chute d'une métrique de garde qui renverse le verdict à elle seule. */
export const GUARD_REGRESSION_PCT = 10;

/**
 * Volume minimal en dessous duquel aucun pourcentage ne veut rien dire.
 *
 * LE DÉFAUT QUE CELA CORRIGE. Sur une boutique à deux commandes par mois, un
 * chiffre d'affaires qui passe de 180 à 190 € fait +5,6 % — assez pour franchir
 * le seuil de bruit et se voir attribuer un verdict. Or ces dix euros sont une
 * commande un peu plus chère, pas l'effet d'une correction. Le pourcentage est
 * une illusion d'optique produite par un dénominateur minuscule.
 *
 * Dix commandes sur trente jours est le plancher en dessous duquel on
 * s'abstient. Ce n'est pas un test statistique — il en faudrait un vrai — mais
 * c'est la barrière qui empêche de faire passer du hasard pour un résultat.
 *
 * EXCEPTION, et elle compte : le passage par zéro. Une boutique qui vend pour
 * la première fois n'a pas « varié de x % », elle a changé d'état. C'est
 * précisément l'événement que le produit existe pour provoquer, et il ne doit
 * pas être écarté au motif que trois commandes font un petit échantillon.
 */
export const MIN_ORDERS_FOR_VERDICT = 10;

// ---------------------------------------------------------------------------
// Entrées et sorties
// ---------------------------------------------------------------------------

export type MeasureInput = {
  /** Écarts calculés par `computeDeltas`. */
  deltas: MetricDelta[];
  /** Horodatage de l'application de la correction. */
  appliedAt: string;
  /** Domaine du problème corrigé. */
  category?: string | null;
  /** Outil d'exécution, quand la correction est passée par une action automatique. */
  tool?: string | null;
  /** L'action peut-elle être annulée automatiquement ? */
  revertible?: boolean;
  /** Instant de la mesure. Injecté pour rendre le jugement reproductible. */
  now?: number;
};

export type JudgedMetric = {
  key: string;
  label: string;
  role: "driver" | "guard";
  format: MetricDelta["format"];
  currency: string | null;
  before: number | null;
  after: number | null;
  /** Écart brut constaté sur la fenêtre glissante. */
  change_pct: number;
  /**
   * Écart ramené à ce qu'il serait si toute la fenêtre était postérieure à la
   * correction. C'est lui qu'on compare aux seuils.
   */
  effect_pct: number;
  /** Écart signé « en faveur du marchand » : une dépense qui baisse est positive. */
  gain_pct: number;
};

export type RollbackAdvice = {
  /** Faut-il revenir en arrière ? */
  recommended: boolean;
  /** Est-ce techniquement faisable sans intervention manuelle ? */
  possible: boolean;
  reason: string;
};

export type MeasureOutcome = {
  verdict: Verdict;
  emoji: string;
  label: string;
  /** Jours écoulés depuis la correction. */
  days: number;
  /** Part de la fenêtre postérieure à la correction, entre 0 et 1. */
  coverage: number;
  drivers: JudgedMetric[];
  guards: JudgedMetric[];
  /** Une phrase, celle qu'on lit en premier. */
  headline: string;
  /** Le raisonnement complet, chiffres à l'appui. */
  explanation: string;
  rollback: RollbackAdvice;
  /** Valeur à écrire dans l'ancienne colonne `status`. */
  legacyStatus: (typeof LEGACY_STATUS)[Verdict];
};

// ---------------------------------------------------------------------------
// Ce qui accompagne obligatoirement un verdict à l'écran
// ---------------------------------------------------------------------------

/**
 * Sur quoi repose ce verdict, en une ligne lisible.
 *
 * LE DÉFAUT QUE CELA CORRIGE. Le moteur calcule depuis toujours la durée écoulée
 * et la part de la fenêtre réellement postérieure à la correction — et l'écran de
 * suivi affichait le verdict seul. Un « ✅ Impact confirmé » posé sur cinq jours
 * de recul se lit exactement comme un verdict posé sur trente : le marchand n'a
 * aucun moyen de faire la différence, alors que la première conclusion est
 * fragile et la seconde établie.
 *
 * Un verdict sans sa période, sa couverture et son échantillon n'est pas un
 * verdict : c'est une affirmation.
 */
export type VerdictBasis = {
  /** Jours écoulés depuis la correction, arrondis. */
  days: number;
  /** Part de la fenêtre postérieure à la correction, en pourcentage entier. */
  coveragePct: number;
  /** Longueur de la fenêtre glissante, en jours. */
  windowDays: number;
  /** « 8 jours de recul · 27 % de la fenêtre mesure la correction ». */
  summary: string;
  /**
   * Ce que cette couverture interdit de conclure. `null` quand la fenêtre est
   * entièrement postérieure à la correction : il n'y a alors rien à nuancer.
   */
  caveat: string | null;
};

export function verdictBasis(input: {
  days: number | null | undefined;
  coverage: number | null | undefined;
}): VerdictBasis | null {
  // Sans ces deux chiffres, on ne sait pas sur quoi repose le verdict — et on ne
  // fabrique pas une certitude pour remplir la ligne. `Number(null)` valant 0,
  // l'absence doit être écartée AVANT toute conversion : sans cela, un suivi
  // jamais mesuré afficherait « 0 jour de recul » comme s'il l'avait été.
  if (input.days == null || input.coverage == null) return null;
  const days = Number(input.days);
  const coverage = Number(input.coverage);
  if (!Number.isFinite(days) || !Number.isFinite(coverage)) return null;

  const bounded = Math.min(1, Math.max(0, coverage));
  const coveragePct = Math.round(bounded * 100);
  const rounded = Math.max(0, Math.round(days));

  const summary = `${rounded} jour${rounded > 1 ? "s" : ""} de recul · ${coveragePct} % de la fenêtre de ${METRIC_WINDOW_DAYS} jours mesure la correction`;

  let caveat: string | null = null;
  if (bounded < MIN_COVERAGE) {
    const remaining = Math.max(1, Math.ceil(METRIC_WINDOW_DAYS * MIN_COVERAGE - rounded));
    caveat = `Trop tôt pour conclure : l'essentiel de ce qui est mesuré est encore antérieur à la correction. Reviens dans ${remaining} jour(s).`;
  } else if (bounded < 1) {
    caveat = `Les ${100 - coveragePct} % restants de la fenêtre décrivent encore la période d'avant : l'écart affiché est ramené à fenêtre pleine, pas constaté tel quel.`;
  }

  return { days: rounded, coveragePct, windowDays: METRIC_WINDOW_DAYS, summary, caveat };
}

// ---------------------------------------------------------------------------
// Jugement
// ---------------------------------------------------------------------------

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function signed(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${round(pct)} %`;
}

function judge(
  delta: MetricDelta,
  role: "driver" | "guard",
  coverage: number,
): JudgedMetric | null {
  if (delta.change_pct == null || !Number.isFinite(delta.change_pct)) return null;
  const effect = delta.change_pct / coverage;
  return {
    key: delta.key,
    label: delta.label,
    role,
    format: delta.format,
    currency: delta.currency,
    before: delta.before,
    after: delta.after,
    change_pct: round(delta.change_pct, 2),
    effect_pct: round(effect, 2),
    gain_pct: round(delta.higher_is_better ? effect : -effect, 2),
  };
}

/**
 * Rend le verdict d'une correction.
 *
 * La décision se lit dans cet ordre, et le premier cas qui s'applique gagne :
 *
 * 1. Fenêtre trop peu couverte, ou aucune métrique exploitable → mesure en cours.
 * 2. Une métrique de garde s'effondre → régression, quoi que disent les autres.
 * 3. Le meilleur moteur recule au-delà du bruit → régression.
 * 4. Les moteurs se contredisent → insuffisant, mention « signaux contradictoires ».
 * 5. Le meilleur moteur dépasse le seuil de confirmation → amélioration confirmée.
 * 6. Il bouge, mais dans le bruit → aucun impact.
 * 7. Entre les deux → impact insuffisant.
 */
export function measureOutcome(input: MeasureInput): MeasureOutcome {
  const now = input.now ?? Date.now();
  const appliedAt = new Date(input.appliedAt).getTime();
  const days = Number.isFinite(appliedAt) ? Math.max(0, (now - appliedAt) / 86_400_000) : 0;
  const coverage = Math.min(1, days / METRIC_WINDOW_DAYS);

  const roles = rolesFor(input);
  const byKey = new Map(input.deltas.map((d) => [d.key, d]));

  const pick = (keys: string[], role: "driver" | "guard"): JudgedMetric[] =>
    keys
      .map((key) => byKey.get(key))
      .filter((d): d is MetricDelta => Boolean(d))
      .map((d) => judge(d, role, Math.max(coverage, MIN_COVERAGE)))
      .filter((m): m is JudgedMetric => Boolean(m));

  const drivers = pick(roles.drivers, "driver");
  const guards = pick(roles.guards, "guard");

  // Volume observé, quand il est connu. Sert uniquement à savoir si un
  // pourcentage a un sens, jamais à juger la correction elle-même.
  const orders = input.deltas.find((d) => d.key === "orders_30d");
  const volume = Math.max(orders?.before ?? 0, orders?.after ?? 0);
  const crossedZero = drivers.some((m) => m.before === 0 && (m.after ?? 0) > 0);
  const tooFewObservations =
    orders !== undefined && volume < MIN_ORDERS_FOR_VERDICT && !crossedZero;

  const rollbackImpossible = (verdict: Verdict): RollbackAdvice => ({
    recommended: false,
    possible: input.revertible === true,
    reason:
      verdict === "en_cours"
        ? "Trop tôt pour décider quoi que ce soit."
        : "La correction n'a pas dégradé la situation : rien à annuler.",
  });

  // --- 1. Trop tôt, rien à mesurer, ou pas assez de volume -----------------
  if (coverage < MIN_COVERAGE || drivers.length === 0 || tooFewObservations) {
    const missing = drivers.length === 0;
    const remaining = Math.max(0, Math.ceil(METRIC_WINDOW_DAYS * MIN_COVERAGE - days));
    return {
      verdict: "en_cours",
      emoji: VERDICT_EMOJI.en_cours,
      label: VERDICT_LABELS.en_cours,
      days: round(days),
      coverage: round(coverage, 3),
      drivers,
      guards,
      headline: missing
        ? "Pas encore de quoi mesurer cette correction."
        : tooFewObservations
          ? `Trop peu de commandes pour conclure (${Math.round(volume)} sur ${METRIC_WINDOW_DAYS} jours).`
          : `Mesure en cours — verdict dans ${remaining} jour${remaining > 1 ? "s" : ""}.`,
      explanation: missing
        ? "Aucun des indicateurs qui devraient bouger n'est disponible pour l'instant. Vérifie que le canal concerné est bien connecté : sans lui, l'effet de cette correction ne peut pas être prouvé."
        : tooFewObservations
          ? `Avec ${Math.round(volume)} commande(s) sur ${METRIC_WINDOW_DAYS} jours, un écart en pourcentage ne veut rien dire : une commande de plus ou de moins suffit à le faire basculer. Il faut au moins ${MIN_ORDERS_FOR_VERDICT} commandes pour qu'un verdict soit autre chose qu'une illusion d'optique. Nous préférons vous dire que nous ne savons pas.`
          : `Les indicateurs sont des cumuls sur ${METRIC_WINDOW_DAYS} jours. ${round(days)} jour(s) après la correction, seuls ${Math.round(coverage * 100)} % de ce qui est mesuré lui sont postérieurs — trop peu pour conclure sans risquer de défaire ce qui commence à marcher.`,
      rollback: rollbackImpossible("en_cours"),
      legacyStatus: LEGACY_STATUS.en_cours,
    };
  }

  const best = drivers.reduce((b, m) => (m.gain_pct > b.gain_pct ? m : b));
  const worstGuard =
    guards.length > 0 ? guards.reduce((w, m) => (m.gain_pct < w.gain_pct ? m : w)) : null;

  const common = {
    days: round(days),
    coverage: round(coverage, 3),
    drivers,
    guards,
  };
  const context = `Mesuré ${round(days)} jours après la correction, sur des cumuls de ${METRIC_WINDOW_DAYS} jours dont ${Math.round(coverage * 100)} % lui sont postérieurs — les écarts ci-dessous sont ramenés à fenêtre pleine.`;

  // --- 2. Une garde s'effondre ---------------------------------------------
  if (worstGuard && worstGuard.gain_pct <= -GUARD_REGRESSION_PCT) {
    return {
      ...common,
      verdict: "regression",
      emoji: VERDICT_EMOJI.regression,
      label: VERDICT_LABELS.regression,
      headline: `${worstGuard.label} s'est dégradé de ${signed(worstGuard.effect_pct)} depuis la correction.`,
      explanation: `${context} ${best.label} a bien bougé de ${signed(best.effect_pct)}, mais ${worstGuard.label} a chuté de ${signed(worstGuard.effect_pct)}. Une amélioration obtenue au prix d'un effondrement ailleurs n'est pas une amélioration — c'est le déplacement du problème.`,
      rollback: {
        recommended: true,
        possible: input.revertible === true,
        reason:
          input.revertible === true
            ? `Annule cette correction : ${worstGuard.label} ne se rétablira pas tout seul.`
            : `Cette correction n'est pas annulable automatiquement. Revenez en arrière à la main dans votre compte, en surveillant ${worstGuard.label}.`,
      },
      legacyStatus: LEGACY_STATUS.regression,
    };
  }

  // --- 3. Le moteur principal recule ---------------------------------------
  if (best.gain_pct <= -NOISE_PCT) {
    return {
      ...common,
      verdict: "regression",
      emoji: VERDICT_EMOJI.regression,
      label: VERDICT_LABELS.regression,
      headline: `${best.label} a reculé de ${signed(best.effect_pct)} depuis la correction.`,
      explanation: `${context} Aucun des indicateurs visés n'a progressé, et le meilleur d'entre eux recule. La correction a produit l'effet inverse de celui attendu.`,
      rollback: {
        recommended: true,
        possible: input.revertible === true,
        reason:
          input.revertible === true
            ? "Annule cette correction, puis relance un diagnostic : la cause identifiée n'était pas la bonne."
            : "Cette correction n'est pas annulable automatiquement. Reviens en arrière à la main, puis relance un diagnostic.",
      },
      legacyStatus: LEGACY_STATUS.regression,
    };
  }

  // --- 4. Les moteurs se contredisent --------------------------------------
  const rising = drivers.filter((m) => m.gain_pct >= NOISE_PCT);
  const falling = drivers.filter((m) => m.gain_pct <= -NOISE_PCT);
  if (rising.length > 0 && falling.length > 0) {
    return {
      ...common,
      verdict: "insuffisant",
      emoji: VERDICT_EMOJI.insuffisant,
      label: VERDICT_LABELS.insuffisant,
      headline: `Signaux contradictoires : ${rising[0].label} monte, ${falling[0].label} descend.`,
      explanation: `${context} ${rising[0].label} progresse de ${signed(rising[0].effect_pct)} pendant que ${falling[0].label} recule de ${signed(falling[0].effect_pct)}. On ne peut pas conclure : soit la correction déplace la demande sans la créer, soit un autre changement intervenu au même moment brouille la mesure. Attends une semaine de plus avant de trancher.`,
      rollback: {
        recommended: false,
        possible: input.revertible === true,
        reason: "Rien ne justifie d'annuler tant que la lecture n'est pas claire.",
      },
      legacyStatus: LEGACY_STATUS.insuffisant,
    };
  }

  // --- 5. Amélioration confirmée -------------------------------------------
  if (best.gain_pct >= CONFIRM_PCT) {
    const guardNote =
      worstGuard && worstGuard.gain_pct <= -NOISE_PCT
        ? ` À surveiller tout de même : ${worstGuard.label} a bougé de ${signed(worstGuard.effect_pct)}.`
        : "";
    return {
      ...common,
      verdict: "confirme",
      emoji: VERDICT_EMOJI.confirme,
      label: VERDICT_LABELS.confirme,
      headline: `${best.label} : ${signed(best.effect_pct)} depuis la correction.`,
      explanation: `${context} ${best.label} progresse de ${signed(best.effect_pct)}, au-delà du bruit habituel. La correction a produit son effet — garde-la.${guardNote}`,
      rollback: rollbackImpossible("confirme"),
      legacyStatus: LEGACY_STATUS.confirme,
    };
  }

  // --- 6. Rien n'a bougé ----------------------------------------------------
  if (Math.abs(best.gain_pct) < NOISE_PCT) {
    return {
      ...common,
      verdict: "nul",
      emoji: VERDICT_EMOJI.nul,
      label: VERDICT_LABELS.nul,
      headline: `${best.label} n'a pas bougé (${signed(best.effect_pct)}).`,
      explanation: `${context} L'écart reste dans le bruit ordinaire. La correction n'a rien cassé, mais elle n'a rien produit non plus : ce n'était pas le vrai blocage. Relance un diagnostic pour chercher ailleurs.`,
      rollback: {
        recommended: false,
        possible: input.revertible === true,
        reason:
          "Inutile d'annuler : la correction ne nuit pas. Ce qu'il faut, c'est chercher la vraie cause.",
      },
      legacyStatus: LEGACY_STATUS.nul,
    };
  }

  // --- 7. Réel, mais trop petit --------------------------------------------
  return {
    ...common,
    verdict: "insuffisant",
    emoji: VERDICT_EMOJI.insuffisant,
    label: VERDICT_LABELS.insuffisant,
    headline: `${best.label} progresse un peu (${signed(best.effect_pct)}), pas assez pour conclure.`,
    explanation: `${context} L'écart va dans le bon sens mais reste sous le seuil à partir duquel on peut l'attribuer à la correction plutôt qu'au hasard. Laisse tourner : si l'effet est réel, il se confirmera en s'installant sur la fenêtre.`,
    rollback: {
      recommended: false,
      possible: input.revertible === true,
      reason: "Rien à annuler : la tendance est bonne, seulement trop faible pour être prouvée.",
    },
    legacyStatus: LEGACY_STATUS.insuffisant,
  };
}
