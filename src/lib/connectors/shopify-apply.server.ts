import { decryptToken } from "@/lib/crypto.server";

/**
 * Version de l'API Admin Shopify.
 *
 * `2024-10` était codée en dur et n'est PLUS SUPPORTÉE : l'API ne renvoie que
 * 2025-10, 2026-01, 2026-04 et 2026-07 (vérifié via publicApiVersions sur la
 * boutique réelle). Tous les appels Shopify échouaient donc.
 *
 * La valeur est exportée pour rester unique — elle était dupliquée dans
 * `shopify.server.ts`, ce qui garantissait la dérive au prochain changement.
 *
 * À réviser chaque trimestre : Shopify ne supporte que 4 versions glissantes.
 * La sortie durable est la migration vers l'API GraphQL Admin, REST étant en
 * legacy depuis le 1er octobre 2024.
 */
export const SHOPIFY_API_VERSION = "2026-01";

const API_VERSION = SHOPIFY_API_VERSION;

export type ShopifyProduct = {
  id: number;
  title: string;
  body_html: string | null;
  handle: string;
  price: string | null;
};

function client(shop: string, token: string) {
  const base = `https://${shop}/admin/api/${API_VERSION}`;
  const headers = {
    "X-Shopify-Access-Token": token,
    "Content-Type": "application/json",
  };
  return { base, headers };
}

export function getToken(encrypted: string): string {
  return decryptToken(encrypted);
}

/**
 * Permissions réellement accordées au jeton.
 *
 * C'est le premier appel effectué avec un jeton fraîchement obtenu : il vaut
 * donc contrôle de bon fonctionnement autant que relevé de permissions. Un
 * échec ici signifie que le jeton est inexploitable, ce qu'il vaut mieux
 * découvrir à la connexion qu'au premier audit.
 *
 * Pourquoi ce contrôle existe : la réponse d'échange du code renvoie un `scope`
 * vide pour les apps à installation gérée, où les permissions viennent de la
 * configuration de l'app et non de l'URL d'autorisation. La colonne `scope`
 * ne reflétait alors rien.
 *
 * L'endpoint n'est pas versionné : il vit sous `/admin/oauth/`, pas sous
 * `/admin/api/{version}/`.
 */
export async function fetchGrantedScopes(shop: string, token: string): Promise<string[]> {
  const res = await fetch(`https://${shop}/admin/oauth/access_scopes.json`, {
    headers: { "X-Shopify-Access-Token": token },
  });
  if (!res.ok) {
    throw new Error(`Shopify: lecture des permissions refusée (${res.status})`);
  }
  const json = (await res.json()) as { access_scopes?: Array<{ handle?: string }> };
  return (json.access_scopes ?? [])
    .map((entry) => entry.handle)
    .filter((handle): handle is string => Boolean(handle));
}

/** Liste les produits (limité) pour que l'IA choisisse quoi corriger. */
export async function listProducts(
  shop: string,
  token: string,
  limit = 20,
): Promise<ShopifyProduct[]> {
  const { base, headers } = client(shop, token);
  const res = await fetch(
    `${base}/products.json?limit=${limit}&fields=id,title,body_html,handle,variants`,
    { headers },
  );
  if (!res.ok) throw new Error(`Shopify: impossible de lister les produits (${res.status})`);
  const json = (await res.json()) as {
    products: Array<{
      id: number;
      title: string;
      body_html: string | null;
      handle: string;
      variants?: Array<{ price: string }>;
    }>;
  };
  return json.products.map((p) => ({
    id: p.id,
    title: p.title,
    body_html: p.body_html,
    handle: p.handle,
    price: p.variants?.[0]?.price ?? null,
  }));
}

export async function updateProduct(
  shop: string,
  token: string,
  productId: number,
  fields: { title?: string; body_html?: string },
): Promise<{ id: number; title: string; adminUrl: string }> {
  const { base, headers } = client(shop, token);
  const res = await fetch(`${base}/products/${productId}.json`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ product: { id: productId, ...fields } }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Shopify: modification du produit refusée (${res.status}) ${t}`);
  }
  const json = (await res.json()) as { product: { id: number; title: string } };
  return {
    id: json.product.id,
    title: json.product.title,
    adminUrl: `https://${shop}/admin/products/${json.product.id}`,
  };
}

export async function createDiscountCode(
  shop: string,
  token: string,
  input: { title: string; code: string; percentage: number; days: number },
): Promise<{ code: string; adminUrl: string; priceRuleId: number }> {
  const { base, headers } = client(shop, token);
  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + input.days * 86400000);

  const prRes = await fetch(`${base}/price_rules.json`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      price_rule: {
        title: input.title,
        target_type: "line_item",
        target_selection: "all",
        allocation_method: "across",
        value_type: "percentage",
        value: `-${Math.abs(input.percentage)}`,
        customer_selection: "all",
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
      },
    }),
  });
  if (!prRes.ok) {
    const t = await prRes.text();
    throw new Error(`Shopify: création de la promo refusée (${prRes.status}) ${t}`);
  }
  const pr = (await prRes.json()) as { price_rule: { id: number } };

  const dcRes = await fetch(`${base}/price_rules/${pr.price_rule.id}/discount_codes.json`, {
    method: "POST",
    headers,
    body: JSON.stringify({ discount_code: { code: input.code } }),
  });
  if (!dcRes.ok) {
    const t = await dcRes.text();
    throw new Error(`Shopify: création du code promo refusée (${dcRes.status}) ${t}`);
  }
  const dc = (await dcRes.json()) as { discount_code: { code: string } };
  return {
    code: dc.discount_code.code,
    adminUrl: `https://${shop}/admin/discounts`,
    // Nécessaire à l'annulation. Cet id a déjà servi à construire l'URL ci-dessus :
    // si la création du code a réussi, c'est qu'il est bien renseigné.
    priceRuleId: pr.price_rule.id,
  };
}

/**
 * Supprime une règle de prix et, avec elle, les codes promo qui en dépendent.
 * Annulation de `create_discount_code`.
 *
 * Un 404 signifie que la règle n'existe déjà plus : l'état visé est atteint, on
 * le traite comme un succès plutôt que comme une erreur.
 */
export async function deletePriceRule(
  shop: string,
  token: string,
  priceRuleId: number,
): Promise<{ alreadyGone: boolean }> {
  const { base, headers } = client(shop, token);
  const res = await fetch(`${base}/price_rules/${priceRuleId}.json`, { method: "DELETE", headers });
  if (res.status === 404) return { alreadyGone: true };
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Shopify: suppression de la promo refusée (${res.status}) ${t}`);
  }
  return { alreadyGone: false };
}
