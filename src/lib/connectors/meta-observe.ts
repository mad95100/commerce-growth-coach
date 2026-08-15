/**
 * Meta Ads → observations. La partie PURE, sans réseau.
 *
 * AUCUNE PERMISSION NOUVELLE. Tout ce qui est lu tient dans `ads_read`, déjà
 * accordée. En demander une de plus imposerait une réautorisation à chaque
 * marchand connecté, pour des chiffres que l'API donne déjà.
 *
 * CE QUE META DONNE, ET CE QU'IL NE DONNE PAS. Les insights fournissent la
 * dépense, les impressions, la portée, les clics, le CTR, le CPC, le CPM, les
 * conversions attribuées et leur valeur. Ils NE disent RIEN de ce qui se passe
 * après le clic : Meta voit un achat qu'il s'attribue, pas le chiffre
 * d'affaires réel de la boutique. Confondre les deux est l'erreur la plus
 * fréquente de l'analyse publicitaire, et la plus coûteuse — c'est elle qui
 * fait couper une campagne rentable ou nourrir une campagne qui ne vend rien.
 *
 * DEUX PIÈGES ENCODÉS ICI :
 *
 * 1. **Un ROAS sans volume ne veut rien dire.** Trois achats à fort ROAS ne
 *    prouvent pas qu'une campagne fonctionne, ils prouvent qu'elle a eu trois
 *    achats. L'échantillon voyage donc avec chaque observation, et le moteur
 *    sait refuser de conclure dessus.
 *
 * 2. **Une dépense sans conversion est un FAIT, pas une opinion.** C'est l'une
 *    des rares choses que Meta établit seul, sans ambiguïté — et elle mérite
 *    d'être dite comme telle.
 */

import type { Observation, ObservationGap, SourceReport } from "@/lib/observations";

export const META_WINDOW_DAYS = 30;

/** Ligne d'insights, réduite à ce qu'on lit réellement. */
export type RawMetaInsight = {
  campaign_id?: string | null;
  campaign_name?: string | null;
  adset_id?: string | null;
  adset_name?: string | null;
  spend?: string | number | null;
  impressions?: string | number | null;
  reach?: string | number | null;
  clicks?: string | number | null;
  ctr?: string | number | null;
  cpc?: string | number | null;
  cpm?: string | number | null;
  actions?: Array<{ action_type?: string; value?: string | number }> | null;
  action_values?: Array<{ action_type?: string; value?: string | number }> | null;
  purchase_roas?: Array<{ value?: string | number }> | null;
};

export type MetaRaw = {
  currency: string | null;
  /** Insights au niveau campagne, sur la fenêtre. */
  campaigns: RawMetaInsight[];
  /** Insights au niveau ensemble de publicités. */
  adsets: RawMetaInsight[];
  /** Nombre de publicités actives. `null` si non lisible. */
  activeAds: number | null;
  /** Insights de la période PRÉCÉDENTE, pour l'évolution. `null` si absents. */
  previous: RawMetaInsight[] | null;
};

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sum(rows: RawMetaInsight[], pick: (r: RawMetaInsight) => number | null): number | null {
  const values = rows.map(pick).filter((v): v is number => v !== null);
  return values.length === 0 ? null : values.reduce((s, v) => s + v, 0);
}

/** Achats attribués par Meta sur une ligne d'insights. */
export function purchasesOf(row: RawMetaInsight): number | null {
  const action = (row.actions ?? []).find((a) => a?.action_type === "purchase");
  return action ? num(action.value) : null;
}

/** Valeur des achats attribués. Dans la devise du COMPTE, pas de la boutique. */
export function purchaseValueOf(row: RawMetaInsight): number | null {
  const value = (row.action_values ?? []).find((a) => a?.action_type === "purchase");
  return value ? num(value.value) : null;
}

/**
 * Campagnes qui dépensent sans rien produire.
 *
 * Le seul jugement que Meta autorise SEUL, et il est net : de l'argent sorti,
 * aucun achat attribué. Ni interprétation ni hypothèse — un fait.
 */
export const SPEND_WITHOUT_RESULT_FLOOR = 1;

/** En dessous, un ROAS n'est pas une performance : c'est une coïncidence. */
export const MIN_PURCHASES_FOR_ROAS = 10;

export function metaObservations(raw: MetaRaw): SourceReport {
  const observations: Observation[] = [];
  const gaps: ObservationGap[] = [];
  const currency = raw.currency;
  const rows = raw.campaigns.length > 0 ? raw.campaigns : raw.adsets;

  if (rows.length === 0) {
    gaps.push({
      id: "meta.insights",
      label: "Performances des campagnes",
      source: "meta",
      reason:
        "Aucune ligne de performance sur la fenêtre : compte sans campagne active, ou données pas encore consolidées.",
      wouldEnable: "Tout le diagnostic d'acquisition payante.",
    });
    return { source: "meta", observations, gaps, reachable: true };
  }

  const add = (o: Observation) => observations.push(o);
  const scope = `${rows.length} campagne(s) sur ${META_WINDOW_DAYS} jours (Meta /insights)`;

  const spend = sum(rows, (r) => num(r.spend));
  const impressions = sum(rows, (r) => num(r.impressions));
  const reach = sum(rows, (r) => num(r.reach));
  const clicks = sum(rows, (r) => num(r.clicks));
  const purchases = sum(rows, purchasesOf);
  const purchaseValue = sum(rows, purchaseValueOf);

  if (spend !== null) {
    add({
      id: "meta.spend_30d",
      source: "meta",
      domain: "acquisition",
      label: "Dépense publicitaire Meta",
      value: spend,
      unit: "currency",
      currency,
      periodDays: META_WINDOW_DAYS,
      evidence: `Somme des dépenses sur ${scope}`,
      sample: rows.length,
    });
  }
  if (impressions !== null) {
    add({
      id: "meta.impressions_30d",
      source: "meta",
      domain: "acquisition",
      label: "Impressions Meta",
      value: impressions,
      unit: "count",
      periodDays: META_WINDOW_DAYS,
      evidence: `Somme des impressions sur ${scope}`,
      sample: rows.length,
    });
  }
  if (reach !== null) {
    add({
      id: "meta.reach_30d",
      source: "meta",
      domain: "acquisition",
      label: "Personnes touchées",
      value: reach,
      unit: "count",
      periodDays: META_WINDOW_DAYS,
      evidence: `Portée cumulée sur ${scope}`,
      sample: rows.length,
    });
  }
  if (clicks !== null) {
    add({
      id: "meta.clicks_30d",
      source: "meta",
      domain: "acquisition",
      label: "Clics Meta",
      value: clicks,
      unit: "count",
      periodDays: META_WINDOW_DAYS,
      evidence: `Somme des clics sur ${scope}`,
      sample: rows.length,
    });
  }

  // CTR, CPC et CPM sont RECALCULÉS depuis les totaux plutôt que moyennés :
  // la moyenne de taux de campagnes de tailles différentes n'a aucun sens, et
  // donne systématiquement trop de poids aux petites campagnes.
  if (impressions !== null && impressions > 0 && clicks !== null) {
    add({
      id: "meta.ctr_30d",
      source: "meta",
      domain: "acquisition",
      label: "Taux de clic (CTR)",
      value: (clicks / impressions) * 100,
      unit: "percent",
      periodDays: META_WINDOW_DAYS,
      evidence: `${clicks} clics pour ${impressions} impressions, recalculé sur les totaux (Meta /insights)`,
      sample: impressions,
    });
  }
  if (clicks !== null && clicks > 0 && spend !== null) {
    add({
      id: "meta.cpc_30d",
      source: "meta",
      domain: "acquisition",
      label: "Coût par clic",
      value: spend / clicks,
      unit: "currency",
      currency,
      periodDays: META_WINDOW_DAYS,
      evidence: `Dépense divisée par ${clicks} clics (Meta /insights)`,
      sample: clicks,
    });
  }
  if (impressions !== null && impressions > 0 && spend !== null) {
    add({
      id: "meta.cpm_30d",
      source: "meta",
      domain: "acquisition",
      label: "Coût pour mille impressions",
      value: (spend / impressions) * 1000,
      unit: "currency",
      currency,
      periodDays: META_WINDOW_DAYS,
      evidence: `Dépense rapportée à ${impressions} impressions (Meta /insights)`,
      sample: impressions,
    });
  }

  if (purchases !== null) {
    add({
      id: "meta.purchases_30d",
      source: "meta",
      domain: "acquisition",
      label: "Achats attribués par Meta",
      value: purchases,
      unit: "count",
      periodDays: META_WINDOW_DAYS,
      evidence: `${purchases} achats attribués sur ${scope}. Attribution Meta, pas les commandes réelles de la boutique.`,
      sample: purchases,
    });
  }
  if (purchaseValue !== null) {
    add({
      id: "meta.purchase_value_30d",
      source: "meta",
      domain: "acquisition",
      label: "Valeur des achats attribués",
      value: purchaseValue,
      unit: "currency",
      currency,
      periodDays: META_WINDOW_DAYS,
      evidence: `Valeur attribuée par Meta sur ${scope}, dans la devise du compte publicitaire`,
      sample: purchases ?? rows.length,
    });
  }

  // Le ROAS est recalculé lui aussi, et porte comme échantillon le NOMBRE
  // D'ACHATS — pas le nombre de campagnes. C'est ce qui permet au moteur de
  // refuser de conclure sur un ROAS bâti sur trois achats.
  if (spend !== null && spend > 0 && purchaseValue !== null) {
    add({
      id: "meta.roas_30d",
      source: "meta",
      domain: "acquisition",
      label: "ROAS Meta",
      value: purchaseValue / spend,
      unit: "ratio",
      periodDays: META_WINDOW_DAYS,
      evidence: `Valeur attribuée divisée par la dépense, sur ${purchases ?? 0} achats (Meta /insights)`,
      sample: purchases ?? 0,
    });
  }

  add({
    id: "meta.campaign_count",
    source: "meta",
    domain: "acquisition",
    label: "Campagnes mesurées",
    value: rows.length,
    unit: "count",
    periodDays: META_WINDOW_DAYS,
    evidence: `${rows.length} campagnes avec des données sur la fenêtre (Meta /insights)`,
    sample: rows.length,
  });

  if (raw.activeAds !== null) {
    add({
      id: "meta.active_ads",
      source: "meta",
      domain: "acquisition",
      label: "Publicités actives",
      value: raw.activeAds,
      unit: "count",
      periodDays: 0,
      evidence: `${raw.activeAds} publicités au statut actif (Meta /ads)`,
      sample: raw.activeAds,
    });
  }

  // --- Campagnes qui dépensent sans résultat -------------------------------
  // Le seul jugement que Meta autorise seul, et il est net.
  const wasteful = rows.filter((r) => {
    const s = num(r.spend);
    const p = purchasesOf(r);
    return s !== null && s >= SPEND_WITHOUT_RESULT_FLOOR && (p ?? 0) === 0;
  });
  const wastedSpend = sum(wasteful, (r) => num(r.spend)) ?? 0;
  add({
    id: "meta.campaigns_without_result",
    source: "meta",
    domain: "acquisition",
    label: "Campagnes qui dépensent sans aucun achat",
    value: wasteful.length,
    unit: "count",
    periodDays: META_WINDOW_DAYS,
    evidence:
      wasteful.length > 0
        ? `${wasteful.length} campagnes ont dépensé sans un seul achat attribué : ${wasteful
            .map((r) => r.campaign_name ?? r.adset_name ?? "sans nom")
            .slice(0, 5)
            .join(", ")} (Meta /insights)`
        : `Aucune campagne ne dépense sans résultat sur ${scope}`,
    sample: rows.length,
  });
  if (wasteful.length > 0) {
    add({
      id: "meta.wasted_spend_30d",
      source: "meta",
      domain: "acquisition",
      label: "Dépense sans aucun achat attribué",
      value: wastedSpend,
      unit: "currency",
      currency,
      periodDays: META_WINDOW_DAYS,
      evidence: `Somme dépensée par les ${wasteful.length} campagnes sans achat (Meta /insights)`,
      sample: wasteful.length,
    });
  }

  // --- Évolution par période ------------------------------------------------
  if (raw.previous && raw.previous.length > 0) {
    const previousSpend = sum(raw.previous, (r) => num(r.spend));
    const previousPurchases = sum(raw.previous, purchasesOf);
    if (previousSpend !== null && previousSpend > 0 && spend !== null) {
      add({
        id: "meta.spend_change_pct",
        source: "meta",
        domain: "acquisition",
        label: "Évolution de la dépense",
        value: ((spend - previousSpend) / previousSpend) * 100,
        unit: "percent",
        periodDays: META_WINDOW_DAYS,
        evidence: `Dépense comparée aux ${META_WINDOW_DAYS} jours précédents (Meta /insights)`,
        sample: raw.previous.length,
      });
    }
    if (previousPurchases !== null && previousPurchases > 0 && purchases !== null) {
      add({
        id: "meta.purchases_change_pct",
        source: "meta",
        domain: "acquisition",
        label: "Évolution des achats attribués",
        value: ((purchases - previousPurchases) / previousPurchases) * 100,
        unit: "percent",
        periodDays: META_WINDOW_DAYS,
        evidence: `Achats comparés aux ${META_WINDOW_DAYS} jours précédents (Meta /insights)`,
        sample: raw.previous.length,
      });
    }
  } else {
    gaps.push({
      id: "meta.previous_period",
      label: "Période précédente",
      source: "meta",
      reason: "Pas d'historique comparable : compte récent, ou période antérieure sans dépense.",
      wouldEnable: "Distinguer une contre-performance durable d'un simple creux.",
    });
  }

  // --- CE QUE META NE SAIT PAS ---------------------------------------------
  gaps.push({
    id: "meta.post_click_behaviour",
    label: "Ce qui se passe après le clic",
    source: "meta",
    reason:
      "Meta voit les achats qu'il s'attribue, pas le chiffre d'affaires réel de la boutique ni le parcours du visiteur.",
    wouldEnable:
      "Savoir si une campagne performante amène du trafic qui achète VRAIMENT — cela demande de croiser avec Shopify.",
  });

  return { source: "meta", observations, gaps, reachable: true };
}

export function metaUnreachable(error?: string): SourceReport {
  return { source: "meta", observations: [], gaps: [], reachable: false, error: error ?? null };
}
