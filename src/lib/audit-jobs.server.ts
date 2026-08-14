import type { Db } from "@/lib/actions.server";
import type { AuditStore } from "@/lib/audit-runner.server";
import {
  auditStatusFor,
  claimedJob,
  completedJob,
  failedAttempt,
  isClaimable,
  readJob,
  withJob,
  type AuditJob,
} from "@/lib/audit-jobs";

/**
 * Transitions du travail d'audit, écrites en base.
 *
 * POURQUOI `updated_at` SERT DE JETON. Réclamer un audit doit être atomique,
 * sinon deux onglets ouverts sur la même page lanceraient deux analyses
 * simultanées — deux appels au modèle facturés pour un seul audit demandé, et
 * deux jeux de résultats concurrents écrits sur la même ligne.
 *
 * PostgREST ne sait ni verrouiller une ligne ni comparer un champ imbriqué
 * d'un `jsonb` de façon commode. La colonne `updated_at` existe déjà et change
 * à chaque écriture : elle fait donc un jeton de concurrence optimiste. On lit
 * sa valeur, puis on conditionne l'écriture à cette valeur. Si quelqu'un est
 * passé entre-temps, aucune ligne ne revient et la réclamation échoue — ce qui
 * est exactement le comportement voulu.
 *
 * Aucune migration : ni colonne, ni valeur d'enum, ni procédure ajoutée.
 */

type AuditRow = {
  id: string;
  store_id: string;
  status: string;
  updated_at: string;
  input_snapshot: unknown;
};

export type ClaimResult =
  | { claimed: true; job: AuditJob; store: AuditStore }
  | { claimed: false; job: AuditJob };

/** État du travail d'un audit. Un audit introuvable est traité comme échoué. */
export async function loadAuditJob(supabase: Db, auditId: string): Promise<AuditJob> {
  const { data } = await supabase
    .from("audits")
    .select("input_snapshot, status")
    .eq("id", auditId)
    .maybeSingle();

  if (!data) {
    return { state: "failed", attempts: 0, leaseUntil: null, lastError: "Audit introuvable." };
  }

  const job = readJob((data as { input_snapshot: unknown }).input_snapshot);

  // Un audit terminé avant l'existence de ce mécanisme n'a pas de bloc `job` :
  // sa colonne `status` fait alors foi, sans quoi il paraîtrait éternellement
  // en attente et serait relancé pour rien.
  const status = (data as { status: string }).status;
  if (job.state === "queued" && (status === "completed" || status === "failed")) {
    return { ...job, state: status as AuditJob["state"] };
  }
  return job;
}

/**
 * Tente de réclamer l'audit pour l'exécuter.
 *
 * Renvoie `claimed: false` sans rien modifier si le travail est déjà terminé,
 * déjà en cours sous un bail valide, ou a épuisé ses tentatives.
 */
export async function claimAudit(supabase: Db, auditId: string): Promise<ClaimResult> {
  const { data } = await supabase
    .from("audits")
    .select("id, store_id, status, updated_at, input_snapshot")
    .eq("id", auditId)
    .maybeSingle();

  if (!data) {
    return {
      claimed: false,
      job: { state: "failed", attempts: 0, leaseUntil: null, lastError: "Audit introuvable." },
    };
  }

  const row = data as AuditRow;
  const job = readJob(row.input_snapshot);

  const status = row.status;
  if (job.state === "queued" && (status === "completed" || status === "failed")) {
    return { claimed: false, job: { ...job, state: status as AuditJob["state"] } };
  }
  if (!isClaimable(job)) return { claimed: false, job };

  const next = claimedJob(job);

  const { data: locked } = await supabase
    .from("audits")
    .update({
      status: auditStatusFor(next),
      input_snapshot: withJob(row.input_snapshot, next),
      updated_at: new Date().toISOString(),
    })
    .eq("id", auditId)
    // Le jeton de concurrence : périmé, la mise à jour n'affecte aucune ligne.
    .eq("updated_at", row.updated_at)
    .select("id")
    .maybeSingle();

  if (!locked) {
    // Réclamé par quelqu'un d'autre entre notre lecture et notre écriture.
    return { claimed: false, job: await loadAuditJob(supabase, auditId) };
  }

  // La boutique est relue au moment de l'exécution, et non figée à la demande :
  // un audit repris doit travailler sur l'état courant de la boutique.
  const { data: store } = await supabase
    .from("stores")
    .select("*")
    .eq("id", row.store_id)
    .maybeSingle();

  if (!store) {
    await failAuditAttempt(supabase, auditId, "Boutique introuvable.");
    return { claimed: false, job: await loadAuditJob(supabase, auditId) };
  }

  return { claimed: true, job: next, store: store as AuditStore };
}

/**
 * Marque le travail terminé.
 *
 * `status` et `completed_at` sont déjà posés par le travail lui-même, qui écrit
 * les résultats : on ne touche qu'au bloc `job`, pour ne pas écraser un score
 * ou un verdict fraîchement calculés.
 */
export async function finishAudit(supabase: Db, auditId: string): Promise<void> {
  const { data } = await supabase
    .from("audits")
    .select("input_snapshot")
    .eq("id", auditId)
    .maybeSingle();
  const job = readJob((data as { input_snapshot: unknown } | null)?.input_snapshot);
  await supabase
    .from("audits")
    .update({
      input_snapshot: withJob(
        (data as { input_snapshot: unknown } | null)?.input_snapshot,
        completedJob(job),
      ),
      updated_at: new Date().toISOString(),
    })
    .eq("id", auditId);
}

/**
 * Enregistre l'échec d'une tentative.
 *
 * Tant qu'il reste des tentatives, l'audit retourne en file et reste `running`
 * pour l'interface : il va être repris, l'annoncer échoué serait faux. Une fois
 * les tentatives épuisées, il passe `failed` avec la dernière erreur.
 */
export async function failAuditAttempt(
  supabase: Db,
  auditId: string,
  message: string,
): Promise<void> {
  const { data } = await supabase
    .from("audits")
    .select("input_snapshot")
    .eq("id", auditId)
    .maybeSingle();

  const snapshot = (data as { input_snapshot: unknown } | null)?.input_snapshot;
  const next = failedAttempt(readJob(snapshot), message);

  await supabase
    .from("audits")
    .update({
      status: auditStatusFor(next),
      error_message: message,
      input_snapshot: withJob(snapshot, next),
      updated_at: new Date().toISOString(),
    })
    .eq("id", auditId);
}
