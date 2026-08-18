import { createFileRoute } from "@tanstack/react-router";
import { errorBody, page, successBody } from "@/lib/oauth-page.server";

/** Toutes les pages de ce retour portent le même titre d'onglet. */
const htmlResponse = (body: string, status = 200, redirectTo?: string) =>
  page("Connexion Shopify", body, status, redirectTo);

/**
 * Callback OAuth Shopify.
 * Shopify redirige l'utilisateur ici avec `code`, `shop`, `state` (et `hmac`).
 * On échange le code contre un access_token, on le chiffre, on l'enregistre.
 *
 * Les pages rendues ici viennent de `@/lib/oauth-page.server`, partagé avec les
 * retours Meta et Google : ces trois fichiers avaient chacun leur copie, et les
 * corrections faites ici — échappement du HTML, lien de sortie sur chaque page,
 * redirection sans script — n'avaient jamais atteint les deux autres.
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

        /** L'enregistrement a-t-il été TENTÉ ? Voir le `catch` général, en bas. */
        let écritureTentée = false;

        try {
          const clientId = process.env.SHOPIFY_CLIENT_ID;
          const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
          if (!clientId || !clientSecret) {
            // Le nom de la variable va au journal — c'est là qu'on le cherche.
            // La page, elle, est lue par le marchand : lui nommer un secret de
            // serveur ne lui apprend rien qu'il puisse utiliser, et le laisse
            // croire qu'il a mal fait quelque chose au moment précis où il vient
            // de nous confier l'accès à sa boutique.
            console.error(
              "[Shopify OAuth] SHOPIFY_CLIENT_ID ou SHOPIFY_CLIENT_SECRET absent des secrets du worker.",
            );
            return htmlResponse(
              errorBody(
                "Connexion Shopify indisponible",
                "Le raccordement à Shopify n'est pas complet de notre côté : nous ne pouvons pas terminer l'autorisation pour l'instant. Rien n'a été enregistré et votre boutique n'a pas été modifiée. Réessayez plus tard — la correction ne dépend que de nous.",
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
            // LA CAUSE PROBABLE VA AU JOURNAL, PAS À LA PAGE. Cette page est lue
            // par le MARCHAND, et elle lui demandait de vérifier
            // `SHOPIFY_CLIENT_SECRET` — un secret de serveur auquel il n'a aucun
            // accès. Lui donner à faire ce qu'il ne peut pas faire est pire que
            // de ne rien lui donner : il croit la panne sienne et cherche.
            console.error(
              "[Shopify OAuth] signature invalide — vérifier que SHOPIFY_CLIENT_SECRET correspond à l'app Shopify utilisée.",
            );
            return htmlResponse(
              errorBody(
                "Retour Shopify non authentifié",
                "La signature de la requête ne correspond pas : nous ne pouvons pas garantir que ce retour vient bien de Shopify, donc nous n'enregistrons rien. Relancez la connexion depuis l'application. Si cela se reproduit, la panne est de notre côté et nous en avons la trace — inutile de chercher chez vous.",
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
          /*
            L'ÉTAT OAUTH EXPIRE AU BOUT DE QUINZE MINUTES, ET C'EST FRÉQUENT.

            `verifyOAuthState` lève « État OAuth expiré », « Signature OAuth
            invalide » ou « État OAuth invalide » — trois phrases écrites pour
            qui répare le code. Elles remontaient telles quelles jusqu'à la page
            que lit le marchand, via le `catch` général en bas de ce fichier.

            L'expiration est pourtant le cas le plus ORDINAIRE de tout ce
            fichier : le marchand ouvre la connexion, part créer son compte
            Shopify ou chercher son mot de passe, revient vingt minutes plus
            tard. Il n'a rien fait de mal, rien n'est cassé, et la conduite à
            tenir tient en une phrase — relancer. « État OAuth expiré » ne la
            lui dit pas.
          */
          let payload: { userId: string; storeId: string; provider: string; shop: string };
          try {
            payload = verifyOAuthState<{
              userId: string;
              storeId: string;
              provider: string;
              shop: string;
            }>(state);
          } catch (stateErr) {
            const raison = stateErr instanceof Error ? stateErr.message : String(stateErr);
            console.error("[Shopify OAuth] état invalide :", raison);
            const expiré = /expiré/i.test(raison);
            return htmlResponse(
              errorBody(
                expiré ? "La connexion a mis trop de temps" : "Demande de connexion non reconnue",
                expiré
                  ? "Une demande de connexion reste valable quinze minutes, et celle-ci les a dépassées. Rien n'a été enregistré et votre boutique n'a pas été modifiée. Relancez la connexion depuis l'application : cette fois elle aboutira."
                  : "Nous ne reconnaissons pas cette demande de connexion : elle ne vient pas d'une session ouverte chez nous, ou elle a été altérée en chemin. Par précaution, rien n'a été enregistré. Relancez la connexion depuis l'application.",
              ),
              400,
            );
          }

          if (payload.provider !== "shopify" || payload.shop !== shop.toLowerCase()) {
            return htmlResponse(
              errorBody(
                "Session de connexion invalide",
                "La demande ne correspond pas à la boutique attendue. Relancez la connexion depuis l'application.",
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
                // LA CONSIGNE PRÉCÉDENTE DEMANDAIT L'IMPOSSIBLE. Elle disait de
                // vérifier « l'URL de redirection déclarée dans l'app Shopify » :
                // c'est la configuration de NOTRE app, dans NOTRE compte
                // partenaire. Le marchand n'y a aucun accès, et la chercher ne
                // pouvait que le convaincre d'avoir mal fait quelque chose.
                `Shopify n'a pas accepté de finaliser l'autorisation (erreur ${tokenRes.status}). Rien n'a été enregistré et votre boutique n'a pas été modifiée. Relancez la connexion depuis l'application ; si le refus persiste, la cause est de notre côté et nous en avons la trace.`,
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
          // À partir d'ici, une panne ne permet plus d'affirmer que rien n'a été
          // écrit : une coupure réseau pendant l'envoi laisse l'issue inconnue.
          // Le filet du bas s'en sert pour ne promettre que ce qu'il sait.
          écritureTentée = true;
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
          /*
            L'ÉCHEC D'ENREGISTREMENT DISAIT « [object Object] ».

            `error` est une PostgrestError : un objet SIMPLE, pas une instance
            d'`Error`. Le `catch` général plus bas fait
            `err instanceof Error ? err.message : String(err)` — et `String()`
            d'un objet nu rend « [object Object] ». C'est littéralement ce que
            lisait le marchand, sur la page qui suit immédiatement son
            autorisation Shopify.

            CE MOMENT EST LE PIRE DE TOUT LE PARCOURS. L'échange du code a
            réussi : Shopify considère l'app installée et l'affichera comme
            telle. De notre côté, rien n'est enregistré. Le marchand se retrouve
            donc devant deux affirmations contraires — Shopify dit « relié »,
            nous disons « connectez votre boutique » — et c'est exactement la
            boucle qui a été signalée. Lui dire lequel des deux a raison, et
            quoi faire, est tout ce qui compte ici.
          */
          if (error) {
            console.error("[Shopify OAuth] enregistrement de la connexion impossible :", error);
            return htmlResponse(
              errorBody(
                "Autorisation reçue, mais pas enregistrée",
                "Shopify a bien accordé l'accès — la boutique apparaîtra peut-être comme reliée dans votre compte Shopify — mais nous n'avons pas pu l'enregistrer de notre côté. La connexion n'est donc PAS active chez nous, et l'application vous redemandera de la brancher : c'est normal, ce n'est pas une erreur de votre part. Relancez la connexion depuis l'application dans quelques minutes ; il n'y a rien à défaire chez Shopify entre-temps.",
              ),
              500,
            );
          }

          return htmlResponse(
            successBody(
              "Shopify connecté !",
              scopeWarning
                ? `Votre boutique est reliée, avec une réserve : ${scopeWarning}`
                : "Votre boutique est reliée. Nous vous ramenons à l'application…",
              payload.storeId,
            ),
            200,
            `/stores/${payload.storeId}`,
          );
        } catch (err) {
          /*
            LE FILET, ET CE QU'IL NE DOIT PLUS FAIRE.

            Il réémettait le message interne tel quel. Deux façons de mal
            tourner, l'une et l'autre constatées : un objet nu rendait
            « [object Object] », et une vraie `Error` rendait une phrase écrite
            pour le journal — utile à qui répare, illisible pour qui lit.

            Chaque cause identifiable a désormais sa propre sortie au-dessus.
            Ce qui arrive ici est, par construction, ce que nous n'avons pas
            prévu : on ne peut rien en dire de précis, et il vaut mieux
            l'admettre que le déguiser.

            RESTE À NE PAS PROMETTRE PLUS QUE CE QU'ON SAIT. « Rien n'a été
            enregistré » est vrai tant que l'écriture n'a pas commencé — et
            c'est le cas de la quasi-totalité de ce bloc. Mais une coupure
            PENDANT l'envoi laisse l'issue inconnue : la ligne peut être en
            base. Affirmer alors que rien n'a été fait serait exactement le
            genre de fausse certitude qu'on vient de retirer partout ailleurs.
            D'où le drapeau.
          */
          console.error("[Shopify OAuth] échec du callback :", err);
          return htmlResponse(
            errorBody(
              "Connexion Shopify interrompue",
              écritureTentée
                ? "Quelque chose s'est arrêté en chemin, au moment précis où nous enregistrions l'accès. Nous ne savons donc pas si la connexion a été prise en compte. Revenez à l'application et regardez votre boutique : si Shopify y apparaît comme connecté, tout est en ordre et il n'y a rien à refaire ; sinon, relancez la connexion. Dans les deux cas, votre boutique Shopify n'a pas été modifiée."
                : "Quelque chose s'est arrêté en chemin, et nous n'avons pas su quoi. Ce que nous pouvons affirmer : rien n'a été enregistré et votre boutique n'a pas été modifiée. Relancez la connexion depuis l'application. Si cela se reproduit, la panne est de notre côté et nous en avons la trace — inutile de chercher chez vous.",
            ),
            500,
          );
        }
      },
    },
  },
});
