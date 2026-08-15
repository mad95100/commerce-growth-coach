import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MIN_DAYS_BETWEEN_AUDITS,
  REAUDIT_ACTIONS,
  REAUDIT_PROMPT_COOLDOWN_DAYS,
  decideReaudit,
  describeLearning,
  type ReauditSignal,
} from "../../src/lib/reaudit";
import { defineSuite } from "../harness";

/**
 * Relance automatique du diagnostic.
 *
 * CE QUI EST EN JEU. Un audit coûte un appel facturé au fournisseur de modèles
 * ET un quota mensuel. Le déclencher automatiquement revient à dépenser
 * l'argent du marchand sans le lui demander. Quatre fautes seraient graves :
 *
 * - vider les trois audits mensuels d'un compte gratuit pendant son sommeil ;
 * - lancer deux diagnostics concurrents sur la même boutique ;
 * - relancer sans que rien de neuf n'ait été mesuré, ce qui relirait les mêmes
 *   chiffres et rendrait les mêmes conclusions, pour le même prix ;
 * - reproposer tous les jours un diagnostic déjà refusé une fois.
 *
 * La règle est pure : elle décide, elle ne lance rien. Elle est donc exerçable
 * intégralement sans réseau, sans base, et sans facture.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

const NOW = new Date("2026-08-15T12:00:00.000Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

function signal(overrides: Partial<ReauditSignal> = {}): ReauditSignal {
  return {
    storeId: "boutique-a",
    verdictsSinceAudit: ["confirme", "nul"],
    lastAuditAt: ago(10),
    auditRunning: false,
    quotaRemaining: null,
    promptedAt: null,
    ...overrides,
  };
}

export default defineSuite("Audits — relance du diagnostic", (t) => {
  t.check("trois décisions possibles", REAUDIT_ACTIONS.length, 3);

  // --- Ce qui empêche toute relance ----------------------------------------
  const running = decideReaudit(signal({ auditRunning: true }), NOW);
  t.check("un diagnostic en cours bloque tout", running.action, "attendre");
  t.check("et on dit pourquoi", running.reason.includes("déjà en cours"), true);

  const nothingNew = decideReaudit(signal({ verdictsSinceAudit: [] }), NOW);
  t.check("sans verdict nouveau, on ne relance pas", nothingNew.action, "attendre");
  t.check(
    "parce qu'il n'y a rien de neuf à analyser",
    nothingNew.reason.includes("rien de neuf à analyser"),
    true,
  );

  // Une mesure en cours ou un impact insuffisant n'apprennent rien : ils ne
  // justifient pas de repayer un diagnostic.
  t.check(
    "un verdict non tranché ne justifie pas de relancer",
    decideReaudit(signal({ verdictsSinceAudit: ["en_cours", "insuffisant"] }), NOW).action,
    "attendre",
  );

  const tooSoon = decideReaudit(signal({ lastAuditAt: ago(1) }), NOW);
  t.check("un diagnostic trop récent fait attendre", tooSoon.action, "attendre");
  t.check(
    "et l'explication rappelle la fenêtre glissante",
    tooSoon.reason.includes("cumuls"),
    true,
  );
  t.check(
    `à ${MIN_DAYS_BETWEEN_AUDITS} jours pile, on peut relancer`,
    decideReaudit(signal({ lastAuditAt: ago(MIN_DAYS_BETWEEN_AUDITS) }), NOW).action !== "attendre",
    true,
  );

  // --- Qui paie décide ------------------------------------------------------
  // LA règle qui protège le marchand : on ne dépense pas une allocation comptée
  // sans son accord.
  const unlimited = decideReaudit(signal({ quotaRemaining: null }), NOW);
  t.check("un quota illimité autorise le lancement", unlimited.action, "lancer");
  t.check(
    "et on dit que la boutique a changé",
    unlimited.reason.includes("n'est plus celle qui a été auditée"),
    true,
  );

  const counted = decideReaudit(signal({ quotaRemaining: 2 }), NOW);
  t.check("un quota compté fait proposer, jamais lancer", counted.action, "proposer");
  t.check("et annonce ce qui reste", counted.reason.includes("2 audits ce mois-ci"), true);
  t.check(
    "au singulier quand il n'en reste qu'un",
    decideReaudit(signal({ quotaRemaining: 1 }), NOW).reason.includes("1 audit ce mois-ci"),
    true,
  );

  const exhausted = decideReaudit(signal({ quotaRemaining: 0 }), NOW);
  t.check("un quota épuisé fait attendre", exhausted.action, "attendre");
  t.check(
    "et le dit sans détour",
    exhausted.reason.includes("quota d'audits du mois est épuisé"),
    true,
  );
  t.check(
    "tout en reconnaissant que le diagnostic serait justifié",
    exhausted.reason.includes("est justifié"),
    true,
  );

  // --- Une proposition ignorée est un refus --------------------------------
  const justAsked = decideReaudit(signal({ quotaRemaining: 2, promptedAt: ago(1) }), NOW);
  t.check("on ne repropose pas le lendemain", justAsked.action, "attendre");
  t.check("une proposition ignorée vaut refus", justAsked.reason.includes("est un refus"), true);
  t.check(
    "passé le délai de courtoisie, on repropose",
    decideReaudit(
      signal({ quotaRemaining: 2, promptedAt: ago(REAUDIT_PROMPT_COOLDOWN_DAYS + 1) }),
      NOW,
    ).action,
    "proposer",
  );
  // Le délai ne s'applique qu'aux propositions : un quota illimité lance sans
  // rien demander, donc sans rien avoir proposé.
  t.check(
    "le délai de courtoisie ne bride pas le lancement",
    decideReaudit(signal({ quotaRemaining: null, promptedAt: ago(1) }), NOW).action,
    "lancer",
  );

  // --- Une boutique jamais auditée -----------------------------------------
  t.check(
    "sans audit précédent, rien n'empêche de relancer",
    decideReaudit(signal({ lastAuditAt: null }), NOW).action,
    "lancer",
  );

  // --- Entrées illisibles ---------------------------------------------------
  t.check(
    "une date d'audit illisible n'empêche pas la décision",
    decideReaudit(signal({ lastAuditAt: "pas une date" }), NOW).action,
    "lancer",
  );
  t.check(
    "une date de proposition illisible non plus",
    decideReaudit(signal({ quotaRemaining: 2, promptedAt: "n'importe quoi" }), NOW).action,
    "proposer",
  );

  // --- Ce que les mesures ont appris ---------------------------------------
  const counts = decideReaudit(
    signal({ verdictsSinceAudit: ["confirme", "confirme", "nul", "regression", "en_cours"] }),
    NOW,
  );
  t.check("les verdicts tranchés sont comptés", counts.learned, {
    confirmed: 2,
    ineffective: 1,
    regressed: 1,
  });
  t.check(
    "les verdicts non tranchés ne le sont pas",
    counts.learned.confirmed + counts.learned.ineffective + counts.learned.regressed,
    4,
  );

  t.check(
    "l'apprentissage se raconte au singulier",
    describeLearning({ confirmed: 1, ineffective: 0, regressed: 0 }),
    "Depuis le dernier diagnostic, une correction a prouvé son effet.",
  );
  t.check(
    "et au pluriel",
    describeLearning({ confirmed: 3, ineffective: 0, regressed: 0 }).includes(
      "3 corrections ont prouvé leur effet",
    ),
    true,
  );
  t.check(
    "les trois natures sont énumérées ensemble",
    describeLearning({ confirmed: 2, ineffective: 1, regressed: 1 }),
    "Depuis le dernier diagnostic, 2 corrections ont prouvé leur effet, une n'a rien changé et une a fait reculer la boutique.",
  );
  t.check(
    "rien de tranché se dit aussi",
    describeLearning({ confirmed: 0, ineffective: 0, regressed: 0 }).includes(
      "rien n'a été tranché",
    ),
    true,
  );
  t.check(
    "la décision porte le récit de l'apprentissage",
    unlimited.reason.startsWith("Depuis le dernier diagnostic,"),
    true,
  );

  // --- Le branchement -------------------------------------------------------
  const tick = read("src/lib/jobs-tick.server.ts");
  t.check("le passage périodique déclenche la réanalyse", tick.includes("runReauditTick"), true);
  t.check(
    "la réanalyse vient APRÈS la mesure",
    tick.indexOf("runMeasureTick") < tick.indexOf("runReauditTick"),
    true,
  );
  t.check("une réanalyse en échec n'empêche pas le reste", /réanalyse impossible/.test(tick), true);

  const server = read("src/lib/reaudit.server.ts");
  // Un audit créé sans quota décompté ouvrirait un contournement complet du
  // plan payant, par un chemin que personne ne regarde.
  t.check("le lancement décompte le quota", server.includes("consumeQuota"), true);
  // Le contrôle porte sur le corps de `launchAudit` seul : `considerStore` lit
  // aussi la table des audits, bien avant, et comparer sur le fichier entier
  // passerait pour vrai sans rien démontrer.
  const launch = server.slice(server.indexOf("async function launchAudit"));
  t.check(
    "le quota est décompté AVANT la création",
    launch.indexOf("consumeQuota") < launch.indexOf('.from("audits")'),
    true,
  );
  t.check("un quota décompté pour rien est rendu", server.includes("refundQuota"), true);
  // Sans cette écriture, la proposition repartirait à chaque passage — soit
  // toutes les minutes.
  const propose = server.slice(server.indexOf("async function proposeAudit"));
  t.check(
    "la date de proposition est écrite avant la notification",
    propose.indexOf("reaudit_prompted_at") < propose.indexOf('from("notifications")'),
    true,
  );
  t.check(
    "le marchand est prévenu dans les deux cas",
    (server.match(/from\("notifications"\)/g) ?? []).length,
    2,
  );

  const migration = read("supabase/migrations/20260815210000_reaudit.sql");
  t.check("la migration est additive", migration.includes("ADD COLUMN IF NOT EXISTS"), true);
  t.check("et rejouable", migration.includes("CREATE INDEX IF NOT EXISTS"), true);
  for (const forbidden of ["DROP TABLE", "TRUNCATE", "DELETE FROM"]) {
    t.check(
      `la migration ne contient pas « ${forbidden} »`,
      new RegExp(forbidden, "i").test(migration),
      false,
    );
  }
});
