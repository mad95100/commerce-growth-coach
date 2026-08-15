import { metaToken } from "@/lib/connectors/meta-apply.server";
import { normalizeCurrency } from "@/lib/currency";
import {
  META_WINDOW_DAYS,
  metaObservations,
  metaUnreachable,
  type RawMetaInsight,
} from "@/lib/connectors/meta-observe";
import type { SourceReport } from "@/lib/observations";

/**
 * Lecture Meta Ads. La partie réseau, et rien d'autre.
 *
 * AUCUNE PERMISSION NOUVELLE : tout tient dans `ads_read`, déjà accordée lors
 * de la connexion. Les champs demandés ici — impressions, portée, clics, CTR,
 * CPC, CPM, actions et leurs valeurs — sont ceux de l'endpoint insights
 * standard, que le connecteur d'exécution interroge déjà partiellement.
 *
 * CHAQUE RESSOURCE EST INDÉPENDANTE. Un compte dont l'historique de la période
 * précédente est refusé doit quand même produire ses performances courantes :
 * une donnée manquante retire une ligne, elle ne fait pas disparaître le
 * diagnostic d'acquisition.
 */

const V = "v21.0";
const GRAPH = `https://graph.facebook.com/${V}`;

type Fetcher = (url: string) => Promise<Response>;

async function graph<T>(
  path: string,
  token: string,
  params: Record<string, string>,
  fetcher: Fetcher,
): Promise<T | null> {
  try {
    const qs = new URLSearchParams({ ...params, access_token: token }).toString();
    const res = await fetcher(`${GRAPH}${path}?${qs}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Champs d'insights. Recalculés en aval : on demande les totaux, pas les taux. */
const INSIGHT_FIELDS =
  "campaign_id,campaign_name,adset_id,adset_name,spend,impressions,reach,clicks,ctr,cpc,cpm,actions,action_values,purchase_roas";

export async function fetchMetaObservations(
  accountId: string,
  encryptedToken: string,
  fetcher: Fetcher = fetch,
): Promise<SourceReport> {
  let token: string;
  try {
    token = metaToken(encryptedToken);
  } catch {
    // Jeton illisible : connexion à refaire. Rien à diagnostiquer, rien à
    // inventer — le moteur annoncera le canal comme injoignable.
    return metaUnreachable("Jeton Meta illisible.");
  }

  const now = Date.now();
  const day = 86_400_000;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  // Fenêtre précédente, strictement antérieure : sans quoi la comparaison
  // porterait sur des jours comptés deux fois.
  const previousRange = JSON.stringify({
    since: iso(now - 2 * META_WINDOW_DAYS * day),
    until: iso(now - META_WINDOW_DAYS * day - day),
  });

  const [account, campaigns, adsets, ads, previous] = await Promise.all([
    graph<{ currency?: string }>(`/${accountId}`, token, { fields: "currency" }, fetcher),
    graph<{ data?: RawMetaInsight[] }>(
      `/${accountId}/insights`,
      token,
      { level: "campaign", date_preset: "last_30d", fields: INSIGHT_FIELDS, limit: "50" },
      fetcher,
    ),
    graph<{ data?: RawMetaInsight[] }>(
      `/${accountId}/insights`,
      token,
      { level: "adset", date_preset: "last_30d", fields: INSIGHT_FIELDS, limit: "100" },
      fetcher,
    ),
    graph<{ data?: Array<{ status?: string }> }>(
      `/${accountId}/ads`,
      token,
      { fields: "id,status", limit: "200" },
      fetcher,
    ),
    graph<{ data?: RawMetaInsight[] }>(
      `/${accountId}/insights`,
      token,
      { level: "campaign", time_range: previousRange, fields: INSIGHT_FIELDS, limit: "50" },
      fetcher,
    ),
  ]);

  // Le compte n'a pas répondu du tout : ni devise, ni performances. Sans la
  // devise, aucun montant n'est interprétable — mieux vaut annoncer le canal
  // injoignable que produire des nombres sans unité.
  if (!account && !campaigns && !adsets) {
    return metaUnreachable("Le compte publicitaire n'a pas répondu.");
  }

  const activeAds = Array.isArray(ads?.data)
    ? ads.data.filter((a) => a.status === "ACTIVE").length
    : null;

  return metaObservations({
    currency: normalizeCurrency(account?.currency),
    campaigns: Array.isArray(campaigns?.data) ? campaigns.data : [],
    adsets: Array.isArray(adsets?.data) ? adsets.data : [],
    activeAds,
    previous: Array.isArray(previous?.data) && previous.data.length > 0 ? previous.data : null,
  });
}
