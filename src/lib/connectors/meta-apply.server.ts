import { decryptToken } from "@/lib/crypto.server";
import { normalizeCurrency } from "@/lib/currency";

const V = "v21.0";
const GRAPH = `https://graph.facebook.com/${V}`;

export type MetaAdSet = {
  id: string;
  name: string;
  status: string;
  campaign_name?: string;
  daily_budget: number | null;
  targeting_summary: string;
  spend?: number;
  purchases?: number;
  roas?: number;
  ctr?: number;
  cpc?: number;
};

export type MetaAd = {
  id: string;
  name: string;
  status: string;
  adset_id: string;
  primary_text: string | null;
  headline: string | null;
};

export type MetaSnapshot = {
  accountId: string;
  currency: string | null;
  adsets: MetaAdSet[];
  ads: MetaAd[];
};

export function metaToken(encrypted: string): string {
  return decryptToken(encrypted);
}

async function graph<T>(
  path: string,
  token: string,
  params: Record<string, string> = {},
): Promise<T> {
  const qs = new URLSearchParams({ ...params, access_token: token }).toString();
  const res = await fetch(`${GRAPH}${path}?${qs}`);
  if (!res.ok) throw new Error(`Meta API ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function graphPost<T>(
  path: string,
  token: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${GRAPH}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, access_token: token }),
  });
  if (!res.ok) throw new Error(`Meta API ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

function summarizeTargeting(t: Record<string, unknown> | undefined): string {
  if (!t) return "(non détaillé)";
  const parts: string[] = [];
  if (t.age_min || t.age_max) parts.push(`âge ${t.age_min ?? "?"}-${t.age_max ?? "?"}`);
  const genders = t.genders as number[] | undefined;
  if (genders?.length)
    parts.push(
      genders.includes(1) && genders.includes(2)
        ? "tous genres"
        : genders.includes(1)
          ? "hommes"
          : "femmes",
    );
  const geo = t.geo_locations as { countries?: string[] } | undefined;
  if (geo?.countries?.length) parts.push(`pays ${geo.countries.join(",")}`);
  const interests = (t.flexible_spec as { interests?: { name: string }[] }[] | undefined)?.[0]
    ?.interests;
  if (interests?.length)
    parts.push(
      `intérêts ${interests
        .map((i) => i.name)
        .slice(0, 5)
        .join(", ")}`,
    );
  return parts.length ? parts.join(" | ") : "large (aucun ciblage précis)";
}

/** Instantané du compte publicitaire Meta sur 30 jours. */
export async function fetchMetaSnapshot(accountId: string, token: string): Promise<MetaSnapshot> {
  const [accountRes, adsetsRes, adsRes, insightsRes] = await Promise.all([
    // La devise du compte publicitaire. Elle était codée à `null`, ce qui
    // laissait supposer l'euro partout en aval. Un échec ici laisse la devise
    // indéterminée — jamais une valeur devinée.
    graph<{ currency?: string }>(`/${accountId}`, token, { fields: "currency" }).catch(
      (): { currency?: string } => ({}),
    ),
    graph<{ data: Array<Record<string, unknown>> }>(`/${accountId}/adsets`, token, {
      fields: "id,name,status,daily_budget,targeting,campaign{name}",
      limit: "25",
    }),
    graph<{ data: Array<Record<string, unknown>> }>(`/${accountId}/ads`, token, {
      fields: "id,name,status,adset_id,creative{body,title,object_story_spec}",
      limit: "25",
    }),
    graph<{ data: Array<Record<string, unknown>> }>(`/${accountId}/insights`, token, {
      level: "adset",
      date_preset: "last_30d",
      fields: "adset_id,spend,ctr,cpc,actions,purchase_roas",
      limit: "50",
    }).catch(() => ({ data: [] })),
  ]);

  const insightsByAdset = new Map<string, Record<string, unknown>>();
  for (const row of insightsRes.data) insightsByAdset.set(String(row.adset_id), row);

  const adsets: MetaAdSet[] = adsetsRes.data.map((a) => {
    const ins = insightsByAdset.get(String(a.id));
    const actions = (ins?.actions as { action_type: string; value: string }[] | undefined) ?? [];
    const purchases = actions.find((x) => x.action_type === "purchase");
    const roas = (ins?.purchase_roas as { value: string }[] | undefined)?.[0]?.value;
    return {
      id: String(a.id),
      name: String(a.name),
      status: String(a.status),
      campaign_name: (a.campaign as { name?: string } | undefined)?.name,
      daily_budget: a.daily_budget ? Number(a.daily_budget) / 100 : null,
      targeting_summary: summarizeTargeting(a.targeting as Record<string, unknown> | undefined),
      spend: ins?.spend ? Number(ins.spend) : undefined,
      purchases: purchases ? Number(purchases.value) : undefined,
      roas: roas ? Number(roas) : undefined,
      ctr: ins?.ctr ? Number(ins.ctr) : undefined,
      cpc: ins?.cpc ? Number(ins.cpc) : undefined,
    };
  });

  const ads: MetaAd[] = adsRes.data.map((a) => {
    const creative = a.creative as
      { body?: string; title?: string; object_story_spec?: Record<string, unknown> } | undefined;
    return {
      id: String(a.id),
      name: String(a.name),
      status: String(a.status),
      adset_id: String(a.adset_id),
      primary_text: creative?.body ?? null,
      headline: creative?.title ?? null,
    };
  });

  return { accountId, currency: normalizeCurrency(accountRes.currency), adsets, ads };
}

export function metaAdsManagerUrl(accountId: string): string {
  return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${accountId.replace("act_", "")}`;
}

/** Change le budget quotidien d'un ensemble de publicités. */
export async function metaUpdateBudget(adsetId: string, token: string, dailyBudget: number) {
  await graphPost(`/${adsetId}`, token, { daily_budget: Math.round(dailyBudget * 100) });
  return { dailyBudget };
}

/** Statuts d'un ensemble de publicités que l'on s'autorise à écrire. */
export type MetaAdSetWritableStatus = "ACTIVE" | "PAUSED";

/** Change le statut d'un ensemble de publicités. Sert à la pause comme à son annulation. */
export async function metaSetAdSetStatus(
  adsetId: string,
  token: string,
  status: MetaAdSetWritableStatus,
) {
  await graphPost(`/${adsetId}`, token, { status });
  return { adsetId, status };
}

/** Met en pause un ensemble de publicités qui brûle du budget. */
export async function metaPauseAdSet(adsetId: string, token: string) {
  await metaSetAdSetStatus(adsetId, token, "PAUSED");
  return { adsetId };
}

/** Ajuste le ciblage (âge, genres, pays) en conservant le reste du ciblage existant. */
export async function metaUpdateTargeting(
  adsetId: string,
  token: string,
  patch: { age_min?: number; age_max?: number; genders?: number[]; countries?: string[] },
) {
  const current = await graph<{ targeting?: Record<string, unknown> }>(`/${adsetId}`, token, {
    fields: "targeting",
  });
  const targeting: Record<string, unknown> = { ...(current.targeting ?? {}) };

  if (patch.age_min) targeting.age_min = Math.max(18, Math.min(65, patch.age_min));
  if (patch.age_max) targeting.age_max = Math.max(18, Math.min(65, patch.age_max));
  if (patch.genders?.length) targeting.genders = patch.genders;
  if (patch.countries?.length) {
    const geo = (targeting.geo_locations as Record<string, unknown> | undefined) ?? {};
    targeting.geo_locations = { ...geo, countries: patch.countries.map((c) => c.toUpperCase()) };
  }

  await graphPost(`/${adsetId}`, token, { targeting });
  return { targeting_summary: summarizeTargeting(targeting) };
}

/**
 * Réécrit la création d'une publicité : duplique le creative existant avec le
 * nouveau texte / titre, puis rattache le nouveau creative à la publicité.
 */
export async function metaUpdateAdCreative(
  adId: string,
  accountId: string,
  token: string,
  copy: { primary_text?: string; headline?: string; description?: string },
) {
  const ad = await graph<{ creative?: { id: string } }>(`/${adId}`, token, {
    fields: "creative{id}",
  });
  if (!ad.creative?.id) throw new Error("Publicité sans création exploitable");

  const creative = await graph<{
    name?: string;
    object_story_spec?: Record<string, unknown>;
    degrees_of_freedom_spec?: unknown;
  }>(`/${ad.creative.id}`, token, { fields: "name,object_story_spec" });

  const spec = JSON.parse(JSON.stringify(creative.object_story_spec ?? {})) as Record<
    string,
    unknown
  >;
  const linkData = spec.link_data as Record<string, unknown> | undefined;
  const videoData = spec.video_data as Record<string, unknown> | undefined;
  const target = linkData ?? videoData;
  if (!target) throw new Error("Format de création non supporté pour la réécriture automatique");

  if (copy.primary_text) target.message = copy.primary_text;
  if (copy.headline) {
    if (linkData) linkData.name = copy.headline;
    else if (videoData) videoData.title = copy.headline;
  }
  if (copy.description) target.description = copy.description;

  const created = await graphPost<{ id: string }>(`/${accountId}/adcreatives`, token, {
    name: `${creative.name ?? "Creative"} — EcomPilot ${new Date().toISOString().slice(0, 10)}`,
    object_story_spec: spec,
  });

  await graphPost(`/${adId}`, token, { creative: { creative_id: created.id } });
  // `previousCreativeId` est conservé pour tracer ce qui a été remplacé. Il n'est
  // pas promis comme réversible : rien ne garantit qu'une création détachée reste
  // rattachable, et nous n'avons pas pu le vérifier contre l'API.
  return { creativeId: created.id, previousCreativeId: ad.creative.id };
}
