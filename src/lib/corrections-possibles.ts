/**
 * CE QUE NOS OUTILS SAVENT RÉELLEMENT ÉCRIRE — ET DONC QUAND PROPOSER LE BOUTON.
 *
 * LE DÉFAUT, RELEVÉ SUR UN RAPPORT RÉEL. « Préparer la correction » était offert
 * sur CHAQUE constat. Le marchand cliquait, attendait, et lisait « Pas de
 * correction automatique ici » — quatre fois sur quatre. La réponse était juste :
 * aucun outil connecté ne sait éditer un thème, un menu, une page de politique
 * ou les réglages de référencement d'une boutique. Mais elle coûtait un appel au
 * modèle POUR APPRENDRE NON, et elle transformait le seul bouton mis en avant du
 * rapport en promesse non tenue.
 *
 * Un intitulé est un engagement. Un bouton qui échoue systématiquement coûte
 * plus cher qu'un bouton absent : il apprend à ne pas cliquer sur les autres.
 *
 * CE QUE CE MODULE N'EST PAS. Ce n'est pas une opinion sur ce qui MÉRITERAIT
 * d'être automatisé. C'est l'inventaire de ce que les outils branchés savent
 * écrire aujourd'hui, et il est court :
 *
 *   Shopify        réécrire le titre et la description d'une FICHE PRODUIT,
 *                  créer un code promo.
 *   Meta Ads       budget, mise en pause, ciblage, texte de la publicité.
 *   Google Ads     budget, mise en pause, mots-clés exclus, texte de l'annonce.
 *
 * Aucun ne touche au thème, aux pages, à la navigation, aux politiques, ni aux
 * réglages de la boutique. C'est là que se trouvent la plupart des constats d'un
 * premier audit, et c'est pourquoi le refus était la règle plutôt que
 * l'exception.
 *
 * POURQUOI UNE LISTE BLANCHE, ET NON UNE LISTE NOIRE. Un constat inconnu de ce
 * module est déclaré NON automatisable. Se tromper dans ce sens coûte un bouton
 * qui manque, et le marchand a les étapes juste au-dessus ; se tromper dans
 * l'autre sens redonne le bouton qui échoue, c'est-à-dire le défaut qu'on
 * corrige. Le doute profite à l'honnêteté.
 *
 * Module PUR : le même verdict est rendu par l'écran, qui décide d'afficher le
 * bouton, et par le serveur, qui refuse avant de dépenser un appel au modèle.
 * Deux réponses différentes seraient pires que pas de réponse du tout.
 */

/** Canaux dont nous savons écrire quelque chose, quand ils sont connectés. */
export type CanalCorrigible = "shopify" | "meta_ads" | "google_ads";

/**
 * Constats pour lesquels un outil existe VRAIMENT, et lequel.
 *
 * La clé est celle du moteur (`finding_key`). Trois entrées sur trente-cinq
 * règles : ce n'est pas un oubli, c'est l'état réel de la surface d'écriture.
 */
export const OUTIL_PAR_CONSTAT: Record<string, CanalCorrigible[]> = {
  // `update_product` réécrit titre et description : c'est exactement ce qui
  // manque ici.
  "merchandising.descriptions_missing": ["shopify"],
  // Le délai et le montant de livraison s'écrivent dans la description de la
  // fiche, faute de pouvoir toucher au thème.
  "conversion.livraison_absente_fiche": ["shopify"],
  // Budget et mise en pause sont exactement les gestes que ce constat appelle.
  "acquisition.spend_without_purchase": ["meta_ads", "google_ads"],
};

/**
 * Repli quand le constat ne porte pas de clé connue.
 *
 * Le `finding_key` est renseigné par le modèle : il peut manquer, ou nommer une
 * règle qui n'existe plus. La catégorie, elle, est contrainte par le schéma de
 * sortie. Elle est plus grossière — d'où une liste encore plus courte.
 */
const CANAUX_PAR_CATEGORIE: Record<string, CanalCorrigible[]> = {
  produit: ["shopify"],
  acquisition: ["meta_ads", "google_ads"],
};

export type Faisabilite =
  { possible: true; canaux: CanalCorrigible[] } | { possible: false; raison: string };

/** Nom que le marchand connaît. Jamais l'identifiant technique. */
const NOM_CANAL: Record<CanalCorrigible, string> = {
  shopify: "Shopify",
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
};

/**
 * Une correction automatique est-elle possible pour ce constat ?
 *
 * Le refus porte sa raison, et la raison distingue les deux cas que le marchand
 * ne doit surtout pas confondre : « aucun outil ne sait faire cela » — il n'y a
 * rien à brancher, les étapes manuelles sont la seule voie — et « l'outil
 * existe mais le canal n'est pas connecté » — là, un branchement change tout.
 */
export function correctionPossible(input: {
  findingKey: string | null;
  category: string | null;
  canauxConnectes: CanalCorrigible[];
}): Faisabilite {
  const { findingKey, category, canauxConnectes } = input;

  const requis =
    (findingKey ? OUTIL_PAR_CONSTAT[findingKey] : undefined) ??
    (findingKey ? undefined : category ? CANAUX_PAR_CATEGORIE[category] : undefined);

  if (!requis || requis.length === 0) {
    return {
      possible: false,
      raison:
        "Aucun de nos outils n'écrit à cet endroit : ils savent réécrire une fiche produit et piloter vos publicités, pas modifier un thème, une page, un menu ni les réglages de la boutique.",
    };
  }

  const disponibles = requis.filter((c) => canauxConnectes.includes(c));
  if (disponibles.length === 0) {
    const noms = requis.map((c) => NOM_CANAL[c]).join(" ou ");
    return {
      possible: false,
      raison: `Nous saurions préparer cette correction, mais ${noms} n'est pas connecté à cette boutique. Branchez-le depuis Sources de données pour que nous puissions l'écrire à votre place.`,
    };
  }

  return { possible: true, canaux: disponibles };
}
