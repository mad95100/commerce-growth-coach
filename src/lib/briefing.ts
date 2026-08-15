/**
 * LE BRIEFING. Ce qu'un directeur e-commerce dirait, en arrivant.
 *
 * CE QUE CE MODULE CORRIGE. Le moteur calcule l'entonnoir, localise la fuite,
 * la chiffre, croise les canaux, classe les causes et sait ce qu'il ignore —
 * et le marchand ne voit rien de tout cela. Il voit une liste de problèmes.
 * Une liste, même bien classée, ne répond pas à la seule question qu'il se
 * pose : « qu'est-ce que je fais maintenant ? »
 *
 * Ce module ne calcule rien de neuf. Il ASSEMBLE ce que le moteur a déjà
 * établi en une réponse tenue de bout en bout : le problème, ce qu'il coûte,
 * la preuve, le niveau de certitude, la cause, ce qu'on sait, ce qu'on ignore,
 * le geste, son effet attendu, et comment on vérifiera. Rien n'y est écrit en
 * dur — chaque phrase est construite depuis les données ou n'apparaît pas.
 *
 * DEUX RÈGLES QUE L'AFFICHAGE NE DOIT PAS TRAHIR :
 *
 * 1. **Un montant non chiffrable ne devient pas zéro.** Il devient « je ne
 *    peux pas le chiffrer, et voici pourquoi ». Une case vide dans un tableau
 *    de bord se lit comme une mesure ; une phrase ne se lit pas ainsi.
 *
 * 2. **Un bouton ne prétend jamais avoir corrigé.** « Corriger maintenant »
 *    n'est proposé que là où une correction existe réellement, et il ouvre un
 *    aperçu avant toute écriture. Partout ailleurs, c'est « Guider la
 *    correction » — une procédure, annoncée comme telle.
 *
 * Module PUR.
 */

import type { Funnel, FunnelLeak } from "@/lib/funnel";
import type { NextMovePlan, PlannedMove, RollbackAlert } from "@/lib/next-move";
import { EPISTEMIC_HINTS, EPISTEMIC_LABELS, type EpistemicLevel } from "@/lib/finding-graph";
import { formatMinutes } from "@/lib/scoring";

/** Ce que le briefing sait du problème en tête, au-delà du plan. */
export type BriefingFinding = {
  rootCause?: string | null;
  impactDescription?: string | null;
  epistemic?: EpistemicLevel | null;
  basedOn?: string | null;
  assumptions?: string | null;
  gainMin?: number | null;
  gainMax?: number | null;
  currency?: string | null;
  actionSteps?: string[];
};

export type BriefingInput = {
  plan: NextMovePlan | null;
  funnel?: Funnel | null;
  finding?: BriefingFinding | null;
  /** Devise de la boutique, pour les montants qui n'en portent pas. */
  currency?: string | null;
};

export type BriefingAction = {
  /** `corriger` = une correction existe et sera montrée avant d'être écrite. */
  kind: "corriger" | "guider" | "annuler" | "attendre";
  label: string;
  /** Pourquoi cette action-là, et pas une autre. */
  why: string;
  /** Étapes, quand il faut la main. Vide quand la correction est automatisable. */
  steps: string[];
  /** L'action écrit-elle quelque part ? Faux tant que rien n'est confirmé. */
  writes: boolean;
};

export type Briefing = {
  /** « Priorité #1 — … ». `null` quand il n'y a rien à faire. */
  headline: string | null;
  /** Ce que le problème coûte. Toujours une phrase, jamais un zéro par défaut. */
  impact: string;
  /** Chiffres bruts qui soutiennent la conclusion. */
  proof: string[];
  certainty: { level: EpistemicLevel | null; label: string; hint: string };
  rootCause: string | null;
  known: string[];
  unknown: string[];
  action: BriefingAction | null;
  expected: string;
  verification: string;
  nextDecision: string;
};

function money(
  value: number | null | undefined,
  currency: string | null | undefined,
): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${Math.round(value)}${currency ? ` ${currency}` : ""}`;
}

/**
 * Le montant, ou la raison de ne pas en donner.
 *
 * L'ordre compte : la fuite MESURÉE prime sur l'estimation du modèle, parce
 * qu'elle vient des données de la boutique. Une estimation ne sert que là où
 * rien n'est mesurable.
 */
function impactSentence(
  leak: FunnelLeak | null,
  finding: BriefingFinding | null,
  currency: string | null | undefined,
): string {
  if (leak && leak.costPerMonth !== null) {
    return (
      `Environ ${money(leak.costPerMonth, leak.currency ?? currency)} par mois. ` +
      `Ce montant vient de tes chiffres : ${Math.round(leak.entered)} ${leak.fromLabel.toLowerCase()} ` +
      `n'ont produit que ${Math.round(leak.exited)} ${leak.toLabel.toLowerCase()}, soit ${leak.missing} de moins ` +
      `que ce qu'on observe habituellement.`
    );
  }

  const min = money(finding?.gainMin, finding?.currency ?? currency);
  const max = money(finding?.gainMax, finding?.currency ?? currency);
  if (min && max)
    return `Estimé entre ${min} et ${max} par mois. C'est une estimation, pas une mesure.`;
  if (max) return `Estimé jusqu'à ${max} par mois. C'est une estimation, pas une mesure.`;

  // Le point qui compte : on ne remplit pas la case avec un zéro.
  return "Pas chiffrable avec les données disponibles. Ce n'est pas zéro — c'est inconnu, et le dire vaut mieux qu'un chiffre inventé.";
}

/**
 * Assemble le briefing.
 *
 * Chaque section est construite depuis le moteur ou disparaît. Une section
 * vide serait pire qu'absente : elle suggérerait qu'on a cherché et rien
 * trouvé, alors qu'on n'a simplement pas la donnée.
 */
export function buildBriefing(input: BriefingInput): Briefing {
  const plan = input.plan;
  const move = plan?.now ?? null;
  const alert = plan?.alert ?? null;
  const leak = input.funnel?.worst ?? null;
  const finding = input.finding ?? null;
  const currency = input.currency ?? null;

  // Une régression passe avant tout : réparer un dégât prime sur tout gain.
  if (alert) return regressionBriefing(alert, plan!);

  if (!move) {
    return {
      headline: null,
      impact: "Rien à chiffrer : aucun problème en attente.",
      proof: [],
      certainty: { level: null, label: "—", hint: "" },
      rootCause: null,
      known: provenLines(plan),
      unknown: [],
      action: null,
      expected: "",
      verification: "",
      nextDecision:
        plan === null
          ? "Lance un premier diagnostic pour savoir où tu en es."
          : "Relance un diagnostic : c'est en mesurant l'effet des corrections qu'on trouve le prochain levier.",
    };
  }

  const epistemic = finding?.epistemic ?? null;

  // --- Preuves --------------------------------------------------------------
  const proof: string[] = [];
  if (leak) proof.push(...leak.evidence);
  if (finding?.basedOn) proof.push(finding.basedOn);

  // --- Ce qu'on sait, ce qu'on ignore --------------------------------------
  const known: string[] = [];
  if (finding?.impactDescription) known.push(finding.impactDescription);
  if (leak) {
    known.push(
      `Le passage « ${leak.fromLabel} → ${leak.toLabel} » se fait à ${leak.rate} %, contre ${leak.reference} % habituellement.`,
    );
  }
  if (move.unlocks.length > 0) {
    known.push(
      `Corriger ce point fait tomber ${move.unlocks.map((u) => `« ${u} »`).join(" et ")} du même coup.`,
    );
  }
  known.push(...provenLines(plan));

  const unknown: string[] = [];
  if (finding?.assumptions) unknown.push(finding.assumptions);
  if (leak) unknown.push(leak.referenceNote + " C'est un ordre de grandeur, pas une loi.");
  for (const step of input.funnel?.unknown ?? []) {
    unknown.push(
      `« ${step} » n'est pas mesuré : la fuite n'a pas été cherchée autour de cette étape.`,
    );
  }
  for (const u of plan?.unknowns ?? []) {
    unknown.push(`« ${u.title} » : je n'ai pas la donnée pour trancher.`);
  }

  // --- L'action -------------------------------------------------------------
  const steps = finding?.actionSteps ?? [];
  const action: BriefingAction = move.hasAutoFix
    ? {
        kind: "corriger",
        label: "Corriger maintenant",
        why:
          move.reason ??
          "C'est le geste qui a le meilleur rapport entre ce qu'il rapporte et ce qu'il coûte.",
        steps: [],
        // Rien n'est écrit tant que l'aperçu n'a pas été confirmé.
        writes: false,
      }
    : {
        kind: "guider",
        label: "Guider la correction",
        why:
          move.reason ??
          "Cette correction n'est pas automatisable : elle demande une décision qui t'appartient.",
        steps,
        writes: false,
      };

  const duration = move.timeMinutes ? ` Compte ${formatMinutes(move.timeMinutes)}.` : "";

  return {
    headline: `Priorité #1 — ${move.title}`,
    impact: impactSentence(leak, finding, currency),
    proof,
    certainty: {
      level: epistemic,
      label: epistemic ? EPISTEMIC_LABELS[epistemic] : "Non classé",
      hint: epistemic ? EPISTEMIC_HINTS[epistemic] : "",
    },
    rootCause: finding?.rootCause ?? null,
    known,
    unknown,
    action,
    expected: leak
      ? `Si ce passage remonte à ${leak.reference} %, tu récupères jusqu'à ${leak.missing} ${leak.toLabel.toLowerCase()} par mois.${duration}`
      : `Une amélioration sur ${move.category}, dont l'ampleur reste à mesurer.${duration}`,
    verification: `Ensuite, je regarde ${move.measure}. C'est ça qui dira si ça a marché — pas une impression.`,
    nextDecision:
      plan && plan.then.length > 0
        ? `Une fois mesuré : « ${plan.then[0].title} ».`
        : "Une fois mesuré, je relancerai un diagnostic pour trouver le levier suivant.",
  };
}

/** Le briefing d'une correction qui a fait reculer la boutique. */
function regressionBriefing(alert: RollbackAlert, plan: NextMovePlan): Briefing {
  return {
    headline: `À réparer avant tout — ${alert.title}`,
    impact: alert.headline ?? "Cette correction a dégradé la situation.",
    proof: alert.headline ? [alert.headline] : [],
    certainty: {
      level: "fait",
      label: EPISTEMIC_LABELS.fait,
      hint: "Mesuré après la correction, sur tes propres chiffres.",
    },
    rootCause: "Une correction appliquée récemment a produit l'effet inverse de celui attendu.",
    known: [alert.headline ?? "La dégradation est mesurée, pas supposée."],
    unknown: [],
    action: {
      kind: "annuler",
      label: alert.automatic ? "Annuler la correction" : "Revenir en arrière à la main",
      why: alert.automatic
        ? "L'état d'avant est connu : l'annulation est automatisable, et c'est le premier geste."
        : "Cette correction ne s'annule pas toute seule. La procédure est dans le suivi des mesures.",
      steps: alert.automatic ? [] : ["Ouvrir le suivi des mesures", "Suivre la procédure indiquée"],
      writes: false,
    },
    expected: "Retour à l'état d'avant la correction.",
    verification:
      "Je remesure automatiquement, et je te préviens si la situation ne se rétablit pas.",
    nextDecision: plan.now
      ? `Ensuite, on reprend par « ${plan.now.title} ».`
      : "Ensuite, on relance un diagnostic.",
  };
}

/** Ce qui est prouvé, et ce qui n'a rien donné. Deux enseignements distincts. */
function provenLines(plan: NextMovePlan | null): string[] {
  if (!plan) return [];
  const lines: string[] = [];
  for (const p of plan.proven) {
    lines.push(`« ${p.title} » a produit son effet${p.headline ? ` : ${p.headline}` : ""}.`);
  }
  for (const p of plan.ineffective) {
    lines.push(`« ${p.title} » n'a rien changé : ce n'était pas le blocage.`);
  }
  return lines;
}

/** Les six états qu'un problème peut avoir sous les yeux du marchand. */
export const WORK_STATES = [
  "a_faire",
  "en_attente",
  "en_mesure",
  "prouve",
  "sans_effet",
  "regression",
] as const;

export type WorkState = (typeof WORK_STATES)[number];

export const WORK_STATE_LABELS: Record<WorkState, string> = {
  a_faire: "À faire",
  en_attente: "En attente d'une autre correction",
  en_mesure: "En cours de mesure",
  prouve: "Prouvé",
  sans_effet: "Sans effet mesurable",
  regression: "A dégradé la situation",
};

/**
 * Répartit tout le travail par état.
 *
 * C'est ce qui remplace « voici 25 recommandations » : le marchand voit ce
 * qu'il reste à faire, ce qui attend, ce qui se mesure et ce qui est acquis,
 * sans avoir à trier lui-même.
 */
export function summariseWork(plan: NextMovePlan | null): Record<WorkState, number> {
  const counts: Record<WorkState, number> = {
    a_faire: 0,
    en_attente: 0,
    en_mesure: 0,
    prouve: 0,
    sans_effet: 0,
    regression: 0,
  };
  if (!plan) return counts;

  counts.a_faire = (plan.now ? 1 : 0) + plan.then.length;
  counts.en_attente = plan.blocked.length;
  counts.prouve = plan.proven.length;
  counts.sans_effet = plan.ineffective.length;
  counts.regression = plan.alert ? 1 : 0;
  return counts;
}
