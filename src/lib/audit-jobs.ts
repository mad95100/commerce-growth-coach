/**
 * Cycle de vie d'un audit exécuté hors du temps de la requête.
 *
 * LE PROBLÈME. `runAudit` faisait tout dans une seule fonction serveur :
 * capture des données de trois plateformes, puis appel au modèle, puis
 * écriture. Sur une grosse boutique, cette chaîne dépasse le temps imparti à
 * une requête et l'audit meurt sans laisser de trace exploitable.
 *
 * LE DÉCOUPAGE. La demande d'audit crée la ligne et rend la main tout de
 * suite ; le travail long est exécuté par des invocations séparées, chacune
 * bornée dans le temps. Ce module décrit les règles de ce cycle de vie, sans
 * aucune entrée-sortie, pour qu'elles soient vérifiables isolément.
 *
 * POURQUOI L'ÉTAT VIT DANS `input_snapshot`. L'enum `audit_status` en base ne
 * connaît que `running`, `completed` et `failed` — il n'a pas de `queued`, et
 * l'étendre exigerait une migration. L'état fin du travail est donc porté par
 * la colonne `jsonb` `input_snapshot`, qui n'était jusqu'ici qu'écrite et
 * jamais relue. `audit_status` reste la projection grossière visible partout
 * ailleurs, inchangée : rien de ce qui existe ne casse.
 *
 * POURQUOI UN BAIL PLUTÔT QU'UN VERROU. Une exécution peut disparaître sans
 * rien signaler — conteneur recyclé, onglet fermé, réseau coupé. Un verrou
 * posé sans être rendu bloquerait l'audit pour toujours. Le bail expire seul,
 * ce qui rend la reprise automatique et ne demande aucune intervention.
 */

/** États du travail, plus fins que ceux de l'enum `audit_status`. */
export type JobState = "queued" | "running" | "completed" | "failed";

/** Durée d'un bail d'exécution. Au-delà, l'audit est réputé abandonné et reprenable. */
export const LEASE_MS = 5 * 60_000;

/**
 * Nombre maximal de tentatives.
 *
 * Une panne réseau passagère mérite d'être retentée ; une boutique dont les
 * données font systématiquement échouer le modèle ne doit pas boucler
 * indéfiniment en consommant des appels facturés.
 */
export const MAX_ATTEMPTS = 3;

export type AuditJob = {
  state: JobState;
  /** Tentatives déjà engagées, réclamation comprise. */
  attempts: number;
  /** Instant au-delà duquel l'exécution en cours est réputée perdue. */
  leaseUntil: string | null;
  /** Dernière erreur rencontrée, conservée entre deux tentatives. */
  lastError: string | null;
};

export const INITIAL_JOB: AuditJob = {
  state: "queued",
  attempts: 0,
  leaseUntil: null,
  lastError: null,
};

function asState(value: unknown): JobState | null {
  return value === "queued" || value === "running" || value === "completed" || value === "failed"
    ? value
    : null;
}

/**
 * Lit l'état du travail dans `input_snapshot`.
 *
 * Tolérant : les audits créés avant ce mécanisme n'ont pas de bloc `job`, et
 * une valeur illisible ne doit pas rendre un audit impossible à reprendre. Dans
 * les deux cas on repart de l'état initial.
 */
export function readJob(inputSnapshot: unknown): AuditJob {
  if (!inputSnapshot || typeof inputSnapshot !== "object") return { ...INITIAL_JOB };
  const raw = (inputSnapshot as Record<string, unknown>).job;
  if (!raw || typeof raw !== "object") return { ...INITIAL_JOB };

  const job = raw as Record<string, unknown>;
  const attempts = typeof job.attempts === "number" && job.attempts >= 0 ? job.attempts : 0;
  return {
    state: asState(job.state) ?? "queued",
    attempts,
    leaseUntil: typeof job.leaseUntil === "string" ? job.leaseUntil : null,
    lastError: typeof job.lastError === "string" ? job.lastError : null,
  };
}

/** Écrit le bloc `job` dans `input_snapshot` sans toucher au reste. */
export function withJob(inputSnapshot: unknown, job: AuditJob): Record<string, unknown> {
  const base =
    inputSnapshot && typeof inputSnapshot === "object" && !Array.isArray(inputSnapshot)
      ? (inputSnapshot as Record<string, unknown>)
      : {};
  return { ...base, job };
}

/** `true` si le travail est arrivé à son terme, dans un sens ou dans l'autre. */
export function isTerminal(job: AuditJob): boolean {
  return job.state === "completed" || job.state === "failed";
}

/** `true` si le bail de l'exécution en cours a expiré. */
export function isLeaseExpired(job: AuditJob, now: Date = new Date()): boolean {
  if (!job.leaseUntil) return true;
  const until = Date.parse(job.leaseUntil);
  // Un bail illisible vaut expiré : mieux vaut reprendre un audit deux fois que
  // le laisser bloqué pour toujours sur une valeur corrompue.
  if (Number.isNaN(until)) return true;
  return until <= now.getTime();
}

/**
 * `true` si le travail peut être réclamé maintenant.
 *
 * C'est la règle qui empêche la double exécution : un audit déjà en cours dont
 * le bail court n'est réclamable par personne.
 */
export function isClaimable(job: AuditJob, now: Date = new Date()): boolean {
  if (isTerminal(job)) return false;
  if (job.attempts >= MAX_ATTEMPTS) return false;
  if (job.state === "queued") return true;
  return isLeaseExpired(job, now);
}

/** État après réclamation : une tentative de plus, un bail neuf. */
export function claimedJob(job: AuditJob, now: Date = new Date()): AuditJob {
  return {
    state: "running",
    attempts: job.attempts + 1,
    leaseUntil: new Date(now.getTime() + LEASE_MS).toISOString(),
    lastError: job.lastError,
  };
}

/** État après succès. */
export function completedJob(job: AuditJob): AuditJob {
  return { state: "completed", attempts: job.attempts, leaseUntil: null, lastError: null };
}

/**
 * État après échec d'une tentative.
 *
 * Tant qu'il reste des tentatives, le travail retourne en file et pourra être
 * repris ; au-delà, il est déclaré en échec et la dernière erreur est conservée
 * pour être montrée à l'utilisateur.
 */
export function failedAttempt(job: AuditJob, message: string): AuditJob {
  const exhausted = job.attempts >= MAX_ATTEMPTS;
  return {
    state: exhausted ? "failed" : "queued",
    attempts: job.attempts,
    leaseUntil: null,
    lastError: message,
  };
}

/**
 * Statut à écrire dans la colonne `status`, dont l'enum ignore « en file ».
 *
 * Un travail en attente ou en cours reste `running` : c'est déjà ce que
 * l'interface affiche, et le sens n'en est pas trahi — l'audit est bien en
 * train de se faire.
 */
export function auditStatusFor(job: AuditJob): "running" | "completed" | "failed" {
  if (job.state === "completed") return "completed";
  if (job.state === "failed") return "failed";
  return "running";
}

/** Phrase courte décrivant l'état, pour l'interface. */
export function describeJob(job: AuditJob): string {
  switch (job.state) {
    case "queued":
      return job.attempts > 0
        ? `Reprise en attente (tentative ${job.attempts + 1} sur ${MAX_ATTEMPTS})…`
        : "En file d'attente…";
    case "running":
      return job.attempts > 1
        ? `Analyse en cours (tentative ${job.attempts} sur ${MAX_ATTEMPTS})…`
        : "Analyse en cours…";
    case "completed":
      return "Audit terminé.";
    case "failed":
      return job.lastError ?? "Audit échoué.";
  }
}
