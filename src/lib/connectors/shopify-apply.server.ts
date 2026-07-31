import { decryptToken } from "@/lib/crypto.server";

const API_VERSION = "2024-10";

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
): Promise<{ code: string; adminUrl: string }> {
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
  };
}
