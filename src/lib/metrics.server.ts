import { fetchShopifySnapshot } from "@/lib/connectors/shopify.server";
import { normalizeCurrency } from "@/lib/currency";
import { fetchMetaSnapshot, metaToken } from "@/lib/connectors/meta-apply.server";
import { fetchGoogleSnapshot, googleAccessToken } from "@/lib/connectors/google-apply.server";
import type { StoreMetrics } from "@/lib/metrics";

/**
 * Capture des indicateurs chez les partenaires.
 *
 * La forme des données et l'arithmétique des écarts vivent dans `metrics.ts`,
 * qui est pur : l'interface et le moteur de mesure l'importent sans embarquer
 * les connecteurs ni `node:crypto` dans le bundle du navigateur. Tout y est
 * réexporté ci-dessous — les appelants existants n'ont rien à changer.
 */
export {
  computeDeltas,
  METRIC_DEFS,
  METRIC_WINDOW_DAYS,
  type MetricDelta,
  type StoreMetrics,
} from "@/lib/metrics";

export type ChannelCredentials = {
  shopify?: { shop: string; encryptedToken: string };
  meta?: { accountId: string; encryptedToken: string };
  google?: { customerId: string; encryptedRefreshToken: string };
};

function weightedAvg(
  rows: Array<{ value: number | null | undefined; weight: number }>,
): number | null {
  const usable = rows.filter((r) => r.value != null && Number.isFinite(r.value));
  if (usable.length === 0) return null;
  const totalWeight = usable.reduce((s, r) => s + (r.weight > 0 ? r.weight : 0), 0);
  if (totalWeight <= 0) {
    return usable.reduce((s, r) => s + (r.value as number), 0) / usable.length;
  }
  return (
    usable.reduce((s, r) => s + (r.value as number) * (r.weight > 0 ? r.weight : 0), 0) /
    totalWeight
  );
}

/** Mesure les indicateurs de chaque canal connecté. Les canaux en erreur sont ignorés. */
export async function captureStoreMetrics(creds: ChannelCredentials): Promise<StoreMetrics> {
  const metrics: StoreMetrics = {
    captured_at: new Date().toISOString(),
    shopify: null,
    meta: null,
    google: null,
  };

  const jobs: Promise<void>[] = [];

  if (creds.shopify) {
    const { shop, encryptedToken } = creds.shopify;
    jobs.push(
      (async () => {
        const snap = await fetchShopifySnapshot(shop, encryptedToken).catch(() => null);
        if (!snap) return;
        metrics.shopify = {
          currency: normalizeCurrency(snap.currency),
          revenue_30d: snap.revenueLast30d,
          orders_30d: snap.ordersLast30d,
          aov: snap.avgOrderValue,
        };
      })(),
    );
  }

  if (creds.meta) {
    const { accountId, encryptedToken } = creds.meta;
    jobs.push(
      (async () => {
        try {
          const snap = await fetchMetaSnapshot(accountId, metaToken(encryptedToken));
          const spend = snap.adsets.reduce((s, a) => s + (a.spend ?? 0), 0);
          const purchases = snap.adsets.reduce((s, a) => s + (a.purchases ?? 0), 0);
          metrics.meta = {
            currency: snap.currency,
            spend: spend || null,
            purchases: purchases || null,
            roas: weightedAvg(
              snap.adsets.map((a) => ({ value: a.roas ?? null, weight: a.spend ?? 0 })),
            ),
            ctr: weightedAvg(
              snap.adsets.map((a) => ({ value: a.ctr ?? null, weight: a.spend ?? 0 })),
            ),
          };
        } catch {
          /* canal ignoré */
        }
      })(),
    );
  }

  if (creds.google) {
    const { customerId, encryptedRefreshToken } = creds.google;
    jobs.push(
      (async () => {
        try {
          const token = await googleAccessToken(encryptedRefreshToken);
          const snap = await fetchGoogleSnapshot(customerId, token);
          const cost = snap.campaigns.reduce((s, c) => s + (c.cost_30d ?? 0), 0);
          const clicks = snap.campaigns.reduce((s, c) => s + (c.clicks_30d ?? 0), 0);
          const conversions = snap.campaigns.reduce((s, c) => s + (c.conversions_30d ?? 0), 0);
          metrics.google = {
            currency: snap.currency,
            cost: cost || null,
            clicks: clicks || null,
            conversions: conversions || null,
            ctr: weightedAvg(
              snap.campaigns.map((c) => ({ value: c.ctr_30d, weight: c.cost_30d ?? 0 })),
            ),
            conversion_rate: clicks > 0 ? conversions / clicks : null,
          };
        } catch {
          /* canal ignoré */
        }
      })(),
    );
  }

  await Promise.all(jobs);
  return metrics;
}
