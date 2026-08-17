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
        // Shopify renvoie `error` si l'utilisateur refuse ou si l'app est mal
        // configurée. Sans ce test, on affichait « Paramètres OAuth manquants »,
        // un message qui masquait la vraie cause.
        const oauthError =
          url.searchParams.get("error_description") || url.searchParams.get("error");

        if (oauthError) {
          return htmlResponse(errorBody("Autorisation Shopify refusée", oauthError), 400);
        }
        if (!code || !shop || !state) {
          return htmlResponse(
            errorBody(
              "Réponse Shopify incomplète",
              "Shopify n'a pas renvoyé les paramètres attendus (code, shop, state). Relancez la connexion depuis votre boutique.",
            ),
            400,
          );
        }

        try {
          const clientId = process.env.SHOPIFY_CLIENT_ID;
          const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
          if (!clientId || !clientSecret) {
            return htmlResponse(
              errorBody(
                "Configuration serveur incomplète",
                "SHOPIFY_CLIENT_ID ou SHOPIFY_CLIENT_SECRET manque côté serveur.",
              ),
              500,
            );
          }

          // Contrôles exigés par Shopify, avant toute exploitation des paramètres.
          // Le `hmac` authentifie la requête entière ; il se vérifie donc en premier,
          // et sur la chaîne de requête d'origine, avant tout retrait de paramètre.
          const { verifyShopifyHmac, isValidShopHostname } =
            await import("@/lib/shopify-hmac.server");

          if (!verifyShopifyHmac(url.searchParams, clientSecret)) {
            return htmlResponse(
              errorBody(
                "Retour Shopify non authentifié",
                "La signature de la requête ne correspond pas. Relance la connexion depuis l'application ; si le problème persiste, vérifie que SHOPIFY_CLIENT_SECRET correspond bien à l'app Shopify utilisée.",
              ),
              401,
            );
          }

          // `shop` sert à construire les URL d'API : on s'assure que c'est bien un
          // nom d'hôte de boutique, et rien d'autre.
          if (!isValidShopHostname(shop)) {
            return htmlResponse(
              errorBody(
                "Boutique Shopify invalide",
                "Le domaine renvoyé par Shopify n'est pas un nom d'hôte de boutique valide.",
              ),
              400,
            );
          }

          const { verifyOAuthState, encryptToken } = await import("@/lib/crypto.server");
          const payload = verifyOAuthState<{
            userId: string;
            storeId: string;
            provider: string;
            shop: string;
          }>(state);

          if (payload.provider !== "shopify" || payload.shop !== shop.toLowerCase()) {
            return htmlResponse(
              errorBody(
                "Session de connexion invalide",
                "La demande ne correspond pas à la boutique attendue. Relance la connexion depuis l'application.",
              ),
              400,
            );
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
            console.error(`[Shopify OAuth] échange du code échoué ${tokenRes.status}: ${errText}`);
            return htmlResponse(
              errorBody(
                "Shopify a refusé la connexion",
                `Échange du code impossible (HTTP ${tokenRes.status}). Vérifie que l'URL de redirection déclarée dans l'app Shopify correspond exactement à celle de l'application.`,
              ),
              502,
            );
          }
          const tokenJson = (await tokenRes.json()) as { access_token: string; scope: string };

          // Premier appel avec le jeton neuf : il vérifie qu'il fonctionne et
          // relève les permissions réellement accordées. `tokenJson.scope` est
          // vide pour les apps à installation gérée, où les permissions
          // viennent de la configuration de l'app.
          //
          // Un échec ici n'annule pas la connexion — l'échange du code a
          // réussi, le jeton est valide. On l'enregistre et on consigne la
          // raison, plutôt que de renvoyer l'utilisateur à la case départ pour
          // un contrôle secondaire.
          const { fetchGrantedScopes } = await import("@/lib/connectors/shopify-apply.server");
          const { missingScopes } = await import("@/lib/connectors/shopify-scopes");

          let grantedScopes: string[] | null = null;
          let scopeWarning: string | null = null;
          try {
            grantedScopes = await fetchGrantedScopes(shop, tokenJson.access_token);
            const missing = missingScopes(grantedScopes);
            if (missing.length > 0) {
              scopeWarning = `Permissions manquantes : ${missing.join(", ")}. Les fonctionnalités qui en dépendent échoueront.`;
            }
          } catch (scopeErr) {
            const detail = scopeErr instanceof Error ? scopeErr.message : String(scopeErr);
            console.error("[Shopify OAuth] relevé des permissions impossible :", scopeErr);
            scopeWarning = `Permissions non vérifiables à la connexion : ${detail}`;
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await supabaseAdmin.from("data_connections").upsert(
            {
              store_id: payload.storeId,
              provider: "shopify",
              status: "active",
              access_token_ciphertext: encryptToken(tokenJson.access_token),
              account_id: shop,
              account_label: shop,
              // Les permissions relevées sur le jeton, et non le `scope` de la
              // réponse d'échange, qui peut être vide.
              scope: grantedScopes ? grantedScopes.join(",") : tokenJson.scope || null,
              connected_at: new Date().toISOString(),
              last_error: scopeWarning,
            },
            { onConflict: "store_id,provider" },
          );
          if (error) throw error;

          return htmlResponse(
            `<h1>Shopify connecté !</h1>` +
              (scopeWarning
                ? `<p>Votre boutique est reliée, avec une réserve : ${escapeHtml(scopeWarning)}</p>`
                : `<p>Votre boutique est reliée. Nous vous ramenons à l'application…</p>`) +
              `<p><a href="/stores/${payload.storeId}">Continuer maintenant</a></p>`,
            200,
            `/stores/${payload.storeId}`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[Shopify OAuth] échec du callback :", err);
          return htmlResponse(errorBody("Connexion Shopify interrompue", msg), 500);
        }
      },
    },
  },
});

/** Corps d'erreur : un titre, une cause lisible, et toujours un chemin de sortie. */
function errorBody(title: string, detail: string): string {
  return (
    `<h1 class="err">${escapeHtml(title)}</h1>` +
    `<p>${escapeHtml(detail)}</p>` +
    `<p><a href="/dashboard">Revenir à l'application</a></p>`
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Réponse HTML du callback.
 *
 * La redirection passe par un `<meta http-equiv="refresh">` doublé d'un lien
 * cliquable, et non plus par un script inline : si le script ne s'exécute pas
 * (CSP, extension), l'utilisateur reste bloqué sur une page qui semble vide.
 */
function htmlResponse(body: string, status = 200, redirectTo?: string) {
  const refresh = redirectTo ? `<meta http-equiv="refresh" content="2;url=${redirectTo}">` : "";
  return new Response(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8">${refresh}` +
      `<title>Connexion Shopify</title>` +
      `<style>body{font-family:system-ui,sans-serif;max-width:520px;margin:80px auto;padding:24px;background:#0B0F1E;color:#f8fafc;border-radius:16px}` +
      `h1{color:#22c55e}h1.err{color:#f97316}a{color:#06b6d4}</style></head><body>${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
