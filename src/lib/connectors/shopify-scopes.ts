/**
 * Permissions Shopify : ce que l'app demande, et ce dont elle a réellement besoin.
 *
 * Module pur, sans dépendance : il est lu à la fois par la demande
 * d'autorisation et par la vérification post-connexion, qui doivent parler de
 * la même liste. La version d'API avait déjà été dupliquée entre deux fichiers
 * et avait dérivé jusqu'à devenir invalide — on ne recommence pas.
 */

/**
 * Permissions demandées lors de l'autorisation.
 *
 * `read_customers` et `read_analytics` ne sont appelées par aucun endpoint du
 * code (relevé exhaustif : products, orders, price_rules, discount_codes,
 * shop). Elles sont conservées parce que réduire la liste force une
 * réinstallation de l'app chez tous les marchands déjà connectés. À retirer
 * lors d'un prochain changement de permissions, qui imposera de toute façon
 * une réautorisation.
 */
export const SHOPIFY_REQUESTED_SCOPES = [
  "read_products",
  "write_products",
  "read_orders",
  "read_customers",
  "read_analytics",
  "read_price_rules",
  "write_price_rules",
  "read_discounts",
  "write_discounts",
] as const;

/**
 * Permissions sans lesquelles une fonctionnalité existante échoue.
 *
 * Chacune correspond à un appel réel :
 *  - read_products / write_products : listProducts, updateProduct
 *  - read_orders                    : lecture des commandes
 *  - read_price_rules / write_...   : createDiscountCode, deletePriceRule
 *  - read_discounts / write_...     : création du code promo
 *
 * `shop.json` ne demande aucune permission.
 */
export const SHOPIFY_REQUIRED_SCOPES = [
  "read_products",
  "write_products",
  "read_orders",
  "read_price_rules",
  "write_price_rules",
  "read_discounts",
  "write_discounts",
] as const;

/** Chaîne à envoyer dans le paramètre `scope` de l'URL d'autorisation. */
export const SHOPIFY_SCOPE_PARAM = SHOPIFY_REQUESTED_SCOPES.join(",");

/**
 * Permissions requises qui n'ont pas été accordées.
 *
 * Une permission d'écriture implique la lecture correspondante chez Shopify :
 * `write_products` accordée couvre `read_products`, qui n'apparaît alors pas
 * toujours dans la liste renvoyée. On en tient compte pour ne pas signaler un
 * manque inexistant.
 */
export function missingScopes(granted: readonly string[]): string[] {
  const held = new Set(granted);
  for (const scope of granted) {
    if (scope.startsWith("write_")) held.add(`read_${scope.slice("write_".length)}`);
  }
  return SHOPIFY_REQUIRED_SCOPES.filter((scope) => !held.has(scope));
}
