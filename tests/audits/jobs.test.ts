/**
 * Contrôles du moteur d'audit asynchrone.
 *
 * Les règles de cycle de vie sont pures et exercées directement. Les
 * transitions en base le sont contre un FAUX PostgREST écrit ici, qui reproduit
 * la seule propriété dont dépend la sûreté : une écriture conditionnée à une
 * valeur périmée n'affecte aucune ligne.
 *
 * Script hors dépôt, non commité.
 */
import {
  INITIAL_JOB,
  LEASE_MS,
  MAX_ATTEMPTS,
  auditStatusFor,
  claimedJob,
  completedJob,
  describeJob,
  failedAttempt,
  isClaimable,
  isLeaseExpired,
  isTerminal,
  readJob,
  withJob,
  type AuditJob,
} from "../../src/lib/audit-jobs";
import {
  claimAudit,
  failAuditAttempt,
  finishAudit,
  loadAuditJob,
} from "../../src/lib/audit-jobs.server";
import { defineSuite } from "../../tests/harness";

export default defineSuite("Audits — exécution asynchrone et reprise", async (t) => {
  const NOW = new Date("2026-08-14T12:00:00Z");
  const future = new Date(NOW.getTime() + 60_000).toISOString();
  const past = new Date(NOW.getTime() - 60_000).toISOString();

  function job(over: Partial<AuditJob> = {}): AuditJob {
    return { ...INITIAL_JOB, ...over };
  }

  // ---------------------------------------------------------------------------
  // 1. Lecture tolérante
  // ---------------------------------------------------------------------------
  t.check("instantané absent => état initial", readJob(null), INITIAL_JOB);
  t.check("instantané sans job => état initial", readJob({ name: "x" }), INITIAL_JOB);
  t.check("job illisible => état initial", readJob({ job: "oui" }), INITIAL_JOB);
  t.check("état inconnu => en file", readJob({ job: { state: "zzz" } }).state, "queued");
  t.check("tentatives négatives ignorées", readJob({ job: { attempts: -3 } }).attempts, 0);
  t.check(
    "job complet relu tel quel",
    readJob({ job: { state: "running", attempts: 2, leaseUntil: future, lastError: "boum" } }),
    { state: "running", attempts: 2, leaseUntil: future, lastError: "boum" },
  );
  t.check(
    "withJob préserve le reste de l'instantané",
    withJob({ name: "Boutique", url: "u" }, job({ attempts: 1 })),
    { name: "Boutique", url: "u", job: job({ attempts: 1 }) },
  );
  t.check("withJob sur valeur non-objet", withJob(null, INITIAL_JOB), { job: INITIAL_JOB });

  // ---------------------------------------------------------------------------
  // 2. Bail
  // ---------------------------------------------------------------------------
  t.check("bail absent => expiré", isLeaseExpired(job({ leaseUntil: null }), NOW), true);
  t.check(
    "bail illisible => expiré",
    isLeaseExpired(job({ leaseUntil: "n'importe quoi" }), NOW),
    true,
  );
  t.check("bail futur => valide", isLeaseExpired(job({ leaseUntil: future }), NOW), false);
  t.check("bail passé => expiré", isLeaseExpired(job({ leaseUntil: past }), NOW), true);
  t.check(
    "bail expirant à l'instant même => expiré",
    isLeaseExpired(job({ leaseUntil: NOW.toISOString() }), NOW),
    true,
  );

  // ---------------------------------------------------------------------------
  // 3. Réclamation : LA règle anti-double-exécution
  // ---------------------------------------------------------------------------
  t.check("en file => réclamable", isClaimable(job({ state: "queued" }), NOW), true);
  t.check(
    "EN COURS sous bail valide => NON réclamable",
    isClaimable(job({ state: "running", attempts: 1, leaseUntil: future }), NOW),
    false,
  );
  t.check(
    "en cours dont le bail a expiré => réclamable (reprise)",
    isClaimable(job({ state: "running", attempts: 1, leaseUntil: past }), NOW),
    true,
  );
  t.check("terminé => non réclamable", isClaimable(job({ state: "completed" }), NOW), false);
  t.check("échoué => non réclamable", isClaimable(job({ state: "failed" }), NOW), false);
  t.check(
    "tentatives épuisées => non réclamable",
    isClaimable(job({ state: "queued", attempts: MAX_ATTEMPTS }), NOW),
    false,
  );
  t.check(
    "dernière tentative encore permise",
    isClaimable(job({ state: "queued", attempts: MAX_ATTEMPTS - 1 }), NOW),
    true,
  );

  const claimed = claimedJob(job({ attempts: 1, lastError: "précédente" }), NOW);
  t.check("réclamation => en cours", claimed.state, "running");
  t.check("réclamation => une tentative de plus", claimed.attempts, 2);
  t.check(
    "réclamation => bail posé à la bonne durée",
    claimed.leaseUntil,
    new Date(NOW.getTime() + LEASE_MS).toISOString(),
  );
  t.check("réclamation conserve l'erreur précédente", claimed.lastError, "précédente");

  // ---------------------------------------------------------------------------
  // 4. Fin de tentative
  // ---------------------------------------------------------------------------
  t.check("succès => terminé", completedJob(job({ attempts: 2 })).state, "completed");
  t.check("succès efface l'erreur", completedJob(job({ lastError: "x" })).lastError, null);
  t.check("succès libère le bail", completedJob(job({ leaseUntil: future })).leaseUntil, null);

  const retryable = failedAttempt(job({ state: "running", attempts: 1 }), "réseau");
  t.check("échec avec tentatives restantes => retour en file", retryable.state, "queued");
  t.check("échec conserve le compteur de tentatives", retryable.attempts, 1);
  t.check("échec libère le bail pour permettre la reprise", retryable.leaseUntil, null);
  t.check("échec retient l'erreur", retryable.lastError, "réseau");

  const exhausted = failedAttempt(job({ state: "running", attempts: MAX_ATTEMPTS }), "définitif");
  t.check("tentatives épuisées => échec définitif", exhausted.state, "failed");
  t.check("échec définitif retient la dernière erreur", exhausted.lastError, "définitif");

  t.check("terminé est terminal", isTerminal(job({ state: "completed" })), true);
  t.check("échoué est terminal", isTerminal(job({ state: "failed" })), true);
  t.check("en file n'est pas terminal", isTerminal(job({ state: "queued" })), false);
  t.check("en cours n'est pas terminal", isTerminal(job({ state: "running" })), false);

  // ---------------------------------------------------------------------------
  // 5. Projection vers l'enum existant, qui ignore « en file »
  // ---------------------------------------------------------------------------
  t.check("en file => running", auditStatusFor(job({ state: "queued" })), "running");
  t.check("en cours => running", auditStatusFor(job({ state: "running" })), "running");
  t.check("terminé => completed", auditStatusFor(job({ state: "completed" })), "completed");
  t.check("échoué => failed", auditStatusFor(job({ state: "failed" })), "failed");

  t.check(
    "libellé mentionne la reprise",
    describeJob(job({ state: "queued", attempts: 1 })).includes("2"),
    true,
  );
  t.check(
    "libellé d'échec reprend l'erreur",
    describeJob(job({ state: "failed", lastError: "boum" })),
    "boum",
  );

  // ---------------------------------------------------------------------------
  // 6. Transitions en base, contre un faux PostgREST
  // ---------------------------------------------------------------------------
  type Row = Record<string, any>;

  function fakeDb(audit: Row | null, store: Row | null = { id: "s1", name: "Boutique" }) {
    const state: { audit: Row | null; store: Row | null; updates: number } = {
      audit: audit ? { ...audit } : null,
      store,
      updates: 0,
    };

    function builder(table: string) {
      const filters: Array<[string, any]> = [];
      let mode: "select" | "update" = "select";
      let patch: Row = {};

      const api: any = {
        select: () => api,
        eq: (c: string, v: any) => (filters.push([c, v]), api),
        order: () => api,
        limit: () => api,
        update: (p: Row) => ((mode = "update"), (patch = p), api),
        then: (res: any, rej: any) => api.maybeSingle().then(res, rej),
        maybeSingle: async () => {
          const current = table === "audits" ? state.audit : state.store;
          if (mode === "select") return { data: current, error: null };
          if (!current) return { data: null, error: null };
          // Le filtre sur `updated_at` est le jeton de concurrence.
          if (!filters.every(([c, v]) => current[c] === v)) return { data: null, error: null };
          const next = { ...current, ...patch };
          if (table === "audits") {
            state.audit = next;
            state.updates++;
          }
          return { data: next, error: null };
        },
        single: async () => api.maybeSingle(),
      };
      return api;
    }

    return { from: (t: string) => builder(t), _state: state } as any;
  }

  function auditRow(over: Row = {}): Row {
    return {
      id: "a1",
      store_id: "s1",
      status: "running",
      updated_at: "2026-08-14T11:00:00.000Z",
      input_snapshot: { name: "Boutique", job: INITIAL_JOB },
      ...over,
    };
  }

  {
    // --- 6a. Réclamation nominale ---
    let db = fakeDb(auditRow());
    let r = await claimAudit(db, "a1");
    t.check("audit en file : réclamé", r.claimed, true);
    t.check("tentative enregistrée", readJob(db._state.audit.input_snapshot).attempts, 1);
    t.check("statut reste running", db._state.audit.status, "running");
    t.check("boutique relue au moment de l'exécution", r.claimed && r.store.name, "Boutique");

    // --- 6b. LE POINT DÉCISIF : deux réclamations concurrentes ---
    // Les deux lisent le même `updated_at` ; une seule doit réussir.
    db = fakeDb(auditRow());
    const [a, b] = await Promise.all([claimAudit(db, "a1"), claimAudit(db, "a1")]);
    t.check(
      "deux réclamations simultanées : une seule aboutit",
      [a.claimed, b.claimed].filter(Boolean).length,
      1,
    );
    t.check("une seule tentative comptée", readJob(db._state.audit.input_snapshot).attempts, 1);

    // --- 6c. Un audit déjà en cours sous bail valide n'est pas repris ---
    db = fakeDb(
      auditRow({
        input_snapshot: {
          job: { state: "running", attempts: 1, leaseUntil: futureFromNow(), lastError: null },
        },
      }),
    );
    r = await claimAudit(db, "a1");
    t.check("bail valide : non réclamé", r.claimed, false);
    t.check("bail valide : aucune écriture", db._state.updates, 0);

    // --- 6d. Reprise après bail expiré ---
    db = fakeDb(
      auditRow({
        input_snapshot: {
          job: {
            state: "running",
            attempts: 1,
            leaseUntil: "2020-01-01T00:00:00Z",
            lastError: null,
          },
        },
      }),
    );
    r = await claimAudit(db, "a1");
    t.check("bail expiré : repris", r.claimed, true);
    t.check("reprise : deuxième tentative", readJob(db._state.audit.input_snapshot).attempts, 2);

    // --- 6e. Audit terminé : jamais relancé ---
    db = fakeDb(
      auditRow({
        status: "completed",
        input_snapshot: { job: { state: "completed", attempts: 1 } },
      }),
    );
    r = await claimAudit(db, "a1");
    t.check("audit terminé : non réclamé", r.claimed, false);
    t.check("audit terminé : aucune écriture", db._state.updates, 0);

    // --- 6f. Audit d'avant ce mécanisme, déjà terminé : pas de bloc job ---
    db = fakeDb(auditRow({ status: "completed", input_snapshot: { name: "Boutique" } }));
    r = await claimAudit(db, "a1");
    t.check("audit hérité terminé : non relancé", r.claimed, false);
    t.check(
      "audit hérité : état lu depuis la colonne status",
      (await loadAuditJob(db, "a1")).state,
      "completed",
    );

    // --- 6g. Échec avec reprise possible ---
    db = fakeDb(
      auditRow({
        input_snapshot: { job: { state: "running", attempts: 1, leaseUntil: futureFromNow() } },
      }),
    );
    await failAuditAttempt(db, "a1", "réseau coupé");
    t.check("échec récupérable : statut reste running", db._state.audit.status, "running");
    t.check(
      "échec récupérable : retour en file",
      readJob(db._state.audit.input_snapshot).state,
      "queued",
    );
    t.check("échec récupérable : erreur conservée", db._state.audit.error_message, "réseau coupé");

    // --- 6h. Échec définitif ---
    db = fakeDb(
      auditRow({
        input_snapshot: {
          job: { state: "running", attempts: MAX_ATTEMPTS, leaseUntil: futureFromNow() },
        },
      }),
    );
    await failAuditAttempt(db, "a1", "définitif");
    t.check("tentatives épuisées : statut failed", db._state.audit.status, "failed");
    t.check(
      "tentatives épuisées : job failed",
      readJob(db._state.audit.input_snapshot).state,
      "failed",
    );

    // --- 6i. Succès : le job passe terminé sans écraser les résultats ---
    db = fakeDb(
      auditRow({
        status: "completed",
        score: 72,
        input_snapshot: {
          name: "Boutique",
          job: { state: "running", attempts: 1, leaseUntil: futureFromNow() },
        },
      }),
    );
    await finishAudit(db, "a1");
    t.check("succès : job terminé", readJob(db._state.audit.input_snapshot).state, "completed");
    t.check("succès : score préservé", db._state.audit.score, 72);
    t.check(
      "succès : reste de l'instantané préservé",
      db._state.audit.input_snapshot.name,
      "Boutique",
    );

    // --- 6j. Audit introuvable ---
    db = fakeDb(null);
    r = await claimAudit(db, "a1");
    t.check("audit introuvable : non réclamé", r.claimed, false);
    t.check("audit introuvable : signalé échoué", r.job.state, "failed");

    // --- 6k. Boutique supprimée entre-temps ---
    db = fakeDb(auditRow(), null);
    r = await claimAudit(db, "a1");
    t.check("boutique disparue : non réclamé", r.claimed, false);
    t.check(
      "boutique disparue : erreur enregistrée",
      db._state.audit.error_message,
      "Boutique introuvable.",
    );
  }

  function futureFromNow() {
    return new Date(Date.now() + LEASE_MS).toISOString();
  }
});
