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
import { EVIDENCE_LEVELS } from "@/lib/audit-rules";

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
      // Même formule que la priorisation des constats : l'effort divise, pour
      // qu'un geste court passe très loin devant un chantier à impact égal.
      priority: Math.round((impact * 100) / Math.max(1, effort)),
    });
  }

  causes.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  return { causes, isolated: symptoms.filter((s) => !pris.has(s.id)) };
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
