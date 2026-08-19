/**
 * Moteur de scoring et de priorisation — 100 % déterministe, côté serveur ET client.
 * L'IA détecte les problèmes ; c'est ce fichier qui décide de la note et de l'ordre.
 */

export const CATEGORIES = [
  "offre",
  "produit",
  "boutique",
  "conversion",
  "acquisition",
  "retention",
  "rentabilite",
  "operations",
] as const;

export type Category = (typeof CATEGORIES)[number];
export type Severity = "critical" | "high" | "medium" | "low";
export type Confidence = "low" | "medium" | "high";

export const CATEGORY_LABELS: Record<Category, string> = {
  offre: "Offre",
  produit: "Produit",
  boutique: "Boutique",
  conversion: "Conversion",
  acquisition: "Acquisition",
  retention: "Rétention",
  rentabilite: "Rentabilité",
  operations: "Opérations",
};

export const CATEGORY_HINTS: Record<Category, string> = {
  offre: "Ce que vous vendez, et pourquoi on devrait vous l'acheter à vous.",
  produit: "Votre fiche produit : titre, photos, bénéfices, avis, objections.",
  boutique: "L'impression générale : accueil, navigation, confiance, mobile.",
  conversion: "Le passage du visiteur à la commande : panier, checkout, friction.",
  acquisition: "Le trafic que vous payez ou que vous attirez : publicités, ciblage, visuels.",
  retention: "Faire revenir les clients : email, relance panier, post-achat.",
  rentabilite: "Ce qu'il vous reste vraiment : marge, coût d'acquisition, ROAS minimum.",
  operations: "Livraison, retours, service client, suivi.",
};

const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 30,
  high: 18,
  medium: 9,
  low: 4,
};

const CONFIDENCE_WEIGHT: Record<Confidence, number> = {
  high: 1,
  medium: 0.7,
  low: 0.4,
};

const URGENCY_WEIGHT: Record<string, number> = {
  today: 1.3,
  this_week: 1,
  this_month: 0.7,
};

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: "Élevée",
  medium: "Moyenne",
  low: "Faible",
};

export const DIFFICULTY_LABELS: Record<number, string> = {
  1: "Très facile",
  2: "Facile",
  3: "Moyen",
  4: "Difficile",
  5: "Expert",
};

export type ScorableFinding = {
  category: string;
  severity: string;
  timeframe: string;
  estimated_gain_min?: number | null;
  estimated_gain_max?: number | null;
  difficulty?: number | null;
  confidence?: string | null;
};

function severity(f: ScorableFinding): Severity {
  return (SEVERITY_WEIGHT as Record<string, number>)[f.severity] != null
    ? (f.severity as Severity)
    : "medium";
}

function confidence(f: ScorableFinding): Confidence {
  const c = f.confidence ?? "medium";
  return c === "high" || c === "low" ? c : "medium";
}

/**
 * PRIORITÉ = impact financier × confiance × urgence ÷ difficulté.
 * Renvoie un score arrondi, comparable entre findings d'un même audit.
 */
export function computePriority(f: ScorableFinding): number {
  const gain =
    ((f.estimated_gain_min ?? 0) + (f.estimated_gain_max ?? f.estimated_gain_min ?? 0)) / 2;
  const impact = gain > 0 ? gain : SEVERITY_WEIGHT[severity(f)] * 10;
  const difficulty = Math.min(5, Math.max(1, f.difficulty ?? 2));
  const urgency = URGENCY_WEIGHT[f.timeframe] ?? 1;
  return Math.round((impact * CONFIDENCE_WEIGHT[confidence(f)] * urgency) / difficulty);
}

/**
 * Score 0-100 par catégorie : on part de 100 et on retire le poids des
 * problèmes trouvés.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE DÉFAUT CORRIGÉ : « RIEN TROUVÉ » ET « RIEN REGARDÉ » DONNAIENT 78.
 *
 * Une catégorie sans constat recevait 78 — « prudent ». Mais deux situations
 * opposées y tombaient ensemble :
 *
 *   · la catégorie a été instruite et rien de fâcheux n'en est ressorti ;
 *   · aucune donnée ne permettait de l'instruire.
 *
 * Une boutique dont Shopify n'a pas répondu obtenait donc 78 partout, et un
 * score global honorable, calculé sur du vide. C'est très exactement la
 * fabrication d'un chiffre à partir d'une absence — ce que le reste du produit
 * s'interdit partout ailleurs.
 *
 * `examinees` nomme les catégories réellement instruites. Celles qui n'en sont
 * pas restent ABSENTES du relevé : pas de zéro, pas de 78, rien. Sans
 * argument, le comportement d'avant est conservé — un appelant qui ne sait pas
 * ce qui a été examiné ne doit pas voir son score disparaître.
 */
export function computeCategoryScores(
  findings: ScorableFinding[],
  examinees?: ReadonlySet<Category>,
): Partial<Record<Category, number>> {
  const scores: Partial<Record<Category, number>> = {};
  for (const cat of CATEGORIES) {
    const hits = findings.filter((f) => f.category === cat);
    if (hits.length === 0 && examinees && !examinees.has(cat)) continue;
    const penalty = hits.reduce(
      (s, f) => s + SEVERITY_WEIGHT[severity(f)] * CONFIDENCE_WEIGHT[confidence(f)],
      0,
    );
    // Sans problème détecté on reste prudent : 78, pas 100.
    scores[cat] = hits.length === 0 ? 78 : Math.max(5, Math.round(100 - penalty));
  }
  return scores;
}

/** Score global = moyenne pondérée des catégories qui pèsent le plus sur le CA. */
const CATEGORY_GLOBAL_WEIGHT: Record<Category, number> = {
  offre: 1.4,
  produit: 1.3,
  boutique: 1,
  conversion: 1.5,
  acquisition: 1.2,
  retention: 0.8,
  rentabilite: 1.2,
  operations: 0.6,
};

/**
 * Part du poids total qu'il faut avoir instruite pour qu'une note d'ensemble
 * veuille dire quelque chose.
 *
 * En dessous, la moyenne parle surtout de ce qu'on a réussi à regarder. Une
 * note calculée sur deux catégories mineures serait pire qu'aucune note : elle
 * aurait l'autorité d'un chiffre sans en avoir le fondement.
 */
export const COUVERTURE_MINIMALE = 0.5;

/**
 * Score global = moyenne pondérée des catégories instruites, ou `null`.
 *
 * `null` n'est pas un échec : c'est une réponse. Le rapport l'affiche « non
 * noté » et dit ce qui manque pour le calculer, au lieu de présenter un nombre
 * qui ne repose sur rien.
 */
export function computeGlobalScore(
  categoryScores: Partial<Record<Category, number>>,
): number | null {
  let total = 0;
  let instruit = 0;
  let poidsTotal = 0;
  for (const cat of CATEGORIES) {
    poidsTotal += CATEGORY_GLOBAL_WEIGHT[cat];
    const note = categoryScores[cat];
    if (note == null) continue;
    total += note * CATEGORY_GLOBAL_WEIGHT[cat];
    instruit += CATEGORY_GLOBAL_WEIGHT[cat];
  }
  if (instruit / poidsTotal < COUVERTURE_MINIMALE) return null;
  return Math.round(total / instruit);
}

/** Les catégories qu'aucune donnée n'a permis d'instruire. */
export function categoriesNonInstruites(
  categoryScores: Partial<Record<Category, number>>,
): Category[] {
  return CATEGORIES.filter((c) => categoryScores[c] == null);
}

/** Potentiel total identifié par mois, dans la devise de la boutique, plafonné pour rester crédible. */
export function computePotential(findings: ScorableFinding[]): { min: number; max: number } {
  const min = findings.reduce((s, f) => s + (f.estimated_gain_min ?? 0), 0);
  const max = findings.reduce((s, f) => s + (f.estimated_gain_max ?? f.estimated_gain_min ?? 0), 0);
  return { min: Math.round(min), max: Math.round(max) };
}

export function formatMinutes(min: number | null | undefined): string {
  if (!min) return "—";
  if (min < 60) return `${min} min`;
  const h = Math.round((min / 60) * 10) / 10;
  return `${h} h`;
}
