/**
 * UNE HYPOTHÈSE NE PEUT PAS CONTREDIRE UN FAIT QUE NOUS AVONS MESURÉ.
 *
 * LE DÉFAUT, RELEVÉ SUR UN RAPPORT RÉEL. Le moteur avait compté le catalogue de
 * la boutique : ZÉRO produit. Le fait était mesuré, classé premier, et présent
 * dans le bloc envoyé au modèle. Sur un autre constat de la même page, le
 * rapport affichait pourtant :
 *
 *   « Ce que nous supposons : Le catalogue contient des produits actifs et
 *     publiés dans l'administration Shopify, mais aucun lien n'a été créé pour
 *     les afficher sur la page d'accueil. »
 *
 * Le rapport se contredisait à deux constats d'écart. Pire que faux : il
 * inventait une CAUSE ALTERNATIVE — des produits mal reliés — là où la vraie
 * cause était déjà établie, et il envoyait le marchand créer des liens vers des
 * produits qui n'existent pas.
 *
 * POURQUOI LE PROMPT NE SUFFISAIT PAS. Les consignes interdisent déjà d'inventer
 * et exigent de reprendre les constats du moteur. Le modèle les a suivies pour
 * le constat principal — le catalogue vide FIGURE bien dans le rapport — puis
 * les a contredites deux paragraphes plus bas, dans un champ que rien ne
 * vérifiait. `sanitizeAuditPayload` recopie `assumptions` mot pour mot : la
 * seule barrière était une phrase de consigne, c'est-à-dire aucune.
 *
 * CE QUE FAIT CE MODULE. Il confronte le texte rendu aux faits MESURÉS, en
 * dehors du modèle, de façon déterministe. Une phrase qui affirme le contraire
 * de ce que nous avons compté est retirée et remplacée par ce que nous savons.
 * Le modèle peut se tromper ; il ne peut plus publier la contradiction.
 *
 * LES TROIS ÉTATS QUE CE MODULE MAINTIENT SÉPARÉS :
 *
 *   FAIT MESURÉ        `product_count = 0` — compté, opposable.
 *   FAIT NON MESURÉ    « nous ne savons pas si les fiches sont publiées ».
 *   HYPOTHÈSE          « elles pourraient ne pas l'être ». Permise tant qu'elle
 *                      ne contredit aucun fait mesuré.
 *
 * Une hypothèse n'est bannie que lorsqu'un fait la dément. Sur une boutique dont
 * le catalogue n'a PAS pu être compté, la même phrase reste autorisée : c'est
 * l'absence de mesure qui la rendait légitime, et cette absence est réelle.
 *
 * Module PUR.
 */

import type { Observation } from "@/lib/observations";

export type FaitOpposable = {
  /** L'observation qui fait foi. */
  observation: string;
  /** Le fait tient-il, à cette valeur ? */
  etabliQuand: (valeur: number) => boolean;
  /**
   * Ce qu'une phrase affirme quand elle contredit ce fait.
   *
   * Cherché sur des PHRASES, pas sur le texte entier : une contradiction se
   * retire par phrase, sinon on perdrait ce que le reste disait de juste.
   */
  affirme: RegExp[];
  /** Ce que le moteur sait, et qui prend la place. */
  faitDit: string;
  /** Pour le journal, jamais montré au marchand. */
  libelle: string;
};

/**
 * Marques de négation d'existence.
 *
 * « Aucun produit actif n'a été trouvé » contient « produit actif » sans rien
 * affirmer de contraire au fait. Sans cette garde, le module retirerait
 * précisément les phrases qui disent la vérité.
 */
const NIE_L_EXISTENCE = /\b(aucun|aucune|pas|plus|jamais|ni|zéro|vide|sans|dépourvu)\b|\bn'/i;

/**
 * Fenêtre examinée AVANT l'affirmation pour y chercher une négation.
 *
 * Assez large pour couvrir « ne contient toujours aucun », assez étroite pour
 * ne pas ramasser une négation qui porte sur une autre proposition.
 */
const PORTEE_DE_LA_NEGATION = 40;

/**
 * LA NÉGATION DOIT PORTER SUR L'AFFIRMATION, PAS SUR LA PHRASE.
 *
 * CE QUE LA PREMIÈRE VERSION FAISAIT, ET CE QUE LE TEST DE BOUT EN BOUT A
 * ATTRAPÉ. Elle écartait toute phrase contenant une marque de négation, où
 * qu'elle soit. Or la contradiction réellement produite en production était :
 *
 *   « Le catalogue contient des produits actifs et publiés dans
 *     l'administration Shopify, MAIS AUCUN LIEN n'a été créé pour les afficher
 *     sur la page d'accueil. »
 *
 * Une seule phrase, qui affirme l'existence des produits ET nie celle des
 * liens. Le « aucun » de la seconde moitié protégeait l'affirmation de la
 * première : le filtre laissait passer exactement ce qu'il devait retirer.
 *
 * La négation n'est donc plus cherchée dans la phrase, mais dans les quelques
 * mots QUI PRÉCÈDENT l'affirmation — là où elle la qualifie réellement.
 */
function affirmationNiee(phrase: string, position: number): boolean {
  const avant = phrase.slice(Math.max(0, position - PORTEE_DE_LA_NEGATION), position);
  return NIE_L_EXISTENCE.test(avant);
}

export const FAITS_OPPOSABLES: FaitOpposable[] = [
  {
    observation: "shopify.product_count",
    etabliQuand: (v) => v === 0,
    libelle: "catalogue vide",
    affirme: [
      /catalogue\s+(contient|comporte|comprend|possède|a)\b/i,
      /\bproduits?\s+(actifs?|publiés?|existants?|enregistrés?|en ligne|du catalogue)\b/i,
      /\b(vos|les|des|ces)\s+produits\s+(sont|ont|existent|figurent|apparaissent|se trouvent)\b/i,
      /\b(vos|les)\s+(fiches|collections)\s+(produit\s+)?(sont|existent|ont)\b/i,
      /\bproduits?\s+(déjà\s+)?(créés?|ajoutés?)\b/i,
    ],
    faitDit: "Nous avons compté le catalogue Shopify : aucun produit n'y est enregistré.",
  },
  {
    observation: "shopify.orders_30d",
    etabliQuand: (v) => v === 0,
    libelle: "aucune commande sur la période",
    affirme: [
      /\b(vos|les|des)\s+(clients|acheteurs)\s+(achètent|commandent|ont acheté|ont commandé)\b/i,
      /\b(vos|les)\s+commandes\s+(récentes|actuelles|montrent|indiquent|sont)\b/i,
      /\bventes\s+(actuelles|récentes|réalisées|enregistrées)\b/i,
    ],
    faitDit: "Nous avons compté vos commandes sur la période : il n'y en a aucune.",
  },
];

/** Les faits qui tiennent réellement, au vu des observations de cet audit. */
export function faitsEtablis(observations: Observation[]): FaitOpposable[] {
  return FAITS_OPPOSABLES.filter((fait) => {
    const o = observations.find((obs) => obs.id === fait.observation);
    // PAS DE MESURE, PAS DE FAIT OPPOSABLE. Une donnée qu'on n'a pas comptée ne
    // peut contredire personne — et c'est justement là que l'hypothèse
    // redevient légitime.
    if (!o || o.value === null || !Number.isFinite(o.value)) return false;
    return fait.etabliQuand(o.value);
  });
}

/** Découpe en phrases, en gardant leur ponctuation finale. */
function phrases(texte: string): string[] {
  return texte
    .split(/(?<=[.!?…])\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export type Confrontation = {
  /** Le texte débarrassé de ce qui contredisait un fait mesuré. */
  texte: string;
  /** Ce qui a été retiré, pour le journal. */
  retire: string[];
};

/**
 * Confronte un texte aux faits mesurés.
 *
 * Retire les PHRASES qui affirment le contraire de ce qui a été compté, et
 * remet ce que le moteur sait à la place. Un texte entièrement contredit n'est
 * pas laissé vide : il devient le fait lui-même, qui est toujours plus utile
 * qu'un blanc.
 */
export function confronter(texte: string, faits: FaitOpposable[]): Confrontation {
  if (!texte.trim() || faits.length === 0) return { texte, retire: [] };

  const retire: string[] = [];
  const remplacements = new Set<string>();

  const gardees = phrases(texte).filter((phrase) => {
    for (const fait of faits) {
      for (const motif of fait.affirme) {
        const trouve = motif.exec(phrase);
        // Une négation qui PRÉCÈDE l'affirmation la retourne : « aucun produit
        // actif » ne contredit pas un catalogue vide, il le confirme.
        if (!trouve || affirmationNiee(phrase, trouve.index)) continue;
        retire.push(`${fait.libelle} contredit par : « ${phrase} »`);
        remplacements.add(fait.faitDit);
        return false;
      }
    }
    return true;
  });

  if (retire.length === 0) return { texte, retire: [] };

  const reconstruit = [...gardees, ...remplacements].join(" ").trim();
  return { texte: reconstruit, retire };
}
