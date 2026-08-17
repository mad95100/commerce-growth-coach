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

  // --- UNE SOURCE ENTIÈRE N'A PAS RÉPONDU ----------------------------------
  // Le texte de repli disait « Source injoignable — aucune donnée de ce
  // canal ». Le marchand y lit une panne sans savoir si elle est chez lui,
  // chez nous, ou chez le fournisseur — donc sans savoir s'il doit agir.
  "shopify.unreachable": {
    what: "Nous n'avons pas réussi à lire les données de votre boutique Shopify.",
    why: "C'est la source principale de l'analyse : vos ventes, vos produits, vos clients. Sans elle, presque rien ne peut être établi et le reste du rapport porte sur une partie seulement de votre activité.",
    how: "Ouvrez l'onglet Connexions et reconnectez votre boutique. Cela arrive quand l'application a été retirée de votre administration Shopify, ou quand l'autorisation a expiré.",
    unlocks: "L'analyse complète : vos ventes, votre panier moyen, vos produits, vos clients.",
  },
  "meta.unreachable": {
    what: "Votre compte publicitaire Meta n'a pas répondu.",
    why: "Nous voyons alors vos ventes sans voir ce qu'elles vous ont coûté. Une boutique qui vend beaucoup en perdant de l'argent sur chaque commande ressemble, vue de l'extérieur, à une boutique qui marche.",
    how: "Onglet Connexions → Meta Ads → Reconnecter. Si vous n'utilisez pas de publicité Meta, ignorez ce point : il ne manque rien à votre analyse.",
    unlocks: "Le coût réel d'une commande, et les campagnes qui vous font perdre de l'argent.",
  },
  "google.unreachable": {
    what: "Votre compte Google Ads n'a pas répondu.",
    why: "Si vous dépensez sur Google sans que nous le sachions, nous rattacherons vos ventes aux mauvaises sources — et nos conseils sur votre budget seront faux.",
    how: "Onglet Connexions → Google Ads → Reconnecter. Si vous n'utilisez pas Google Ads, ignorez ce point.",
    unlocks: "La comparaison de vos deux canaux payants, et lequel mérite votre prochain euro.",
  },
  "organic.unreachable": {
    what: "Nous n'avons pas pu établir d'où viennent vos commandes.",
    why: "C'est ce qui sépare les ventes que la publicité vous apporte de celles que vous auriez eues sans elle. Sans cette séparation, on ne peut pas dire si votre budget publicitaire est rentable.",
    how: "Cette lecture se fait à partir de vos commandes Shopify. Vérifiez d'abord que votre boutique est bien connectée.",
    unlocks: "Ce qui resterait de votre chiffre d'affaires si vous arrêtiez la publicité demain.",
  },
  "storefront.unreachable": {
    what: "Nous n'avons pas réussi à ouvrir votre boutique en ligne.",
    why: "Tant que les pages ne répondent pas, nous ne pouvons rien dire de ce que vos visiteurs voient. Et si nous ne pouvons pas les ouvrir, il se peut que certains d'entre eux ne le puissent pas non plus.",
    how: "Vérifiez que votre boutique n'est pas protégée par un mot de passe : Shopify → Boutique en ligne → Préférences → Protection par mot de passe. Vérifiez aussi l'adresse enregistrée dans vos réglages.",
    unlocks: "L'analyse de vos pages telles qu'un visiteur les reçoit.",
  },
  "market.unreachable": {
    what: "Nous n'avons pas de repères de marché pour votre activité.",
    why: "Ils servent à situer vos chiffres : un panier moyen de trente euros n'a pas le même sens en bijouterie fantaisie et en électroménager.",
    how: "Aucune action de votre part. Renseigner votre secteur dans les réglages de la boutique améliore ce point.",
    unlocks: "Situer vos chiffres par rapport à des boutiques comparables plutôt que dans le vide.",
  },
  "competitors.unreachable": {
    what: "Nous n'avons pas pu regarder de boutiques concurrentes.",
    why: "Comparer votre offre à celles que vos clients voient ailleurs dit souvent plus qu'un chiffre isolé : le prix, la promesse, les délais annoncés.",
    how: "Aucune action de votre part pour l'instant.",
    unlocks: "Voir ce que votre acheteur compare avant de choisir.",
  },
  "declared.unreachable": {
    what: "Les informations que vous nous avez données sur votre activité sont incomplètes.",
    why: "Vos coûts et votre objectif servent à chiffrer ce qu'un problème vous coûte vraiment. Sans eux, nous décrivons le problème sans pouvoir le convertir en euros.",
    how: "Complétez votre modèle économique sur la page de la boutique : coût moyen des produits, charges fixes, objectif de chiffre d'affaires. Laissez vide ce que vous ne connaissez pas.",
    unlocks: "Chiffrer chaque recommandation en euros, plutôt qu'en points de score.",
  },

  // --- SHOPIFY -------------------------------------------------------------
  "shopify.abandoned_checkouts_30d": {
    what: "Nous n'avons pas pu lire vos paniers abandonnés.",
    why: "Un panier abandonné est un acheteur déjà décidé qui s'arrête à la dernière étape. C'est ce qui sépare un problème de tunnel de commande d'un problème d'offre — et les deux se corrigent à l'opposé l'un de l'autre.",
    how: "Reconnectez votre boutique depuis l'onglet Connexions : cette lecture demande une autorisation que votre boutique ne nous a pas accordée.",
    unlocks:
      "Savoir combien d'acheteurs décidés vous perdez au moment de payer, et à quelle étape.",
  },
  "shopify.returning_customer_rate": {
    what: "Nous ne savons pas quelle part de vos commandes vient de clients déjà venus.",
    why: "C'est la différence entre une boutique qui fidélise et une boutique qui doit racheter chaque client. La seconde doit dépenser en publicité pour rester au même niveau ; la première grandit sans cela.",
    how: "Deux causes possibles : vos clients commandent sans créer de compte, ou l'application n'a pas accès à votre fichier client. Reconnectez la boutique depuis l'onglet Connexions pour écarter la seconde.",
    unlocks:
      "Dire si votre chiffre d'affaires repose sur le rachat ou sur une acquisition permanente.",
  },

  // --- PUBLICITÉ -----------------------------------------------------------
  "meta.insights": {
    what: "Aucune campagne Meta n'a produit de résultats sur la période analysée.",
    why: "Soit vous n'avez pas diffusé de publicité ces trente derniers jours, soit le compte connecté n'est pas celui qui diffuse. Dans le second cas, tout ce que nous dirons de votre publicité sera faux.",
    how: "Vérifiez dans l'onglet Connexions que le compte Meta relié est bien celui qui diffuse vos publicités. Si vous ne faites pas de publicité, ce point est normal.",
    unlocks: "Le coût d'une commande, la rentabilité par campagne, et lesquelles arrêter.",
  },
  "google.insights": {
    what: "Aucune campagne Google n'a produit de résultats sur la période analysée.",
    why: "Sans elles, seul Meta porte le diagnostic de votre publicité — et une conclusion tirée d'un seul canal se généralise mal à l'autre.",
    how: "Vérifiez dans l'onglet Connexions que le compte Google relié est bien celui qui diffuse. Si vous ne faites pas de publicité Google, ce point est normal.",
    unlocks: "Séparer un problème propre à Google d'un problème d'acquisition général.",
  },
  "meta.previous_period": {
    what: "Nous n'avons pas d'historique Meta assez ancien pour comparer.",
    why: "Un mauvais mois n'a pas le même sens selon qu'il suit trois bons mois ou trois mois pires. Sans le passé, un creux passager se lit comme une chute.",
    how: "Rien à faire : l'historique se constituera de lui-même au fil des semaines.",
    unlocks: "Distinguer une baisse durable d'un simple creux.",
  },
  "google.previous_period": {
    what: "Nous n'avons pas d'historique Google assez ancien pour comparer.",
    why: "Sans période antérieure, impossible de dire si vos chiffres se dégradent ou s'ils reviennent simplement à leur niveau habituel.",
    how: "Rien à faire : l'historique se constituera au fil des semaines.",
    unlocks: "Distinguer une baisse durable d'un creux passager.",
  },
  "meta.post_click_behaviour": {
    what: "Meta compte les achats qu'il s'attribue, pas ceux que votre boutique a encaissés.",
    why: "Une régie publicitaire est juge et partie : elle compte volontiers une vente qui aurait eu lieu sans elle. C'est ainsi qu'un tableau de bord publicitaire affiche des résultats deux fois supérieurs à votre relevé bancaire.",
    how: "Ajoutez un suffixe de suivi à vos liens publicitaires — votre gestionnaire de publicités le propose dans ses réglages. Exemple : votreboutique.com/produit?utm_source=meta",
    unlocks:
      "Confronter ce que Meta prétend vous rapporter à ce que vous avez réellement encaissé.",
  },
  "google.post_click_behaviour": {
    what: "Google compte ses propres conversions, avec sa propre fenêtre de comptage.",
    why: "Ce ne sont pas les commandes de votre boutique. Les deux chiffres peuvent différer du simple au double sans que personne n'ait tort — ils ne mesurent pas la même chose.",
    how: "Ajoutez un suffixe de suivi à vos liens Google. Exemple : votreboutique.com/produit?utm_source=google",
    unlocks: "Savoir si le trafic venu de Google achète réellement.",
  },
  "google.shopping_campaigns": {
    what: "Nous n'avons vu aucune campagne Shopping ni Performance Max.",
    why: "Ce sont les formats qui affichent directement vos produits, avec leur titre, leur photo et leur prix. Leur performance dépend surtout de la qualité de vos fiches produit — ce que nous pouvons analyser.",
    how: "Si vous en diffusez, vérifiez que le compte relié est le bon. Sinon, ce point est normal.",
    unlocks: "Relier la performance de vos publicités à la qualité de vos fiches produit.",
  },
  "organic.search_terms": {
    what: "Nous savons qu'un moteur de recherche vous envoie des visiteurs, mais pas ce qu'ils ont tapé.",
    why: "Sans les mots tapés, on peut vous dire que le référencement fonctionne, jamais quoi travailler pour qu'il fonctionne mieux.",
    how: "Cette information vit dans la Search Console de Google, un outil gratuit et distinct que nous ne lisons pas encore. Aucune action de votre part pour l'instant.",
    unlocks:
      "Dire quelles pages reprendre en priorité, plutôt que de vous conseiller de « travailler le référencement ».",
  },

  // --- SITE PUBLIC ---------------------------------------------------------
  "storefront.url": {
    what: "Aucune adresse de boutique exploitable n'est enregistrée.",
    why: "Sans adresse, nous ne pouvons rien voir de ce que vos visiteurs voient : ni vos pages, ni vos fiches produit, ni la vitesse d'affichage. C'est environ un tiers de l'analyse qui reste fermé.",
    how: "Renseignez l'adresse complète de votre boutique dans ses réglages, en commençant par https://",
    unlocks: "L'analyse de la page que le visiteur reçoit vraiment.",
  },
  "storefront.product_page": {
    what: "Nous n'avons pas réussi à lire une seule fiche produit en ligne.",
    why: "C'est la page où la vente se joue. Trois causes possibles, et elles n'ont rien à voir : votre catalogue est vide, vos produits ne sont pas publiés, ou le site est protégé.",
    how: "Ouvrez votre boutique dans un navigateur privé et essayez d'atteindre une fiche produit. Si vous n'y arrivez pas non plus, vos visiteurs non plus.",
    unlocks: "Vérifier que la page porte bien un prix, un bouton d'achat et de quoi décider.",
  },
  "storefront.robots": {
    what: "Le fichier qui autorise Google à lire votre site n'a pas répondu.",
    why: "Ce fichier peut, par erreur, interdire à Google d'indexer votre boutique entière. C'est rare, invisible depuis l'administration, et cela supprime tout le trafic gratuit.",
    how: "Ouvrez votreboutique.com/robots.txt dans un navigateur. Si la page ne s'affiche pas, signalez-le à votre hébergeur ou à la personne qui gère votre thème.",
    unlocks: "Vérifier qu'aucune règle n'interdit à Google d'afficher votre boutique.",
  },
  "storefront.mobile_rendering": {
    what: "Nous ne voyons pas votre site tel qu'il s'affiche sur un téléphone.",
    why: "Nous lisons le code servi, pas la page dessinée. Un site peut être correct dans son code et illisible sur un écran de six pouces, où se font pourtant la plupart de vos visites.",
    how: "Ouvrez votre boutique sur votre propre téléphone et regardez ce qui apparaît avant de faire défiler. C'est ce que votre visiteur voit en premier.",
    unlocks:
      "Constater ce qui déborde, ce qui est trop petit pour être touché, et ce qui passe sous la ligne.",
  },
  "storefront.rendu_visuel": {
    what: "Nous ne jugeons pas l'aspect visuel de vos pages.",
    why: "Le code d'une page ne dit ni la taille finale des textes, ni les couleurs après mise en forme, ni la première impression. Prétendre le contraire donnerait un avis esthétique déguisé en mesure.",
    how: "Aucune action nécessaire. Montrez votre page d'accueil à quelqu'un qui ne connaît pas votre boutique et demandez-lui ce que vous vendez : sa réponse en dit plus que n'importe quelle mesure.",
    unlocks: "Nous nous en tenons à ce qui se vérifie ; le reste vous appartient.",
  },
  "storefront.style_redactionnel": {
    what: "Nous ne jugeons pas la qualité d'écriture de vos textes.",
    why: "La longueur d'un texte se compte, sa justesse ne se compte pas. Un texte long et creux et un texte court et juste se ressemblent pour une machine.",
    how: "Aucune action nécessaire. Relisez la première phrase de votre page d'accueil : si elle ne dit pas à qui vous vendez et pourquoi vous, elle est à réécrire.",
    unlocks: "Nous signalons ce qui manque, pas ce qui sonne mal.",
  },
  "storefront.qualite_images": {
    what: "Nous ne jugeons pas ce que montrent vos photos.",
    why: "Nous comptons les images et mesurons leur poids ; une photo nette bien cadrée et une photo floue sont identiques dans le code. Or l'écart entre les deux est souvent le plus visible d'une boutique.",
    how: "Aucune action nécessaire de notre côté. Comparez vos photos produit à celles des trois boutiques que votre acheteur regarde avant vous.",
    unlocks: "Nous nous limitons au poids et au nombre, qui eux se mesurent.",
  },
  "storefront.scan_incomplet": {
    what: "Votre site a mis trop de temps à répondre : nous avons dû nous arrêter avant d'avoir tout vu.",
    why: "Ce qui n'a pas été vérifié n'est pas sain pour autant. Et la lenteur elle-même est un fait : si nos serveurs attendent, vos visiteurs attendent aussi.",
    how: "Relancez l'audit à un moment plus calme. Si la lenteur persiste, elle vient de votre thème ou des applications installées sur votre boutique.",
    unlocks: "Un état complet du site, une fois qu'il répondra plus vite.",
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
 * Une explication marchande a-t-elle été écrite pour ce trou ?
 *
 * Sert au test de couverture, qui relève les identifiants réellement produits
 * par les sources et exige qu'aucun ne tombe dans le repli. Sans ce contrôle, un
 * nouveau trou arriverait à l'écran avec le texte du code — « L'API Admin de
 * Shopify n'expose pas le trafic » — et personne ne s'en apercevrait avant un
 * marchand.
 */
export function isExplained(gapId: string): boolean {
  return Object.hasOwn(EXPLANATIONS, gapId);
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
