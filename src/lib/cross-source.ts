/**
 * RAISONNEMENT CROISÉ. Ce qu'aucune source ne peut établir seule.
 *
 * POURQUOI CE MODULE EXISTE. Meta sait combien de clics il a envoyés. Shopify
 * sait combien de commandes sont arrivées. Ni l'un ni l'autre ne sait ce qui
 * s'est passé ENTRE LES DEUX — et c'est précisément là que se trouve la
 * réponse à la question qui coûte le plus cher : « ma publicité est-elle
 * mauvaise, ou ma boutique perd-elle les gens qu'elle amène ? »
 *
 * Un marchand qui se trompe de réponse coupe une campagne rentable, ou nourrit
 * une campagne qui remplit une boutique incapable de vendre. Les deux erreurs
 * coûtent des mois.
 *
 * LA MÉTRIQUE QUE PERSONNE N'A SEUL : commandes Shopify ÷ clics Meta. Un taux
 * de conversion après clic, que ni Meta ni Shopify ne peut calculer de son
 * côté. C'est le premier raisonnement que le croisement rend possible, et il
 * départage à lui seul les deux causes.
 *
 * TROIS RÈGLES DE PRUDENCE, sans lesquelles le croisement produirait des
 * conclusions plus dangereuses que le silence :
 *
 * 1. **Un signal croisé ORIENTE, il ne condamne pas.** Il dit où chercher, pas
 *    ce qu'il faut corriger. Chaque signal porte donc explicitement ce qu'il
 *    NE permet PAS de conclure.
 * 2. **Les devises doivent coïncider.** Le compte publicitaire facture dans sa
 *    devise, la boutique vend dans la sienne. Comparer une dépense en dollars
 *    à un chiffre d'affaires en euros produirait un ROAS faux, et personne ne
 *    le verrait. Sans coïncidence, on s'abstient.
 * 3. **Le volume commande la certitude.** Les mêmes chiffres sur 12 clics et
 *    sur 12 000 ne disent pas la même chose. La certitude est calculée, pas
 *    décrétée, et redescend en « hypothèse » dès que l'échantillon est mince.
 *
 * Module PUR.
 */

import type { Observation } from "@/lib/observations";
import { findObservation, observationValue } from "@/lib/observations";

/** Même échelle que `finding-graph.ts` : le moteur ne connaît que celle-là. */
export type CrossCertainty = "fait" | "deduction_forte" | "hypothese";

export type CrossSignal = {
  id: string;
  /** Ce que le croisement établit. */
  statement: string;
  /** Où chercher ensuite. C'est la vraie valeur du signal. */
  investigate: string[];
  /** Ce que le signal NE permet PAS de conclure. Aussi important que le reste. */
  doNotConclude: string;
  certainty: CrossCertainty;
  /** Les observations qui le soutiennent, mot pour mot. */
  evidence: string[];
};

/** En dessous, aucun taux après clic n'est interprétable. */
export const MIN_CLICKS_FOR_POST_CLICK = 200;

/** Au-dessus, le trafic payant convertit normalement : la boutique fait son travail. */
export const HEALTHY_POST_CLICK_PCT = 1.5;

/** En dessous, le trafic arrive mais n'achète pas. */
export const WEAK_POST_CLICK_PCT = 0.5;

/** CTR en dessous duquel l'accroche interpelle mal. Hypothèse, jamais un fait. */
export const LOW_CTR_PCT = 0.8;

/** En dessous, un ROAS repose sur trop peu d'achats pour signifier quoi que ce soit. */
export const MIN_PURCHASES_FOR_ROAS = 10;

/** Écart d'attribution au-delà duquel Meta se compte trop d'achats. */
export const ATTRIBUTION_GAP_RATIO = 1.5;

function certaintyFromSample(sample: number, strong: number, weak: number): CrossCertainty {
  if (sample >= strong) return "deduction_forte";
  if (sample >= weak) return "hypothese";
  return "hypothese";
}

/**
 * Croise les observations de toutes les sources.
 *
 * Ne produit RIEN quand les deux côtés du croisement ne sont pas présents :
 * un croisement à moitié observé n'est pas un demi-signal, c'est une invention.
 */
export function crossSignals(observations: Observation[]): CrossSignal[] {
  const signals: CrossSignal[] = [];

  const clicks = findObservation(observations, "meta.clicks_30d");
  const orders = findObservation(observations, "shopify.orders_30d");
  const spend = findObservation(observations, "meta.spend_30d");
  const revenue = findObservation(observations, "shopify.revenue_30d");
  const ctr = observationValue(observations, "meta.ctr_30d");
  const roas = findObservation(observations, "meta.roas_30d");
  const metaPurchases = observationValue(observations, "meta.purchases_30d");
  const abandonment = observationValue(observations, "shopify.cart_abandonment_rate");
  const outOfStock = observationValue(observations, "shopify.products_out_of_stock");
  const noDescription = observationValue(observations, "shopify.products_without_description");

  // --- LE croisement : que devient le trafic payant ? ----------------------
  if (clicks?.value != null && orders?.value != null && clicks.value >= MIN_CLICKS_FOR_POST_CLICK) {
    const postClick = (orders.value / clicks.value) * 100;
    const evidence = [clicks.evidence, orders.evidence];
    const certainty = certaintyFromSample(clicks.value, 1000, MIN_CLICKS_FOR_POST_CLICK);

    if (postClick < WEAK_POST_CLICK_PCT) {
      // Meta amène du monde, la boutique ne transforme pas. Accuser la
      // publicité ici est l'erreur classique : elle fait son travail.
      const leads: string[] = [
        "La page d'arrivée : promet-elle la même chose que la publicité ?",
        "Le prix affiché, comparé à ce que l'annonce laissait espérer.",
        "Les signaux de confiance avant paiement : avis, garantie, frais de port annoncés tôt.",
      ];
      if (abandonment != null && abandonment > 60) {
        leads.unshift(
          `Le tunnel de commande : ${Math.round(abandonment)} % des paniers ouverts sont abandonnés.`,
        );
      }
      if (outOfStock != null && outOfStock > 0) {
        leads.push(`${outOfStock} produits en rupture reçoivent peut-être ce trafic.`);
      }
      if (noDescription != null && noDescription > 0) {
        leads.push(`${noDescription} fiches sans description ne peuvent pas convaincre.`);
      }

      signals.push({
        id: "cross.trafic_qui_nachete_pas",
        statement: `La publicité amène du trafic — ${Math.round(clicks.value)} clics — mais seulement ${postClick.toFixed(2)} % débouchent sur une commande. La fuite est APRÈS le clic, pas avant.`,
        investigate: leads,
        doNotConclude:
          "Ne conclus pas que les campagnes sont mauvaises : elles font entrer des gens. Le problème est ce qu'ils trouvent en arrivant.",
        certainty,
        evidence,
      });
    } else if (postClick >= HEALTHY_POST_CLICK_PCT) {
      signals.push({
        id: "cross.boutique_transforme",
        statement: `Le trafic payant convertit à ${postClick.toFixed(2)} % : la boutique transforme correctement ce qu'on lui envoie.`,
        investigate: [
          "Le coût d'acquisition : peut-on payer ce trafic moins cher ?",
          "Le volume : peut-on en amener davantage au même coût ?",
          "Le panier moyen, qui décide de ce qu'on peut se permettre de payer un clic.",
        ],
        doNotConclude:
          "Ne conclus pas que tout va bien côté boutique : un bon taux après clic ne dit rien du trafic non payant.",
        certainty,
        evidence,
      });
    }
  } else if (clicks?.value != null && orders?.value != null) {
    // Volume insuffisant : le dire, plutôt que de calculer un taux qui
    // basculerait avec une commande de plus ou de moins.
    signals.push({
      id: "cross.volume_insuffisant",
      statement: `Trop peu de clics (${Math.round(clicks.value)}) pour juger ce que devient le trafic payant.`,
      investigate: [
        `Attendre au moins ${MIN_CLICKS_FOR_POST_CLICK} clics avant de conclure quoi que ce soit sur l'après-clic.`,
      ],
      doNotConclude:
        "Ne conclus RIEN sur la qualité du trafic ni sur celle de la boutique à partir de ces chiffres.",
      certainty: "hypothese",
      evidence: [clicks.evidence, orders.evidence],
    });
  }

  // --- CTR faible : une hypothèse, jamais un fait --------------------------
  if (ctr != null && ctr < LOW_CTR_PCT) {
    const impressions = findObservation(observations, "meta.impressions_30d");
    signals.push({
      id: "cross.ctr_faible",
      statement: `Le taux de clic est de ${ctr.toFixed(2)} %, sous le seuil où une accroche est considérée comme efficace.`,
      investigate: [
        "L'accroche et le visuel : parlent-ils au problème du client, ou du produit ?",
        "L'audience : est-elle assez proche du client réel ?",
        "La fatigue publicitaire : depuis combien de temps la même création tourne-t-elle ?",
      ],
      // Le point que le produit ne doit jamais franchir : un CTR bas est un
      // CONSTAT ; sa cause est une hypothèse tant qu'on n'a pas testé.
      doNotConclude:
        "Le CTR bas est un fait. Sa CAUSE — création, message ou audience — est une hypothèse : ne la présente jamais comme démontrée sans test.",
      certainty: "hypothese",
      evidence: impressions ? [impressions.evidence] : [],
    });
  }

  // --- ROAS élevé sur un volume dérisoire ----------------------------------
  if (roas?.value != null && roas.value >= 2 && (roas.sample ?? 0) < MIN_PURCHASES_FOR_ROAS) {
    signals.push({
      id: "cross.roas_sans_volume",
      statement: `Le ROAS affiché est de ${roas.value.toFixed(2)}x, mais il repose sur ${roas.sample ?? 0} achats seulement.`,
      investigate: [
        "Le volume réel avant de conclure : un achat de plus ou de moins fait basculer ce chiffre.",
        "La valeur des achats : un panier exceptionnel peut porter tout le ROAS à lui seul.",
      ],
      doNotConclude:
        "Ne déclare pas cette campagne excellente. Un ROAS sur si peu d'achats n'est pas une performance, c'est une coïncidence possible.",
      certainty: "hypothese",
      evidence: [roas.evidence],
    });
  }

  // --- Écart d'attribution --------------------------------------------------
  if (metaPurchases != null && orders?.value != null && orders.value > 0) {
    if (metaPurchases > orders.value * ATTRIBUTION_GAP_RATIO) {
      signals.push({
        id: "cross.attribution_optimiste",
        statement: `Meta s'attribue ${Math.round(metaPurchases)} achats alors que la boutique a enregistré ${Math.round(orders.value)} commandes payées sur la même période.`,
        investigate: [
          "La fenêtre d'attribution de Meta, qui compte des achats déclenchés bien après le clic.",
          "Le ROAS réel, à recalculer sur le chiffre d'affaires de la boutique et non sur la valeur attribuée.",
        ],
        doNotConclude:
          "Ne conclus pas à une fraude ni à une erreur de suivi : l'écart d'attribution est normal. Il impose seulement de ne pas piloter au ROAS déclaré par Meta.",
        certainty: "fait",
        evidence: [orders.evidence],
      });
    }
  }

  // --- Rentabilité réelle, quand les devises coïncident --------------------
  // Sans cette vérification, un compte publicitaire en dollars et une boutique
  // en euros produiraient un ROAS faux que personne ne verrait passer.
  if (spend?.value != null && revenue?.value != null && spend.value > 0) {
    const sameCurrency =
      spend.currency != null && revenue.currency != null && spend.currency === revenue.currency;
    if (sameCurrency) {
      const realRoas = revenue.value / spend.value;
      signals.push({
        id: "cross.roas_reel",
        statement: `Rapporté au chiffre d'affaires réel de la boutique, chaque unité dépensée en publicité rapporte ${realRoas.toFixed(2)}.`,
        investigate:
          realRoas < 1
            ? [
                "La marge : à ce niveau, la publicité coûte plus qu'elle ne rapporte, même avant les coûts produit.",
                "Les campagnes qui dépensent sans achat, à traiter en premier.",
              ]
            : [
                "La marge après coût produit : un ROAS supérieur à 1 ne signifie pas rentable.",
                "Le seuil de rentabilité, qui dépend de ta marge et non d'un ROAS de référence.",
              ],
        doNotConclude:
          "Ce rapport ne tient pas compte du trafic non payant : une partie du chiffre d'affaires ne vient pas de la publicité. Ce n'est pas un ROAS, c'est un ordre de grandeur.",
        certainty: "deduction_forte",
        evidence: [spend.evidence, revenue.evidence],
      });
    } else {
      signals.push({
        id: "cross.devises_incomparables",
        statement: `La dépense publicitaire (${spend.currency ?? "devise inconnue"}) et le chiffre d'affaires (${revenue.currency ?? "devise inconnue"}) ne sont pas dans la même devise.`,
        investigate: ["Aucun rapprochement chiffré n'est possible sans taux de change."],
        doNotConclude:
          "N'additionne, ne soustrais et ne compare JAMAIS ces deux montants. Aucun ROAS global ne peut être calculé ici.",
        certainty: "fait",
        evidence: [spend.evidence, revenue.evidence],
      });
    }
  }

  return signals;
}

const CERTAINTY_LABEL: Record<CrossCertainty, string> = {
  fait: "FAIT",
  deduction_forte: "DÉDUCTION FORTE",
  hypothese: "HYPOTHÈSE",
};

/**
 * Le bloc croisé injecté dans la demande d'audit.
 *
 * Chaque signal arrive avec son niveau de certitude ET son interdiction. Le
 * second compte autant : sans lui, « la publicité amène du trafic qui n'achète
 * pas » se transformerait en « coupe tes campagnes » — exactement la mauvaise
 * décision, prise pour la bonne raison.
 */
export function crossSignalsToPromptBlock(signals: CrossSignal[]): string {
  if (signals.length === 0) {
    return `AUCUN CROISEMENT POSSIBLE : une seule source de données, ou pas assez de volume. Ne compare pas des canaux que tu ne mesures pas.`;
  }

  const blocks = signals.map((s) => {
    const leads = s.investigate.map((l) => `    · ${l}`).join("\n");
    return (
      `[${CERTAINTY_LABEL[s.certainty]}] ${s.statement}\n` +
      `  À creuser :\n${leads}\n` +
      `  NE CONCLUS PAS : ${s.doNotConclude}` +
      (s.evidence.length > 0 ? `\n  Preuves : ${s.evidence.join(" ; ")}` : "")
    );
  });

  return (
    `CROISEMENT DES SOURCES — ce qu'aucun canal ne montre seul :\n\n${blocks.join("\n\n")}\n\n` +
    `Ces croisements ORIENTENT la recherche, ils ne désignent pas un coupable. ` +
    `Respecte le niveau de certitude indiqué : ce qui est marqué HYPOTHÈSE doit ressortir en confiance "low", ` +
    `et sa cause ne doit jamais être présentée comme démontrée.`
  );
}
