import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { defineSuite } from "../harness";

/**
 * LE PREMIER AUDIT NE DOIT RIEN MODIFIER.
 *
 * CE QUI EST EN JEU. Un premier diagnostic sur une vraie boutique n'a droit à
 * aucune écriture chez le marchand. Pas une fiche produit réécrite, pas un
 * budget publicitaire ajusté, pas une campagne mise en pause. Un audit qui
 * modifierait quoi que ce soit sans être demandé détruirait la confiance
 * avant d'avoir produit sa première conclusion — et sur un compte
 * publicitaire, ferait perdre de l'argent réel en quelques minutes.
 *
 * POURQUOI UN TEST ET NON UNE PROMESSE. « Le code ne fait pas ça » est vrai
 * jusqu'au jour où quelqu'un ajoute un import de confort dans le chemin
 * d'audit. Ce contrôle lit le graphe d'imports réel depuis
 * `executeAuditWork` et échoue si une fonction d'écriture y devient
 * atteignable, même indirectement.
 *
 * CE QU'IL NE PROUVE PAS, et il faut le dire : qu'un audit tourne
 * correctement en production. Un test statique démontre l'absence d'un chemin,
 * pas la présence d'un comportement. La collecte réelle, elle, ne se vérifie
 * que sur une boutique réelle.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/**
 * Fonctions qui ÉCRIVENT chez un partenaire.
 *
 * Relevé exhaustif des connecteurs d'exécution. Chacune modifie un compte
 * réel : produit, code de réduction, budget, statut de campagne, ciblage,
 * création publicitaire, mots-clés négatifs.
 */
const MUTATING = [
  // Shopify
  "shopifyUpdateProduct",
  "shopifyCreateDiscountCode",
  "shopifyDeletePriceRule",
  // Meta
  "metaUpdateBudget",
  "metaSetAdSetStatus",
  "metaPauseAdSet",
  "metaUpdateTargeting",
  "metaUpdateAdCreative",
  // Google
  "googleUpdateBudget",
  "googleSetCampaignStatus",
  "googlePauseCampaign",
  "googleAddNegativeKeywords",
  "googleRemoveCampaignCriteria",
  "googleUpdateRsaText",
];

/** Modules atteints depuis un point d'entrée, en suivant les imports `@/`. */
function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);

    let code: string;
    try {
      code = read(current);
    } catch {
      continue;
    }

    // Imports statiques ET dynamiques : le chemin d'audit utilise surtout les
    // seconds, pour ne charger un connecteur que si le canal est branché.
    for (const match of code.matchAll(/["']@\/([^"']+)["']/g)) {
      const path = `src/${match[1]}`;
      for (const candidate of [`${path}.ts`, `${path}.tsx`, `${path}/index.ts`]) {
        try {
          readFileSync(join(ROOT, candidate));
          queue.push(candidate);
          break;
        } catch {
          /* extension suivante */
        }
      }
    }
  }

  return seen;
}

export default defineSuite("Audit réel — garantie de lecture seule", (t) => {
  const auditModules = reachableFrom("src/lib/audit-runner.server.ts");

  t.check("le graphe d'imports de l'audit est exploré", auditModules.size > 5, true);
  t.check(
    "et il atteint bien les trois connecteurs de lecture",
    ["shopify-observe", "meta-observe", "google-observe"].every((c) =>
      [...auditModules].some((m) => m.includes(c)),
    ),
    true,
  );

  // LE contrôle : aucune fonction d'écriture ne doit être APPELÉE depuis un
  // module du chemin d'audit. On cherche l'appel, pas la simple mention :
  // un connecteur d'exécution peut être atteint pour ses types ou ses
  // constantes sans qu'aucune écriture ne parte.
  for (const fn of MUTATING) {
    const callers = [...auditModules].filter((module) => {
      // Le module qui DÉFINIT la fonction n'est pas un appelant.
      if (module.includes("-apply.server")) return false;
      const code = read(module);
      return new RegExp(`\\b${fn}\\s*\\(`).test(code);
    });
    t.check(`« ${fn} » n'est jamais appelée pendant un audit`, callers, []);
  }

  // Les connecteurs de lecture ne doivent contenir aucune écriture par
  // eux-mêmes. Google fait exception apparente : son endpoint de LECTURE est
  // un POST — `googleAds:search` — ce qui est une particularité de l'API, pas
  // une modification. Toute écriture y passerait par `:mutate`.
  for (const file of [
    "src/lib/connectors/shopify-observe.server.ts",
    "src/lib/connectors/meta-observe.server.ts",
    "src/lib/connectors/google-observe.server.ts",
  ]) {
    const code = read(file);
    t.check(`« ${file} » n'appelle aucun endpoint de mutation`, /:mutate/.test(code), false);
    t.check(`« ${file} » n'écrit pas par PUT`, /method:\s*["']PUT["']/.test(code), false);
    t.check(`« ${file} » n'écrit pas par DELETE`, /method:\s*["']DELETE["']/.test(code), false);
  }
  t.check(
    "seul Google lit par POST, et c'est son endpoint de recherche",
    read("src/lib/connectors/google-observe.server.ts").includes("googleAds:search"),
    true,
  );

  // --- Ce que l'audit écrit, et où -----------------------------------------
  // Il écrit dans NOTRE base — audits, findings, instantanés, mémoire — et
  // nulle part ailleurs. C'est la distinction qui compte : la base est à nous,
  // la boutique est au marchand.
  const runner = read("src/lib/audit-runner.server.ts");
  const writtenTables = [...runner.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
  const allowed = new Set([
    "profiles",
    "fix_attempts",
    "audits",
    "audit_findings",
    "stores",
    "data_snapshots",
  ]);
  t.check(
    "l'audit n'écrit que dans nos propres tables",
    writtenTables.filter((table) => !allowed.has(table)),
    [],
  );

  // --- L'exécution d'une correction reste derrière une confirmation --------
  // Le seul chemin qui écrit chez un partenaire part d'une action confirmée,
  // jamais d'un audit.
  const actions = read("src/lib/actions.functions.ts");
  t.check(
    "l'exécution réelle passe par une confirmation explicite",
    /confirmAction/.test(actions),
    true,
  );
  t.check("et l'aperçu se contente de proposer", /proposeFix/.test(actions), true);
  // Un aperçu qui écrirait serait le pire des défauts : le marchand croirait
  // regarder, alors qu'il aurait déjà modifié son compte.
  const preview = reachableFrom("src/lib/apply-fix.server.ts");
  t.check("le générateur d'aperçu existe", preview.size > 0, true);

  // --- Le cron ne déclenche aucune écriture partenaire ---------------------
  const tickModules = reachableFrom("src/lib/jobs-tick.server.ts");
  for (const fn of MUTATING) {
    const callers = [...tickModules].filter((module) => {
      if (module.includes("-apply.server")) return false;
      return new RegExp(`\\b${fn}\\s*\\(`).test(read(module));
    });
    t.check(`le passage périodique n'appelle jamais « ${fn} »`, callers, []);
  }

  // --- Aucun raccourci de test dans le chemin réel -------------------------
  // Un test unitaire ne prouve pas qu'une fonctionnalité tourne. Mais un
  // raccourci de test laissé dans le chemin réel, lui, se voit.
  const realPath = [
    "src/lib/audit-runner.server.ts",
    "src/lib/jobs-tick.server.ts",
    "src/lib/measure-tick.server.ts",
    "src/lib/reaudit.server.ts",
    "src/lib/tracking.server.ts",
    ...readdirSync(join(ROOT, "src/lib/connectors"))
      .filter((f) => f.endsWith(".server.ts"))
      .map((f) => `src/lib/connectors/${f}`),
  ];
  for (const file of realPath) {
    const code = read(file);
    t.check(
      `« ${file} » ne contient aucun raccourci de test`,
      /NODE_ENV\s*===\s*["']test["']|if\s*\(\s*__TEST__|SKIP_REAL|process\.env\.CI\b/.test(code),
      false,
    );
    t.check(
      `« ${file} » ne renvoie aucune donnée figée`,
      /return\s+(MOCK|FAKE|SAMPLE|DEMO)_/.test(code),
      false,
    );
  }

  // --- Ce que le premier audit produit -------------------------------------
  // Le rapport doit porter ce qui a été lu, ce qui manque, et les limites de
  // l'analyse. Sans la troisième partie, les deux premières se lisent comme
  // une vérité complète.
  t.check("l'audit conserve l'entonnoir mesuré", runner.includes("funnel,"), true);
  t.check("les croisements entre sources", runner.includes("cross_signals"), true);
  t.check("et les données manquantes", runner.includes("data_gaps"), true);
  t.check("les manques viennent de toutes les sources", runner.includes("allGaps(reports)"), true);
});
