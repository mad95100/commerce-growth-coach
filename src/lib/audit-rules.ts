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
// Le seuil de lenteur appartient au module qui la mesure. L'importer plutôt
// que le recopier évite qu'un jour la règle et la mesure ne parlent plus du
// même nombre — le connecteur est pur, cet import n'introduit aucune I/O.
import { SLOW_RESPONSE_MS } from "@/lib/connectors/storefront";

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
  /**
   * Produits en dessous duquel une page de collection ne fait plus choisir.
   *
   * Ce n'est pas une taille de catalogue idéale : c'est le point où la page
   * cesse de remplir sa fonction. À trois articles, il n'y a pas de choix à
   * faire, et le visiteur a autant vite fait d'ouvrir chaque fiche.
   */
  MIN_PRODUCTS_IN_COLLECTION: 4,
  /**
   * Catalogue au-delà duquel naviguer sans filtre devient un défilement.
   *
   * Le compte vient de l'API Admin, pas de la page : une collection paginée
   * affiche vingt-quatre articles quel que soit le catalogue derrière.
   */
  CATALOG_NEEDS_FILTERS: 24,
  /**
   * Pages de politique attendues : remboursement, livraison, conditions.
   *
   * Exactement les trois que le scan interroge. Le seuil n'est donc pas une
   * opinion sur ce qu'il faudrait publier : c'est le nombre de pages dont
   * l'absence a été réellement constatée.
   */
  EXPECTED_POLICY_PAGES: 3,
  /**
   * Part de fiches À CHOIX dont une partie des variantes est épuisée.
   *
   * Le dénominateur est le nombre de fiches qui proposent réellement un choix,
   * pas le catalogue : une boutique de mille produits à variante unique ne peut
   * pas avoir de problème de choix, et le rapporter au catalogue produirait une
   * part minuscule qui masquerait le défaut là où il existe.
   */
  PARTIAL_STOCK_SHARE: 0.25,
  /**
   * Part de fiches dont la disponibilité n'est pas lisible au-delà de laquelle
   * le diagnostic doit le déclarer.
   *
   * En dessous, quelques fiches non suivies ne changent rien à ce qu'on peut
   * conclure. Au-delà, c'est le catalogue entier dont l'état est inconnu, et le
   * taire laisserait croire qu'il a été vérifié.
   */
  STOCK_UNKNOWN_SHARE: 0.3,
  /**
   * Mots au-delà desquels un titre d'onglet dit autre chose que le nom de la
   * boutique. « Atelier Vela » en fait deux ; « Sacs en toile cirée » en fait
   * quatre. Le seuil ne juge pas la qualité du titre — il sépare un nom d'une
   * phrase.
   */
  TITLE_MIN_WORDS: 2,
  /** Même raisonnement pour le titre de niveau 1 de la page d'accueil. */
  PROMISE_MIN_WORDS: 3,
  /**
   * Part de l'ÉCHANTILLON de fiches au-delà de laquelle un manque cesse d'être
   * un accident de page.
   *
   * La moitié, et le raisonnement tient en une phrase : une fiche sur cinq sans
   * mention de livraison est un oubli à corriger sur cette fiche ; trois sur
   * cinq décrivent une façon de tenir le catalogue. La distinction ne se fait
   * pas sur le catalogue entier — nous n'en lisons qu'un échantillon — mais sur
   * ce que nous avons réellement ouvert, et le constat le dit.
   *
   * Une exception assumée : l'ajout au panier absent se signale dès UNE fiche.
   * C'est le seul manque de cette famille qui ne se dilue pas — la page
   * concernée ne peut produire aucune commande, quel que soit l'état des
   * autres.
   */
  PRODUCT_SAMPLE_SHARE: 0.5,
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
  /**
   * Règles que celle-ci REMPLACE lorsqu'elle se déclenche.
   *
   * POURQUOI CE CHAMP EXISTE. Une règle qui fait converger trois observations
   * dit quelque chose que ses trois constituants ne disent pas séparément. Mais
   * si les quatre sortent ensemble, le rapport gagne trois lignes et perd sa
   * lisibilité : le marchand relit trois fois le même problème sous des titres
   * différents, et conclut que l'outil radote. Mieux vaut cinq constats
   * spécifiques que vingt-cinq recommandations qui se recouvrent.
   *
   * L'absorption est déclarée, jamais devinée : on peut donc toujours répondre
   * à « où est passé ce constat ? » — il est dans celui-ci, avec ses preuves.
   */
  absorbs?: string[];
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

// ---------------------------------------------------------------------------
// Portée d'un constat d'échantillon
// ---------------------------------------------------------------------------

/**
 * CE QU'UN ÉCHANTILLON AUTORISE À DIRE, ET RIEN DE PLUS.
 *
 * LE DÉFAUT QUE CE TYPE FERME. Le scan ouvrait une seule fiche produit, et les
 * constats parlaient du catalogue : « les fiches produit n'ont pas de
 * description ». Une phrase vraie de la page lue, fausse de la boutique, et que
 * rien dans le rapport ne permettait de distinguer de l'autre.
 *
 * Quatre portées, et une seule est jamais atteinte par extrapolation : chacune
 * se calcule sur deux nombres réellement comptés — combien de fiches présentent
 * le défaut, combien ont été ouvertes.
 */
export type Portee = "aucune" | "une_fiche" | "plusieurs_fiches" | "toutes_les_inspectees";

export type ScopeReading = {
  portee: Portee;
  /** Fiches présentant le défaut. */
  touchees: number;
  /** Fiches réellement ouvertes. Le dénominateur, jamais implicite. */
  inspectees: number;
  /** La phrase de portée, telle qu'elle entre dans un constat. */
  phrase: string;
  /**
   * Plafond de preuve imposé par la taille de l'échantillon.
   *
   * Une fiche unique ne prouve rien du catalogue : le constat reste « à
   * vérifier », quelle que soit la netteté de ce qui a été lu sur cette page.
   */
  plafond: EvidenceLevel;
};

/**
 * Lit un couple (touchées, inspectées) et rend ce qu'il est permis d'en dire.
 *
 * `total` est le catalogue déclaré par l'API, quand il est connu. Il n'entre
 * jamais dans la conclusion — il sert uniquement à rappeler, dans la phrase,
 * que l'échantillon EST un échantillon. Cinq fiches sur trois cents restent
 * cinq fiches.
 */
export function lirePortee(
  touchees: number | null,
  inspectees: number | null,
  total?: number | null,
): ScopeReading {
  const n = inspectees ?? 0;
  const k = touchees ?? 0;
  if (n <= 0 || k <= 0) {
    return {
      portee: "aucune",
      touchees: 0,
      inspectees: n,
      phrase:
        n <= 0 ? "aucune fiche produit n'a pu être ouverte" : `aucune des ${n} fiches inspectées`,
      plafond: "donnee_insuffisante",
    };
  }
  const surCatalogue =
    typeof total === "number" && total > n ? `, sur un catalogue de ${total} produits` : "";
  if (n === 1) {
    return {
      portee: "une_fiche",
      touchees: 1,
      inspectees: 1,
      phrase: `sur la seule fiche produit inspectée${surCatalogue}`,
      // UNE PAGE NE PROUVE PAS UN CATALOGUE. Le plafond est ici, mécanisé, et
      // non laissé à la vigilance de chaque règle.
      plafond: "a_verifier",
    };
  }
  if (k === n) {
    return {
      portee: "toutes_les_inspectees",
      touchees: k,
      inspectees: n,
      phrase: `sur les ${n} fiches produit inspectées, toutes${surCatalogue}`,
      plafond: "prouve",
    };
  }
  return {
    portee: "plusieurs_fiches",
    touchees: k,
    inspectees: n,
    phrase: `sur ${k} des ${n} fiches produit inspectées${surCatalogue}`,
    plafond: "prouve",
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
          "Afficher les frais de livraison et le délai sur la page produit, avant le panier : l'acheteur qui découvre le coût final en caisse a déjà décidé sur un autre prix.",
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
        title: "Aucune page de politique aux adresses vérifiées",
        /*
          LA PORTÉE DE LA PREUVE, ET RIEN AU-DELÀ.

          Le constat affirmait « aucune page … n'a été trouvée SUR LE SITE
          PUBLIC ». Le scan n'interroge pourtant que trois adresses fixes — les
          chemins standards de Shopify. Une boutique qui publie sa politique de
          retour sous un autre chemin était donc déclarée dépourvue, et le
          marchand invité à créer une page qu'il avait déjà. C'est la
          surinterprétation la plus coûteuse d'un audit : elle envoie refaire
          l'existant, et fait douter de tout le reste du rapport.

          Le texte dit désormais ce qui a été inspecté. La preuve, elle, listait
          déjà les trois adresses et leur code de réponse.
        */
        statement:
          "Aucune des trois adresses de politique vérifiées n'a répondu : remboursement, livraison, conditions générales. Les adresses exactes et leur code de réponse figurent dans la preuve.",
        why: "Ce sont les pages que l'acheteur hésitant cherche avant de payer. Leur absence est aussi un motif de refus à la publication sur les régies publicitaires. Si ces pages existent chez vous sous une autre adresse, c'est leur emplacement qui pose problème, pas leur contenu — elles restent introuvables pour qui les cherche au chemin habituel.",
        level: "prouve",
        ...t,
        impact: 3,
        effort: 1,
        recommendation:
          "Publier trois pages et les lier depuis le pied de page : livraison (délai et prix), retours (délai et procédure), mentions légales.",
      });
    },
  },
  /**
   * UNE PAGE SUR TROIS N'EST PAS « DES PAGES DE POLITIQUE ».
   *
   * La règle voisine ne se déclenchait qu'à zéro. Une boutique servant les
   * conditions générales mais ni la livraison ni les retours passait donc pour
   * pourvue — alors que les deux manquantes sont précisément celles que
   * l'acheteur hésitant va chercher. Les conditions générales, personne ne les
   * lit avant d'acheter.
   */
  {
    id: "trust.policy_pages_incomplete",
    axis: "trust",
    requires: ["storefront.policy_pages"],
    technical: true,
    evaluate: (ctx) => {
      const pages = num(ctx, "storefront.policy_pages");
      if (pages === null || pages <= 0 || pages >= THRESHOLDS.EXPECTED_POLICY_PAGES) return null;
      const t = trace(ctx, ["storefront.policy_pages"]);
      return emit(RULES_BY_ID["trust.policy_pages_incomplete"], {
        title: "Il manque des pages que l'acheteur va chercher",
        statement: `${pages} page(s) de politique répondent sur les ${THRESHOLDS.EXPECTED_POLICY_PAGES} vérifiées.`,
        why: "Les pages manquantes se lisent dans la preuve ci-dessous, avec le code renvoyé par chacune. Celle des retours et celle de la livraison sont les deux que l'acheteur ouvre avant de payer ; les conditions générales, elles, ne se lisent qu'après un litige.",
        level: "prouve",
        ...t,
        impact: 3,
        effort: 1,
        recommendation:
          "Publier les pages absentes depuis Boutique en ligne → Pages, puis les lier depuis le pied de page. Y écrire un délai et un montant réels : une page vide fait plus de dégâts qu'une page absente.",
      });
    },
  },
  /**
   * AUCUN AVIS SUR LA FICHE INSPECTÉE.
   *
   * Le fait était mesuré depuis toujours et n'était lu par aucune règle. Il
   * reste plafonné : une application d'avis qui injecte sa note après le
   * chargement laisse le document servi muet, et nous ne saurions pas la voir.
   */
  {
    id: "trust.avis_absents_fiche",
    axis: "trust",
    requires: ["storefront.produits_sans_avis", "storefront.produits_inspectes"],
    technical: true,
    evaluate: (ctx) => {
      const p = lirePortee(
        num(ctx, "storefront.produits_sans_avis"),
        num(ctx, "storefront.produits_inspectes"),
        num(ctx, "shopify.product_count"),
      );
      if (p.portee === "aucune") return null;
      if (p.touchees / p.inspectees < THRESHOLDS.PRODUCT_SAMPLE_SHARE) return null;
      const t = trace(ctx, ["storefront.produits_sans_avis", "storefront.produits_inspectes"]);
      return emit(RULES_BY_ID["trust.avis_absents_fiche"], {
        title:
          p.portee === "une_fiche"
            ? "Aucune note client sur la fiche inspectée"
            : "Aucune note client sur les fiches inspectées",
        statement: `Aucune note ni avis n'est déclaré dans le document servi ${p.phrase}.`,
        why: "C'est la seule objection qu'un vendeur ne peut pas lever avec ses propres mots. Une application d'avis qui affiche sa note après le chargement resterait invisible pour nous : à vérifier en ouvrant l'une de ces fiches vous-même.",
        level: capLevel("prouve", p.plafond),
        ...t,
        impact: 3,
        effort: 2,
        recommendation:
          "Ouvrir l'une des fiches citées dans la preuve et regarder si une note apparaît. Si elle n'apparaît pas, installer une application d'avis et importer ceux déjà reçus par message ou par e-mail.",
      });
    },
  },

  // --- Fiche produit : ce que la page permet, et ce qu'elle annonce ---------
  /**
   * LA FICHE NE PROPOSE PAS D'ACHETER.
   *
   * Plafonné volontairement. Un thème qui construit son formulaire en
   * JavaScript sert un document sans `/cart/add` et déclencherait ici un
   * constat faux — c'est le mode de défaillance le plus coûteux, celui qui
   * produit un conseil confiant et erroné. Le constat dit donc ce qu'il a lu,
   * et demande une vérification d'un geste.
   */
  {
    id: "produit.achat_impossible",
    axis: "conversion",
    requires: ["storefront.produits_sans_ajout_panier", "storefront.produits_inspectes"],
    technical: true,
    evaluate: (ctx) => {
      // UNE SEULE FICHE INACHETABLE SUFFIT — c'est le seul défaut de cette
      // famille qui ne se dilue pas : la page concernée ne peut pas produire de
      // commande, quel que soit l'état des autres. La portée dit combien.
      const p = lirePortee(
        num(ctx, "storefront.produits_sans_ajout_panier"),
        num(ctx, "storefront.produits_inspectes"),
        num(ctx, "shopify.product_count"),
      );
      if (p.portee === "aucune") return null;
      const t = trace(ctx, [
        "storefront.produits_sans_ajout_panier",
        "storefront.produits_inspectes",
      ]);
      return emit(RULES_BY_ID["produit.achat_impossible"], {
        title: "Aucun ajout au panier trouvé sur des fiches inspectées",
        statement: `Aucun formulaire d'ajout au panier n'apparaît dans le document servi ${p.phrase}.`,
        why: "Si le bouton manque réellement, ces fiches ne peuvent pas être achetées et tout le trafic qui les atteint est perdu. Certains thèmes construisent ce bouton après l'affichage : nous lisons le document servi, pas la page finie, et ne pouvons pas trancher seuls.",
        level: capLevel("prouve", p.plafond),
        ...t,
        impact: 5,
        effort: 2,
        recommendation:
          "Ouvrir l'adresse citée dans la preuve en navigation privée, sur un téléphone. Si le bouton d'ajout au panier est absent ou inactif, vérifier dans Shopify que le produit est publié sur le canal Boutique en ligne et qu'il lui reste une variante disponible.",
      });
    },
  },
  /**
   * LES FRAIS DÉCOUVERTS EN CAISSE — et la seule règle qui les relie.
   *
   * Le module plafonne les faits techniques tant qu'aucune observation
   * commerciale ne corrobore. Cette règle est l'endroit où ce plafond se lève :
   * l'absence de mention de livraison sur la fiche est un fait de page, et elle
   * ne devient une explication de perte que si un abandon de panier a été
   * MESURÉ, sur assez de commandes pour vouloir dire quelque chose. Les deux
   * ensemble décrivent une chaîne ; l'un des deux seul décrit un détail.
   */
  {
    id: "conversion.livraison_absente_fiche",
    axis: "conversion",
    requires: ["storefront.produits_sans_livraison", "storefront.produits_inspectes"],
    evaluate: (ctx) => {
      const p = lirePortee(
        num(ctx, "storefront.produits_sans_livraison"),
        num(ctx, "storefront.produits_inspectes"),
        num(ctx, "shopify.product_count"),
      );
      if (p.portee === "aucune") return null;
      if (p.touchees / p.inspectees < THRESHOLDS.PRODUCT_SAMPLE_SHARE) return null;

      const abandon = ratio(num(ctx, "shopify.cart_abandonment_rate"));
      const commandes = num(ctx, "shopify.orders_30d");
      const corrobore =
        abandon !== null &&
        abandon >= THRESHOLDS.CART_ABANDONMENT &&
        commandes !== null &&
        commandes >= THRESHOLDS.MIN_ORDERS_FOR_RATES;

      const socle = ["storefront.produits_sans_livraison", "storefront.produits_inspectes"];
      const t = trace(
        ctx,
        corrobore ? [...socle, "shopify.cart_abandonment_rate", "shopify.orders_30d"] : socle,
      );
      return emit(RULES_BY_ID["conversion.livraison_absente_fiche"], {
        title: corrobore
          ? "Les frais de livraison se découvrent en caisse, et le panier s'y vide"
          : "Les fiches inspectées n'annoncent ni livraison ni frais de port",
        statement: corrobore
          ? `Ni livraison ni frais de port ne sont évoqués ${p.phrase}, et ${Math.round((abandon ?? 0) * 100)} % des paniers ouverts n'aboutissent pas, sur ${commandes} commandes.`
          : `Ni livraison ni frais de port ne sont évoqués dans le document servi ${p.phrase}.`,
        why: corrobore
          ? "Ces deux constats n'en font qu'un : l'acheteur choisit son produit sans connaître le coût final, puis le découvre au moment de payer. Traiter l'abandon de panier sans annoncer les frais plus tôt ne donnera rien — c'est la même perte, prise par l'autre bout."
          : "L'acheteur décide sans connaître le coût final, et le découvre en caisse. Sans mesure d'abandon sur cette boutique, cela reste un fait de page : nous ne pouvons pas dire ce qu'il coûte ici.",
        // La corroboration commerciale ne fait jamais oublier la taille de
        // l'échantillon : une fiche unique reste une fiche unique, même quand
        // l'abandon de panier est mesuré et massif.
        level: capLevel(corrobore ? "fortement_suggere" : "a_verifier", p.plafond),
        ...t,
        impact: corrobore ? 4 : 3,
        effort: 1,
        recommendation:
          "Afficher le montant de la livraison et le délai sur la fiche produit, sous le prix — ou annoncer le seuil de livraison offerte s'il existe. Dans Shopify : Paramètres → Livraison, puis reporter le montant dans la section de la fiche.",
      });
    },
  },

  // --- Découverte du catalogue ---------------------------------------------
  /**
   * LA PAGE OÙ LE VISITEUR CHOISIT.
   *
   * Elle était téléchargée à chaque scan et jetée sans être lue. C'est pourtant
   * elle, et non la fiche, qui décide de ce qui sera comparé : la fiche ne fait
   * que confirmer un choix déjà fait ailleurs.
   */
  {
    id: "merchandising.collection_maigre",
    axis: "merchandising",
    requires: ["storefront.collection_produits_listes"],
    evaluate: (ctx) => {
      const listes = num(ctx, "storefront.collection_produits_listes");
      if (listes === null || listes >= THRESHOLDS.MIN_PRODUCTS_IN_COLLECTION) return null;
      const total = num(ctx, "shopify.product_count");
      const t = trace(
        ctx,
        total === null
          ? ["storefront.collection_produits_listes"]
          : ["storefront.collection_produits_listes", "shopify.product_count"],
      );
      return emit(RULES_BY_ID["merchandising.collection_maigre"], {
        title: "La collection inspectée ne fait rien choisir",
        statement:
          total === null
            ? `La page de collection ouverte pendant le diagnostic ne mène qu'à ${listes} fiche(s) produit.`
            : `La page de collection ouverte pendant le diagnostic ne mène qu'à ${listes} fiche(s) produit, alors que le catalogue en compte ${total}.`,
        why:
          total !== null && total > listes
            ? "Le catalogue existe, mais cette porte d'entrée n'en montre presque rien : le reste n'est atteignable que par la recherche ou par un lien direct, c'est-à-dire par quelqu'un qui sait déjà ce qu'il cherche."
            : "Une page qui présente moins de quatre articles ne fait pas comparer : elle demande au visiteur de décider sans point de comparaison, ce qu'il fait rarement au premier passage.",
        level: "prouve",
        ...t,
        impact: 3,
        effort: 2,
        recommendation:
          "Ouvrir Boutique en ligne → Navigation et vérifier que le menu pointe vers une collection réellement remplie. Dans Produits → Collections, contrôler les conditions automatiques : une condition trop étroite vide une collection sans prévenir.",
      });
    },
  },
  /**
   * UN CATALOGUE QUI DEMANDE DES FILTRES, ET UNE PAGE QUI N'EN A PAS.
   *
   * Le compte de produits vient de l'API Admin, l'absence de filtres du
   * document servi. Aucun des deux ne suffit : c'est leur rencontre qui fait le
   * constat, et c'est pourquoi la règle exige les deux.
   */
  {
    id: "merchandising.collection_sans_filtres",
    axis: "merchandising",
    requires: ["storefront.collection_filtres", "shopify.product_count"],
    evaluate: (ctx) => {
      const filtres = num(ctx, "storefront.collection_filtres");
      const total = num(ctx, "shopify.product_count");
      if (filtres === null || filtres > 0) return null;
      if (total === null || total < THRESHOLDS.CATALOG_NEEDS_FILTERS) return null;
      const t = trace(ctx, ["storefront.collection_filtres", "shopify.product_count"]);
      return emit(RULES_BY_ID["merchandising.collection_sans_filtres"], {
        title: "Un catalogue de cette taille se parcourt sans aucun filtre",
        statement: `${total} produits au catalogue, et la page de collection inspectée n'expose aucun filtre.`,
        why: "Passé quelques dizaines d'articles, parcourir sans filtre revient à faire défiler. Le visiteur qui cherche une taille, une couleur ou une gamme de prix abandonne avant de trouver — et ce n'est pas le produit qu'il rejette, c'est la recherche.",
        level: "prouve",
        ...t,
        impact: 3,
        effort: 2,
        recommendation:
          "Ajouter le filtrage sur les collections : dans l'éditeur de thème, section Collection, activer les filtres, puis choisir dans Boutique en ligne → Navigation → Filtres les critères que vos clients emploient réellement (taille, couleur, prix).",
      });
    },
  },
  {
    id: "ux.catalogue_invisible_depuis_accueil",
    axis: "ux",
    requires: ["storefront.accueil_collection_links"],
    technical: true,
    evaluate: (ctx) => {
      const collections = num(ctx, "storefront.accueil_collection_links");
      if (collections === null || collections > 0) return null;
      const t = trace(ctx, ["storefront.accueil_collection_links"]);
      return emit(RULES_BY_ID["ux.catalogue_invisible_depuis_accueil"], {
        title: "L'accueil ne mène à aucune collection",
        statement:
          "Aucun lien vers une collection n'a été trouvé dans le document de la page d'accueil.",
        why: "Le visiteur qui arrive sans savoir ce qu'il veut n'a alors aucune porte d'entrée dans le catalogue : il doit ouvrir un menu, ou deviner. La preuve porte aussi le nombre de fiches produit atteignables en un clic, qui dit si l'accueil compense par des mises en avant.",
        level: "prouve",
        ...t,
        impact: 3,
        effort: 1,
        recommendation:
          "Ajouter à la page d'accueil une section de collections mises en avant, et vérifier dans Boutique en ligne → Navigation que le menu principal pointe bien vers des collections et non vers des pages.",
      });
    },
  },

  // --- Prix, variantes, disponibilité --------------------------------------
  /**
   * UNE FICHE SANS PRIX NE SE VEND PAS.
   *
   * Le prix des variantes était lu depuis toujours — il alimente le minimum, le
   * maximum et la médiane — et personne ne regardait combien de fiches n'en
   * avaient aucun. C'est pourtant le seul défaut de catalogue qui rend un
   * produit littéralement inachetable, au même titre qu'une fiche sans image.
   */
  {
    id: "offre.prix_absent",
    axis: "offre",
    requires: ["shopify.products_without_price", "shopify.product_count"],
    evaluate: (ctx) => {
      const sans = num(ctx, "shopify.products_without_price");
      const total = num(ctx, "shopify.product_count");
      if (sans === null || total === null || sans <= 0) return null;
      const t = trace(ctx, ["shopify.products_without_price", "shopify.product_count"]);
      return emit(RULES_BY_ID["offre.prix_absent"], {
        title: "Des fiches n'affichent aucun prix",
        statement: `${sans} fiche(s) sur ${total} n'exposent aucune variante à un prix positif.`,
        why: "Un visiteur qui ne voit pas de prix ne demande pas : il ferme. Ces fiches consomment du trafic et de la place en collection sans pouvoir produire une seule commande.",
        level: "prouve",
        ...t,
        impact: 4,
        effort: 1,
        recommendation:
          "Ouvrir Produits dans Shopify, trier par prix croissant, et renseigner le prix des fiches à zéro — ou les dépublier du canal Boutique en ligne tant qu'elles n'en ont pas.",
      });
    },
  },
  /**
   * LE CHOIX QUI N'EN EST PAS UN.
   *
   * Les variantes ne servaient qu'à décider si un produit était en rupture
   * TOTALE. Le cas intermédiaire — une taille sur trois épuisée — n'existait
   * nulle part, alors que c'est celui que le visiteur rencontre : il choisit,
   * découvre que son choix est indisponible, et repart. La fiche a fait tout le
   * travail de conviction pour rien.
   */
  {
    id: "merchandising.choix_partiellement_epuise",
    axis: "merchandising",
    requires: [
      "shopify.products_partially_out_of_stock",
      "shopify.products_multi_variant",
      "shopify.product_count",
    ],
    evaluate: (ctx) => {
      const partiels = num(ctx, "shopify.products_partially_out_of_stock");
      const multi = num(ctx, "shopify.products_multi_variant");
      const total = num(ctx, "shopify.product_count");
      if (partiels === null || multi === null || total === null) return null;
      if (partiels <= 0 || multi <= 0) return null;
      if (total < THRESHOLDS.MIN_PRODUCTS_FOR_SHARES) return null;
      // La part se calcule sur les fiches QUI OFFRENT UN CHOIX, pas sur le
      // catalogue : une boutique de mille produits à variante unique ne peut
      // pas avoir de problème de choix, et le dénominateur doit le refléter.
      const part = partiels / multi;
      if (part < THRESHOLDS.PARTIAL_STOCK_SHARE) return null;
      const t = trace(ctx, [
        "shopify.products_partially_out_of_stock",
        "shopify.products_multi_variant",
        "shopify.product_count",
      ]);
      return emit(RULES_BY_ID["merchandising.choix_partiellement_epuise"], {
        title: "Le choix proposé est en partie indisponible",
        statement: `${partiels} fiches sur les ${multi} qui proposent un choix ont une partie de leurs variantes épuisées, l'autre partie disponible.`,
        why: "Ces fiches ne sont ni disponibles ni en rupture : elles laissent le visiteur choisir, puis lui refusent son choix. C'est le moment du parcours où l'intention est la plus forte, donc celui où un refus coûte le plus cher.",
        level: "prouve",
        ...t,
        impact: 3,
        effort: 2,
        recommendation:
          "Sur ces fiches, masquer les variantes épuisées plutôt que de les afficher grisées, et activer l'alerte de retour en stock. Dans Shopify : Produits → variante → décocher la disponibilité sur le canal Boutique en ligne.",
      });
    },
  },
  /**
   * LA DISPONIBILITÉ N'EST NI VRAIE NI FAUSSE : ELLE EST PARFOIS ILLISIBLE.
   *
   * Troisième état, et le plus fréquent chez un marchand qui ne suit pas son
   * stock. Le ranger avec « disponible » promettrait ce qu'on n'a pas lu ; le
   * ranger avec « en rupture » inventerait un problème. Il se dit donc pour ce
   * qu'il est : une donnée manquante, qui ne retire aucun point et qui nomme ce
   * qu'elle empêche de conclure.
   */
  {
    id: "data.disponibilite_non_lisible",
    axis: "data",
    requires: ["shopify.products_stock_inconnu", "shopify.product_count"],
    evaluate: (ctx) => {
      const inconnu = num(ctx, "shopify.products_stock_inconnu");
      const total = num(ctx, "shopify.product_count");
      if (inconnu === null || total === null || total <= 0) return null;
      if (inconnu / total < THRESHOLDS.STOCK_UNKNOWN_SHARE) return null;
      const t = trace(ctx, ["shopify.products_stock_inconnu", "shopify.product_count"]);
      return emit(RULES_BY_ID["data.disponibilite_non_lisible"], {
        title: "La disponibilité d'une partie du catalogue n'est pas lisible",
        statement: `${inconnu} fiches sur ${total} ne permettent pas d'établir leur disponibilité : leur stock n'est pas suivi, ou la quantité ne nous est pas renvoyée.`,
        why: "Ce n'est pas une rupture, et ce n'est pas une disponibilité : c'est une absence de mesure. Tant qu'elle dure, aucun constat de ce diagnostic ne peut affirmer qu'un produit est achetable ou non — et une rupture réelle passerait inaperçue.",
        level: "donnee_insuffisante",
        ...t,
        impact: 2,
        effort: 2,
        recommendation:
          "Activer le suivi d'inventaire dans Shopify (Produits → variante → Suivre la quantité) sur les fiches concernées. Sans lui, Shopify vend sans compter et personne ne peut dire ce qui reste.",
      });
    },
  },

  // --- Métadonnées ---------------------------------------------------------
  /**
   * LE TITRE D'ONGLET, ENFIN LU PAR UNE RÈGLE.
   *
   * Il était mesuré sur chaque page depuis l'ajout de l'observation, et aucune
   * règle ne le consommait. C'est pourtant la seule phrase que le visiteur lit
   * AVANT d'ouvrir la page : la ligne bleue d'un résultat de recherche, le nom
   * de l'onglet, le libellé d'un partage.
   *
   * DEUX DÉCLENCHEURS, PAS UN SEUIL DE LONGUEUR. « Trop court » demanderait un
   * nombre de caractères que rien ne justifie ici. Un titre ABSENT, ou réduit
   * au seul nom de la boutique, sont deux faits vérifiables — et le second est
   * le cas de loin le plus fréquent.
   */
  {
    id: "seo.titre_page_muet",
    axis: "seo",
    requires: ["storefront.accueil_title"],
    technical: true,
    evaluate: (ctx) => {
      const o = obs(ctx, "storefront.accueil_title");
      if (!o) return null;
      const longueur = typeof o.value === "number" ? o.value : null;
      if (longueur === null) return null;
      const texte = typeof o.text === "string" ? o.text.trim() : "";
      const mots = texte ? texte.split(/\s+/).filter(Boolean).length : 0;
      const absent = longueur === 0 || mots === 0;
      if (!absent && mots > THRESHOLDS.TITLE_MIN_WORDS) return null;
      const t = trace(ctx, ["storefront.accueil_title"]);
      return emit(RULES_BY_ID["seo.titre_page_muet"], {
        title: absent
          ? "La page d'accueil ne porte aucun titre"
          : "Le titre de la page d'accueil ne dit pas ce qui est vendu",
        statement: absent
          ? "Le document servi par la page d'accueil ne contient aucun titre."
          : `Le titre servi par la page d'accueil tient en ${mots} mot(s) : « ${texte} ».`,
        why: absent
          ? "Sans titre, les moteurs et les onglets affichent l'adresse du site. Le visiteur qui retrouve un onglet ouvert ou une ligne de résultat ne sait pas ce qu'il regarde."
          : "C'est la seule phrase lue AVANT d'ouvrir la page. Réduite au nom de la boutique, elle ne dit ni ce qui est vendu, ni à qui : la ligne de résultat n'a aucune raison d'être cliquée plutôt qu'une autre.",
        level: "prouve",
        ...t,
        impact: 2,
        effort: 1,
        recommendation:
          "Dans Shopify → Boutique en ligne → Préférences, écrire un titre de la forme « [Ce que vous vendez] — [pour qui ou d'où] ». Le nom de la boutique se met à la fin, pas au début.",
      });
    },
  },
  {
    id: "seo.description_absente",
    axis: "seo",
    requires: ["storefront.accueil_meta_description"],
    technical: true,
    evaluate: (ctx) => {
      const presente = num(ctx, "storefront.accueil_meta_description");
      if (presente === null || presente > 0) return null;
      const t = trace(ctx, ["storefront.accueil_meta_description"]);
      return emit(RULES_BY_ID["seo.description_absente"], {
        title: "La page d'accueil n'a pas de description",
        statement: "Le document servi par la page d'accueil ne déclare aucune description.",
        why: "Sans description, le moteur de recherche compose lui-même le texte affiché sous le titre, en prélevant une phrase de la page — souvent un menu ou un bandeau de cookies. La boutique perd la seule ligne d'argumentaire qu'elle contrôle dans les résultats.",
        level: "prouve",
        ...t,
        impact: 2,
        effort: 1,
        recommendation:
          "Dans Shopify → Boutique en ligne → Préférences, écrire deux phrases : ce que la boutique vend, et ce qui la distingue. Elles s'affichent sous le titre dans les résultats de recherche.",
      });
    },
  },

  // --- Diagnostics de convergence ------------------------------------------
  /*
    CE QUE PLUSIEURS OBSERVATIONS DISENT ENSEMBLE, ET QU'AUCUNE NE DIT SEULE.

    Jusqu'ici, une seule règle du moteur croisait réellement deux sources. Tout
    le reste appliquait un seuil à une observation unique — ce qui produit une
    checklist enrichie, pas un diagnostic. Les trois règles qui suivent partent
    d'observations DÉJÀ collectées, n'ajoutent aucune requête, et concluent
    seulement ce que leur convergence autorise.

    TROIS DISCIPLINES, sans lesquelles ce serait de la surinterprétation :

    1. **Le vocabulaire suit la preuve.** On écrit « ces éléments convergent »,
       jamais « X provoque Y » : aucune de ces observations ne démontre une
       causalité, elles montrent une cohérence.
    2. **Le niveau ne dépasse jamais celui de ses appuis.** Une convergence de
       lectures de document reste « à vérifier » ; elle ne monte que si une
       mesure commerciale l'accompagne.
    3. **La convergence REMPLACE ses constituants** (`absorbs`). Sortir les
       quatre ferait relire quatre fois le même problème.
  */
  {
    id: "parcours.entree_catalogue_absente",
    axis: "ux",
    requires: ["storefront.accueil_h1_mots", "storefront.accueil_cta"],
    technical: true,
    absorbs: ["ux.catalogue_invisible_depuis_accueil"],
    evaluate: (ctx) => {
      const mots = num(ctx, "storefront.accueil_h1_mots");
      const cta = num(ctx, "storefront.accueil_cta");
      const collections = num(ctx, "storefront.accueil_collection_links");
      if (mots === null || cta === null) return null;

      const signaux: string[] = [];
      const ids: string[] = [];
      if (mots < THRESHOLDS.PROMISE_MIN_WORDS) {
        signaux.push(
          mots === 0
            ? "aucune promesse en titre de niveau 1"
            : `une promesse de ${mots} mot(s) seulement`,
        );
        ids.push("storefront.accueil_h1_mots");
      }
      if (cta === 0) {
        signaux.push("aucun appel à l'action");
        ids.push("storefront.accueil_cta");
      }
      if (collections === 0) {
        signaux.push("aucun lien vers une collection");
        ids.push("storefront.accueil_collection_links");
      }
      // DEUX SIGNAUX AU MINIMUM. Un seul est un détail de page, et il a déjà sa
      // propre règle : une convergence à un élément n'est pas une convergence.
      if (signaux.length < 2) return null;

      const t = trace(ctx, ids);
      return emit(RULES_BY_ID["parcours.entree_catalogue_absente"], {
        title: "La page d'accueil n'ouvre aucun chemin vers l'offre",
        statement: `${signaux.length} éléments observables convergent sur la page d'accueil : ${signaux.join(", ")}.`,
        why: "Pris isolément, chacun se corrige en dix minutes et ne dit pas grand-chose. Ensemble, ils décrivent une page qui ne dit pas ce qu'elle vend, ne propose pas de geste et n'ouvre pas le catalogue : le visiteur qui arrive sans connaître la boutique n'a aucun chemin devant lui. Ces trois lectures sont cohérentes entre elles ; elles ne démontrent pas à elles seules une perte de vente, qui se mesurerait sur du trafic.",
        level: "prouve",
        ...t,
        impact: 5,
        effort: 2,
        recommendation:
          "Traiter les trois d'un seul geste, dans l'éditeur de thème : un titre qui dit ce que vous vendez et pour qui, un bouton d'action juste en dessous, et une section de collections mises en avant. C'est la même section du thème pour les trois.",
      });
    },
  },
  {
    id: "conversion.fiche_sans_reponse_avec_trafic",
    axis: "conversion",
    requires: ["shopify.sessions_30d"],
    absorbs: ["trust.avis_absents_fiche", "conversion.livraison_absente_fiche"],
    evaluate: (ctx) => {
      const sessions = num(ctx, "shopify.sessions_30d");
      if (sessions === null || sessions < THRESHOLDS.MIN_SESSIONS_FOR_CONVERSION) return null;

      const manques: string[] = [];
      const ids = ["shopify.sessions_30d"];
      const inspectees = num(ctx, "storefront.produits_inspectes") ?? 0;
      const majorite = (id: string) => {
        const k = num(ctx, id);
        return inspectees > 0 && k !== null && k / inspectees >= THRESHOLDS.PRODUCT_SAMPLE_SHARE;
      };
      if (majorite("storefront.produits_sans_livraison")) {
        manques.push("ni le coût ni le délai de livraison");
        ids.push("storefront.produits_sans_livraison");
      }
      if (majorite("storefront.produits_sans_avis")) {
        manques.push("aucune note ni avis");
        ids.push("storefront.produits_sans_avis");
      }
      const sansTexte = num(ctx, "shopify.products_without_description");
      const total = num(ctx, "shopify.product_count");
      if (
        sansTexte !== null &&
        total !== null &&
        total >= THRESHOLDS.MIN_PRODUCTS_FOR_SHARES &&
        sansTexte / total >= THRESHOLDS.DESCRIPTIONS_MISSING_SHARE
      ) {
        manques.push(`aucun texte descriptif sur ${sansTexte} fiches du catalogue`);
        ids.push("shopify.products_without_description");
      }
      if (manques.length < 2) return null;
      ids.push("storefront.produits_inspectes");

      const t = trace(ctx, ids);
      return emit(RULES_BY_ID["conversion.fiche_sans_reponse_avec_trafic"], {
        title: "Du trafic arrive sur des fiches qui ne lèvent aucune objection",
        statement: `${sessions} sessions mesurées sur la période, et les ${inspectees} fiche(s) produit inspectée(s) n'exposent ${manques.join(", ni ")}.`,
        why: "Le trafic est acquis — c'est une mesure, pas une lecture de page. Ce qu'il rencontre ensuite ne répond à aucune des trois questions qu'un acheteur se pose avant de payer : combien ça coûte au total, est-ce que d'autres l'ont acheté, qu'est-ce que c'est exactement. Ces éléments sont cohérents avec une perte située après l'arrivée ; localiser cette perte exactement demanderait la mesure du tunnel.",
        level: "fortement_suggere",
        ...t,
        impact: 4,
        effort: 2,
        recommendation:
          "Compléter la fiche la plus visitée en premier, dans cet ordre : le montant et le délai de livraison sous le prix, puis deux avis réels, puis trois lignes disant à qui le produit s'adresse et ce qu'il change.",
      });
    },
  },
  {
    id: "merchandising.catalogue_present_mais_invisible",
    axis: "merchandising",
    requires: ["shopify.product_count", "storefront.collection_produits_listes"],
    absorbs: ["merchandising.collection_maigre"],
    evaluate: (ctx) => {
      const total = num(ctx, "shopify.product_count");
      const listes = num(ctx, "storefront.collection_produits_listes");
      const depuisAccueil = num(ctx, "storefront.accueil_collection_links");
      if (total === null || listes === null) return null;
      if (total < THRESHOLDS.CATALOG_NEEDS_FILTERS) return null;
      if (listes >= THRESHOLDS.MIN_PRODUCTS_IN_COLLECTION) return null;
      const ids = ["shopify.product_count", "storefront.collection_produits_listes"];
      if (depuisAccueil !== null) ids.push("storefront.accueil_collection_links");
      const t = trace(ctx, ids);
      return emit(RULES_BY_ID["merchandising.catalogue_present_mais_invisible"], {
        title: "Le catalogue existe, la vitrine n'en montre presque rien",
        statement: `${total} produits au catalogue Shopify, et la page de collection inspectée ne mène qu'à ${listes} fiche(s)${depuisAccueil === 0 ? ", sans aucun lien de collection depuis la page d'accueil" : ""}.`,
        why: "Deux sources indépendantes se contredisent : l'API dit un catalogue fourni, la page servie montre une poignée d'articles. Le reste n'est atteignable que par la recherche ou par un lien direct — donc par quelqu'un qui sait déjà ce qu'il cherche, c'est-à-dire pas par un nouveau visiteur.",
        level: "prouve",
        ...t,
        impact: 4,
        effort: 2,
        recommendation:
          "Ouvrir Produits → Collections et vérifier les conditions automatiques de la collection mise en avant : une condition trop étroite la vide sans prévenir. Vérifier ensuite que les produits sont bien publiés sur le canal Boutique en ligne.",
      });
    },
  },

  // --- SEO -----------------------------------------------------------------
  /**
   * UNE PAGE QUI DEMANDE À NE PAS ÊTRE RÉFÉRENCÉE.
   *
   * Le fait était mesuré sur chaque page lue et n'était consommé par aucune
   * règle. Il est pourtant sans ambiguïté : une directive `noindex` dans le
   * document servi retire la page des résultats de recherche, quel que soit le
   * reste. C'est fréquemment un reste de mise en ligne que personne n'a retiré.
   */
  {
    id: "seo.noindex_declare",
    axis: "seo",
    requires: [],
    technical: true,
    evaluate: (ctx) => {
      const pages = ["accueil", "produit", "collection"] as const;
      const bloquees = pages.filter((role) => num(ctx, `storefront.${role}_noindex`) === 1);
      if (bloquees.length === 0) return null;
      const t = trace(
        ctx,
        bloquees.map((role) => `storefront.${role}_noindex`),
      );
      return emit(RULES_BY_ID["seo.noindex_declare"], {
        title: "Une page demande à ne pas être référencée",
        statement: `${bloquees.length} des pages lues portent une directive « noindex » : ${bloquees.join(", ")}.`,
        why: "Cette directive retire explicitement la page des résultats de recherche. Elle survit régulièrement à une mise en ligne — le site est ouvert au public, mais continue de demander à ne pas être trouvé.",
        level: "prouve",
        ...t,
        impact: 4,
        effort: 1,
        recommendation:
          "Dans l'éditeur de thème, ouvrir le code du fichier d'en-tête et retirer la balise `meta name=\"robots\"` qui porte « noindex », puis demander une réindexation dans la Search Console. Vérifier aussi qu'aucune application de maintenance n'est restée active.",
      });
    },
  },
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
    requires: ["storefront.produits_sans_donnees_structurees", "storefront.produits_inspectes"],
    technical: true,
    evaluate: (ctx) => {
      const p = lirePortee(
        num(ctx, "storefront.produits_sans_donnees_structurees"),
        num(ctx, "storefront.produits_inspectes"),
        num(ctx, "shopify.product_count"),
      );
      if (p.portee === "aucune") return null;
      if (p.touchees / p.inspectees < THRESHOLDS.PRODUCT_SAMPLE_SHARE) return null;
      const t = trace(ctx, [
        "storefront.produits_sans_donnees_structurees",
        "storefront.produits_inspectes",
      ]);
      return emit(RULES_BY_ID["seo.structured_data_missing"], {
        title: "Des fiches produit n'exposent pas de données structurées",
        statement: `Aucune donnée structurée de type Produit n'a été trouvée ${p.phrase}.`,
        why: "Sans elles, les résultats de recherche n'affichent ni prix ni disponibilité : la ligne est moins cliquée à position égale.",
        level: capLevel("prouve", p.plafond),
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
  /**
   * LA LENTEUR EST UNE MESURE ; CE QU'ELLE COÛTE EST D'UN AUTRE ORDRE.
   *
   * C'est l'exemple que l'en-tête de ce module donne de sa règle absolue, et
   * c'est ici qu'il est mécanisé. Le temps de réponse était mesuré à chaque
   * scan et lu par aucune règle. Il le devient — en disant une chose quand du
   * commerce est mesuré sur cette boutique, et une autre quand rien ne l'est.
   * `hasBusinessCorroboration` ne change pas le niveau de preuve, qui reste
   * plafonné : il change ce que le constat a le droit d'affirmer.
   */
  {
    id: "technique.reponse_lente",
    axis: "technique",
    requires: ["storefront.response_ms"],
    technical: true,
    evaluate: (ctx) => {
      const ms = num(ctx, "storefront.response_ms");
      if (ms === null || ms < SLOW_RESPONSE_MS) return null;
      const corrobore = hasBusinessCorroboration(ctx, BUSINESS_SIGNALS);
      const t = trace(ctx, ["storefront.response_ms"]);
      return emit(RULES_BY_ID["technique.reponse_lente"], {
        title: "Le serveur met plus de deux secondes à répondre",
        statement: `${Math.round(ms)} ms pour recevoir le document le plus lent, mesurés par requête serveur.`,
        why: corrobore
          ? "Ce délai s'ajoute avant que le navigateur n'ait commencé à afficher quoi que ce soit, et il précède chaque visite de cette boutique — dont l'activité est par ailleurs mesurée ici. Ce qu'il coûte exactement demanderait une mesure dans un vrai navigateur, sur du vrai trafic ; nous mesurons le serveur, pas l'affichage."
          : "C'est un temps de réponse serveur, et rien de plus à ce stade : aucune donnée commerciale n'a été mesurée sur cette boutique, donc rien ne permet de dire ce que ce délai lui coûte.",
        level: "prouve",
        ...t,
        impact: corrobore ? 3 : 2,
        effort: 3,
        recommendation:
          "Désactiver une à une les applications récemment installées et remesurer entre chaque : ce sont elles, et non le thème, qui allongent le plus souvent la réponse. Si le délai persiste sans application, il vient du thème.",
      });
    },
  },
  /**
   * VIEWPORT ABSENT — lu sur la version mobile, ou à défaut sur l'accueil.
   *
   * La règle n'exigeait que `storefront.mobile_viewport`, qui n'existe que si
   * la requête en agent mobile a abouti ET que les deux poids étaient
   * lisibles. Sur un site lent, ce contrôle est le premier sauté par le budget
   * du scan : une boutique réellement dépourvue de balise viewport ne
   * produisait alors aucun constat, alors que `storefront.accueil_viewport`
   * portait déjà la réponse. Un contrôle sauté se lisait comme un contrôle
   * réussi — exactement ce que le scan déclare vouloir éviter.
   */
  {
    id: "ux.mobile_viewport_missing",
    axis: "ux",
    requires: [],
    technical: true,
    evaluate: (ctx) => {
      const source =
        num(ctx, "storefront.mobile_viewport") !== null
          ? "storefront.mobile_viewport"
          : "storefront.accueil_viewport";
      const viewport = num(ctx, source);
      if (viewport === null || viewport > 0) return null;
      const t = trace(ctx, [source]);
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
  /**
   * LA RÉTENTION NE PEUT PAS ÊTRE ÉVALUÉE, ET C'EST UN CONSTAT.
   *
   * Sans commandes, aucun taux de réachat, aucun délai entre achats, aucune
   * valeur client n'existe. La tentation est d'écrire « pensez à fidéliser vos
   * clients », ce qui est vrai pour toutes les boutiques du monde et n'aide
   * personne. Le moteur dit plutôt ce qui manque, pourquoi, et à partir de quand
   * il pourra se prononcer.
   */
  {
    id: "data.retention_non_evaluable",
    axis: "data",
    requires: [],
    evaluate: (ctx) => {
      const orders = num(ctx, "shopify.orders_30d");
      const returning = num(ctx, "shopify.returning_customer_rate");
      // Si la rétention EST mesurable, cette règle n'a rien à dire.
      if (returning !== null && orders !== null && orders >= THRESHOLDS.MIN_ORDERS_FOR_RATES) {
        return null;
      }
      if (orders === null) return null;
      const t = trace(ctx, ["shopify.orders_30d"]);
      return emit(RULES_BY_ID["data.retention_non_evaluable"], {
        title: "La rétention n'est pas encore évaluable",
        statement:
          orders === 0
            ? "Aucune commande sur la période : ni réachat, ni fréquence, ni valeur client ne peuvent être calculés."
            : `${orders} commande(s) sur la période : il en faut au moins ${THRESHOLDS.MIN_ORDERS_FOR_RATES} pour qu'un taux de réachat veuille dire quelque chose.`,
        why: "La rétention se mesure sur des clients qui reviennent — donc sur des clients qui sont déjà venus. Avant ce volume, toute conclusion sur la fidélité serait une opinion déguisée en mesure : un seul client qui repasse ferait passer le taux de 0 à 50 %.",
        level: "donnee_insuffisante",
        ...t,
        impact: 3,
        effort: 1,
        // Sans commandes, l'axe rétention n'est pas notable : lui donner 100
        // reviendrait à féliciter une boutique dont on ne sait rien.
        blocksAxes: ["retention"],
        recommendation: `Revenir sur cet axe une fois ${THRESHOLDS.MIN_ORDERS_FOR_RATES} commandes payées atteintes. Le moteur calculera alors la part de clients revenants, le délai entre deux commandes et la dépendance à l'acquisition de nouveaux clients — trois mesures qu'aucune source externe ne fournit et que Shopify porte déjà.`,
      });
    },
  },

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
  /** Constats rendus redondants par une règle de convergence qui a parlé. */
  const absorbes = new Set<string>();

  for (const rule of RULES) {
    // Une règle ne se prononce jamais sans ses entrées. Le test est ici, hors
    // de la règle, pour qu'aucune ne puisse l'oublier.
    const missing = rule.requires.filter((id) => num(ctx, id) === null);
    if (missing.length > 0 && rule.requires.length > 0) continue;
    try {
      const finding = rule.evaluate(ctx);
      if (!finding) continue;
      out.push(finding);
      for (const id of rule.absorbs ?? []) absorbes.add(id);
    } catch {
      // Une règle défectueuse est un défaut de code, pas un constat.
      continue;
    }
  }

  // Le retrait se fait à la fin, pas pendant : l'ordre de déclaration des règles
  // ne doit pas décider de ce qui survit. Une règle de convergence placée après
  // ses constituants doit les absorber quand même.
  return out.filter((f) => !absorbes.has(f.ruleId));
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
  /**
   * `null` QUAND L'AXE N'EST PAS MESURÉ, et c'est le type qui l'impose.
   *
   * Le champ portait auparavant `100` sur un axe dont on ne savait rien — la
   * note qu'obtient mécaniquement un sujet sur lequel aucune règle n'a pu se
   * prononcer. Tous les lecteurs d'alors vérifiaient bien `measured` avant de
   * l'afficher, mais rien ne les y obligeait : « Conversion 100/100 » sur une
   * boutique sans un seul visiteur est né exactement de cet oubli, et le
   * prochain lecteur écrit ne l'aurait pas su. Un score absent se lit
   * désormais comme absent, et le compilateur refuse de l'afficher tel quel.
   */
  score: number | null;
  /** Chaque point perdu, rattaché à sa règle. Un score se décompose ou n'est rien. */
  deductions: ScoreDeduction[];
  /** Aucune observation sur cet axe : il n'y a alors rien à noter. */
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
      score: measured ? Math.max(0, 100 - lost) : null,
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
    if (
      id.includes("robots") ||
      id.includes("sitemap") ||
      id.includes("structured_data") ||
      // Le titre d'onglet, la description et les titres de niveau 1 sont ce
      // qu'un moteur affiche et indexe : les ranger en « technique » laissait
      // l'axe SEO non mesuré alors qu'il avait bel et bien été regardé.
      id.includes("_title") ||
      id.includes("meta_description") ||
      id.includes("_h1_count") ||
      id.includes("noindex")
    ) {
      return "seo";
    }
    if (id.includes("mobile") || id.includes("recherche")) return "ux";
    if (id.includes("policy") || id.includes("reviews")) return "trust";
    if (id.includes("collection")) return "merchandising";
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
export const MIN_MEASURED_AXES_SHARE = 0.5;

export function globalScore(axes: AxisScore[]): number | null {
  // On filtre sur le SCORE, pas sur `measured` : c'est la seule forme que le
  // compilateur sait vérifier, et elle rend impossible d'additionner un axe
  // sans note même si les deux champs venaient un jour à diverger.
  const notes = axes.map((a) => a.score).filter((s): s is number => s !== null);
  if (notes.length === 0) return null;

  // UNE NOTE SUR TROIS AXES N'EST PAS UNE NOTE DE BOUTIQUE.
  //
  // Le cas qui a imposé ce seuil : une boutique de vingt-quatre produits, tous
  // décrits et illustrés, trois pages de politique, aucune page cassée — et
  // zéro vente, zéro visiteur mesuré. Les trois axes visibles étaient
  // irréprochables, la moyenne sortait à 100, et le marchand lisait 100/100
  // sur une boutique qui ne vend rien. Chaque étape était juste ; le verdict
  // était absurde.
  //
  // En dessous de la moitié des axes, la moyenne dit surtout ce que nous avons
  // réussi à regarder. Mieux vaut alors ne pas donner de note : l'absence
  // s'explique, un 100 imaginaire ne se rattrape pas.
  if (notes.length / axes.length < MIN_MEASURED_AXES_SHARE) return null;

  return Math.round(notes.reduce((sum, n) => sum + n, 0) / notes.length);
}

// ---------------------------------------------------------------------------
// Priorisation
// ---------------------------------------------------------------------------

export const MAX_PRIORITIES = 7;
export const MIN_PRIORITIES = 3;

/**
 * L'EFFET DE DÉPENDANCE, ET POURQUOI IL EST BORNÉ.
 *
 * Un problème qui en explique d'autres doit passer devant eux : le corriger
 * fait tomber les suivants, l'inverse ne marche pas. Jusqu'ici le classement
 * l'ignorait complètement — les causes racines étaient calculées, justes, et
 * sans aucun poids sur l'ordre des actions.
 *
 * TROIS GARDE-FOUS, chacun contre une façon de tricher :
 *
 * 1. **L'effet MULTIPLIE la formule existante, il ne s'y ajoute pas.** Il passe
 *    donc par le poids de preuve. Une cause « à vérifier » (poids 0,25) qui
 *    explique trois constats vaut 0,25 × 1,75 = 0,44 : toujours en dessous d'un
 *    constat PROUVÉ isolé, qui vaut 1. Une hypothèse ne double jamais un fait
 *    parce qu'elle est bien accompagnée.
 * 2. **Un constat « donnée insuffisante » a un poids nul.** Nul multiplié par
 *    n'importe quoi reste nul : une absence de mesure ne peut pas devenir une
 *    priorité en expliquant des choses.
 * 3. **Le compte est plafonné.** Au-delà de trois descendants, l'avantage
 *    n'augmente plus. Sans plafond, une cause fourre-tout attrapant huit
 *    symptômes écraserait tout le reste par son seul nombre.
 */
export const DEPENDENCY_STEP = 0.25;
export const MAX_COUNTED_DEPENDENTS = 3;

/** Le multiplicateur, entre 1 (rien ne dépend) et 1,75 (plafond atteint). */
export function dependencyEffect(dependents: number): number {
  if (!Number.isFinite(dependents) || dependents <= 0) return 1;
  return 1 + DEPENDENCY_STEP * Math.min(MAX_COUNTED_DEPENDENTS, Math.floor(dependents));
}

export type PrioritisedFinding = RuleFinding & {
  priority: number;
  rank: number;
  /** Constats que celui-ci explique. Zéro quand il n'explique rien. */
  dependents: number;
};

/**
 * Impact × preuve × dépendance ÷ effort.
 *
 * L'effort divise plutôt qu'il ne soustrait : entre deux problèmes d'impact
 * égal, celui qui se corrige en dix minutes doit passer très loin devant celui
 * qui demande un mois — pas juste un peu devant.
 *
 * Un constat « donnée insuffisante » ne peut jamais être priorisé comme un
 * problème : son poids de preuve est nul, donc sa priorité l'est aussi. Il
 * remonte par l'axe `data`, à sa place.
 *
 * `dependents` est facultatif : sans lui, le classement est exactement celui
 * d'avant. C'est ce qui permet de le vérifier des deux côtés.
 */
export function prioritise(
  findings: RuleFinding[],
  dependents?: ReadonlyMap<string, number>,
): PrioritisedFinding[] {
  const scored = findings
    .map((f) => {
      const n = dependents?.get(f.ruleId) ?? 0;
      return {
        ...f,
        dependents: n,
        priority: Math.round(
          (f.impact * EVIDENCE_WEIGHT[f.level] * dependencyEffect(n) * 100) / Math.max(1, f.effort),
        ),
      };
    })
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
    lignes.push(`- ${a.label} : ${a.score ?? "non noté"}/100 (${detail})`);
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
