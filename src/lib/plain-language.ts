/**
 * LE PRODUIT PARLE AU MARCHAND, PAS À NOUS.
 *
 * POURQUOI CE MODULE EXISTE. Le moteur manipule des notions dont l'utilisateur
 * n'a aucune raison d'avoir entendu parler : entonnoir, ShopifyQL, avatar
 * client, niveau de preuve, observation, couverture d'attribution. Ce sont de
 * bons outils de pensée pour construire le diagnostic ; ce sont de mauvais mots
 * pour le livrer.
 *
 * « Conversion non mesurée faute de sessions » est exact et inutile. Le marchand
 * n'apprend ni ce qui manque, ni pourquoi c'est gênant, ni quoi faire. Pire, la
 * phrase lui donne le sentiment que le problème vient de lui.
 *
 * TROIS CHOSES, TOUJOURS, ET DANS CET ORDRE. Ce qu'on ne peut pas encore faire,
 * pourquoi c'est important pour SA boutique, et le geste exact qui débloque. Une
 * absence de donnée présentée sans le troisième élément est une plainte ; avec
 * lui, c'est une prochaine étape.
 *
 * Module PUR.
 */

export type PlainExplanation = {
  /** Ce qui manque, dit sans jargon. */
  what: string;
  /** Pourquoi cela compte pour cette boutique. */
  why: string;
  /** Le geste exact. Jamais « connectez une source de données ». */
  how: string;
  /** Ce que cela permettra de découvrir, concrètement. */
  unlocks: string;
};

/**
 * Ce que chaque donnée manquante veut dire, en français de marchand.
 *
 * La clé est l'identifiant technique du trou ; la valeur est ce que
 * l'utilisateur lit. Aucune de ces phrases ne contient un mot du moteur — c'est
 * vérifié par un test, parce que ce genre de vocabulaire revient tout seul dès
 * qu'on ajoute une entrée sans y penser.
 */
export const EXPLANATIONS: Record<string, PlainExplanation> = {
  "shopify.sessions_30d": {
    what: "Nous ne savons pas encore combien de personnes visitent votre boutique.",
    why: "Sans ce chiffre, impossible de dire si vous manquez de visiteurs ou si vos visiteurs n'achètent pas. Ce sont deux problèmes opposés, et ils ne se corrigent pas du tout de la même façon : l'un demande de la publicité, l'autre demande de retoucher vos pages.",
    how: "Dans Shopify, vérifiez que l'application EcomPilot a bien accès aux statistiques de votre boutique. Si l'autorisation a été refusée, reconnectez la boutique depuis l'onglet Connexions.",
    unlocks:
      "Nous pourrons vous dire combien de visiteurs il vous faut pour une vente, et à quel moment exact ils s'en vont.",
  },
  "shopify.conversion_rate": {
    what: "Votre taux de transformation n'est pas encore calculable.",
    why: "Il faut un minimum de visites pour qu'un pourcentage veuille dire quelque chose. En dessous, une seule commande de plus ou de moins ferait bouger le chiffre de plusieurs points, et vous prendriez des décisions sur du bruit.",
    how: "Rien à faire de votre côté : le chiffre apparaîtra de lui-même quand votre boutique aura reçu assez de visites.",
    unlocks:
      "Nous pourrons comparer votre boutique à elle-même dans le temps, et voir si vos corrections font effet.",
  },
  "shopify.product_views_30d": {
    what: "Nous ne savons pas quels produits sont les plus regardés.",
    why: "C'est ce qui distingue un produit que personne ne voit d'un produit que tout le monde voit et que personne n'achète. Le premier a un problème de mise en avant, le second un problème de fiche ou de prix.",
    how: "Cette donnée arrive avec les statistiques de votre boutique Shopify, comme le nombre de visites.",
    unlocks:
      "Nous pourrons vous dire par quelle fiche produit commencer, plutôt que de vous demander de toutes les retoucher.",
  },
  "organic.order_origin": {
    what: "Nous ne savons pas d'où viennent vos commandes.",
    why: "Sans cette information, impossible de savoir si votre budget publicitaire rapporte quelque chose. Les régies publicitaires déclarent leurs propres résultats — elles sont juges et parties, et leurs chiffres comptent souvent des ventes qui auraient eu lieu de toute façon.",
    how: "Ajoutez un suffixe à tous les liens qui mènent à votre boutique — publicités, e-mails, publications, lien de votre profil Instagram. Par exemple : votreboutique.com/produit?utm_source=instagram",
    unlocks:
      "Nous pourrons confronter ce que la publicité prétend vous rapporter à ce que vous avez réellement encaissé.",
  },
  "organic.attribution_coverage": {
    what: "La plupart de vos commandes n'indiquent pas d'où vient l'acheteur.",
    why: "Vous pilotez votre budget publicitaire sans savoir ce qu'il produit. C'est le poste de dépense où l'on perd le plus vite, précisément parce que l'erreur ne se voit pas.",
    how: "Ajoutez un suffixe de suivi à vos liens publicitaires et à vos e-mails. Votre régie publicitaire propose de le faire automatiquement dans ses réglages.",
    unlocks: "Nous pourrons vous dire quelle source vous coûte plus qu'elle ne rapporte.",
  },
  "storefront.reachable": {
    what: "Nous n'avons pas réussi à ouvrir votre boutique en ligne.",
    why: "Tant que la page ne répond pas, nous ne pouvons rien dire de ce que vos visiteurs voient. Et si nous ne pouvons pas l'ouvrir, il est possible que certains d'entre eux ne le puissent pas non plus.",
    how: "Vérifiez que votre boutique n'est pas protégée par un mot de passe : Shopify → Boutique en ligne → Préférences → Protection par mot de passe.",
    unlocks:
      "Nous pourrons analyser votre page d'accueil, vos fiches produit et votre parcours d'achat comme le ferait un visiteur.",
  },
  "storefront.core_web_vitals": {
    what: "Nous ne mesurons pas la vitesse réelle de votre site chez vos visiteurs.",
    why: "Le temps de réponse que nous mesurons est celui de notre serveur, pas celui d'un téléphone en 4G. La différence peut être de plusieurs secondes.",
    how: "Aucune action nécessaire pour l'instant. Cette mesure demande un outil séparé que nous n'utilisons pas encore.",
    unlocks:
      "Nous pourrions dire si la lenteur vous coûte réellement des ventes, au lieu de le supposer.",
  },
  "storefront.checkout_funnel": {
    what: "Nous n'ouvrons pas votre tunnel de commande.",
    why: "Passer commande pour vérifier reviendrait à créer une vraie commande dans votre boutique. Nous ne touchons jamais à vos données.",
    how: "Passez vous-même une commande test depuis un téléphone, jusqu'au paiement, et notez l'étape où quelque chose surprend.",
    unlocks:
      "C'est le seul moyen fiable de savoir si le paiement lui-même fait fuir vos acheteurs.",
  },
  "meta.spend_30d": {
    what: "Votre compte publicitaire Meta n'est pas connecté.",
    why: "Sans lui, nous voyons vos ventes mais pas ce qu'elles vous ont coûté. Une boutique qui vend beaucoup en perdant de l'argent sur chaque commande ressemble, de l'extérieur, à une boutique qui marche.",
    how: "Onglet Connexions → Meta Ads → Connecter. L'autorisation se fait avec votre compte Facebook habituel.",
    unlocks:
      "Nous pourrons dire combien vous coûte réellement une commande, et quelles campagnes vous font perdre de l'argent.",
  },
  "google.spend_30d": {
    what: "Votre compte Google Ads n'est pas connecté.",
    why: "Si vous dépensez sur Google sans que nous le sachions, nous attribuerons vos ventes aux mauvaises sources — et nos conseils sur votre budget seront faux.",
    how: "Onglet Connexions → Google Ads → Connecter.",
    unlocks:
      "Nous pourrons comparer vos deux canaux publicitaires et vous dire lequel mérite votre prochain euro.",
  },
};

/**
 * Repli quand aucune explication n'est écrite pour ce trou.
 *
 * Volontairement modeste : mieux vaut une phrase vraie et générale qu'une
 * explication inventée qui aurait l'air précise. Le repli sert aussi de rappel —
 * un trou qui remonte souvent ici mérite sa propre entrée.
 */
export function fallbackExplanation(label: string): PlainExplanation {
  return {
    what: `Nous n'avons pas encore accès à cette information : ${label.toLowerCase()}.`,
    why: "Sans elle, une partie de l'analyse reste incomplète. Nous préférons vous le dire plutôt que de combler le vide par une estimation.",
    how: "Aucune action de votre part n'est nécessaire pour l'instant.",
    unlocks: "Cette partie de l'analyse s'ouvrira dès que la donnée sera disponible.",
  };
}

export function explain(gapId: string, label: string): PlainExplanation {
  return EXPLANATIONS[gapId] ?? fallbackExplanation(label);
}

/**
 * Mots du moteur qui ne doivent jamais atteindre l'écran du marchand.
 *
 * Exportés pour être testables : une liste d'interdits qu'aucun test ne vérifie
 * est une intention, pas une règle. Le vocabulaire technique revient tout seul
 * dès qu'on ajoute une entrée sans y penser — c'est pour cela que le contrôle
 * est mécanique.
 */
export const JARGON = [
  "shopifyql",
  "entonnoir",
  "funnel",
  "avatar",
  "niveau de preuve",
  "observation",
  "scoring",
  "api",
  "endpoint",
  "attribution",
  "couverture",
  "échantillon",
  "requête",
  "connecteur",
];

/** Rend l'explication complète, prête à afficher. */
export function explanationToText(e: PlainExplanation): string {
  return [
    e.what,
    e.why,
    `Ce qu'il faut faire : ${e.how}`,
    `Ce que cela ouvrira : ${e.unlocks}`,
  ].join("\n");
}
