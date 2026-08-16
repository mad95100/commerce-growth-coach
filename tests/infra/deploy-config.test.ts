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
  // Sans guillemets : passée par une variable, `--env=""` arriverait à
  // wrangler avec ses guillemets et désignerait un environnement inexistant.
  // Le contrôle porte sur les lignes de code seules — les commentaires du
  // workflow citent délibérément la forme fautive pour l'expliquer.
  const deployCode = deploy
    .split("\n")
    .filter((ligne) => !/^\s*#/.test(ligne))
    .join("\n");
  t.check("l'environnement ciblé est explicite", /'--env='/.test(deployCode), true);
  t.check("l'environnement ciblé ne porte pas de guillemets", /--env=""/.test(deployCode), false);
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
  // --- Génération automatique des secrets sans valeur imposée --------------
  // Trois secrets n'ont pas de valeur « juste » : seule leur stabilité compte.
  // Les faire attendre une saisie humaine immobilise le déploiement pour rien.
  t.check(
    "les secrets générables le sont automatiquement",
    /openssl rand -base64 32/.test(deploy),
    true,
  );
  // LA règle qui protège les jetons partenaires : sans elle, chaque
  // déploiement ferait tourner la clé de chiffrement et rendrait illisibles
  // les jetons de la veille.
  t.check(
    "un secret déjà posé sur le Worker n'est jamais régénéré",
    /wrangler secret list/.test(deploy) && /laissé intact/.test(deploy),
    true,
  );
  // Une clé retrouvée doit pouvoir être réinjectée et l'emporter.
  t.check("une valeur fournie dans le dépôt reste prioritaire", /prioritaire/.test(deploy), true);
  t.check(
    "la clé de chiffrement fait partie des secrets générables",
    /for nom in OAUTH_STATE_SECRET JOBS_TICK_SECRET DATA_CONNECTIONS_ENCRYPTION_KEY/.test(deploy),
    true,
  );
  // --- « Déployé » n'est pas « fonctionne » ---------------------------------
  // Un worker publié sans clé de service se déploie en vert et échoue à la
  // première requête. L'avertissement seul ne protégeait personne : il faut que
  // le déploiement échoue. Le contrôle porte sur le code du workflow, pas sur
  // ses commentaires, qui citent délibérément le cas fautif pour l'expliquer.
  t.check(
    "la configuration d'exécution du Worker est vérifiée après déploiement",
    /wrangler secret list \$WRANGLER_ENV --format json/.test(deployCode),
    true,
  );
  t.check(
    "un secret vital absent fait échouer le déploiement",
    /ne peut pas fonctionner — secrets absents[\s\S]{0,300}exit 1/.test(deployCode),
    true,
  );
  for (const vital of [
    "SUPABASE_SERVICE_ROLE_KEY",
    "DATA_CONNECTIONS_ENCRYPTION_KEY",
    "OAUTH_STATE_SECRET",
  ]) {
    t.check(
      `${vital} fait partie des secrets dont l'absence est bloquante`,
      new RegExp(`for nom in [^\\n]*${vital}[^\\n]*; do\\n[^\\n]*grep -qx`).test(deployCode),
      true,
    );
  }
  // Les noms suffisent : lire une valeur pour la vérifier la ferait transiter
  // par les journaux du runner.
  t.check(
    "la vérification ne lit aucune valeur de secret",
    /secret\s+list[^\n]*--format\s+json[^\n]*\|\s*jq -r '\.\[\]\.name'/.test(deployCode),
    true,
  );

  // Second niveau : ils n'empêchent pas le worker de démarrer, mais sans eux
  // aucune boutique ne peut être connectée et aucun audit produit. Nommés, pas
  // bloquants — déployer la seule interface reste légitime.
  for (const produit of ["SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET", "AI_API_KEY"]) {
    t.check(
      `${produit} manquant est signalé sans faire échouer le déploiement`,
      new RegExp(`for nom in [^\\n]*${produit}[^\\n]*; do\\n[^\\n]*absents_produit`).test(
        deployCode,
      ),
      true,
    );
  }
  t.check(
    "le piège des variables « Texte » effacées au déploiement est nommé",
    /le déploiement suivant les efface/.test(deployCode),
    true,
  );

  // --- Les modèles configurés sont éprouvés, pas supposés -------------------
  // Un modèle peut disparaître du catalogue d'un fournisseur sans que rien ne
  // change chez nous. Et il peut FIGURER au catalogue tout en étant refusé à
  // l'appel : c'est exactement ce qui est arrivé à gemini-2.5-pro. Seul un
  // appel réel prouve quelque chose.
  t.check(
    "les modèles configurés sont appelés pour de vrai",
    /chat\/completions"/.test(deployCode) && /AI_AUDIT_MODEL/.test(deployCode),
    true,
  );
  // Disponible n'est pas compatible : l'audit force un appel d'outil, la sonde
  // doit vérifier que le modèle l'honore.
  t.check(
    "la sonde vérifie que l'appel d'outil forcé est honoré",
    /tool_choice/.test(deployCode) && /tool_calls\[0\]\.function\.name/.test(deployCode),
    true,
  );
  // Un 404 est définitif, un 503 est l'humeur du fournisseur. Confondre les
  // deux fait dépendre nos livraisons de la charge de Google.
  t.check(
    "une surcharge passagère est réessayée puis signalée sans bloquer",
    /429\|5\*\|000\)/.test(deployCode) &&
      /fournisseur indisponible, configuration non mise en cause/.test(deployCode),
    true,
  );
  t.check(
    "un modèle définitivement refusé fait échouer le déploiement",
    /Modèle\(s\) inutilisable\(s\)[\s\S]{0,120}exit 1/.test(deployCode),
    true,
  );
  // La clé part dans un en-tête, jamais sur la ligne de commande.
  t.check(
    "la clé du modèle ne transite jamais par un paramètre d'URL",
    /[?&]key=\$AI_API_KEY/.test(deployCode),
    false,
  );

  // --- Le parcours de connexion est sondé, en lecture seule -----------------
  // La liste des secrets prouve qu'ils sont POSÉS ; elle ne prouve pas qu'ils
  // arrivent jusqu'au code. Le callback OAuth s'arrête à la vérification de
  // signature, avant tout échange de jeton et toute écriture : une signature
  // fausse y est donc une sonde sans effet.
  t.check(
    "le parcours de connexion Shopify est sondé après déploiement",
    /oauth\/shopify\/callback\?code=sonde/.test(deployCode),
    true,
  );
  t.check(
    "la sonde ne peut rien écrire : elle porte une signature volontairement fausse",
    /hmac=0000/.test(deployCode),
    true,
  );
  t.check(
    "une signature refusée est le résultat attendu, pas une erreur",
    /401\)/.test(deployCode),
    true,
  );
  t.check(
    "des identifiants Shopify illisibles à l'exécution font échouer le déploiement",
    /500\)[\s\S]{0,300}exit 1/.test(deployCode),
    true,
  );
  // Un `redirect_uri` bâti sur un domaine qui ne répond pas rend toute
  // connexion impossible, alors même que le worker est joignable : le marchand
  // part chez Shopify et revient sur un hôte inexistant.
  t.check(
    "la joignabilité de l'origine des redirect_uri est vérifiée",
    /Origine des redirect_uri OAuth/.test(deployCode) && /grep -m1 '\^APP_URL'/.test(deployCode),
    true,
  );
  t.check(
    "une origine OAuth injoignable est signalée avec les deux gestes à faire",
    /les redirect_uri OAuth pointent vers un hôte injoignable/.test(deployCode) &&
      /déclarer \$origine\/api\/public\/oauth\/shopify\/callback dans l'app Shopify/.test(
        deployCode,
      ),
    true,
  );

  // `curl -w '%{http_code}'` écrit déjà « 000 » sur échec de connexion : un
  // `|| echo 000` en ajoutait un second et le journal annonçait « HTTP 000000 »,
  // un code sur lequel aucun `case` ne peut se prononcer.
  t.check(
    "aucun code de statut n'est concaténé au code réel de curl",
    /-w '%\{http_code\}'[^\n]*\|\| echo 000/.test(deployCode),
    false,
  );
  t.check(
    "le repli sur 000 ne s'applique que si curl n'a rien écrit",
    (deployCode.match(/\[ -n "\$code" \] \|\| code=000/g) ?? []).length >= 3,
    true,
  );

  // --- Le contrôle de démarrage s'exécute vraiment --------------------------
  // Sauté en silence, il donnait un déploiement vert sur un worker que
  // personne ne pouvait ouvrir. À défaut d'adresse configurée, celle que
  // wrangler vient de publier.
  t.check(
    "l'adresse publiée par wrangler est retenue",
    /grep -oE 'https:\/\/\[A-Za-z0-9\.-\]\+\\\.workers\\\.dev'/.test(deployCode) &&
      /echo "url=\$url" >> "\$GITHUB_OUTPUT"/.test(deployCode),
    true,
  );
  // L'accueil peut répondre pendant que la page de connexion échoue au rendu :
  // ce sont deux routes distinctes, et c'est la seconde qui conditionne
  // l'entrée dans le produit.
  t.check(
    "la page de connexion est contrôlée autant que l'accueil",
    /for chemin in "\/" "\/auth"; do/.test(deployCode),
    true,
  );
  t.check(
    "une seule des deux pages injoignable fait échouer le déploiement",
    /if \[ -n "\$echec" \][\s\S]{0,220}exit 1/.test(deployCode),
    true,
  );
  t.check(
    "le contrôle de démarrage se rabat sur l'adresse publiée",
    /TARGET:\s*\$\{\{\s*vars\.DEPLOY_HEALTHCHECK_URL\s*\|\|\s*steps\.deploiement\.outputs\.url\s*\}\}/.test(
      deploy,
    ),
    true,
  );
  // Sans `pipefail`, `tee` renverrait zéro et masquerait un déploiement raté.
  t.check(
    "la sortie de wrangler passe par un tube sans masquer son échec",
    /set -o pipefail[\s\S]{0,200}wrangler deploy \$WRANGLER_ENV 2>&1 \| tee/.test(deployCode),
    true,
  );
  // Une absence d'adresse n'est plus une note discrète : elle décrit ce qui
  // manque et ce qu'il faut faire.
  t.check(
    "l'absence d'adresse à contrôler est un avertissement, pas une note",
    /::warning::Aucune adresse à contrôler/.test(deployCode) &&
      /DEPLOY_HEALTHCHECK_URL non renseignée, contrôle sauté/.test(deployCode) === false,
    true,
  );

  // La procédure de reprise doit exister avant d'en avoir besoin.
  const reconnexion = read("docs/reconnexion-shopify.md");
  t.check("la procédure de reconnexion est documentée", reconnexion.length > 0, true);
  for (const interdit of ["delete from", "drop table", "truncate"]) {
    t.check(
      `la procédure ne contient pas « ${interdit} »`,
      new RegExp(interdit, "i").test(reconnexion),
      false,
    );
  }
  t.check(
    "la procédure marque la connexion au lieu de la supprimer",
    /set status = 'expired'/.test(reconnexion),
    true,
  );

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
