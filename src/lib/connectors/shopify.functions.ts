import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeShop } from "@/lib/connectors/shopify-domain";
import { SHOPIFY_SCOPE_PARAM } from "@/lib/connectors/shopify-scopes";
import { z } from "zod";

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
        `Connexion Shopify impossible : ${missing.join(", ")} manquant(s) côté serveur. Ajoutez ces clés dans les secrets du projet, puis réessaie.`,
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

// `disconnectShopify` vivait ici : une seconde voie de déconnexion, plus
// étroite que `disconnectProvider` et qu'aucun écran n'appelait. Deux chemins
// pour un même geste finissent par diverger — l'un reçoit une correction, pas
// l'autre. Le panneau des sources passe par `disconnectProvider`, qui traite
// les quatre fournisseurs de la même façon.
