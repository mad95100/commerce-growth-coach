import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { defineSuite } from "../harness";

/**
 * Cohérence de la configuration de déploiement.
 *
 * POURQUOI. Une erreur de configuration de déploiement ne se voit ni au typage,
 * ni au lint, ni dans les tests fonctionnels : elle se manifeste en production,
 * sur un worker qui ne démarre pas ou qui sert des pages blanches. Ces contrôles
 * portent donc sur les invariants qui lient entre eux `wrangler.toml`,
 * `vite.config.ts`, `package.json` et `.env.example` — les endroits où une
 * modification bien intentionnée casse silencieusement l'autre bout.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/**
 * Variables publiques, attendues EN CLAIR dans `wrangler.toml`.
 *
 * Les deux valeurs Supabase en font partie : l'URL du projet et la clé
 * « publishable » sont destinées au navigateur et déjà versionnées dans `.env`.
 * Sans elles côté serveur, le rendu échoue — le worker ne lit pas `.env`.
 */
const PUBLIC_VARS = ["APP_URL", "AI_BASE_URL", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"];

/**
 * Secrets, qui ne doivent JAMAIS apparaître dans un fichier versionné.
 * Ils sont seulement documentés, et provisionnés par `deploy.yml`.
 */
const REQUIRED_SECRETS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATA_CONNECTIONS_ENCRYPTION_KEY",
  "OAUTH_STATE_SECRET",
  "SHOPIFY_CLIENT_ID",
  "SHOPIFY_CLIENT_SECRET",
  "AI_API_KEY",
  "JOBS_TICK_SECRET",
];

export default defineSuite("Infrastructure — configuration de déploiement", (t) => {
  // --- wrangler.toml --------------------------------------------------------
  const wrangler = read("wrangler.toml");

  t.check("le worker est nommé", /^name\s*=\s*"[^"]+"/m.test(wrangler), true);
  t.check(
    "l'entrée pointe sur la sortie de build Nitro",
    /^main\s*=\s*"\.output\/server\/index\.mjs"/m.test(wrangler),
    true,
  );
  t.check(
    "nodejs_compat est activé",
    /compatibility_flags\s*=\s*\[[^\]]*"nodejs_compat"/.test(wrangler),
    true,
  );
  t.check(
    "les fichiers statiques sont servis depuis .output/public",
    /directory\s*=\s*"\.output\/public"/.test(wrangler),
    true,
  );
  t.check("un déclencheur planifié est déclaré", /\[triggers\]/.test(wrangler), true);
  t.check(
    "la cadence du cron est à la minute",
    /crons\s*=\s*\["\*\s+\*\s+\*\s+\*\s+\*"\]/.test(wrangler),
    true,
  );

  // Un secret dans un fichier versionné part dans l'historique du dépôt, d'où
  // on ne le retire plus. Ce contrôle double celui de la CI, au plus près.
  for (const name of REQUIRED_SECRETS) {
    t.check(
      `${name} n'a pas de valeur dans wrangler.toml`,
      new RegExp(`^\\s*${name}\\s*=\\s*"\\S`, "m").test(wrangler),
      false,
    );
  }

  // L'environnement de pré-production ne doit pas porter de cron : deux
  // ordonnanceurs sur la même base se disputeraient les mêmes audits.
  const previewSection = wrangler.slice(wrangler.indexOf("[env.preview]"));
  t.check(
    "l'environnement de pré-production n'a pas de cron",
    /\[env\.preview\.triggers\]/.test(previewSection),
    false,
  );

  // --- vite.config.ts -------------------------------------------------------
  const vite = read("vite.config.ts");
  t.check("le préréglage Nitro vise Cloudflare", /preset:\s*"cloudflare-module"/.test(vite), true);
  t.check(
    "le greffon du déclencheur planifié est enregistré",
    /plugins:\s*\["\.\/src\/nitro\/scheduled\.ts"\]/.test(vite),
    true,
  );
  t.check("la protection d'import serveur reste bloquante", /behavior:\s*"error"/.test(vite), true);
  t.check(
    "l'entrée serveur reste src/server.ts",
    /server:\s*\{\s*entry:\s*"server"\s*\}/.test(vite),
    true,
  );
  t.check(
    "nitro ne génère pas de configuration de déploiement concurrente",
    /deployConfig:\s*false/.test(vite),
    true,
  );

  // --- package.json ---------------------------------------------------------
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  for (const [name, expected] of [
    ["build", "vite build"],
    ["deploy", "wrangler deploy"],
    ["db:push", "supabase db push"],
  ] as const) {
    t.check(`le script ${name} est déclaré`, pkg.scripts[name], expected);
  }

  // --- Le greffon planifié --------------------------------------------------
  const scheduled = read("src/nitro/scheduled.ts");
  t.check(
    "le greffon écoute le crochet Cloudflare",
    scheduled.includes('"cloudflare:scheduled"'),
    true,
  );
  t.check("le greffon délègue au traitement commun", scheduled.includes("runJobsTick"), true);

  // --- Le déclencheur HTTP --------------------------------------------------
  const tick = read("src/routes/api/internal/jobs/tick.ts");
  t.check("le déclencheur HTTP exige un secret", tick.includes("JOBS_TICK_SECRET"), true);
  t.check("le secret est comparé en temps constant", tick.includes("timingSafeEqual"), true);
  t.check(
    "l'absence de secret refuse le service",
    /if\s*\(!expected\)[\s\S]{0,500}503/.test(tick),
    true,
  );

  // --- Les variables publiques sont bien renseignées ------------------------
  // Le worker ne lit pas `.env` : ce qui n'est pas ici n'existe pas à
  // l'exécution, et le rendu serveur échoue sans diagnostic évident.
  for (const name of PUBLIC_VARS) {
    t.check(
      `${name} a une valeur dans wrangler.toml`,
      new RegExp(`^${name}\\s*=\\s*"\\S`, "m").test(wrangler),
      true,
    );
  }

  // --- Le déploiement provisionne les secrets d'exécution -------------------
  const deploy = read(".github/workflows/deploy.yml");
  t.check(
    "le déploiement échoue tôt si le jeton Cloudflare manque",
    /Secret\(s\) absent\(s\) des secrets du dépôt GitHub/.test(deploy),
    true,
  );
  // L'identifiant de compte est facultatif : wrangler le déduit du jeton. En
  // faire un blocage immobiliserait le déploiement pour rien — c'est arrivé.
  t.check(
    "l'identifiant de compte absent ne bloque pas le déploiement",
    /CLOUDFLARE_ACCOUNT_ID non renseigné/.test(deploy),
    true,
  );
  // Exporter une variable vide fait échouer wrangler au lieu de le laisser
  // déduire le compte : elle doit être retirée de l'environnement.
  t.check(
    "un identifiant de compte vide est retiré de l'environnement",
    (deploy.match(/\[ -n "\$CLOUDFLARE_ACCOUNT_ID" \] \|\| unset CLOUDFLARE_ACCOUNT_ID/g) ?? [])
      .length >= 2,
    true,
  );
  t.check("l'environnement ciblé est explicite", /--env=""/.test(deploy), true);
  t.check(
    "les secrets d'exécution sont poussés sur le Worker",
    /wrangler secret bulk/.test(deploy),
    true,
  );
  for (const name of REQUIRED_SECRETS) {
    t.check(
      `${name} est provisionné par le déploiement`,
      new RegExp(`${name}:\\s*\\$\\{\\{\\s*secrets\\.${name}`).test(deploy),
      true,
    );
  }
  // Une valeur passée en argument de ligne de commande apparaîtrait dans la
  // liste des processus et dans les journaux du runner.
  t.check(
    "aucun secret n'est passé en argument à wrangler",
    /secret\s+put\s+\S+\s+--text/.test(deploy),
    false,
  );

  // --- Documentation des variables -----------------------------------------
  const envExample = read(".env.example");
  for (const name of REQUIRED_SECRETS) {
    t.check(`${name} est documentée dans .env.example`, envExample.includes(name), true);
  }
  t.check(
    ".env.example ne contient aucune valeur",
    /^[A-Z_]+=\S/m.test(envExample.replace(/^#.*$/gm, "")),
    false,
  );

  // --- Le .env versionné ne contient que du public --------------------------
  if (existsSync(join(ROOT, ".env"))) {
    const env = read(".env");
    for (const name of REQUIRED_SECRETS) {
      t.check(
        `${name} n'a pas de valeur dans le .env versionné`,
        new RegExp(`^\\s*(export\\s+)?${name}\\s*=\\s*\\S`, "m").test(env),
        false,
      );
    }
  }
});
