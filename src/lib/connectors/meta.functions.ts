import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const META_API_VERSION = "v21.0";

const META_SCOPES = ["ads_management", "ads_read", "business_management"].join(",");

/**
 * Prépare l'URL d'autorisation Meta (Facebook Login for Business).
 */
export const startMetaConnect = createServerFn({ method: "POST" })
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

    const clientId = process.env.META_CLIENT_ID;
    if (!clientId) {
      throw new Error("META_CLIENT_ID non configuré. Ajoutez les clés Meta dans les secrets.");
    }

    const { signOAuthState } = await import("@/lib/crypto.server");
    const { oauthCallbackUrl } = await import("@/lib/public-origin.server");
    const redirectUri = oauthCallbackUrl("meta");

    const state = signOAuthState({
      userId,
      storeId: store.id,
      provider: "meta_ads",
      nonce: crypto.randomUUID(),
    });

    const { upsertPendingConnection } = await import("@/lib/connectors/connection-writes.server");
    await upsertPendingConnection(supabase as never, store.id, "meta_ads", "");

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      response_type: "code",
      scope: META_SCOPES,
    });

    return {
      authorizeUrl: `https://www.facebook.com/${META_API_VERSION}/dialog/oauth?${params.toString()}`,
    };
  });

/**
 * Choisit le compte publicitaire Meta à utiliser pour cette boutique.
 */
export const selectMetaAdAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ storeId: z.string().uuid(), accountId: z.string().min(3) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: conn, error } = await supabase
      .from("data_connections")
      .select("id, metadata")
      .eq("store_id", data.storeId)
      .eq("provider", "meta_ads")
      .single();
    if (error || !conn) throw new Error("Connexion Meta introuvable");

    const accounts =
      (conn.metadata as { accounts?: { id: string; name: string }[] })?.accounts ?? [];
    const match = accounts.find((a) => a.id === data.accountId);
    if (!match) throw new Error("Compte publicitaire introuvable");

    const { updateConnectionById } = await import("@/lib/connectors/connection-writes.server");
    await updateConnectionById(supabase as never, data.storeId, conn.id, {
      account_id: match.id,
      account_label: match.name,
    });
    return { ok: true };
  });
