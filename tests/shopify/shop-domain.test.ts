import { normalizeShop } from "../../src/lib/connectors/shopify-domain";
import { defineSuite } from "../harness";

/**
 * Normalisation du domaine de boutique.
 *
 * La fonction réelle est importée, et non recopiée : une copie testerait une
 * autre implémentation que celle qui tourne, et resterait verte pendant qu'un
 * défaut passe en production.
 */
export default defineSuite("Shopify — normalisation du domaine", (t) => {
  const T = "ecom-pilot-test.myshopify.com";

  const accepted: Array<[string, string]> = [
    ["ecom-pilot-test.myshopify.com", T],
    ["ecom-pilot-test", T],
    ["https://ecom-pilot-test.myshopify.com/", T],
    ["  Ecom-Pilot-Test.myshopify.com  ", T],
    // L'adresse que l'utilisateur a réellement sous les yeux dans l'admin moderne.
    ["https://admin.shopify.com/store/ecom-pilot-test", T],
    ["admin.shopify.com/store/ecom-pilot-test/products", T],
    ["https://admin.shopify.com/store/ecom-pilot-test/orders/123", T],
  ];
  for (const [input, want] of accepted) {
    t.check(`« ${input.trim() || "(vide)"} » => ${want}`, normalizeShop(input), want);
  }

  const rejected = ["", "   ", "pas un domaine !", "https://example.com", "http://", "@@@"];
  for (const input of rejected) {
    t.throws(`« ${input.trim() || "(vide)"} » => refusé`, () => normalizeShop(input));
  }
});
