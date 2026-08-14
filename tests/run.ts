/**
 * Lanceur de la suite de tests.
 *
 * Exécute chaque domaine, agrège les résultats, puis confronte ce qui a
 * réellement tourné à l'inventaire attendu (`expected.ts`). Une suite manquante
 * ou amaigrie fait échouer la CI au même titre qu'un contrôle en échec : c'est
 * ce qui empêche qu'une garantie disparaisse sans que personne ne le voie.
 *
 * Aucun secret, aucun réseau, aucune base : tous les contrôles sont soit purs,
 * soit exercés contre des doublures définies dans les fichiers de test.
 */
import { runSuite, type Suite, type SuiteResult } from "./harness";
import { EXPECTED_SUITES, MIN_TOTAL_CHECKS } from "./expected";

const GREEN = "[32m";
const RED = "[31m";
const DIM = "[2m";
const RESET = "[0m";

async function main() {
  const results: Array<SuiteResult & { file: string }> = [];
  const missing: string[] = [];

  for (const expected of EXPECTED_SUITES) {
    let suite: Suite;
    try {
      const mod = (await import(`./${expected.file}`)) as { default: Suite };
      suite = mod.default;
      if (!suite || typeof suite.run !== "function") {
        missing.push(`${expected.file} — n'exporte pas de suite`);
        continue;
      }
    } catch (err) {
      missing.push(
        `${expected.file} — introuvable ou illisible : ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    const result = await runSuite(suite);
    results.push({ ...result, file: expected.file });

    const ok = result.failures.length === 0;
    const mark = ok ? `${GREEN}OK${RESET}` : `${RED}ÉCHEC${RESET}`;
    console.log(
      `${mark}  ${result.name}\n    ${DIM}${expected.file} — ${result.passed} contrôles${RESET}`,
    );
    for (const failure of result.failures) console.log(`      ${RED}✗${RESET} ${failure}`);
  }

  const total = results.reduce((sum, r) => sum + r.passed, 0);
  const failed = results.reduce((sum, r) => sum + r.failures.length, 0);

  // Garde-fou sur la suite elle-même : une garantie ne doit pas disparaître en silence.
  const shrunk: string[] = [];
  for (const expected of EXPECTED_SUITES) {
    const actual = results.find((r) => r.file === expected.file);
    if (!actual) continue;
    if (actual.passed + actual.failures.length < expected.minChecks) {
      shrunk.push(
        `${expected.file} : ${actual.passed + actual.failures.length} contrôles exécutés, ${expected.minChecks} attendus au minimum.\n` +
          `      Ce domaine protège : ${expected.covers}`,
      );
    }
  }

  console.log(`\n${"─".repeat(64)}`);
  console.log(
    `${results.length}/${EXPECTED_SUITES.length} suites, ${total} contrôles conformes, ${failed} échec(s).`,
  );

  if (missing.length > 0) {
    console.log(`\n${RED}SUITES MANQUANTES${RESET}`);
    missing.forEach((m) => console.log(`  - ${m}`));
  }
  if (shrunk.length > 0) {
    console.log(`\n${RED}SUITES AMAIGRIES${RESET} — des contrôles ont disparu :`);
    shrunk.forEach((m) => console.log(`  - ${m}`));
  }
  if (total < MIN_TOTAL_CHECKS) {
    console.log(
      `\n${RED}TOTAL INSUFFISANT${RESET} : ${total} contrôles pour ${MIN_TOTAL_CHECKS} attendus.`,
    );
  }

  const clean =
    failed === 0 && missing.length === 0 && shrunk.length === 0 && total >= MIN_TOTAL_CHECKS;
  if (!clean) process.exit(1);
  console.log(`${GREEN}Tout est conforme.${RESET}`);
}

await main();
