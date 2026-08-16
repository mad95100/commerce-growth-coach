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
import type { SourceReport } from "@/lib/observations";

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
};

/** Shopify injoignable : les deux lectures le sont aussi, sans aucun zéro. */
function unreachable(error: string): ShopifyReports {
  return {
    shopify: shopifyUnreachable(error),
    organic: { source: "organic", observations: [], gaps: [], reachable: false, error },
    landings: [],
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
    // refaire. Rien à diagnostiquer, et surtout rien à inventer.
    return unreachable("Jeton Shopify illisible.");
  }

  const base = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}`;
  const since = new Date(Date.now() - SHOPIFY_WINDOW_DAYS * 86_400_000).toISOString();

  /** Une ressource. Son échec ne concerne qu'elle. */
  const get = async <T>(path: string): Promise<T | null> => {
    try {
      const res = await fetcher(`${base}/${path}`, { headers });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  };

  // La boutique d'abord : sans elle, on ne sait même pas dans quelle devise
  // les montants sont libellés, et un montant sans devise n'est pas un montant.
  const shopJson = await get<{ shop?: { currency?: string | null } }>("shop.json");
  if (!shopJson?.shop) {
    return unreachable("La boutique n'a pas répondu.");
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

  // DEUX rapports, pas un. Les commandes disent l'état de la boutique ET
  // l'origine du trafic qui l'a fait vivre : ce sont deux sources différentes
  // pour le moteur, même si un seul appel réseau les a produites.
  return {
    shopify: shopifyObservations(raw),
    organic: organicReport(raw),
    landings: topLandingPaths(raw.orders),
  };
}
