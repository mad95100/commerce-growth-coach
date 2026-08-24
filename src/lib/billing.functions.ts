import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Ouverture du paiement et du portail d'abonnement.
 *
 * CES DEUX FONCTIONS NE DÉCIDENT D'AUCUN DROIT. Elles ouvrent une page chez
 * Stripe et rendent son adresse. Le plan ne devient actif que lorsque le
 * webhook signé arrive — voir `api/public/webhooks/stripe`. Un utilisateur qui
 * appellerait celle-ci en boucle n'obtiendrait rien d'autre que des pages de
 * paiement.
 */

/** Adresse publique de l'application, la même que pour les retours OAuth. */
async function origine(): Promise<string> {
  const { publicOrigin } = await import("@/lib/public-origin.server");
  return publicOrigin();
}

/**
 * Ouvre une page de paiement pour l'abonnement mensuel.
 *
 * DÉJÀ ABONNÉ : ON N'OUVRE PAS UN SECOND PAIEMENT. Sans ce contrôle, un
 * marchand qui reclique depuis un onglet resté ouvert souscrirait DEUX fois et
 * serait prélevé deux fois — l'erreur la plus coûteuse que puisse faire un
 * écran de facturation, et celle qu'on ne peut pas rattraper sans rembourser.
 * Il est renvoyé vers son portail, où il gère l'abonnement qu'il a déjà.
 */
export const startCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ url: string; kind: "checkout" | "portal" }> => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: abonnement } = await supabaseAdmin
      .from("subscriptions")
      .select("tier, status, provider_customer_id")
      .eq("user_id", userId)
      .maybeSingle();

    const { effectiveTier } = await import("@/lib/plans");
    const dejaAbonne =
      effectiveTier(abonnement as { tier?: string | null; status?: string | null } | null) ===
      "pro";

    const base = await origine();

    if (dejaAbonne) {
      const client = (abonnement as { provider_customer_id?: string | null } | null)
        ?.provider_customer_id;
      if (client) {
        const { createPortalSession } = await import("@/lib/stripe.server");
        const { url } = await createPortalSession({
          customerId: client,
          returnUrl: `${base}/settings`,
        });
        return { url, kind: "portal" };
      }
      // Abonné mais sans client Stripe connu : cas anormal, et le renvoyer
      // payer une seconde fois serait la pire réponse possible.
      console.error(`[Stripe] abonnement actif sans provider_customer_id (user ${userId}).`);
      throw new Error(
        "Votre abonnement est déjà actif, mais son espace de gestion n'a pas pu être ouvert. Rien ne vous a été prélevé de nouveau — écrivez-nous et nous le débloquons.",
      );
    }

    // L'adresse e-mail évite au marchand de la retaper, et rattache la facture
    // au bon compte chez Stripe.
    const { data: utilisateur } = await supabaseAdmin.auth.admin.getUserById(userId);

    const { createCheckoutSession } = await import("@/lib/stripe.server");
    const { url } = await createCheckoutSession({
      userId,
      email: utilisateur?.user?.email ?? null,
      // Le retour ne donne aucun droit : il annonce seulement que le paiement
      // a été fait, et l'écran relit le plan réel.
      successUrl: `${base}/settings?paiement=reussi`,
      cancelUrl: `${base}/settings?paiement=annule`,
    });
    return { url, kind: "checkout" };
  });

/**
 * Ouvre le portail Stripe pour un abonné : moyen de paiement, factures,
 * résiliation.
 */
export const openBillingPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ url: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("subscriptions")
      .select("provider_customer_id")
      .eq("user_id", context.userId)
      .maybeSingle();

    const client = (data as { provider_customer_id?: string | null } | null)?.provider_customer_id;
    if (!client) {
      throw new Error(
        "Vous n'avez pas encore d'abonnement à gérer. Votre plan gratuit reste actif, sans limite de durée.",
      );
    }

    const { createPortalSession } = await import("@/lib/stripe.server");
    const base = await origine();
    return createPortalSession({ customerId: client, returnUrl: `${base}/settings` });
  });
