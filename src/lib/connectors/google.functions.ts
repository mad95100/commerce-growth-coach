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
      // Voir `meta.functions.ts` : la variable manquante va au journal, la
      // phrase dit au marchand que la cause est chez nous et qu'il n'a rien à
      // faire. Lui demander d'ajouter un secret auquel il n'a pas accès le
      // laisse chercher une panne qui n'est pas la sienne.
      console.error("[Google OAuth] GOOGLE_CLIENT_ID absent des secrets du worker.");
      throw new Error(
        "La connexion Google Ads n'est pas encore ouverte sur ce produit. Rien à faire de votre côté : il nous reste à la brancher. Vos autres connexions et votre diagnostic ne sont pas affectés.",
      );
    }

    const { signOAuthState } = await import("@/lib/crypto.server");
    const { oauthCallbackUrl } = await import("@/lib/public-origin.server");
    const redirectUri = oauthCallbackUrl("google");

    const state = signOAuthState({
      userId,
      storeId: store.id,
      provider: "google_ads",
      nonce: crypto.randomUUID(),
    });

    const { upsertPendingConnection } = await import("@/lib/connectors/connection-writes.server");
    await upsertPendingConnection(supabase as never, store.id, "google_ads", "");

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

    const customers = (conn.metadata as { customers?: string[] })?.customers ?? [];
    if (!customers.includes(data.customerId)) throw new Error("Compte Google Ads introuvable");

    const { updateConnectionById } = await import("@/lib/connectors/connection-writes.server");
    await updateConnectionById(supabase as never, data.storeId, conn.id, {
      account_id: data.customerId,
      account_label: formatCustomerId(data.customerId),
    });
    return { ok: true };
  });

export function formatCustomerId(id: string): string {
  const digits = id.replace(/\D/g, "");
  if (digits.length !== 10) return id;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}
