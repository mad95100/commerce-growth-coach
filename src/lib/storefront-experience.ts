/**
 * CE QUE LE VISITEUR REÇOIT, ET CE QU'IL EN COMPREND EN CINQ SECONDES.
 *
 * POURQUOI CE MODULE EXISTE À CÔTÉ DU SCAN. Le scan existant établit des faits
 * techniques : la page répond, elle pèse tant, elle déclare un viewport. Ce sont
 * des faits nécessaires et insuffisants. Un site peut être techniquement
 * irréprochable et ne rien dire de ce qu'il vend — c'est même le cas le plus
 * fréquent, et aucun outil technique ne le voit.
 *
 * Ce module lit la MÊME page pour une question différente : qu'est-ce que le
 * visiteur comprend avant de faire défiler, et à qui cette page s'adresse-t-elle
 * réellement.
 *
 * LA LIGNE QUI NE PEUT PAS ÊTRE FRANCHIE, ET QUI L'EST PARTOUT AILLEURS. Le HTML
 * ne dit pas ce qui est VU. Il ne dit ni la taille réelle d'un texte, ni sa
 * couleur effective après cascade, ni ce qui tombe au-dessus de la ligne de
 * flottaison sur un téléphone donné. Tout ce qui prétend le contraire ment.
 *
 * Ce module distingue donc trois choses, et le type les sépare :
 *   - ce qui est LU dans le document (un titre existe, un bouton existe) : fait ;
 *   - ce qui s'en DÉDUIT avec une marge (le premier bloc du document est
 *     probablement ce qu'on voit en premier) : à vérifier ;
 *   - ce qui ne s'observe PAS depuis le HTML (contraste réel, lisibilité,
 *     impression esthétique) : déclaré hors de portée, jamais approché.
 *
 * Module PUR : il reçoit du HTML, il rend des constats. Aucun réseau.
 */

import type { AudienceHypothesis, PriceTier } from "@/lib/audience";
import { TIER_LABELS } from "@/lib/audience";

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Taille du premier bloc de document examiné comme « première impression ».
 *
 * CE N'EST PAS LA LIGNE DE FLOTTAISON. Aucun nombre de caractères ne détermine
 * ce qu'un écran affiche. C'est une approximation assumée : le début du corps
 * du document est ce que le navigateur peint en premier, et ce qui n'y est pas
 * n'a aucune chance d'être vu avant un défilement. Le sens est donc négatif —
 * on peut affirmer qu'une chose N'EST PAS en haut, jamais qu'elle y est.
 */
export const FIRST_BLOCK_CHARS = 4000;

/**
 * Verbes d'action qui font d'un lien un appel à l'achat.
 *
 * DES RADICAUX, PAS DES PHRASES. La première version listait des libellés
 * entiers — « voir la collection » — et ratait « Voir les snowboards », qui est
 * pourtant le libellé le plus courant d'un bouton principal. Un détecteur trop
 * étroit ne se voit pas : il conclut simplement qu'il n'y a pas de bouton, et
 * fait remonter un défaut qui n'existe pas. C'est le pire mode de défaillance
 * pour ce module, parce qu'il produit un conseil confiant et faux.
 *
 * Les radicaux couvrent les conjugaisons et les compléments ; un faux positif
 * laisse une page tranquille, un faux négatif invente un problème.
 */
const CTA_WORDS = [
  "ajouter au panier",
  "add to cart",
  "achet",
  "buy",
  "command",
  "précommand",
  "precommand",
  "choisir",
  "découvr",
  "decouvr",
  "shop now",
  "voir ",
  "explorer",
  "je veux",
  "réserver",
  "reserver",
];

/** Mots qui signalent qu'une page traite du retour ou de la garantie. */
const TRUST_WORDS = [
  "retour",
  "remboursement",
  "garantie",
  "satisfait ou remboursé",
  "returns",
  "refund",
  "warranty",
  "sécurisé",
  "paiement sécurisé",
];

/** Mots qui signalent une preuve sociale. */
const REVIEW_WORDS = ["avis", "review", "témoignage", "étoiles", "notée", "rated", "客"];

export type ExperienceFacts = {
  /** Premier titre de niveau 1, tel qu'écrit. */
  h1: string | null;
  /** Longueur du premier titre, en mots. Un titre de deux mots ne promet rien. */
  h1Words: number;
  /** Le premier bloc contient-il un appel à l'action ? */
  ctaInFirstBlock: boolean;
  /** Appels à l'action sur toute la page. */
  ctaCount: number;
  /**
   * Libellés RÉELLEMENT RELEVÉS sur la page — les premiers, tels qu'écrits.
   *
   * POURQUOI CE CHAMP EXISTE. Les constats de ce module disaient « aucun lien
   * ni bouton portant un verbe d'action », et cette phrase est vraie de
   * n'importe quelle boutique dont on l'écrirait. Un lecteur ne pouvait ni la
   * vérifier, ni reconnaître la boutique dont on parlait, ni savoir ce qui
   * avait été cherché. Citer les libellés lus règle les trois d'un coup : la
   * preuve devient reconnaissable, et un faux détecteur devient visible.
   */
  linkLabels: string[];
  /** Nombre TOTAL de liens et boutons inspectés. Le dénominateur du constat. */
  clickableCount: number;
  /** Texte lisible du premier bloc, balises retirées. */
  firstBlockText: string;
  /** Mots lisibles dans le premier bloc. */
  firstBlockWords: number;
  /**
   * Mots lisibles sur TOUTE la page.
   *
   * C'est le dénominateur des constats d'absence. « Aucune mention de retour »
   * ne veut pas dire la même chose sur une page de trente mots — où presque
   * rien n'est écrit — et sur une page de deux mille, où le sujet a réellement
   * été évité. Sans ce nombre, les deux se lisaient à l'identique.
   */
  pageWords: number;
  /** Liens de navigation principale trouvés. */
  navLinks: number;
  /** Couleurs distinctes déclarées dans le document. */
  distinctColors: number;
  /** Familles de police distinctes déclarées. */
  distinctFonts: number;
  /** La page parle-t-elle de retours ou de garantie ? */
  mentionsTrust: boolean;
  /** La page mentionne-t-elle des avis ? */
  mentionsReviews: boolean;
  /** Un moyen de contact est-il exposé ? */
  hasContact: boolean;
};

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countMatches(haystack: string, needles: string[]): number {
  const low = haystack.toLowerCase();
  return needles.filter((n) => low.includes(n)).length;
}

/**
 * Extrait ce qui se lit honnêtement dans le document.
 *
 * Tolérant par construction : un document malformé rend des faits partiels, il
 * ne fait pas échouer la lecture. Un site réel est presque toujours malformé
 * quelque part, et refuser de lire pour autant reviendrait à ne jamais rien
 * analyser.
 */
export function extractExperience(html: string): ExperienceFacts {
  const body = (() => {
    const start = html.search(/<body\b[^>]*>/i);
    return start === -1 ? html : html.slice(start);
  })();
  const firstBlock = body.slice(0, FIRST_BLOCK_CHARS);
  const firstBlockText = stripTags(firstBlock);
  const pageText = stripTags(body);

  const h1Match = body.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const h1 = h1Match ? stripTags(h1Match[1] ?? "") : null;

  // Les couleurs et les polices sont comptées sur les DÉCLARATIONS du document.
  // C'est un fait vérifiable ; ce n'est pas ce que l'œil perçoit après cascade,
  // et le constat qui en découle le dira.
  const colors = new Set(
    (html.match(/#[0-9a-f]{3,8}\b/gi) ?? []).map((c) => c.toLowerCase().slice(0, 7)),
  );
  const fonts = new Set(
    (html.match(/font-family\s*:\s*([^;"'}]+)/gi) ?? []).map((f) =>
      f
        .replace(/font-family\s*:\s*/i, "")
        .trim()
        .toLowerCase(),
    ),
  );

  const cliquables = (body.match(/<(?:a|button)\b[^>]*>([\s\S]{0,200}?)<\/(?:a|button)>/gi) ?? [])
    .map((c) => stripTags(c))
    .filter((label) => label.length > 0);
  const ctaCount = cliquables.filter((label) => countMatches(label, CTA_WORDS) > 0).length;

  return {
    h1,
    h1Words: h1 ? h1.split(/\s+/).filter(Boolean).length : 0,
    ctaInFirstBlock: countMatches(firstBlockText, CTA_WORDS) > 0,
    ctaCount,
    // Bornés à huit et à soixante caractères : une preuve doit tenir dans une
    // phrase lisible, et un menu entier recopié cesse d'être une preuve.
    linkLabels: [...new Set(cliquables.map((l) => l.slice(0, 60)))].slice(0, 8),
    clickableCount: cliquables.length,
    firstBlockText,
    firstBlockWords: firstBlockText.split(/\s+/).filter(Boolean).length,
    pageWords: pageText.split(/\s+/).filter(Boolean).length,
    navLinks: (body.match(/<nav\b[\s\S]*?<\/nav>/i)?.[0].match(/<a\b/gi) ?? []).length,
    distinctColors: colors.size,
    distinctFonts: fonts.size,
    mentionsTrust: countMatches(pageText, TRUST_WORDS) > 0,
    mentionsReviews: countMatches(pageText, REVIEW_WORDS) > 0,
    hasContact: /mailto:|tel:|\/pages\/contact|nous contacter|contact us/i.test(body),
  };
}

// ---------------------------------------------------------------------------
// Constats
// ---------------------------------------------------------------------------

/** Le degré auquel le HTML autorise à conclure. */
export type ExperienceLevel = "prouve" | "a_verifier";

export type ExperienceFinding = {
  id: string;
  /** Ce qui a été lu. Factuel. */
  observation: string;
  /** Ce que cela pose comme problème. */
  problem: string;
  /** La preuve, telle qu'elle sera montrée. */
  evidence: string[];
  /** Conséquence probable. Jamais chiffrée sans mesure. */
  impact: string;
  recommendation: string;
  /** Assez concret pour être exécuté sans nous rappeler. */
  correction: string;
  level: ExperienceLevel;
  impactScore: number;
  effort: number;
};

/**
 * Ce que le HTML ne dira jamais.
 *
 * Déclaré une fois, nommément, et transmis au marchand comme une limite du
 * diagnostic — pas approché par une heuristique qui aurait l'air d'une mesure.
 * C'est la différence entre un outil honnête et un outil qui impressionne.
 */
export const OUT_OF_REACH = [
  {
    id: "storefront.rendu_visuel",
    label: "Ce que l'écran affiche réellement",
    reason:
      "Le code d'une page ne dit pas ce qui est vu : ni la taille finale des textes, ni les couleurs après application des styles, ni ce qui tombe au-dessus de la ligne de flottaison sur un téléphone donné. Ces éléments demandent d'ouvrir la page dans un vrai navigateur.",
    wouldEnable:
      "Juger la première impression, le contraste, la lisibilité et la hiérarchie telles que le visiteur les reçoit.",
  },
  {
    id: "storefront.qualite_images",
    label: "Qualité perçue des visuels",
    reason:
      "Le nombre et le poids des images se lisent ; ce qu'elles montrent ne se lit pas. Un visuel net et cadré et une photo floue sont indiscernables dans le code.",
    wouldEnable:
      "Dire si les photos soutiennent le positionnement ou le contredisent — souvent l'écart le plus visible d'une boutique.",
  },
  {
    id: "storefront.style_redactionnel",
    label: "Style et qualité rédactionnelle",
    reason:
      "La longueur d'un texte et la présence de mots-clés se comptent ; sa justesse ne se compte pas. Un texte long et creux et un texte court et juste ont la même signature technique.",
    wouldEnable: "Évaluer si le discours parle au public visé ou à personne en particulier.",
  },
] as const;

function tierIsDemanding(tier: PriceTier | null): boolean {
  return tier === "premium" || tier === "luxe";
}

/**
 * Confronte la page au public déduit.
 *
 * L'AUDIENCE CHANGE LA GRAVITÉ, PAS LE FAIT. Un premier bloc sans promesse est
 * un fait sur toutes les boutiques ; c'est un problème grave sur une boutique
 * dont le public compare avant d'acheter, et secondaire sur un achat
 * d'impulsion à douze euros. Sans public déduit, les constats sortent quand
 * même, mais leur gravité reste neutre — on ne l'invente pas.
 */
export function experienceFindings(
  facts: ExperienceFacts,
  audience: AudienceHypothesis | null,
): ExperienceFinding[] {
  const out: ExperienceFinding[] = [];
  const exigeant = tierIsDemanding(audience?.tier ?? null);
  const gamme = audience?.tier ? TIER_LABELS[audience.tier] : null;
  const pour = gamme ? `, sur une boutique positionnée en ${gamme}` : "";

  // --- 1. Aucune promesse en haut de page ----------------------------------
  if (!facts.h1 || facts.h1Words < 3) {
    out.push({
      id: "experience.promesse_absente",
      observation: facts.h1
        ? `Le titre principal de la page tient en ${facts.h1Words} mot(s) : « ${facts.h1} »${pour}.`
        : `La page d'accueil ne comporte aucun titre de niveau 1${pour}.`,
      problem:
        "Le titre principal est la seule phrase qu'un visiteur lit à coup sûr. Sans lui, ou réduit au nom de la boutique, la page ne dit ni ce qui est vendu, ni à qui, ni pourquoi ici plutôt qu'ailleurs. Le visiteur doit deviner — et il ne devine pas, il repart.",
      evidence: [
        facts.h1
          ? `Titre de niveau 1 relevé : « ${facts.h1} » (${facts.h1Words} mots)`
          : "Aucune balise de titre de niveau 1 dans le document",
      ],
      impact:
        "Les visiteurs qui arrivent sans connaître la marque n'ont aucune raison de rester. L'effet se concentre sur le trafic froid — publicité et recherche — et épargne ceux qui viennent déjà décidés.",
      recommendation:
        "Écrire un titre qui dit ce que la boutique vend et pour qui, en une phrase, et le placer en haut de la page d'accueil.",
      correction:
        "Remplacer le titre actuel par une phrase de la forme : « [Ce que vous vendez] pour [qui], [le bénéfice principal] ». Exemple de structure, à remplir avec vos mots : « Snowboards fabriqués à la main pour riders exigeants — garantis à vie ». Dans Shopify : Boutique en ligne → Personnaliser → section d'en-tête de la page d'accueil.",
      level: "prouve",
      impactScore: exigeant ? 5 : 4,
      effort: 1,
    });
  }

  // --- 2. Premier bloc muet -------------------------------------------------
  // Négatif seulement : on peut affirmer qu'une chose n'est PAS en haut.
  if (facts.firstBlockWords < 25) {
    out.push({
      id: "experience.premier_bloc_muet",
      observation: `Le début du document ne contient que ${facts.firstBlockWords} mots lisibles${pour}.`,
      problem:
        "Ce qui n'est pas dans le début du document n'a aucune chance d'être vu avant un défilement. Une page qui commence par un bandeau et des images sans texte demande au visiteur de faire défiler pour savoir où il est tombé — un effort qu'il ne fait pas s'il n'est pas déjà convaincu.",
      evidence: [
        `${facts.firstBlockWords} mots lisibles dans les ${FIRST_BLOCK_CHARS} premiers caractères du corps du document`,
      ],
      impact:
        "Le visiteur venu d'une publicité arrive sans contexte : s'il ne retrouve pas immédiatement ce qui lui a été promis, il repart avant d'avoir vu l'offre.",
      recommendation:
        "Faire remonter une phrase de promesse et un bouton d'action au-dessus des visuels décoratifs.",
      correction:
        "Dans l'éditeur de thème, déplacer la section de texte au-dessus du carrousel ou de la bannière, ou activer la superposition de texte sur l'image de bannière. Vérifier ensuite sur un téléphone que la promesse et le bouton sont lisibles sans faire défiler.",
      // À VÉRIFIER, et non prouvé : le nombre de caractères du document est un
      // fait, mais « ce que le visiteur voit » demande d'ouvrir la page.
      level: "a_verifier",
      impactScore: exigeant ? 4 : 3,
      effort: 2,
    });
  }

  // --- 3. Aucun appel à l'action en haut -----------------------------------
  if (!facts.ctaInFirstBlock && facts.ctaCount > 0) {
    out.push({
      id: "experience.cta_trop_bas",
      observation: `Aucun appel à l'action n'apparaît dans le début du document, alors que la page en contient ${facts.ctaCount} plus bas${pour}.`,
      problem:
        "Le visiteur convaincu par la promesse doit pouvoir agir immédiatement. Un bouton placé après plusieurs sections oblige à revenir en arrière, et chaque retour en arrière est une occasion de partir.",
      evidence: [
        `${facts.ctaCount} appel(s) à l'action sur la page, aucun dans les ${FIRST_BLOCK_CHARS} premiers caractères`,
      ],
      impact:
        "La friction s'ajoute exactement au moment où l'intention est la plus forte, c'est-à-dire là où elle coûte le plus cher.",
      recommendation:
        "Placer un bouton d'action juste sous la phrase de promesse, avant tout contenu secondaire.",
      correction:
        "Dans la section d'en-tête du thème, activer le bouton et l'étiqueter par une action, pas par une destination : « Voir les snowboards » plutôt que « En savoir plus ». Un seul bouton en haut : deux boutons concurrents divisent l'attention.",
      level: "a_verifier",
      impactScore: 4,
      effort: 1,
    });
  }
  if (facts.ctaCount === 0) {
    out.push({
      id: "experience.aucun_cta",
      observation: `Aucun des ${facts.clickableCount} liens et boutons de la page d'accueil ne porte de verbe d'action${pour}.`,
      problem:
        "La page ne propose aucun geste. Un visiteur intéressé doit chercher lui-même comment acheter, et cette recherche est exactement ce qu'une page d'accueil existe pour éviter.",
      evidence: [
        `${facts.clickableCount} lien(s) et bouton(s) relevés sur la page d'accueil, aucun ne portant de verbe d'achat ou de découverte`,
        facts.linkLabels.length > 0
          ? `Libellés relevés : ${facts.linkLabels.map((l) => `« ${l} »`).join(", ")}`
          : "Aucun libellé lisible relevé sur la page d'accueil",
      ],
      impact: "Toute intention d'achat née sur cette page se perd faute d'un chemin évident.",
      recommendation: "Ajouter un bouton d'action visible en haut de la page d'accueil.",
      correction:
        "Dans l'éditeur de thème, ajouter un bouton à la section principale, pointant vers la collection principale, avec un libellé d'action.",
      level: "prouve",
      impactScore: 5,
      effort: 1,
    });
  }

  // --- 4. Navigation absente ou pléthorique --------------------------------
  if (facts.navLinks === 0) {
    out.push({
      id: "experience.navigation_absente",
      observation: `Aucun lien n'a été trouvé à l'intérieur d'une balise de navigation du document${pour}.`,
      problem:
        "Sans menu, le visiteur ne peut ni explorer le catalogue, ni retrouver les pages de confiance. Le parcours dépend entièrement des liens de la page d'accueil.",
      // CE QUE CETTE PREUVE DIT EXACTEMENT, et pourquoi elle ne dit pas plus.
      // Un thème qui construit son menu sans balise `<nav>` — ou qui l'injecte
      // après le chargement — produit ici un compte à zéro alors que le menu
      // existe. Le constat porte donc sur ce qui a été LU, avec le total des
      // liens de la page à côté : c'est ce qui permet au lecteur de voir tout
      // de suite si c'est le menu qui manque ou notre lecture qui l'a raté.
      evidence: [
        `Aucun lien à l'intérieur d'une balise <nav> du document d'accueil, sur ${facts.clickableCount} lien(s) et bouton(s) relevés au total sur la page`,
      ],
      impact: "L'exploration du catalogue s'arrête à ce que la page d'accueil met en avant.",
      recommendation:
        "Ouvrir la page d'accueil et vérifier qu'un menu principal s'affiche. S'il s'affiche, ce point est clos : le thème le construit autrement que nous ne savons le lire.",
      correction:
        "Si le menu manque réellement : Shopify → Boutique en ligne → Navigation → menu principal. Y placer au plus cinq entrées : les collections qui vendent, puis « Livraison » et « Retours ».",
      level: "a_verifier",
      impactScore: 3,
      effort: 1,
    });
  } else if (facts.navLinks > 12) {
    out.push({
      id: "experience.navigation_surchargee",
      observation: `Le menu de navigation contient ${facts.navLinks} liens${pour}.`,
      problem:
        "Un menu long ne guide pas, il délègue le tri au visiteur. Devant trop d'options, le comportement le plus fréquent n'est pas de choisir : c'est de ne rien choisir.",
      evidence: [`${facts.navLinks} liens dans la navigation principale`],
      impact:
        "Le trafic se disperse sur des pages secondaires au lieu d'aller vers ce qui se vend.",
      recommendation:
        "Réduire le menu principal aux entrées qui mènent à une vente, et déplacer le reste en pied de page.",
      correction:
        "Garder au plus cinq entrées en haut. Les pages institutionnelles — à propos, mentions, blog — descendent en pied de page, où on les cherche naturellement.",
      level: "a_verifier",
      impactScore: 2,
      effort: 1,
    });
  }

  // --- 5. Incohérence visuelle ---------------------------------------------
  // Ce sont des DÉCLARATIONS comptées, pas une perception. Le niveau le dit.
  if (facts.distinctFonts > 4) {
    out.push({
      id: "experience.typographies_multiples",
      observation: `${facts.distinctFonts} familles de police différentes sont déclarées dans le document${pour}.`,
      problem:
        "Une multiplication des typographies produit une page qui paraît assemblée plutôt que conçue. Sur une gamme où l'acheteur juge le sérieux du vendeur avant de payer, cette impression coûte directement.",
      evidence: [
        `${facts.distinctFonts} familles de police distinctes déclarées dans le document d'accueil — DÉCLARÉES, y compris celles que la page n'applique peut-être jamais : ce compte se lit dans le code, il ne dit pas ce que l'œil reçoit`,
      ],
      impact:
        "L'effet porte sur la confiance, pas sur un taux directement mesurable : il se constate à l'échelle de la décision, pas de la statistique.",
      recommendation:
        "Ramener la page à deux familles de police : une pour les titres, une pour le texte.",
      correction:
        "Dans les réglages du thème → Typographie, choisir une police de titre et une police de texte, puis retirer les polices ajoutées par des applications tierces dans le code du thème.",
      level: "a_verifier",
      impactScore: exigeant ? 3 : 2,
      effort: 2,
    });
  }
  if (facts.distinctColors > 20) {
    out.push({
      id: "experience.palette_dispersee",
      observation: `${facts.distinctColors} couleurs distinctes sont déclarées dans le document${pour}.`,
      problem:
        "Une palette dispersée efface la hiérarchie : quand tout est coloré, plus rien ne ressort, et le bouton d'achat cesse d'être l'élément le plus visible de la page.",
      evidence: [
        `${facts.distinctColors} valeurs de couleur distinctes déclarées dans le document d'accueil — DÉCLARÉES dans le code, y compris celles qu'aucun élément visible n'emploie : ce compte ne dit pas ce que la page montre`,
      ],
      impact:
        "Le bouton d'action perd son avantage visuel sur le reste de la page, au moment précis où il devrait le tenir.",
      recommendation:
        "Réserver une couleur vive à l'action d'achat, et n'utiliser que des neutres partout ailleurs.",
      correction:
        "Dans les réglages du thème → Couleurs, définir une couleur d'accent unique, l'appliquer au bouton d'ajout au panier, et repasser les autres éléments colorés en neutre.",
      level: "a_verifier",
      impactScore: 2,
      effort: 2,
    });
  }

  // --- 6. Réassurance absente, croisée avec le public ----------------------
  if (!facts.mentionsTrust) {
    out.push({
      id: "experience.reassurance_absente",
      observation: `La page d'accueil ne mentionne ni retour, ni remboursement, ni garantie${pour}.`,
      problem: exigeant
        ? "Ce public engage un montant qu'il ne veut pas risquer. La question « et si ça se passe mal ? » se pose avant le prix, et une page qui n'y répond pas laisse l'objection intacte jusqu'au moment de payer."
        : "Le visiteur qui hésite cherche ce qui se passe en cas de problème. L'absence de réponse ne bloque pas tout le monde, mais elle bloque exactement ceux qui hésitent.",
      evidence: [
        `Aucune occurrence de « retour », « remboursement », « garantie », « satisfait ou remboursé » ni « paiement sécurisé » dans les ${facts.pageWords} mots lisibles de la page d'accueil`,
      ],
      impact:
        "L'objection reste ouverte jusqu'au paiement, là où elle est la plus coûteuse à lever.",
      recommendation:
        "Afficher une ligne de réassurance sous le bouton d'action de la page d'accueil.",
      correction:
        "Ajouter une ligne courte et vérifiable — « Retours sous 30 jours · Paiement sécurisé · Expédié sous 48 h » — et lier chaque élément à la page correspondante. Ne rien y écrire qui ne soit tenu : une promesse démentie coûte plus qu'une absence.",
      level: "prouve",
      impactScore: exigeant ? 4 : 3,
      effort: 1,
    });
  }

  // --- 7. Aucune preuve sociale --------------------------------------------
  if (!facts.mentionsReviews && exigeant) {
    out.push({
      id: "experience.preuve_sociale_absente",
      observation: `La page d'accueil ne fait aucune mention d'avis ou de témoignages${pour}.`,
      problem:
        "Sur cette gamme, le visiteur cherche la trace que quelqu'un a acheté avant lui. C'est la seule objection que le vendeur ne peut pas lever avec ses propres mots.",
      evidence: [
        `Aucune occurrence de « avis », « témoignage », « étoiles » ni « notée » dans les ${facts.pageWords} mots lisibles de la page d'accueil`,
      ],
      impact:
        "Le visiteur reporte sa décision et compare ailleurs. La vente n'est pas refusée, elle est différée — puis prise par un concurrent qui, lui, affiche des avis.",
      recommendation: "Faire remonter deux ou trois avis réels sur la page d'accueil.",
      correction:
        "Installer une application d'avis Shopify, importer les avis reçus par e-mail ou sur les réseaux, puis ajouter une section d'avis entre la bannière et les produits mis en avant. À défaut d'avis, afficher le nombre de commandes livrées.",
      level: "prouve",
      impactScore: 4,
      effort: 2,
    });
  }

  // --- 8. Aucun contact ------------------------------------------------------
  if (!facts.hasContact && exigeant) {
    out.push({
      id: "experience.contact_absent",
      observation: `Aucun moyen de contact n'est exposé sur la page${pour}.`,
      problem:
        "Plus le montant est élevé, plus l'acheteur veut savoir qu'il existe quelqu'un derrière la boutique. Une adresse de contact visible ne sert pas qu'à recevoir des messages : elle sert à être vue.",
      evidence: [
        `Aucun lien « mailto: », « tel: » ni « /pages/contact » parmi les ${facts.clickableCount} liens et boutons de la page d'accueil, et aucune mention de « nous contacter »`,
      ],
      impact: "Le doute sur l'existence réelle du vendeur reste entier au moment de payer.",
      recommendation: "Exposer un moyen de contact en pied de page et sur la fiche produit.",
      correction:
        "Créer une page Contact avec une adresse électronique surveillée et un délai de réponse annoncé, puis la lier depuis le pied de page. Un formulaire seul suffit moins bien qu'une adresse visible.",
      level: "prouve",
      impactScore: 3,
      effort: 1,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Transmission au modèle
// ---------------------------------------------------------------------------

const LEVEL_LABELS: Record<ExperienceLevel, string> = {
  prouve: "PROUVÉ",
  a_verifier: "À VÉRIFIER",
};

/** Le bloc de prompt, avec la chaîne complète et les limites déclarées. */
export function experienceToPromptBlock(findings: ExperienceFinding[], scanned: boolean): string {
  const l: string[] = [];
  if (!scanned) {
    l.push(
      "EXPÉRIENCE DU SITE PUBLIC : NON ANALYSÉE.",
      "Le site n'a pas pu être ouvert. Ne conclus rien sur son apparence, sa navigation, ses textes ou sa confiance — tu n'as vu aucune page.",
    );
    return l.join("\n");
  }

  l.push("EXPÉRIENCE DU SITE PUBLIC — constats établis sur le document réel :");
  if (findings.length === 0) {
    l.push(
      "- Aucun défaut d'expérience détecté parmi ceux que le moteur sait établir depuis le document.",
    );
  }
  for (const f of findings) {
    l.push(
      "",
      `[${f.id}] — ${LEVEL_LABELS[f.level]}`,
      `  Observation : ${f.observation}`,
      `  Problème : ${f.problem}`,
      `  Preuve : ${f.evidence.join(" ; ")}`,
      `  Impact potentiel : ${f.impact}`,
      `  Recommandation : ${f.recommendation}`,
      `  Correction : ${f.correction}`,
      `  Impact ${f.impactScore}/5, effort ${f.effort}/5`,
    );
  }

  l.push("", "CE QUE LE DOCUMENT NE PERMET PAS DE JUGER :");
  for (const o of OUT_OF_REACH) {
    l.push(`- ${o.label} : ${o.reason}`);
  }

  l.push(
    "",
    "RÈGLES ABSOLUES SUR CETTE PARTIE :",
    "- Les constats marqués À VÉRIFIER portent sur ce que le code laisse supposer, pas sur ce qui est vu. Présente-les comme des points à confirmer en ouvrant la page, jamais comme des faits établis.",
    "- Tu ne portes AUCUN jugement esthétique : ni sur les couleurs perçues, ni sur la qualité des photos, ni sur le style. Rien de tout cela n'a été observé, et une page n'a pas été regardée par un œil humain.",
    "- Tu ne dis jamais qu'un élément est « au-dessus de la ligne de flottaison » ou « visible sans défiler » : cela dépend de l'écran, et aucun écran n'a été simulé.",
    "- Les corrections ci-dessus sont exécutables telles quelles. Ne les remplace pas par des formules générales.",
  );

  return l.join("\n");
}
