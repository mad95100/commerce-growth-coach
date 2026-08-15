/**
 * OÙ EST LA FUITE, ET CE QU'ELLE COÛTE.
 *
 * POURQUOI CE BLOC PLUTÔT QU'UNE SOURCE DE PLUS. Le moteur sait dire « la
 * fuite est après le clic ». Il ne sait pas dire À QUELLE ÉTAPE, ni combien
 * elle coûte. Or c'est exactement la promesse du produit : « voici le problème
 * qui te coûte probablement le plus ». Ajouter Google Ads aurait ajouté une
 * deuxième source d'acquisition — davantage de la même couche — sans jamais
 * répondre à cette question. Ce module y répond, et chaque connecteur futur
 * l'améliore au lieu de la dupliquer.
 *
 * LE PRINCIPE : un entonnoir dont chaque marche est OBSERVÉE ou DÉCLARÉE
 * INCONNUE, jamais interpolée. Une marche qu'on ne mesure pas ne devient pas
 * une estimation : elle devient un trou nommé, et la fuite n'est cherchée
 * qu'entre deux marches réellement observées. Chercher au travers d'un trou
 * reviendrait à imputer une perte à une étape dont on ne sait rien.
 *
 * LA MONNAIE COMME ARBITRE. Une fuite se chiffre : combien de commandes
 * manquent, multipliées par ce que vaut une commande. C'est ce qui rend deux
 * problèmes comparables — un abandon de panier à 80 % et un CTR à 0,4 % ne se
 * discutent pas, ils se chiffrent. Ce montant alimente ensuite le classement
 * déjà en place.
 *
 * LES RÉFÉRENCES SONT DES ORDRES DE GRANDEUR, PAS DES LOIS. Elles viennent de
 * l'usage, pas des données du marchand. Elles sont donc étiquetées comme des
 * hypothèses partout où elles servent, et le montant qu'elles produisent est
 * annoncé comme une fourchette d'ordre de grandeur — jamais comme une promesse.
 *
 * Module PUR.
 */

import type { Observation } from "@/lib/observations";
import { findObservation, observationValue } from "@/lib/observations";

export const FUNNEL_STAGES = [
  "impressions",
  "clics",
  "paniers",
  "commandes",
  "commandes_conservees",
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const STAGE_LABELS: Record<FunnelStage, string> = {
  impressions: "Impressions",
  clics: "Clics",
  paniers: "Paniers ouverts",
  commandes: "Commandes payées",
  commandes_conservees: "Commandes conservées",
};

/**
 * Ce qu'on attend d'un passage d'une marche à la suivante.
 *
 * ORDRES DE GRANDEUR ISSUS DE L'USAGE, pas des données de cette boutique. Ils
 * servent à repérer une marche anormalement basse, jamais à promettre un
 * résultat. Toute conclusion qui s'en sert doit être présentée comme une
 * hypothèse — c'est écrit dans le bloc envoyé au modèle.
 */
export const REFERENCE_RATES: Record<string, { rate: number; note: string }> = {
  "impressions>clics": {
    rate: 1,
    note: "Un taux de clic autour de 1 % est courant en publicité sociale.",
  },
  "clics>paniers": {
    rate: 6,
    note: "Environ un visiteur payant sur seize ouvre un panier, tous secteurs confondus.",
  },
  "paniers>commandes": {
    rate: 30,
    note: "Sept paniers sur dix sont abandonnés : c'est la moyenne observée partout.",
  },
  "commandes>commandes_conservees": {
    rate: 95,
    note: "Au-delà de 5 % de remboursements, l'écart promesse/livraison devient coûteux.",
  },
};

export type FunnelStep = {
  stage: FunnelStage;
  label: string;
  /** Volume observé à cette marche. `null` = non mesuré. */
  value: number | null;
  /** D'où vient le chiffre. `null` s'il n'y en a pas. */
  evidence: string | null;
};

export type FunnelLeak = {
  /** Marche de départ et marche d'arrivée, toutes deux observées. */
  from: FunnelStage;
  to: FunnelStage;
  fromLabel: string;
  toLabel: string;
  entered: number;
  exited: number;
  /** Taux de passage constaté, en pourcentage. */
  rate: number;
  /** Ce qu'on attendrait, en pourcentage. Ordre de grandeur, pas une loi. */
  reference: number;
  referenceNote: string;
  /** Combien d'unités manquent par rapport à la référence. */
  missing: number;
  /**
   * Ce que cette fuite coûte par mois, quand on sait ce que vaut une
   * commande. `null` si le panier moyen est inconnu — jamais un chiffre
   * inventé pour remplir la case.
   */
  costPerMonth: number | null;
  currency: string | null;
  evidence: string[];
};

export type Funnel = {
  steps: FunnelStep[];
  /** Marches non mesurées, nommées. La fuite n'est jamais cherchée au travers. */
  unknown: FunnelStage[];
  /** Fuites entre marches consécutives OBSERVÉES, de la plus chère à la moins chère. */
  leaks: FunnelLeak[];
  /** La fuite qui coûte le plus. `null` si rien n'est chiffrable. */
  worst: FunnelLeak | null;
};

/**
 * Construit l'entonnoir à partir des observations disponibles.
 *
 * Les paniers ouverts sont la somme des paniers abandonnés et des commandes :
 * c'est la seule reconstitution possible, et elle est exacte — un panier ouvert
 * a soit abouti, soit été abandonné.
 */
export function buildFunnel(observations: Observation[]): Funnel {
  const orders = findObservation(observations, "shopify.orders_30d");
  const abandoned = findObservation(observations, "shopify.abandoned_checkouts_30d");
  const impressions = findObservation(observations, "meta.impressions_30d");
  const clicks = findObservation(observations, "meta.clicks_30d");
  const refundRate = observationValue(observations, "shopify.refund_rate_30d");
  const aov = findObservation(observations, "shopify.aov");

  const cartsValue =
    orders?.value != null && abandoned?.value != null ? orders.value + abandoned.value : null;

  const kept =
    orders?.value != null && refundRate != null
      ? Math.round(orders.value * (1 - refundRate / 100))
      : null;

  const steps: FunnelStep[] = [
    {
      stage: "impressions",
      label: STAGE_LABELS.impressions,
      value: impressions?.value ?? null,
      evidence: impressions?.evidence ?? null,
    },
    {
      stage: "clics",
      label: STAGE_LABELS.clics,
      value: clicks?.value ?? null,
      evidence: clicks?.evidence ?? null,
    },
    {
      stage: "paniers",
      label: STAGE_LABELS.paniers,
      value: cartsValue,
      evidence:
        cartsValue !== null
          ? `${cartsValue} paniers ouverts, reconstitués depuis ${orders!.value} commandes et ${abandoned!.value} abandons (Shopify)`
          : null,
    },
    {
      stage: "commandes",
      label: STAGE_LABELS.commandes,
      value: orders?.value ?? null,
      evidence: orders?.evidence ?? null,
    },
    {
      stage: "commandes_conservees",
      label: STAGE_LABELS.commandes_conservees,
      value: kept,
      evidence:
        kept !== null
          ? `${kept} commandes non remboursées, déduites d'un taux de remboursement de ${Math.round(refundRate!)} % (Shopify)`
          : null,
    },
  ];

  const unknown = steps.filter((s) => s.value === null).map((s) => s.stage);
  const value = aov?.value ?? null;
  const currency = aov?.currency ?? null;

  // LA RÈGLE : on ne cherche la fuite qu'entre deux marches CONSÉCUTIVES et
  // toutes deux observées. Enjamber une marche inconnue imputerait la perte à
  // une étape dont on ne sait rien — et c'est très exactement ainsi qu'on
  // accuse la publicité d'un problème de checkout.
  const leaks: FunnelLeak[] = [];
  for (let i = 0; i < steps.length - 1; i++) {
    const from = steps[i];
    const to = steps[i + 1];
    if (from.value === null || to.value === null || from.value <= 0) continue;

    const key = `${from.stage}>${to.stage}`;
    const reference = REFERENCE_RATES[key];
    if (!reference) continue;

    const rate = (to.value / from.value) * 100;
    if (rate >= reference.rate) continue;

    const expected = (from.value * reference.rate) / 100;
    const missing = expected - to.value;

    // Ce que la fuite coûte : seulement là où l'unité manquante est une
    // commande. Une impression perdue n'a pas de prix connu, et lui en donner
    // un fabriquerait le chiffre le plus important du rapport.
    const countsAsOrders = to.stage === "commandes" || to.stage === "commandes_conservees";
    const costPerMonth = countsAsOrders && value !== null ? missing * value : null;

    leaks.push({
      from: from.stage,
      to: to.stage,
      fromLabel: from.label,
      toLabel: to.label,
      entered: from.value,
      exited: to.value,
      rate: Math.round(rate * 100) / 100,
      reference: reference.rate,
      referenceNote: reference.note,
      missing: Math.round(missing * 10) / 10,
      costPerMonth: costPerMonth === null ? null : Math.round(costPerMonth),
      currency: countsAsOrders ? currency : null,
      evidence: [from.evidence, to.evidence].filter((e): e is string => Boolean(e)),
    });
  }

  // Le classement se fait sur l'argent quand il est connu, sur l'écart relatif
  // sinon : une fuite chiffrée passe toujours devant une fuite qui ne l'est pas.
  const sorted = [...leaks].sort((a, b) => {
    const money = (b.costPerMonth ?? -1) - (a.costPerMonth ?? -1);
    if (money !== 0) return money;
    return b.reference - b.rate - (a.reference - a.rate);
  });

  return { steps, unknown, leaks: sorted, worst: sorted[0] ?? null };
}

/**
 * Le bloc d'entonnoir injecté dans la demande d'audit.
 *
 * Il donne au modèle ce qu'aucune liste de chiffres ne donne : l'ordre des
 * marches, l'endroit exact où le volume disparaît, et ce que cette disparition
 * coûte. Les marches inconnues sont nommées pour qu'il ne les comble pas.
 */
export function funnelToPromptBlock(funnel: Funnel): string {
  const measured = funnel.steps.filter((s) => s.value !== null);
  if (measured.length < 2) {
    return `ENTONNOIR : pas assez de marches mesurées pour le reconstituer. Ne raisonne pas en entonnoir et ne suppose aucune étape.`;
  }

  const parts: string[] = [];

  parts.push(
    `ENTONNOIR MESURÉ (${measured.length} marches sur ${funnel.steps.length}) :\n` +
      funnel.steps
        .map((s) =>
          s.value === null
            ? `- ${s.label} : NON MESURÉ — n'invente pas cette marche, ne la déduis pas des voisines.`
            : `- ${s.label} : ${Math.round(s.value)} — ${s.evidence}`,
        )
        .join("\n"),
  );

  if (funnel.leaks.length === 0) {
    parts.push(
      `Aucune marche mesurée ne décroche par rapport aux ordres de grandeur habituels. Cela ne veut pas dire que tout va bien : cela veut dire que la fuite, s'il y en a une, est sur une marche non mesurée.`,
    );
  } else {
    const lines = funnel.leaks.map((l) => {
      const cost =
        l.costPerMonth !== null
          ? ` Manque à gagner estimé : ${l.costPerMonth}${l.currency ? ` ${l.currency}` : ""}/mois.`
          : " Le coût de cette marche n'est pas chiffrable sans le panier moyen.";
      return (
        `- ${l.fromLabel} → ${l.toLabel} : ${l.rate} % passent, contre ${l.reference} % attendus. ` +
        `Il manque ${l.missing} ${l.toLabel.toLowerCase()}.${cost}`
      );
    });
    parts.push(
      `OÙ LE VOLUME DISPARAÎT, de la fuite la plus chère à la moins chère :\n${lines.join("\n")}`,
    );

    if (funnel.worst) {
      parts.push(
        `LA FUITE LA PLUS COÛTEUSE est entre « ${funnel.worst.fromLabel} » et « ${funnel.worst.toLabel} ». ` +
          `C'est là que doit porter la recherche de cause, et c'est de là que doit venir ta priorité numéro un — ` +
          `sauf si les données montrent le contraire, auquel cas dis-le explicitement.`,
      );
    }
  }

  parts.push(
    `SUR LES RÉFÉRENCES : les pourcentages « attendus » sont des ORDRES DE GRANDEUR issus de l'usage, ` +
      `pas des données de cette boutique. Un écart avec eux est une PISTE, jamais une preuve. ` +
      `Toute conclusion qui s'appuie dessus doit porter confiance "medium" au plus, et le dire dans "evidence.assumptions".`,
  );

  if (funnel.unknown.length > 0) {
    parts.push(
      `MARCHES NON MESURÉES : ${funnel.unknown.map((u) => STAGE_LABELS[u]).join(", ")}. ` +
        `La fuite n'a PAS été cherchée autour d'elles, faute de chiffres. Si tu penses que le problème s'y trouve, ` +
        `dis quelle donnée il faudrait aller chercher plutôt que de conclure.`,
    );
  }

  return parts.join("\n\n");
}

/**
 * Ancre les gains estimés sur la fuite RÉELLEMENT MESURÉE.
 *
 * LE DÉFAUT QUE CELA CORRIGE. L'entonnoir chiffre la fuite à partir des
 * données de la boutique — 70 commandes manquantes à 100 € font 7 000 € par
 * mois. Le classement, lui, continuait de reposer sur `estimated_gain_min`,
 * un montant DEVINÉ par le modèle, sans aucun ancrage. Un problème réel chiffré
 * à 7 000 € pouvait donc passer derrière une piste à laquelle le modèle avait
 * spontanément attribué 12 000 €.
 *
 * La règle : quand un problème porte sur le domaine où la fuite est mesurée, sa
 * fourchette est ramenée à ce que la mesure autorise. Ni au-dessus — on ne
 * promet pas plus que ce qui fuit —, ni en dessous : la mesure fait foi contre
 * une estimation.
 *
 * PRUDENCE VOLONTAIRE : la fourchette basse est le tiers du montant mesuré.
 * Récupérer la totalité d'une fuite supposerait une correction parfaite, ce qui
 * n'arrive jamais. Mieux vaut annoncer moins et le tenir.
 */
export const RECOVERABLE_SHARE_MIN = 1 / 3;

/** Domaines concernés par chaque marche d'arrivée d'une fuite. */
const STAGE_DOMAINS: Record<FunnelStage, string[]> = {
  impressions: ["acquisition"],
  clics: ["acquisition"],
  paniers: ["produit", "offre", "boutique"],
  commandes: ["conversion"],
  commandes_conservees: ["operations", "rentabilite"],
};

export type AnchorableFinding = {
  category: string;
  estimated_gain_min?: number | null;
  estimated_gain_max?: number | null;
};

/**
 * Ramène la fourchette d'un problème à ce que la fuite mesurée autorise.
 *
 * Ne touche à rien quand la fuite n'est pas chiffrée, ou quand le problème
 * relève d'un autre domaine que la marche qui fuit : une correction de
 * rétention n'a aucune raison d'être plafonnée par une fuite de checkout.
 */
export function anchorGainsOnLeak<T extends AnchorableFinding>(
  findings: T[],
  leak: FunnelLeak | null,
): { findings: T[]; anchored: number } {
  if (!leak || leak.costPerMonth === null || leak.costPerMonth <= 0) {
    return { findings, anchored: 0 };
  }

  const domains = new Set(STAGE_DOMAINS[leak.to] ?? []);
  let anchored = 0;

  const next = findings.map((f) => {
    if (!domains.has(f.category)) return f;
    anchored += 1;
    return {
      ...f,
      estimated_gain_min: Math.round(leak.costPerMonth! * RECOVERABLE_SHARE_MIN),
      estimated_gain_max: leak.costPerMonth!,
    };
  });

  return { findings: next, anchored };
}
