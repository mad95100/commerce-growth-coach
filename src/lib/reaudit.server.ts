import { decideReaudit, describeLearning, type ReauditSignal } from "@/lib/reaudit";

/**
 * Relance — ou propose — un diagnostic quand les mesures l'ont justifié.
 *
 * LE BOUCLAGE. `measure-tick` mesure, `attempt-history` retient, et ce module
 * ferme le cycle : quand des corrections viennent d'obtenir un verdict
 * définitif, la boutique n'est plus celle qui a été auditée. Certaines
 * hypothèses du diagnostic précédent ont été testées et sont tombées. C'est
 * exactement le moment de rediagnostiquer — et ce moment est un fait mesurable,
 * pas une intuition qu'on laisse au marchand.
 *
 * CE QU'IL NE FAIT PAS. Il ne dépense jamais un quota compté sans accord : sur
 * un plan limité, il propose et attend. Il ne crée jamais deux diagnostics
 * concurrents. Il ne relance rien avant trois jours — les indicateurs sont des
 * cumuls sur trente jours, deux audits rapprochés liraient les mêmes chiffres.
 */

export type ReauditTickResult = {
  /** Boutiques examinées. */
  inspected: number;
  /** Diagnostics réellement lancés. */
  launched: number;
  /** Diagnostics proposés au marchand. */
  proposed: number;
  /** Boutiques laissées tranquilles. */
  skipped: number;
};

/** Boutiques examinées par passage. Chaque lancement coûte un appel au modèle. */
export const MAX_STORES_PER_REAUDIT_TICK = 3;

/**
 * Un passage complet. Ne lève jamais.
 *
 * Une boutique qui échoue n'empêche pas les suivantes : c'est le même principe
 * que pour les audits et les mesures, et pour la même raison — une invocation
 * planifiée qui se termine par une exception ne laisse aucune trace exploitable.
 */
export async function runReauditTick(now: Date = new Date()): Promise<ReauditTickResult> {
  const result: ReauditTickResult = { inspected: 0, launched: 0, proposed: 0, skipped: 0 };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Les boutiques dont une correction a été tranchée récemment. C'est le seul
  // déclencheur : sans verdict nouveau, un diagnostic relirait les mêmes
  // chiffres et rendrait les mêmes conclusions.
  const { data: settled, error } = await supabaseAdmin
    .from("fix_attempts")
    .select("store_id, verdict, measured_at")
    .in("verdict", ["confirme", "nul", "regression"])
    .not("measured_at", "is", null)
    .order("measured_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[réanalyse] lecture de la mémoire impossible :", error);
    return result;
  }

  type SettledRow = { store_id: string; verdict: string; measured_at: string };
  const byStore = new Map<string, SettledRow[]>();
  for (const row of (settled ?? []) as SettledRow[]) {
    if (!row.store_id) continue;
    const list = byStore.get(row.store_id) ?? [];
    list.push(row);
    byStore.set(row.store_id, list);
  }

  for (const [storeId, rows] of [...byStore.entries()].slice(0, MAX_STORES_PER_REAUDIT_TICK)) {
    result.inspected += 1;
    try {
      const handled = await considerStore(supabaseAdmin, storeId, rows, now);
      if (handled === "lancer") result.launched += 1;
      else if (handled === "proposer") result.proposed += 1;
      else result.skipped += 1;
    } catch (err) {
      console.error(
        `[réanalyse] boutique ${storeId} ignorée :`,
        err instanceof Error ? err.message : String(err),
      );
      result.skipped += 1;
    }
  }

  return result;
}

async function considerStore(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  storeId: string,
  settled: Array<{ verdict: string; measured_at: string }>,
  now: Date,
): Promise<"lancer" | "proposer" | "attendre"> {
  const { data: store } = await admin
    .from("stores")
    .select("id, name, owner_id, reaudit_prompted_at")
    .eq("id", storeId)
    .maybeSingle();
  // Sans propriétaire, il n'y a ni quota à consulter, ni personne à prévenir.
  if (!store?.owner_id) return "attendre";

  const { data: audits } = await admin
    .from("audits")
    .select("id, status, created_at")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(5);

  type AuditRow = { id: string; status: string; created_at: string };
  const recent = (audits ?? []) as AuditRow[];
  const lastCompleted = recent.find((a) => a.status === "completed") ?? null;

  // Seuls comptent les verdicts obtenus APRÈS le dernier diagnostic : ceux
  // d'avant y sont déjà intégrés.
  const floor = lastCompleted ? new Date(lastCompleted.created_at).getTime() : 0;
  const verdictsSinceAudit = settled
    .filter((row) => new Date(row.measured_at).getTime() > floor)
    .map((row) => row.verdict);

  const { loadEntitlements } = await import("@/lib/billing.server");
  const entitlements = await loadEntitlements(admin, store.owner_id);

  const signal: ReauditSignal = {
    storeId,
    verdictsSinceAudit,
    lastAuditAt: lastCompleted?.created_at ?? null,
    auditRunning: recent.some((a) => a.status === "running"),
    quotaRemaining: entitlements.remaining.audits,
    promptedAt: store.reaudit_prompted_at ?? null,
  };

  const decision = decideReaudit(signal, now);
  if (decision.action === "attendre") return "attendre";

  if (decision.action === "lancer") {
    await launchAudit(admin, store, decision.reason);
    return "lancer";
  }

  await proposeAudit(admin, store, decision, now);
  return "proposer";
}

/**
 * Crée le diagnostic, quota décompté d'abord.
 *
 * Même ordre que le chemin manuel (`runAudit`) et pour la même raison : un
 * audit refusé ne doit laisser ni ligne en base, ni facture chez le
 * fournisseur de modèles. Le passage périodique des audits le prendra en
 * charge à la minute suivante.
 */
async function launchAudit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  store: { id: string; name: string; owner_id: string },
  reason: string,
): Promise<void> {
  const { consumeQuota } = await import("@/lib/billing.server");
  await consumeQuota(admin, store.owner_id, "audits");

  const { INITIAL_JOB } = await import("@/lib/audit-jobs");
  const { data: full } = await admin
    .from("stores")
    .select("name, url, niche, monthly_revenue, monthly_ad_budget, goal")
    .eq("id", store.id)
    .maybeSingle();

  const { data: audit, error } = await admin
    .from("audits")
    .insert({
      store_id: store.id,
      created_by: store.owner_id,
      status: "running",
      audit_type: "weekly",
      input_snapshot: { ...(full ?? {}), job: INITIAL_JOB },
    })
    .select("id")
    .single();

  if (error || !audit) {
    // Le quota a été décompté pour un audit qui n'existera pas : on le rend.
    const { refundQuota } = await import("@/lib/billing.server");
    await refundQuota(admin, store.owner_id, "audits");
    throw error ?? new Error("Diagnostic non créé");
  }

  await admin.from("notifications").insert({
    user_id: store.owner_id,
    store_id: store.id,
    kind: "insight",
    severity: "medium",
    title: `Nouveau diagnostic lancé sur ${store.name}`,
    body: reason,
    action_label: "Voir le diagnostic",
    action_href: `/audits/${audit.id}`,
  });
}

/**
 * Propose le diagnostic sans le lancer.
 *
 * La date de proposition est écrite AVANT la notification : si l'écriture de la
 * notification échoue, le marchand n'est pas prévenu — mais on ne repartira pas
 * en boucle à la minute suivante, ce qui serait bien pire.
 */
async function proposeAudit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  store: { id: string; name: string; owner_id: string },
  decision: {
    reason: string;
    learned: { confirmed: number; ineffective: number; regressed: number };
  },
  now: Date,
): Promise<void> {
  await admin.from("stores").update({ reaudit_prompted_at: now.toISOString() }).eq("id", store.id);

  await admin.from("notifications").insert({
    user_id: store.owner_id,
    store_id: store.id,
    kind: "insight",
    severity: "medium",
    title: `${store.name} a bougé : un nouveau diagnostic est justifié`,
    body: `${describeLearning(decision.learned)} ${decision.reason}`,
    action_label: "Lancer le diagnostic",
    action_href: `/stores/${store.id}`,
  });
}
