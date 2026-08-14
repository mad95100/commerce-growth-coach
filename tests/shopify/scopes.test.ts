/**
 * Contrôles du relevé de permissions Shopify.
 *
 * Aucun appel réseau : seules les fonctions pures sont exercées.
 * Script hors dépôt, non commité.
 */
import {
  SHOPIFY_REQUESTED_SCOPES,
  SHOPIFY_REQUIRED_SCOPES,
  SHOPIFY_SCOPE_PARAM,
  missingScopes,
} from "../../src/lib/connectors/shopify-scopes";
import { defineSuite } from "../../tests/harness";

export default defineSuite("Shopify — permissions accordées", async (t) => {
  // --- 1. Le paramètre d'autorisation reste inchangé (ne pas invalider les connexions) ---
  t.check(
    "paramètre scope identique à l'ancienne constante",
    SHOPIFY_SCOPE_PARAM,
    "read_products,write_products,read_orders,read_customers,read_analytics,read_price_rules,write_price_rules,read_discounts,write_discounts",
  );

  // --- 2. Le requis est un sous-ensemble strict du demandé ---
  t.check(
    "toutes les permissions requises sont demandées",
    SHOPIFY_REQUIRED_SCOPES.filter((s) => !SHOPIFY_REQUESTED_SCOPES.includes(s as never)),
    [],
  );
  t.check(
    "les permissions demandées mais inutilisées sont bien celles relevées",
    SHOPIFY_REQUESTED_SCOPES.filter((s) => !SHOPIFY_REQUIRED_SCOPES.includes(s as never)),
    ["read_customers", "read_analytics"],
  );

  // --- 3. Cas nominal : tout accordé ---
  t.check("toutes accordées => aucun manque", missingScopes([...SHOPIFY_REQUESTED_SCOPES]), []);
  t.check(
    "exactement les requises => aucun manque",
    missingScopes([...SHOPIFY_REQUIRED_SCOPES]),
    [],
  );

  // --- 4. write_ implique read_ : ne pas signaler un manque inexistant ---
  t.check(
    "write seules => les read correspondantes sont couvertes",
    missingScopes(["write_products", "write_price_rules", "write_discounts", "read_orders"]),
    [],
  );
  t.check(
    "read_ n'implique PAS write_",
    missingScopes(["read_products", "read_orders", "read_price_rules", "read_discounts"]),
    ["write_products", "write_price_rules", "write_discounts"],
  );

  // --- 5. Manques réels, dans l'ordre de la liste requise ---
  t.check(
    "produits absents => signalés",
    missingScopes([
      "read_orders",
      "read_price_rules",
      "write_price_rules",
      "read_discounts",
      "write_discounts",
    ]),
    ["read_products", "write_products"],
  );
  t.check(
    "commandes absentes => signalées",
    missingScopes(["write_products", "write_price_rules", "write_discounts"]),
    ["read_orders"],
  );
  t.check("aucune permission => toutes requises manquantes", missingScopes([]), [
    ...SHOPIFY_REQUIRED_SCOPES,
  ]);

  // --- 6. Cas limites ---
  t.check("permissions inconnues ignorées", missingScopes(["read_themes", "write_pixels"]), [
    ...SHOPIFY_REQUIRED_SCOPES,
  ]);
  t.check(
    "doublons sans effet",
    missingScopes([...SHOPIFY_REQUIRED_SCOPES, ...SHOPIFY_REQUIRED_SCOPES]),
    [],
  );
  t.check(
    "préfixe write_ seul n'invente pas de permission",
    missingScopes(["write_"]).length,
    SHOPIFY_REQUIRED_SCOPES.length,
  );
});
