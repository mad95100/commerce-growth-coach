/**
 * APPRENDRE → RÉANALYSER. Ce qui a déjà été tenté, et ce qu'on en fait.
 *
 * LE PROBLÈME QUE CELA RÈGLE. Chaque audit repartait de zéro. Le modèle ne
 * savait pas qu'on avait déjà réécrit la fiche produit le mois dernier, ni que
 * ça n'avait rien donné, ni qu'un changement de budget avait fait reculer la
 * boutique. Il reproposait donc les mêmes corrections, avec les mêmes
 * arguments — et le marchand, qui les avait déjà faites, en concluait
 * raisonnablement que l'outil ne servait à rien.
 *
 * Un diagnostic qui ne se souvient pas n'est pas un diagnostic : c'est un
 * générateur de suggestions.
 *
 * CE QUE CE MODULE APPORTE. Une mémoire, et cinq façons de s'en servir selon ce
 * que la mesure a établi :
 *
 * | Ce qu'on a mesuré      | Ce qu'on en fait                                    |
 * | ---------------------- | --------------------------------------------------- |
 * | ✅ Amélioration        | Acquis. On cherche ailleurs, le blocage a bougé.    |
 * | ❌ Aucun impact        | Le DIAGNOSTIC s'était trompé. On écarte cette piste.|
 * | 🔴 Régression          | Priorité maximale, et on recommande l'annulation.   |
 * | ⚠️ Insuffisant         | On ne conclut pas. Il faut plus de données.         |
 * | ⏳ Mesure en cours     | Idem : on n'a pas encore le droit de trancher.      |
 *
 * DEUX BARRIÈRES, PAS UNE. Le prompt DEMANDE au modèle de ne pas répéter — et
 * le filtre l'EMPÊCHE. Une consigne de prompt est une préférence, pas une
 * garantie : un modèle qui reformule légèrement passerait au travers. La
 * mécanique tranche, la consigne explique.
 *
 * Module PUR : aucune entrée-sortie.
 */

import { normalizeKey } from "@/lib/finding-graph";

// ---------------------------------------------------------------------------
// Ce qu'on garde d'une tentative
// ---------------------------------------------------------------------------

export type Attempt = {
  /** Clé du problème corrigé, telle que l'audit l'avait produite. */
  key: string | null;
  title: string;
  category: string | null;
  /** Outil d'exécution, `null` si la correction a été faite à la main. */
  tool: string | null;
  /** Verdict de `measure.ts`. `null` si jamais mesurée. */
  verdict: string | null;
  headline: string | null;
  appliedAt: string;
  rollbackRecommended?: boolean | null;
  rollbackPossible?: boolean | null;
};

/** Un problème que l'audit vient de proposer, avant confrontation à la mémoire. */
export type Candidate = {
  key?: string | null;
  title: string;
  category?: string | null;
  tool?: string | null;
};

/**
 * IDENTITÉ D'UN PROBLÈME.
 *
 * La clé plutôt que le titre : deux audits successifs reformulent volontiers
 * « Frais de port cachés » en « Les frais de livraison ne sont pas annoncés »,
 * et comparer des titres ferait passer le même problème pour un nouveau. La
 * clé, elle, est un identifiant court que le modèle est explicitement invité à
 * garder stable. À défaut de clé, le titre normalisé sert de repli.
 */
export function attemptSignature(input: { key?: string | null; title?: string | null }): string {
  return normalizeKey(input.key) || normalizeKey(input.title) || "";
}

export type Similarity = "identique" | "similaire" | "nouveau";

/**
 * Ce candidat ressemble-t-il à quelque chose de déjà tenté ?
 *
 * - `identique` : même problème, retenté. C'est le cas qui doit être bloqué.
 * - `similaire` : problème différent, mais même domaine ET même outil — on
 *   s'apprête à refaire la même chose ailleurs. À ne pas bloquer, mais à
 *   signaler : si la méthode a échoué une fois, il faut dire en quoi ce
 *   coup-ci diffère.
 * - `nouveau` : aucun rapport.
 *
 * L'ordre compte : une correspondance exacte l'emporte toujours sur une
 * ressemblance, même si la ressemblance est plus récente.
 */
export function compareToHistory(
  candidate: Candidate,
  history: Attempt[],
): { similarity: Similarity; match: Attempt | null } {
  const signature = attemptSignature(candidate);
  const category = candidate.category ?? null;
  const tool = candidate.tool ?? null;

  if (signature) {
    const exact = history.find((a) => attemptSignature(a) === signature);
    if (exact) return { similarity: "identique", match: exact };
  }

  const similar = history.find(
    (a) => category !== null && a.category === category && (a.tool ?? null) === tool,
  );
  if (similar) return { similarity: "similaire", match: similar };

  return { similarity: "nouveau", match: null };
}

// ---------------------------------------------------------------------------
// Ce qu'on décide d'un candidat
// ---------------------------------------------------------------------------

export const HISTORY_ACTIONS = ["proposer", "prioriser", "reformuler", "ecarter"] as const;

export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

export type HistoryGuidance = {
  action: HistoryAction;
  similarity: Similarity;
  /** La tentative qui motive la décision, `null` si le problème est neuf. */
  match: Attempt | null;
  /** Pourquoi cette décision, en français, affichable telle quelle. */
  reason: string;
};

/** Verdicts qui autorisent une conclusion. Les autres demandent d'attendre. */
const SETTLED = new Set(["confirme", "nul", "regression"]);

/**
 * Que faire de ce candidat, au vu de ce qu'on a déjà mesuré ?
 *
 * `ecarter` retire purement le problème du rapport : le reproposer serait au
 * mieux inutile, au pire une perte de crédit. `prioriser` le fait remonter en
 * tête — une régression est ce qu'il y a de plus urgent. `reformuler` le garde
 * en exigeant qu'il dise en quoi il diffère. `proposer` le laisse tel quel.
 */
export function guidanceFor(candidate: Candidate, history: Attempt[]): HistoryGuidance {
  const { similarity, match } = compareToHistory(candidate, history);
  if (!match) {
    return {
      action: "proposer",
      similarity,
      match: null,
      reason: "Vous n'avez pas encore traité ce point.",
    };
  }

  const when = frenchDate(match.appliedAt);

  if (similarity === "identique") {
    switch (match.verdict) {
      case "regression":
        return {
          action: "prioriser",
          similarity,
          match,
          reason: `Déjà tenté le ${when}, et la boutique a reculé. ${
            match.rollbackPossible
              ? "L'annulation est automatisable : c'est le premier geste."
              : "Il faut revenir en arrière à la main avant toute autre chose."
          }`,
        };
      case "nul":
        return {
          action: "ecarter",
          similarity,
          match,
          reason: `Déjà corrigé le ${when}, sans effet mesurable. Ce n'était pas le blocage : le rechercher ici serait chercher au même endroit une deuxième fois.`,
        };
      case "confirme":
        return {
          action: "ecarter",
          similarity,
          match,
          reason: `Déjà corrigé le ${when}, et l'effet est prouvé. C'est un acquis : le blocage est ailleurs maintenant.`,
        };
      default:
        return {
          action: "reformuler",
          similarity,
          match,
          reason: `Déjà tenté le ${when}, mais la mesure n'a pas encore tranché. Il manque des données : ne conclus pas, dis ce qu'il faut observer.`,
        };
    }
  }

  // Ressemblance : même domaine, même méthode, problème différent.
  if (match.verdict === "nul" || match.verdict === "regression") {
    return {
      action: "reformuler",
      similarity,
      match,
      reason: `Une correction du même type — « ${match.title} », le ${when} — ${
        match.verdict === "nul" ? "n'a rien donné" : "a fait reculer la boutique"
      }. Explique en quoi celle-ci est différente, ou change d'angle.`,
    };
  }

  return {
    action: "proposer",
    similarity,
    match,
    reason: `Une correction du même type a déjà été appliquée le ${when}. Rien ne s'oppose à celle-ci.`,
  };
}

/**
 * Applique la mémoire à une liste de problèmes proposés par le modèle.
 *
 * C'est la barrière mécanique. Elle s'exerce APRÈS le modèle, précisément
 * parce qu'on ne peut pas compter sur lui : la consigne de prompt réduit les
 * répétitions, elle ne les empêche pas.
 */
export function applyHistory<T extends Candidate>(
  candidates: T[],
  history: Attempt[],
): {
  /** Problèmes retenus, chacun accompagné de ce que la mémoire en dit. */
  kept: Array<{ finding: T; guidance: HistoryGuidance }>;
  /** Problèmes retirés du rapport, et pourquoi. */
  dropped: Array<{ finding: T; guidance: HistoryGuidance }>;
} {
  const kept: Array<{ finding: T; guidance: HistoryGuidance }> = [];
  const dropped: Array<{ finding: T; guidance: HistoryGuidance }> = [];

  for (const finding of candidates) {
    const guidance = guidanceFor(finding, history);
    (guidance.action === "ecarter" ? dropped : kept).push({ finding, guidance });
  }

  // Un rapport vide ne rend service à personne : si la mémoire a tout écarté,
  // c'est que l'audit n'a rien trouvé de neuf — mieux vaut le dire en gardant
  // les problèmes et leur explication que de renvoyer une page blanche.
  if (kept.length === 0 && dropped.length > 0) {
    return { kept: dropped, dropped: [] };
  }

  return { kept, dropped };
}

// ---------------------------------------------------------------------------
// Ce qu'on en dit
// ---------------------------------------------------------------------------

function frenchDate(iso: string): string {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return "une date inconnue";
  return new Date(time).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const VERDICT_STORY: Record<string, string> = {
  confirme: "ça a marché, l'effet est mesuré",
  nul: "ça n'a rien changé",
  insuffisant: "l'effet est trop faible pour être prouvé",
  regression: "la boutique a reculé",
  en_cours: "la mesure est encore en cours",
};

/**
 * Le bloc injecté dans la demande d'audit.
 *
 * Écrit à la deuxième personne et sans jargon, comme le reste du prompt. Chaque
 * ligne porte une consigne opérationnelle plutôt qu'un simple constat : un
 * modèle suit mieux « ne repropose pas » que « cela a été fait ».
 */
export function historyToPromptBlock(history: Attempt[]): string {
  if (history.length === 0) {
    return `HISTORIQUE DES CORRECTIONS : aucune correction n'a encore été appliquée sur cette boutique. Tout est à découvrir.`;
  }

  const lines = history.map((attempt) => {
    const story = VERDICT_STORY[attempt.verdict ?? ""] ?? "le résultat n'est pas encore connu";
    const instruction =
      attempt.verdict === "nul"
        ? "NE REPROPOSE PAS cette correction : elle a été faite et n'a rien produit. Cherche une autre cause."
        : attempt.verdict === "confirme"
          ? "C'est un acquis. Ne le represente pas comme un problème ; cherche ce qui bloque MAINTENANT."
          : attempt.verdict === "regression"
            ? "URGENT : cette correction a dégradé la situation. Remets-la en tête et recommande de revenir en arrière."
            : "La mesure n'a pas tranché. Ne conclus rien dessus : dis quelle donnée il faudrait pour trancher.";
    return `- « ${attempt.title} » (${attempt.category ?? "domaine inconnu"}), appliquée le ${frenchDate(attempt.appliedAt)} : ${story}.${attempt.headline ? ` ${attempt.headline}` : ""} → ${instruction}`;
  });

  return `HISTORIQUE DES CORRECTIONS DÉJÀ APPLIQUÉES (${history.length}) :
${lines.join("\n")}

RÈGLE ABSOLUE SUR CET HISTORIQUE : cette boutique a déjà travaillé. Reproposer ce
qui a été fait sans effet est la faute la plus grave que tu puisses commettre ici —
c'est ce qui fait perdre confiance. Si une piste ressemble à une correction déjà
tentée sans succès, soit tu l'écartes, soit tu expliques précisément en quoi la
tienne est différente.`;
}

/**
 * L'explication complète d'une décision, en cinq temps.
 *
 * Ce que demande un directeur à qui l'on propose une action : qu'a-t-on tenté,
 * pourquoi, qu'a-t-on obtenu, que fait-on maintenant, et en quoi est-ce
 * différent. Sans le cinquième point, les quatre premiers ne sont qu'un
 * historique.
 */
export type AttemptStory = {
  tried: string;
  why: string;
  result: string;
  next: string;
  difference: string;
};

export function explainAttempt(
  guidance: HistoryGuidance,
  candidate: Candidate & { rootCause?: string | null },
): AttemptStory {
  const match = guidance.match;

  if (!match) {
    return {
      tried: "Rien n'a encore été tenté sur ce point.",
      why: candidate.rootCause ?? "C'est la première fois que ce problème est identifié.",
      result: "Aucune mesure disponible : la correction n'a pas eu lieu.",
      next: `Corriger « ${candidate.title} ».`,
      difference: "Piste neuve : rien de comparable n'a été essayé.",
    };
  }

  const when = frenchDate(match.appliedAt);
  const story = VERDICT_STORY[match.verdict ?? ""] ?? "le résultat n'est pas encore connu";

  return {
    tried: `« ${match.title} », appliquée le ${when}${match.tool ? ` via ${match.tool}` : " à la main"}.`,
    why: candidate.rootCause ?? `C'était la cause identifiée à l'époque pour ce blocage.`,
    result: match.headline ? `${capitalize(story)}. ${match.headline}` : `${capitalize(story)}.`,
    next:
      guidance.action === "prioriser"
        ? `Annuler cette correction avant toute autre chose.`
        : guidance.action === "ecarter"
          ? `Ne pas y revenir. Chercher le blocage ailleurs.`
          : guidance.action === "reformuler"
            ? `Reprendre « ${candidate.title} », mais autrement.`
            : `Corriger « ${candidate.title} ».`,
    difference: differenceSentence(guidance, candidate, match),
  };
}

/** En quoi la nouvelle action diffère de ce qui a déjà été tenté. */
function differenceSentence(
  guidance: HistoryGuidance,
  candidate: Candidate,
  match: Attempt,
): string {
  if (guidance.similarity === "identique") {
    return match.verdict === "regression"
      ? "Ce n'est pas une nouvelle tentative : c'est le retour à l'état d'avant."
      : "C'est exactement ce qui a déjà été tenté — d'où la décision de ne pas le reproposer tel quel.";
  }

  const sameArea = (candidate.category ?? null) === match.category;
  const sameTool = (candidate.tool ?? null) === (match.tool ?? null);

  if (sameArea && sameTool) {
    return `Même domaine et même méthode que « ${match.title} », sur un autre point. Si celle-là n'a rien donné, il faut dire pourquoi celle-ci ferait mieux.`;
  }
  if (sameArea) {
    return `Même domaine que « ${match.title} », mais par un autre moyen.`;
  }
  return `Autre domaine que « ${match.title} » : ce n'est pas la même piste.`;
}

function capitalize(text: string): string {
  return text.length > 0 ? text[0].toUpperCase() + text.slice(1) : text;
}
