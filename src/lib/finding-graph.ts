/**
 * Chaîne causale, classement épistémique et priorité justifiée.
 *
 * POURQUOI CE MODULE. `scoring.ts` sait déjà calculer un nombre par problème.
 * Un nombre ne dit ni pourquoi ce problème passe devant un autre, ni sur quoi
 * la conclusion repose, ni ce qu'il faut corriger d'abord. Trois manques qui
 * transforment un directeur e-commerce en générateur de listes :
 *
 * 1. **La chaîne causale.** « Panier abandonné », « frais de port surprise » et
 *    « pas de mention des frais sur la fiche produit » ne sont pas trois
 *    problèmes : c'en est un, vu de trois endroits. Corriger le symptôme sans
 *    la cause ne produit rien, et le prochain audit reproduira la même liste.
 *
 * 2. **Le niveau de certitude.** Un chiffre relevé chez Shopify et une
 *    intuition sur le ciblage publicitaire ne s'annoncent pas de la même
 *    façon. Quatre niveaux, jamais mélangés : Fait, Déduction forte,
 *    Hypothèse, Donnée manquante.
 *
 * 3. **La justification.** Une priorité qu'on ne sait pas expliquer ne sera pas
 *    suivie. Chaque problème repart d'ici avec la phrase qui dit pourquoi il
 *    est là, construite à partir des mêmes entrées que le classement.
 *
 * RÈGLE CENTRALE, ET LA RAISON D'ÊTRE DU CLASSEMENT ÉPISTÉMIQUE : une
 * conclusion qui ne s'appuie sur rien ne peut pas être déclarée critique, quelle
 * que soit la confiance annoncée par le modèle. C'est la seule protection
 * mécanique contre une urgence inventée.
 *
 * Module PUR : aucune entrée-sortie, aucun secret, aucune dépendance réseau.
 * Il tourne côté serveur pendant l'audit comme côté navigateur pour l'affichage.
 */

import { computePriority, type ScorableFinding } from "@/lib/scoring";

// ---------------------------------------------------------------------------
// Niveaux de certitude
// ---------------------------------------------------------------------------

export const EPISTEMIC_LEVELS = [
  "fait",
  "deduction_forte",
  "hypothese",
  "donnee_manquante",
] as const;

export type EpistemicLevel = (typeof EPISTEMIC_LEVELS)[number];

export const EPISTEMIC_LABELS: Record<EpistemicLevel, string> = {
  fait: "Fait",
  deduction_forte: "Déduction forte",
  hypothese: "Hypothèse",
  donnee_manquante: "Donnée manquante",
};

/** Ce que chaque niveau autorise à dire, en une phrase, pour l'interface. */
export const EPISTEMIC_HINTS: Record<EpistemicLevel, string> = {
  fait: "Mesuré dans vos données. Vous pouvez agir dessus sans vérifier.",
  deduction_forte: "Déduit de vos données, avec des hypothèses annoncées. Très probable.",
  hypothese: "Piste plausible, non démontrée. À vérifier avant d'y mettre du budget.",
  donnee_manquante:
    "Il manque la donnée pour conclure. La première action est d'aller la chercher.",
};

// ---------------------------------------------------------------------------
// Bandes de priorité
// ---------------------------------------------------------------------------

export const PRIORITY_BANDS = ["critique", "important", "opportunite", "optimisation"] as const;

export type PriorityBand = (typeof PRIORITY_BANDS)[number];

export const BAND_LABELS: Record<PriorityBand, string> = {
  critique: "Critique",
  important: "Important",
  opportunite: "Opportunité",
  optimisation: "Optimisation",
};

export const BAND_EMOJI: Record<PriorityBand, string> = {
  critique: "🔴",
  important: "🟠",
  opportunite: "🟡",
  optimisation: "🟢",
};

/** Rang d'urgence : 0 = le plus urgent. Sert aux comparaisons et aux plafonds. */
export const BAND_RANK: Record<PriorityBand, number> = {
  critique: 0,
  important: 1,
  opportunite: 2,
  optimisation: 3,
};

export function formatBand(band: PriorityBand): string {
  return `${BAND_EMOJI[band]} ${BAND_LABELS[band]}`;
}

/**
 * Relit une bande venue de la base.
 *
 * Renvoie `null` sur tout ce qui n'est pas une bande connue, y compris `null` :
 * les problèmes analysés avant l'existence de ce module n'en portent pas, et
 * mieux vaut n'afficher aucune bande qu'en inventer une.
 */
export function toPriorityBand(value: unknown): PriorityBand | null {
  return PRIORITY_BANDS.includes(value as PriorityBand) ? (value as PriorityBand) : null;
}

/** Même prudence pour le niveau de certitude. */
export function toEpistemicLevel(value: unknown): EpistemicLevel | null {
  return EPISTEMIC_LEVELS.includes(value as EpistemicLevel) ? (value as EpistemicLevel) : null;
}

/** Garde la moins urgente des deux bandes. */
function capBand(band: PriorityBand, ceiling: PriorityBand): PriorityBand {
  return BAND_RANK[band] >= BAND_RANK[ceiling] ? band : ceiling;
}

// ---------------------------------------------------------------------------
// Entrées
// ---------------------------------------------------------------------------

export type Evidence = {
  based_on?: string | null;
  assumptions?: string | null;
} | null;

export type GraphFinding = ScorableFinding & {
  /** Identifiant court et stable, produit par le modèle. Reconstruit s'il manque. */
  key?: string | null;
  title?: string | null;
  /** Clés des problèmes qui CAUSENT celui-ci. L'ordre d'exécution en découle. */
  caused_by?: string[] | null;
  evidence?: Evidence;
};

// ---------------------------------------------------------------------------
// LA FRONTIÈRE TECHNIQUE : un constat n'est pas une perte
// ---------------------------------------------------------------------------

/**
 * Préfixe des observations qui ne décrivent QUE le document servi au visiteur.
 *
 * Elles disent qu'un serveur répond en 2 400 ms, qu'une page renvoie 404,
 * qu'aucune donnée structurée n'est déclarée. Ce sont des faits techniques.
 */
const TECHNICAL_PREFIX = "storefront.";

/**
 * Sources qui MESURENT le commerce : commandes, dépenses, clics, origine des
 * ventes. Citer l'une d'elles, ou un signal croisé, c'est faire le lien entre
 * un constat technique et une conséquence commerciale.
 */
const BUSINESS_PREFIXES = ["shopify.", "meta.", "google.", "organic.", "cross.", "declared."];

/**
 * Cette conclusion ne repose-t-elle QUE sur des constats techniques ?
 *
 * Vrai lorsque `based_on` cite au moins une observation du site public et
 * AUCUNE mesure commerciale. Faux dès qu'un chiffre d'affaires, un clic, une
 * commande ou un signal croisé est invoqué : le lien est alors explicitement
 * fait, et c'est ce lien qui autorise à parler d'argent.
 */
export function isTechnicalOnly(finding: GraphFinding): boolean {
  return isTechnicalOnlyEvidence(finding.evidence?.based_on);
}

/**
 * La même règle, lue sur la preuve brute.
 *
 * Exportée sous cette forme parce que `next-move.ts` a besoin du même verdict
 * sur des lignes venues de la base, où `evidence` est une colonne `jsonb` dont
 * on ne présume rien. Une seconde implémentation là-bas finirait par diverger
 * de celle-ci — et le jour où elles divergent, la règle ne veut plus rien dire.
 */
export function isTechnicalOnlyEvidence(basedOn: unknown): boolean {
  if (!hasSubstance(basedOn)) return false;
  const text = String(basedOn).toLowerCase();
  if (!text.includes(TECHNICAL_PREFIX)) return false;
  return !BUSINESS_PREFIXES.some((prefix) => text.includes(prefix));
}

/**
 * Plafond de priorité d'un constat purement technique.
 *
 * « Critique » veut dire « ce qui coûte le plus cher maintenant ». Une lenteur
 * dont l'effet commercial n'est pas mesuré ne peut pas prétendre à ce rang,
 * même si le constat est parfaitement exact — un fait technique certain n'est
 * pas pour autant un problème commercial démontré.
 */
export const TECHNICAL_BAND_CEILING: PriorityBand = "important";

export type FrontierResult<T> = {
  findings: T[];
  /** Conclusions dont le montant a été retiré faute de lien démontré. */
  stripped: number;
};

/**
 * LA BARRIÈRE MÉCANIQUE de la règle « un problème technique est un fait
 * technique ».
 *
 * POURQUOI ELLE EXISTE, alors que le prompt le dit déjà. Parce qu'un prompt
 * n'est pas une barrière — c'est la doctrine de tout ce dépôt. Deux chemins
 * mènent un constat technique à porter un montant :
 *
 * 1. Le modèle en invente un, comme il le fait pour tout champ obligatoire.
 * 2. `anchorGainsOnLeak` lui attribue le coût de la fuite mesurée, parce qu'il
 *    tombe dans le bon domaine. Une lenteur de serveur classée « conversion »
 *    héritait ainsi de « 3 000 € par mois à récupérer » sans que rien, nulle
 *    part, n'ait établi que la lenteur y était pour quelque chose.
 *
 * Le second est le plus dangereux : il est automatique, silencieux, et le
 * montant qu'il pose est vrai — c'est son ATTRIBUTION qui ne l'est pas.
 *
 * Cette fonction retire le montant et abaisse le plafond de priorité. Elle ne
 * supprime pas la conclusion : le constat technique reste dit, avec sa preuve.
 * Il perd seulement le droit de se présenter comme une perte chiffrée.
 */
export function applyTechnicalFrontier<
  T extends GraphFinding & {
    estimated_gain_min?: number | null;
    estimated_gain_max?: number | null;
  },
>(findings: T[]): FrontierResult<T> {
  let stripped = 0;

  const next = findings.map((finding) => {
    if (!isTechnicalOnly(finding)) return finding;
    const hadAmount =
      (finding.estimated_gain_min ?? 0) > 0 || (finding.estimated_gain_max ?? 0) > 0;
    if (hadAmount) stripped += 1;
    return { ...finding, estimated_gain_min: null, estimated_gain_max: null };
  });

  return { findings: next, stripped };
}

// ---------------------------------------------------------------------------
// Certitude : ce sur quoi la conclusion repose
// ---------------------------------------------------------------------------

/**
 * Formules qui remplissent un champ sans rien y mettre.
 *
 * Un modèle sollicité pour un champ obligatoire le remplit toujours. « aucune »,
 * « n/a », « — » sont des façons polies de dire vide, et les traiter comme du
 * contenu ferait passer une hypothèse pour un fait. Comparaison faite sans
 * accents ni ponctuation finale.
 */
const EMPTY_MARKERS = new Set([
  "",
  "-",
  "--",
  "—",
  "n/a",
  "na",
  "nc",
  "?",
  "aucun",
  "aucune",
  "aucunes",
  "aucune hypothese",
  "aucune hypothese particuliere",
  "aucune donnee",
  "neant",
  "rien",
  "none",
  "null",
  "vide",
  "non renseigne",
  "non renseignee",
  "non applicable",
  "non precise",
  "inconnu",
  "inconnue",
]);

/** Longueur en deçà de laquelle un texte ne peut pas constituer une preuve. */
export const MIN_EVIDENCE_CHARS = 3;

function normalizeText(text: unknown): string {
  if (typeof text !== "string") return "";
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[.!…\s]+$/u, "")
    .trim();
}

/** Le champ dit-il réellement quelque chose ? */
export function hasSubstance(text: unknown): boolean {
  const normalized = normalizeText(text);
  if (normalized.length < MIN_EVIDENCE_CHARS) return false;
  return !EMPTY_MARKERS.has(normalized);
}

function confidenceOf(f: { confidence?: string | null }): "low" | "medium" | "high" {
  return f.confidence === "high" || f.confidence === "low" ? f.confidence : "medium";
}

/**
 * Classe une conclusion selon ce qui la soutient.
 *
 * La table complète, six cas, sans exception :
 *
 * | Base citée | Hypothèses | Confiance | Niveau           |
 * | ---------- | ---------- | --------- | ---------------- |
 * | non        | —          | —         | Donnée manquante |
 * | oui        | —          | faible    | Hypothèse        |
 * | oui        | non        | élevée    | Fait             |
 * | oui        | non        | moyenne   | Déduction forte  |
 * | oui        | oui        | élevée    | Déduction forte  |
 * | oui        | oui        | moyenne   | Hypothèse        |
 *
 * La première ligne prime sur tout le reste : sans base citée, une confiance
 * « élevée » annoncée par le modèle ne vaut rien. C'est exactement le cas qu'on
 * veut voir écrit « Donnée manquante » dans le rapport plutôt que « Fait ».
 */
export function classifyEpistemic(f: {
  confidence?: string | null;
  evidence?: Evidence;
}): EpistemicLevel {
  const grounded = hasSubstance(f.evidence?.based_on);
  if (!grounded) return "donnee_manquante";

  const confidence = confidenceOf(f);
  if (confidence === "low") return "hypothese";

  const assumed = hasSubstance(f.evidence?.assumptions);
  if (!assumed) return confidence === "high" ? "fait" : "deduction_forte";
  return confidence === "high" ? "deduction_forte" : "hypothese";
}

/**
 * Plafond de priorité imposé par le niveau de certitude.
 *
 * Une hypothèse ne monte jamais en Critique : on ne mobilise pas quelqu'un en
 * urgence sur une intuition. Une donnée manquante ne dépasse pas Opportunité :
 * la seule action légitime est d'aller chercher la donnée.
 */
export const EPISTEMIC_CEILING: Record<EpistemicLevel, PriorityBand> = {
  fait: "critique",
  deduction_forte: "critique",
  hypothese: "important",
  donnee_manquante: "opportunite",
};

// ---------------------------------------------------------------------------
// Sorties
// ---------------------------------------------------------------------------

export type AnalysedFinding = {
  key: string;
  /** Position dans le tableau d'entrée. Départage les égalités, sans hasard. */
  index: number;
  /** Priorité de `scoring.ts`, avant tout effet de chaîne. */
  base_priority: number;
  /** Priorité après remontée de ce que ce problème débloque en aval. */
  priority: number;
  band: PriorityBand;
  /** Phrase qui explique la bande, construite depuis les mêmes entrées. */
  justification: string;
  epistemic: EpistemicLevel;
  /** Causes directes retenues (références inconnues et cycles écartés). */
  causes: string[];
  /** Problèmes dont celui-ci est la cause directe. */
  effects: string[];
  /** 0 = cause racine. Croît strictement le long de la chaîne. */
  chain_depth: number;
  /** Nombre total de problèmes en aval, transitivement. */
  blocks: number;
  /** Gain moyen mensuel débloqué en aval, hors gain propre. */
  downstream_gain: number;
  is_root_cause: boolean;
  is_symptom: boolean;
  /** Rang d'exécution : les causes avant leurs effets, le plus rentable d'abord. */
  order: number;
};

export type CausalChain = {
  /** Cause racine de la chaîne. */
  root: string;
  /** Conséquences, transitivement, dans l'ordre d'exécution. */
  links: string[];
  /** Longueur de la plus longue branche. */
  depth: number;
  gain_min: number;
  gain_max: number;
};

export type FindingAnalysis = {
  /** Tous les problèmes, dans l'ordre d'exécution. */
  findings: AnalysedFinding[];
  chains: CausalChain[];
  /** Cycles détectés dans les causes déclarées, et rompus. */
  cycles: string[][];
  /** Références vers un problème inexistant, écartées. */
  unknown_references: Array<{ from: string; reference: string }>;
  /** Clés en double, renommées : la seconde n'est plus référençable. */
  duplicate_keys: string[];
  /** Clés des conclusions non vérifiables en l'état. */
  missing_data: string[];
};

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------

/**
 * Part de la priorité d'un problème qui remonte vers sa cause directe.
 *
 * Ni 0 (une cause racine ne vaudrait que par elle-même, alors qu'elle
 * conditionne tout l'aval), ni 1 (la cause absorberait la valeur de la chaîne
 * entière et écraserait tout le reste du classement). À 0,5 la contribution
 * s'éteint d'elle-même en descendant la chaîne.
 */
export const BLOCKING_SHARE = 0.5;

/** Nombre de conséquences à partir duquel un problème devient critique par nature. */
export const ROOT_CAUSE_THRESHOLD = 2;

/** Difficulté au-delà de laquelle un gain chiffré ne suffit plus à faire une opportunité. */
const OPPORTUNITY_MAX_DIFFICULTY = 3;

// ---------------------------------------------------------------------------
// Clés
// ---------------------------------------------------------------------------

/** Réduit une clé à sa forme comparable : minuscules, sans accent, tirets. */
export function normalizeKey(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function averageGain(f: ScorableFinding): number {
  const min = f.estimated_gain_min ?? 0;
  const max = f.estimated_gain_max ?? f.estimated_gain_min ?? 0;
  return (min + max) / 2;
}

// ---------------------------------------------------------------------------
// Bande et justification
// ---------------------------------------------------------------------------

type BandInput = {
  severity: string;
  epistemic: EpistemicLevel;
  blocks: number;
  causes: number;
  gain: number;
  difficulty: number;
  /** La conclusion ne repose-t-elle que sur des constats techniques ? */
  technicalOnly?: boolean;
};

/**
 * Bande brute, avant plafond épistémique.
 *
 * Volontairement lue sur les composantes, pas sur le score : un seuil posé sur
 * un nombre agrégé serait faux d'une boutique à l'autre — 800 € par mois ne
 * pèsent pas pareil à 3 000 € et à 300 000 € de chiffre d'affaires — et
 * surtout, il ne s'expliquerait pas.
 */
function rawBand(input: BandInput): PriorityBand {
  if (input.severity === "critical") return "critique";
  if (input.blocks >= ROOT_CAUSE_THRESHOLD) return "critique";
  if (input.severity === "high" || input.blocks >= 1) return "important";
  if (input.gain > 0 && input.difficulty <= OPPORTUNITY_MAX_DIFFICULTY) return "opportunite";
  return "optimisation";
}

const SEVERITY_SENTENCE: Record<string, string> = {
  critical: "Sévérité critique.",
  high: "Sévérité élevée.",
  medium: "Sévérité moyenne.",
  low: "Sévérité faible.",
};

const EPISTEMIC_SENTENCE: Record<EpistemicLevel, string> = {
  fait: "Établi sur vos données réelles.",
  deduction_forte: "Déduit de vos données, avec des hypothèses annoncées.",
  hypothese: "Repose sur une hypothèse : à vérifier avant d'y consacrer un budget.",
  donnee_manquante: "La donnée qui permettrait de conclure manque.",
};

/**
 * Décide la bande et rédige sa justification.
 *
 * Les deux sortent du même appel, à dessein : une justification calculée
 * ailleurs finirait par ne plus décrire la décision réellement prise.
 */
export function decideBand(input: BandInput): { band: PriorityBand; justification: string } {
  const raw = rawBand(input);
  // Deux plafonds, et le plus bas des deux gagne. Le premier borne ce qu'on peut
  // affirmer sans preuve ; le second borne ce qu'on peut réclamer sans avoir
  // établi que le constat coûte quelque chose.
  const ceiling = input.technicalOnly
    ? capBand(EPISTEMIC_CEILING[input.epistemic], TECHNICAL_BAND_CEILING)
    : EPISTEMIC_CEILING[input.epistemic];
  const band = capBand(raw, ceiling);

  const parts: string[] = [SEVERITY_SENTENCE[input.severity] ?? SEVERITY_SENTENCE.medium];

  if (input.technicalOnly) {
    parts.push(
      "Constat technique : son effet sur les ventes n'est pas mesuré, donc ni chiffré ni déclaré critique.",
    );
  }

  if (input.blocks >= ROOT_CAUSE_THRESHOLD) {
    parts.push(`Cause racine : ${input.blocks} autres problèmes en découlent.`);
  } else if (input.blocks === 1) {
    parts.push("Un autre problème disparaît avec celui-ci.");
  }

  if (input.causes > 0) {
    parts.push(
      input.causes === 1
        ? "Conséquence d'un problème en amont, à corriger d'abord."
        : `Conséquence de ${input.causes} problèmes en amont, à corriger d'abord.`,
    );
  }

  if (input.blocks === 0 && input.causes === 0 && input.gain > 0) {
    parts.push("Gain chiffré, indépendant du reste.");
  }

  parts.push(EPISTEMIC_SENTENCE[input.epistemic]);

  if (band !== raw) {
    parts.push(
      `Priorité ramenée de ${BAND_LABELS[raw]} à ${BAND_LABELS[band]} : le niveau de certitude ne justifie pas plus.`,
    );
  }

  return { band, justification: parts.join(" ") };
}

// ---------------------------------------------------------------------------
// Analyse complète
// ---------------------------------------------------------------------------

/**
 * Construit le graphe causal, classe, priorise et ordonne.
 *
 * Robuste à ce qu'un modèle produit réellement : clés absentes, clés en double,
 * références vers un problème inexistant, et causalités circulaires. Rien de
 * tout cela ne fait échouer l'analyse — chaque anomalie est écartée puis
 * rapportée, parce qu'un audit à demi lisible vaut mieux qu'une exception.
 */
export function analyseFindings(input: GraphFinding[]): FindingAnalysis {
  const duplicateKeys: string[] = [];
  const unknownReferences: Array<{ from: string; reference: string }> = [];
  const cycles: string[][] = [];

  // --- 1. Clés uniques ------------------------------------------------------
  const keys: string[] = [];
  const byKey = new Map<string, GraphFinding>();
  const indexOfKey = new Map<string, number>();

  input.forEach((finding, index) => {
    const wanted = normalizeKey(finding.key) || `probleme-${index + 1}`;
    let key = wanted;
    let suffix = 2;
    while (byKey.has(key)) {
      key = `${wanted}-${suffix++}`;
    }
    if (key !== wanted) duplicateKeys.push(key);
    keys.push(key);
    byKey.set(key, finding);
    indexOfKey.set(key, index);
  });

  // --- 2. Arêtes valides ----------------------------------------------------
  const causes = new Map<string, string[]>();
  keys.forEach((key, index) => {
    const declared = input[index].caused_by ?? [];
    const kept: string[] = [];
    for (const reference of Array.isArray(declared) ? declared : []) {
      const target = normalizeKey(reference);
      // Une auto-référence n'est pas une erreur de plus à signaler : elle ne
      // dit rien, on la laisse tomber sans bruit.
      if (!target || target === key) continue;
      if (!byKey.has(target)) {
        unknownReferences.push({ from: key, reference: String(reference) });
        continue;
      }
      if (!kept.includes(target)) kept.push(target);
    }
    causes.set(key, kept);
  });

  // --- 3. Rupture des cycles ------------------------------------------------
  // « A cause B » et « B cause A » simultanément est fréquent quand un modèle
  // décrit une spirale. Sans rupture, le calcul de profondeur ne terminerait
  // pas. L'arête de retour est retirée, le cycle est rapporté tel quel.
  const visitState = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];

  const visit = (key: string): void => {
    visitState.set(key, 1);
    stack.push(key);
    const kept: string[] = [];
    for (const cause of causes.get(key) ?? []) {
      const state = visitState.get(cause) ?? 0;
      if (state === 1) {
        const at = stack.indexOf(cause);
        cycles.push([...stack.slice(at), cause]);
        continue;
      }
      if (state === 0) visit(cause);
      kept.push(cause);
    }
    causes.set(key, kept);
    stack.pop();
    visitState.set(key, 2);
  };

  for (const key of keys) {
    if ((visitState.get(key) ?? 0) === 0) visit(key);
  }

  // --- 4. Effets et profondeur ---------------------------------------------
  const effects = new Map<string, string[]>(keys.map((key) => [key, []]));
  for (const key of keys) {
    for (const cause of causes.get(key) ?? []) {
      effects.get(cause)!.push(key);
    }
  }

  const depth = new Map<string, number>();
  const depthOf = (key: string): number => {
    const known = depth.get(key);
    if (known !== undefined) return known;
    depth.set(key, 0);
    const value = (causes.get(key) ?? []).reduce(
      (max, cause) => Math.max(max, depthOf(cause) + 1),
      0,
    );
    depth.set(key, value);
    return value;
  };
  for (const key of keys) depthOf(key);

  // La profondeur croît strictement le long d'une arête : la trier donne un
  // ordre topologique, sans second parcours.
  const byDepthDesc = [...keys].sort(
    (a, b) => depth.get(b)! - depth.get(a)! || indexOfKey.get(a)! - indexOfKey.get(b)!,
  );

  // --- 5. Aval transitif et priorité remontée ------------------------------
  const downstream = new Map<string, Set<string>>();
  const priority = new Map<string, number>();
  const basePriority = new Map<string, number>(
    keys.map((key) => [key, computePriority(byKey.get(key)!)]),
  );

  for (const key of byDepthDesc) {
    const reach = new Set<string>();
    let lifted = basePriority.get(key)!;
    for (const effect of effects.get(key)!) {
      reach.add(effect);
      for (const far of downstream.get(effect) ?? []) reach.add(far);
      lifted += BLOCKING_SHARE * priority.get(effect)!;
    }
    downstream.set(key, reach);
    priority.set(key, Math.round(lifted));
  }

  // --- 6. Bande et justification -------------------------------------------
  const analysed = new Map<string, AnalysedFinding>();
  for (const key of keys) {
    const finding = byKey.get(key)!;
    const reach = downstream.get(key)!;
    const epistemic = classifyEpistemic(finding);
    const causeList = causes.get(key)!;
    const { band, justification } = decideBand({
      severity: finding.severity,
      epistemic,
      blocks: reach.size,
      causes: causeList.length,
      gain: averageGain(finding),
      difficulty: Math.min(5, Math.max(1, finding.difficulty ?? 2)),
      technicalOnly: isTechnicalOnly(finding),
    });

    analysed.set(key, {
      key,
      index: indexOfKey.get(key)!,
      base_priority: basePriority.get(key)!,
      priority: priority.get(key)!,
      band,
      justification,
      epistemic,
      causes: causeList,
      effects: effects.get(key)!,
      chain_depth: depth.get(key)!,
      blocks: reach.size,
      downstream_gain: Math.round(
        [...reach].reduce((sum, other) => sum + averageGain(byKey.get(other)!), 0),
      ),
      is_root_cause: causeList.length === 0 && reach.size > 0,
      is_symptom: causeList.length > 0,
      order: 0,
    });
  }

  // --- 7. Ordre d'exécution -------------------------------------------------
  // Contrainte dure : jamais un symptôme avant sa cause. À contrainte
  // satisfaite, le plus rentable d'abord.
  const emitted = new Set<string>();
  const ordered: AnalysedFinding[] = [];
  while (emitted.size < keys.length) {
    const ready = keys
      .filter((key) => !emitted.has(key) && causes.get(key)!.every((c) => emitted.has(c)))
      .map((key) => analysed.get(key)!)
      .sort(
        (a, b) =>
          b.priority - a.priority || BAND_RANK[a.band] - BAND_RANK[b.band] || a.index - b.index,
      );

    // Le graphe est acyclique à ce stade, donc `ready` ne peut pas être vide.
    // La garde reste : une analyse tronquée vaut mieux qu'une boucle infinie
    // dans un cron qui tourne toutes les minutes.
    if (ready.length === 0) {
      for (const key of keys) {
        if (!emitted.has(key)) {
          emitted.add(key);
          ordered.push(analysed.get(key)!);
        }
      }
      break;
    }

    emitted.add(ready[0].key);
    ordered.push(ready[0]);
  }
  ordered.forEach((finding, position) => {
    finding.order = position;
  });

  // --- 8. Chaînes racontables ----------------------------------------------
  const rank = new Map<string, number>(ordered.map((f, position) => [f.key, position]));
  const chains: CausalChain[] = ordered
    .filter((f) => f.is_root_cause)
    .map((root) => {
      const links = [...downstream.get(root.key)!].sort((a, b) => rank.get(a)! - rank.get(b)!);
      const members = [root.key, ...links];
      return {
        root: root.key,
        links,
        depth: members.reduce((max, key) => Math.max(max, depth.get(key)!), 0),
        gain_min: Math.round(
          members.reduce((sum, key) => sum + (byKey.get(key)!.estimated_gain_min ?? 0), 0),
        ),
        gain_max: Math.round(
          members.reduce(
            (sum, key) =>
              sum + (byKey.get(key)!.estimated_gain_max ?? byKey.get(key)!.estimated_gain_min ?? 0),
            0,
          ),
        ),
      };
    });

  return {
    findings: ordered,
    chains,
    cycles,
    unknown_references: unknownReferences,
    duplicate_keys: duplicateKeys,
    missing_data: ordered.filter((f) => f.epistemic === "donnee_manquante").map((f) => f.key),
  };
}

/** Répartition par bande, pour l'en-tête du rapport. */
export function countByBand(findings: AnalysedFinding[]): Record<PriorityBand, number> {
  const counts = { critique: 0, important: 0, opportunite: 0, optimisation: 0 };
  for (const finding of findings) counts[finding.band]++;
  return counts;
}
