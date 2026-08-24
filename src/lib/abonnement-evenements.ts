import { effectiveTier, type PlanTier } from "@/lib/plans";

/**
 * CE QU'UN ÉVÉNEMENT STRIPE CHANGE À L'ABONNEMENT — décidé ici, et nulle part
 * ailleurs.
 *
 * POURQUOI UN MODULE PUR. La règle de séparation de ce dépôt : tout calcul vit
 * dans un module sans réseau, les `.server.ts` ne font que chercher et écrire.
 * Un webhook de facturation est exactement le genre de code qu'on ne peut pas
 * tester en production — on ne provoque pas un impayé pour voir — donc c'est
 * exactement le genre de code qui doit être décidable hors réseau.
 *
 * LE PIÈGE QUE CE MODULE EXISTE POUR ÉVITER. « Paiement réussi » ne veut pas
 * dire « abonné », et « abonnement existe » ne veut pas dire « payé ». Stripe
 * envoie une dizaine de types d'événements dont plusieurs se ressemblent ; en
 * accorder le plan payant sur le mauvais donne soit un client qui paie sans
 * accès, soit un accès que personne ne paie. On ne se fie donc jamais au NOM de
 * l'événement seul, mais au STATUT porté par l'objet — c'est déjà la règle que
 * `effectiveTier` applique côté lecture.
 */

/** Ce qu'il faut écrire dans `subscriptions`, ou `null` si l'événement ne dit rien. */
export type EffetAbonnement = {
  /** Notre utilisateur. Sans lui, l'événement n'est rattachable à personne. */
  userId: string;
  tier: PlanTier;
  /** Statut Stripe, recopié tel quel : c'est `effectiveTier` qui l'interprète. */
  status: string;
  customerId: string | null;
  subscriptionId: string | null;
  /** Fin de la période payée, en ISO. `null` si Stripe ne l'a pas donnée. */
  currentPeriodEnd: string | null;
};

/**
 * Événements qui portent une décision d'abonnement.
 *
 * LISTE EXPLICITE, ET VOLONTAIREMENT COURTE. Stripe en émet des dizaines ;
 * réagir à tous reviendrait à réagir à des événements dont on n'a pas compris
 * l'effet. Ceux-ci suffisent à couvrir le cycle complet — souscription,
 * renouvellement, échec de paiement, résiliation — et tout autre est acquitté
 * sans rien changer.
 */
const EVENEMENTS_TRAITES = new Set([
  // La souscription vient d'aboutir. Le SEUL qui porte `client_reference_id`.
  "checkout.session.completed",
  // Le cycle de vie ensuite : renouvellement, impayé, changement, résiliation.
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

/** `true` si ce type d'événement peut modifier un abonnement. */
export function evenementTraite(type: string): boolean {
  return EVENEMENTS_TRAITES.has(type);
}

function texte(valeur: unknown): string | null {
  return typeof valeur === "string" && valeur.trim().length > 0 ? valeur.trim() : null;
}

/**
 * Identifiant de notre utilisateur, cherché aux trois endroits où Stripe peut
 * le porter.
 *
 * POURQUOI TROIS. `client_reference_id` n'existe que sur la session de
 * paiement ; les événements d'abonnement ultérieurs ne l'ont pas. C'est pour
 * cela que `createCheckoutSession` recopie l'identifiant dans les métadonnées
 * de l'abonnement — sans quoi un renouvellement ou une résiliation arriverait
 * sans titulaire, et il faudrait deviner.
 */
function trouveUserId(objet: Record<string, unknown>): string | null {
  const direct = texte(objet.client_reference_id);
  if (direct) return direct;
  const meta = objet.metadata;
  if (meta && typeof meta === "object") {
    const depuisMeta = texte((meta as Record<string, unknown>).user_id);
    if (depuisMeta) return depuisMeta;
  }
  return null;
}

/**
 * Fin de période, convertie depuis l'horodatage Unix de Stripe.
 *
 * Une valeur absente ou illisible rend `null` : mieux vaut ne pas connaître la
 * date que d'en inventer une, puisque c'est elle qui dira jusqu'à quand l'accès
 * est dû si Stripe devient injoignable.
 */
function finDePeriode(valeur: unknown): string | null {
  if (typeof valeur !== "number" || !Number.isFinite(valeur) || valeur <= 0) return null;
  const date = new Date(valeur * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Traduit un événement Stripe vérifié en ce qu'il faut écrire, ou `null`.
 *
 * `null` signifie « cet événement ne change rien » : un type non traité, un
 * événement sans titulaire rattachable, ou une session de paiement qui n'a pas
 * abouti. Dans les trois cas l'appelant ACQUITTE quand même — un webhook non
 * acquitté est rejoué pendant des jours.
 */
export function effetDeLEvenement(evenement: {
  type: string;
  data: { object: Record<string, unknown> };
}): EffetAbonnement | null {
  if (!evenementTraite(evenement.type)) return null;

  const objet = evenement.data.object;
  const userId = trouveUserId(objet);
  if (!userId) {
    // Sans titulaire, écrire reviendrait à choisir un compte au hasard.
    console.error(
      `[Stripe] ${evenement.type} sans identifiant d'utilisateur rattachable — ignoré.`,
    );
    return null;
  }

  if (evenement.type === "checkout.session.completed") {
    /*
      « SESSION TERMINÉE » N'EST PAS « SESSION PAYÉE ».

      Une session expirée, ou dont le paiement est encore en cours de
      traitement, arrive avec ce même type. Accorder le plan sur le nom de
      l'événement donnerait un accès à qui n'a rien payé. `payment_status` est
      le seul champ qui tranche.
    */
    const paye = texte(objet.payment_status) === "paid";
    if (!paye) return null;
    return {
      userId,
      tier: "pro",
      status: "active",
      customerId: texte(objet.customer),
      subscriptionId: texte(objet.subscription),
      currentPeriodEnd: null,
    };
  }

  /*
    LES ÉVÉNEMENTS D'ABONNEMENT : ON RECOPIE LE STATUT, ON NE L'INTERPRÈTE PAS.

    `customer.subscription.updated` couvre aussi bien un renouvellement réussi
    qu'un passage en impayé. Le nom ne dit pas lequel ; `status` le dit.
    `effectiveTier` — déjà écrit, déjà testé — décide ensuite quels statuts
    donnent réellement droit au plan. Deux endroits pour la même règle
    finiraient par diverger, donc il n'y en a qu'un.
  */
  const status = texte(objet.status) ?? "canceled";
  const supprime = evenement.type === "customer.subscription.deleted";
  const statutFinal = supprime ? "canceled" : status;

  return {
    userId,
    // Le palier suit le droit réel : un abonnement `past_due` porte encore
    // `tier = pro` chez Stripe, mais ne donne plus accès.
    tier: effectiveTier({ tier: "pro", status: statutFinal }),
    status: statutFinal,
    customerId: texte(objet.customer),
    subscriptionId: texte(objet.id),
    currentPeriodEnd: finDePeriode(objet.current_period_end),
  };
}
