import { decryptToken } from "@/lib/crypto.server";
import { normalizeCurrency } from "@/lib/currency";

const V = "v18";
const BASE = `https://googleads.googleapis.com/${V}`;

export type GoogleCampaign = {
  resource_name: string;
  id: string;
  name: string;
  status: string;
  channel: string;
  budget_resource_name: string | null;
  daily_budget: number | null;
  cost_30d: number | null;
  clicks_30d: number | null;
  conversions_30d: number | null;
  ctr_30d: number | null;
};

export type GoogleRsa = {
  resource_name: string;
  campaign_name: string;
  ad_group_name: string;
  headlines: string[];
  descriptions: string[];
};

export type GoogleSnapshot = {
  customerId: string;
  currency: string | null;
  campaigns: GoogleCampaign[];
  ads: GoogleRsa[];
};

/** Échange le refresh token contre un access token frais. */
export async function googleAccessToken(encryptedRefreshToken: string): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth non configuré côté serveur");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: decryptToken(encryptedRefreshToken),
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!res.ok) throw new Error(`Rafraîchissement du token Google échoué : ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

function headers(accessToken: string): Record<string, string> {
  const dev = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!dev) throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN manquant");
  const h: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": dev,
    "Content-Type": "application/json",
  };
  const login = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  if (login) h["login-customer-id"] = login.replace(/\D/g, "");
  return h;
}

async function search(customerId: string, accessToken: string, query: string) {
  const res = await fetch(`${BASE}/customers/${customerId}/googleAds:search`, {
    method: "POST",
    headers: headers(accessToken),
    body: JSON.stringify({ query, pageSize: 50 }),
  });
  if (!res.ok) throw new Error(`Google Ads API ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { results?: Record<string, any>[] }).results ?? [];
}

async function mutate(customerId: string, accessToken: string, endpoint: string, body: unknown) {
  const res = await fetch(`${BASE}/customers/${customerId}/${endpoint}:mutate`, {
    method: "POST",
    headers: headers(accessToken),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Google Ads API ${res.status}: ${await res.text()}`);
  return await res.json();
}

const MICROS = 1_000_000;

/** Instantané des campagnes Google Ads (30 derniers jours). */
export async function fetchGoogleSnapshot(
  customerId: string,
  accessToken: string,
): Promise<GoogleSnapshot> {
  const campaignRows = await search(
    customerId,
    accessToken,
    // `customer.currency_code` accompagne chaque ligne : c'est la devise du
    // compte, jusqu'ici jamais lue, ce qui laissait supposer l'euro en aval.
    `SELECT customer.currency_code,
            campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
            campaign_budget.resource_name, campaign_budget.amount_micros,
            metrics.cost_micros, metrics.clicks, metrics.conversions, metrics.ctr
     FROM campaign
     WHERE segments.date DURING LAST_30_DAYS
     ORDER BY metrics.cost_micros DESC`,
  );

  const campaigns: GoogleCampaign[] = campaignRows.map((r) => ({
    resource_name: `customers/${customerId}/campaigns/${r.campaign.id}`,
    id: String(r.campaign.id),
    name: r.campaign.name,
    status: r.campaign.status,
    channel: r.campaign.advertisingChannelType ?? "UNKNOWN",
    budget_resource_name: r.campaignBudget?.resourceName ?? null,
    daily_budget: r.campaignBudget?.amountMicros
      ? Number(r.campaignBudget.amountMicros) / MICROS
      : null,
    cost_30d: r.metrics?.costMicros ? Number(r.metrics.costMicros) / MICROS : 0,
    clicks_30d: r.metrics?.clicks ? Number(r.metrics.clicks) : 0,
    conversions_30d: r.metrics?.conversions ? Number(r.metrics.conversions) : 0,
    ctr_30d: r.metrics?.ctr ? Number(r.metrics.ctr) : 0,
  }));

  let ads: GoogleRsa[] = [];
  try {
    const adRows = await search(
      customerId,
      accessToken,
      `SELECT ad_group_ad.ad.resource_name, ad_group_ad.resource_name,
              ad_group_ad.ad.responsive_search_ad.headlines,
              ad_group_ad.ad.responsive_search_ad.descriptions,
              ad_group.name, campaign.name
       FROM ad_group_ad
       WHERE ad_group_ad.ad.type = RESPONSIVE_SEARCH_AD
         AND ad_group_ad.status != 'REMOVED'
       LIMIT 20`,
    );
    ads = adRows.map((r) => ({
      resource_name: r.adGroupAd.resourceName,
      campaign_name: r.campaign?.name ?? "",
      ad_group_name: r.adGroup?.name ?? "",
      headlines: (r.adGroupAd.ad.responsiveSearchAd?.headlines ?? []).map((h: any) => h.text),
      descriptions: (r.adGroupAd.ad.responsiveSearchAd?.descriptions ?? []).map((d: any) => d.text),
    }));
  } catch {
    ads = [];
  }

  // Toutes les lignes portent la même devise de compte ; la première suffit.
  // Absente ou invalide, elle reste indéterminée — jamais devinée.
  const currency = normalizeCurrency(campaignRows[0]?.customer?.currencyCode);

  return { customerId, currency, campaigns, ads };
}

export function googleAdsUrl(customerId: string): string {
  return `https://ads.google.com/aw/campaigns?__e=${customerId.replace(/\D/g, "")}`;
}

/** Modifie le budget quotidien d'une campagne. */
export async function googleUpdateBudget(
  customerId: string,
  accessToken: string,
  budgetResourceName: string,
  dailyBudget: number,
) {
  await mutate(customerId, accessToken, "campaignBudgets", {
    operations: [
      {
        update: {
          resourceName: budgetResourceName,
          amountMicros: String(Math.round(dailyBudget * MICROS)),
        },
        updateMask: "amount_micros",
      },
    ],
  });
  return { dailyBudget };
}

/** Statuts de campagne que l'on s'autorise à écrire. `REMOVED` est volontairement exclu. */
export type GoogleCampaignWritableStatus = "ENABLED" | "PAUSED";

/** Change le statut d'une campagne. Sert à la pause comme à son annulation. */
export async function googleSetCampaignStatus(
  customerId: string,
  accessToken: string,
  campaignResourceName: string,
  status: GoogleCampaignWritableStatus,
) {
  await mutate(customerId, accessToken, "campaigns", {
    operations: [{ update: { resourceName: campaignResourceName, status }, updateMask: "status" }],
  });
  return { campaignResourceName, status };
}

/** Met en pause une campagne non rentable. */
export async function googlePauseCampaign(
  customerId: string,
  accessToken: string,
  campaignResourceName: string,
) {
  await googleSetCampaignStatus(customerId, accessToken, campaignResourceName, "PAUSED");
  return { campaignResourceName };
}

/** Ajoute des mots-clés à exclure au niveau campagne (ciblage plus propre). */
export async function googleAddNegativeKeywords(
  customerId: string,
  accessToken: string,
  campaignResourceName: string,
  keywords: string[],
) {
  const response = (await mutate(customerId, accessToken, "campaignCriteria", {
    operations: keywords.slice(0, 20).map((text) => ({
      create: {
        campaign: campaignResourceName,
        negative: true,
        keyword: { text, matchType: "PHRASE" },
      },
    })),
  })) as { results?: Array<{ resourceName?: string }> };

  // Nécessaire à l'annulation. On ne suppose RIEN de la forme de la réponse : on ne
  // garde que des chaînes réellement présentes. Si la liste ressort vide, l'appelant
  // en déduira que l'action n'est pas annulable, plutôt que de le promettre à tort.
  const createdResourceNames = (response?.results ?? [])
    .map((r) => r?.resourceName)
    .filter((name): name is string => typeof name === "string" && name.length > 0);

  return { keywords, createdResourceNames };
}

/**
 * Retire des critères de campagne. Annulation de `google_add_negative_keywords`.
 * Les `resourceName` proviennent de la réponse de création.
 */
export async function googleRemoveCampaignCriteria(
  customerId: string,
  accessToken: string,
  resourceNames: string[],
) {
  await mutate(customerId, accessToken, "campaignCriteria", {
    operations: resourceNames.map((resourceName) => ({ remove: resourceName })),
  });
  return { removed: resourceNames.length };
}

/** Réécrit les titres et descriptions d'une annonce responsive. */
export async function googleUpdateRsaText(
  customerId: string,
  accessToken: string,
  adGroupAdResourceName: string,
  copy: { headlines?: string[]; descriptions?: string[] },
) {
  const adResource = await search(
    customerId,
    accessToken,
    `SELECT ad_group_ad.ad.resource_name FROM ad_group_ad
     WHERE ad_group_ad.resource_name = '${adGroupAdResourceName}' LIMIT 1`,
  );
  const adResourceName = adResource[0]?.adGroupAd?.ad?.resourceName;
  if (!adResourceName) throw new Error("Annonce Google Ads introuvable");

  const headlines = (copy.headlines ?? []).filter((t) => t.length <= 30).slice(0, 15);
  const descriptions = (copy.descriptions ?? []).filter((t) => t.length <= 90).slice(0, 4);
  if (headlines.length < 3 && descriptions.length < 2) {
    throw new Error("Textes générés invalides pour Google Ads (limites de caractères)");
  }

  const responsiveSearchAd: Record<string, unknown> = {};
  const masks: string[] = [];
  if (headlines.length >= 3) {
    responsiveSearchAd.headlines = headlines.map((text) => ({ text }));
    masks.push("ad.responsive_search_ad.headlines");
  }
  if (descriptions.length >= 2) {
    responsiveSearchAd.descriptions = descriptions.map((text) => ({ text }));
    masks.push("ad.responsive_search_ad.descriptions");
  }

  await mutate(customerId, accessToken, "ads", {
    operations: [
      {
        update: { resourceName: adResourceName, responsiveSearchAd },
        updateMask: masks.map((m) => m.replace("ad.", "")).join(","),
      },
    ],
  });
  return { headlines, descriptions };
}
