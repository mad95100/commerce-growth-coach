import { createHmac } from "node:crypto";
import { defineSuite } from "../harness";
import { effetDeLEvenement, evenementTraite } from "@/lib/abonnement-evenements";
import { verifyStripeWebhook } from "@/lib/stripe.server";
import { PLAN_PRICE, effectiveTier, formattedPlanPrice, quotaLimit } from "@/lib/plans";

/**
 * FACTURATION : LE CODE QU'ON NE PEUT PAS TESTER EN PRODUCTION.
 *
 * On ne provoque pas un impayé pour voir ce qui se passe, ni un double
 * prélèvement pour vérifier qu'il n'arrive pas. Toute la décision vit donc
 * dans des modules purs, et cette suite les exerce sur les cas exacts que
 * Stripe envoie.
 *
 * LES DEUX DÉFAUTS QUE CETTE SUITE EXISTE POUR EMPÊCHER, et qui coûtent tous
 * les deux de l'argent réel, dans un sens ou dans l'autre :
 *   · accorder le plan à qui n'a pas payé — une session « terminée » mais non
 *     payée, ou un webhook rejoué ;
 *   · retirer le plan à qui paie — un statut Stripe mal interprété.
 */

const SECRET = "whsec_test_pour_la_suite_de_tests";

/** Construit un webhook signé comme Stripe le fait, pour éprouver la vérification. */
function signe(corps: string, secretUtilise = SECRET, horodatage = Math.floor(Date.now() / 1000)) {
  const signature = createHmac("sha256", secretUtilise)
    .update(`${horodatage}.${corps}`, "utf8")
    .digest("hex");
  return `t=${horodatage},v1=${signature}`;
}

const sessionPayee = {
  type: "checkout.session.completed",
  data: {
    object: {
      client_reference_id: "user-abc",
      payment_status: "paid",
      customer: "cus_123",
      subscription: "sub_123",
    },
  },
};

export default defineSuite(
  "Abonnement — ce qui accorde un plan, et ce qui ne l'accorde pas",
  (t) => {
    // =========================================================================
    // 1. LE PRIX
    // =========================================================================
    /*
    EN CENTIMES ENTIERS. Un prix en virgule flottante se compare faux, et
    l'écart d'un centime tombe entre ce que l'écran annonce et ce qui est
    prélevé.
  */
    t.check("le prix est un entier de centimes", Number.isInteger(PLAN_PRICE.amountCents), true);
    t.check("le prix est celui décidé", PLAN_PRICE.amountCents, 2499);
    t.check("il porte sa devise", PLAN_PRICE.currency, "EUR");
    t.check("il s'affiche à la française", formattedPlanPrice().includes("24,99"), true);
    t.check("…avec sa devise", /€/.test(formattedPlanPrice()), true);

    // =========================================================================
    // 2. LA SIGNATURE DU WEBHOOK
    // =========================================================================
    const corps = JSON.stringify(sessionPayee);

    t.check(
      "un webhook correctement signé est accepté",
      verifyStripeWebhook(corps, signe(corps), SECRET)?.type,
      "checkout.session.completed",
    );
    t.check(
      "une signature d'un autre secret est refusée",
      verifyStripeWebhook(corps, signe(corps, "whsec_autre"), SECRET),
      null,
    );
    t.check("un en-tête absent est refusé", verifyStripeWebhook(corps, null, SECRET), null);
    t.check("un secret absent refuse tout", verifyStripeWebhook(corps, signe(corps), ""), null);

    /*
    LE CORPS SIGNÉ EST CELUI QUI EST ARRIVÉ. Re-sérialiser le JSON change
    l'espacement et l'ordre des clés : la signature ne correspond plus. C'est le
    piège documenté pour Shopify, et il est identique ici.
  */
    const reserialise = JSON.stringify(JSON.parse(corps), null, 2);
    t.check(
      "un corps re-sérialisé ne passe plus",
      verifyStripeWebhook(reserialise, signe(corps), SECRET),
      null,
    );

    /*
    REJEU. Un webhook signé il y a trois jours reste parfaitement signé. Sans
    contrôle d'horodatage, quiconque en capture un peut le rejouer — par
    exemple celui qui accorde l'abonnement, juste après l'avoir résilié.
  */
    const vieux = Math.floor(Date.now() / 1000) - 3600;
    t.check(
      "un webhook trop ancien est refusé",
      verifyStripeWebhook(corps, signe(corps, SECRET, vieux), SECRET),
      null,
    );
    const recent = Math.floor(Date.now() / 1000) - 60;
    t.check(
      "…mais une minute d'écart reste acceptée",
      verifyStripeWebhook(corps, signe(corps, SECRET, recent), SECRET) !== null,
      true,
    );

    // Un corps illisible ne doit pas faire tomber le gestionnaire.
    const casse = "{ceci n'est pas du JSON";
    t.check(
      "un corps illisible est refusé sans lever",
      verifyStripeWebhook(casse, signe(casse), SECRET),
      null,
    );

    // =========================================================================
    // 3. CE QUI ACCORDE LE PLAN
    // =========================================================================
    const accorde = effetDeLEvenement(sessionPayee);
    t.check("un paiement abouti accorde le plan", accorde?.tier, "pro");
    t.check("…au bon utilisateur", accorde?.userId, "user-abc");
    t.check("…et retient le client Stripe", accorde?.customerId, "cus_123");
    t.check("…et l'abonnement", accorde?.subscriptionId, "sub_123");

    /*
    « SESSION TERMINÉE » N'EST PAS « SESSION PAYÉE ». Une session expirée, ou
    dont le paiement est encore en traitement, porte le MÊME type d'événement.
    Accorder sur le nom donnerait un accès à qui n'a rien payé.
  */
    for (const statut of ["unpaid", "no_payment_required", ""]) {
      t.check(
        `une session « ${statut || "(vide)"} » n'accorde rien`,
        effetDeLEvenement({
          type: "checkout.session.completed",
          data: { object: { client_reference_id: "user-abc", payment_status: statut } },
        }),
        null,
      );
    }

    // SANS TITULAIRE, ON N'ÉCRIT PAS. Choisir un compte reviendrait à le tirer au sort.
    t.check(
      "un événement sans utilisateur rattachable n'accorde rien",
      effetDeLEvenement({
        type: "checkout.session.completed",
        data: { object: { payment_status: "paid", customer: "cus_1" } },
      }),
      null,
    );

    // =========================================================================
    // 4. LE CYCLE DE VIE : CE QUI RETIRE LE PLAN, ET CE QUI NE LE RETIRE PAS
    // =========================================================================
    /*
    On recopie le STATUT, on ne l'interprète pas ici : `effectiveTier` — déjà
    écrit, déjà testé — décide seul quels statuts donnent droit au plan. Deux
    endroits pour la même règle finiraient par diverger.
  */
    const abonnement = (status: string, extra: Record<string, unknown> = {}) => ({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_123",
          customer: "cus_123",
          status,
          metadata: { user_id: "user-abc" },
          ...extra,
        },
      },
    });

    t.check(
      "un abonnement actif garde le plan",
      effetDeLEvenement(abonnement("active"))?.tier,
      "pro",
    );
    t.check(
      "un essai en cours garde le plan",
      effetDeLEvenement(abonnement("trialing"))?.tier,
      "pro",
    );
    // CELUI-CI EST LE PLUS COÛTEUX À SE TROMPER : un impayé porte encore
    // `tier = pro` chez Stripe. S'y fier donnerait le plan payant à qui ne paie plus.
    t.check("un impayé retire le plan", effetDeLEvenement(abonnement("past_due"))?.tier, "free");
    t.check(
      "un abonnement résilié retire le plan",
      effetDeLEvenement(abonnement("canceled"))?.tier,
      "free",
    );
    t.check(
      "une suppression retire le plan quel que soit le statut porté",
      effetDeLEvenement({
        type: "customer.subscription.deleted",
        data: { object: { id: "sub_123", status: "active", metadata: { user_id: "user-abc" } } },
      })?.tier,
      "free",
    );

    /*
    L'IDENTIFIANT SURVIT AU-DELÀ DE LA SESSION DE PAIEMENT. Seul
    `checkout.session.completed` porte `client_reference_id` ; les événements
    suivants ne l'ont pas. C'est pour cela que la session le recopie dans les
    métadonnées de l'abonnement — sans quoi un renouvellement arriverait sans
    titulaire, et il faudrait deviner.
  */
    t.check(
      "un renouvellement retrouve son titulaire par les métadonnées",
      effetDeLEvenement(abonnement("active"))?.userId,
      "user-abc",
    );

    // La fin de période est convertie, jamais inventée.
    const avecFin = effetDeLEvenement(abonnement("active", { current_period_end: 1793491200 }));
    t.check("la fin de période est une date ISO", typeof avecFin?.currentPeriodEnd, "string");
    t.check(
      "une fin de période absente reste absente",
      effetDeLEvenement(abonnement("active"))?.currentPeriodEnd,
      null,
    );
    t.check(
      "une fin de période illisible n'invente rien",
      effetDeLEvenement(abonnement("active", { current_period_end: "bientôt" }))?.currentPeriodEnd,
      null,
    );

    // =========================================================================
    // 5. LES ÉVÉNEMENTS QU'ON NE TRAITE PAS
    // =========================================================================
    /*
    Stripe en émet des dizaines. Réagir à un événement dont on n'a pas compris
    l'effet est pire que de l'ignorer — mais il faut quand même l'ACQUITTER,
    sans quoi Stripe le rejoue pendant des jours puis coupe le flux, et nous
    cesserions de recevoir les résiliations.
  */
    for (const type of [
      "invoice.created",
      "payment_intent.succeeded",
      "customer.created",
      "charge.refunded",
    ]) {
      t.check(`« ${type} » n'est pas traité`, evenementTraite(type), false);
      t.check(
        `…et ne change rien`,
        effetDeLEvenement({ type, data: { object: { metadata: { user_id: "user-abc" } } } }),
        null,
      );
    }

    // =========================================================================
    // 6. LE PLAN PAYANT LÈVE BIEN LES PLAFONDS
    // =========================================================================
    /*
    Sans ce contrôle, on vendrait un abonnement qui n'apporte rien : le prix est
    affiché, le paiement passe, et les compteurs restent plafonnés.
  */
    t.check("le plan payant n'a pas de plafond d'audits", quotaLimit("pro", "audits"), null);
    t.check("…ni de plafond de corrections", quotaLimit("pro", "fixes"), null);

    // ET LE SOCLE DE LECTURE, celui qui accorde réellement le droit à chaque appel.
    t.check("aucun abonnement vaut gratuit", effectiveTier(null), "free");
    t.check(
      "un abonnement sans statut ne donne rien",
      effectiveTier({ tier: "pro", status: null }),
      "free",
    );
    t.check(
      "un statut inconnu ne donne rien",
      effectiveTier({ tier: "pro", status: "incomplete_expired" }),
      "free",
    );
  },
);
