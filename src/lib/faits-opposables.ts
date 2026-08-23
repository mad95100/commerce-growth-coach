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
   * LES MOTS QUI DÉSIGNENT LA CHOSE COMPTÉE.
   *
   * C'est ici que tient l'inversion. La première version listait les
   * AFFIRMATIONS interdites — « le catalogue contient », « les produits sont
   * publiés » — c'est-à-dire une liste noire. Une liste noire perd toujours :
   * mise à l'épreuve, elle laissait passer dix formulations sur douze. Il
   * suffisait d'écrire « articles », « références », « gamme », « fiches
   * existantes » ou « votre offre est déjà enregistrée » pour la contourner.
   *
   * Le lexique décrit le SUJET, pas la façon d'en parler. Toute phrase qui
   * parle de la chose comptée est suspecte par défaut ; elle n'est autorisée
   * que si elle NIE son existence ou si elle PRESCRIT de la créer. Les
   * synonymes ne sont plus une échappatoire : ils sont dans le lexique, ou la
   * phrase ne parle pas du sujet.
   */
  lexique: RegExp;
  /** Ce que le moteur sait, et qui prend la place. */
  faitDit: string;
  /** Pour le journal, jamais montré au marchand. */
  libelle: string;
};

/**
 * Négations d'existence, y compris le zéro écrit en chiffre.
 *
 * « Nous avons compté 0 produit » nie l'existence aussi sûrement que « aucun
 * produit » : sans le chiffre, le garde-fou retirerait la phrase la plus juste
 * du rapport.
 */
const NIE = /\b(aucun|aucune|pas|plus|jamais|ni|non|z[ée]ro|vide|sans|d[ée]pourvu|0)\b|\bn'/i;

/**
 * PRESCRIRE N'EST PAS AFFIRMER.
 *
 * « Créez un premier produit depuis Produits puis publiez-le » parle bien de
 * produits, sans négation, et ne contredit pourtant rien : elle demande d'en
 * créer. Sans cette garde, le module retirerait précisément les recommandations
 * qui répondent au problème qu'il protège.
 */
const PRESCRIT =
  /\b(cr[ée]e[zr]?|ajoute[zr]?|publie[zr]?|importe[zr]?|renseigne[zr]?|commence[zr]?|mette?[zr]?\s+en\s+ligne)\b/i;

/**
 * Connecteurs qui affirment une CAUSE.
 *
 * Distincts d'une conséquence logique : « aucune commande ne peut être passée
 * tant qu'il n'y a rien à commander » est une nécessité, pas une mesure. Ces
 * connecteurs-là, eux, prétendent expliquer un chiffre par un autre fait — ce
 * qui demanderait une mesure que nous n'avons jamais.
 */
/**
 * Causalité par la privation : « sans X, Y ne peut pas ».
 *
 * Relevée au troisième jeu adversarial : « Sans bouton d'achat, vos ventes ne
 * peuvent pas décoller. » Le « sans » y passe pour une négation qui protège la
 * phrase, alors qu'il ouvre une CONDITION — et la phrase affirme ensuite un
 * lien de cause que rien ne mesure. C'est la même faute que « parce que »,
 * habillée autrement.
 */
const CAUSALITE_PAR_PRIVATION =
  /\bsans\b[^.!?]{0,60}\bne\s+(peu[tx]|peuvent|pourra|pourront|pourrait|parvien\w*|arrive\w*)\b/i;

const CAUSALITE =
  /\b(parce que|car|à cause de|en raison de|du fait (que|de)|s'explique par|r[ée]sulte de|est d[ûu] [àa]|ce qui explique|provoque|entra[îi]ne|cause de ce)\b/i;

/** Fenêtre autour du mot du lexique où une négation le qualifie encore. */
const PORTEE_DE_LA_NEGATION = 30;

/**
 * DIRE QU'ON NE SAIT PAS N'EST JAMAIS UNE HALLUCINATION.
 *
 * Faux positif relevé au jeu adversarial, sur la formulation même que le
 * produit cherche à obtenir :
 *
 *   « L'absence de chemin vers les produits constitue un blocage identifié,
 *     mais son impact sur les commandes N'EST PAS MESURÉ. »
 *
 * La négation y porte sur « mesuré » — ni sur l'existence des commandes, ni sur
 * un attribut qu'elle leur prêterait. C'est une phrase qui déclare la limite de
 * ce que nous savons, et c'est précisément ce que le rapport doit faire. La
 * retirer reviendrait à punir la prudence.
 */
const DECLARE_LA_NON_MESURE =
  /\b(n'est pas mesur|ne sont pas mesur|non mesur|pas mesurable|ne mesurons pas|n'a pas pu être mesur|n'est pas chiffr|non chiffrable|ne disposons pas|impossible [àa] chiffrer|n'est pas [ée]tabli)/i;

/**
 * NIER UNE EXISTENCE, OU NIER UN ATTRIBUT — CE N'EST PAS LA MÊME CHOSE.
 *
 * Deux formulations ont survécu au premier jeu adversarial :
 *
 *   « Les articles du catalogue ne sont pas RELIÉS à la page d'accueil. »
 *   « Les produits que vous vendez ne sont pas MIS EN AVANT. »
 *
 * Toutes deux portent une négation près du mot, toutes deux présupposent que
 * les articles existent : la négation y porte sur ce qu'on en FAIT, jamais sur
 * le fait qu'ils soient là. Une négation d'attribut ne dément pas un compte.
 *
 * Ces verbes-là, en revanche, portent bien sur l'existence. « Vos produits ne
 * sont pas encore CRÉÉS » est vrai sur un catalogue vide, et doit rester.
 * `être` et `avoir` en sont volontairement absents : trop généraux, ils
 * laisseraient repasser tout ce que cette distinction vient d'écarter.
 */
const VERBE_D_EXISTENCE =
  /\b(exist\w*|enregistr\w*|cr[ée]{1,2}\w*|publi\w*|trouv\w*|figur\w*|contien\w*|comport\w*|recens\w*|ajout\w*|import\w*|saisi\w*|r[ée]f[ée]renc\w*)\b/i;

export const FAITS_OPPOSABLES: FaitOpposable[] = [
  {
    observation: "shopify.product_count",
    etabliQuand: (v) => v === 0,
    libelle: "catalogue vide",
    lexique:
      /\b(produits?|articles?|r[ée]f[ée]rences?|fiches?(\s+produits?)?|gammes?|catalogues?|collections?|offre)\b/i,
    faitDit: "Nous avons compté le catalogue Shopify : aucun produit n'y est enregistré.",
  },
  {
    observation: "shopify.orders_30d",
    etabliQuand: (v) => v === 0,
    libelle: "aucune commande sur la période",
    lexique: /\b(commandes?|ventes?|acheteurs?|clients?|chiffre d'affaires)\b/i,
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
 * LA NÉGATION DOIT PORTER SUR LE MOT, PAS SUR LA PHRASE.
 *
 * La contradiction réellement produite en production était : « Le catalogue
 * contient des produits actifs et publiés …, MAIS AUCUN LIEN n'a été créé pour
 * les afficher ». Une seule phrase, qui affirme l'existence des produits ET nie
 * celle des liens. Une négation cherchée dans toute la phrase protégeait donc
 * l'affirmation : le filtre laissait passer ce qu'il devait retirer.
 *
 * Elle est cherchée dans une fenêtre étroite AUTOUR du mot — des deux côtés,
 * parce que « vos produits ne sont pas créés » place la négation après.
 */
function motNie(phrase: string, position: number, longueur: number): boolean {
  const avant = phrase.slice(Math.max(0, position - PORTEE_DE_LA_NEGATION), position);
  // UNE NÉGATION QUI PRÉCÈDE LE MOT NIE TOUJOURS SON EXISTENCE : « aucun
  // produit », « pas de fiche », « 0 produit ». Aucune ambiguïté possible.
  if (NIE.test(avant)) return true;

  // UNE NÉGATION QUI SUIT LE MOT ne nie son existence que si elle porte sur un
  // verbe d'existence. « ne sont pas encore créés » nie ; « ne sont pas reliés »
  // présuppose au contraire qu'ils existent.
  const apres = phrase.slice(position + longueur, position + longueur + PORTEE_DE_LA_NEGATION * 2);
  return NIE.test(apres) && VERBE_D_EXISTENCE.test(apres);
}

/**
 * Confronte un texte aux faits mesurés.
 *
 * Une phrase qui parle de la chose comptée est retirée, SAUF si elle nie son
 * existence ou prescrit de la créer. Un texte entièrement contredit devient le
 * fait lui-même, toujours plus utile qu'un blanc.
 */
export function confronter(texte: string, faits: FaitOpposable[]): Confrontation {
  if (!texte.trim() || faits.length === 0) return { texte, retire: [] };

  const retire: string[] = [];
  const remplacements = new Set<string>();

  const gardees = phrases(texte).filter((phrase) => {
    for (const fait of faits) {
      const trouve = fait.lexique.exec(phrase);
      if (!trouve) continue;

      // PRESCRIRE N'EST PAS AFFIRMER : « créez un premier produit » est la
      // réponse au problème, pas sa contradiction.
      if (PRESCRIT.test(phrase)) continue;

      // DÉCLARER UNE LIMITE N'EST PAS AFFIRMER. Vérifié dans la même fenêtre
      // que la négation : « vos produits sont publiés, mais leur impact n'est
      // pas mesuré » parle bien de produits présents, et reste écarté.
      const fenetre = phrase.slice(
        Math.max(0, trouve.index - PORTEE_DE_LA_NEGATION),
        trouve.index + trouve[0].length + PORTEE_DE_LA_NEGATION * 2,
      );
      if (DECLARE_LA_NON_MESURE.test(fenetre) && !VERBE_D_EXISTENCE.test(fenetre)) continue;

      const nie = motNie(phrase, trouve.index, trouve[0].length);

      // UNE CAUSE AFFIRMÉE RESTE INTERDITE, MÊME SUR UN CHIFFRE NIÉ. « Vous
      // n'avez aucune commande PARCE QUE votre page d'accueil n'a pas de
      // bouton » nie bien le chiffre — et invente le lien qui l'explique, que
      // rien ne mesure.
      if (nie && !CAUSALITE.test(phrase) && !CAUSALITE_PAR_PRIVATION.test(phrase)) continue;

      retire.push(
        `${fait.libelle} — ${nie ? "causalité non mesurée" : "existence affirmée"} : « ${phrase} »`,
      );
      remplacements.add(fait.faitDit);
      return false;
    }
    return true;
  });

  if (retire.length === 0) return { texte, retire: [] };

  const reconstruit = [...gardees, ...remplacements].join(" ").trim();
  return { texte: reconstruit, retire };
}

/**
 * UNE RECOMMANDATION NE DEMANDE PAS D'AGIR SUR CE QUI N'EXISTE PAS.
 *
 * POURQUOI CE CONTRÔLE EST DISTINCT DE `confronter`, ET POURQUOI LES CONFONDRE
 * ÉTAIT UNE ERREUR. Les deux surfaces ne portent pas le même risque.
 *
 * Le texte du MODÈLE peut affirmer n'importe quoi : il est régénéré à chaque
 * audit, personne ne le relit avant publication, et c'est là que vivent les
 * hallucinations. `confronter` y traque l'existence affirmée.
 *
 * Le texte des RÈGLES est déterministe, versionné, relu. Il n'hallucine pas —
 * mais il peut faire pire pour le marchand : lui demander un geste
 * IMPOSSIBLE. C'est le défaut qui a lancé toute cette affaire, quand
 * `parcours.entree_catalogue_absente` conseillait « ajoutez une section de
 * collections mises en avant » à une boutique sans catalogue.
 *
 * Appliquer `confronter` aux textes de règles produisait quatre faux positifs,
 * tous du même genre : des phrases GÉNÉRIQUES ou CONDITIONNELLES — « la
 * rétention se mesure sur des clients qui reviennent », « un seul produit
 * suffit à rendre le reste applicable ». Elles n'attribuent rien à cette
 * boutique-ci ; les écarter n'aurait rien protégé et aurait appauvri le
 * rapport.
 *
 * Ce contrôle ne cherche donc qu'une chose : un geste de MANIPULATION —
 * relier, mettre en avant, réécrire, classer — appliqué à une ressource dont
 * nous avons compté zéro exemplaire. Créer n'en fait pas partie : c'est
 * précisément ce qu'il faut faire.
 */
const MANIPULE_L_EXISTANT =
  /\b(reli(e|er|ez)|li(er|ez)|mett(re|ez)\s+en\s+avant|mise\s+en\s+avant|affich(er|ez)|organis(er|ez)|class(er|ez)|tri(er|ez)|regroup(er|ez)|r[ée]organis(er|ez)|optimis(er|ez)|retouch(er|ez)|r[ée][ée]cri(re|vez)|am[ée]lior(er|ez)|corrig(er|ez)|compl[ée]t(er|ez)|illustr(er|ez)|d[ée]cri(re|vez)|mett(re|ez)\s+[àa]\s+jour)\b/i;

/**
 * Marques d'une phrase qui parle du FUTUR ou d'une CONDITION.
 *
 * « La mise en avant des collections viendra quand le catalogue portera des
 * produits » demande bien une manipulation — mais la subordonne explicitement à
 * l'existence des produits. C'est la bonne façon de dire les choses, pas une
 * faute.
 */
const CONDITIONNE =
  /\b(quand|lorsque|une fois|d[èe]s que|apr[èe]s (avoir|que)|viendra|viendront|pourra|pourrez|pourront|sera|seront|calculera|portera|serait|pourrait|mesurerait|suffit [àa])\b/i;

/**
 * `true` si cette recommandation demande d'agir sur une ressource comptée à
 * zéro, sans conditionner ce geste à son existence.
 */
export function recommandationImpossible(texte: string, faits: FaitOpposable[]): string | null {
  if (!texte.trim() || faits.length === 0) return null;
  for (const phrase of phrases(texte)) {
    if (CONDITIONNE.test(phrase)) continue;
    if (!MANIPULE_L_EXISTANT.test(phrase)) continue;
    const fait = faits.find((f) => f.lexique.test(phrase));
    if (fait) return `${fait.libelle} — geste impossible : « ${phrase} »`;
  }
  return null;
}
