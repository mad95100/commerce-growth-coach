import { lookbackFloor, selectTickCandidates, type PendingAudit } from "@/lib/jobs-tick";

/**
 * Fait avancer les audits en attente, sans navigateur.
 *
 * LE PROBLÈME QUE CELA RÈGLE. Le moteur d'audit savait déjà reprendre un
 * travail interrompu — réclamation atomique, bail de cinq minutes, trois
 * tentatives — mais **rien ne déclenchait la reprise** : c'était le navigateur
 * de l'utilisateur qui rappelait `processAudit`. Onglet fermé, connexion
 * coupée, portable en veille : l'audit restait en attente indéfiniment. Le
 * mécanisme de reprise existait, il lui manquait une horloge.
 *
 * Ce module est cette horloge. Il est appelé par deux déclencheurs — le cron
 * Cloudflare (`src/nitro/scheduled.ts`) et une route HTTP protégée
 * (`src/routes/api/internal/jobs/tick.ts`) — et ne suppose rien de l'hébergeur.
 *
 * CE QU'IL NE FAIT PAS. Il ne crée aucun audit et ne décompte aucun quota : les
 * deux se font à la demande, dans `runAudit`. Un audit repris a donc déjà été
 * payé par son quota, et le reprendre ne peut pas en consommer un second.
 *
 * DOUBLE EXÉCUTION. Elle est impossible, mais pas grâce à ce module : la
 * réclamation est conditionnée à la valeur de `updated_at` lue juste avant. Si
 * un onglet encore ouvert a pris l'audit entre-temps, la réclamation n'affecte
 * aucune ligne et le passage s'abstient.
 */

export { MAX_AUDITS_PER_TICK } from "@/lib/jobs-tick";

export type TickResult = {
  /** Audits retenus par la règle de sélection. */
  inspected: number;
  /** Audits effectivement réclamés et exécutés. */
  processed: number;
  /** Audits terminés avec succès pendant ce passage. */
  completed: number;
  /** Audits dont la tentative a échoué. Ils seront repris, ou déclarés en échec. */
  failed: number;
  /** Identifiants traités, pour les journaux. */
  auditIds: string[];
};

/**
 * Un passage complet.
 *
 * Ne lève jamais : un audit qui échoue ne doit pas empêcher les suivants
 * d'avancer, et une invocation planifiée qui se termine par une exception ne
 * laisse aucune trace exploitable.
 */
export async function runJobsTick(now: Date = new Date()): Promise<TickResult> {
  const result: TickResult = {
    inspected: 0,
    processed: 0,
    completed: 0,
    failed: 0,
    auditIds: [],
  };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { claimAudit, finishAudit, failAuditAttempt } = await import("@/lib/audit-jobs.server");
  const { executeAuditWork } = await import("@/lib/audit-runner.server");

  // `running` couvre aussi les audits en file : l'enum `audit_status` n'a pas de
  // valeur `queued`, l'état fin vit dans `input_snapshot`.
  const { data, error } = await supabaseAdmin
    .from("audits")
    .select("id, created_by, input_snapshot")
    .eq("status", "running")
    .gte("created_at", lookbackFloor(now))
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) {
    console.error("[jobs] lecture des audits en attente impossible :", error);
    return result;
  }

  const candidates = selectTickCandidates((data ?? []) as PendingAudit[], now);
  result.inspected = candidates.length;

  for (const row of candidates) {
    const claim = await claimAudit(supabaseAdmin, row.id);
    if (!claim.claimed) continue;

    result.processed += 1;
    result.auditIds.push(row.id);

    try {
      await executeAuditWork({
        supabase: supabaseAdmin,
        // `selectTickCandidates` a déjà écarté les lignes sans demandeur.
        userId: row.created_by as string,
        store: claim.store,
        auditId: row.id,
      });
      await finishAudit(supabaseAdmin, row.id);
      result.completed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[jobs] audit ${row.id} en échec :`, message);
      await failAuditAttempt(supabaseAdmin, row.id, message);
      result.failed += 1;
    }
  }

  return result;
}
