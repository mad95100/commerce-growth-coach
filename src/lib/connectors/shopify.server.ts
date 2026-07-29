import { decryptToken } from "@/lib/crypto.server";

export type ShopifySnapshot = {
  shopName: string;
  domain: string;
  currency: string;
  productCount: number | null;
  ordersLast30d: number | null;
  revenueLast30d: number | null;
  avgOrderValue: number | null;
};

/**
 * Récupère un instantané léger de la boutique Shopify pour nourrir l'audit.
 * Retourne null en cas d'erreur (on continue l'audit sans les données).
 */
export async function fetchShopifySnapshot(
  shop: string,
  encryptedToken: string,
): Promise<ShopifySnapshot | null> {
  try {
    const token = decryptToken(encryptedToken);
    const base = `https://${shop}/admin/api/2024-10`;
    const headers = { "X-Shopify-Access-Token": token, "Content-Type": "application/json" };

    const shopRes = await fetch(`${base}/shop.json`, { headers });
    if (!shopRes.ok) return null;
    const shopJson = (await shopRes.json()) as {
      shop: { name: string; domain: string; currency: string };
    };

    const productsRes = await fetch(`${base}/products/count.json`, { headers });
    const productCount = productsRes.ok
      ? ((await productsRes.json()) as { count: number }).count
      : null;

    const since = new Date();
    since.setDate(since.getDate() - 30);
    const ordersUrl =
      `${base}/orders.json?status=any&limit=250&created_at_min=${since.toISOString()}` +
      `&fields=id,total_price,currency,financial_status`;
    const ordersRes = await fetch(ordersUrl, { headers });
    let ordersLast30d: number | null = null;
    let revenueLast30d: number | null = null;
    if (ordersRes.ok) {
      const { orders } = (await ordersRes.json()) as {
        orders: { total_price: string; financial_status: string | null }[];
      };
      const paid = orders.filter((o) => o.financial_status === "paid" || o.financial_status === "partially_paid");
      ordersLast30d = paid.length;
      revenueLast30d = paid.reduce((s, o) => s + parseFloat(o.total_price || "0"), 0);
    }

    const avgOrderValue =
      ordersLast30d && ordersLast30d > 0 && revenueLast30d != null
        ? revenueLast30d / ordersLast30d
        : null;

    return {
      shopName: shopJson.shop.name,
      domain: shopJson.shop.domain,
      currency: shopJson.shop.currency,
      productCount,
      ordersLast30d,
      revenueLast30d,
      avgOrderValue,
    };
  } catch {
    return null;
  }
}
