import { createFileRoute } from "@tanstack/react-router";

/**
 * Réception des webhooks Shopify.
 *
 * ÉTAT : socle en place, aucun sujet abonné. Shopify n'envoie rien tant que les
 * abonnements ne sont pas déclarés — cette route peut donc être déployée sans
 * aucun effet sur la production, ce qui est exactement le but : la migration
 * d'infrastructure ne doit pas attendre le chantier produit qui exploitera ces
 * événements.
 *
 * CE QUI EST DÉJÀ GARANTI ICI, et qui est la partie délicate :
 *   - la signature est vérifiée sur le corps BRUT, avant toute analyse ;
 *   - un sujet inconnu est acquitté au lieu d'être rejeté — un webhook non
 *     acquitté est réessayé par Shopify pendant 48 h, puis l'abonnement est
 *     supprimé ; répondre 4xx à un sujet qu'on n'a pas encore implémenté
 *     casserait donc les abonnements des autres ;
 *   - la réponse est immédiate. Shopify impose 5 secondes : tout traitement
 *     long devra passer par la file d'audits, jamais être fait ici.
 *
 * SUJETS À BRANCHER dans le chantier produit :
 *   - `app/uninstalled` — marquer la connexion inactive, cesser d'appeler l'API
 *     avec un jeton révoqué ;
 *   - `shop/redact`, `customers/redact`, `customers/data_request` — OBLIGATOIRES
 *     pour publier sur l'App Store Shopify ;
 *   - `orders/create`, `orders/paid` — alimenter les instantanés en continu au
 *     lieu de tout recalculer à chaque audit.
 */
export const Route = createFileRoute("/api/public/webhooks/shopify/$topic")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const secret = process.env.SHOPIFY_CLIENT_SECRET;
        if (!secret) {
          console.error("[webhook] SHOPIFY_CLIENT_SECRET absent, webhook refusé");
          return new Response("Configuration serveur incomplète", { status: 503 });
        }

        // Le corps brut d'abord, sans exception : le relire après une analyse
        // JSON invaliderait la signature.
        const rawBody = await request.text();

        const { verifyShopifyWebhook } = await import("@/lib/shopify-hmac.server");
        if (!verifyShopifyWebhook(rawBody, request.headers.get("x-shopify-hmac-sha256"), secret)) {
          return new Response("Signature invalide", { status: 401 });
        }

        const topic = request.headers.get("x-shopify-topic") ?? params.topic;
        const shop = request.headers.get("x-shopify-shop-domain");

        // Journalisé et acquitté. Voir le bloc de tête pour la raison du 200.
        console.log(`[webhook] ${topic} reçu de ${shop ?? "boutique inconnue"} — aucun abonné`);
        return new Response(null, { status: 200 });
      },
    },
  },
});
