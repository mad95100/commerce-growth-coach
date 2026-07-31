import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const SHOPIFY_SCOPES = [
  "read_products",
  "write_products",
  "read_orders",
  "read_customers",
  "read_analytics",
  "read_price_rules",
  "write_price_rules",
  "read_discounts",
  "write_discounts",
].join(",");


function normalizeShop(shopInput: string): string {
  const raw = shopInput.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (raw.endsWith(".myshopify.com")) return raw;
  // Accept plain handle (e.g. "myshop") and turn into myshop.myshopify.com
  if (/^[a-z0-9][a-z0-9-]*$/.test(raw)) return `${raw}.myshopify.com`;
  throw new Error("Domaine Shopify invalide. Exemple : monshop.myshopify.com");
}

function computeRedirectUri(request: Request): string {
  const url = new URL(request.url);
  return `${url.origin}/api/public/oauth/shopify/callback`;
}

/**
 * Prépare l'URL d'autorisation Shopify pour une boutique donnée.
 * L'utilisateur clique dessus et arrive sur son admin Shopify.
 */
export const startShopifyConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      storeId: z.string().uuid(),
      shopDomain: z.string().min(3),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const shop = normalizeShop(data.shopDomain);

    const { data: store, error } = await supabase
      .from("stores")
      .select("id, owner_id")
      .eq("id", data.storeId)
      .single();
    if (error || !store || store.owner_id !== userId) throw new Error("Boutique introuvable");

    const clientId = process.env.SHOPIFY_CLIENT_ID;
    if (!clientId) throw new Error("SHOPIFY_CLIENT_ID non configuré. Ajoute la clé dans les secrets.");

    const { signOAuthState } = await import("@/lib/crypto.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    const request = getRequest();
    const redirectUri = computeRedirectUri(request);

    const state = signOAuthState({
      userId,
      storeId: store.id,
      provider: "shopify",
      shop,
      nonce: crypto.randomUUID(),
    });

    // Upsert pending connection with the shop we intend to link.
    await supabase.from("data_connections").upsert(
      {
        store_id: store.id,
        provider: "shopify",
        status: "pending",
        account_id: shop,
        account_label: shop,
      },
      { onConflict: "store_id,provider" },
    );

    const params = new URLSearchParams({
      client_id: clientId,
      scope: SHOPIFY_SCOPES,
      redirect_uri: redirectUri,
      state,
    });
    const authorizeUrl = `https://${shop}/admin/oauth/authorize?${params.toString()}`;
    return { authorizeUrl };
  });

export const disconnectShopify = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ storeId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("data_connections")
      .delete()
      .eq("store_id", data.storeId)
      .eq("provider", "shopify");
    if (error) throw error;
    return { ok: true };
  });
