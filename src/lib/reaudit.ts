/**
 * RÉANALYSER. Quand un nouveau diagnostic est justifié, et qui décide.
 *
 * LE DERNIER MAILLON. La boucle était complète en logique — détecter,
 * diagnostiquer, corriger, mesurer, apprendre — mais son bouclage restait
 * manuel : c'est le marchand qui devait penser à relancer un diagnostic. Or le
 * moment où il faut le relancer n'est pas une intuition, c'est un FAIT
 * mesurable : quand des corrections viennent d'obtenir un verdict définitif, la
 * boutique n'est plus celle qui a été auditée. Les hypothèses du diagnostic
 * précédent ont été testées ; certaines sont tombées.
 *
 * QUI PAIE, ET DONC QUI DÉCIDE. Un audit coûte un appel facturé au fournisseur
 * de modèles et consomme un quota mensuel. Déclencher un audit automatique
 * revient donc à dépenser l'argent du marchand sans le lui demander.
 *
 * La règle retenue évite d'avoir à poser la question, et n'introduit aucun
 * réglage à gérer : **on lance quand le quota est illimité, on propose quand il
 * est compté.** Un abonné dont les audits sont inclus ne subit aucune surprise ;
 * un compte gratuit garde la main sur ses trois audits du mois. Personne ne voit
 * son allocation fondre pendant son sommeil.
 *
 * Module PUR : aucune entrée-sortie. Il ne lance rien, il décide.
 */

/** Verdicts qui apprennent quelque chose. Les autres ne justifient rien. */
const SETTLED_VERDICTS = new Set(["confirme", "nul", "regression"]);

/**
 * Délai minimal entre deux diagnostics d'une même boutique.
 *
 * Trois jours, pour la même raison que les mesures : les indicateurs sont des
 * cumuls sur trente jours. Deux audits à un jour d'écart liraient les mêmes
 * chiffres, produiraient les mêmes conclusions, et coûteraient deux fois.
 */
export const MIN_DAYS_BETWEEN_AUDITS = 3;

/**
 * Délai avant de reproposer un diagnostic qu'on a déjà proposé.
 *
 * Une proposition ignorée n'est pas une proposition perdue : c'est un refus.
 * La répéter tous les jours transformerait l'outil en réclame.
 */
export const REAUDIT_PROMPT_COOLDOWN_DAYS = 7;

/**
 * Diagnostics ratés d'affilée au-delà desquels on cesse d'en relancer seul.
 *
 * LE DÉFAUT QUE CELA CORRIGE, avec `lastAttemptAt`. Un audit qui échoue ne
 * termine pas, donc ne devient jamais « le dernier diagnostic ». Les verdicts
 * qui l'avaient justifié restaient donc éternellement « nouveaux », et le délai
 * minimal, calculé sur le dernier audit TERMINÉ, ne s'appliquait pas davantage.
 * Chaque passage relançait un diagnostic et décomptait un quota, indéfiniment,
 * sur une boutique dont les audits ne pouvaient de toute façon pas aboutir.
 *
 * Deux échecs consécutifs suffisent à conclure que le problème ne vient pas du
 * hasard. Le marchand peut toujours relancer à la main : c'est lui qui décide
 * de dépenser, pas une boucle automatique.
 */
export const MAX_CONSECUTIVE_AUDIT_FAILURES = 2;

/** Ce qu'on sait d'une boutique au moment de décider. */
export type ReauditSignal = {
  storeId: string;
  /** Verdicts obtenus DEPUIS le dernier diagnostic. */
  verdictsSinceAudit: string[];
  /** Date du dernier diagnostic TERMINÉ, `null` si la boutique n'en a jamais eu. */
  lastAuditAt: string | null;
  /**
   * Date du dernier diagnostic CRÉÉ, quel qu'en soit le sort.
   *
   * Distincte de `lastAuditAt` : un audit qui échoue n'intègre aucun verdict,
   * mais il a bien coûté un appel et un quota. La cadence se règle donc sur les
   * tentatives, pas sur les succès — sinon une boutique dont les audits ratent
   * en redemande un à chaque passage.
   */
  lastAttemptAt?: string | null;
  /** Un diagnostic est-il déjà en cours ? */
  auditRunning: boolean;
  /** Diagnostics ratés d'affilée depuis le dernier terminé. */
  consecutiveFailures?: number;
  /** Audits restants ce mois-ci. `null` = illimité. */
  quotaRemaining: number | null;
  /** Dernière fois qu'un diagnostic a été proposé, pour ne pas insister. */
  promptedAt: string | null;
};

export const REAUDIT_ACTIONS = ["lancer", "proposer", "attendre"] as const;

export type ReauditAction = (typeof REAUDIT_ACTIONS)[number];

export type ReauditDecision = {
  action: ReauditAction;
  /** Pourquoi, en français, affichable tel quel. */
  reason: string;
  /** Ce que les mesures ont appris depuis le dernier diagnostic. */
  learned: { confirmed: number; ineffective: number; regressed: number };
};

function millis(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

/** La plus récente de deux dates, en ignorant celles qui sont illisibles. */
function mostRecent(a: string | null | undefined, b: string | null | undefined): string | null {
  const msA = millis(a);
  const msB = millis(b);
  if (msA === null) return msB === null ? null : (b as string);
  if (msB === null) return a as string;
  return msA >= msB ? (a as string) : (b as string);
}

function daysSince(value: string | null | undefined, now: Date): number | null {
  const time = millis(value);
  return time === null ? null : (now.getTime() - time) / 86_400_000;
}

/**
 * Faut-il relancer un diagnostic sur cette boutique ?
 *
 * L'ordre de lecture est celui du coût : on écarte d'abord tout ce qui rendrait
 * l'audit inutile ou impossible, et seulement ensuite on choisit entre le
 * lancer et le proposer.
 */
export function decideReaudit(signal: ReauditSignal, now: Date = new Date()): ReauditDecision {
  const settled = signal.verdictsSinceAudit.filter((v) => SETTLED_VERDICTS.has(v));
  const learned = {
    confirmed: settled.filter((v) => v === "confirme").length,
    ineffective: settled.filter((v) => v === "nul").length,
    regressed: settled.filter((v) => v === "regression").length,
  };

  const wait = (reason: string): ReauditDecision => ({ action: "attendre", reason, learned });

  // Un second diagnostic pendant qu'un premier tourne produirait deux rapports
  // concurrents sur les mêmes données, et consommerait deux quotas.
  if (signal.auditRunning) return wait("Un diagnostic est déjà en cours sur cette boutique.");

  // Rien de tranché depuis le dernier audit : la boutique n'a rien appris, un
  // nouveau diagnostic relirait les mêmes chiffres et dirait la même chose.
  if (settled.length === 0) {
    return wait(
      "Aucune correction n'a encore de résultat tranché depuis le dernier diagnostic : il n'y a rien de neuf à analyser.",
    );
  }

  // Des diagnostics qui échouent en série ne sont pas un signal à réessayer :
  // relancer coûte un quota à chaque fois et ne dit rien de plus.
  if ((signal.consecutiveFailures ?? 0) >= MAX_CONSECUTIVE_AUDIT_FAILURES) {
    return wait(
      `Les ${signal.consecutiveFailures} derniers diagnostics de cette boutique ont échoué. Nous n'en relançons pas un de plus automatiquement : relancez-le à la main quand vous le voulez, pour qu'un quota ne parte pas dans le vide.`,
    );
  }

  // La cadence porte sur la dernière TENTATIVE, réussie ou non. S'en tenir au
  // dernier audit terminé laissait une boutique dont les audits échouent en
  // relancer un à chaque passage, sans jamais atteindre le délai minimal.
  const lastTouch = mostRecent(signal.lastAuditAt, signal.lastAttemptAt);
  const sinceAudit = daysSince(lastTouch, now);
  if (sinceAudit !== null && sinceAudit < MIN_DAYS_BETWEEN_AUDITS) {
    const remaining = Math.ceil(MIN_DAYS_BETWEEN_AUDITS - sinceAudit);
    return wait(
      `Le dernier diagnostic date de moins de ${MIN_DAYS_BETWEEN_AUDITS} jours. Les indicateurs sont des cumuls : il faut encore ${remaining} jour${remaining > 1 ? "s" : ""} pour que la lecture change.`,
    );
  }

  const summary = describeLearning(learned);

  if (signal.quotaRemaining === 0) {
    return wait(
      `${summary} Un nouveau diagnostic est justifié, mais les diagnostics inclus dans votre plan sont tous utilisés ce mois-ci.`,
    );
  }

  // Quota illimité : lancer ne coûte rien au marchand, et attendre qu'il y
  // pense lui ferait perdre du temps sur une boutique qui a bougé.
  if (signal.quotaRemaining === null) {
    return {
      action: "lancer",
      reason: `${summary} La boutique n'est plus celle qui a été auditée : nous relançons le diagnostic.`,
      learned,
    };
  }

  // Quota compté : on ne dépense pas l'allocation de quelqu'un sans son accord.
  const sincePrompt = daysSince(signal.promptedAt, now);
  if (sincePrompt !== null && sincePrompt < REAUDIT_PROMPT_COOLDOWN_DAYS) {
    return wait(
      "Un nouveau diagnostic a déjà été proposé récemment. Une proposition ignorée est un refus : on n'insiste pas.",
    );
  }

  return {
    action: "proposer",
    reason: `${summary} Un nouveau diagnostic trouverait le prochain levier — il vous reste ${signal.quotaRemaining} audit${signal.quotaRemaining > 1 ? "s" : ""} ce mois-ci.`,
    learned,
  };
}

/** Ce que les mesures ont appris, en une phrase. */
export function describeLearning(learned: ReauditDecision["learned"]): string {
  const parts: string[] = [];
  if (learned.confirmed > 0) {
    parts.push(
      learned.confirmed === 1
        ? "une correction a prouvé son effet"
        : `${learned.confirmed} corrections ont prouvé leur effet`,
    );
  }
  if (learned.ineffective > 0) {
    parts.push(
      learned.ineffective === 1
        ? "une n'a rien changé"
        : `${learned.ineffective} n'ont rien changé`,
    );
  }
  if (learned.regressed > 0) {
    parts.push(
      learned.regressed === 1
        ? "une a fait reculer la boutique"
        : `${learned.regressed} ont fait reculer la boutique`,
    );
  }
  if (parts.length === 0) return "Depuis le dernier diagnostic, rien n'a été tranché.";

  const listed =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} et ${parts[parts.length - 1]}`;
  return `Depuis le dernier diagnostic, ${listed}.`;
}
