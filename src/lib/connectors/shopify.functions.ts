import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SHOPIFY_SCOPE_PARAM } from "@/lib/connectors/shopify-scopes";
import { z } from "zod";

function normalizeShop(shopInput: string): string {
  const cleaned = shopInput
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "");

  // L'adresse que l'utilisateur a sous les yeux dans l'admin Shopify moderne est
  // `admin.shopify.com/store/<handle>`. La coller renvoyait « Domaine Shopify
  // invalide » sans dire quoi saisir à la place : on en extrait le handle.
  const adminUrl = cleaned.match(/^admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/);
  if (adminUrl) return `${adminUrl[1]}.myshopify.com`;

  const raw = cleaned.replace(/\/.*$/, "");
  if (raw.endsWith(".myshopify.com")) return raw;
  // Accept plain handle (e.g. "myshop") and turn into myshop.myshopify.com
  if (/^[a-z0-9][a-z0-9-]*$/.test(raw)) return `${raw}.myshopify.com`;
  throw new Error(
    `Domaine Shopify non reconnu : « ${shopInput.trim()} ». Attendu : monshop.myshopify.com, le nom court monshop, ou l'adresse admin.shopify.com/store/monshop.`,
  );
}

/**
 * Prépare l'URL d'autorisation Shopify pour une boutique donnée.
 * L'utilisateur clique dessus et arrive sur son admin Shopify.
 */
export const startShopifyConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        storeId: z.string().uuid(),
        shopDomain: z.string().min(3),
      })
      .parse(input),
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

    // Tous les secrets du parcours sont vérifiés MAINTENANT, avant d'envoyer
    // l'utilisateur chez Shopify. Sinon l'échec survient au retour d'autorisation,
    // hors de l'application, là où il ne peut plus rien comprendre ni corriger.
    const missing = (
      [
        ["SHOPIFY_CLIENT_ID", process.env.SHOPIFY_CLIENT_ID],
        ["SHOPIFY_CLIENT_SECRET", process.env.SHOPIFY_CLIENT_SECRET],
        ["OAUTH_STATE_SECRET", process.env.OAUTH_STATE_SECRET],
        ["DATA_CONNECTIONS_ENCRYPTION_KEY", process.env.DATA_CONNECTIONS_ENCRYPTION_KEY],
      ] as const
    )
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (missing.length > 0) {
      throw new Error(
        `Connexion Shopify impossible : ${missing.join(", ")} manquant(s) côté serveur. Ajoute ces clés dans les secrets du projet, puis réessaie.`,
      );
    }
    const clientId = process.env.SHOPIFY_CLIENT_ID as string;

    const { signOAuthState } = await import("@/lib/crypto.server");
    const { oauthCallbackUrl } = await import("@/lib/public-origin.server");
    const redirectUri = oauthCallbackUrl("shopify");

    const state = signOAuthState({
      userId,
      storeId: store.id,
      provider: "shopify",
      shop,
      nonce: crypto.randomUUID(),
    });

    // On note la boutique visée, sans dégrader une connexion déjà active : si
    // l'utilisateur abandonne l'autorisation en cours de route, il garde la sienne.
    const { data: existing } = await supabase
      .from("data_connections")
      .select("status")
      .eq("store_id", store.id)
      .eq("provider", "shopify")
      .maybeSingle();

    if (existing?.status !== "active") {
      const { upsertPendingConnection } = await import("@/lib/connectors/connection-writes.server");
      await upsertPendingConnection(supabase as never, store.id, "shopify", shop);
    }

    const params = new URLSearchParams({
      client_id: clientId,
      scope: SHOPIFY_SCOPE_PARAM,
      redirect_uri: redirectUri,
      state,
    });
    const authorizeUrl = `https://${shop}/admin/oauth/authorize?${params.toString()}`;
    return { authorizeUrl };
  });

export const disconnectShopify = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ storeId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { deleteConnection } = await import("@/lib/connectors/connection-writes.server");
    await deleteConnection(context.supabase as never, data.storeId, "shopify");
    return { ok: true };
  });
