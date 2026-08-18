import { createFileRoute } from "@tanstack/react-router";
import { errorBody, page, successBody } from "@/lib/oauth-page.server";

const GOOGLE_ADS_VERSION = "v18";

/** Toutes les pages de ce retour portent le même titre d'onglet. */
const htmlResponse = (body: string, status = 200, redirectTo?: string) =>
  page("Connexion Google Ads", body, status, redirectTo);

/** Callback OAuth Google Ads : stocke le refresh token chiffré + les comptes accessibles. */
export const Route = createFileRoute("/api/public/oauth/google/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const oauthError = url.searchParams.get("error");

        if (oauthError) {
          return htmlResponse(
            errorBody(
              "Autorisation Google refusée",
              `Google n'a pas accordé l'accès : ${oauthError}. Rien n'a été enregistré. Si vous avez refusé par erreur, relancez la connexion depuis l'application.`,
            ),
            400,
          );
        }
        if (!code || !state) {
          return htmlResponse(
            errorBody(
              "Réponse Google incomplète",
              "Google n'a pas renvoyé les paramètres attendus. Rien n'a été enregistré. Relancez la connexion depuis l'application.",
            ),
            400,
          );
        }

        /** L'enregistrement a-t-il été TENTÉ ? Voir le `catch` général, en bas. */
        let écritureTentée = false;

        try {
          const { verifyOAuthState, encryptToken } = await import("@/lib/crypto.server");
          // Une demande de connexion ne vaut que quinze minutes, et le marchand
          // qui choisit un compte Google les dépasse souvent. Ce n'est pas une
          // panne, et « État OAuth expiré » ne le lui dit pas.
          let payload: { userId: string; storeId: string; provider: string };
          try {
            payload = verifyOAuthState<{ userId: string; storeId: string; provider: string }>(
              state,
            );
          } catch (stateErr) {
            const raison = stateErr instanceof Error ? stateErr.message : String(stateErr);
            console.error("[Google OAuth] état invalide :", raison);
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

          if (payload.provider !== "google_ads") {
            return htmlResponse(
              errorBody(
                "Session de connexion invalide",
                "La demande ne correspond pas au service attendu. Rien n'a été enregistré. Relancez la connexion depuis l'application.",
              ),
              400,
            );
          }

          const clientId = process.env.GOOGLE_CLIENT_ID;
          const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
          const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
          if (!clientId || !clientSecret) {
            // Le nom de la variable va au journal, pas à la page : le marchand
            // n'a aucun accès aux secrets du serveur.
            console.error(
              "[Google OAuth] GOOGLE_CLIENT_ID ou GOOGLE_CLIENT_SECRET absent des secrets.",
            );
            return htmlResponse(
              errorBody(
                "Connexion Google indisponible",
                "Le raccordement à Google n'est pas complet de notre côté : nous ne pouvons pas terminer l'autorisation pour l'instant. Rien n'a été enregistré. Réessayez plus tard — la correction ne dépend que de nous.",
              ),
              500,
            );
          }

          // Doit être STRICTEMENT identique au redirect_uri de l'autorisation.
          const { oauthCallbackUrl } = await import("@/lib/public-origin.server");
          const redirectUri = oauthCallbackUrl("google");

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
          if (!tokenRes.ok) {
            // La réponse brute du fournisseur va au journal, pas dans la page :
            // elle n'apprenait rien au marchand, et c'était l'un des chemins par
            // lesquels du texte non échappé arrivait dans le document.
            console.error(
              `[Google OAuth] échange du code échoué ${tokenRes.status}: ${await tokenRes.text()}`,
            );
            return htmlResponse(
              errorBody(
                "Google a refusé la connexion",
                `Google n'a pas accepté de finaliser l'autorisation (erreur ${tokenRes.status}). Rien n'a été enregistré. Relancez la connexion depuis l'application ; si le refus persiste, la cause est de notre côté et nous en avons la trace.`,
              ),
              502,
            );
          }
          const tokenJson = (await tokenRes.json()) as {
            access_token: string;
            refresh_token?: string;
            expires_in: number;
            scope: string;
          };

          if (!tokenJson.refresh_token) {
            // Ici, à la différence des autres pages, l'action DEMANDÉE est bien
            // réalisable par le marchand : c'est dans SON compte Google, et il
            // n'y a pas d'autre issue — Google ne renvoie de jeton de
            // rafraîchissement qu'à la première autorisation.
            return htmlResponse(
              errorBody(
                "Accès Google incomplet",
                "Google ne nous a pas donné l'autorisation durable dont nous avons besoin : cela arrive quand l'application était déjà autorisée sur votre compte. Rien n'a été enregistré. Dans votre compte Google, section « Applications ayant accès à votre compte », retirez l'accès d'EcomPilot, puis relancez la connexion depuis l'application.",
              ),
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
          // À partir d'ici, une panne ne permet plus d'affirmer que rien n'a été
          // écrit : une coupure pendant l'envoi laisse l'issue inconnue.
          écritureTentée = true;
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
          // `error` est une PostgrestError : un objet SIMPLE, pas une `Error`.
          // Relancée, elle atteignait le `catch` du bas, qui faisait
          // `String(err)` — et rendait « [object Object] » au marchand.
          if (error) {
            console.error("[Google OAuth] enregistrement de la connexion impossible :", error);
            return htmlResponse(
              errorBody(
                "Autorisation reçue, mais pas enregistrée",
                "Google a bien accordé l'accès, mais nous n'avons pas pu l'enregistrer de notre côté. La connexion n'est donc PAS active chez nous, et l'application vous redemandera de la brancher : c'est normal, ce n'est pas une erreur de votre part. Relancez la connexion depuis l'application dans quelques minutes.",
              ),
              500,
            );
          }

          return htmlResponse(
            successBody(
              "Google Ads connecté !",
              // L'identifiant vient de Google, et `formatCustomerId` le rend tel
              // quel s'il n'a pas la forme attendue : c'est donc du texte que
              // nous ne contrôlons pas, et il entre par une fonction qui
              // l'échappe.
              primary
                ? `Compte relié : ${formatCustomerId(primary)}. Nous vous ramenons à l'application…`
                : "Aucun compte Google Ads n'a été trouvé sur cet accès. La connexion est enregistrée, mais elle n'apportera aucune donnée tant qu'un compte ne lui est pas rattaché.",
              payload.storeId,
            ),
            200,
            `/stores/${payload.storeId}`,
          );
        } catch (err) {
          // Chaque cause identifiable a sa sortie au-dessus. Ce qui arrive ici
          // n'a pas été prévu : on ne peut rien en dire de précis, et il vaut
          // mieux l'admettre que le déguiser en message de fournisseur.
          console.error("[Google OAuth] échec du callback :", err);
          return htmlResponse(
            errorBody(
              "Connexion Google interrompue",
              écritureTentée
                ? "Quelque chose s'est arrêté au moment précis où nous enregistrions l'accès. Nous ne savons donc pas si la connexion a été prise en compte. Revenez à l'application et regardez votre boutique : si Google y apparaît comme connecté, il n'y a rien à refaire ; sinon, relancez la connexion."
                : "Quelque chose s'est arrêté en chemin, et nous n'avons pas su quoi. Ce que nous pouvons affirmer : rien n'a été enregistré. Relancez la connexion depuis l'application. Si cela se reproduit, la panne est de notre côté et nous en avons la trace.",
            ),
            500,
          );
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
