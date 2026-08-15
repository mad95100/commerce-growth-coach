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

/**
 * Part de commandes marquées « payant » au-delà de laquelle la boutique dépend
 * de son budget. Ce n'est pas une contre-performance : c'est une fragilité, et
 * les deux ne se corrigent pas de la même façon.
 */
export const HIGH_PAID_DEPENDENCE_PCT = 70;

/** Part sans marqueur publicitaire au-delà de laquelle un socle propre existe. */
export const STRONG_ORGANIC_PCT = 60;

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

  const metaClicks = findObservation(observations, "meta.clicks_30d");
  const googleClicks = findObservation(observations, "google.clicks_30d");
  // Le trafic payant est la SOMME des canaux. Rapporter les commandes aux
  // seuls clics Meta sur une boutique qui fait aussi du Google surestimerait
  // le taux de transformation d'un facteur égal à la part de Google — et
  // ferait conclure que la boutique va bien alors qu'elle perd du monde.
  const clicks = combineClicks(metaClicks, googleClicks);
  const orders = findObservation(observations, "shopify.orders_30d");
  const spend = findObservation(observations, "meta.spend_30d");
  const revenue = findObservation(observations, "shopify.revenue_30d");
  const ctr = observationValue(observations, "meta.ctr_30d");
  const googleCtr = observationValue(observations, "google.ctr_30d");
  const googleRoas = findObservation(observations, "google.roas_30d");
  const googleSpend = findObservation(observations, "google.spend_30d");
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

  // --- ATTRIBUTION ENTRE CANAUX -------------------------------------------
  // LE piège que Google corrige. Sans lui, une boutique dont Meta va mal
  // recevrait « ton acquisition ne fonctionne pas » — faux si Google marche,
  // et coûteux : le marchand coupe ce qui marchait ou refait ce qui marche.
  const metaRoas = roas?.value ?? null;
  const googleRoasValue = googleRoas?.value ?? null;
  if (metaRoas !== null && googleRoasValue !== null) {
    const metaWeak = metaRoas < 1.5;
    const googleWeak = googleRoasValue < 1.5;
    const evidence = [roas!.evidence, googleRoas!.evidence];

    if (metaWeak !== googleWeak) {
      const weakName = metaWeak ? "Meta" : "Google";
      const strongName = metaWeak ? "Google" : "Meta";
      signals.push({
        id: "cross.canal_isole",
        statement: `${weakName} rapporte ${(metaWeak ? metaRoas : googleRoasValue).toFixed(2)}x quand ${strongName} rapporte ${(metaWeak ? googleRoasValue : metaRoas).toFixed(2)}x. L'écart est entre les deux canaux, pas dans l'acquisition en général.`,
        investigate: [
          `Ce qui distingue ${weakName} de ${strongName} : audience, intention, format, moment d'exposition.`,
          `Le ciblage et les créations de ${weakName} spécifiquement — pas la stratégie d'ensemble.`,
          `Ce que ${strongName} fait bien et qui pourrait être transposé.`,
        ],
        doNotConclude: `Ne conclus SURTOUT PAS que l'acquisition ne fonctionne pas : ${strongName} fonctionne. Couper les deux ferait perdre ce qui marche.`,
        certainty: "deduction_forte",
        evidence,
      });
    } else if (metaWeak && googleWeak) {
      signals.push({
        id: "cross.acquisition_globale",
        statement: `Les deux canaux payants rapportent peu : ${metaRoas.toFixed(2)}x sur Meta, ${googleRoasValue.toFixed(2)}x sur Google.`,
        investigate: [
          "Ce qui est commun aux deux : la destination, l'offre, le prix, la promesse.",
          "Le panier moyen, qui décide de ce qu'on peut se permettre de payer un clic.",
          "La marge : un ROAS de 2 est rentable ici et ruineux ailleurs.",
        ],
        // Le raisonnement facile serait « les deux régies sont mauvaises ».
        // Deux canaux indépendants qui échouent de la même façon désignent
        // plutôt ce qu'ils ont en commun.
        doNotConclude:
          "Ne conclus pas que les deux régies sont mal réglées. Deux canaux indépendants qui échouent ensemble désignent d'abord ce qu'ils partagent : la boutique, l'offre et le prix.",
        certainty: "deduction_forte",
        evidence,
      });
    }
  } else if ((metaRoas !== null) !== (googleRoasValue !== null)) {
    // Un seul canal mesuré : le dire, pour que le modèle baisse sa certitude
    // au lieu de généraliser depuis l'unique canal qu'il voit.
    const missing = metaRoas === null ? "Meta" : "Google";
    signals.push({
      id: "cross.canal_manquant",
      statement: `${missing} n'est pas mesuré : le diagnostic d'acquisition ne porte que sur un canal.`,
      investigate: [
        `Connecter ${missing} avant de conclure quoi que ce soit sur l'acquisition dans son ensemble.`,
      ],
      doNotConclude: `Ne généralise pas à toute l'acquisition ce que tu observes sur un seul canal. Sans ${missing}, une contre-performance peut être locale.`,
      certainty: "fait",
      evidence: [],
    });
  }

  // CTR faible sur Google : même règle que Meta, un fait dont la cause est
  // une hypothèse — mais les causes ne sont pas les mêmes.
  if (googleCtr != null && googleCtr < LOW_CTR_PCT) {
    signals.push({
      id: "cross.ctr_google_faible",
      statement: `Le taux de clic Google est de ${googleCtr.toFixed(2)} %.`,
      investigate: [
        "Les mots-clés : correspondent-ils à ce que le client cherche vraiment ?",
        "Les annonces : reprennent-elles les termes de la recherche ?",
        "La concurrence sur ces requêtes, qui déplace le taux de clic sans que rien n'ait changé chez toi.",
      ],
      doNotConclude:
        "Sur Google, un taux de clic bas vient plus souvent d'un décalage entre la requête et l'annonce que d'un problème de création. Le constat est un fait, sa cause est une hypothèse.",
      certainty: "hypothese",
      evidence: [],
    });
  }

  // Devises publicitaires différentes entre régies : additionner deux budgets
  // dans deux monnaies produit un total qui ne veut rien dire.
  if (spend?.currency && googleSpend?.currency && spend.currency !== googleSpend.currency) {
    signals.push({
      id: "cross.devises_regies",
      statement: `Le compte Meta facture en ${spend.currency} et le compte Google en ${googleSpend.currency}.`,
      investigate: ["Raisonner canal par canal : aucun budget total n'a de sens ici."],
      doNotConclude:
        "N'additionne JAMAIS ces deux budgets et ne compare pas leurs coûts par clic. Aucun taux de change n'est disponible.",
      certainty: "fait",
      evidence: [spend.evidence, googleSpend.evidence],
    });
  }

  // --- Ce que le marchand garderait sans budget -----------------------------
  // Le seul contrepoids indépendant aux régies. Meta et Google attribuent
  // chacun de leur côté ; les commandes, elles, appartiennent au marchand.
  const coverage = findObservation(observations, "organic.attribution_coverage");
  const nonPaidShare = findObservation(observations, "organic.non_paid_order_share");
  const paidShare = findObservation(observations, "organic.payant_order_share");
  const searchShare = findObservation(observations, "organic.recherche_order_share");

  if (coverage?.value != null && nonPaidShare?.value != null && paidShare?.value != null) {
    const sample = nonPaidShare.sample ?? 0;

    if (paidShare.value >= HIGH_PAID_DEPENDENCE_PCT) {
      signals.push({
        id: "cross.dependance_payant",
        statement: `${Math.round(paidShare.value)} % des commandes arrivent avec un identifiant de clic publicitaire : l'essentiel du chiffre d'affaires s'arrête le jour où le budget s'arrête.`,
        investigate: [
          "Ce que deviennent les ventes si le budget baisse de moitié — c'est le test qui dit si l'entreprise tient debout seule.",
          "Le référencement et la base client, les deux seules acquisitions qui ne se paient pas deux fois.",
        ],
        doNotConclude:
          "Ne conclus pas que la publicité est mauvaise : elle marche, c'est le problème. Une dépendance n'est pas une contre-performance, c'est une fragilité.",
        certainty: certaintyFromSample(sample, 200, 50),
        evidence: [paidShare.evidence, coverage.evidence],
      });
    }

    if (nonPaidShare.value >= STRONG_ORGANIC_PCT) {
      signals.push({
        id: "cross.socle_organique",
        statement: `${Math.round(nonPaidShare.value)} % des commandes n'arrivent avec aucun identifiant de clic publicitaire : la boutique vend sans que le budget ait à pousser.`,
        investigate: [
          searchShare?.value != null && searchShare.value > 0
            ? `La recherche naturelle, qui apporte déjà ${Math.round(searchShare.value)} % des commandes : c'est là que l'effort composé.`
            : "Les canaux qui apportent ces commandes, pour savoir lequel renforcer.",
          "Le budget publicitaire : une part de ce qu'il achète serait peut-être venue seule.",
        ],
        doNotConclude:
          "Ne conclus pas que la publicité ne sert à rien : une commande sans marqueur a pu être déclenchée par une publicité vue et non cliquée. L'absence de marqueur prouve l'absence de clic tracé, pas l'absence d'influence.",
        certainty: certaintyFromSample(sample, 200, 50),
        evidence: [nonPaidShare.evidence, coverage.evidence],
      });
    }

    // LE CROISEMENT QUI TRANCHE. Les régies annoncent N achats ; la boutique
    // compte combien de commandes portent réellement un clic payant.
    const claimed =
      (metaPurchases ?? 0) + (observationValue(observations, "google.conversions_30d") ?? 0);
    const paidOrders = (paidShare.value / 100) * (nonPaidShare.sample ?? 0) || 0;
    if (claimed > 0 && paidOrders > 0 && claimed > paidOrders * ATTRIBUTION_GAP_RATIO) {
      signals.push({
        id: "cross.attribution_contredite",
        statement: `Les régies s'attribuent ${Math.round(claimed)} achats, mais seules ${Math.round(paidOrders)} commandes de la boutique portent un identifiant de clic publicitaire.`,
        investigate: [
          "Le ROAS réel, à recalculer sur les commandes réellement marquées plutôt que sur ce que les régies déclarent.",
          "Le recoupement entre Meta et Google, qui peuvent s'attribuer la même vente chacun de son côté.",
        ],
        doNotConclude:
          "Ne conclus pas que les régies mentent, ni que ces ventes n'existent pas. Un clic payant perd son identifiant dès que le visiteur revient plus tard par un autre chemin — l'écart mesure l'incertitude de l'attribution, pas une fraude.",
        certainty: "deduction_forte",
        evidence: [paidShare.evidence, coverage.evidence],
      });
    }
  } else if (coverage?.value != null) {
    // La couverture a été mesurée, mais les parts n'ont pas été publiées : par
    // construction, c'est que la source les a jugées intraçables. Le seuil reste
    // chez elle — le redéclarer ici en ferait deux, qui divergeraient un jour.
    // On le DIT, plutôt que de laisser croire que l'origine des commandes n'a
    // pas été regardée.
    signals.push({
      id: "cross.origine_intraçable",
      statement: `Seules ${Math.round(coverage.value)} % des commandes portent une trace de leur origine : la répartition entre payant et naturel n'est pas mesurable sur cette boutique.`,
      investigate: [
        "Un outil de mesure du trafic côté boutique, qui garde la trace que le navigateur efface.",
        "Les paramètres de campagne sur tous les liens sortants, seuls marqueurs qui survivent.",
      ],
      doNotConclude:
        "N'en déduis SURTOUT PAS que ces commandes sont du trafic direct. Une absence de référent est une absence d'information, jamais une origine.",
      certainty: "fait",
      evidence: [coverage.evidence],
    });
  }

  return signals;
}

/**
 * Somme des clics payants de tous les canaux mesurés.
 *
 * Renvoie `null` si aucun canal n'est mesuré. La preuve cite les canaux
 * réellement additionnés : sans cela, un taux calculé sur Meta seul passerait
 * pour un taux sur tout le trafic payant.
 */
function combineClicks(
  meta: Observation | undefined,
  google: Observation | undefined,
): Observation | undefined {
  const parts = [meta, google].filter(
    (o): o is Observation => o?.value != null && Number.isFinite(o.value),
  );
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];

  const total = parts.reduce((sum, o) => sum + (o.value ?? 0), 0);
  return {
    ...parts[0],
    id: "paid.clicks_30d",
    label: "Clics payants, tous canaux",
    value: total,
    evidence: `${Math.round(total)} clics payants au total : ${parts
      .map((o) => `${Math.round(o.value!)} ${o.source}`)
      .join(" + ")}`,
    sample: Math.round(total),
  };
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
