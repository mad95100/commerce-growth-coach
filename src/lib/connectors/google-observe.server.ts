import { googleAccessToken } from "@/lib/connectors/google-apply.server";
import { normalizeCurrency } from "@/lib/currency";
import {
  GOOGLE_WINDOW_DAYS,
  googleObservations,
  googleUnreachable,
  type RawGoogleCampaign,
} from "@/lib/connectors/google-observe";
import type { SourceReport } from "@/lib/observations";

/**
 * Lecture Google Ads. La partie réseau, et rien d'autre.
 *
 * AUCUNE PERMISSION NOUVELLE : le périmètre `adwords` déjà accordé couvre tous
 * les champs demandés. Le jeton de développeur, lui, est une exigence de
 * l'API — sans lui aucune requête ne part, et c'est une absence de
 * CONFIGURATION, pas une absence de donnée. Elle est donc annoncée comme telle
 * plutôt que confondue avec un compte vide.
 *
 * TOUT LE CALCUL EST DANS LE FICHIER PUR VOISIN. Ici on interroge, on
 * transpose la réponse GAQL en lignes plates, et c'est tout.
 */

const BASE = "https://googleads.googleapis.com/v18";

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** Ligne GAQL : Google renvoie une structure profonde, en camelCase. */
type GaqlRow = {
  customer?: { currencyCode?: string };
  campaign?: {
    id?: string | number;
    name?: string;
    status?: string;
    advertisingChannelType?: string;
  };
  metrics?: {
    costMicros?: string | number;
    impressions?: string | number;
    clicks?: string | number;
    conversions?: string | number;
    conversionsValue?: string | number;
  };
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function toCampaign(row: GaqlRow): RawGoogleCampaign {
  return {
    id: row.campaign?.id != null ? String(row.campaign.id) : null,
    name: row.campaign?.name ?? null,
    status: row.campaign?.status ?? null,
    channel: row.campaign?.advertisingChannelType ?? null,
    cost_micros: toNumber(row.metrics?.costMicros),
    impressions: toNumber(row.metrics?.impressions),
    clicks: toNumber(row.metrics?.clicks),
    conversions: toNumber(row.metrics?.conversions),
    conversions_value: toNumber(row.metrics?.conversionsValue),
  };
}

/**
 * Champs demandés. `metrics.conversions_value` et `metrics.impressions`
 * n'étaient pas lus par le connecteur d'exécution : sans eux, ni ROAS ni CTR
 * ne sont calculables, et le diagnostic Google se réduisait à une dépense.
 */
const METRIC_FIELDS =
  "customer.currency_code, campaign.id, campaign.name, campaign.status, " +
  "campaign.advertising_channel_type, metrics.cost_micros, metrics.impressions, " +
  "metrics.clicks, metrics.conversions, metrics.conversions_value";

export async function fetchGoogleObservations(
  customerId: string,
  encryptedRefreshToken: string,
  fetcher: Fetcher = fetch,
): Promise<SourceReport> {
  // Le jeton de développeur est une exigence de l'API Google Ads. Son absence
  // est un défaut de configuration du service, pas une absence de données chez
  // le marchand : le distinguer évite de lui annoncer que son compte est vide.
  if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
    return googleUnreachable("GOOGLE_ADS_DEVELOPER_TOKEN non configuré côté serveur.");
  }

  let accessToken: string;
  try {
    accessToken = await googleAccessToken(encryptedRefreshToken);
  } catch {
    return googleUnreachable("Jeton Google illisible ou expiré.");
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    "Content-Type": "application/json",
  };
  const login = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  if (login) headers["login-customer-id"] = login.replace(/\D/g, "");

  const query = async (gaql: string): Promise<GaqlRow[] | null> => {
    try {
      const res = await fetcher(`${BASE}/customers/${customerId}/googleAds:search`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query: gaql, pageSize: 200 }),
      });
      if (!res.ok) return null;
      return ((await res.json()) as { results?: GaqlRow[] }).results ?? [];
    } catch {
      return null;
    }
  };

  const [current, previous] = await Promise.all([
    query(
      `SELECT ${METRIC_FIELDS} FROM campaign WHERE segments.date DURING LAST_30_DAYS ORDER BY metrics.cost_micros DESC`,
    ),
    // Fenêtre strictement antérieure : `LAST_30_DAYS` chevaucherait la
    // période courante et compterait des jours deux fois.
    query(
      `SELECT ${METRIC_FIELDS} FROM campaign WHERE segments.date BETWEEN '${isoDaysAgo(2 * GOOGLE_WINDOW_DAYS)}' AND '${isoDaysAgo(GOOGLE_WINDOW_DAYS + 1)}' ORDER BY metrics.cost_micros DESC`,
    ),
  ]);

  if (current === null) {
    return googleUnreachable("Le compte Google Ads n'a pas répondu.");
  }

  return googleObservations({
    currency: normalizeCurrency(current[0]?.customer?.currencyCode),
    campaigns: current.map(toCampaign),
    previous: previous && previous.length > 0 ? previous.map(toCampaign) : null,
  });
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}
