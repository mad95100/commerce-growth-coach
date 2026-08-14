import { createFileRoute } from "@tanstack/react-router";

const META_API_VERSION = "v21.0";

/** Callback OAuth Meta Ads : échange le code, stocke un token longue durée chiffré. */
export const Route = createFileRoute("/api/public/oauth/meta/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const oauthError =
          url.searchParams.get("error_description") || url.searchParams.get("error");

        if (oauthError) return htmlResponse(`Autorisation refusée : ${oauthError}`, 400);
        if (!code || !state) return htmlResponse("Paramètres OAuth manquants.", 400);

        try {
          const { verifyOAuthState, encryptToken } = await import("@/lib/crypto.server");
          const payload = verifyOAuthState<{ userId: string; storeId: string; provider: string }>(
            state,
          );
          if (payload.provider !== "meta_ads")
            return htmlResponse("État OAuth ne correspond pas.", 400);

          const clientId = process.env.META_CLIENT_ID;
          const clientSecret = process.env.META_CLIENT_SECRET;
          if (!clientId || !clientSecret)
            return htmlResponse("Meta OAuth non configuré côté serveur.", 500);

          // Doit être STRICTEMENT identique au redirect_uri de l'autorisation.
          const { oauthCallbackUrl } = await import("@/lib/public-origin.server");
          const redirectUri = oauthCallbackUrl("meta");

          const shortRes = await fetch(
            `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token?` +
              new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
                code,
              }).toString(),
          );
          if (!shortRes.ok)
            return htmlResponse(`Échange du code échoué : ${await shortRes.text()}`, 502);
          const shortJson = (await shortRes.json()) as { access_token: string };

          // Token longue durée (60 jours)
          const longRes = await fetch(
            `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token?` +
              new URLSearchParams({
                grant_type: "fb_exchange_token",
                client_id: clientId,
                client_secret: clientSecret,
                fb_exchange_token: shortJson.access_token,
              }).toString(),
          );
          const longJson = longRes.ok
            ? ((await longRes.json()) as { access_token: string; expires_in?: number })
            : { access_token: shortJson.access_token, expires_in: undefined };

          const token = longJson.access_token;

          const accountsRes = await fetch(
            `https://graph.facebook.com/${META_API_VERSION}/me/adaccounts?` +
              new URLSearchParams({
                fields: "id,name,currency,account_status",
                access_token: token,
              }).toString(),
          );
          const accounts = accountsRes.ok
            ? (
                (await accountsRes.json()) as {
                  data: { id: string; name: string; currency: string }[];
                }
              ).data
            : [];

          const primary = accounts[0];

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await supabaseAdmin.from("data_connections").upsert(
            {
              store_id: payload.storeId,
              provider: "meta_ads",
              status: "active",
              access_token_ciphertext: encryptToken(token),
              account_id: primary?.id ?? null,
              account_label: primary?.name ?? null,
              scope: "ads_management,ads_read,business_management",
              metadata: { accounts },
              expires_at: longJson.expires_in
                ? new Date(Date.now() + longJson.expires_in * 1000).toISOString()
                : null,
              connected_at: new Date().toISOString(),
              last_error: null,
            },
            { onConflict: "store_id,provider" },
          );
          if (error) throw error;

          return htmlResponse(
            `<h1>Meta Ads connecté !</h1><p>${
              primary ? `Compte : ${primary.name}` : "Aucun compte publicitaire trouvé."
            }</p><script>setTimeout(()=>{window.location.href="/stores/${payload.storeId}"},1500)</script>`,
          );
        } catch (err) {
          return htmlResponse(
            `Erreur OAuth : ${err instanceof Error ? err.message : String(err)}`,
            500,
          );
        }
      },
    },
  },
});

function htmlResponse(body: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Connexion Meta Ads</title><style>body{font-family:system-ui,sans-serif;max-width:520px;margin:80px auto;padding:24px;background:#0B0F1E;color:#f8fafc;border-radius:16px}h1{color:#22c55e}</style></head><body>${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
