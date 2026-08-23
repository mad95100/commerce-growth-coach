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
  DUREE_ANNONCEE_MS,
  decrireAttente,
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
import { readFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (relative: string) => readFileSync(`${ROOT}${relative}`, "utf8");

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

  // =========================================================================
  // 7. CE QUE L'ÉCRAN DIT PENDANT L'ATTENTE
  // =========================================================================
  /*
    LE DÉFAUT, RELEVÉ SUR UN AUDIT RÉEL. Trois minutes de « Analyse en cours… »
    sur un écran qui annonce trente à quatre-vingt-dix secondes.

    « Ça prend 30 à 90 secondes » n'était que le REPLI affiché tant que l'état
    du travail n'était pas chargé — c'est-à-dire pendant trois secondes. Ensuite
    venait « Analyse en cours… », qui ne change plus JAMAIS : la même phrase à la
    dixième seconde et à la dixième minute. Rien ne distinguait une analyse qui
    avance d'une tentative morte dont le bail n'a pas encore expiré.

    La durée écoulée ne répare pas la lenteur. Elle rend à l'attente sa vérité,
    et c'est la seule chose que le marchand peut vérifier lui-même.
  */
  const T0 = new Date("2026-08-23T10:00:00.000Z");
  const apres = (ms: number) => new Date(T0.getTime() + ms);

  t.check(
    "sous la minute, on ne prétend pas compter les minutes",
    decrireAttente(T0.toISOString(), apres(20_000))?.depuis,
    "il y a moins d'une minute",
  );
  t.check(
    "une minute se dit au singulier",
    decrireAttente(T0.toISOString(), apres(70_000))?.depuis,
    "il y a 1 minute",
  );
  t.check(
    "et trois minutes se disent telles quelles",
    decrireAttente(T0.toISOString(), apres(3 * 60_000))?.depuis,
    "il y a 3 minutes",
  );

  // LE SEUIL EST CELUI QUI A ÉTÉ ANNONCÉ. Le dépasser n'est pas un détail de
  // style : c'est le moment où la promesse faite au marchand cesse d'être tenue,
  // et où l'écran doit le lui dire au lieu de répéter que tout va bien.
  t.check(
    "dans la durée annoncée, rien d'anormal",
    decrireAttente(T0.toISOString(), apres(DUREE_ANNONCEE_MS - 1))?.auDela,
    false,
  );
  t.check(
    "au-delà, l'écran doit le dire",
    decrireAttente(T0.toISOString(), apres(DUREE_ANNONCEE_MS + 1))?.auDela,
    true,
  );
  t.check(
    "trois minutes sont bien au-delà",
    decrireAttente(T0.toISOString(), apres(3 * 60_000))?.auDela,
    true,
  );

  // UNE HORLOGE CLIENT EN AVANCE NE PRODUIT PAS « IL Y A -2 MINUTES ».
  t.check(
    "un écart négatif est ramené à zéro",
    decrireAttente(T0.toISOString(), apres(-120_000))?.depuis,
    "il y a moins d'une minute",
  );

  // MIEUX VAUT NE RIEN DIRE DE LA DURÉE QUE D'ANNONCER « IL Y A NAN MINUTES ».
  t.check("sans date de départ, rien n'est affirmé", decrireAttente(null), null);
  t.check("une date illisible non plus", decrireAttente("pas une date"), null);

  // =========================================================================
  // 8. « TERMINÉ » DOIT VOULOIR DIRE « TOUT EST LISIBLE »
  // =========================================================================
  /*
    LA CAUSE RACINE DU DERNIER PARCOURS RÉEL, ET ELLE TENAIT À UN ORDRE.

    `status: "completed"` était écrit AVANT l'insertion des constats. Deux
    conséquences, et la seconde est de loin la plus grave.

    D'abord une course : l'écran interroge le statut toutes les trois secondes
    et lit les constats par une autre requête. Entre les deux écritures, il
    pouvait voir un audit « terminé » et une liste VIDE — un rapport sans un
    seul constat sur un audit que le serveur venait de réussir.

    Ensuite : si l'insertion échouait, l'audit restait `completed`. Un rapport
    définitivement vide, présenté comme abouti. Une erreur transformée en
    résultat apparemment valide — la seule chose qu'un diagnostic ne doit jamais
    faire.

    Inversées, les deux écritures rendent le statut honnête. Si l'insertion
    échoue, l'audit n'est pas conclu, la tentative compte comme un échec, et la
    reprise fait son travail.
  */
  const runner = read("src/lib/audit-runner.server.ts");
  // Chercher la RÈGLE, pas sa mise en page : le formateur replie ou déplie
  // cette chaîne d'appels selon sa longueur.
  const iPurge = runner.search(/from\("audit_findings"\)\s*\.delete\(\)/);
  const iConstats = runner.indexOf('from("audit_findings").insert(rows)');
  const iStatut = runner.indexOf("const complet = await supabase");

  t.check("les constats sont écrits", iConstats > -1, true);
  t.check("le statut est écrit", iStatut > -1, true);
  t.check("les constats précèdent le statut", iConstats < iStatut, true);
  // ET L'EFFACEMENT PRÉCÈDE L'INSERTION : les constats passent maintenant avant
  // une écriture qui peut échouer. Sans purge, une seconde tentative empilerait
  // ses constats sur ceux de la première, et chaque problème s'afficherait deux
  // fois.
  t.check("une purge précède l'insertion", iPurge > -1 && iPurge < iConstats, true);
  // Une insertion en échec doit LEVER, sinon l'audit se conclurait sans constats.
  t.check(
    "une insertion en échec interrompt la conclusion",
    /if \(fErr\) throw fErr;/.test(runner),
    true,
  );

  // L'ÉCRAN NE PEUT PAS AFFICHER UNE LISTE PÉRIMÉE. Le travail peut être terminé
  // par le passage planifié — onglet en arrière-plan, ordinateur en veille —
  // et rien n'invalidait alors la lecture des constats.
  const ecranRapport = read("src/routes/_authenticated/audits.$auditId.tsx");
  t.check(
    "les constats se relisent tant que l'audit tourne",
    /refetchInterval: \(\) => \(auditQ\.data\?\.status === "running" \? 3000 : false\)/.test(
      ecranRapport,
    ),
    true,
  );

  // ET L'ÉCRAN S'EN SERT RÉELLEMENT.
  const ecran = read("src/routes/_authenticated/audits.$auditId.tsx");
  t.check(
    "l'écran d'attente affiche la durée écoulée",
    /attente\.depuis|\{attente/.test(ecran),
    true,
  );
  t.check(
    "…et dit ce qui se passe quand c'est plus long que prévu",
    /attente\?\.auDela/.test(ecran),
    true,
  );
  // Ne jamais demander de rester sur la page : le travail n'en dépend pas.
  t.check(
    "…sans exiger que la page reste ouverte",
    /se poursuit même si vous fermez cette page/.test(ecran.replace(/\s+/g, " ")),
    true,
  );
});
