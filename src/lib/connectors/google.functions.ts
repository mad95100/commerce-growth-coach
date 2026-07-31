import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/adwords"].join(" ");

/**
 * Prépare l'URL d'autorisation Google (Google Ads API, accès hors-ligne).
 */
export const startGoogleAdsConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ storeId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: store, error } = await supabase
      .from("stores")
      .select("id, owner_id")
      .eq("id", data.storeId)
      .single();
    if (error || !store || store.owner_id !== userId) throw new Error("Boutique introuvable");

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new Error("GOOGLE_CLIENT_ID non configuré. Ajoute les clés Google dans les secrets.");
    }

    const { signOAuthState } = await import("@/lib/crypto.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    const origin = new URL(getRequest().url).origin;
    const redirectUri = `${origin}/api/public/oauth/google/callback`;

    const state = signOAuthState({
      userId,
      storeId: store.id,
      provider: "google_ads",
      nonce: crypto.randomUUID(),
    });

    await supabase.from("data_connections").upsert(
      { store_id: store.id, provider: "google_ads", status: "pending" },
      { onConflict: "store_id,provider" },
    );

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GOOGLE_SCOPES,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });

    return {
      authorizeUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    };
  });

/**
 * Choisit le compte Google Ads à piloter pour cette boutique.
 */
export const selectGoogleAdsAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ storeId: z.string().uuid(), customerId: z.string().min(3) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: conn, error } = await supabase
      .from("data_connections")
      .select("id, metadata")
      .eq("store_id", data.storeId)
      .eq("provider", "google_ads")
      .single();
    if (error || !conn) throw new Error("Connexion Google Ads introuvable");

    const customers = ((conn.metadata as { customers?: string[] })?.customers) ?? [];
    if (!customers.includes(data.customerId)) throw new Error("Compte Google Ads introuvable");

    const { error: uErr } = await supabase
      .from("data_connections")
      .update({ account_id: data.customerId, account_label: formatCustomerId(data.customerId) })
      .eq("id", conn.id);
    if (uErr) throw uErr;
    return { ok: true };
  });

export function formatCustomerId(id: string): string {
  const digits = id.replace(/\D/g, "");
  if (digits.length !== 10) return id;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}
