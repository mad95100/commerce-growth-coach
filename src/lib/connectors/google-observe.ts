/**
 * Google Ads → observations. La partie PURE, sans réseau.
 *
 * POURQUOI GOOGLE APPARTIENT AU CHEMIN DE VALIDATION. Un audit d'acquisition
 * incomplet ne se contente pas d'être incomplet : il attribue mal. Une boutique
 * dont Meta va mal et Google va bien recevrait, sans Google, le diagnostic
 * « ton acquisition ne fonctionne pas » — faux, et coûteux : le marchand
 * coupe ce qui marchait ou refait ce qui marche déjà. Le troisième canal ne
 * s'ajoute pas au diagnostic, il le corrige.
 *
 * AUCUNE PERMISSION NOUVELLE. Le périmètre `adwords` déjà accordé couvre la
 * totalité des champs lus ici.
 *
 * CE QUE GOOGLE DONNE, ET CE QU'IL NE DONNE PAS. Les métriques de campagne
 * fournissent la dépense, les impressions, les clics, les conversions et leur
 * valeur. Google compte SES conversions, avec SA fenêtre d'attribution et SON
 * modèle — ce ne sont pas les commandes de la boutique, et les confondre
 * produit un ROAS qui ne correspond à rien. C'est déclaré comme un angle mort,
 * pas contourné.
 *
 * LES MONTANTS SONT EN MICROS chez Google : un euro s'écrit 1 000 000. Une
 * conversion oubliée quelque part produit des chiffres faux d'un facteur un
 * million, et personne ne s'en aperçoit avant d'avoir pris une décision dessus.
 */

import type { Observation, ObservationGap, SourceReport } from "@/lib/observations";

export const GOOGLE_WINDOW_DAYS = 30;

/** Un million de micros pour une unité monétaire. */
export const MICROS = 1_000_000;

/** Ligne de campagne, réduite à ce qu'on lit réellement. */
export type RawGoogleCampaign = {
  id?: string | null;
  name?: string | null;
  status?: string | null;
  /** SEARCH, SHOPPING, PERFORMANCE_MAX… */
  channel?: string | null;
  cost_micros?: number | null;
  impressions?: number | null;
  clicks?: number | null;
  conversions?: number | null;
  conversions_value?: number | null;
};

export type GoogleRaw = {
  currency: string | null;
  campaigns: RawGoogleCampaign[];
  /** Période précédente, pour l'évolution. `null` si indisponible. */
  previous: RawGoogleCampaign[] | null;
};

function sum(
  rows: RawGoogleCampaign[],
  pick: (r: RawGoogleCampaign) => number | null,
): number | null {
  const values = rows.map(pick).filter((v): v is number => v !== null && Number.isFinite(v));
  return values.length === 0 ? null : values.reduce((s, v) => s + v, 0);
}

const n = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** Canaux Shopping, qui se pilotent autrement que la recherche classique. */
export const SHOPPING_CHANNELS = new Set(["SHOPPING", "PERFORMANCE_MAX"]);

/** En dessous, un ROAS Google repose sur trop peu de conversions. */
export const MIN_CONVERSIONS_FOR_ROAS = 10;

/** Dépense minimale pour qu'une campagne sans conversion soit un gaspillage. */
export const SPEND_WITHOUT_RESULT_FLOOR = 1;

export function googleObservations(raw: GoogleRaw): SourceReport {
  const observations: Observation[] = [];
  const gaps: ObservationGap[] = [];
  const currency = raw.currency;
  const rows = raw.campaigns;

  if (rows.length === 0) {
    gaps.push({
      id: "google.insights",
      label: "Performances des campagnes Google",
      source: "google",
      reason:
        "Aucune campagne avec des données sur la fenêtre : compte sans campagne active, ou dépense nulle.",
      wouldEnable:
        "Distinguer un problème propre à Google d'un problème d'acquisition général — sans quoi Meta porte seul le diagnostic.",
    });
    return { source: "google", observations, gaps, reachable: true };
  }

  const add = (o: Observation) => observations.push(o);
  const scope = `${rows.length} campagne(s) sur ${GOOGLE_WINDOW_DAYS} jours (Google Ads)`;

  const costMicros = sum(rows, (r) => n(r.cost_micros));
  const spend = costMicros === null ? null : costMicros / MICROS;
  const impressions = sum(rows, (r) => n(r.impressions));
  const clicks = sum(rows, (r) => n(r.clicks));
  const conversions = sum(rows, (r) => n(r.conversions));
  const conversionValue = sum(rows, (r) => n(r.conversions_value));

  if (spend !== null) {
    add({
      id: "google.spend_30d",
      source: "google",
      domain: "acquisition",
      label: "Dépense publicitaire Google",
      value: spend,
      unit: "currency",
      currency,
      periodDays: GOOGLE_WINDOW_DAYS,
      evidence: `Somme des coûts sur ${scope}`,
      sample: rows.length,
    });
  }
  if (impressions !== null) {
    add({
      id: "google.impressions_30d",
      source: "google",
      domain: "acquisition",
      label: "Impressions Google",
      value: impressions,
      unit: "count",
      periodDays: GOOGLE_WINDOW_DAYS,
      evidence: `Somme des impressions sur ${scope}`,
      sample: rows.length,
    });
  }
  if (clicks !== null) {
    add({
      id: "google.clicks_30d",
      source: "google",
      domain: "acquisition",
      label: "Clics Google",
      value: clicks,
      unit: "count",
      periodDays: GOOGLE_WINDOW_DAYS,
      evidence: `Somme des clics sur ${scope}`,
      sample: rows.length,
    });
  }

  // Taux recalculés sur les TOTAUX. Moyenner les taux de campagnes de tailles
  // différentes donne systématiquement trop de poids aux petites — une campagne
  // à douze impressions et un clic ferait croire à un CTR de 8 %.
  if (impressions !== null && impressions > 0 && clicks !== null) {
    add({
      id: "google.ctr_30d",
      source: "google",
      domain: "acquisition",
      label: "Taux de clic Google",
      value: (clicks / impressions) * 100,
      unit: "percent",
      periodDays: GOOGLE_WINDOW_DAYS,
      evidence: `${clicks} clics pour ${impressions} impressions, recalculé sur les totaux (Google Ads)`,
      sample: impressions,
    });
  }
  if (clicks !== null && clicks > 0 && spend !== null) {
    add({
      id: "google.cpc_30d",
      source: "google",
      domain: "acquisition",
      label: "Coût par clic Google",
      value: spend / clicks,
      unit: "currency",
      currency,
      periodDays: GOOGLE_WINDOW_DAYS,
      evidence: `Dépense divisée par ${clicks} clics (Google Ads)`,
      sample: clicks,
    });
  }

  if (conversions !== null) {
    add({
      id: "google.conversions_30d",
      source: "google",
      domain: "acquisition",
      label: "Conversions attribuées par Google",
      value: conversions,
      unit: "count",
      periodDays: GOOGLE_WINDOW_DAYS,
      evidence: `${Math.round(conversions)} conversions sur ${scope}. Attribution Google, avec sa propre fenêtre — ce ne sont pas les commandes de la boutique.`,
      sample: Math.round(conversions),
    });
  }
  if (conversionValue !== null) {
    add({
      id: "google.conversion_value_30d",
      source: "google",
      domain: "acquisition",
      label: "Valeur des conversions Google",
      value: conversionValue,
      unit: "currency",
      currency,
      periodDays: GOOGLE_WINDOW_DAYS,
      evidence: `Valeur attribuée par Google sur ${scope}, dans la devise du compte publicitaire`,
      sample: conversions === null ? rows.length : Math.round(conversions),
    });
  }

  // Le ROAS porte comme échantillon le nombre de CONVERSIONS, pas de
  // campagnes : c'est ce qui permet au moteur de refuser de conclure dessus.
  if (spend !== null && spend > 0 && conversionValue !== null) {
    add({
      id: "google.roas_30d",
      source: "google",
      domain: "acquisition",
      label: "ROAS Google",
      value: conversionValue / spend,
      unit: "ratio",
      periodDays: GOOGLE_WINDOW_DAYS,
      evidence: `Valeur attribuée divisée par la dépense, sur ${Math.round(conversions ?? 0)} conversions (Google Ads)`,
      sample: Math.round(conversions ?? 0),
    });
  }

  add({
    id: "google.campaign_count",
    source: "google",
    domain: "acquisition",
    label: "Campagnes Google mesurées",
    value: rows.length,
    unit: "count",
    periodDays: GOOGLE_WINDOW_DAYS,
    evidence: `${rows.length} campagnes avec des données sur la fenêtre (Google Ads)`,
    sample: rows.length,
  });

  // --- Shopping, quand il existe -------------------------------------------
  // Shopping et Performance Max se pilotent par le flux produit et non par les
  // mots-clés : les confondre conduit à recommander une action inapplicable.
  const shopping = rows.filter((r) => SHOPPING_CHANNELS.has((r.channel ?? "").toUpperCase()));
  if (shopping.length > 0) {
    const shoppingCost = sum(shopping, (r) => n(r.cost_micros));
    add({
      id: "google.shopping_campaigns",
      source: "google",
      domain: "acquisition",
      label: "Campagnes Shopping ou Performance Max",
      value: shopping.length,
      unit: "count",
      periodDays: GOOGLE_WINDOW_DAYS,
      evidence: `${shopping.length} campagnes pilotées par le flux produit (Google Ads)`,
      sample: rows.length,
    });
    if (shoppingCost !== null && costMicros !== null && costMicros > 0) {
      add({
        id: "google.shopping_spend_share",
        source: "google",
        domain: "acquisition",
        label: "Part du budget Google sur le flux produit",
        value: (shoppingCost / costMicros) * 100,
        unit: "percent",
        periodDays: GOOGLE_WINDOW_DAYS,
        evidence: `${Math.round((shoppingCost / costMicros) * 100)} % de la dépense Google passe par Shopping ou Performance Max (Google Ads)`,
        sample: rows.length,
      });
    }
  } else {
    gaps.push({
      id: "google.shopping_campaigns",
      label: "Campagnes Shopping",
      source: "google",
      reason: "Aucune campagne Shopping ni Performance Max sur la fenêtre.",
      wouldEnable:
        "Relier la performance publicitaire à la qualité du flux produit — titres, images, prix, disponibilité.",
    });
  }

  // --- Campagnes qui dépensent sans convertir ------------------------------
  const wasteful = rows.filter((r) => {
    const cost = n(r.cost_micros);
    return (
      cost !== null && cost / MICROS >= SPEND_WITHOUT_RESULT_FLOOR && (n(r.conversions) ?? 0) === 0
    );
  });
  const wastedMicros = sum(wasteful, (r) => n(r.cost_micros)) ?? 0;
  add({
    id: "google.campaigns_without_result",
    source: "google",
    domain: "acquisition",
    label: "Campagnes Google qui dépensent sans convertir",
    value: wasteful.length,
    unit: "count",
    periodDays: GOOGLE_WINDOW_DAYS,
    evidence:
      wasteful.length > 0
        ? `${wasteful.length} campagnes ont dépensé sans une seule conversion : ${wasteful
            .map((r) => r.name ?? "sans nom")
            .slice(0, 5)
            .join(", ")} (Google Ads)`
        : `Aucune campagne Google ne dépense sans convertir sur ${scope}`,
    sample: rows.length,
  });
  if (wasteful.length > 0) {
    add({
      id: "google.wasted_spend_30d",
      source: "google",
      domain: "acquisition",
      label: "Dépense Google sans conversion",
      value: wastedMicros / MICROS,
      unit: "currency",
      currency,
      periodDays: GOOGLE_WINDOW_DAYS,
      evidence: `Somme dépensée par les ${wasteful.length} campagnes sans conversion (Google Ads)`,
      sample: wasteful.length,
    });
  }

  // --- Évolution ------------------------------------------------------------
  if (raw.previous && raw.previous.length > 0) {
    const previousCost = sum(raw.previous, (r) => n(r.cost_micros));
    const previousConversions = sum(raw.previous, (r) => n(r.conversions));
    if (previousCost !== null && previousCost > 0 && costMicros !== null) {
      add({
        id: "google.spend_change_pct",
        source: "google",
        domain: "acquisition",
        label: "Évolution de la dépense Google",
        value: ((costMicros - previousCost) / previousCost) * 100,
        unit: "percent",
        periodDays: GOOGLE_WINDOW_DAYS,
        evidence: `Dépense comparée aux ${GOOGLE_WINDOW_DAYS} jours précédents (Google Ads)`,
        sample: raw.previous.length,
      });
    }
    if (previousConversions !== null && previousConversions > 0 && conversions !== null) {
      add({
        id: "google.conversions_change_pct",
        source: "google",
        domain: "acquisition",
        label: "Évolution des conversions Google",
        value: ((conversions - previousConversions) / previousConversions) * 100,
        unit: "percent",
        periodDays: GOOGLE_WINDOW_DAYS,
        evidence: `Conversions comparées aux ${GOOGLE_WINDOW_DAYS} jours précédents (Google Ads)`,
        sample: raw.previous.length,
      });
    }
  } else {
    gaps.push({
      id: "google.previous_period",
      label: "Période précédente Google",
      source: "google",
      reason: "Pas d'historique comparable sur la période antérieure.",
      wouldEnable: "Distinguer une contre-performance durable d'un creux passager.",
    });
  }

  // --- L'angle mort de Google ----------------------------------------------
  gaps.push({
    id: "google.post_click_behaviour",
    label: "Ce qui se passe après le clic",
    source: "google",
    reason:
      "Google compte SES conversions, avec SA fenêtre et SON modèle d'attribution. Ce ne sont pas les commandes de la boutique.",
    wouldEnable:
      "Savoir si le trafic Google achète réellement — cela demande de croiser avec Shopify.",
  });

  return { source: "google", observations, gaps, reachable: true };
}

export function googleUnreachable(error?: string): SourceReport {
  return { source: "google", observations: [], gaps: [], reachable: false, error: error ?? null };
}
