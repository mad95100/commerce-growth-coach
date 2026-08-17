/**
 * LE MOTEUR DE RÈGLES E-COMMERCE. Ce qui est constaté, et par quoi.
 *
 * POURQUOI CE MODULE EXISTE. Jusqu'ici la chaîne était :
 * données → observations → PROMPT → le modèle invente les problèmes → le moteur
 * les score et les priorise. Le modèle était donc la source des constats. Un
 * modèle est excellent pour formuler et relier ; il est structurellement
 * incapable de garantir qu'un seuil a été appliqué de la même façon deux fois
 * de suite, ni qu'un constat repose sur une donnée réellement lue.
 *
 * La chaîne devient :
 * données → observations → RÈGLES → constats → scores → priorités → modèle →
 * rapport. Le modèle synthétise, explique, relie. Il ne décide plus de ce qui
 * est vrai.
 *
 * TROIS PROPRIÉTÉS QUE CE MODULE GARANTIT, ET QU'UN PROMPT NE PEUT PAS GARANTIR
 *
 * 1. **Aucun constat sans preuve.** Une règle nomme les observations dont elle
 *    dépend. Si l'une manque, elle ne se déclenche pas — elle déclare la donnée
 *    manquante. Elle ne se rabat jamais sur une valeur par défaut.
 *
 * 2. **Un fait technique reste un fait technique.** Une page lente est une
 *    mesure ; « la lenteur coûte des ventes » est une conclusion d'un autre
 *    ordre. Les règles techniques plafonnent donc à « à vérifier » tant
 *    qu'aucune observation commerciale ne corrobore. C'est la règle absolue du
 *    moteur, ici mécanisée plutôt que recommandée.
 *
 * 3. **Chaque point de score est traçable.** Un axe part de 100 et ne perd des
 *    points que par des retenues nommées, chacune rattachée à une règle et à
 *    ses preuves. Un score que l'on ne peut pas décomposer n'est pas un score,
 *    c'est une impression.
 *
 * Module PUR : aucune entrée-sortie, aucun appel réseau, aucune horloge.
 */

import type { Observation, ObservationGap } from "@/lib/observations";

// ---------------------------------------------------------------------------
// Axes
// ---------------------------------------------------------------------------

/**
 * Les dix axes du diagnostic.
 *
 * Ils ne remplacent pas les `Category` du scoring existant : celles-ci classent
 * un problème par le domaine du marchand qu'il concerne, ceux-ci notent la
 * santé d'une fonction de la boutique. Un même constat peut donc peser sur un
 * axe et être rangé dans une catégorie différente.
 */
export const AUDIT_AXES = [
  "acquisition",
  "conversion",
  "merchandising",
  "offre",
  "ux",
  "trust",
  "seo",
  "retention",
  "technique",
  "data",
] as const;

export type AuditAxis = (typeof AUDIT_AXES)[number];

export const AXIS_LABELS: Record<AuditAxis, string> = {
  acquisition: "Acquisition",
  conversion: "Conversion",
  merchandising: "Merchandising",
  offre: "Offre",
  ux: "UX",
  trust: "Confiance",
  seo: "SEO",
  retention: "Rétention",
  technique: "Technique",
  data: "Données & tracking",
};

// ---------------------------------------------------------------------------
// Niveau de preuve
// ---------------------------------------------------------------------------

/**
 * Ce que le moteur a le droit d'affirmer.
 *
 * L'ordre compte : il est décroissant, et aucune étape du moteur n'a le droit
 * de faire remonter un constat dans cette échelle. Seule une preuve
 * supplémentaire le peut, et elle passe par une règle.
 */
export const EVIDENCE_LEVELS = [
  "prouve",
  "fortement_suggere",
  "a_verifier",
  "donnee_insuffisante",
] as const;

export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export const EVIDENCE_LABELS: Record<EvidenceLevel, string> = {
  prouve: "PROUVÉ",
  fortement_suggere: "FORTEMENT SUGGÉRÉ",
  a_verifier: "À VÉRIFIER",
  donnee_insuffisante: "DONNÉE INSUFFISANTE",
};

/**
 * Poids d'un niveau dans le score et la priorité.
 *
 * « Donnée insuffisante » vaut zéro : une absence de mesure ne fait pas perdre
 * de points sur l'axe qu'elle concerne. Elle en fait perdre sur l'axe `data`,
 * par une règle distincte — c'est là qu'un trou de mesure est un vrai défaut.
 */
export const EVIDENCE_WEIGHT: Record<EvidenceLevel, number> = {
  prouve: 1,
  fortement_suggere: 0.6,
  a_verifier: 0.25,
  donnee_insuffisante: 0,
};

/** Plafond des règles purement techniques, tant que rien ne corrobore. */
export const TECHNICAL_CEILING: EvidenceLevel = "a_verifier";

/** Abaisse un niveau au plafond, jamais l'inverse. */
export function capLevel(level: EvidenceLevel, ceiling: EvidenceLevel): EvidenceLevel {
  return EVIDENCE_LEVELS.indexOf(level) >= EVIDENCE_LEVELS.indexOf(ceiling) ? level : ceiling;
}

// ---------------------------------------------------------------------------
// Seuils
// ---------------------------------------------------------------------------

/**
 * LES SEUILS, TOUS AU MÊME ENDROIT, AVEC LEUR ORIGINE.
 *
 * Un seuil dispersé dans le code est un seuil que personne ne peut discuter.
 * Chacun porte ici sa justification. Aucun n'est présenté comme une moyenne du
 * marché : ce sont des seuils de DÉCLENCHEMENT, pas des références chiffrées —
 * la distinction est exactement celle qui sépare une règle honnête d'un
 * benchmark inventé.
 */
export const THRESHOLDS = {
  /** En dessous, un taux n'est pas calculable honnêtement. */
  MIN_ORDERS_FOR_RATES: 20,
  /** En dessous, une part de catalogue ne veut rien dire. */
  MIN_PRODUCTS_FOR_SHARES: 5,
  /** Sessions minimales avant de parler de conversion. */
  MIN_SESSIONS_FOR_CONVERSION: 300,
  /** Part de fiches sans description au-delà de laquelle c'est systémique. */
  DESCRIPTIONS_MISSING_SHARE: 0.3,
  /** Part de produits en rupture au-delà de laquelle l'offre se vide. */
  OUT_OF_STOCK_SHARE: 0.2,
  /** Concentration du chiffre sur un seul produit. */
  TOP_PRODUCT_SHARE: 0.6,
  /** Dépendance à une seule source d'acquisition. */
  SINGLE_SOURCE_SHARE: 0.7,
  /** Taux d'abandon panier au-delà duquel la friction est manifeste. */
  CART_ABANDONMENT: 0.75,
  /** Couverture d'attribution en dessous de laquelle on ne conclut pas. */
  MIN_ATTRIBUTION_COVERAGE: 0.4,
  /** Part de commandes de clients revenants en dessous de laquelle la rétention est absente. */
  RETURNING_RATE_LOW: 0.15,
  /** Part de commandes remisées au-delà de laquelle la marge est menacée. */
  DISCOUNTED_SHARE_HIGH: 0.5,
} as const;

// ---------------------------------------------------------------------------
// Constat
// ---------------------------------------------------------------------------

export type RuleAmount = { value: number; currency: string };

export type RuleFinding = {
  /** Identifiant stable de la règle. Préfixé par son axe. */
  ruleId: string;
  axis: AuditAxis;
  /** Le titre, tel qu'il sera lu par le marchand. */
  title: string;
  /** LE CONSTAT, purement factuel. Aucune interprétation. */
  statement: string;
  /** Pourquoi cela freine la croissance. Interprétation assumée, séparée du fait. */
  why: string;
  level: EvidenceLevel;
  /** Identifiants des observations sur lesquelles la règle s'est appuyée. */
  basedOn: string[];
  /** Les phrases de preuve, recopiées mot pour mot depuis les observations. */
  evidence: string[];
  /** Plus petit échantillon parmi les observations utilisées. */
  sample: number | null;
  /** Fenêtre couverte. `0` = état instantané. `null` = non applicable. */
  periodDays: number | null;
  /** 1 (marginal) à 5 (bloquant). */
  impact: number;
  /** 1 (quelques minutes) à 5 (chantier). */
  effort: number;
  /** L'action précise. Jamais « améliorer le SEO ». */
  recommendation: string;
  /** Impact chiffré, UNIQUEMENT s'il se calcule. Jamais estimé. */
  amount?: RuleAmount | null;
  /**
   * Axes que cette absence de donnée rend NON NOTABLES.
   *
   * POURQUOI C'EST NÉCESSAIRE. Sans trafic mesuré, l'axe Conversion sortait à
   * 100/100 — aucune règle de conversion ne s'était déclenchée, faute
   * d'entrées — et cette note parfaite remontait dans le score global. Une
   * boutique dont on ne peut rien dire obtenait ainsi une bonne note. Un
   * constat « donnée insuffisante » désigne donc les axes qu'il aveugle, et
   * ceux-là ne sont plus notés du tout.
   */
  blocksAxes?: AuditAxis[];
};

export type RuleContext = {
  observations: Observation[];
  gaps: ObservationGap[];
  currency: string | null;
};

/** Une règle : ce dont elle a besoin, et ce qu'elle conclut. */
export type Rule = {
  id: string;
  axis: AuditAxis;
  /** Observations sans lesquelles la règle ne peut pas se prononcer. */
  requires: string[];
  /**
   * Purement technique ? Alors son niveau plafonne à « à vérifier » tant
   * qu'aucune observation commerciale ne corrobore.
   */
  technical?: boolean;
  evaluate: (ctx: RuleContext) => RuleFinding | null;
};

// ---------------------------------------------------------------------------
// Aides
// ---------------------------------------------------------------------------

function obs(ctx: RuleContext, id: string): Observation | undefined {
  return ctx.observations.find((o) => o.id === id);
}

function num(ctx: RuleContext, id: string): number | null {
  const o = obs(ctx, id);
  return o && o.value !== null && Number.isFinite(o.value) ? o.value : null;
}

/**
 * Lit une observation comme une PART, entre 0 et 1.
 *
 * POURQUOI CETTE FONCTION EXISTE. Les sources n'ont pas de convention commune :
 * certaines renvoient `0.75`, d'autres `75`. La normalisation naïve
 * — `x > 1 ? x / 100 : x` — marche sur les deux et produit une absurdité sur
 * tout le reste : un taux corrompu à `9999` devenait « 9999 % » dans un constat
 * envoyé au marchand, et un taux négatif « -500 % ». Un test l'a pris.
 *
 * UNE PART HORS DE [0, 1] N'EST PAS UNE PART. Elle ne se corrige pas — on ne
 * sait pas ce qu'elle voulait dire — et elle ne se publie pas. Elle rend
 * `null`, ce qui fait taire la règle : c'est le seul comportement qui ne
 * fabrique rien.
 */
export function ratio(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const normalised = value > 1 ? value / 100 : value;
  if (normalised < 0 || normalised > 1) return null;
  return normalised;
}

/** Preuves et échantillon d'un jeu d'observations, sans rien inventer. */
function trace(ctx: RuleContext, ids: string[]) {
  const used = ids.map((id) => obs(ctx, id)).filter((o): o is Observation => Boolean(o));
  const samples = used.map((o) => o.sample).filter((s): s is number => typeof s === "number");
  const periods = used.map((o) => o.periodDays).filter((p) => typeof p === "number");
  return {
    basedOn: used.map((o) => o.id),
    evidence: used.map((o) => o.evidence),
    sample: samples.length > 0 ? Math.min(...samples) : null,
    periodDays: periods.length > 0 ? Math.max(...periods) : null,
  };
}

/**
 * Une observation commerciale existe-t-elle et est-elle mesurée ?
 *
 * C'est le test qui autorise — ou non — une règle technique à sortir de
 * « à vérifier ». Il ne suffit pas que la donnée existe : elle doit porter une
 * valeur. Une observation à `null` est une absence, pas une corroboration.
 */
export function hasBusinessCorroboration(ctx: RuleContext, ids: string[]): boolean {
  return ids.some((id) => num(ctx, id) !== null);
}

// ---------------------------------------------------------------------------
// Les règles
// ---------------------------------------------------------------------------

/**
 * Fabrique un constat en appliquant le plafond technique.
 *
 * Passer par ici est obligatoire : c'est le seul endroit où le plafond est
 * appliqué, donc le seul endroit où l'oublier serait possible. Une règle qui
 * construirait son objet à la main contournerait la règle absolue — et c'est
 * exactement ce qu'un test vérifie.
 */
function emit(rule: Rule, finding: Omit<RuleFinding, "ruleId" | "axis">): RuleFinding {
  return {
    ruleId: rule.id,
    axis: rule.axis,
    ...finding,
    level: rule.technical ? capLevel(finding.level, TECHNICAL_CEILING) : finding.level,
  };
}

/** Observations commerciales qui peuvent corroborer un fait technique. */
const BUSINESS_SIGNALS = [
  "shopify.orders_30d",
  "shopify.revenue_30d",
  "shopify.sessions_30d",
  "shopify.cart_abandonment_rate",
  "meta.purchases_30d",
  "google.conversions_30d",
];

export const RULES: Rule[] = [
  // --- Conversion ----------------------------------------------------------
  {
    id: "conversion.traffic_without_orders",
    axis: "conversion",
    requires: ["shopify.sessions_30d", "shopify.orders_30d"],
    evaluate: (ctx) => {
      const sessions = num(ctx, "shopify.sessions_30d");
      const orders = num(ctx, "shopify.orders_30d");
      if (sessions === null || orders === null) return null;
      if (sessions < THRESHOLDS.MIN_SESSIONS_FOR_CONVERSION || orders > 0) return null;
      const t = trace(ctx, ["shopify.sessions_30d", "shopify.orders_30d"]);
      return emit(RULES_BY_ID["conversion.traffic_without_orders"], {
        title: "Du trafic, aucune commande",
        statement: `${sessions} sessions sur la période et aucune commande payée.`,
        why: "Le trafic est acquis mais rien ne se transforme : la perte est intégralement située après l'arrivée sur le site, pas dans l'acquisition.",
        level: "prouve",
        ...t,
        impact: 5,
        effort: 3,
        recommendation:
          "Passer une commande test de bout en bout, en payant réellement, pour identifier l'étape qui bloque : ajout au panier, page panier, ou paiement.",
      });
    },
  },
  {
    id: "conversion.cart_abandonment_high",
    axis: "conversion",
    requires: ["shopify.cart_abandonment_rate"],
    evaluate: (ctx) => {
      const rate = num(ctx, "shopify.cart_abandonment_rate");
      const orders = num(ctx, "shopify.orders_30d");
      if (rate === null) return null;
      const part = ratio(rate);
      if (part === null || part < THRESHOLDS.CART_ABANDONMENT) return null;
      if (orders !== null && orders < THRESHOLDS.MIN_ORDERS_FOR_RATES) return null;
      const t = trace(ctx, ["shopify.cart_abandonment_rate", "shopify.orders_30d"]);
      return emit(RULES_BY_ID["conversion.cart_abandonment_high"], {
        title: "Le panier se vide avant le paiement",
        statement: `${Math.round(part * 100)} % des paniers ouverts n'aboutissent pas à une commande.`,
        why: "Ces visiteurs ont déjà choisi un produit : ils sont la population la plus proche de l'achat, et la moins chère à récupérer.",
        level: "prouve",
        ...t,
        impact: 4,
        effort: 2,
        recommendation:
          "Afficher les frais de livraison et le délai sur la page produit, avant le panier : la découverte tardive des frais est la première cause d'abandon mesurée.",
      });
    },
  },

  /**
   * LA RÈGLE QUI LOCALISE LA FUITE.
   *
   * C'est celle qui sépare un audit d'un constat. « Ça ne convertit pas » ne
   * dit rien : la correction n'est pas la même selon que le visiteur parte
   * avant d'ajouter au panier (l'offre, la fiche, le prix), entre le panier et
   * la caisse (les frais, la confiance), ou dans la caisse (le paiement, la
   * livraison). Envoyer un marchand refaire son tunnel quand son problème est
   * une fiche produit lui coûte des semaines.
   *
   * Elle ne se prononce QUE sur des marches réellement mesurées de part et
   * d'autre : une marche à trou est sautée, jamais franchie.
   */
  {
    id: "conversion.leak_located",
    axis: "conversion",
    requires: ["shopify.sessions_30d"],
    evaluate: (ctx) => {
      const sessions = num(ctx, "shopify.sessions_30d");
      if (sessions === null || sessions < THRESHOLDS.MIN_SESSIONS_FOR_CONVERSION) return null;

      const marches: Array<{
        from: string;
        to: string;
        amontId: string;
        avalId: string;
        cause: string;
        action: string;
      }> = [
        {
          from: "l'arrivée sur le site",
          to: "l'ajout au panier",
          amontId: "shopify.sessions_30d",
          avalId: "shopify.sessions_with_cart_30d",
          cause:
            "À cette marche, ce qui bloque est ce que le visiteur lit avant de décider : la promesse de la page, la fiche produit, le prix affiché, les photos. Le tunnel de commande n'est pas en cause — il n'a pas encore été atteint.",
          action:
            "Ouvrir la page produit la plus visitée sur un téléphone et vérifier, dans l'ordre : le prix est-il visible sans faire défiler, le bouton d'ajout au panier est-il atteignable sans défiler, et une phrase dit-elle à qui le produit s'adresse.",
        },
        {
          from: "l'ajout au panier",
          to: "l'entrée en caisse",
          amontId: "shopify.sessions_with_cart_30d",
          avalId: "shopify.sessions_reached_checkout_30d",
          cause:
            "Le visiteur a choisi son produit puis a renoncé avant de payer. À cette marche, la cause est presque toujours une information découverte trop tard — frais de livraison, délai, ou absence de réassurance sur le paiement.",
          action:
            "Afficher le montant des frais de livraison et le délai sur la page produit, avant le panier, plutôt qu'au moment du paiement.",
        },
        {
          from: "l'entrée en caisse",
          to: "le paiement",
          amontId: "shopify.sessions_reached_checkout_30d",
          avalId: "shopify.sessions_completed_checkout_30d",
          cause:
            "Le visiteur était dans la caisse, décidé, et n'a pas terminé. À cette marche, la cause est mécanique : moyen de paiement absent, champ qui refuse une saisie, ou frais qui apparaissent à la dernière étape.",
          action:
            "Passer une commande test réelle jusqu'au paiement, depuis un téléphone, et noter l'étape exacte où quelque chose surprend ou bloque.",
        },
      ];

      let pire: {
        m: (typeof marches)[number];
        perdu: number;
        taux: number;
        amont: number;
        aval: number;
      } | null = null;

      for (const m of marches) {
        const amont = num(ctx, m.amontId);
        const aval = num(ctx, m.avalId);
        // Les deux bouts doivent être mesurés. Sinon on saute : chercher la
        // fuite au travers d'un trou revient à l'imputer au hasard.
        if (amont === null || aval === null || amont <= 0) continue;
        const perdu = amont - aval;
        if (perdu <= 0) continue;
        const taux = perdu / amont;
        if (!Number.isFinite(taux) || taux < 0 || taux > 1) continue;
        // La plus grande perte ABSOLUE, pas le pire taux : perdre 80 % de dix
        // personnes n'est pas un problème, perdre 40 % de mille en est un.
        if (!pire || perdu > pire.perdu) pire = { m, perdu, taux, amont, aval };
      }
      if (!pire) return null;

      const t = trace(ctx, [pire.m.amontId, pire.m.avalId, "shopify.sessions_30d"]);
      return emit(RULES_BY_ID["conversion.leak_located"], {
        title: `La fuite se situe entre ${pire.m.from} et ${pire.m.to}`,
        statement: `${pire.perdu} sessions sur ${pire.amont} s'arrêtent entre ${pire.m.from} et ${pire.m.to}, soit ${Math.round(pire.taux * 100)} %. C'est la marche où le volume perdu est le plus important.`,
        why: pire.m.cause,
        level: "prouve",
        ...t,
        impact: 5,
        effort: 2,
        recommendation: pire.m.action,
      });
    },
  },

  // --- Acquisition ---------------------------------------------------------
  {
    id: "acquisition.spend_without_purchase",
    axis: "acquisition",
    requires: ["meta.spend_30d", "meta.purchases_30d"],
    evaluate: (ctx) => {
      const spend = num(ctx, "meta.spend_30d");
      const purchases = num(ctx, "meta.purchases_30d");
      if (spend === null || purchases === null) return null;
      if (spend <= 0 || purchases > 0) return null;
      const t = trace(ctx, ["meta.spend_30d", "meta.purchases_30d"]);
      return emit(RULES_BY_ID["acquisition.spend_without_purchase"], {
        title: "Budget publicitaire dépensé sans un seul achat",
        statement: `${spend} dépensés sur Meta, zéro achat attribué sur la période.`,
        why: "Chaque jour supplémentaire reproduit la perte à l'identique tant que la cause n'est pas isolée.",
        level: "prouve",
        ...t,
        impact: 5,
        effort: 2,
        amount: ctx.currency ? { value: spend, currency: ctx.currency } : null,
        recommendation:
          "Mettre en pause les ensembles de publicités sans achat depuis plus de sept jours, et vérifier que le pixel enregistre bien l'événement Achat avant de relancer.",
      });
    },
  },
  {
    id: "acquisition.single_source_dependency",
    axis: "acquisition",
    requires: ["organic.non_paid_order_share", "organic.attribution_coverage"],
    evaluate: (ctx) => {
      const share = num(ctx, "organic.non_paid_order_share");
      const coverage = num(ctx, "organic.attribution_coverage");
      if (share === null || coverage === null) return null;
      const cov = ratio(coverage);
      const part = ratio(share);
      if (cov === null || part === null) return null;
      if (cov < THRESHOLDS.MIN_ATTRIBUTION_COVERAGE) return null;
      const dominant = Math.max(part, 1 - part);
      if (dominant < THRESHOLDS.SINGLE_SOURCE_SHARE) return null;
      const t = trace(ctx, ["organic.non_paid_order_share", "organic.attribution_coverage"]);
      return emit(RULES_BY_ID["acquisition.single_source_dependency"], {
        title: "Presque toutes les commandes viennent d'une seule origine",
        statement: `${Math.round(dominant * 100)} % des commandes tracées proviennent d'un seul type de source, sur une couverture d'attribution de ${Math.round(cov * 100)} %.`,
        why: "Une source unique est un point de rupture : une modification d'algorithme ou de compte publicitaire suffit à effacer le chiffre d'affaires.",
        level: "fortement_suggere",
        ...t,
        impact: 3,
        effort: 4,
        recommendation:
          "Ouvrir un second canal mesurable avant que le premier ne bouge — au minimum une collecte d'e-mails sur le site, dont l'audience vous appartient.",
      });
    },
  },

  // --- Merchandising -------------------------------------------------------
  {
    id: "merchandising.descriptions_missing",
    axis: "merchandising",
    requires: ["shopify.products_without_description", "shopify.product_count"],
    evaluate: (ctx) => {
      const missing = num(ctx, "shopify.products_without_description");
      const total = num(ctx, "shopify.product_count");
      if (missing === null || total === null || total < THRESHOLDS.MIN_PRODUCTS_FOR_SHARES) {
        return null;
      }
      const share = missing / total;
      if (share < THRESHOLDS.DESCRIPTIONS_MISSING_SHARE) return null;
      const t = trace(ctx, ["shopify.products_without_description", "shopify.product_count"]);
      return emit(RULES_BY_ID["merchandising.descriptions_missing"], {
        title: "Les fiches produit n'expliquent pas ce qu'on achète",
        statement: `${missing} fiches sur ${total} n'ont aucun texte descriptif.`,
        why: "Sans description, la fiche ne répond à aucune objection et ne donne aucune raison de préférer ce produit : le visiteur n'a rien à lire entre l'image et le prix.",
        level: "prouve",
        ...t,
        impact: 4,
        effort: 3,
        recommendation:
          "Écrire d'abord les fiches des produits qui reçoivent déjà du trafic, en trois blocs : à qui c'est destiné, ce que ça change concrètement, ce qu'il y a dans la boîte.",
      });
    },
  },
  {
    id: "merchandising.images_missing",
    axis: "merchandising",
    requires: ["shopify.products_without_image", "shopify.product_count"],
    evaluate: (ctx) => {
      const missing = num(ctx, "shopify.products_without_image");
      const total = num(ctx, "shopify.product_count");
      if (missing === null || total === null || missing <= 0) return null;
      const t = trace(ctx, ["shopify.products_without_image", "shopify.product_count"]);
      return emit(RULES_BY_ID["merchandising.images_missing"], {
        title: "Des produits sans aucun visuel",
        statement: `${missing} fiche(s) sur ${total} n'ont aucune image.`,
        why: "Une fiche sans visuel n'est pas comparable aux autres et ne peut pas être achetée : c'est le seul défaut de catalogue qui rend un produit littéralement invendable.",
        level: "prouve",
        ...t,
        impact: 3,
        effort: 1,
        recommendation:
          "Ajouter au moins une photo par fiche concernée, ou masquer ces produits tant qu'ils n'en ont pas.",
      });
    },
  },
  {
    id: "merchandising.out_of_stock_share",
    axis: "merchandising",
    requires: ["shopify.products_out_of_stock", "shopify.product_count"],
    evaluate: (ctx) => {
      const oos = num(ctx, "shopify.products_out_of_stock");
      const total = num(ctx, "shopify.product_count");
      if (oos === null || total === null || total < THRESHOLDS.MIN_PRODUCTS_FOR_SHARES) return null;
      const share = oos / total;
      if (share < THRESHOLDS.OUT_OF_STOCK_SHARE) return null;
      const t = trace(ctx, ["shopify.products_out_of_stock", "shopify.product_count"]);
      return emit(RULES_BY_ID["merchandising.out_of_stock_share"], {
        title: "Une part importante du catalogue est en rupture",
        statement: `${oos} produits sur ${total} ont toutes leurs variantes à zéro.`,
        why: "Un visiteur qui tombe sur une rupture ne revient pas au catalogue : il quitte. Chaque fiche en rupture encore visible est une sortie de site.",
        level: "prouve",
        ...t,
        impact: 3,
        effort: 2,
        recommendation:
          "Retirer ces produits des collections mises en avant tant que le stock n'est pas revenu, et proposer une alternative sur la fiche plutôt qu'un simple « épuisé ».",
      });
    },
  },
  {
    id: "merchandising.catalog_concentration",
    axis: "merchandising",
    requires: ["shopify.top_product_revenue_share", "shopify.orders_30d"],
    evaluate: (ctx) => {
      const share = num(ctx, "shopify.top_product_revenue_share");
      const orders = num(ctx, "shopify.orders_30d");
      if (share === null || orders === null) return null;
      if (orders < THRESHOLDS.MIN_ORDERS_FOR_RATES) return null;
      const part = ratio(share);
      if (part === null || part < THRESHOLDS.TOP_PRODUCT_SHARE) return null;
      const t = trace(ctx, ["shopify.top_product_revenue_share", "shopify.orders_30d"]);
      return emit(RULES_BY_ID["merchandising.catalog_concentration"], {
        title: "Le chiffre repose sur un seul produit",
        statement: `${Math.round(part * 100)} % du chiffre d'affaires vient d'un seul produit, sur ${orders} commandes.`,
        why: "Une rupture, un litige fournisseur ou une saisonnalité sur ce produit efface la majorité du chiffre d'affaires d'un coup.",
        level: "prouve",
        ...t,
        impact: 3,
        effort: 4,
        recommendation:
          "Identifier le produit le plus proche de celui-ci en usage, et lui donner la même qualité de fiche et la même place en page d'accueil.",
      });
    },
  },

  // --- Offre ---------------------------------------------------------------
  {
    id: "offre.discount_dependency",
    axis: "offre",
    requires: ["shopify.discounted_order_share", "shopify.orders_30d"],
    evaluate: (ctx) => {
      const share = num(ctx, "shopify.discounted_order_share");
      const orders = num(ctx, "shopify.orders_30d");
      if (share === null || orders === null) return null;
      if (orders < THRESHOLDS.MIN_ORDERS_FOR_RATES) return null;
      const part = ratio(share);
      if (part === null || part < THRESHOLDS.DISCOUNTED_SHARE_HIGH) return null;
      const t = trace(ctx, ["shopify.discounted_order_share", "shopify.orders_30d"]);
      return emit(RULES_BY_ID["offre.discount_dependency"], {
        title: "La majorité des ventes passe par une remise",
        statement: `${Math.round(part * 100)} % des commandes portent un code de réduction, sur ${orders} commandes.`,
        why: "Quand la remise devient la norme, elle cesse d'être un levier : elle devient le prix réel, et la marge est structurellement amputée.",
        level: "prouve",
        ...t,
        impact: 3,
        effort: 3,
        recommendation:
          "Retirer le code permanent et le remplacer par une contrepartie : livraison offerte au-delà d'un montant, ou remise sur le deuxième article.",
      });
    },
  },

  // --- Confiance -----------------------------------------------------------
  {
    id: "trust.policy_pages_missing",
    axis: "trust",
    requires: ["storefront.policy_pages"],
    technical: true,
    evaluate: (ctx) => {
      const pages = num(ctx, "storefront.policy_pages");
      if (pages === null || pages > 0) return null;
      const t = trace(ctx, ["storefront.policy_pages"]);
      return emit(RULES_BY_ID["trust.policy_pages_missing"], {
        title: "Aucune page de politique accessible",
        statement:
          "Aucune page de livraison, de retour ou de conditions n'a été trouvée sur le site public.",
        why: "Ce sont les pages que l'acheteur hésitant cherche avant de payer. Leur absence est aussi un motif de refus à la publication sur les régies publicitaires.",
        level: "prouve",
        ...t,
        impact: 3,
        effort: 1,
        recommendation:
          "Publier trois pages et les lier depuis le pied de page : livraison (délai et prix), retours (délai et procédure), mentions légales.",
      });
    },
  },

  // --- SEO -----------------------------------------------------------------
  {
    id: "seo.robots_blocks_all",
    axis: "seo",
    requires: ["storefront.robots_blocks_all"],
    technical: true,
    evaluate: (ctx) => {
      const blocked = num(ctx, "storefront.robots_blocks_all");
      if (blocked === null || blocked <= 0) return null;
      const t = trace(ctx, ["storefront.robots_blocks_all"]);
      return emit(RULES_BY_ID["seo.robots_blocks_all"], {
        title: "Le site interdit son indexation",
        statement: "Le fichier robots.txt interdit l'exploration de l'ensemble du site.",
        why: "Aucune page ne peut apparaître dans les résultats de recherche tant que cette ligne est en place : la totalité du canal naturel est fermée.",
        level: "prouve",
        ...t,
        impact: 5,
        effort: 1,
        recommendation:
          "Retirer la directive `Disallow: /` du robots.txt, puis demander une réindexation dans la Search Console.",
      });
    },
  },
  {
    id: "seo.structured_data_missing",
    axis: "seo",
    requires: ["storefront.product_structured_data"],
    technical: true,
    evaluate: (ctx) => {
      const present = num(ctx, "storefront.product_structured_data");
      if (present === null || present > 0) return null;
      const t = trace(ctx, ["storefront.product_structured_data"]);
      return emit(RULES_BY_ID["seo.structured_data_missing"], {
        title: "Les fiches produit n'exposent pas de données structurées",
        statement: "Aucune donnée structurée produit n'a été trouvée sur la page produit examinée.",
        why: "Sans elles, les résultats de recherche n'affichent ni prix ni disponibilité : la ligne est moins cliquée à position égale.",
        level: "prouve",
        ...t,
        impact: 2,
        effort: 2,
        recommendation:
          "Activer les données structurées Produit dans le thème, en vérifiant que prix, devise et disponibilité y figurent.",
      });
    },
  },

  // --- Technique -----------------------------------------------------------
  {
    id: "technique.broken_pages",
    axis: "technique",
    requires: ["storefront.broken_pages"],
    technical: true,
    evaluate: (ctx) => {
      const broken = num(ctx, "storefront.broken_pages");
      if (broken === null || broken <= 0) return null;
      const t = trace(ctx, ["storefront.broken_pages"]);
      return emit(RULES_BY_ID["technique.broken_pages"], {
        title: "Des pages du parcours ne répondent pas",
        statement: `${broken} page(s) du parcours d'achat ont répondu par une erreur.`,
        why: "Une page en erreur dans le parcours interrompt la visite là où elle se produit, sans que le visiteur puisse contourner.",
        level: "prouve",
        ...t,
        impact: 4,
        effort: 2,
        recommendation:
          "Ouvrir chacune de ces adresses, corriger le lien ou republier la page, puis revérifier depuis un navigateur en navigation privée.",
      });
    },
  },
  {
    id: "ux.mobile_viewport_missing",
    axis: "ux",
    requires: ["storefront.mobile_viewport"],
    technical: true,
    evaluate: (ctx) => {
      const viewport = num(ctx, "storefront.mobile_viewport");
      if (viewport === null || viewport > 0) return null;
      const t = trace(ctx, ["storefront.mobile_viewport"]);
      return emit(RULES_BY_ID["ux.mobile_viewport_missing"], {
        title: "La page n'est pas déclarée adaptée au mobile",
        statement: "La balise viewport est absente de la page d'accueil.",
        why: "Sans elle, le téléphone affiche la version bureau réduite : les textes deviennent illisibles et les boutons trop petits pour être touchés.",
        level: "prouve",
        ...t,
        impact: 4,
        effort: 1,
        recommendation:
          "Ajouter la balise viewport dans l'en-tête du thème, puis vérifier la page d'accueil sur un téléphone réel.",
      });
    },
  },

  // --- Données & tracking --------------------------------------------------
  {
    id: "data.traffic_unmeasured",
    axis: "data",
    requires: [],
    evaluate: (ctx) => {
      const sessions = num(ctx, "shopify.sessions_30d");
      if (sessions !== null) return null;
      const gap = ctx.gaps.find((g) => g.id === "shopify.sessions_30d");
      if (!gap) return null;
      return emit(RULES_BY_ID["data.traffic_unmeasured"], {
        title: "Le trafic n'est pas mesuré",
        statement: "Aucune donnée de sessions n'est disponible sur la période.",
        why: "Sans trafic mesuré, aucun taux de conversion ne peut être calculé : il devient impossible de distinguer une boutique qui ne reçoit personne d'une boutique qui ne transforme pas. C'est la donnée qui manque le plus au diagnostic.",
        level: "donnee_insuffisante",
        basedOn: [],
        evidence: [gap.reason],
        sample: null,
        periodDays: null,
        impact: 4,
        effort: 2,
        // Sans trafic, ni la conversion ni l'UX ne peuvent être notées : les
        // deux dépendent d'un dénominateur qui n'existe pas.
        blocksAxes: ["conversion", "ux"],
        recommendation:
          "Connecter une mesure d'audience sur la boutique, puis laisser passer une période complète avant de relancer un diagnostic de conversion.",
      });
    },
  },
  {
    id: "data.attribution_coverage_low",
    axis: "data",
    requires: ["organic.attribution_coverage"],
    evaluate: (ctx) => {
      const coverage = num(ctx, "organic.attribution_coverage");
      if (coverage === null) return null;
      const cov = ratio(coverage);
      if (cov === null || cov >= THRESHOLDS.MIN_ATTRIBUTION_COVERAGE) return null;
      const t = trace(ctx, ["organic.attribution_coverage"]);
      return emit(RULES_BY_ID["data.attribution_coverage_low"], {
        title: "L'origine des commandes est majoritairement inconnue",
        statement: `Seules ${Math.round(cov * 100)} % des commandes portent une trace de provenance.`,
        why: "Sans origine, le retour sur investissement déclaré par les régies ne peut être ni confirmé ni contredit : le budget publicitaire est piloté à l'aveugle.",
        level: "prouve",
        ...t,
        impact: 3,
        effort: 3,
        recommendation:
          "Ajouter les paramètres de campagne (utm_source, utm_medium) sur tous les liens publicitaires et sur les liens en signature d'e-mail.",
      });
    },
  },

  // --- Rétention -----------------------------------------------------------
  {
    id: "retention.returning_rate_low",
    axis: "retention",
    requires: ["shopify.returning_customer_rate", "shopify.orders_30d"],
    evaluate: (ctx) => {
      const rate = num(ctx, "shopify.returning_customer_rate");
      const orders = num(ctx, "shopify.orders_30d");
      if (rate === null || orders === null) return null;
      if (orders < THRESHOLDS.MIN_ORDERS_FOR_RATES) return null;
      const part = ratio(rate);
      if (part === null || part >= THRESHOLDS.RETURNING_RATE_LOW) return null;
      const t = trace(ctx, ["shopify.returning_customer_rate", "shopify.orders_30d"]);
      return emit(RULES_BY_ID["retention.returning_rate_low"], {
        title: "Presque aucun client ne revient",
        statement: `${Math.round(part * 100)} % des commandes viennent d'un client déjà venu, sur ${orders} commandes.`,
        why: "Chaque vente doit alors être payée à nouveau en acquisition : le coût par commande ne baisse jamais, quelle que soit l'ancienneté de la boutique.",
        level: "prouve",
        ...t,
        impact: 4,
        effort: 3,
        recommendation:
          "Envoyer un e-mail unique à J+21 après livraison, proposant le consommable ou l'accessoire du produit acheté.",
      });
    },
  },
];

/** Index par identifiant. Une règle se référence elle-même dans `emit`. */
const RULES_BY_ID: Record<string, Rule> = Object.fromEntries(RULES.map((r) => [r.id, r]));

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

/**
 * Applique toutes les règles.
 *
 * UNE RÈGLE QUI ÉCHOUE N'EMPORTE PAS LES AUTRES. Un audit à moitié produit vaut
 * infiniment mieux qu'un audit perdu : le marchand a déjà payé son passage.
 */
export function runRules(ctx: RuleContext): RuleFinding[] {
  const out: RuleFinding[] = [];
  for (const rule of RULES) {
    // Une règle ne se prononce jamais sans ses entrées. Le test est ici, hors
    // de la règle, pour qu'aucune ne puisse l'oublier.
    const missing = rule.requires.filter((id) => num(ctx, id) === null);
    if (missing.length > 0 && rule.requires.length > 0) continue;
    try {
      const finding = rule.evaluate(ctx);
      if (finding) out.push(finding);
    } catch {
      // Une règle défectueuse est un défaut de code, pas un constat.
      continue;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

export type ScoreDeduction = {
  ruleId: string;
  title: string;
  points: number;
  level: EvidenceLevel;
};

export type AxisScore = {
  axis: AuditAxis;
  label: string;
  score: number;
  /** Chaque point perdu, rattaché à sa règle. Un score se décompose ou n'est rien. */
  deductions: ScoreDeduction[];
  /** Aucune observation sur cet axe : le score de 100 ne veut alors rien dire. */
  measured: boolean;
};

/** Points retirés par unité d'impact, avant pondération par le niveau de preuve. */
export const POINTS_PER_IMPACT = 8;

/**
 * Note chaque axe.
 *
 * DEUX CHOIX QUI COMPTENT. Un axe sans aucune observation n'est pas noté 100 :
 * il est marqué non mesuré, parce qu'une absence de constat sur une absence de
 * données n'est pas une bonne santé. Et un constat « donnée insuffisante » ne
 * retire aucun point sur son axe — son poids est nul — pour la même raison.
 */
export function scoreAxes(findings: RuleFinding[], observations: Observation[]): AxisScore[] {
  return AUDIT_AXES.map((axis) => {
    const own = findings.filter((f) => f.axis === axis);
    const deductions: ScoreDeduction[] = own
      .map((f) => ({
        ruleId: f.ruleId,
        title: f.title,
        points: Math.round(f.impact * POINTS_PER_IMPACT * EVIDENCE_WEIGHT[f.level]),
        level: f.level,
      }))
      .filter((d) => d.points > 0);

    const lost = deductions.reduce((sum, d) => sum + d.points, 0);
    // Un axe aveuglé par une donnée manquante n'est pas noté, quelle que soit
    // la richesse apparente des observations qui s'y rattachent.
    const aveugle = findings.some((f) => f.blocksAxes?.includes(axis));
    const measured =
      !aveugle &&
      (own.some((f) => f.level !== "donnee_insuffisante") ||
        observations.some((o) => o.value !== null && axisOfObservation(o.id) === axis));

    return {
      axis,
      label: AXIS_LABELS[axis],
      score: Math.max(0, 100 - lost),
      deductions,
      measured,
    };
  });
}

/**
 * Rattache une observation à un axe, par son préfixe et son nom.
 *
 * Volontairement grossier : ce rattachement ne sert qu'à savoir si un axe a été
 * REGARDÉ, jamais à calculer un score. Un score ne vient que des règles.
 */
export function axisOfObservation(id: string): AuditAxis | null {
  if (id.startsWith("meta.") || id.startsWith("google.")) return "acquisition";
  if (id.startsWith("organic.")) return "data";
  if (id.startsWith("storefront.")) {
    if (id.includes("robots") || id.includes("sitemap") || id.includes("structured_data")) {
      return "seo";
    }
    if (id.includes("mobile")) return "ux";
    if (id.includes("policy") || id.includes("reviews")) return "trust";
    return "technique";
  }
  if (id.startsWith("shopify.")) {
    if (id.includes("product") || id.includes("stock")) return "merchandising";
    if (id.includes("price") || id.includes("discount") || id.includes("aov")) return "offre";
    if (id.includes("returning") || id.includes("refund")) return "retention";
    if (id.includes("cart") || id.includes("checkout") || id.includes("sessions")) {
      return "conversion";
    }
    return "conversion";
  }
  return null;
}

/**
 * Score global, moyenne des seuls axes mesurés.
 *
 * Inclure les axes non mesurés à 100 gonflerait la note d'une boutique dont on
 * ne sait rien — exactement l'inverse de ce qu'un diagnostic doit faire.
 */
export function globalScore(axes: AxisScore[]): number | null {
  const measured = axes.filter((a) => a.measured);
  if (measured.length === 0) return null;
  return Math.round(measured.reduce((sum, a) => sum + a.score, 0) / measured.length);
}

// ---------------------------------------------------------------------------
// Priorisation
// ---------------------------------------------------------------------------

export const MAX_PRIORITIES = 7;
export const MIN_PRIORITIES = 3;

export type PrioritisedFinding = RuleFinding & { priority: number; rank: number };

/**
 * Impact × preuve ÷ effort.
 *
 * L'effort divise plutôt qu'il ne soustrait : entre deux problèmes d'impact
 * égal, celui qui se corrige en dix minutes doit passer très loin devant celui
 * qui demande un mois — pas juste un peu devant.
 *
 * Un constat « donnée insuffisante » ne peut jamais être priorisé comme un
 * problème : son poids de preuve est nul, donc sa priorité l'est aussi. Il
 * remonte par l'axe `data`, à sa place.
 */
export function prioritise(findings: RuleFinding[]): PrioritisedFinding[] {
  const scored = findings
    .map((f) => ({
      ...f,
      priority: Math.round((f.impact * EVIDENCE_WEIGHT[f.level] * 100) / Math.max(1, f.effort)),
    }))
    .filter((f) => f.priority > 0)
    .sort((a, b) => b.priority - a.priority || a.ruleId.localeCompare(b.ruleId));

  return scored.slice(0, MAX_PRIORITIES).map((f, i) => ({ ...f, rank: i + 1 }));
}

// ---------------------------------------------------------------------------
// Plan d'action
// ---------------------------------------------------------------------------

export type ActionHorizon = "maintenant" | "cette_semaine" | "ce_mois" | "plus_tard";

export const HORIZON_LABELS: Record<ActionHorizon, string> = {
  maintenant: "Maintenant",
  cette_semaine: "Cette semaine",
  ce_mois: "Ce mois-ci",
  plus_tard: "Plus tard",
};

export type ActionPlan = Record<ActionHorizon, PrioritisedFinding[]>;

/**
 * Range les constats par horizon.
 *
 * « Maintenant » est réservé au fort impact et au faible effort : c'est ce qui
 * se fait dans l'heure et qui se voit. Y mettre un chantier viderait la
 * catégorie de son sens et ferait abandonner le plan dès la première ligne.
 */
export function buildActionPlan(findings: PrioritisedFinding[]): ActionPlan {
  const plan: ActionPlan = { maintenant: [], cette_semaine: [], ce_mois: [], plus_tard: [] };
  for (const f of findings) {
    if (f.impact >= 4 && f.effort <= 2 && plan.maintenant.length < 3) plan.maintenant.push(f);
    else if (f.effort >= 4) plan.ce_mois.push(f);
    else if (plan.cette_semaine.length < 5) plan.cette_semaine.push(f);
    else plan.plus_tard.push(f);
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Rapport déterministe
// ---------------------------------------------------------------------------

export type RuleReport = {
  findings: RuleFinding[];
  priorities: PrioritisedFinding[];
  axes: AxisScore[];
  score: number | null;
  plan: ActionPlan;
  /** Ce que les données n'ont pas permis d'établir, nommément. */
  unresolved: string[];
};

/** Enchaîne règles → scores → priorités → plan. Aucun appel réseau. */
export function analyse(ctx: RuleContext): RuleReport {
  const findings = runRules(ctx);
  const priorities = prioritise(findings);
  const axes = scoreAxes(findings, ctx.observations);
  return {
    findings,
    priorities,
    axes,
    score: globalScore(axes),
    plan: buildActionPlan(priorities),
    unresolved: [
      ...findings.filter((f) => f.level === "donnee_insuffisante").map((f) => f.statement),
      ...ctx.gaps.map((g) => `${g.label} : ${g.reason}`),
    ],
  };
}

// ---------------------------------------------------------------------------
// Transmission au modèle
// ---------------------------------------------------------------------------

/**
 * Ce que le modèle reçoit du moteur.
 *
 * LE RENVERSEMENT TIENT DANS CE BLOC. Le modèle ne reçoit plus des données
 * brutes à interpréter comme il l'entend : il reçoit des CONSTATS déjà établis,
 * chacun avec son niveau de preuve, sa preuve littérale et son score. Sa tâche
 * devient celle d'un rédacteur senior — relier, hiérarchiser le récit,
 * expliquer au marchand ce que cela veut dire pour lui — et non celle d'un
 * analyste à qui l'on demanderait de deviner.
 *
 * Les interdictions sont énoncées comme des interdictions, pas comme des
 * conseils : c'est la seule forme qu'un modèle traite comme contraignante.
 */
export function rulesToPromptBlock(report: RuleReport): string {
  const lignes: string[] = ["CONSTATS ÉTABLIS PAR LE MOTEUR (source de vérité) :"];

  if (report.findings.length === 0) {
    lignes.push(
      "- Aucun constat n'a pu être établi : les données disponibles ne permettent d'appliquer aucune règle.",
    );
  }

  for (const f of report.priorities) {
    lignes.push(
      `\n[${f.rank}] ${f.title} — axe ${AXIS_LABELS[f.axis]} — ${EVIDENCE_LABELS[f.level]}`,
      `  Constat : ${f.statement}`,
      `  Pourquoi cela bloque : ${f.why}`,
      `  Preuve : ${f.evidence.join(" ; ")}`,
      `  Échantillon : ${f.sample ?? "non applicable"} — Période : ${f.periodDays ?? "non applicable"} jour(s)`,
      `  Impact ${f.impact}/5, effort ${f.effort}/5, priorité ${f.priority}`,
      `  Action retenue : ${f.recommendation}`,
      f.amount
        ? `  Montant constaté : ${f.amount.value} ${f.amount.currency}`
        : "  Montant : non calculable",
    );
  }

  lignes.push("\nSCORES PAR AXE (déterministes, décomposés) :");
  for (const a of report.axes) {
    if (!a.measured) {
      lignes.push(`- ${a.label} : NON MESURÉ (donnée manquante — aucune note ne serait honnête)`);
      continue;
    }
    const detail =
      a.deductions.length === 0
        ? "aucune retenue"
        : a.deductions.map((d) => `${d.title} −${d.points}`).join(", ");
    lignes.push(`- ${a.label} : ${a.score}/100 (${detail})`);
  }
  lignes.push(
    `Score global : ${report.score === null ? "non calculable, aucun axe mesuré" : `${report.score}/100`}`,
  );

  if (report.unresolved.length > 0) {
    lignes.push("\nCE QUE LES DONNÉES NE PERMETTENT PAS D'ÉTABLIR :");
    for (const u of report.unresolved) lignes.push(`- ${u}`);
  }

  lignes.push(
    "",
    "RÈGLES ABSOLUES POUR TA RÉPONSE :",
    "- Ces constats sont la source de vérité. Tu les expliques, les relies et les hiérarchises dans le récit. Tu n'en inventes aucun autre.",
    "- Tu ne fais JAMAIS remonter un constat dans l'échelle de preuve. « À VÉRIFIER » reste à vérifier ; « DONNÉE INSUFFISANTE » ne devient jamais un problème confirmé.",
    "- Un fait technique ne devient une explication de perte commerciale que si un constat commercial le corrobore explicitement ci-dessus. Sinon, présente-le comme un fait technique.",
    "- Tu ne chiffres aucun gain qui ne figure pas en « Montant constaté ».",
    "- Tu ne cites aucune moyenne de marché, aucun taux de référence, aucune statistique sectorielle : tu n'en as reçu aucune.",
    "- Ce qui est listé comme non établi doit être présenté au marchand comme une donnée à obtenir, jamais comme un problème.",
  );

  return lignes.join("\n");
}
