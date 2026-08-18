import { createFileRoute } from "@tanstack/react-router";
import { errorBody, page, successBody } from "@/lib/oauth-page.server";

const META_API_VERSION = "v21.0";

/** Toutes les pages de ce retour portent le même titre d'onglet. */
const htmlResponse = (body: string, status = 200, redirectTo?: string) =>
  page("Connexion Meta Ads", body, status, redirectTo);

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

        if (oauthError) {
          return htmlResponse(
            errorBody(
              "Autorisation Meta refusée",
              `Meta n'a pas accordé l'accès : ${oauthError}. Rien n'a été enregistré. Si vous avez refusé par erreur, relancez la connexion depuis l'application.`,
            ),
            400,
          );
        }
        if (!code || !state) {
          return htmlResponse(
            errorBody(
              "Réponse Meta incomplète",
              "Meta n'a pas renvoyé les paramètres attendus. Rien n'a été enregistré. Relancez la connexion depuis l'application.",
            ),
            400,
          );
        }

        /** L'enregistrement a-t-il été TENTÉ ? Voir le `catch` général, en bas. */
        let écritureTentée = false;

        try {
          const { verifyOAuthState, encryptToken } = await import("@/lib/crypto.server");
          // Une demande de connexion ne vaut que quinze minutes, et le marchand
          // qui part chercher ses identifiants Meta les dépasse souvent. Ce
          // n'est pas une panne, et « État OAuth expiré » ne le lui dit pas.
          let payload: { userId: string; storeId: string; provider: string };
          try {
            payload = verifyOAuthState<{ userId: string; storeId: string; provider: string }>(
              state,
            );
          } catch (stateErr) {
            const raison = stateErr instanceof Error ? stateErr.message : String(stateErr);
            console.error("[Meta OAuth] état invalide :", raison);
            const expiré = /expiré/i.test(raison);
            return htmlResponse(
              errorBody(
                expiré ? "La connexion a mis trop de temps" : "Demande de connexion non reconnue",
                expiré
                  ? "Une demande de connexion reste valable quinze minutes, et celle-ci les a dépassées. Rien n'a été enregistré. Relancez la connexion depuis l'application : cette fois elle aboutira."
                  : "Nous ne reconnaissons pas cette demande de connexion. Par précaution, rien n'a été enregistré. Relancez la connexion depuis l'application.",
              ),
              400,
            );
          }

          if (payload.provider !== "meta_ads") {
            return htmlResponse(
              errorBody(
                "Session de connexion invalide",
                "La demande ne correspond pas au service attendu. Rien n'a été enregistré. Relancez la connexion depuis l'application.",
              ),
              400,
            );
          }

          const clientId = process.env.META_CLIENT_ID;
          const clientSecret = process.env.META_CLIENT_SECRET;
          if (!clientId || !clientSecret) {
            // Le nom de la variable va au journal — c'est là qu'on le cherche.
            // La page est lue par le marchand, qui n'a aucun accès aux secrets
            // du serveur : lui en nommer un ne lui donne rien à faire, sinon
            // croire que la panne est sienne.
            console.error("[Meta OAuth] META_CLIENT_ID ou META_CLIENT_SECRET absent des secrets.");
            return htmlResponse(
              errorBody(
                "Connexion Meta indisponible",
                "Le raccordement à Meta n'est pas complet de notre côté : nous ne pouvons pas terminer l'autorisation pour l'instant. Rien n'a été enregistré. Réessayez plus tard — la correction ne dépend que de nous.",
              ),
              500,
            );
          }

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
          if (!shortRes.ok) {
            // LA RÉPONSE BRUTE DU FOURNISSEUR ALLAIT DANS LA PAGE. Elle n'y
            // apprenait rien au marchand, et c'était l'un des chemins par
            // lesquels du texte non échappé arrivait dans le document.
            console.error(
              `[Meta OAuth] échange du code échoué ${shortRes.status}: ${await shortRes.text()}`,
            );
            return htmlResponse(
              errorBody(
                "Meta a refusé la connexion",
                `Meta n'a pas accepté de finaliser l'autorisation (erreur ${shortRes.status}). Rien n'a été enregistré. Relancez la connexion depuis l'application ; si le refus persiste, la cause est de notre côté et nous en avons la trace.`,
              ),
              502,
            );
          }
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

          // PAS `accounts[0]`. Un compte désactivé placé en tête garantit un
          // diagnostic vide et une impression de produit cassé. Le premier
          // compte ACTIF est un meilleur défaut — et reste un défaut, que
          // l'écran des sources annonce comme tel au marchand.
          const { defaultAccount } = await import("@/lib/connectors/ad-accounts");
          const primary = defaultAccount(
            accounts.map((a) => ({
              id: a.id,
              name: a.name,
              currency: a.currency,
              status: (a as { account_status?: number }).account_status ?? null,
            })),
          );

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          // À partir d'ici, une panne ne permet plus d'affirmer que rien n'a été
          // écrit : une coupure pendant l'envoi laisse l'issue inconnue.
          écritureTentée = true;
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
          // `error` est une PostgrestError : un objet SIMPLE, pas une `Error`.
          // Relancée, elle atteignait le `catch` du bas, qui faisait
          // `String(err)` — et rendait « [object Object] » au marchand.
          if (error) {
            console.error("[Meta OAuth] enregistrement de la connexion impossible :", error);
            return htmlResponse(
              errorBody(
                "Autorisation reçue, mais pas enregistrée",
                "Meta a bien accordé l'accès, mais nous n'avons pas pu l'enregistrer de notre côté. La connexion n'est donc PAS active chez nous, et l'application vous redemandera de la brancher : c'est normal, ce n'est pas une erreur de votre part. Relancez la connexion depuis l'application dans quelques minutes.",
              ),
              500,
            );
          }

          return htmlResponse(
            successBody(
              "Meta Ads connecté !",
              // Le nom du compte vient de Meta : c'est du texte que nous ne
              // contrôlons pas, et il entre désormais par une fonction qui
              // l'échappe.
              primary
                ? `Compte relié : ${primary.name}. Nous vous ramenons à l'application…`
                : "Aucun compte publicitaire n'a été trouvé sur cet accès. La connexion est enregistrée, mais elle n'apportera aucune donnée tant qu'un compte ne lui est pas rattaché.",
              payload.storeId,
            ),
            200,
            `/stores/${payload.storeId}`,
          );
        } catch (err) {
          // Chaque cause identifiable a sa sortie au-dessus. Ce qui arrive ici
          // n'a pas été prévu : on ne peut rien en dire de précis, et il vaut
          // mieux l'admettre que le déguiser en message de fournisseur.
          console.error("[Meta OAuth] échec du callback :", err);
          return htmlResponse(
            errorBody(
              "Connexion Meta interrompue",
              écritureTentée
                ? "Quelque chose s'est arrêté au moment précis où nous enregistrions l'accès. Nous ne savons donc pas si la connexion a été prise en compte. Revenez à l'application et regardez votre boutique : si Meta y apparaît comme connecté, il n'y a rien à refaire ; sinon, relancez la connexion."
                : "Quelque chose s'est arrêté en chemin, et nous n'avons pas su quoi. Ce que nous pouvons affirmer : rien n'a été enregistré. Relancez la connexion depuis l'application. Si cela se reproduit, la panne est de notre côté et nous en avons la trace.",
            ),
            500,
          );
        }
      },
    },
  },
});
