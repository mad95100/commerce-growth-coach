import { decryptToken } from "@/lib/crypto.server";
import { SHOPIFY_API_VERSION } from "@/lib/connectors/shopify-apply.server";
import {
  SHOPIFY_WINDOW_DAYS,
  organicReport,
  shopifyObservations,
  shopifyUnreachable,
  type RawOrder,
  type RawProduct,
} from "@/lib/connectors/shopify-observe";
import { topLandingPaths } from "@/lib/connectors/order-attribution";
import {
  funnelObservations,
  funnelQuery,
  parseFunnel,
  type FunnelRaw,
} from "@/lib/connectors/shopify-analytics";
import type { SourceFailureCause, SourceReport } from "@/lib/observations";

/**
 * Un appel, deux sources.
 *
 * Les commandes servent deux lectures distinctes : l'état de la boutique, et
 * l'origine du trafic qui l'a fait vivre. Les rendre séparément évite de faire
 * du connecteur Shopify un silo qui répondrait aussi pour l'acquisition.
 */
export type ShopifyReports = {
  shopify: SourceReport;
  organic: SourceReport;
  /**
   * Pages d'arrivée les plus utilisées par les commandes réelles.
   *
   * Elles ne sont pas une observation : elles servent au scan du site public à
   * vérifier que des adresses qui ont RÉELLEMENT vendu répondent encore. C'est
   * la seule façon de constater qu'une campagne envoie du monde dans le vide.
   */
  landings: Array<{ path: string; orders: number }>;
  /**
   * L'entonnoir brut, conservé pour localiser la fuite.
   *
   * Il ne passe pas par les observations : localiser une fuite demande de
   * comparer des marches entre elles, ce qu'une liste d'observations plates ne
   * permet pas sans reconstruire l'ordre — et donc sans risquer de l'inventer.
   */
  funnel: FunnelRaw;
  /**
   * Titres et descriptions des produits, en texte brut.
   *
   * Ils ne sont pas une observation — un texte ne se mesure pas. Ils servent à
   * lire le VOCABULAIRE que la boutique adresse à son visiteur, seul signal de
   * positionnement qui ne se déduise pas des prix. Le HTML est retiré : ce qui
   * compte est ce que le visiteur lit, pas la façon dont c'est balisé.
   */
  productTexts: string[];
};

/** Shopify injoignable : les deux lectures le sont aussi, sans aucun zéro. */
function unreachable(error: string, cause: SourceFailureCause = "injoignable"): ShopifyReports {
  return {
    shopify: { ...shopifyUnreachable(error), cause },
    organic: { source: "organic", observations: [], gaps: [], reachable: false, error, cause },
    landings: [],
    productTexts: [],
    funnel: {
      sessions: null,
      cartAdditions: null,
      reachedCheckout: null,
      completedCheckout: null,
      reachable: false,
      error,
    },
  };
}

/**
 * Lecture Shopify. La partie réseau, et rien d'autre.
 *
 * TOUT LE CALCUL EST DANS LE FICHIER PUR VOISIN. Ce module ne fait que
 * chercher, et il le fait de la façon la plus tolérante possible : chaque
 * ressource est indépendante, et l'échec de l'une n'annule pas les autres. Une
 * boutique dont l'inventaire des paniers abandonnés est refusé doit quand même
 * produire son catalogue et ses commandes — sinon une permission manquante
 * ferait disparaître tout le diagnostic au lieu d'en retirer une ligne.
 *
 * AUCUNE NOUVELLE PERMISSION. Tout ce qui est lu ici tient dans les
 * autorisations déjà accordées (voir `shopify-scopes.ts`). En demander une de
 * plus imposerait une réautorisation à chaque marchand déjà connecté, pour des
 * données qu'on peut obtenir autrement ou déclarer manquantes.
 */

/** Plafond de pagination. Au-delà, le catalogue est annoncé comme tronqué. */
const MAX_PRODUCTS = 250;
const MAX_ORDERS = 250;

type Fetcher = (url: string, init: { headers: Record<string, string> }) => Promise<Response>;

/**
 * Ce qu'un statut HTTP dit de la SUITE, et donc à qui elle revient.
 *
 * 401 et 403 sont les seuls que le marchand puisse réparer, et ils sont aussi
 * les plus faciles à confondre avec une panne : la boutique répond, elle refuse
 * simplement de nous parler. 404 les rejoint — une boutique dont l'app a été
 * désinstallée ne renvoie pas 401, elle disparaît.
 */
function causeDuStatut(statut: number | null): SourceFailureCause {
  if (statut === null) return "injoignable";
  if (statut === 401 || statut === 403 || statut === 404) return "autorisation_invalide";
  if (statut === 429) return "quota_depasse";
  if (statut >= 500) return "fournisseur_en_panne";
  return "injoignable";
}

/**
 * Collecte les observations Shopify d'une boutique.
 *
 * Ne lève jamais : une source injoignable produit un rapport `reachable:false`,
 * que le moteur sait annoncer au modèle comme une interdiction de conclure sur
 * ce canal — au lieu de le laisser combler le silence.
 */
export async function fetchShopifyObservations(
  shop: string,
  encryptedToken: string,
  fetcher: Fetcher = fetch,
): Promise<ShopifyReports> {
  let headers: Record<string, string>;
  try {
    headers = {
      "X-Shopify-Access-Token": decryptToken(encryptedToken),
      "Content-Type": "application/json",
    };
  } catch {
    // Jeton illisible : la clé de chiffrement a changé, ou la connexion est à
    // refaire. Rien à diagnostiquer, et surtout rien à inventer. Dans les deux
    // cas la sortie est la même pour le marchand — rebrancher.
    return unreachable("Jeton Shopify illisible.", "autorisation_invalide");
  }

  const base = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}`;
  const since = new Date(Date.now() - SHOPIFY_WINDOW_DAYS * 86_400_000).toISOString();

  /*
    LE STATUT REFUSÉ ÉTAIT PERDU, ET AVEC LUI LA SEULE CHOSE UTILE.

    `get` rendait `null` pour tout — 401, 429, 503, coupure réseau. Le premier
    appel échouait donc toujours sur la même phrase, « La boutique n'a pas
    répondu », qui se lit comme un incident passager. Une AUTORISATION RÉVOQUÉE
    prenait cette forme-là : le marchand attendait, relançait, réattendait, et
    rien ne lui disait jamais que la seule issue était de rebrancher — alors
    qu'il pouvait le faire en trente secondes.

    On retient donc le statut du premier refus rencontré. Il ne change rien à
    la tolérance des ressources secondaires : leur échec ne concerne toujours
    qu'elles.
  */
  let refus: number | null = null;

  /** Une ressource. Son échec ne concerne qu'elle. */
  const get = async <T>(path: string): Promise<T | null> => {
    try {
      const res = await fetcher(`${base}/${path}`, { headers });
      if (!res.ok) {
        if (refus === null) refus = res.status;
        return null;
      }
      return (await res.json()) as T;
    } catch {
      return null;
    }
  };

  // La boutique d'abord : sans elle, on ne sait même pas dans quelle devise
  // les montants sont libellés, et un montant sans devise n'est pas un montant.
  const shopJson = await get<{ shop?: { currency?: string | null } }>("shop.json");
  if (!shopJson?.shop) {
    return unreachable(
      refus === null ? "La boutique n'a pas répondu." : `Shopify a refusé la lecture (${refus}).`,
      causeDuStatut(refus),
    );
  }

  const [countJson, productsJson, ordersJson, checkoutsJson] = await Promise.all([
    get<{ count?: number }>("products/count.json"),
    get<{ products?: RawProduct[] }>(
      `products.json?limit=${MAX_PRODUCTS}&fields=id,title,body_html,status,images,variants`,
    ),
    get<{ orders?: RawOrder[] }>(
      `orders.json?status=any&limit=${MAX_ORDERS}&created_at_min=${since}` +
        `&fields=id,total_price,total_discounts,financial_status,created_at,customer,discount_codes,refunds,line_items,referring_site,landing_site,source_name`,
    ),
    // Les paniers abandonnés : la seule fenêtre sur les acheteurs qui ont
    // renoncé après avoir décidé. C'est la perte la plus chère et la plus
    // réparable, et aucune autre ressource ne la montre.
    get<{ checkouts?: unknown[] }>(`checkouts.json?limit=250&created_at_min=${since}`),
  ]);

  const products = Array.isArray(productsJson?.products) ? productsJson.products : [];

  const raw = {
    currency: shopJson.shop.currency ?? null,
    productCount: typeof countJson?.count === "number" ? countJson.count : null,
    products,
    orders: Array.isArray(ordersJson?.orders) ? ordersJson.orders : [],
    abandonedCheckouts: Array.isArray(checkoutsJson?.checkouts)
      ? checkoutsJson.checkouts.length
      : null,
    // Le catalogue est-il complet ? Un compte supérieur au nombre lu signifie
    // que la pagination a coupé : les taux calculés dessus ne portent alors que
    // sur l'échantillon, et l'observation le dit.
    productsComplete:
      typeof countJson?.count === "number"
        ? countJson.count <= products.length
        : products.length < MAX_PRODUCTS,
  };

  // L'ENTONNOIR, PAR SHOPIFYQL. Sessions, ajouts au panier et passages en
  // caisse vivent dans le jeu de données `sessions`, interrogeable depuis la
  // même API GraphQL avec `read_analytics` — permission DÉJÀ demandée et déjà
  // accordée. Le connecteur les déclarait hors de portée : c'était faux, et
  // cela conduisait à réclamer au marchand un outil de mesure tiers pour une
  // donnée que sa propre boutique possède.
  //
  // L'appel est isolé : son échec retire l'entonnoir du diagnostic, il ne
  // retire pas le diagnostic.
  const funnel = await fetchFunnel(base, headers, fetcher);
  // LA CAUSE EXACTE VA AU JOURNAL. La phrase montrée au marchand est
  // volontairement dépouillée de tout terme technique ; sans cette ligne, le
  // message de Shopify — celui qui dit si le champ a disparu, si la permission
  // manque ou si l'offre ne l'ouvre pas — n'existait nulle part une fois
  // l'audit terminé, et la question « pourquoi cet entonnoir est-il toujours
  // vide ? » restait sans réponse possible.
  if (!funnel.reachable) {
    console.error(`[audit] entonnoir ShopifyQL illisible (${shop}) :`, funnel.error);
  }
  const funnelReport = funnelObservations(funnel);

  const shopifyReport = shopifyObservations(raw);

  // DEUX rapports, pas un. Les commandes disent l'état de la boutique ET
  // l'origine du trafic qui l'a fait vivre : ce sont deux sources différentes
  // pour le moteur, même si un seul appel réseau les a produites.
  return {
    shopify: {
      ...shopifyReport,
      observations: [...shopifyReport.observations, ...funnelReport.observations],
      // Un trou comblé cesse d'être un trou : les manques déclarés par le
      // connecteur de base sont retirés dès que l'entonnoir les couvre.
      gaps: [
        ...shopifyReport.gaps.filter((g) => !funnelReport.observations.some((o) => o.id === g.id)),
        ...funnelReport.gaps,
      ],
    },
    organic: organicReport(raw),
    landings: topLandingPaths(raw.orders),
    funnel,
    productTexts: products.flatMap((p) =>
      [p.title ?? "", stripHtml(p.body_html ?? "")].filter((x) => x.trim().length > 0),
    ),
  };
}

/**
 * Interroge ShopifyQL.
 *
 * `shopifyqlQuery` vit dans l'API GraphQL, pas dans REST : c'est un POST unique
 * dont la réponse est un tableau de colonnes et de lignes. Ne lève jamais —
 * une permission refusée rend un entonnoir injoignable, que la couche pure sait
 * traduire en donnée manquante nommée.
 */
async function fetchFunnel(
  base: string,
  headers: Record<string, string>,
  fetcher: Fetcher,
): Promise<FunnelRaw> {
  const requete = `query($q: String!) {
    shopifyqlQuery(query: $q) {
      __typename
      ... on TableResponse {
        tableData { columns { name dataType } rowData }
      }
      parseErrors { message }
    }
  }`;
  try {
    const res = await fetcher(`${base}/graphql.json`, {
      headers,
      method: "POST",
      body: JSON.stringify({ query: requete, variables: { q: funnelQuery() } }),
    } as never);
    if (!res.ok) {
      return {
        sessions: null,
        cartAdditions: null,
        reachedCheckout: null,
        completedCheckout: null,
        reachable: false,
        error: `HTTP ${res.status}`,
      };
    }
    const json = (await res.json()) as {
      data?: { shopifyqlQuery?: unknown };
      errors?: Array<{ message?: string }>;
    };
    if (json.errors?.length) {
      return {
        sessions: null,
        cartAdditions: null,
        reachedCheckout: null,
        completedCheckout: null,
        reachable: false,
        error: json.errors[0]?.message ?? "Erreur GraphQL",
      };
    }
    return parseFunnel(json.data?.shopifyqlQuery);
  } catch (e) {
    return {
      sessions: null,
      cartAdditions: null,
      reachedCheckout: null,
      completedCheckout: null,
      reachable: false,
      error: e instanceof Error ? e.message : "Appel ShopifyQL impossible.",
    };
  }
}

/**
 * Retire le balisage d'une description Shopify.
 *
 * L'éditeur Shopify produit du HTML même pour un texte simple. Compter
 * « strong » ou « div » comme du vocabulaire de la boutique fausserait la
 * lecture du positionnement.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
