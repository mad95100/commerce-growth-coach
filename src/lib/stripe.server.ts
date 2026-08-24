import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Accès à Stripe : ouverture d'un paiement, portail client, vérification des
 * webhooks.
 *
 * POURQUOI PAS LE SDK STRIPE. Trois raisons, dans cet ordre :
 *   1. tous les autres partenaires de ce dépôt — Shopify, Meta, Google — sont
 *      appelés par `fetch` direct. Une quatrième intégration qui ferait
 *      autrement obligerait à connaître deux mécaniques ;
 *   2. le SDK officiel vise Node ; ce produit tourne sur Cloudflare Workers,
 *      où chaque dépendance qui suppose un runtime Node est une panne possible
 *      au déploiement — le CLI Supabase installé par npm nous a déjà cassé la
 *      production pour cette exact raison ;
 *   3. nous n'utilisons que trois points d'entrée. Le SDK en apporterait deux
 *      cents.
 *
 * CE MODULE NE DÉCIDE JAMAIS D'UN DROIT. Il parle à Stripe et vérifie des
 * signatures ; c'est `billing.server.ts` qui accorde ou refuse un plan, à
 * partir de la table `subscriptions`. Un webhook reçu n'accorde rien par
 * lui-même : il écrit une ligne, et le droit se relit ensuite.
 */

const API = "https://api.stripe.com/v1";

/**
 * Tolérance sur l'horodatage d'un webhook, en secondes.
 *
 * SANS ELLE, LA SIGNATURE NE PROTÈGE PLUS DE GRAND-CHOSE. Un webhook signé
 * reste valide pour toujours : quiconque en capture un peut le rejouer
 * indéfiniment — par exemple celui qui accorde l'abonnement, juste après
 * l'avoir annulé. C'est la valeur recommandée par Stripe.
 */
const TOLERANCE_SECONDES = 300;

/** Clé secrète Stripe, ou `null`. Jamais journalisée, jamais rendue à l'écran. */
function secretKey(): string | null {
  return process.env.STRIPE_SECRET_KEY || null;
}

/**
 * Appel à l'API Stripe.
 *
 * Stripe attend du `application/x-www-form-urlencoded`, y compris pour les
 * structures imbriquées, qui s'écrivent `a[b]=c`. On ne construit donc pas de
 * JSON.
 */
async function stripePost<T>(chemin: string, corps: Record<string, string>): Promise<T> {
  const cle = secretKey();
  if (!cle) {
    // LE NOM DU SECRET VA AU JOURNAL, PAS AU MARCHAND. Il n'y a aucun accès et
    // rien à corriger de son côté : lui montrer ce nom l'enverrait chercher une
    // chose qui n'existe pas pour lui.
    console.error("[Stripe] STRIPE_SECRET_KEY absente des secrets du worker.");
    throw new Error(
      "Le paiement n'est pas encore ouvert sur ce produit. Rien à faire de votre côté : il nous reste à le brancher. Votre compte et vos diagnostics ne sont pas affectés.",
    );
  }

  const res = await fetch(`${API}${chemin}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cle}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(corps).toString(),
  });

  if (!res.ok) {
    // Le corps de Stripe peut contenir l'identifiant du compte : il reste au
    // journal. Le marchand reçoit une phrase, jamais ce texte.
    const detail = await res.text();
    console.error(`[Stripe] ${chemin} a répondu ${res.status} : ${detail}`);
    throw new Error(
      "La page de paiement n'a pas pu être ouverte. Le problème vient de chez nous, pas de votre moyen de paiement — rien ne vous a été facturé, réessayez dans un instant.",
    );
  }

  return (await res.json()) as T;
}

/**
 * Ouvre une session de paiement et rend l'adresse où envoyer le marchand.
 *
 * `clientReferenceId` porte notre identifiant d'utilisateur : c'est lui qui
 * permet, au retour du webhook, de savoir QUI vient de payer. Sans lui, un
 * paiement réussi n'a plus de titulaire — Stripe ne connaît que son propre
 * client, pas notre compte.
 */
export async function createCheckoutSession(input: {
  userId: string;
  email: string | null;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string }> {
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    console.error("[Stripe] STRIPE_PRICE_ID absent des secrets du worker.");
    throw new Error(
      "Le paiement n'est pas encore ouvert sur ce produit. Rien à faire de votre côté : il nous reste à le brancher. Votre compte et vos diagnostics ne sont pas affectés.",
    );
  }

  const corps: Record<string, string> = {
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.userId,
    // Rattache l'abonnement à notre utilisateur DANS Stripe aussi : un webhook
    // ultérieur (renouvellement, annulation) ne porte pas
    // `client_reference_id`, seulement l'abonnement.
    "subscription_data[metadata][user_id]": input.userId,
    "metadata[user_id]": input.userId,
  };
  if (input.email) corps.customer_email = input.email;

  const session = await stripePost<{ url?: string }>("/checkout/sessions", corps);
  if (!session.url) {
    console.error("[Stripe] session de paiement créée sans URL exploitable.");
    throw new Error(
      "La page de paiement n'a pas pu être ouverte. Le problème vient de chez nous — rien ne vous a été facturé, réessayez dans un instant.",
    );
  }
  return { url: session.url };
}

/**
 * Ouvre le portail Stripe, où le marchand gère lui-même son abonnement.
 *
 * POURQUOI LE PORTAIL ET PAS UN ÉCRAN À NOUS. Résilier doit être aussi simple
 * que souscrire — c'est une obligation, et c'est aussi la seule façon honnête
 * de vendre un abonnement. Le portail de Stripe le fait déjà, avec le moyen de
 * paiement et l'historique des factures ; le refaire ici serait moins fiable
 * pour un marchand qui veut partir.
 */
export async function createPortalSession(input: {
  customerId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  const session = await stripePost<{ url?: string }>("/billing_portal/sessions", {
    customer: input.customerId,
    return_url: input.returnUrl,
  });
  if (!session.url) {
    console.error("[Stripe] session de portail créée sans URL exploitable.");
    throw new Error(
      "L'espace de gestion de votre abonnement n'a pas pu être ouvert. Votre abonnement n'est pas affecté — réessayez dans un instant.",
    );
  }
  return { url: session.url };
}

/**
 * Vérifie la signature d'un webhook Stripe et rend l'événement.
 *
 * LE CORPS DOIT ÊTRE CELUI QUI EST ARRIVÉ. Analyser le JSON puis le
 * re-sérialiser change l'espacement et l'ordre des clés : la signature ne
 * correspondrait plus jamais. C'est le même piège que pour les webhooks
 * Shopify, et il est documenté au même endroit.
 *
 * L'en-tête a la forme `t=1699999999,v1=<hex>,v1=<hex>` — plusieurs `v1`
 * pendant une rotation de secret. Une seule correspondance suffit.
 *
 * Rend `null` sur tout échec, sans distinguer les causes : un appelant qui
 * saurait POURQUOI une signature est refusée aiderait à en forger une.
 */
export function verifyStripeWebhook(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  now: Date = new Date(),
): { type: string; data: { object: Record<string, unknown> } } | null {
  if (!secret || !signatureHeader) return null;

  let horodatage: string | null = null;
  const signatures: string[] = [];
  for (const partie of signatureHeader.split(",")) {
    const [cle, valeur] = partie.split("=", 2);
    if (!cle || !valeur) continue;
    if (cle.trim() === "t") horodatage = valeur.trim();
    else if (cle.trim() === "v1") signatures.push(valeur.trim());
  }
  if (!horodatage || signatures.length === 0) return null;

  // REJEU. Un webhook signé il y a trois jours reste parfaitement signé.
  const emis = Number(horodatage);
  if (!Number.isFinite(emis)) return null;
  const ecart = Math.abs(Math.floor(now.getTime() / 1000) - emis);
  if (ecart > TOLERANCE_SECONDES) return null;

  const attendu = createHmac("sha256", secret).update(`${horodatage}.${rawBody}`, "utf8").digest();

  const correspond = signatures.some((recu) => {
    if (!/^[0-9a-f]{64}$/i.test(recu)) return false;
    const brut = Buffer.from(recu, "hex");
    if (brut.length !== attendu.length) return false;
    return timingSafeEqual(brut, attendu);
  });
  if (!correspond) return null;

  try {
    const evenement = JSON.parse(rawBody) as {
      type?: unknown;
      data?: { object?: unknown };
    };
    if (typeof evenement.type !== "string") return null;
    const objet = evenement.data?.object;
    if (!objet || typeof objet !== "object") return null;
    return { type: evenement.type, data: { object: objet as Record<string, unknown> } };
  } catch {
    return null;
  }
}
