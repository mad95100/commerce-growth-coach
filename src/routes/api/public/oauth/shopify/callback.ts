import { createFileRoute } from "@tanstack/react-router";

/**
 * Callback OAuth Shopify.
 * Shopify redirige l'utilisateur ici avec `code`, `shop`, `state` (et `hmac`).
 * On échange le code contre un access_token, on le chiffre, on l'enregistre.
 */
export const Route = createFileRoute("/api/public/oauth/shopify/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const shop = url.searchParams.get("shop");
        const state = url.searchParams.get("state");

        if (!code || !shop || !state) {
          return htmlResponse("Paramètres OAuth manquants.", 400);
        }

        try {
          const { verifyOAuthState, encryptToken } = await import("@/lib/crypto.server");
          const payload = verifyOAuthState<{
            userId: string;
            storeId: string;
            provider: string;
            shop: string;
          }>(state);

          if (payload.provider !== "shopify" || payload.shop !== shop.toLowerCase()) {
            return htmlResponse("État OAuth ne correspond pas.", 400);
          }

          const clientId = process.env.SHOPIFY_CLIENT_ID;
          const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
          if (!clientId || !clientSecret) {
            return htmlResponse("Shopify OAuth non configuré côté serveur.", 500);
          }

          const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              client_id: clientId,
              client_secret: clientSecret,
              code,
            }),
          });
          if (!tokenRes.ok) {
            const errText = await tokenRes.text();
            return htmlResponse(`Échange du code échoué (${tokenRes.status}): ${errText}`, 502);
          }
          const tokenJson = (await tokenRes.json()) as { access_token: string; scope: string };

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await supabaseAdmin
            .from("data_connections")
            .upsert(
              {
                store_id: payload.storeId,
                provider: "shopify",
                status: "active",
                access_token_ciphertext: encryptToken(tokenJson.access_token),
                account_id: shop,
                account_label: shop,
                scope: tokenJson.scope,
                connected_at: new Date().toISOString(),
                last_error: null,
              },
              { onConflict: "store_id,provider" },
            );
          if (error) throw error;

          return htmlResponse(
            `<h1>Shopify connecté !</h1><p>Tu peux fermer cette fenêtre et relancer un audit.</p><script>setTimeout(()=>{window.location.href="/stores/${payload.storeId}"},1500)</script>`,
            200,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return htmlResponse(`Erreur OAuth : ${msg}`, 500);
        }
      },
    },
  },
});

function htmlResponse(body: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Connexion Shopify</title><style>body{font-family:system-ui,sans-serif;max-width:520px;margin:80px auto;padding:24px;background:#0B0F1E;color:#f8fafc;border-radius:16px}h1{color:#22c55e}</style></head><body>${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
