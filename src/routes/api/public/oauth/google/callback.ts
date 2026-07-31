import { createFileRoute } from "@tanstack/react-router";

const GOOGLE_ADS_VERSION = "v18";

/** Callback OAuth Google Ads : stocke le refresh token chiffré + les comptes accessibles. */
export const Route = createFileRoute("/api/public/oauth/google/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const oauthError = url.searchParams.get("error");

        if (oauthError) return htmlResponse(`Autorisation refusée : ${oauthError}`, 400);
        if (!code || !state) return htmlResponse("Paramètres OAuth manquants.", 400);

        try {
          const { verifyOAuthState, encryptToken } = await import("@/lib/crypto.server");
          const payload = verifyOAuthState<{ userId: string; storeId: string; provider: string }>(state);
          if (payload.provider !== "google_ads") return htmlResponse("État OAuth ne correspond pas.", 400);

          const clientId = process.env.GOOGLE_CLIENT_ID;
          const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
          const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
          if (!clientId || !clientSecret) return htmlResponse("Google OAuth non configuré côté serveur.", 500);

          const redirectUri = `${url.origin}/api/public/oauth/google/callback`;

          const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              code,
              client_id: clientId,
              client_secret: clientSecret,
              redirect_uri: redirectUri,
              grant_type: "authorization_code",
            }).toString(),
          });
          if (!tokenRes.ok) return htmlResponse(`Échange du code échoué : ${await tokenRes.text()}`, 502);
          const tokenJson = (await tokenRes.json()) as {
            access_token: string;
            refresh_token?: string;
            expires_in: number;
            scope: string;
          };

          if (!tokenJson.refresh_token) {
            return htmlResponse(
              "Google n'a pas renvoyé de refresh token. Retire l'accès de l'app dans ton compte Google puis reconnecte.",
              400,
            );
          }

          let customers: string[] = [];
          if (developerToken) {
            const listRes = await fetch(
              `https://googleads.googleapis.com/${GOOGLE_ADS_VERSION}/customers:listAccessibleCustomers`,
              {
                headers: {
                  Authorization: `Bearer ${tokenJson.access_token}`,
                  "developer-token": developerToken,
                },
              },
            );
            if (listRes.ok) {
              const listJson = (await listRes.json()) as { resourceNames?: string[] };
              customers = (listJson.resourceNames ?? []).map((r) => r.split("/")[1]);
            }
          }

          const primary = customers[0] ?? null;

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await supabaseAdmin.from("data_connections").upsert(
            {
              store_id: payload.storeId,
              provider: "google_ads",
              status: "active",
              access_token_ciphertext: encryptToken(tokenJson.access_token),
              refresh_token_ciphertext: encryptToken(tokenJson.refresh_token),
              account_id: primary,
              account_label: primary ? formatCustomerId(primary) : null,
              scope: tokenJson.scope,
              metadata: { customers },
              expires_at: new Date(Date.now() + tokenJson.expires_in * 1000).toISOString(),
              connected_at: new Date().toISOString(),
              last_error: developerToken ? null : "GOOGLE_ADS_DEVELOPER_TOKEN manquant",
            },
            { onConflict: "store_id,provider" },
          );
          if (error) throw error;

          return htmlResponse(
            `<h1>Google Ads connecté !</h1><p>${
              primary ? `Compte : ${formatCustomerId(primary)}` : "Aucun compte Google Ads détecté."
            }</p><script>setTimeout(()=>{window.location.href="/stores/${payload.storeId}"},1500)</script>`,
          );
        } catch (err) {
          return htmlResponse(`Erreur OAuth : ${err instanceof Error ? err.message : String(err)}`, 500);
        }
      },
    },
  },
});

function formatCustomerId(id: string): string {
  const digits = id.replace(/\D/g, "");
  if (digits.length !== 10) return id;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function htmlResponse(body: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Connexion Google Ads</title><style>body{font-family:system-ui,sans-serif;max-width:520px;margin:80px auto;padding:24px;background:#0B0F1E;color:#f8fafc;border-radius:16px}h1{color:#22c55e}</style></head><body>${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
