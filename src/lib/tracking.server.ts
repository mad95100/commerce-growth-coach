import type { SupabaseClient } from "@supabase/supabase-js";
import {
  captureStoreMetrics,
  computeDeltas,
  judgeOutcome,
  type ChannelCredentials,
  type StoreMetrics,
} from "@/lib/metrics.server";

type Db = SupabaseClient<any, any, any>;

/** Récupère les identifiants chiffrés des canaux actifs d'une boutique. */
export async function loadChannelCredentials(supabase: Db, storeId: string): Promise<ChannelCredentials> {
  const { data: conns } = await supabase
    .from("data_connections")
    .select("provider, account_id, access_token_ciphertext, refresh_token_ciphertext")
    .eq("store_id", storeId)
    .eq("status", "active");

  const active = conns ?? [];
  const shopify = active.find((c: any) => c.provider === "shopify");
  const meta = active.find((c: any) => c.provider === "meta_ads");
  const google = active.find((c: any) => c.provider === "google_ads");

  return {
    ...(shopify?.account_id && shopify.access_token_ciphertext
      ? { shopify: { shop: shopify.account_id, encryptedToken: shopify.access_token_ciphertext } }
      : {}),
    ...(meta?.account_id && meta.access_token_ciphertext
      ? { meta: { accountId: meta.account_id, encryptedToken: meta.access_token_ciphertext } }
      : {}),
    ...(google?.account_id && google.refresh_token_ciphertext
      ? { google: { customerId: google.account_id, encryptedRefreshToken: google.refresh_token_ciphertext } }
      : {}),
  };
}

/** Enregistre l'instantané « avant » juste après l'application d'une correction. */
export async function recordFixBaseline(
  supabase: Db,
  params: {
    findingId: string;
    storeId: string;
    expectedGainMin: number | null;
    expectedGainMax: number | null;
    creds: ChannelCredentials;
  },
): Promise<void> {
  try {
    const baseline = await captureStoreMetrics(params.creds);
    await supabase.from("fix_outcomes").upsert(
      {
        finding_id: params.findingId,
        store_id: params.storeId,
        applied_at: new Date().toISOString(),
        expected_gain_min: params.expectedGainMin,
        expected_gain_max: params.expectedGainMax,
        baseline,
        latest: null,
        delta: null,
        status: "measuring",
        alert_message: null,
        checked_at: null,
      },
      { onConflict: "finding_id" },
    );
  } catch {
    /* le suivi ne doit jamais faire échouer la correction */
  }
}

/** Re-mesure tous les suivis d'une boutique et met à jour écarts, statut et alertes. */
export async function refreshStoreOutcomes(supabase: Db, storeId: string) {
  const { data: rows, error } = await supabase
    .from("fix_outcomes")
    .select("*")
    .eq("store_id", storeId);
  if (error) throw error;
  if (!rows || rows.length === 0) return { updated: 0 };

  const creds = await loadChannelCredentials(supabase, storeId);
  if (!creds.shopify && !creds.meta && !creds.google) {
    throw new Error("Connecte au moins Shopify, Meta Ads ou Google Ads pour mesurer l'impact des corrections.");
  }

  const latest = await captureStoreMetrics(creds);

  for (const row of rows as any[]) {
    const baseline = (row.baseline ?? {}) as StoreMetrics;
    const deltas = computeDeltas(baseline, latest);
    const verdict = judgeOutcome(deltas, row.applied_at, row.expected_gain_min ?? null);
    await supabase
      .from("fix_outcomes")
      .update({
        latest,
        delta: deltas,
        status: verdict.status,
        alert_message: verdict.alert_message,
        checked_at: new Date().toISOString(),
      })
      .eq("id", row.id);
  }

  return { updated: rows.length };
}
