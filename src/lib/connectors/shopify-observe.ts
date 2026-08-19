/**
 * Shopify → observations. La partie PURE, sans réseau.
 *
 * POURQUOI SÉPARER. Le calcul est ici, les appels HTTP sont dans le fichier
 * `.server`. Cette séparation n'est pas cosmétique : elle rend exerçable, sans
 * boutique ni jeton, exactement ce qui décidera de ce que le marchand lira.
 * Une règle « un produit sans description ne convertit pas » qu'on ne peut
 * tester qu'en production n'est pas une règle, c'est un pari.
 *
 * CE QUE SHOPIFY DONNE, ET CE QU'IL NE DONNE PAS. L'API Admin expose le
 * catalogue, les commandes, les paniers abandonnés, les remboursements et les
 * clients. Elle n'expose PAS les sessions ni les vues produit — celles-ci
 * vivent dans l'API Analytics, avec d'autres permissions. Conséquence directe,
 * et assumée : **le taux de conversion et le rapport vu/acheté ne sont pas
 * calculables ici.** Ils sont donc déclarés comme des manques nommés, jamais
 * approchés par une estimation qui aurait l'apparence d'une mesure.
 */

import type { Observation, ObservationGap, SourceReport } from "@/lib/observations";
import { attributionObservations } from "@/lib/connectors/order-attribution";

/** Fenêtre de toutes les mesures de commandes, alignée sur le reste du moteur. */
export const SHOPIFY_WINDOW_DAYS = 30;

/** Formes brutes, réduites à ce qu'on lit réellement. */
export type RawVariant = {
  price?: string | number | null;
  inventory_quantity?: number | null;
  inventory_management?: string | null;
};

export type RawProduct = {
  id?: number | string;
  title?: string | null;
  body_html?: string | null;
  status?: string | null;
  images?: unknown[] | null;
  image?: unknown;
  variants?: RawVariant[] | null;
};

export type RawLineItem = {
  product_id?: number | string | null;
  title?: string | null;
  quantity?: number | null;
  price?: string | number | null;
};

export type RawOrder = {
  id?: number | string;
  total_price?: string | number | null;
  financial_status?: string | null;
  created_at?: string | null;
  customer?: { id?: number | string | null; orders_count?: number | null } | null;
  discount_codes?: unknown[] | null;
  refunds?: unknown[] | null;
  line_items?: RawLineItem[] | null;
  total_discounts?: string | number | null;
  /** Origine de la session qui a produit la commande. Couvert par `read_orders`. */
  referring_site?: string | null;
  landing_site?: string | null;
  source_name?: string | null;
};

export type RawRefund = { amount?: string | number | null };

export type ShopifyRaw = {
  currency: string | null;
  productCount: number | null;
  products: RawProduct[];
  orders: RawOrder[];
  /** Paniers abandonnés sur la fenêtre. `null` si l'appel n'a pas abouti. */
  abandonedCheckouts: number | null;
  /** Le catalogue a-t-il été lu en entier, ou tronqué par la pagination ? */
  productsComplete: boolean;
};

function money(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Une commande encaissée. Les autres ne sont pas du chiffre d'affaires. */
function isPaid(order: RawOrder): boolean {
  return order.financial_status === "paid" || order.financial_status === "partially_paid";
}

/**
 * Une description Shopify est du HTML. Une balise vide — `<p></p>`, un `<br>` —
 * est ce que renvoie l'éditeur quand le marchand n'a rien écrit, et la compter
 * comme une description ferait passer une fiche vide pour renseignée.
 */
export function hasDescription(html: string | null | undefined): boolean {
  if (typeof html !== "string") return false;
  return (
    html
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/gi, " ")
      .trim().length >= 20
  );
}

/**
 * Un produit est en rupture si TOUTES ses variantes suivies le sont.
 *
 * UNE QUANTITÉ ILLISIBLE N'EST PAS UN ZÉRO. Le calcul écrivait
 * `inventory_quantity ?? 0` : une variante dont Shopify ne renvoie pas la
 * quantité — le champ est déclaré facultatif ici même, donc son absence est
 * prévue — comptait comme une variante à zéro, et le produit était déclaré en
 * rupture. Le constat remonte ensuite tel quel au marchand, avec une preuve qui
 * affirme la mesure : « toutes leurs variantes suivies à zéro ». Puis le
 * raisonnement croisé s'en sert pour lui dire que son trafic payant tombe sur
 * des produits indisponibles. Une chaîne entière de conclusions, sur un chiffre
 * que personne n'a lu.
 *
 * La branche voisine tenait déjà exactement ce raisonnement pour le stock non
 * suivi — « le compter en rupture inventerait un problème inexistant ». Une
 * quantité non lue n'est pas différente d'un stock non suivi : dans les deux
 * cas, nous ne savons pas.
 *
 * UNE SEULE VARIANTE ILLISIBLE SUFFIT À EMPÊCHER DE CONCLURE, et c'est
 * délibéré : l'affirmation à démontrer est que TOUTES les variantes sont à
 * zéro. Elle ne se démontre pas sur un ensemble dont un membre n'a pas été lu.
 */
export function isOutOfStock(product: RawProduct): boolean {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const tracked = variants.filter((v) => v.inventory_management != null);
  if (tracked.length === 0) return false;
  if (tracked.some((v) => typeof v.inventory_quantity !== "number")) return false;
  return tracked.every((v) => v.inventory_quantity! <= 0);
}

/**
 * TROIS ÉTATS DE DISPONIBILITÉ, ET JAMAIS DEUX.
 *
 * « Disponible » et « en rupture » ne couvrent pas le catalogue : il existe un
 * troisième cas, majoritaire chez les marchands qui ne suivent pas leur stock,
 * et c'est « nous ne savons pas ». Le confondre avec l'un des deux autres
 * produit un mensonge dans les deux sens — annoncer des ruptures qui n'existent
 * pas, ou promettre une disponibilité qu'on n'a pas lue.
 *
 * `isOutOfStock` tient déjà le premier bord de cette ligne. Ces deux fonctions
 * tiennent le second : elles nomment ce qui n'est PAS mesurable, pour que le
 * moteur puisse le déclarer manquant au lieu de le compter comme sain.
 */
export function stockIsUnknowable(product: RawProduct): boolean {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (variants.length === 0) return true;
  const tracked = variants.filter((v) => v.inventory_management != null);
  // Aucun suivi de stock : Shopify vend sans compter, donc rien ne se lit.
  if (tracked.length === 0) return true;
  // Suivi déclaré mais quantité illisible : la mesure existe et ne nous parvient
  // pas. Le résultat est le même — nous ne savons pas.
  return tracked.some((v) => typeof v.inventory_quantity !== "number");
}

/**
 * Un produit dont CERTAINES variantes seulement sont épuisées.
 *
 * POURQUOI CE CAS MÉRITE SON PROPRE CONSTAT. « En rupture » et « disponible »
 * décrivent tous deux une page cohérente. Celui-ci décrit une page qui propose
 * un choix — une taille, une couleur — dont une partie ne peut pas être
 * achetée. Le visiteur choisit, découvre que son choix est indisponible, et
 * repart : la fiche a fait son travail de conviction pour rien.
 *
 * Exige de savoir lire l'état de TOUTES les variantes suivies : un produit dont
 * une quantité est illisible ne peut pas être déclaré partiellement épuisé.
 */
export function isPartiallyOutOfStock(product: RawProduct): boolean {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const tracked = variants.filter((v) => v.inventory_management != null);
  if (tracked.length < 2) return false;
  if (tracked.some((v) => typeof v.inventory_quantity !== "number")) return false;
  const epuisees = tracked.filter((v) => v.inventory_quantity! <= 0).length;
  return epuisees > 0 && epuisees < tracked.length;
}

/** Une fiche expose-t-elle au moins un prix utilisable ? */
export function hasUsablePrice(product: RawProduct): boolean {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  return variants.some((v) => {
    const p = money(v.price);
    return p !== null && p > 0;
  });
}

/** Nombre de variantes déclarées. Un choix existe à partir de deux. */
export function variantCount(product: RawProduct): number {
  return Array.isArray(product.variants) ? product.variants.length : 0;
}

function imageCount(product: RawProduct): number {
  if (Array.isArray(product.images)) return product.images.length;
  return product.image ? 1 : 0;
}

/**
 * Transforme les données brutes en observations.
 *
 * Aucune valeur n'est produite quand la donnée sous-jacente est absente : une
 * observation à zéro se lirait comme une mesure. C'est la règle qui empêche
 * une boutique neuve d'être diagnostiquée comme une boutique en échec.
 */
export function shopifyObservations(raw: ShopifyRaw): SourceReport {
  const observations: Observation[] = [];
  const gaps: ObservationGap[] = [];
  const currency = raw.currency;

  const add = (o: Observation) => observations.push(o);

  // --- Catalogue ------------------------------------------------------------
  const products = raw.products;
  const productCount = raw.productCount ?? (products.length > 0 ? products.length : null);

  if (productCount !== null) {
    add({
      id: "shopify.product_count",
      source: "shopify",
      domain: "produit",
      label: "Produits au catalogue",
      value: productCount,
      unit: "count",
      periodDays: 0,
      evidence: `${productCount} produits (Shopify /products/count.json)`,
      sample: productCount,
    });
  }

  if (products.length > 0) {
    const withoutDescription = products.filter((p) => !hasDescription(p.body_html)).length;
    const withoutImage = products.filter((p) => imageCount(p) === 0).length;
    const outOfStock = products.filter(isOutOfStock).length;
    const scope = raw.productsComplete
      ? `${products.length} produits lus`
      : `${products.length} produits lus (catalogue tronqué : le total est plus élevé)`;

    add({
      id: "shopify.products_without_description",
      source: "shopify",
      domain: "produit",
      label: "Fiches sans description exploitable",
      value: withoutDescription,
      unit: "count",
      periodDays: 0,
      evidence: `${withoutDescription} fiches sur ${scope} n'ont pas de texte descriptif (Shopify /products.json)`,
      sample: products.length,
    });
    add({
      id: "shopify.products_without_image",
      source: "shopify",
      domain: "produit",
      label: "Fiches sans visuel",
      value: withoutImage,
      unit: "count",
      periodDays: 0,
      evidence: `${withoutImage} fiches sur ${scope} n'ont aucune image (Shopify /products.json)`,
      sample: products.length,
    });
    add({
      id: "shopify.products_out_of_stock",
      source: "shopify",
      domain: "operations",
      label: "Produits en rupture, toutes variantes",
      value: outOfStock,
      unit: "count",
      periodDays: 0,
      evidence: `${outOfStock} produits sur ${scope} ont toutes leurs variantes suivies à zéro (Shopify /products.json)`,
      sample: products.length,
    });

    /*
      PRIX, VARIANTES, DISPONIBILITÉ — trois familles lues depuis toujours dans
      le même appel, et dont rien ne sortait.

      Les variantes servaient uniquement à décider si un produit était en
      rupture ; leur nombre, leur prix et leur disponibilité PARTIELLE
      n'existaient nulle part. C'est pourtant là que se joue une bonne part du
      merchandising : une fiche sans prix ne se vend pas, et une fiche qui
      propose un choix dont la moitié est épuisée fait travailler la conviction
      pour rien.
    */
    const sansPrix = products.filter((p) => !hasUsablePrice(p)).length;
    const multiVariante = products.filter((p) => variantCount(p) > 1).length;
    const partiellementEpuises = products.filter(isPartiallyOutOfStock).length;
    const stockInconnu = products.filter(stockIsUnknowable).length;

    add({
      id: "shopify.products_without_price",
      source: "shopify",
      domain: "offre",
      label: "Fiches sans prix utilisable",
      value: sansPrix,
      unit: "count",
      periodDays: 0,
      evidence: `${sansPrix} fiches sur ${scope} n'exposent aucune variante à un prix strictement positif (Shopify /products.json)`,
      sample: products.length,
    });
    add({
      id: "shopify.products_multi_variant",
      source: "shopify",
      domain: "produit",
      label: "Fiches proposant un choix",
      value: multiVariante,
      unit: "count",
      periodDays: 0,
      evidence: `${multiVariante} fiches sur ${scope} déclarent plus d'une variante (Shopify /products.json)`,
      sample: products.length,
    });
    add({
      id: "shopify.products_partially_out_of_stock",
      source: "shopify",
      domain: "operations",
      label: "Fiches partiellement épuisées",
      value: partiellementEpuises,
      unit: "count",
      periodDays: 0,
      evidence: `${partiellementEpuises} fiches sur ${scope} ont une partie de leurs variantes suivies à zéro, l'autre partie disponible (Shopify /products.json)`,
      sample: products.length,
    });
    /*
      LE TROISIÈME ÉTAT, celui qui manquait.

      « Disponible » et « en rupture » ne couvrent pas le catalogue. Un produit
      dont le stock n'est pas suivi, ou dont la quantité ne nous parvient pas,
      n'est ni l'un ni l'autre : il est illisible. Le ranger dans l'une des deux
      cases produirait soit une rupture inventée, soit une disponibilité
      promise sans l'avoir lue. Cette observation le compte pour ce qu'il est,
      et une règle en fait un manque de donnée nommé — pas un problème.
    */
    add({
      id: "shopify.products_stock_inconnu",
      source: "shopify",
      domain: "operations",
      label: "Fiches dont la disponibilité n'est pas lisible",
      value: stockInconnu,
      unit: "count",
      periodDays: 0,
      evidence: `${stockInconnu} fiches sur ${scope} ne permettent pas d'établir la disponibilité : stock non suivi, ou quantité non renvoyée par Shopify (Shopify /products.json)`,
      sample: products.length,
    });

    const prices = products
      .flatMap((p) => (Array.isArray(p.variants) ? p.variants : []))
      .map((v) => money(v.price))
      .filter((p): p is number => p !== null && p > 0);

    if (prices.length > 0) {
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      const mid = median(prices)!;
      const shared = {
        source: "shopify" as const,
        domain: "offre" as const,
        unit: "currency" as const,
        currency,
        periodDays: 0,
        sample: prices.length,
      };
      add({
        ...shared,
        id: "shopify.price_min",
        label: "Prix le plus bas",
        value: min,
        evidence: `Variante la moins chère sur ${prices.length} variantes (Shopify /products.json)`,
      });
      add({
        ...shared,
        id: "shopify.price_max",
        label: "Prix le plus élevé",
        value: max,
        evidence: `Variante la plus chère sur ${prices.length} variantes (Shopify /products.json)`,
      });
      add({
        ...shared,
        id: "shopify.price_median",
        label: "Prix médian",
        value: mid,
        evidence: `Médiane de ${prices.length} variantes (Shopify /products.json)`,
      });
    }
  }

  // --- Commandes ------------------------------------------------------------
  const paid = raw.orders.filter(isPaid);
  const revenue = paid.reduce((sum, o) => sum + (money(o.total_price) ?? 0), 0);

  // Une boutique sans commande produit quand même l'observation à zéro : ici,
  // zéro EST la mesure, et c'est le fait le plus important à diagnostiquer.
  add({
    id: "shopify.orders_30d",
    source: "shopify",
    domain: "conversion",
    label: "Commandes payées",
    value: paid.length,
    unit: "count",
    periodDays: SHOPIFY_WINDOW_DAYS,
    evidence: `${paid.length} commandes payées sur ${SHOPIFY_WINDOW_DAYS} jours (Shopify /orders.json)`,
    sample: paid.length,
  });
  add({
    id: "shopify.revenue_30d",
    source: "shopify",
    domain: "rentabilite",
    label: "Chiffre d'affaires",
    value: revenue,
    unit: "currency",
    currency,
    periodDays: SHOPIFY_WINDOW_DAYS,
    evidence: `Somme de ${paid.length} commandes payées sur ${SHOPIFY_WINDOW_DAYS} jours (Shopify /orders.json)`,
    sample: paid.length,
  });

  if (paid.length > 0) {
    add({
      id: "shopify.aov",
      source: "shopify",
      domain: "offre",
      label: "Panier moyen",
      value: revenue / paid.length,
      unit: "currency",
      currency,
      periodDays: SHOPIFY_WINDOW_DAYS,
      evidence: `Chiffre d'affaires divisé par ${paid.length} commandes (Shopify /orders.json)`,
      sample: paid.length,
    });

    const refunded = paid.filter((o) => Array.isArray(o.refunds) && o.refunds.length > 0).length;
    add({
      id: "shopify.refund_rate_30d",
      source: "shopify",
      domain: "rentabilite",
      label: "Part des commandes remboursées",
      value: (refunded / paid.length) * 100,
      unit: "percent",
      periodDays: SHOPIFY_WINDOW_DAYS,
      evidence: `${refunded} commandes remboursées sur ${paid.length} (Shopify /orders.json)`,
      sample: paid.length,
    });

    const discounted = paid.filter(
      (o) => Array.isArray(o.discount_codes) && o.discount_codes.length > 0,
    ).length;
    add({
      id: "shopify.discounted_order_share",
      source: "shopify",
      domain: "rentabilite",
      label: "Part des commandes sous code promo",
      value: (discounted / paid.length) * 100,
      unit: "percent",
      periodDays: SHOPIFY_WINDOW_DAYS,
      evidence: `${discounted} commandes sur ${paid.length} portent un code de réduction (Shopify /orders.json)`,
      sample: paid.length,
    });

    const multiItem = paid.filter(
      (o) => Array.isArray(o.line_items) && o.line_items.length > 1,
    ).length;
    add({
      id: "shopify.multi_item_order_share",
      source: "shopify",
      domain: "offre",
      label: "Part des commandes à plusieurs articles",
      value: (multiItem / paid.length) * 100,
      unit: "percent",
      periodDays: SHOPIFY_WINDOW_DAYS,
      evidence: `${multiItem} commandes sur ${paid.length} contiennent plus d'un article (Shopify /orders.json)`,
      sample: paid.length,
    });

    // Nouveaux contre anciens clients. `orders_count` est le compteur Shopify
    // du client ; il n'est présent que si la permission client est accordée.
    const withCustomer = paid.filter((o) => o.customer?.orders_count != null);
    if (withCustomer.length > 0) {
      const returning = withCustomer.filter((o) => (o.customer!.orders_count ?? 0) > 1).length;
      add({
        id: "shopify.returning_customer_rate",
        source: "shopify",
        domain: "retention",
        label: "Part des commandes de clients déjà venus",
        value: (returning / withCustomer.length) * 100,
        unit: "percent",
        periodDays: SHOPIFY_WINDOW_DAYS,
        evidence: `${returning} commandes sur ${withCustomer.length} proviennent d'un client ayant déjà commandé (Shopify /orders.json)`,
        sample: withCustomer.length,
      });
    } else {
      gaps.push({
        id: "shopify.returning_customer_rate",
        label: "Nouveaux clients contre clients fidèles",
        source: "shopify",
        reason:
          "Les commandes ne portent pas le compteur client — permission client absente, ou commandes passées sans compte.",
        wouldEnable:
          "Savoir si le chiffre d'affaires repose sur du réachat ou sur de l'acquisition permanente.",
      });
    }

    // Concentration du chiffre d'affaires par produit.
    const revenueByProduct = new Map<string, number>();
    for (const order of paid) {
      for (const line of Array.isArray(order.line_items) ? order.line_items : []) {
        const key = String(line.product_id ?? line.title ?? "");
        if (!key) continue;
        const amount = (money(line.price) ?? 0) * (line.quantity ?? 1);
        revenueByProduct.set(key, (revenueByProduct.get(key) ?? 0) + amount);
      }
    }
    const lineRevenue = [...revenueByProduct.values()].reduce((s, v) => s + v, 0);
    if (lineRevenue > 0) {
      const top = Math.max(...revenueByProduct.values());
      add({
        id: "shopify.top_product_revenue_share",
        source: "shopify",
        domain: "offre",
        label: "Part du premier produit dans le chiffre d'affaires",
        value: (top / lineRevenue) * 100,
        unit: "percent",
        periodDays: SHOPIFY_WINDOW_DAYS,
        evidence: `Le produit le plus vendu pèse ${Math.round((top / lineRevenue) * 100)} % des lignes de commande, sur ${revenueByProduct.size} produits vendus (Shopify /orders.json)`,
        sample: revenueByProduct.size,
      });
    }
  }

  // --- Paniers abandonnés ---------------------------------------------------
  if (raw.abandonedCheckouts !== null) {
    add({
      id: "shopify.abandoned_checkouts_30d",
      source: "shopify",
      domain: "conversion",
      label: "Paniers abandonnés",
      value: raw.abandonedCheckouts,
      unit: "count",
      periodDays: SHOPIFY_WINDOW_DAYS,
      evidence: `${raw.abandonedCheckouts} paniers abandonnés sur ${SHOPIFY_WINDOW_DAYS} jours (Shopify /checkouts.json)`,
      sample: raw.abandonedCheckouts,
    });

    const started = raw.abandonedCheckouts + paid.length;
    if (started > 0) {
      add({
        id: "shopify.cart_abandonment_rate",
        source: "shopify",
        domain: "conversion",
        label: "Taux d'abandon de panier",
        value: (raw.abandonedCheckouts / started) * 100,
        unit: "percent",
        periodDays: SHOPIFY_WINDOW_DAYS,
        evidence: `${raw.abandonedCheckouts} abandons pour ${started} paniers ouverts (Shopify /checkouts.json + /orders.json)`,
        sample: started,
      });
    }
  } else {
    gaps.push({
      id: "shopify.abandoned_checkouts_30d",
      label: "Paniers abandonnés",
      source: "shopify",
      reason: "L'inventaire des paniers abandonnés n'a pas pu être lu.",
      wouldEnable:
        "Distinguer un problème de tunnel d'un problème d'offre : un panier abandonné est un acheteur déjà décidé.",
    });
  }

  // --- CE QUE L'API ADMIN NE DONNE PAS -------------------------------------
  // Déclaré ici une fois pour toutes, et jamais approché par une estimation.
  // Sans sessions, le taux de conversion n'existe pas : l'inventer reviendrait
  // à fabriquer précisément le chiffre sur lequel tout le monde décide.
  gaps.push(
    {
      id: "shopify.sessions_30d",
      label: "Sessions et visiteurs",
      source: "shopify",
      reason:
        "L'API Admin de Shopify n'expose pas le trafic : il vit dans l'API Analytics, avec d'autres permissions.",
      wouldEnable:
        "Le taux de conversion — la mesure qui départage un problème de trafic d'un problème de boutique.",
    },
    {
      id: "shopify.product_views_30d",
      label: "Vues par produit",
      source: "shopify",
      reason:
        "Non exposé par l'API Admin. Demande l'API Analytics ou un outil de mesure du trafic.",
      wouldEnable:
        "Isoler les produits très consultés et jamais achetés, où le blocage est sur la fiche elle-même.",
    },
  );

  return { source: "shopify", observations, gaps, reachable: true };
}

/**
 * Le canal organique, tiré des MÊMES commandes.
 *
 * Rapport distinct et non fondu dans celui de Shopify : ce qu'il décrit n'est
 * pas la boutique, c'est l'acquisition. Les mélanger reviendrait à faire du
 * connecteur Shopify le silo que cette architecture existe pour éviter.
 */
export function organicReport(raw: ShopifyRaw): SourceReport {
  const { observations, gaps } = attributionObservations({
    orders: raw.orders,
    currency: raw.currency,
  });
  return { source: "organic", observations, gaps, reachable: true };
}

/** Rapport d'une source injoignable. Aucune observation, jamais de zéro. */
export function shopifyUnreachable(error?: string): SourceReport {
  return { source: "shopify", observations: [], gaps: [], reachable: false, error: error ?? null };
}
