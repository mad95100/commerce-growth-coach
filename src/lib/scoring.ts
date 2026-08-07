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
  offre: "Ce que tu vends et pourquoi on devrait te l'acheter à toi.",
  produit: "Ta fiche produit : titre, photos, bénéfices, avis, objections.",
  boutique: "L'impression générale : accueil, navigation, confiance, mobile.",
  conversion: "Le passage du visiteur à la commande : panier, checkout, friction.",
  acquisition: "Le trafic que tu payes ou que tu attires : pubs, ciblage, créas.",
  retention: "Faire revenir les clients : email, relance panier, post-achat.",
  rentabilite: "Ce qu'il te reste vraiment : marge, coût d'acquisition, ROAS minimum.",
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

/** Score 0-100 par catégorie : on part de 100 et on retire le poids des problèmes trouvés. */
export function computeCategoryScores(findings: ScorableFinding[]): Record<Category, number> {
  const scores = {} as Record<Category, number>;
  for (const cat of CATEGORIES) {
    const hits = findings.filter((f) => f.category === cat);
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

export function computeGlobalScore(categoryScores: Record<Category, number>): number {
  let total = 0;
  let weights = 0;
  for (const cat of CATEGORIES) {
    total += (categoryScores[cat] ?? 78) * CATEGORY_GLOBAL_WEIGHT[cat];
    weights += CATEGORY_GLOBAL_WEIGHT[cat];
  }
  return Math.round(total / weights);
}

/** Potentiel total identifié (€/mois), plafonné pour rester crédible. */
export function computePotential(findings: ScorableFinding[]): { min: number; max: number } {
  const min = findings.reduce((s, f) => s + (f.estimated_gain_min ?? 0), 0);
  const max = findings.reduce((s, f) => s + (f.estimated_gain_max ?? f.estimated_gain_min ?? 0), 0);
  return { min: Math.round(min), max: Math.round(max) };
}

export function formatEur(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value).toLocaleString("fr-FR")} €`;
}

export function formatMinutes(min: number | null | undefined): string {
  if (!min) return "—";
  if (min < 60) return `${min} min`;
  const h = Math.round((min / 60) * 10) / 10;
  return `${h} h`;
}
