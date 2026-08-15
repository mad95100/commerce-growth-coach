/**
 * Indicateurs d'une boutique, et écarts entre deux mesures.
 *
 * NOYAU PUR, séparé de `metrics.server.ts` qui, lui, va chercher les chiffres
 * chez Shopify, Meta et Google. Ce fichier ne contient que la forme des données
 * et l'arithmétique des écarts — de quoi être importé par l'interface et par le
 * moteur de mesure sans traîner les connecteurs, leurs jetons et `node:crypto`
 * dans le bundle du navigateur.
 *
 * `metrics.server.ts` réexporte tout ce qui est ici : les appelants existants
 * n'ont rien à changer.
 */

import { normalizeCurrency } from "@/lib/currency";

/** Instantané normalisé des indicateurs business/pub d'une boutique (30 derniers jours). */
export type StoreMetrics = {
  captured_at: string;
  shopify: {
    /** Code ISO 4217 de la boutique, ou `null` si indéterminée. */
    currency: string | null;
    revenue_30d: number | null;
    orders_30d: number | null;
    aov: number | null;
  } | null;
  meta: {
    /** Devise du compte publicitaire Meta. Rien ne garantit qu'elle égale celle de la boutique. */
    currency: string | null;
    spend: number | null;
    purchases: number | null;
    roas: number | null;
    ctr: number | null;
  } | null;
  google: {
    /** Devise du compte Google Ads. Rien ne garantit qu'elle égale celle de la boutique. */
    currency: string | null;
    cost: number | null;
    clicks: number | null;
    conversions: number | null;
    ctr: number | null;
    conversion_rate: number | null;
  } | null;
};

export type MetricDelta = {
  key: string;
  label: string;
  channel: "shopify" | "meta" | "google";
  format: "currency" | "number" | "percent" | "ratio";
  /**
   * Devise du montant, pour les métriques `currency` uniquement — celle du
   * canal, pas celle de la boutique : Meta et Google facturent dans la devise
   * de leur propre compte.
   */
  currency: string | null;
  before: number | null;
  after: number | null;
  change_pct: number | null;
  /** true si une hausse est une bonne nouvelle */
  higher_is_better: boolean;
};

/**
 * FENÊTRE DE TOUTES LES MÉTRIQUES, en jours.
 *
 * Chaque indicateur est un cumul glissant sur 30 jours. Ce n'est pas un détail
 * d'implémentation : c'est ce qui rend une comparaison « avant / après » naïve
 * trompeuse. Trois jours après une correction, 27 des 30 jours mesurés sont
 * encore antérieurs à celle-ci — l'effet réel y est dilué d'un facteur dix.
 * `measure.ts` en tient compte ; rien d'autre ne doit lire cette constante sans
 * savoir pourquoi elle existe.
 */
export const METRIC_WINDOW_DAYS = 30;

export const METRIC_DEFS: Array<{
  key: string;
  label: string;
  channel: "shopify" | "meta" | "google";
  format: MetricDelta["format"];
  higher_is_better: boolean;
  pick: (m: StoreMetrics) => number | null;
}> = [
  {
    key: "revenue_30d",
    label: "CA 30 jours",
    channel: "shopify",
    format: "currency",
    higher_is_better: true,
    pick: (m) => m.shopify?.revenue_30d ?? null,
  },
  {
    key: "orders_30d",
    label: "Commandes 30 jours",
    channel: "shopify",
    format: "number",
    higher_is_better: true,
    pick: (m) => m.shopify?.orders_30d ?? null,
  },
  {
    key: "aov",
    label: "Panier moyen",
    channel: "shopify",
    format: "currency",
    higher_is_better: true,
    pick: (m) => m.shopify?.aov ?? null,
  },
  {
    key: "meta_roas",
    label: "ROAS Meta",
    channel: "meta",
    format: "ratio",
    higher_is_better: true,
    pick: (m) => m.meta?.roas ?? null,
  },
  {
    key: "meta_ctr",
    label: "CTR Meta",
    channel: "meta",
    format: "percent",
    higher_is_better: true,
    pick: (m) => m.meta?.ctr ?? null,
  },
  {
    key: "meta_purchases",
    label: "Achats Meta",
    channel: "meta",
    format: "number",
    higher_is_better: true,
    pick: (m) => m.meta?.purchases ?? null,
  },
  {
    key: "meta_spend",
    label: "Dépense Meta",
    channel: "meta",
    format: "currency",
    higher_is_better: false,
    pick: (m) => m.meta?.spend ?? null,
  },
  {
    key: "google_conv_rate",
    label: "Taux de conversion Google",
    channel: "google",
    format: "percent",
    higher_is_better: true,
    pick: (m) => (m.google?.conversion_rate != null ? m.google.conversion_rate * 100 : null),
  },
  {
    key: "google_ctr",
    label: "CTR Google",
    channel: "google",
    format: "percent",
    higher_is_better: true,
    pick: (m) => (m.google?.ctr != null ? m.google.ctr * 100 : null),
  },
  {
    key: "google_conversions",
    label: "Conversions Google",
    channel: "google",
    format: "number",
    higher_is_better: true,
    pick: (m) => m.google?.conversions ?? null,
  },
  {
    key: "google_cost",
    label: "Dépense Google",
    channel: "google",
    format: "currency",
    higher_is_better: false,
    pick: (m) => m.google?.cost ?? null,
  },
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
      // La devise est lue sur l'instantané le plus récent : c'est celle dans
      // laquelle `after` est libellé.
      currency:
        d.format === "currency"
          ? (normalizeCurrency(after[d.channel]?.currency) ??
            normalizeCurrency(before[d.channel]?.currency))
          : null,
      before: b,
      after: a,
      change_pct,
      higher_is_better: d.higher_is_better,
    };
  }).filter((d) => d.before != null || d.after != null);
}
