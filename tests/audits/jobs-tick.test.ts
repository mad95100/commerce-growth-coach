import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LOOKBACK_MS,
  MAX_AUDITS_PER_TICK,
  lookbackFloor,
  selectTickCandidates,
  type PendingAudit,
} from "../../src/lib/jobs-tick";
import { LEASE_MS, MAX_ATTEMPTS, INITIAL_JOB, type AuditJob } from "../../src/lib/audit-jobs";
import { defineSuite } from "../harness";

/**
 * Contrôles du déclencheur périodique des audits.
 *
 * CE QUI EST EN JEU. Ce passage tourne toutes les minutes, sans utilisateur
 * devant l'écran, et chaque audit qu'il lance coûte un appel facturé au
 * fournisseur d'IA. Trois fautes seraient coûteuses et silencieuses : relancer
 * un audit déjà en cours, relancer indéfiniment un audit condamné, ou en lancer
 * trente d'un coup. La règle de sélection est donc exercée exhaustivement.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

export default defineSuite("Audits — déclencheur périodique", (t) => {
  const NOW = new Date("2026-08-14T12:00:00Z");
  const future = new Date(NOW.getTime() + LEASE_MS).toISOString();
  const past = new Date(NOW.getTime() - 60_000).toISOString();

  let counter = 0;
  function row(job: Partial<AuditJob> | null, createdBy: string | null = "u1"): PendingAudit {
    counter += 1;
    return {
      id: `a${counter}`,
      created_by: createdBy,
      input_snapshot:
        job === null ? { name: "Boutique" } : { name: "Boutique", job: { ...INITIAL_JOB, ...job } },
    };
  }

  // ---------------------------------------------------------------------------
  // 1. Ce qui est retenu
  // ---------------------------------------------------------------------------
  t.check("liste vide => rien à faire", selectTickCandidates([], NOW), []);

  t.check(
    "audit en file => retenu",
    selectTickCandidates([row({ state: "queued" })], NOW).length,
    1,
  );
  t.check(
    "audit sans bloc job (créé avant le mécanisme) => retenu",
    selectTickCandidates([row(null)], NOW).length,
    1,
  );
  t.check(
    "audit dont le bail a expiré => retenu (c'est la reprise)",
    selectTickCandidates([row({ state: "running", attempts: 1, leaseUntil: past })], NOW).length,
    1,
  );

  // ---------------------------------------------------------------------------
  // 2. Ce qui est écarté — la partie qui protège la facture
  // ---------------------------------------------------------------------------
  t.check(
    "AUDIT EN COURS SOUS BAIL VALIDE => écarté (anti-double-exécution)",
    selectTickCandidates([row({ state: "running", attempts: 1, leaseUntil: future })], NOW),
    [],
  );
  t.check("audit terminé => écarté", selectTickCandidates([row({ state: "completed" })], NOW), []);
  t.check("audit échoué => écarté", selectTickCandidates([row({ state: "failed" })], NOW), []);
  t.check(
    "tentatives épuisées => écarté (pas de boucle infinie facturée)",
    selectTickCandidates([row({ state: "queued", attempts: MAX_ATTEMPTS })], NOW),
    [],
  );
  t.check(
    "dernière tentative encore permise",
    selectTickCandidates([row({ state: "queued", attempts: MAX_ATTEMPTS - 1 })], NOW).length,
    1,
  );
  t.check(
    "audit sans demandeur => écarté",
    selectTickCandidates([row({ state: "queued" }, null)], NOW),
    [],
  );
  t.check(
    "audit sans demandeur => écarté même avec chaîne vide",
    selectTickCandidates([row({ state: "queued" }, "")], NOW),
    [],
  );

  // ---------------------------------------------------------------------------
  // 3. Le plafond par passage
  // ---------------------------------------------------------------------------
  const many = Array.from({ length: 10 }, () => row({ state: "queued" }));
  t.check(
    "le plafond par passage est respecté",
    selectTickCandidates(many, NOW).length,
    MAX_AUDITS_PER_TICK,
  );
  t.check("le plafond vaut 3", MAX_AUDITS_PER_TICK, 3);
  t.check("le plafond est paramétrable", selectTickCandidates(many, NOW, 1).length, 1);
  t.check("un plafond nul ne retient rien", selectTickCandidates(many, NOW, 0), []);

  // ---------------------------------------------------------------------------
  // 4. L'ordre et le comptage ne sautent pas les non-éligibles
  // ---------------------------------------------------------------------------
  const mixed = [
    row({ state: "completed" }),
    row({ state: "queued" }),
    row({ state: "running", attempts: 1, leaseUntil: future }),
    row({ state: "queued" }),
  ];
  const picked = selectTickCandidates(mixed, NOW);
  t.check("seuls les éligibles sont retenus", picked.length, 2);
  t.check("l'ordre reçu est conservé", picked[0].id, mixed[1].id);
  t.check("le second éligible suit", picked[1].id, mixed[3].id);

  // Un lot rempli d'inéligibles ne doit pas consommer le plafond au point de
  // masquer un audit éligible placé plus loin.
  const buried = [
    ...Array.from({ length: 8 }, () => row({ state: "completed" })),
    row({ state: "queued" }),
  ];
  t.check("un éligible enfoui reste trouvé", selectTickCandidates(buried, NOW).length, 1);

  // ---------------------------------------------------------------------------
  // 5. Fenêtre de recherche
  // ---------------------------------------------------------------------------
  t.check("la fenêtre couvre 24 h", LOOKBACK_MS, 24 * 60 * 60 * 1000);
  t.check("la borne basse est datée correctement", lookbackFloor(NOW), "2026-08-13T12:00:00.000Z");
  t.check(
    "la borne basse est antérieure à maintenant",
    Date.parse(lookbackFloor(NOW)) < NOW.getTime(),
    true,
  );

  // ---------------------------------------------------------------------------
  // 6. Invariants du module serveur
  // ---------------------------------------------------------------------------
  // Ces contrôles sont structurels : ils portent sur des propriétés qu'aucun
  // test fonctionnel ne verrait échouer, mais dont la rupture serait grave.
  const server = read("src/lib/jobs-tick.server.ts");

  t.check("le passage n'accorde aucun quota", /consumeQuota/.test(server), false);
  t.check("le passage ne crée aucun audit", /\.insert\(/.test(server), false);
  t.check("la réclamation atomique est utilisée", server.includes("claimAudit"), true);
  t.check(
    "un audit non réclamé est abandonné sans exécution",
    /if\s*\(!claim\.claimed\)\s*continue;/.test(server),
    true,
  );
  t.check(
    "l'échec d'un audit n'interrompt pas le passage",
    /catch[\s\S]{0,300}failAuditAttempt/.test(server),
    true,
  );
  t.check("le passage n'écrit qu'avec le rôle de service", server.includes("supabaseAdmin"), true);
  t.check(
    "seuls les audits en cours sont relus",
    /\.eq\("status",\s*"running"\)/.test(server),
    true,
  );
  t.check(
    "la fenêtre de recherche est appliquée en base",
    /\.gte\("created_at",\s*lookbackFloor/.test(server),
    true,
  );
});
