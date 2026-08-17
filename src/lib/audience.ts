/**
 * LE CLIENT CIBLE, DÉDUIT — JAMAIS DEMANDÉ.
 *
 * POURQUOI CE MODULE EXISTE. Demander à un marchand de décrire son « avatar
 * client » est le réflexe de tous les outils du marché, et c'est une faute :
 * celui qui débute ne sait pas ce qu'est un avatar, et celui qui croit le
 * savoir décrit le client qu'il AIMERAIT avoir. Dans les deux cas, l'audit se
 * bâtit sur une fiction fournie par l'audité.
 *
 * Or la boutique dit déjà à qui elle s'adresse. Ses prix, son vocabulaire, la
 * longueur de ses descriptions, la présence ou l'absence de preuves, la taille
 * de son catalogue : tout cela dessine un destinataire, que le marchand l'ait
 * choisi ou non. Le déduire est un service ; le demander est une démission.
 *
 * LA LIGNE À NE PAS FRANCHIR. Une déduction n'est pas une vérité. Chaque
 * hypothèse sort d'ici avec le compte exact des signaux qui la soutiennent, les
 * preuves littérales utilisées, ce qui manque pour trancher, et ce qui la
 * confirmerait ou l'infirmerait. Une confiance élevée n'est jamais accordée :
 * elle est CALCULÉE à partir du nombre de signaux concordants, et plafonnée
 * tant que les signaux d'achat réels manquent — parce que ce que la boutique
 * prétend viser et ce qu'elle vend réellement sont deux choses différentes, et
 * que seule la seconde est une preuve.
 *
 * Module PUR : aucune entrée-sortie, aucune horloge.
 */

import type { Observation } from "@/lib/observations";

// ---------------------------------------------------------------------------
// Gamme
// ---------------------------------------------------------------------------

export const PRICE_TIERS = ["entree", "milieu", "premium", "luxe"] as const;
export type PriceTier = (typeof PRICE_TIERS)[number];

export const TIER_LABELS: Record<PriceTier, string> = {
  entree: "entrée de gamme",
  milieu: "milieu de gamme",
  premium: "premium",
  luxe: "luxe",
};

/**
 * Bornes de gamme, en euros ou équivalent.
 *
 * Elles ne prétendent pas décrire un marché : elles séparent des COMPORTEMENTS
 * D'ACHAT. En dessous de 25, l'achat est impulsif et la réassurance compte peu.
 * Au-dessus de 150, il est réfléchi, comparé, et la moindre absence de preuve
 * coûte la vente. C'est cette frontière-là qui nous intéresse, pas une
 * classification marketing.
 *
 * Elles s'appliquent au prix MÉDIAN, jamais au moyen : un seul article à 3 000
 * dans un catalogue à 20 déplacerait la moyenne et pas la réalité.
 */
export const TIER_BOUNDS: Array<{ tier: PriceTier; upTo: number; behaviour: string }> = [
  {
    tier: "entree",
    upTo: 25,
    behaviour:
      "achat d'impulsion, décidé en quelques secondes, où le prix lui-même lève la plupart des objections",
  },
  {
    tier: "milieu",
    upTo: 150,
    behaviour:
      "achat réfléchi mais rapide, où le visiteur compare deux ou trois options avant de choisir",
  },
  {
    tier: "premium",
    upTo: 800,
    behaviour:
      "achat comparé, souvent reporté puis repris, où l'absence d'une preuve suffit à faire renoncer",
  },
  {
    tier: "luxe",
    upTo: Number.POSITIVE_INFINITY,
    behaviour:
      "achat engageant, rarement décidé à la première visite, où la confiance dans le vendeur pèse autant que le produit",
  },
];

export function tierOf(medianPrice: number | null): PriceTier | null {
  if (medianPrice === null || !Number.isFinite(medianPrice) || medianPrice <= 0) return null;
  return TIER_BOUNDS.find((b) => medianPrice <= b.upTo)?.tier ?? "luxe";
}

// ---------------------------------------------------------------------------
// Entrées
// ---------------------------------------------------------------------------

/** Ce que la boutique donne à lire, réduit à ce qui porte un signal. */
export type AudienceInput = {
  /** Prix médian des variantes. Médian, jamais moyen. */
  medianPrice: number | null;
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  productCount: number | null;
  /** Titres et descriptions réellement lus, pour le vocabulaire. */
  texts: string[];
  /** Part de fiches sans description. */
  descriptionsMissingShare: number | null;
  /** Panier moyen réel, s'il existe. C'est la seule preuve d'achat. */
  aov: number | null;
  orders: number | null;
  /** Part de commandes de clients déjà venus. */
  returningShare: number | null;
  /** Part de commandes remisées. */
  discountedShare: number | null;
  /** Signaux de confiance observés sur le site public. */
  policyPages: number | null;
  reviewsDeclared: boolean | null;
  shippingMentioned: boolean | null;
};

/** Extrait les entrées depuis les observations, sans rien supposer. */
export function audienceInputFrom(
  observations: Observation[],
  texts: string[],
  currency: string | null,
): AudienceInput {
  const val = (id: string): number | null => {
    const o = observations.find((x) => x.id === id);
    return o && o.value !== null && Number.isFinite(o.value) ? o.value : null;
  };
  const share = (id: string): number | null => {
    const v = val(id);
    if (v === null) return null;
    const n = v > 1 ? v / 100 : v;
    return n >= 0 && n <= 1 ? n : null;
  };
  const missing = val("shopify.products_without_description");
  const total = val("shopify.product_count");
  const bool = (id: string): boolean | null => {
    const v = val(id);
    return v === null ? null : v > 0;
  };

  return {
    medianPrice: val("shopify.price_median"),
    priceMin: val("shopify.price_min"),
    priceMax: val("shopify.price_max"),
    currency,
    productCount: total,
    texts,
    descriptionsMissingShare:
      missing !== null && total !== null && total > 0 ? missing / total : null,
    aov: val("shopify.aov"),
    orders: val("shopify.orders_30d"),
    returningShare: share("shopify.returning_customer_rate"),
    discountedShare: share("shopify.discounted_order_share"),
    policyPages: val("storefront.policy_pages"),
    reviewsDeclared: bool("storefront.product_reviews_declared"),
    shippingMentioned: bool("storefront.product_shipping_mentioned"),
  };
}

// ---------------------------------------------------------------------------
// Hypothèse
// ---------------------------------------------------------------------------

/** Un signal retenu : ce qui a été lu, et ce qu'on en tire. */
export type AudienceSignal = {
  id: string;
  /** La preuve, telle qu'elle sera montrée au marchand. */
  evidence: string;
  /** Ce que ce signal indique. */
  reading: string;
  /**
   * Un signal d'ACHAT vaut plus qu'un signal d'INTENTION.
   *
   * Ce qu'une boutique affiche dit ce qu'elle vise ; ce qu'elle vend dit qui
   * l'achète. Sans le second, l'hypothèse reste une lecture de vitrine.
   */
  proven: boolean;
};

export type PriceSensitivity = "faible" | "moyenne" | "forte" | "inconnue";

export type AudienceHypothesis = {
  /** La formulation, en une phrase, destinée au marchand. */
  segment: string;
  tier: PriceTier | null;
  /** 0 à 100. CALCULÉE depuis les signaux, jamais choisie. */
  confidence: number;
  signals: AudienceSignal[];
  motivations: string[];
  needs: string[];
  objections: string[];
  priceSensitivity: PriceSensitivity;
  expectations: string[];
  /** Ce qui manque pour trancher, nommément. */
  missing: string[];
  /** Ce qui confirmerait ou infirmerait l'hypothèse. */
  wouldSettle: string[];
};

/**
 * Confiance maximale sans aucune vente observée.
 *
 * POURQUOI CE PLAFOND EXISTE. Une vitrine dit ce que le marchand VEUT vendre ;
 * les commandes disent ce qu'on lui ACHÈTE. Tant que la seconde est muette,
 * l'hypothèse est une lecture de devanture — solide peut-être, mais invérifiée.
 * La laisser monter plus haut reviendrait à donner à une intention l'autorité
 * d'un fait.
 */
export const MAX_CONFIDENCE_WITHOUT_SALES = 55;

/** Plancher en dessous duquel on ne publie rien : une hypothèse vide nuit. */
export const MIN_CONFIDENCE_TO_PUBLISH = 25;

/** Commandes minimales pour qu'un comportement d'achat soit lisible. */
export const MIN_ORDERS_FOR_BEHAVIOUR = 20;

/** Vocabulaire qui trahit un positionnement. Comptés, jamais interprétés seuls. */
const PREMIUM_WORDS = [
  "premium",
  "luxe",
  "artisanal",
  "fait main",
  "haut de gamme",
  "exclusif",
  "édition limitée",
  "savoir-faire",
  "durable",
  "garantie à vie",
];
const VALUE_WORDS = [
  "pas cher",
  "promo",
  "soldes",
  "discount",
  "petit prix",
  "économique",
  "-50",
  "gratuit",
  "déstockage",
];

function countWords(texts: string[], words: string[]): number {
  const blob = texts.join(" ").toLowerCase();
  return words.filter((w) => blob.includes(w)).length;
}

/**
 * Déduit le client cible probable.
 *
 * CE QUE CETTE FONCTION NE FAIT JAMAIS. Elle ne rend pas d'hypothèse quand rien
 * ne la soutient : sans prix ni texte, il n'y a pas de « client par défaut »,
 * et en inventer un serait exactement le travers que le module existe pour
 * éviter. Elle rend alors `null`, et l'appelant dit au marchand ce qui manque.
 */
export function deduceAudience(input: AudienceInput): AudienceHypothesis | null {
  const signals: AudienceSignal[] = [];
  const missing: string[] = [];
  const wouldSettle: string[] = [];

  const tier = tierOf(input.medianPrice);
  const devise = input.currency ? ` ${input.currency}` : "";

  // --- Signal 1 : la gamme, lue sur le prix médian -------------------------
  if (tier && input.medianPrice !== null) {
    const bound = TIER_BOUNDS.find((b) => b.tier === tier)!;
    signals.push({
      id: "gamme",
      evidence: `Prix médian de ${Math.round(input.medianPrice)}${devise} sur le catalogue (Shopify)`,
      reading: `Positionne la boutique en ${TIER_LABELS[tier]} : ${bound.behaviour}.`,
      proven: false,
    });
  } else {
    missing.push(
      "Le prix médian du catalogue, qui situe la gamme et donc le comportement d'achat.",
    );
  }

  // --- Signal 2 : l'étendue de gamme ---------------------------------------
  // Un écart de prix très large signale un catalogue qui s'adresse à plusieurs
  // publics — souvent sans le savoir, et c'est en soi un constat.
  if (input.priceMin !== null && input.priceMax !== null && input.priceMin > 0) {
    const spread = input.priceMax / input.priceMin;
    if (spread >= 20) {
      signals.push({
        id: "etendue",
        evidence: `Prix de ${Math.round(input.priceMin)} à ${Math.round(input.priceMax)}${devise}, soit un rapport de 1 à ${Math.round(spread)} (Shopify)`,
        reading:
          "Le catalogue couvre des budgets très différents : il s'adresse en réalité à plusieurs publics, dont un seul peut être servi correctement par une même page d'accueil.",
        proven: false,
      });
    }
  }

  // --- Signal 3 : le vocabulaire -------------------------------------------
  const premium = countWords(input.texts, PREMIUM_WORDS);
  const value = countWords(input.texts, VALUE_WORDS);
  if (input.texts.length > 0 && (premium > 0 || value > 0)) {
    signals.push({
      id: "vocabulaire",
      evidence: `${premium} marqueur(s) de montée en gamme et ${value} marqueur(s) de prix bas relevés dans les titres et descriptions (Shopify)`,
      reading:
        premium > value
          ? "Le vocabulaire cherche à justifier une valeur, pas un prix : la boutique parle à quelqu'un qui veut être rassuré sur la qualité."
          : value > premium
            ? "Le vocabulaire met le prix en avant : la boutique parle à quelqu'un qui compare d'abord les montants."
            : "Le vocabulaire n'est pas tranché : ni la qualité ni le prix ne sont clairement mis en avant.",
      proven: false,
    });
  } else if (input.texts.length === 0) {
    missing.push(
      "Les titres et descriptions des produits, où se lit le vocabulaire adressé au client.",
    );
  }

  // --- Signal 4 : le silence des fiches ------------------------------------
  // Une fiche vide n'est pas neutre : elle suppose un acheteur qui sait déjà ce
  // qu'il veut. Sur du premium, cette supposition est presque toujours fausse.
  if (input.descriptionsMissingShare !== null && input.descriptionsMissingShare >= 0.3) {
    signals.push({
      id: "fiches_muettes",
      evidence: `${Math.round(input.descriptionsMissingShare * 100)} % des fiches n'ont aucune description (Shopify)`,
      reading:
        "La boutique suppose un visiteur qui connaît déjà le produit et vient le chercher — un comportement de client fidèle ou de marque connue.",
      proven: false,
    });
  }

  // --- Signal 5 : ce qu'on achète réellement -------------------------------
  // Le seul signal PROUVÉ : il vient des commandes, pas de la vitrine.
  if (input.aov !== null && input.orders !== null && input.orders >= MIN_ORDERS_FOR_BEHAVIOUR) {
    signals.push({
      id: "panier_reel",
      evidence: `Panier moyen de ${Math.round(input.aov)}${devise} sur ${input.orders} commandes (Shopify)`,
      reading: `Ce que les clients dépensent réellement, à comparer au prix médian affiché.`,
      proven: true,
    });
    // L'écart entre ce qu'on expose et ce qu'on achète est le constat le plus
    // riche du module : il dit quelle partie du catalogue vit vraiment.
    if (input.medianPrice !== null && input.medianPrice > 0) {
      const ecart = input.aov / input.medianPrice;
      if (ecart <= 0.6 || ecart >= 1.8) {
        signals.push({
          id: "ecart_vitrine_achat",
          evidence: `Panier moyen de ${Math.round(input.aov)}${devise} pour un prix médian de ${Math.round(input.medianPrice)}${devise} (Shopify)`,
          reading:
            ecart <= 0.6
              ? "Les clients achètent nettement moins cher que ce que la boutique met en avant : le public réel est en dessous de la gamme affichée."
              : "Les clients achètent nettement plus cher que le prix médian : la boutique met en avant des produits qui ne sont pas ceux qui la font vivre.",
          proven: true,
        });
      }
    }
  } else if (input.orders !== null && input.orders < MIN_ORDERS_FOR_BEHAVIOUR) {
    missing.push(
      `Le comportement d'achat réel : ${input.orders} commande(s) sur la période, il en faut au moins ${MIN_ORDERS_FOR_BEHAVIOUR} pour qu'un panier moyen veuille dire quelque chose.`,
    );
    wouldSettle.push(
      "Vingt commandes payées suffiraient à comparer ce que la boutique expose à ce qu'on lui achète réellement.",
    );
  } else {
    missing.push("Le panier moyen et le volume de commandes, seuls signaux d'achat réel.");
  }

  // --- Signal 6 : la fidélité ----------------------------------------------
  if (
    input.returningShare !== null &&
    input.orders !== null &&
    input.orders >= MIN_ORDERS_FOR_BEHAVIOUR
  ) {
    signals.push({
      id: "fidelite",
      evidence: `${Math.round(input.returningShare * 100)} % des commandes viennent d'un client déjà venu (Shopify)`,
      reading:
        input.returningShare >= 0.3
          ? "Une part importante de clients revient : le produit tient sa promesse, et le public est identifié."
          : "Presque personne ne revient : chaque vente est faite à un inconnu, ce qui est le comportement d'un achat ponctuel ou d'un public mal ciblé.",
      proven: true,
    });
  }

  // --- Signal 7 : la remise comme argument ---------------------------------
  if (input.discountedShare !== null && input.discountedShare >= 0.5) {
    signals.push({
      id: "remise",
      evidence: `${Math.round(input.discountedShare * 100)} % des commandes portent un code de réduction (Shopify)`,
      reading:
        "La remise est devenue l'argument principal : le public réel est sensible au prix, quelle que soit la gamme affichée.",
      proven: true,
    });
  }

  if (signals.length === 0) return null;

  // --- Confiance -----------------------------------------------------------
  // CALCULÉE, jamais choisie. Chaque signal vaut un socle ; les signaux prouvés
  // pèsent davantage parce qu'ils viennent d'achats et non d'affichage.
  const prouves = signals.filter((s) => s.proven).length;
  const affiches = signals.length - prouves;
  let confidence = Math.min(95, 20 + prouves * 18 + affiches * 8);
  if (prouves === 0) confidence = Math.min(confidence, MAX_CONFIDENCE_WITHOUT_SALES);
  if (confidence < MIN_CONFIDENCE_TO_PUBLISH) return null;

  const sensitivity: PriceSensitivity =
    input.discountedShare !== null && input.discountedShare >= 0.5
      ? "forte"
      : tier === "entree"
        ? "forte"
        : tier === "luxe" || tier === "premium"
          ? "faible"
          : tier === "milieu"
            ? "moyenne"
            : "inconnue";

  if (input.policyPages === null) {
    missing.push(
      "Les pages de livraison et de retour du site, qui disent ce que la boutique promet.",
    );
  }
  if (input.reviewsDeclared === null) {
    missing.push(
      "La présence d'avis sur les fiches produit, principal contrepoids aux objections.",
    );
  }
  wouldSettle.push(
    "Les sources de trafic réelles des commandes : un public venu de la recherche n'a ni les mêmes attentes ni les mêmes objections qu'un public venu d'une publicité.",
  );

  return {
    segment: describeSegment(tier, signals, input),
    tier,
    confidence,
    signals,
    motivations: motivationsFor(tier),
    needs: needsFor(tier),
    objections: objectionsFor(tier, input),
    priceSensitivity: sensitivity,
    expectations: expectationsFor(tier),
    missing,
    wouldSettle,
  };
}

function describeSegment(
  tier: PriceTier | null,
  signals: AudienceSignal[],
  input: AudienceInput,
): string {
  if (!tier) return "Public non caractérisable à partir des données disponibles.";
  const etendue = signals.some((s) => s.id === "etendue");
  const remise = signals.some((s) => s.id === "remise");
  const base: Record<PriceTier, string> = {
    entree:
      "Acheteur d'impulsion, qui décide vite et pour qui le prix lève lui-même la plupart des objections",
    milieu:
      "Acheteur qui compare deux ou trois options avant de choisir, et qui attend qu'on lui explique la différence",
    premium:
      "Acheteur réfléchi, qui compare, reporte, revient — et pour qui l'absence d'une seule preuve suffit à faire renoncer",
    luxe: "Acheteur engagé, qui décide rarement à la première visite et pour qui la confiance dans le vendeur pèse autant que le produit",
  };
  let phrase = base[tier];
  if (etendue) {
    phrase +=
      ". Le catalogue s'adresse toutefois à plusieurs budgets très différents : ce portrait décrit le plus représenté, pas le seul";
  }
  if (remise) {
    phrase += ". Dans les faits, ce public achète surtout quand une remise est proposée";
  }
  if (input.productCount !== null && input.productCount <= 3) {
    phrase +=
      ". Le catalogue tient en quelques références : la boutique joue sur un produit, pas sur un choix";
  }
  return `${phrase}.`;
}

function motivationsFor(tier: PriceTier | null): string[] {
  if (!tier) return [];
  const m: Record<PriceTier, string[]> = {
    entree: [
      "Obtenir l'objet rapidement",
      "Payer le moins possible",
      "Ne pas prendre de risque financier",
    ],
    milieu: [
      "Faire le bon choix parmi quelques options",
      "Éviter de regretter son achat",
      "Recevoir vite",
    ],
    premium: [
      "Acheter une fois, bien",
      "Être sûr de la qualité avant de payer",
      "Être traité correctement en cas de problème",
    ],
    luxe: [
      "Acquérir quelque chose de rare ou de durable",
      "Traiter avec un vendeur qui inspire confiance",
      "Être accompagné, pas seulement servi",
    ],
  };
  return m[tier];
}

function needsFor(tier: PriceTier | null): string[] {
  if (!tier) return [];
  const n: Record<PriceTier, string[]> = {
    entree: [
      "Un prix visible immédiatement",
      "Un délai de livraison annoncé",
      "Un paiement en deux clics",
    ],
    milieu: [
      "Une comparaison claire entre les options",
      "Des photos qui montrent l'usage réel",
      "Une politique de retour lisible",
    ],
    premium: [
      "Des avis vérifiables",
      "Le détail de ce qui est inclus",
      "Une garantie et une procédure de retour explicites",
      "Un moyen de poser une question avant d'acheter",
    ],
    luxe: [
      "Une preuve d'authenticité ou d'origine",
      "Un interlocuteur identifiable",
      "Une livraison suivie et assurée",
    ],
  };
  return n[tier];
}

function objectionsFor(tier: PriceTier | null, input: AudienceInput): string[] {
  if (!tier) return [];
  const base: Record<PriceTier, string[]> = {
    entree: [
      "« Les frais de port vont doubler le prix »",
      "« Ça va mettre trois semaines à arriver »",
    ],
    milieu: [
      "« Pourquoi celui-ci plutôt que l'autre ? »",
      "« Et si la taille ne va pas ? »",
      "« Est-ce que je peux le renvoyer ? »",
    ],
    premium: [
      "« Est-ce que ça vaut vraiment ce prix ? »",
      "« Qui me dit que ce site est sérieux ? »",
      "« Que se passe-t-il si le produit arrive abîmé ? »",
      "« Personne n'a laissé d'avis, est-ce que quelqu'un a déjà acheté ici ? »",
    ],
    luxe: [
      "« Est-ce authentique ? »",
      "« À qui je parle si quelque chose se passe mal ? »",
      "« Pourquoi ce vendeur plutôt qu'une maison connue ? »",
    ],
  };
  const out = [...base[tier]];
  // Les objections que la boutique laisse ouvertes sont des FAITS observés, pas
  // des suppositions de comportement : elles sont ajoutées nommément.
  if (input.reviewsDeclared === false) {
    out.push(
      "« Aucun avis n'est affiché sur la fiche » — objection laissée sans réponse par le site.",
    );
  }
  if (input.shippingMentioned === false) {
    out.push(
      "« Combien coûte la livraison, et quand est-ce que je reçois ? » — la fiche produit n'en parle pas.",
    );
  }
  if (input.policyPages === 0) {
    out.push(
      "« Que se passe-t-il si je veux renvoyer ? » — aucune page de retour n'a été trouvée sur le site.",
    );
  }
  return out;
}

function expectationsFor(tier: PriceTier | null): string[] {
  if (!tier) return [];
  const e: Record<PriceTier, string[]> = {
    entree: ["Un site rapide", "Un prix total sans surprise à la caisse"],
    milieu: [
      "Des fiches qui répondent aux questions",
      "Une navigation qui montre les alternatives",
    ],
    premium: [
      "Une présentation soignée, cohérente d'une page à l'autre",
      "Des preuves visibles sans avoir à les chercher",
      "Un ton qui traite l'acheteur en adulte",
    ],
    luxe: [
      "Une identité visuelle tenue jusqu'au moindre détail",
      "Un contact humain accessible",
      "Aucune promotion agressive, qui dévaloriserait le produit",
    ],
  };
  return e[tier];
}

// ---------------------------------------------------------------------------
// Cohérence client cible ↔ boutique
// ---------------------------------------------------------------------------

export type Incoherence = {
  id: string;
  /** Ce qui a été observé. */
  observation: string;
  /** Ce que cela pose comme problème, pour CE public. */
  problem: string;
  evidence: string[];
  /** Conséquence probable, jamais chiffrée sans mesure. */
  impact: string;
  recommendation: string;
  /** La correction, assez concrète pour être exécutée. */
  correction: string;
  impactScore: number;
  effort: number;
};

/**
 * Confronte le public déduit à ce que la boutique lui montre.
 *
 * C'EST ICI QUE SE FAIT LE TRAVAIL D'UN CONSULTANT. Constater qu'il manque des
 * avis est banal ; constater qu'il manque des avis SUR UNE BOUTIQUE PREMIUM
 * DONT LE PUBLIC ACHÈTE APRÈS COMPARAISON est un diagnostic. Le même fait n'a
 * pas la même gravité selon à qui la boutique parle, et c'est précisément ce
 * qu'un audit générique ne sait pas faire.
 *
 * Aucune incohérence n'est produite sans les deux côtés : le public d'une part,
 * l'observation d'autre part. Une supposition sur l'un des deux ferait de tout
 * le raisonnement une opinion.
 */
export function findIncoherences(
  hypothesis: AudienceHypothesis,
  input: AudienceInput,
): Incoherence[] {
  const out: Incoherence[] = [];
  const exigeant = hypothesis.tier === "premium" || hypothesis.tier === "luxe";
  const gamme = hypothesis.tier ? TIER_LABELS[hypothesis.tier] : "indéterminée";

  // 1. Public exigeant, aucune preuve sociale.
  if (exigeant && input.reviewsDeclared === false) {
    out.push({
      id: "audience.premium_sans_avis",
      observation: `Les fiches produit n'affichent aucun avis, sur une boutique dont le prix médian la place en ${gamme}.`,
      problem:
        "Ce public décide après comparaison et cherche la preuve que quelqu'un d'autre a acheté avant lui. Sur une boutique inconnue, l'absence d'avis est l'objection la plus fréquente et la seule que le vendeur ne peut pas lever par ses propres mots.",
      evidence: [
        ...hypothesis.signals.filter((s) => s.id === "gamme").map((s) => s.evidence),
        "Aucun avis détecté sur la page produit (scan du site public)",
      ],
      impact:
        "Sur cette gamme, l'acheteur reporte sa décision plutôt que de renoncer franchement : la vente n'est pas perdue à l'instant, elle est perdue au profit d'un concurrent qui, lui, affiche des avis.",
      recommendation:
        "Afficher les avis existants sur la fiche produit, à hauteur du prix, et non en bas de page.",
      correction:
        "Installer une application d'avis Shopify, importer les avis déjà reçus par e-mail ou sur les réseaux, et placer le bloc juste sous le bouton d'ajout au panier. À défaut d'avis, afficher le nombre de commandes déjà livrées ou une photo client réelle : une preuve imparfaite vaut mieux qu'un vide.",
      impactScore: 4,
      effort: 2,
    });
  }

  // 2. Public exigeant, aucune politique visible.
  if (exigeant && input.policyPages === 0) {
    out.push({
      id: "audience.premium_sans_politique",
      observation: `Aucune page de livraison ni de retour n'est accessible, sur une boutique positionnée en ${gamme}.`,
      problem:
        "Plus le montant engagé est élevé, plus l'acheteur veut savoir ce qui se passe si ça se passe mal. Ces pages ne sont pas des formalités juridiques : ce sont les pages que ce public ouvre AVANT de payer.",
      evidence: [
        ...hypothesis.signals.filter((s) => s.id === "gamme").map((s) => s.evidence),
        "Aucune page de politique trouvée sur le site public",
      ],
      impact:
        "L'acheteur qui ne trouve pas ces informations les cherche ailleurs, et souvent ne revient pas.",
      recommendation:
        "Publier trois pages et les lier depuis le pied de page ET depuis la fiche produit.",
      correction:
        "Créer dans Shopify les pages « Livraison » (délai réel et prix, pas « sous 3 à 15 jours »), « Retours » (durée, qui paie le retour, comment le demander) et « Mentions légales ». Ajouter ensuite un lien vers Livraison et Retours directement sous le bouton d'achat.",
      impactScore: 3,
      effort: 1,
    });
  }

  // 3. Prix élevé, fiches muettes : la valeur n'est jamais justifiée.
  if (
    exigeant &&
    input.descriptionsMissingShare !== null &&
    input.descriptionsMissingShare >= 0.3
  ) {
    out.push({
      id: "audience.premium_sans_argument",
      observation: `${Math.round(input.descriptionsMissingShare * 100)} % des fiches n'ont aucune description, sur une boutique positionnée en ${gamme}.`,
      problem:
        "Sur cette gamme, le visiteur ne demande pas ce que le produit EST, il demande pourquoi il vaut ce prix. Une fiche sans texte laisse la question entière, et le prix reste seul face à lui — c'est la configuration où il paraît le plus cher.",
      evidence: [
        `${Math.round(input.descriptionsMissingShare * 100)} % de fiches sans description (Shopify)`,
        ...hypothesis.signals.filter((s) => s.id === "gamme").map((s) => s.evidence),
      ],
      impact:
        "Le prix est perçu sans contrepartie. Le visiteur ne conteste pas la qualité : il n'a simplement aucune raison de la supposer.",
      recommendation:
        "Réécrire en priorité les fiches des produits qui reçoivent déjà du trafic ou des ventes.",
      correction:
        "Structure à appliquer, dans cet ordre : (1) une phrase disant à qui le produit s'adresse et pour quel usage ; (2) trois bénéfices concrets, pas des caractéristiques — « tient une journée entière » plutôt que « batterie 5 000 mAh » ; (3) la réponse à l'objection la plus fréquente de ce public ; (4) ce qu'il y a exactement dans le colis. Commencer par les cinq produits les plus vus.",
      impactScore: 4,
      effort: 3,
    });
  }

  // 4. La boutique dit une chose, ses ventes en disent une autre.
  const ecart = hypothesis.signals.find((s) => s.id === "ecart_vitrine_achat");
  if (ecart) {
    out.push({
      id: "audience.vitrine_contredite",
      observation: ecart.evidence,
      problem: `Votre boutique semble vouloir vendre à un public ${gamme}, mais ce qu'on vous achète réellement décrit quelqu'un d'autre. ${ecart.reading}`,
      evidence: [
        ecart.evidence,
        ...hypothesis.signals.filter((s) => s.id === "gamme").map((s) => s.evidence),
      ],
      impact:
        "L'effort de présentation porte sur des produits qui ne font pas le chiffre, et les produits qui le font sont présentés comme secondaires.",
      recommendation:
        "Aligner la page d'accueil et les collections mises en avant sur ce qui se vend réellement.",
      correction:
        "Lister les cinq produits qui ont généré le plus de commandes sur trente jours, et vérifier qu'ils sont atteignables en un clic depuis la page d'accueil. S'ils ne le sont pas, les y placer avant toute autre modification.",
      impactScore: 4,
      effort: 2,
    });
  }

  // 5. Remise systématique sur une gamme qui ne le supporte pas.
  if (exigeant && input.discountedShare !== null && input.discountedShare >= 0.5) {
    out.push({
      id: "audience.remise_contre_gamme",
      observation: `${Math.round(input.discountedShare * 100)} % des commandes portent un code de réduction, sur une boutique positionnée en ${gamme}.`,
      problem:
        "Sur cette gamme, la remise permanente ne rassure pas : elle inquiète. Elle indique au visiteur que le prix affiché n'est pas le vrai prix, ce qui est exactement le doute qu'un acheteur exigeant cherche à écarter.",
      evidence: [
        `${Math.round(input.discountedShare * 100)} % de commandes remisées (Shopify)`,
        ...hypothesis.signals.filter((s) => s.id === "gamme").map((s) => s.evidence),
      ],
      impact: "La marge est amputée sans que la remise achète de la confiance en échange.",
      recommendation:
        "Remplacer la remise permanente par une contrepartie qui ne touche pas au prix affiché.",
      correction:
        "Retirer le code permanent, et proposer à la place la livraison offerte au-delà d'un montant, ou un accessoire inclus. Mesurer sur trente jours : si le volume tient, la remise n'achetait rien.",
      impactScore: 3,
      effort: 2,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Transmission au modèle
// ---------------------------------------------------------------------------

const SENSITIVITY_LABELS: Record<PriceSensitivity, string> = {
  faible: "faible",
  moyenne: "moyenne",
  forte: "forte",
  inconnue: "inconnue",
};

/**
 * Le portrait, tel qu'il part au modèle.
 *
 * LA CONFIANCE EST ÉCRITE EN TÊTE, avec le compte des signaux qui la produisent.
 * Un modèle qui reçoit une hypothèse sans son degré de certitude la traitera
 * comme un fait — c'est mécanique, et c'est exactement ce qu'on veut empêcher.
 */
export function audienceToPromptBlock(
  hypothesis: AudienceHypothesis | null,
  incoherences: Incoherence[],
): string {
  if (!hypothesis) {
    return [
      "CLIENT CIBLE : NON DÉDUCTIBLE.",
      "Les données disponibles ne portent aucun signal exploitable sur le public visé.",
      "N'en propose AUCUN : ni par le nom de la boutique, ni par sa niche déclarée, ni par ressemblance avec des boutiques connues. Dis au marchand quelles données permettraient de le déduire.",
    ].join("\n");
  }

  const l: string[] = [];
  const prouves = hypothesis.signals.filter((s) => s.proven).length;
  l.push(
    `CLIENT CIBLE PROBABLE — confiance ${hypothesis.confidence} %`,
    `(${hypothesis.signals.length} signaux, dont ${prouves} tirés d'achats réels)`,
    "",
    hypothesis.segment,
    "",
    `Gamme : ${hypothesis.tier ? TIER_LABELS[hypothesis.tier] : "indéterminée"}`,
    `Sensibilité au prix : ${SENSITIVITY_LABELS[hypothesis.priceSensitivity]}`,
    "",
    "SUR QUOI CETTE HYPOTHÈSE REPOSE :",
  );
  for (const s of hypothesis.signals) {
    l.push(`- [${s.proven ? "achat réel" : "affichage"}] ${s.evidence}`, `    → ${s.reading}`);
  }

  l.push("", "MOTIVATIONS PROBABLES :", ...hypothesis.motivations.map((m) => `- ${m}`));
  l.push("", "BESOINS :", ...hypothesis.needs.map((n) => `- ${n}`));
  l.push("", "OBJECTIONS PROBABLES À L'ACHAT :", ...hypothesis.objections.map((o) => `- ${o}`));
  l.push("", "ATTENTES :", ...hypothesis.expectations.map((e) => `- ${e}`));

  if (hypothesis.missing.length > 0) {
    l.push("", "CE QUI MANQUE POUR TRANCHER :", ...hypothesis.missing.map((m) => `- ${m}`));
  }
  if (hypothesis.wouldSettle.length > 0) {
    l.push(
      "",
      "CE QUI CONFIRMERAIT OU INFIRMERAIT :",
      ...hypothesis.wouldSettle.map((w) => `- ${w}`),
    );
  }

  if (incoherences.length > 0) {
    l.push("", "INCOHÉRENCES ENTRE CE PUBLIC ET LA BOUTIQUE :");
    for (const i of incoherences) {
      l.push(
        "",
        `[${i.id}]`,
        `  Observation : ${i.observation}`,
        `  Problème : ${i.problem}`,
        `  Preuve : ${i.evidence.join(" ; ")}`,
        `  Impact potentiel : ${i.impact}`,
        `  Recommandation : ${i.recommendation}`,
        `  Correction : ${i.correction}`,
        `  Impact ${i.impactScore}/5, effort ${i.effort}/5`,
      );
    }
  }

  l.push(
    "",
    "RÈGLES ABSOLUES SUR CE PORTRAIT :",
    `- C'est une HYPOTHÈSE à ${hypothesis.confidence} % de confiance, pas un fait. Présente-la comme telle au marchand, avec son pourcentage, et dis sur quoi elle repose.`,
    "- Tu n'ajoutes aucun trait de ce public qui ne soit pas dans cette liste : ni âge, ni sexe, ni catégorie socio-professionnelle, ni centre d'intérêt. Rien de tout cela n'a été observé.",
    "- Tu ne nommes aucune marque concurrente, aucun persona type, aucune étude de marché : tu n'en as reçu aucune.",
    "- Les incohérences ci-dessus sont établies. Tu les expliques, tu n'en inventes pas d'autres.",
    "- Si le marchand doit contredire ce portrait, dis-lui quelle donnée le trancherait.",
  );

  return l.join("\n");
}
