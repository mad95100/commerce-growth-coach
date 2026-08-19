/**
 * LA CAUSE RACINE. Cinq symptômes, un seul problème, une seule action.
 *
 * POURQUOI CE MODULE EXISTE. Chaque module du moteur regarde la boutique par sa
 * fenêtre : les règles voient des fiches sans description, la lecture
 * d'expérience voit une page d'accueil sans promesse, le croisement avec le
 * client cible voit un prix élevé sans argument. Ce sont trois constats justes,
 * chacun avec sa preuve — et c'est le MÊME problème : la boutique n'explique pas
 * ce qu'elle vend.
 *
 * Les rendre séparément produit un rapport de consultant : long, exhaustif,
 * inapplicable. Le marchand lit cinq recommandations, en commence trois, n'en
 * finit aucune, et conclut que l'outil ne sert à rien. Il aurait eu raison.
 *
 * CE QUE CE MODULE FAIT, ET CE QU'IL NE FAIT PAS. Il regroupe des symptômes déjà
 * établis sous la cause qui les explique. Il n'établit AUCUN constat nouveau :
 * un regroupement ne peut pas être plus certain que ce qu'il regroupe, et ses
 * preuves sont exactement l'union de celles de ses symptômes — jamais une phrase
 * de plus.
 *
 * LA RÈGLE QUI L'EMPÊCHE DE MENTIR. Une cause ne se forme qu'à partir de DEUX
 * symptômes réellement présents. Un symptôme isolé reste un constat isolé :
 * inventer une cause racine à partir d'un seul signe serait exactement le
 * raisonnement de complaisance que ce module existe pour empêcher.
 *
 * Module PUR.
 */

import type { EvidenceLevel } from "@/lib/audit-rules";
import { EVIDENCE_LEVELS, EVIDENCE_WEIGHT, dependencyEffect } from "@/lib/audit-rules";

// ---------------------------------------------------------------------------
// Entrée commune
// ---------------------------------------------------------------------------

/**
 * Un symptôme, quelle que soit sa provenance.
 *
 * Les trois modules producteurs n'ont pas le même type de sortie. Les convertir
 * ici plutôt que d'unifier les trois évite de faire dépendre l'analyse causale
 * de la forme interne de chacun.
 */
export type Symptom = {
  /** Identifiant du constat d'origine. */
  id: string;
  title: string;
  evidence: string[];
  level: EvidenceLevel;
  impact: number;
  effort: number;
};

export const MIN_SYMPTOMS_FOR_CAUSE = 2;

// ---------------------------------------------------------------------------
// Les causes
// ---------------------------------------------------------------------------

export type CauseDefinition = {
  id: string;
  title: string;
  /** Ce qu'est réellement le problème, sous les symptômes. */
  statement: string;
  /** Pourquoi c'est UN problème et non plusieurs. */
  why: string;
  /** Le premier geste, celui qui débloque le reste. */
  firstAction: string;
  /** La correction, assez concrète pour être exécutée sans nous. */
  correction: string;
  /** Identifiants de constats qui en relèvent. Préfixes acceptés. */
  matches: string[];
  /**
   * LE LEVIER : le constat dont la correction débloque les autres.
   *
   * POURQUOI IL EST NOMMÉ, ET PAS DEVINÉ. Une cause qui explique quatre
   * symptômes doit passer devant eux dans le plan — mais « la cause » n'est pas
   * une ligne que le marchand peut cocher : ce qu'il exécute, c'est un geste, et
   * ce geste porte sur l'un des constats. Le désigner explicitement rend la
   * dépendance vérifiable : à la question « pourquoi ce constat passe-t-il
   * devant les trois autres ? », la réponse est écrite ici, pas déduite d'un
   * score.
   *
   * Il doit figurer dans `matches`. S'il n'est pas présent dans l'audit du jour,
   * le symptôme de plus fort impact reprend le rôle — une dépendance réelle ne
   * disparaît pas parce que son levier habituel n'a pas été constaté.
   */
  lever: string;
};

/**
 * Les familles de causes.
 *
 * Chacune répond à « pourquoi ces constats arrivent-ils ENSEMBLE ? ». Une
 * famille dont on ne saurait pas répondre à cette question ne serait pas une
 * cause : ce serait un classement.
 */
export const CAUSES: CauseDefinition[] = [
  {
    id: "cause.boutique_muette",
    title: "La boutique n'explique pas ce qu'elle vend",
    statement:
      "Le visiteur arrive sur des pages qui montrent des produits sans jamais dire à qui ils s'adressent, ce qu'ils changent, ni pourquoi les acheter ici.",
    why: "Fiches sans description, page d'accueil sans promesse, prix sans argument : ce sont trois manifestations du même vide. Les corriger séparément revient à écrire trois fois le même texte à trois endroits, dans le désordre — et à ne jamais finir.",
    firstAction:
      "Écrire une seule fois la promesse de la boutique, puis la décliner : d'abord en haut de la page d'accueil, ensuite sur les cinq fiches les plus vues.",
    correction:
      "Répondre par écrit à trois questions, dans cet ordre : (1) qui achète ce produit et pour quel usage précis ; (2) qu'est-ce que ça change concrètement pour lui — « tient une journée entière » plutôt que « batterie 5 000 mAh » ; (3) qu'est-ce qui empêcherait d'acheter, et quelle est la réponse. Ces trois réponses deviennent le titre de la page d'accueil, puis le corps de chaque fiche. Ne pas passer à la fiche suivante avant d'avoir fini la précédente.",
    matches: [
      "merchandising.descriptions_missing",
      "experience.promesse_absente",
      "experience.premier_bloc_muet",
      "audience.premium_sans_argument",
      "merchandising.images_missing",
    ],
    // Le texte s'écrit une fois et se décline. Les fiches sont l'endroit où il
    // manque le plus souvent, et où il rapporte le plus vite.
    lever: "merchandising.descriptions_missing",
  },
  {
    id: "cause.rien_ne_rassure",
    title: "Rien ne rassure au moment de payer",
    statement:
      "Aucune preuve, aucune politique et aucun interlocuteur ne sont exposés là où l'acheteur les cherche.",
    why: "Avis absents, pages de retour introuvables, aucun contact : la même objection reste ouverte à chaque fois — « et si ça se passe mal ? ». Une seule de ces absences est un manque ; les trois ensemble sont une raison de ne pas acheter.",
    firstAction:
      "Publier les trois pages de confiance, puis les rendre visibles depuis la fiche produit — pas seulement depuis le pied de page.",
    correction:
      "Créer dans Shopify les pages « Livraison » (délai réel et prix exact, pas une fourchette), « Retours » (durée, qui paie, comment demander) et « Contact » (adresse électronique surveillée et délai de réponse annoncé). Ajouter ensuite, sous le bouton d'ajout au panier, une ligne courte liant ces pages : « Retours sous 30 jours · Livraison en 48 h · Une question ? ». N'y écrire que ce qui est tenu : une promesse démentie coûte plus qu'une absence.",
    matches: [
      "trust.policy_pages_missing",
      "experience.reassurance_absente",
      "experience.preuve_sociale_absente",
      "experience.contact_absent",
      "audience.premium_sans_avis",
      "audience.premium_sans_politique",
    ],
    // Les pages de politique conditionnent tout le reste : sans elles, aucun
    // lien de réassurance n'a de destination.
    lever: "trust.policy_pages_missing",
  },
  {
    id: "cause.chemin_absent",
    title: "Le visiteur n'a pas de chemin vers l'achat",
    statement:
      "La page ne propose ni geste évident ni moyen d'explorer : le visiteur intéressé doit chercher lui-même comment acheter.",
    why: "Absence de bouton, bouton trop bas, navigation absente ou surchargée : chacun ajoute une friction au même endroit du parcours — juste après le moment où l'intention naît. C'est le seul endroit où une friction coûte le prix entier de la visite.",
    firstAction:
      "Placer un bouton d'action unique sous la promesse de la page d'accueil, et réduire le menu aux entrées qui mènent à une vente.",
    correction:
      "Dans l'éditeur de thème : activer le bouton de la section principale et l'étiqueter par une action, pas par une destination — « Voir les snowboards » plutôt que « En savoir plus ». Un seul bouton en haut : deux boutons concurrents divisent l'attention. Puis, dans Navigation → menu principal, ne garder que cinq entrées et descendre le reste en pied de page.",
    matches: [
      "experience.aucun_cta",
      "experience.cta_trop_bas",
      "experience.navigation_absente",
      "experience.navigation_surchargee",
    ],
    // Un bouton d'action se pose en une minute et rend le parcours possible ;
    // refaire un menu ne sert à rien tant qu'aucun geste n'est proposé.
    lever: "experience.aucun_cta",
  },
  /**
   * LA CAUSE QUE LES NOUVELLES LECTURES ONT RENDUE POSSIBLE.
   *
   * Elle n'aurait pas pu exister avant : prix, variantes et disponibilité
   * partielle n'étaient mesurés nulle part. Ils décrivent ensemble un seul
   * problème d'hygiène de catalogue — une part de ce qui est exposé ne peut pas
   * être achetée en l'état — et il se corrige d'un seul passage, pas fiche par
   * fiche selon trois listes différentes.
   */
  {
    id: "cause.catalogue_pas_achetable",
    title: "Une partie du catalogue exposé ne peut pas être achetée",
    statement:
      "Des fiches sont visibles en boutique alors qu'elles n'ont pas de prix, plus de stock, ou un choix dont la moitié est indisponible.",
    why: "Prix absent, rupture totale, choix partiellement épuisé : le visiteur rencontre à chaque fois le même mur, à la même étape — celle où il a déjà décidé d'acheter. Ce ne sont pas trois chantiers, c'est un passage en revue du catalogue, à faire une fois.",
    firstAction:
      "Trier le catalogue par disponibilité et par prix, puis retirer du canal Boutique en ligne tout ce qui ne peut pas être acheté aujourd'hui.",
    correction:
      "Dans Shopify → Produits, filtrer sur « Rupture de stock » et dépublier ces fiches du canal Boutique en ligne plutôt que de les laisser en « épuisé ». Trier ensuite par prix croissant et renseigner celles à zéro. Enfin, sur les fiches à variantes, masquer les variantes épuisées au lieu de les afficher grisées : un choix refusé coûte plus qu'un choix non proposé.",
    matches: [
      "offre.prix_absent",
      "merchandising.out_of_stock_share",
      "merchandising.choix_partiellement_epuise",
      "produit.achat_impossible",
    ],
    // Une fiche sans prix ne peut être achetée par personne, à aucune condition :
    // c'est le seul des trois qui n'a pas de demi-mesure.
    lever: "offre.prix_absent",
  },
  {
    id: "cause.boutique_non_mesuree",
    title: "La boutique n'est pas mesurée",
    statement:
      "Les données qui permettraient de dire OÙ se perd le chiffre d'affaires ne sont pas collectées.",
    why: "Trafic inconnu, origine des commandes inconnue, rétention incalculable : ce ne sont pas trois problèmes, c'est un seul — personne ne regarde. Tant qu'il dure, chaque décision se prend au jugé, y compris celles qui engagent un budget publicitaire.",
    firstAction:
      "Rendre mesurable ce qui ne l'est pas, en commençant par l'origine des commandes — c'est la seule mesure qui ne demande aucun outil supplémentaire.",
    correction:
      "Ajouter les paramètres de campagne sur tous les liens envoyés vers la boutique : publicités, e-mails, publications, signature. La forme est `?utm_source=instagram&utm_medium=bio`. Shopify enregistre alors l'origine de chaque commande, et EcomPilot peut confronter ce que les régies déclarent à ce qui a réellement été acheté.",
    matches: [
      "data.traffic_unmeasured",
      "data.attribution_coverage_low",
      "data.retention_non_evaluable",
    ],
    // L'origine des commandes est la seule des trois qui ne demande aucun outil
    // supplémentaire : elle se répare en marquant les liens.
    lever: "data.attribution_coverage_low",
  },
  {
    id: "cause.identite_flottante",
    title: "La boutique ne sait pas à qui elle parle",
    statement:
      "Le catalogue, les prix et la présentation désignent des publics différents, sans qu'aucun ne soit servi complètement.",
    why: "Écart entre ce qui est exposé et ce qui se vend, gamme trop étendue, présentation dispersée : chacun montre la même hésitation. Une boutique qui s'adresse à tout le monde ne convainc personne en particulier, et c'est ce qui rend chaque autre correction moins efficace qu'elle ne devrait.",
    firstAction:
      "Choisir le public que la boutique sert déjà le mieux, et aligner la page d'accueil sur lui — pas sur le catalogue entier.",
    correction:
      "Lister les cinq produits qui ont généré le plus de commandes sur trente jours. Vérifier qu'ils sont atteignables en un clic depuis la page d'accueil. S'ils ne le sont pas, les y placer avant toute autre modification, et retirer de la page d'accueil les produits qui ne se vendent pas — ils dispersent l'attention sans compenser.",
    matches: [
      "audience.vitrine_contredite",
      "audience.remise_contre_gamme",
      "experience.typographies_multiples",
      "experience.palette_dispersee",
      "merchandising.catalog_concentration",
      "offre.discount_dependency",
    ],
    // Choisir le public se lit d'abord dans ce que la vitrine met en avant.
    lever: "merchandising.catalog_concentration",
  },
];

// ---------------------------------------------------------------------------
// Regroupement
// ---------------------------------------------------------------------------

export type RootCause = {
  id: string;
  title: string;
  statement: string;
  why: string;
  /** Les constats que cette cause explique. */
  symptoms: Array<{ id: string; title: string }>;
  /** Union des preuves des symptômes. Jamais une phrase de plus. */
  evidence: string[];
  /**
   * Le niveau le PLUS FAIBLE parmi les symptômes.
   *
   * Un regroupement ne peut pas être plus certain que le moins certain de ce
   * qu'il regroupe. Prendre le plus fort permettrait à un constat « à vérifier »
   * de sortir promu par le simple fait d'être accompagné.
   */
  level: EvidenceLevel;
  firstAction: string;
  correction: string;
  impact: number;
  effort: number;
  priority: number;
  /** Le constat qui porte le premier geste. Voir `CauseDefinition.lever`. */
  lever: string;
  /** Constats que le levier débloque. `symptoms.length - 1`. */
  dependents: number;
};

function weakest(levels: EvidenceLevel[]): EvidenceLevel {
  return levels.reduce(
    (pire, l) => (EVIDENCE_LEVELS.indexOf(l) > EVIDENCE_LEVELS.indexOf(pire) ? l : pire),
    EVIDENCE_LEVELS[0] as EvidenceLevel,
  );
}

/**
 * Regroupe les symptômes sous leurs causes.
 *
 * Rend les causes formées ET les symptômes restés seuls : un constat qui
 * n'entre dans aucune famille ne doit pas disparaître du rapport parce qu'il
 * était le seul de son espèce. Le perdre serait pire que de ne pas regrouper.
 */
export function groupByCause(symptoms: Symptom[]): {
  causes: RootCause[];
  isolated: Symptom[];
} {
  const pris = new Set<string>();
  const causes: RootCause[] = [];

  for (const def of CAUSES) {
    const membres = symptoms.filter(
      (s) => !pris.has(s.id) && def.matches.some((m) => s.id === m || s.id.startsWith(`${m}.`)),
    );
    if (membres.length < MIN_SYMPTOMS_FOR_CAUSE) continue;

    for (const m of membres) pris.add(m.id);

    const impact = Math.max(...membres.map((m) => m.impact));
    // L'effort de la cause est celui de son PREMIER geste, pas la somme des
    // corrections : le plan doit rester praticable, et c'est ce premier geste
    // qui débloque les suivants.
    const effort = Math.min(...membres.map((m) => m.effort));
    const level = weakest(membres.map((m) => m.level));

    causes.push({
      id: def.id,
      title: def.title,
      statement: def.statement,
      why: def.why,
      symptoms: membres.map((m) => ({ id: m.id, title: m.title })),
      evidence: [...new Set(membres.flatMap((m) => m.evidence))],
      level,
      firstAction: def.firstAction,
      correction: def.correction,
      impact,
      effort,
      // LE POIDS DE PREUVE MANQUAIT ICI, et c'était un vrai défaut.
      //
      // La priorité d'une cause valait `impact × 100 ÷ effort` : le niveau de
      // preuve n'y entrait pas. Une cause faite de trois constats « à vérifier »
      // sortait donc au même rang qu'une cause faite de trois constats prouvés,
      // à impact égal. La formule est maintenant celle des constats — impact ×
      // preuve × dépendance ÷ effort —, ce qui rend les deux listes
      // comparables et empêche une hypothèse bien accompagnée de doubler un
      // fait.
      //
      // `level` est déjà celui du MOINS certain des membres : le regroupement
      // ne peut pas se promouvoir en s'élargissant.
      priority: Math.round(
        (impact * EVIDENCE_WEIGHT[level] * dependencyEffect(membres.length - 1) * 100) /
          Math.max(1, effort),
      ),
      lever: leverOf(def, membres),
      dependents: membres.length - 1,
    });
  }

  causes.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  return { causes, isolated: symptoms.filter((s) => !pris.has(s.id)) };
}

/**
 * Le constat qui porte le premier geste de cette cause.
 *
 * Le levier déclaré s'il a été constaté ; sinon celui de plus fort impact parmi
 * les membres. Une dépendance réelle ne disparaît pas parce que son levier
 * habituel n'a pas été relevé ce jour-là — mais elle change alors de porteur, et
 * cela se lit.
 */
function leverOf(def: CauseDefinition, membres: Symptom[]): string {
  const declare = membres.find((m) => m.id === def.lever);
  if (declare) return declare.id;
  return [...membres].sort((a, b) => b.impact - a.impact || a.id.localeCompare(b.id))[0].id;
}

/**
 * Ce que chaque constat DÉBLOQUE, prêt pour la priorisation.
 *
 * LE CHAÎNON QUI MANQUAIT. Les causes racines étaient calculées, justes, et
 * n'avaient aucun poids sur l'ordre des actions : le rapport pouvait donc
 * proposer de corriger un symptôme avant la cause qui le produit — exactement
 * ce qu'un audit existe pour éviter.
 *
 * Seul le LEVIER de chaque cause reçoit le compte. Distribuer l'avantage à tous
 * les membres reviendrait à faire remonter le groupe entier, ce qui ne dit plus
 * par quoi commencer ; et l'accorder à un membre non désigné rendrait l'ordre
 * indéfendable. Le compte exclut le levier lui-même : il vaut ce qu'il débloque.
 */
export function dependentsByFinding(causes: RootCause[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of causes) out.set(c.lever, c.symptoms.length - 1);
  return out;
}

// ---------------------------------------------------------------------------
// Transmission au modèle
// ---------------------------------------------------------------------------

const LEVEL_LABELS: Record<EvidenceLevel, string> = {
  prouve: "PROUVÉ",
  fortement_suggere: "FORTEMENT SUGGÉRÉ",
  a_verifier: "À VÉRIFIER",
  donnee_insuffisante: "DONNÉE INSUFFISANTE",
};

export function causesToPromptBlock(causes: RootCause[], isolated: Symptom[]): string {
  const l: string[] = [];
  if (causes.length === 0) {
    l.push(
      "CAUSES RACINES : aucune. Les constats relevés ne se regroupent pas sous une cause commune — traite-les individuellement.",
    );
  } else {
    l.push(
      "CAUSES RACINES — plusieurs constats, un seul problème sous-jacent :",
      "Ces regroupements sont établis. Le rapport doit parler de LA cause, pas de chacun de ses symptômes séparément.",
    );
    for (const c of causes) {
      l.push(
        "",
        `[${c.id}] ${c.title} — ${LEVEL_LABELS[c.level]} — priorité ${c.priority}`,
        `  Le problème réel : ${c.statement}`,
        `  Pourquoi c'est UN problème : ${c.why}`,
        `  Constats qu'il explique : ${c.symptoms.map((s) => s.title).join(" ; ")}`,
        `  Preuves : ${c.evidence.join(" ; ")}`,
        `  Premier geste : ${c.firstAction}`,
        `  Correction : ${c.correction}`,
        `  Impact ${c.impact}/5, effort ${c.effort}/5`,
        `  Levier : ${c.lever} — sa correction en débloque ${c.dependents} autre(s), ce qui lui donne son avantage de priorité.`,
      );
    }
  }

  if (isolated.length > 0) {
    l.push(
      "",
      "CONSTATS ISOLÉS — sans cause commune identifiée :",
      ...isolated.map((s) => `- ${s.title}`),
    );
  }

  l.push(
    "",
    "RÈGLES ABSOLUES SUR LES CAUSES :",
    "- Quand des constats sont regroupés sous une cause, tu présentes UNE action, pas une par symptôme. Le marchand doit repartir avec un geste, pas avec une liste.",
    "- Tu ne fais jamais remonter le niveau de preuve d'une cause : il est déjà celui du moins certain de ses symptômes.",
    "- Tu ne crées aucune cause qui ne soit pas dans cette liste, et tu n'en fusionnes aucune.",
    "- Les constats isolés restent isolés : ne leur invente pas une cause commune pour faire un récit plus net.",
  );

  return l.join("\n");
}
