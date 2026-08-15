import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { defineSuite } from "../harness";

/**
 * Aucune dépendance Lovable à l'exécution.
 *
 * POURQUOI CE TEST EXISTE. Sortir d'une plateforme est facile à faire une fois
 * et facile à défaire sans s'en rendre compte : il suffit qu'un fichier généré
 * revienne, qu'un paquet soit réinstallé, ou qu'un correctif recopie une URL de
 * passerelle. Ce test transforme « on a migré » en propriété vérifiée à chaque
 * commit.
 *
 * CE QU'IL AUTORISE. Deux replis transitoires, nommés un par un ci-dessous, qui
 * gardent le déploiement historique en vie pendant la bascule. Ils ne sont
 * atteignables que si la configuration correspondante manque, ce que la
 * nouvelle infrastructure renseigne — c'est également vérifié ici.
 *
 * À LA BASCULE : supprimer les deux constantes, puis vider `ALLOWED`. Le test
 * échouera tant que le code ne sera pas conforme, ce qui est le rappel voulu.
 */

const ROOT = new URL("../../", import.meta.url).pathname;

/** Replis transitoires acceptés, avec le nom de la constante qui les porte. */
const ALLOWED: Array<{ file: string; constant: string }> = [
  { file: "src/lib/ai-gateway.server.ts", constant: "LEGACY_BASE_URL" },
  { file: "src/lib/public-origin.server.ts", constant: "LEGACY_ORIGIN" },
];

/** Marqueurs d'une dépendance Lovable à l'exécution. */
const MARKERS = [
  "lovable.dev",
  "lovable.app",
  "@lovable.dev/",
  "LOVABLE_API_KEY",
  "__lovableEvents",
  "__lovableReportRuntimeError",
  "createLovableAuth",
  "lovable-core-prod",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), "utf8");
}

export default defineSuite("Infrastructure — aucune dépendance Lovable", (t) => {
  const sourceFiles = walk(join(ROOT, "src"));
  t.check("des sources ont bien été analysées", sourceFiles.length > 50, true);

  const allowedFiles = new Set(ALLOWED.map((entry) => join(ROOT, entry.file)));

  // --- 1. Le code applicatif ------------------------------------------------
  for (const marker of MARKERS) {
    const offenders = sourceFiles.filter(
      (file) => !allowedFiles.has(file) && readFileSync(file, "utf8").includes(marker),
    );
    t.check(
      `aucune source ne référence « ${marker} »`,
      offenders.map((f) => f.slice(ROOT.length)),
      [],
    );
  }

  // --- 2. Les replis transitoires sont bien ceux qu'on croit ----------------
  for (const { file, constant } of ALLOWED) {
    const source = read(file);
    t.check(`${file} porte le repli ${constant}`, source.includes(`const ${constant} =`), true);
    t.check(
      `${file} annonce le repli comme transitoire`,
      /transitoire|SUPPRIMER/i.test(source),
      true,
    );
  }

  // Le repli d'origine n'est atteint que si `APP_URL` manque.
  const origin = read("src/lib/public-origin.server.ts");
  t.check(
    "l'origine publique donne la priorité à APP_URL",
    /process\.env\.APP_URL[\s\S]{0,200}\?\?\s*LEGACY_ORIGIN/.test(origin),
    true,
  );

  // Le repli de passerelle n'est atteint que si `AI_BASE_URL` manque.
  const gateway = read("src/lib/ai-gateway.server.ts");
  t.check(
    "la passerelle IA donne la priorité à AI_BASE_URL",
    gateway.indexOf("AI_BASE_URL") < gateway.indexOf("LEGACY_KEY_VAR]"),
    true,
  );

  // --- 3. La configuration de déploiement neutralise les deux replis --------
  const wrangler = read("wrangler.toml");
  t.check("wrangler.toml renseigne APP_URL", /^APP_URL\s*=/m.test(wrangler), true);
  t.check("wrangler.toml renseigne AI_BASE_URL", /^AI_BASE_URL\s*=/m.test(wrangler), true);
  t.check(
    "aucune valeur de wrangler.toml ne pointe vers Lovable",
    MARKERS.some((m) => wrangler.includes(m)),
    false,
  );

  // --- 4. Les dépendances déclarées -----------------------------------------
  const pkg = JSON.parse(read("package.json")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  const declared = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)];
  t.check(
    "aucun paquet @lovable.dev/ déclaré",
    declared.filter((name) => name.startsWith("@lovable.dev/")),
    [],
  );

  // --- 5. Le verrou de dépendances ------------------------------------------
  // Le lockfile épinglait les téléchargements sur le cache npm privé de
  // Lovable : le dépôt ne pouvait donc pas s'installer ailleurs, même sans
  // aucun paquet Lovable déclaré. C'était la dépendance la plus discrète.
  const lock = read("bun.lock");
  for (const marker of ["lovable-core-prod", "@lovable.dev/"]) {
    t.check(`bun.lock ne référence pas « ${marker} »`, lock.includes(marker), false);
  }

  // --- 6. La chaîne de build ------------------------------------------------
  const vite = read("vite.config.ts");
  t.check("vite.config.ts n'importe aucun paquet Lovable", /@lovable\.dev\//.test(vite), false);
  t.check("vite.config.ts déclare lui-même tanstackStart", vite.includes("tanstackStart("), true);
  t.check("vite.config.ts déclare lui-même nitro", vite.includes("nitro("), true);

  // --- 7. Le déploiement ne dépend plus d'une synchronisation externe -------
  const deploy = read(".github/workflows/deploy.yml");
  t.check("un workflow de déploiement existe", deploy.length > 0, true);
  t.check("le déploiement passe par wrangler", /wrangler/.test(deploy), true);
});
