import { currencyLabel } from "@/lib/currency";
import type { SupabaseClient } from "@supabase/supabase-js";
import { captureStoreMetrics, type StoreMetrics } from "@/lib/metrics.server";
import { loadChannelCredentials } from "@/lib/tracking.server";

type Db = SupabaseClient<any, any, any>;

export type StoreSnapshot = StoreMetrics & {
  /** Canaux qui n'ont pas répondu — l'audit continue quand même. */
  unavailable: string[];
};

/**
 * Capture les données réelles de tous les canaux connectés et les historise.
 * Un canal indisponible n'interrompt jamais la capture : il est listé dans `unavailable`.
 */
export async function captureAndStoreSnapshot(
  supabase: Db,
  storeId: string,
): Promise<StoreSnapshot> {
  const creds = await loadChannelCredentials(supabase, storeId);
  const metrics = await captureStoreMetrics(creds);

  const unavailable: string[] = [];
  if (creds.shopify && !metrics.shopify) unavailable.push("Shopify");
  if (creds.meta && !metrics.meta) unavailable.push("Meta Ads");
  if (creds.google && !metrics.google) unavailable.push("Google Ads");

  const snapshot: StoreSnapshot = { ...metrics, unavailable };

  // Détection automatique de la devise de la boutique : Shopify fait autorité.
  // On la recopie sur `stores.currency` à chaque instantané, pour qu'un
  // changement de devise de la boutique soit suivi sans intervention. Un échec
  // n'interrompt rien : la devise reste celle déjà connue.
  if (metrics.shopify?.currency) {
    try {
      await supabase
        .from("stores")
        .update({ currency: metrics.shopify.currency })
        .eq("id", storeId)
        .neq("currency", metrics.shopify.currency);
    } catch {
      /* la devise sera rafraîchie au prochain instantané */
    }
  }

  // `data_snapshots` n'est plus modifiable par le navigateur : ces chiffres
  // nourrissent l'audit, les laisser réécrire par le client reviendrait à lui
  // laisser choisir les données sur lesquelles l'IA raisonne.
  const { supabaseAdmin: writer } = await import("@/integrations/supabase/client.server");

  try {
    await writer.from("data_snapshots").insert({
      store_id: storeId,
      kind: "composite",
      period_days: 30,
      payload: snapshot,
      partial: unavailable.length > 0,
      error_message:
        unavailable.length > 0 ? `Sources indisponibles : ${unavailable.join(", ")}` : null,
    });
  } catch {
    /* l'historisation ne doit jamais faire échouer un audit */
  }

  return snapshot;
}

/** Dernier instantané enregistré au moins `daysAgo` jours avant maintenant. */
export async function getSnapshotAround(
  supabase: Db,
  storeId: string,
  daysAgo: number,
): Promise<StoreMetrics | null> {
  const before = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  const { data } = await supabase
    .from("data_snapshots")
    .select("payload, fetched_at")
    .eq("store_id", storeId)
    .eq("kind", "composite")
    .lte("fetched_at", before)
    .order("fetched_at", { ascending: false })
    .limit(1);
  const row = (data ?? [])[0] as { payload: StoreMetrics } | undefined;
  return row?.payload ?? null;
}

function num(v: number | null | undefined, suffix = ""): string {
  return v == null || !Number.isFinite(v)
    ? "donnée indisponible"
    : `${Math.round(v * 100) / 100}${suffix}`;
}

/** Bloc texte injecté dans le prompt IA : uniquement des chiffres réels, jamais d'invention. */
export function snapshotToPromptBlock(
  snap: StoreSnapshot,
  previous: StoreMetrics | null,
  // Devise de la boutique. Aucune valeur par défaut : une devise inconnue est
  // annoncée comme telle au modèle, jamais remplacée par l'euro.
  storeCurrency: string | null = null,
): string {
  const lines: string[] = [];

  // Chaque canal annonce SA devise. Meta et Google facturent dans celle de leur
  // compte, qui n'est pas nécessairement celle de la boutique. Le modèle doit le
  // voir, sans quoi il additionnerait des montants incomparables dans ses
  // recommandations chiffrées.
  const metaCurrency = currencyLabel(snap.meta?.currency ?? null);
  const googleCurrency = currencyLabel(snap.google?.currency ?? null);
  const shopCurrency = currencyLabel(snap.shopify?.currency ?? storeCurrency);

  const currencies = new Set(
    [snap.shopify?.currency ?? storeCurrency, snap.meta?.currency, snap.google?.currency].filter(
      (c): c is string => Boolean(c),
    ),
  );
  if (currencies.size > 1) {
    lines.push(
      `AVERTISSEMENT DEVISES : les canaux ci-dessous sont libellés dans des devises
différentes (${[...currencies].join(", ")}). N'additionne, ne soustrais et ne compare
jamais deux montants de devises différentes, et ne convertis pas : aucun taux de
change n'est disponible. Raisonne canal par canal.`,
    );
  }

  if (snap.shopify) {
    lines.push(
      `SHOPIFY (30 derniers jours, données réelles) :
- Chiffre d'affaires : ${num(snap.shopify.revenue_30d)} ${shopCurrency}
- Commandes payées : ${num(snap.shopify.orders_30d)}
- Panier moyen : ${num(snap.shopify.aov)} ${shopCurrency}`,
    );
  }

  if (snap.meta) {
    lines.push(
      `META ADS (30 derniers jours, données réelles) :
- Dépense : ${num(snap.meta.spend)} ${metaCurrency}
- Achats attribués : ${num(snap.meta.purchases)}
- ROAS : ${num(snap.meta.roas)}
- CTR : ${num(snap.meta.ctr, " %")}`,
    );
  }

  if (snap.google) {
    lines.push(
      `GOOGLE ADS (30 derniers jours, données réelles) :
- Dépense : ${num(snap.google.cost)} ${googleCurrency}
- Clics : ${num(snap.google.clicks)}
- Conversions : ${num(snap.google.conversions)}
- CTR : ${num(snap.google.ctr != null ? snap.google.ctr * 100 : null, " %")}
- Taux de conversion : ${num(snap.google.conversion_rate != null ? snap.google.conversion_rate * 100 : null, " %")}`,
    );
  }

  if (previous) {
    const prevRev = previous.shopify?.revenue_30d ?? null;
    const curRev = snap.shopify?.revenue_30d ?? null;
    if (prevRev != null && curRev != null && prevRev > 0) {
      const pct = ((curRev - prevRev) / prevRev) * 100;
      lines.push(
        `TENDANCE : le CA a évolué de ${pct >= 0 ? "+" : ""}${pct.toFixed(1)} % depuis la mesure précédente.`,
      );
    }
  }

  if (snap.unavailable.length > 0) {
    lines.push(
      `SOURCES INDISPONIBLES pour le moment : ${snap.unavailable.join(", ")}. N'invente aucun chiffre pour ces canaux, dis simplement que la donnée manque.`,
    );
  }

  if (lines.length === 0) {
    return `AUCUNE SOURCE DE DONNÉES CONNECTÉE. Tu dois te baser uniquement sur les informations déclarées par l'utilisateur et le dire explicitement : chaque estimation est une hypothèse, avec une confiance "low".`;
  }

  return lines.join("\n\n");
}
