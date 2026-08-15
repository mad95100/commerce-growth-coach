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
 * Variables lues par le code serveur et qui doivent exister quelque part.
 * `AI_BASE_URL` et `APP_URL` sont dans `wrangler.toml` (publiques) ;
 * les autres sont des secrets, donc seulement documentées.
 */
const REQUIRED_SECRETS = [
  "SUPABASE_URL",
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
      if (name === "SUPABASE_URL") continue; // publique, légitimement présente
      t.check(
        `${name} n'a pas de valeur dans le .env versionné`,
        new RegExp(`^\\s*(export\\s+)?${name}\\s*=\\s*\\S`, "m").test(env),
        false,
      );
    }
  }
});
