import { createFileRoute } from "@tanstack/react-router";

/**
 * Réception des webhooks Stripe : c'est ici, et nulle part ailleurs, qu'un
 * abonnement devient actif ou cesse de l'être.
 *
 * POURQUOI PAS AU RETOUR DE PAIEMENT. Le marchand est redirigé vers notre
 * `success_url` après avoir payé — et c'est tentant d'accorder le plan à ce
 * moment-là. Ce serait faux pour deux raisons, chacune suffisante :
 *   · il peut fermer l'onglet avant la redirection. Il a payé, il n'a rien ;
 *   · cette URL est une adresse ordinaire que n'importe qui peut ouvrir. Y
 *     accorder un plan payant reviendrait à le donner à qui la devine.
 * Le webhook est signé et vient de Stripe : c'est la seule source qui prouve
 * un paiement.
 *
 * ACQUITTER LARGEMENT. Un webhook non acquitté est rejoué pendant des jours,
 * puis l'abonnement au flux est désactivé — et nous cesserions de recevoir les
 * résiliations. On répond donc 200 à tout ce qui est authentiquement signé, y
 * compris aux types qu'on ne traite pas. Seule une signature invalide vaut un
 * refus.
 */
export const Route = createFileRoute("/api/public/webhooks/stripe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!secret) {
          console.error("[Stripe] STRIPE_WEBHOOK_SECRET absent, webhook refusé.");
          // 503 et non 200 : sans secret nous ne pouvons rien vérifier, et
          // acquitter ferait perdre l'événement définitivement. Stripe
          // réessaiera, et l'événement sera traité une fois le secret posé.
          return new Response("Configuration serveur incomplète", { status: 503 });
        }

        // Le corps brut D'ABORD. Le relire après une analyse JSON invaliderait
        // la signature — même piège que pour les webhooks Shopify.
        const rawBody = await request.text();

        const { verifyStripeWebhook } = await import("@/lib/stripe.server");
        const evenement = verifyStripeWebhook(
          rawBody,
          request.headers.get("stripe-signature"),
          secret,
        );
        if (!evenement) {
          console.error("[Stripe] signature de webhook refusée.");
          return new Response("Signature invalide", { status: 401 });
        }

        const { effetDeLEvenement } = await import("@/lib/abonnement-evenements");
        const effet = effetDeLEvenement(evenement);
        if (!effet) {
          // Type non traité, ou événement sans titulaire : acquitté sans rien
          // changer. Voir le bloc de tête pour la raison du 200.
          return new Response(null, { status: 200 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        /*
          L'ÉCRITURE NE PEUT PAS PASSER PAR LE CLIENT DE L'UTILISATEUR : il n'y
          a pas d'utilisateur ici, seulement Stripe. `subscriptions` n'accorde
          d'ailleurs que le SELECT au navigateur — décider de son propre plan
          depuis le client serait le donner à qui le demande.

          `onConflict: "user_id"` parce que la colonne est UNIQUE : un même
          compte n'a qu'un abonnement, et un renouvellement met à jour la ligne
          au lieu d'en empiler une seconde.
        */
        const { error } = await supabaseAdmin.from("subscriptions").upsert(
          {
            user_id: effet.userId,
            tier: effet.tier,
            status: effet.status,
            provider: "stripe",
            provider_customer_id: effet.customerId,
            provider_subscription_id: effet.subscriptionId,
            current_period_end: effet.currentPeriodEnd,
          },
          { onConflict: "user_id" },
        );

        if (error) {
          // `error` est une PostgrestError : un objet nu, pas une `Error`.
          console.error("[Stripe] abonnement non enregistré :", error);
          // 500 pour que Stripe REJOUE. Acquitter ici perdrait le paiement :
          // le marchand aurait payé sans jamais recevoir son plan.
          return new Response("Enregistrement impossible", { status: 500 });
        }

        console.log(`[Stripe] ${evenement.type} appliqué : plan ${effet.tier} (${effet.status}).`);
        return new Response(null, { status: 200 });
      },
    },
  },
});
