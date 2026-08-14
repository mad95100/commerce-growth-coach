/**
 * Contrôles des plans et quotas.
 *
 * Les règles pures sont exercées directement. Le décompte est exercé contre un
 * FAUX PostgREST écrit ici : aucune base n'est jointe. Ce faux respecte la seule
 * propriété qui compte pour la sûreté du compteur — une écriture conditionnée à
 * une valeur qui a changé n'affecte aucune ligne.
 *
 * Script hors dépôt, non commité.
 */
import {
  PLAN_LIMITS,
  effectiveTier,
  isCurrentPeriod,
  isQuotaExhausted,
  periodStart,
  quotaExhaustedMessage,
  quotaLimit,
  remainingQuota,
} from "../../src/lib/plans";
import {
  QuotaExhaustedError,
  consumeQuota,
  loadEntitlements,
  refundQuota,
} from "../../src/lib/billing.server";
import { defineSuite } from "../../tests/harness";

export default defineSuite("Abonnements — plans et quotas", async (t) => {
  // ---------------------------------------------------------------------------
  // 1. Plan effectif : un abonnement qui n'est plus payé ne donne pas le plan
  // ---------------------------------------------------------------------------
  t.check("aucun abonnement => gratuit", effectiveTier(null), "free");
  t.check("abonnement absent => gratuit", effectiveTier(undefined), "free");
  t.check("pro actif => pro", effectiveTier({ tier: "pro", status: "active" }), "pro");
  t.check("pro en essai => pro", effectiveTier({ tier: "pro", status: "trialing" }), "pro");
  t.check("pro RÉSILIÉ => gratuit", effectiveTier({ tier: "pro", status: "canceled" }), "free");
  t.check("pro IMPAYÉ => gratuit", effectiveTier({ tier: "pro", status: "past_due" }), "free");
  t.check("pro incomplet => gratuit", effectiveTier({ tier: "pro", status: "incomplete" }), "free");
  t.check("pro sans statut => gratuit", effectiveTier({ tier: "pro", status: null }), "free");
  t.check("gratuit actif => gratuit", effectiveTier({ tier: "free", status: "active" }), "free");
  t.check(
    "palier inconnu => gratuit",
    effectiveTier({ tier: "entreprise", status: "active" }),
    "free",
  );

  // ---------------------------------------------------------------------------
  // 2. Limites et soldes
  // ---------------------------------------------------------------------------
  t.check("limite gratuite audits", quotaLimit("free", "audits"), PLAN_LIMITS.free.audits);
  t.check("pro sans limite", quotaLimit("pro", "audits"), null);
  t.check("solde gratuit neuf", remainingQuota("free", "audits", 0), PLAN_LIMITS.free.audits);
  t.check(
    "solde gratuit entamé",
    remainingQuota("free", "audits", 2),
    (PLAN_LIMITS.free.audits ?? 0) - 2,
  );
  t.check("solde jamais négatif", remainingQuota("free", "audits", 99), 0);
  t.check(
    "consommation négative ignorée",
    remainingQuota("free", "audits", -5),
    PLAN_LIMITS.free.audits,
  );
  t.check("solde pro toujours nul (sans limite)", remainingQuota("pro", "fixes", 10_000), null);

  t.check(
    "gratuit épuisé à la limite",
    isQuotaExhausted("free", "audits", PLAN_LIMITS.free.audits ?? 0),
    true,
  );
  t.check(
    "gratuit non épuisé juste avant",
    isQuotaExhausted("free", "audits", (PLAN_LIMITS.free.audits ?? 1) - 1),
    false,
  );
  t.check("gratuit épuisé au-delà", isQuotaExhausted("free", "audits", 999), true);
  t.check("pro jamais épuisé", isQuotaExhausted("pro", "audits", 10_000), false);

  t.check(
    "message d'épuisement mentionne la limite et le plan Pro",
    quotaExhaustedMessage("free", "audits").includes(String(PLAN_LIMITS.free.audits)) &&
      quotaExhaustedMessage("free", "audits").includes("Pro"),
    true,
  );

  // ---------------------------------------------------------------------------
  // 3. Période : le 1er du mois, en UTC
  // ---------------------------------------------------------------------------
  t.check("période au 15 du mois", periodStart(new Date("2026-08-15T12:00:00Z")), "2026-08-01");
  t.check("période le 1er", periodStart(new Date("2026-08-01T00:00:00Z")), "2026-08-01");
  t.check("dernier instant du mois", periodStart(new Date("2026-08-31T23:59:59Z")), "2026-08-01");
  t.check("bascule au mois suivant", periodStart(new Date("2026-09-01T00:00:00Z")), "2026-09-01");
  t.check("janvier", periodStart(new Date("2026-01-05T00:00:00Z")), "2026-01-01");
  // Un fuseau local en avance ne doit pas faire basculer la période trop tôt.
  t.check(
    "23h59 UTC le 31 reste dans le mois courant",
    periodStart(new Date("2026-08-31T23:59:00Z")),
    "2026-08-01",
  );
  t.check("période courante reconnue", isCurrentPeriod(periodStart()), true);
  t.check("période échue rejetée", isCurrentPeriod("2020-01-01"), false);
  t.check("horodatage complet accepté", isCurrentPeriod(`${periodStart()}T00:00:00+00:00`), true);
  t.check("période absente => périmée", isCurrentPeriod(null), false);
  t.check("période vide => périmée", isCurrentPeriod(""), false);

  // ---------------------------------------------------------------------------
  // 4. Décompte réel contre un faux PostgREST
  // ---------------------------------------------------------------------------
  type Row = Record<string, any>;

  /**
   * Faux client : reproduit `select/eq/update/insert` de PostgREST, y compris la
   * propriété décisive — un `update` filtré sur une valeur périmée n'affecte rien.
   */
  function fakeDb(opts: { subscription?: Row | null; usage?: Row | null; onRead?: () => void }) {
    const state: { subscription: Row | null; usage: Row | null } = {
      subscription: opts.subscription ?? null,
      usage: opts.usage ?? null,
    };

    function builder(table: string) {
      const filters: Array<[string, any]> = [];
      let mode: "select" | "update" | "insert" = "select";
      let patch: Row = {};

      const api: any = {
        select: () => api,
        eq: (col: string, val: any) => (filters.push([col, val]), api),
        order: () => api,
        limit: () => api,
        update: (p: Row) => ((mode = "update"), (patch = p), api),
        insert: (p: Row) => ((mode = "insert"), (patch = p), api),
        // supabase-js exécute la requête dès qu'on l'attend, même sans
        // `.maybeSingle()` : `refundQuota` s'appuie sur ce comportement. Sans ce
        // `then`, le faux ne jouait tout simplement pas l'écriture.
        then: (resolve: any, reject: any) => api.maybeSingle().then(resolve, reject),
        maybeSingle: async () => {
          const current = table === "usage" ? state.usage : state.subscription;

          if (mode === "insert") {
            const row = { id: "u1", ...patch };
            if (table === "usage") state.usage = row;
            return { data: row, error: null };
          }

          if (mode === "select") {
            if (table === "usage") opts.onRead?.();
            return { data: current, error: null };
          }

          // update : tous les filtres doivent correspondre à l'état ACTUEL.
          if (!current) return { data: null, error: null };
          const matches = filters.every(([col, val]) => current[col] === val);
          if (!matches) return { data: null, error: null };
          const next = { ...current, ...patch };
          if (table === "usage") state.usage = next;
          return { data: next, error: null };
        },
      };
      return api;
    }

    return { from: (t: string) => builder(t), _state: state } as any;
  }

  function usageRow(over: Row = {}): Row {
    return {
      id: "u1",
      user_id: "user-1",
      period_start: periodStart(),
      audits_used: 0,
      fixes_used: 0,
      coach_messages_used: 0,
      ...over,
    };
  }

  {
    // --- 4a. Décompte nominal ---
    let db = fakeDb({ usage: usageRow() });
    await consumeQuota(db, "user-1", "audits");
    t.check("un décompte incrémente de 1", db._state.usage.audits_used, 1);
    await consumeQuota(db, "user-1", "audits");
    t.check("deux décomptes incrémentent de 2", db._state.usage.audits_used, 2);
    t.check("les autres compteurs ne bougent pas", db._state.usage.fixes_used, 0);

    // --- 4b. Refus à la limite ---
    db = fakeDb({ usage: usageRow({ audits_used: PLAN_LIMITS.free.audits ?? 3 }) });
    await t.throwsAsync(
      "quota épuisé => refus",
      () => consumeQuota(db, "user-1", "audits"),
      QuotaExhaustedError,
    );
    t.check("un refus n'incrémente rien", db._state.usage.audits_used, PLAN_LIMITS.free.audits);

    // --- 4c. Le plan Pro n'écrit rien du tout ---
    let reads = 0;
    db = fakeDb({
      subscription: { tier: "pro", status: "active" },
      usage: usageRow({ audits_used: 10_000 }),
      onRead: () => reads++,
    });
    await consumeQuota(db, "user-1", "audits");
    t.check("pro : aucun incrément", db._state.usage.audits_used, 10_000);
    t.check("pro : aucune lecture de consommation", reads, 0);

    // --- 4d. Un abonnement pro résilié retombe sur les limites gratuites ---
    db = fakeDb({
      subscription: { tier: "pro", status: "canceled" },
      usage: usageRow({ audits_used: PLAN_LIMITS.free.audits ?? 3 }),
    });
    await t.throwsAsync(
      "pro résilié => quota gratuit appliqué",
      () => consumeQuota(db, "user-1", "audits"),
      QuotaExhaustedError,
    );

    // --- 4e. Période échue : le compteur repart à zéro ---
    db = fakeDb({ usage: usageRow({ period_start: "2020-01-01", audits_used: 99 }) });
    await consumeQuota(db, "user-1", "audits");
    t.check(
      "période échue : compteur réinitialisé puis incrémenté",
      db._state.usage.audits_used,
      1,
    );
    t.check("période mise à jour", db._state.usage.period_start, periodStart());
    t.check("les autres compteurs sont aussi remis à zéro", db._state.usage.fixes_used, 0);

    // --- 4f. Aucune ligne : elle est créée ---
    db = fakeDb({ usage: null });
    await consumeQuota(db, "user-1", "fixes");
    t.check("ligne créée à la première consommation", db._state.usage.fixes_used, 1);
    t.check("créée sur la période courante", db._state.usage.period_start, periodStart());

    // --- 4g. LE POINT DÉCISIF : concurrence ---
    // Une requête concurrente modifie la valeur entre la lecture et l'écriture.
    // Le compare-and-swap doit le détecter et relire, sans jamais perdre l'unité
    // écrite par l'autre.
    let injected = false;
    db = fakeDb({
      usage: usageRow({ audits_used: 0 }),
      onRead: () => {
        if (!injected) {
          injected = true;
          db._state.usage = { ...db._state.usage, audits_used: 1 };
        }
      },
    });
    await consumeQuota(db, "user-1", "audits");
    t.check(
      "écriture concurrente détectée : les deux unités sont comptées",
      db._state.usage.audits_used,
      2,
    );

    // --- 4h. Restitution ---
    db = fakeDb({ usage: usageRow({ fixes_used: 3 }) });
    await refundQuota(db, "user-1", "fixes");
    t.check("restitution décrémente", db._state.usage.fixes_used, 2);
    db = fakeDb({ usage: usageRow({ fixes_used: 0 }) });
    await refundQuota(db, "user-1", "fixes");
    t.check("restitution ne descend jamais sous zéro", db._state.usage.fixes_used, 0);
    db = fakeDb({ usage: null });
    await refundQuota(db, "user-1", "fixes");
    t.check("restitution sans ligne ne lève pas", true, true);

    // --- 4i. Lecture des droits ---
    db = fakeDb({ usage: usageRow({ audits_used: 1, fixes_used: 2 }) });
    const e = await loadEntitlements(db, "user-1");
    t.check("droits : plan", e.tier, "free");
    t.check("droits : consommation", e.used, { audits: 1, fixes: 2, coach_messages: 0 });
    t.check("droits : solde audits", e.remaining.audits, (PLAN_LIMITS.free.audits ?? 0) - 1);
    t.check("droits : période", e.periodStart, periodStart());

    db = fakeDb({ subscription: { tier: "pro", status: "active" }, usage: usageRow() });
    const pro = await loadEntitlements(db, "user-1");
    t.check("droits pro : soldes sans limite", pro.remaining, {
      audits: null,
      fixes: null,
      coach_messages: null,
    });
  }
});
