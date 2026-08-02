import { fetchShopifySnapshot } from "@/lib/connectors/shopify.server";
import { fetchMetaSnapshot, metaToken } from "@/lib/connectors/meta-apply.server";
import { fetchGoogleSnapshot, googleAccessToken } from "@/lib/connectors/google-apply.server";

/** Instantané normalisé des indicateurs business/pub d'une boutique (30 derniers jours). */
export type StoreMetrics = {
  captured_at: string;
  shopify: {
    revenue_30d: number | null;
    orders_30d: number | null;
    aov: number | null;
  } | null;
  meta: {
    spend: number | null;
    purchases: number | null;
    roas: number | null;
    ctr: number | null;
  } | null;
  google: {
    cost: number | null;
    clicks: number | null;
    conversions: number | null;
    ctr: number | null;
    conversion_rate: number | null;
  } | null;
};

export type ChannelCredentials = {
  shopify?: { shop: string; encryptedToken: string };
  meta?: { accountId: string; encryptedToken: string };
  google?: { customerId: string; encryptedRefreshToken: string };
};

function weightedAvg(rows: Array<{ value: number | null | undefined; weight: number }>): number | null {
  const usable = rows.filter((r) => r.value != null && Number.isFinite(r.value));
  if (usable.length === 0) return null;
  const totalWeight = usable.reduce((s, r) => s + (r.weight > 0 ? r.weight : 0), 0);
  if (totalWeight <= 0) {
    return usable.reduce((s, r) => s + (r.value as number), 0) / usable.length;
  }
  return usable.reduce((s, r) => s + (r.value as number) * (r.weight > 0 ? r.weight : 0), 0) / totalWeight;
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
            spend: spend || null,
            purchases: purchases || null,
            roas: weightedAvg(snap.adsets.map((a) => ({ value: a.roas ?? null, weight: a.spend ?? 0 }))),
            ctr: weightedAvg(snap.adsets.map((a) => ({ value: a.ctr ?? null, weight: a.spend ?? 0 }))),
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
            cost: cost || null,
            clicks: clicks || null,
            conversions: conversions || null,
            ctr: weightedAvg(snap.campaigns.map((c) => ({ value: c.ctr_30d, weight: c.cost_30d ?? 0 }))),
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

export type MetricDelta = {
  key: string;
  label: string;
  channel: "shopify" | "meta" | "google";
  format: "currency" | "number" | "percent" | "ratio";
  before: number | null;
  after: number | null;
  change_pct: number | null;
  /** true si une hausse est une bonne nouvelle */
  higher_is_better: boolean;
};

const METRIC_DEFS: Array<{
  key: string;
  label: string;
  channel: "shopify" | "meta" | "google";
  format: MetricDelta["format"];
  higher_is_better: boolean;
  pick: (m: StoreMetrics) => number | null;
}> = [
  { key: "revenue_30d", label: "CA 30 jours", channel: "shopify", format: "currency", higher_is_better: true, pick: (m) => m.shopify?.revenue_30d ?? null },
  { key: "orders_30d", label: "Commandes 30 jours", channel: "shopify", format: "number", higher_is_better: true, pick: (m) => m.shopify?.orders_30d ?? null },
  { key: "aov", label: "Panier moyen", channel: "shopify", format: "currency", higher_is_better: true, pick: (m) => m.shopify?.aov ?? null },
  { key: "meta_roas", label: "ROAS Meta", channel: "meta", format: "ratio", higher_is_better: true, pick: (m) => m.meta?.roas ?? null },
  { key: "meta_ctr", label: "CTR Meta", channel: "meta", format: "percent", higher_is_better: true, pick: (m) => m.meta?.ctr ?? null },
  { key: "meta_purchases", label: "Achats Meta", channel: "meta", format: "number", higher_is_better: true, pick: (m) => m.meta?.purchases ?? null },
  { key: "meta_spend", label: "Dépense Meta", channel: "meta", format: "currency", higher_is_better: false, pick: (m) => m.meta?.spend ?? null },
  { key: "google_conv_rate", label: "Taux de conversion Google", channel: "google", format: "percent", higher_is_better: true, pick: (m) => (m.google?.conversion_rate != null ? m.google.conversion_rate * 100 : null) },
  { key: "google_ctr", label: "CTR Google", channel: "google", format: "percent", higher_is_better: true, pick: (m) => (m.google?.ctr != null ? m.google.ctr * 100 : null) },
  { key: "google_conversions", label: "Conversions Google", channel: "google", format: "number", higher_is_better: true, pick: (m) => m.google?.conversions ?? null },
  { key: "google_cost", label: "Dépense Google", channel: "google", format: "currency", higher_is_better: false, pick: (m) => m.google?.cost ?? null },
];

/** Compare deux instantanés et renvoie les écarts métrique par métrique. */
export function computeDeltas(before: StoreMetrics, after: StoreMetrics): MetricDelta[] {
  return METRIC_DEFS.map((d) => {
    const b = d.pick(before);
    const a = d.pick(after);
    const change_pct = b != null && a != null && b !== 0 ? ((a - b) / Math.abs(b)) * 100 : null;
    return {
      key: d.key,
      label: d.label,
      channel: d.channel,
      format: d.format,
      before: b,
      after: a,
      change_pct,
      higher_is_better: d.higher_is_better,
    };
  }).filter((d) => d.before != null || d.after != null);
}

export type TrackingVerdict = {
  status: "measuring" | "on_track" | "underperforming" | "regressed";
  alert_message: string | null;
};

/**
 * Décide si les gains estimés se matérialisent.
 * On regarde en priorité le CA, sinon le ROAS / taux de conversion.
 */
export function judgeOutcome(
  deltas: MetricDelta[],
  appliedAt: string,
  expectedGainMin: number | null,
): TrackingVerdict {
  const daysSince = (Date.now() - new Date(appliedAt).getTime()) / 86_400_000;
  const drivers = deltas.filter(
    (d) => ["revenue_30d", "meta_roas", "google_conv_rate", "meta_ctr"].includes(d.key) && d.change_pct != null,
  );

  if (daysSince < 3 || drivers.length === 0) {
    return {
      status: "measuring",
      alert_message: null,
    };
  }

  const worst = drivers.reduce((w, d) => ((d.change_pct as number) < (w.change_pct as number) ? d : w));
  const revenue = drivers.find((d) => d.key === "revenue_30d");
  const main = revenue ?? drivers[0]!;
  const change = main.change_pct as number;

  if (change <= -5) {
    return {
      status: "regressed",
      alert_message: `${main.label} a baissé de ${Math.abs(change).toFixed(1)} % depuis la correction (${Math.round(daysSince)} j). Il faut revenir en arrière ou tester une autre approche — surveille aussi ${worst.label}.`,
    };
  }

  if (change < 3) {
    return {
      status: "underperforming",
      alert_message: expectedGainMin
        ? `On attendait environ +${expectedGainMin} € de gain, mais ${main.label} n'a bougé que de ${change.toFixed(1)} % en ${Math.round(daysSince)} jours. La correction ne suffit pas : relance un audit pour trouver le vrai blocage.`
        : `${main.label} n'a quasiment pas bougé (${change.toFixed(1)} %) en ${Math.round(daysSince)} jours. La correction ne suffit pas : relance un audit.`,
    };
  }

  return { status: "on_track", alert_message: null };
}
