import { readFileSync, readdirSync } from "node:fs";
import { defineSuite } from "../harness";
import { classifyAuditFailure, explainAuditFailure } from "../../src/lib/audit-errors";

/**
 * LA BOUCLE « CONNECTEZ SHOPIFY » APRÈS UN OAUTH RÉUSSI.
 *
 * SIGNALÉ EN PRODUCTION, SUR LA BOUTIQUE DE TEST. Le marchand clique
 * « Connecter Shopify », Shopify affiche « votre boutique est reliée », il
 * revient dans l'application — et l'écran lui redemande de connecter Shopify.
 * Indéfiniment.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA CHAÎNE, TRACÉE DE BOUT EN BOUT.
 *
 * L'autorisation réussit. Le code est échangé. Le jeton est chiffré et écrit
 * dans `data_connections` avec `supabaseAdmin` — le rôle de service — sur
 * `(store_id, provider)`. Le rattachement au marchand est porté par
 * `stores.owner_id`, et l'état signé du parcours OAuth transporte le `storeId` :
 * rien n'est cassé de ce côté.
 *
 * LE DÉFAUT EST À LA LECTURE, ET NULLE PART AILLEURS. Le durcissement RLS du
 * 14/08 a révoqué tous les droits sur `data_connections` puis les a redonnés
 * COLONNE PAR COLONNE, pour tenir les deux colonnes de jetons hors de portée du
 * navigateur. L'énumération a omis `metadata` — qui n'est pas un jeton.
 *
 * Or le panneau des sources lit `metadata` (il en tire la liste des comptes
 * publicitaires à faire choisir). PostgreSQL refuse la requête ENTIÈRE dès
 * qu'une colonne demandée n'est pas accordée : 42501. La lecture ne rend pas une
 * ligne incomplète, elle ne rend RIEN.
 *
 * ET LE SILENCE A FAIT LE RESTE. Le panneau écrivait `connsQ.data ?? []` : une
 * lecture refusée devenait un tableau vide, indiscernable de « aucune connexion
 * ». Le marchand se voyait donc proposer de refaire ce qu'il venait de réussir,
 * sans qu'aucun écran ne mentionne le moindre échec.
 *
 * POURQUOI L'AUDIT, LUI, TOURNAIT. `loadChannelCredentials` lit avec
 * `supabaseAdmin`, qui ignore RLS et les droits de colonne. Le moteur voyait la
 * connexion et disposait du jeton. Seul le navigateur était aveugle — ce qui
 * explique qu'un audit ait pu être lancé, atteindre le fournisseur d'analyse et
 * échouer là-bas, pendant que l'écran affichait « non connecté ».
 *
 * Les deux symptômes n'avaient donc PAS la même cause, et les traiter ensemble
 * aurait conduit à corriger le mauvais bout.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const lire = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");
const sansCommentaires = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

/** Toutes les migrations, concaténées dans l'ordre où elles s'appliquent. */
function migrations(): string {
  return readdirSync(`${ROOT}supabase/migrations`)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(`${ROOT}supabase/migrations/${f}`, "utf8"))
    .join("\n");
}

/** Colonnes de `data_connections` réellement lisibles par `authenticated`. */
function colonnesLisibles(sql: string): Set<string> {
  const lisibles = new Set<string>();
  const motif = /GRANT SELECT\s*\(([^)]*)\)\s*ON\s+public\.data_connections\s+TO\s+authenticated/gi;
  for (const m of sql.matchAll(motif)) {
    for (const c of m[1].split(",")) {
      const nom = c.trim().replace(/--.*$/gm, "").trim();
      if (nom) lisibles.add(nom);
    }
  }
  return lisibles;
}

/** Colonnes que le navigateur demande dans son `.select(...)`. */
function colonnesDemandees(source: string): string[] {
  const m = /\.from\("data_connections"\)\s*\.select\("([^"]+)"\)/.exec(source);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

export default defineSuite("Shopify connecté — la chaîne, de l'OAuth au diagnostic", (t) => {
  const sql = migrations();
  const panneau = sansCommentaires(lire("src/components/ConnectionsPanel.tsx"));

  // =========================================================================
  // 1. LA CAUSE RACINE : chaque colonne lue doit être accordée
  // =========================================================================
  const lisibles = colonnesLisibles(sql);
  const demandees = colonnesDemandees(panneau);

  t.check("le panneau lit bien `data_connections`", demandees.length >= 5, true);
  t.check("des droits de colonne sont bien accordés", lisibles.size >= 10, true);

  // LE CONTRÔLE QUI AURAIT ÉVITÉ LA PANNE. Il confronte ce que le navigateur
  // DEMANDE à ce que la base lui ACCORDE. Toute colonne ajoutée au `select`
  // sans être ajoutée au `GRANT` fera échouer ici — avant la production.
  for (const colonne of demandees) {
    t.check(`la colonne « ${colonne} » est lisible par le navigateur`, lisibles.has(colonne), true);
  }

  // ET LES JETONS RESTENT HORS DE PORTÉE. C'est ce que le durcissement voulait
  // protéger, et l'ajout de `metadata` ne doit pas l'avoir desserré.
  for (const secret of ["access_token_ciphertext", "refresh_token_ciphertext"]) {
    t.check(`« ${secret} » n'est jamais lisible par le navigateur`, lisibles.has(secret), false);
    t.check(`…et le panneau ne le demande pas`, demandees.includes(secret), false);
  }

  // =========================================================================
  // 2. LE SILENCE : une lecture refusée ne vaut pas « aucune connexion »
  // =========================================================================
  t.check("l'échec de lecture est traité", /connsQ\.isError/.test(panneau), true);
  t.check(
    "…par un écran d'échec, pas par une liste vide",
    /if \(connsQ\.isError\)[\s\S]{0,200}<ErrorState/.test(panneau),
    true,
  );
  // LA PHRASE COMPTE AUTANT QUE LA BRANCHE : le marchand doit apprendre que sa
  // connexion tient toujours, sans quoi il ira la refaire de lui-même.
  t.check(
    "il est dit que la connexion n'est pas perdue",
    /la connexion tient toujours/.test(panneau),
    true,
  );

  // =========================================================================
  // 3. LE CHEMIN D'ÉCRITURE, INCHANGÉ ET VÉRIFIÉ
  // =========================================================================
  const retour = sansCommentaires(lire("src/routes/api/public/oauth/shopify/callback.ts"));
  t.check("le jeton est chiffré avant d'être écrit", /encryptToken\(/.test(retour), true);
  t.check(
    "l'écriture passe par le rôle de service",
    /supabaseAdmin[\s\S]{0,80}data_connections/.test(retour),
    true,
  );
  t.check(
    "elle est idempotente sur (boutique, fournisseur)",
    /onConflict: "store_id,provider"/.test(retour),
    true,
  );
  t.check("la connexion est marquée active", /status: "active"/.test(retour), true);
  // LE RATTACHEMENT AU MARCHAND vient de l'état SIGNÉ du parcours, pas d'un
  // paramètre d'adresse : c'est ce qui interdit d'écrire dans la boutique
  // d'autrui.
  t.check("la boutique vient de l'état signé", /payload\.storeId/.test(retour), true);
  t.check("l'état est vérifié avant usage", /verifyOAuthState/.test(retour), true);

  // =========================================================================
  // 4. LE MOTEUR VOIT LA CONNEXION MÊME QUAND LE NAVIGATEUR NE LA VOIT PAS
  // =========================================================================
  // C'est ce qui explique qu'un audit ait pu tourner pendant que l'écran
  // affichait « non connecté ». Le vérifier fige la distinction entre les deux
  // symptômes, pour qu'on ne cherche plus la cause du second dans le premier.
  const creds = sansCommentaires(lire("src/lib/tracking.server.ts"));
  t.check(
    "les identifiants sont lus par le rôle de service",
    /supabaseAdmin[\s\S]{0,120}data_connections/.test(creds),
    true,
  );
  // Mais l'appartenance est vérifiée AVANT, avec le client de l'appelant :
  // le rôle de service ne doit jamais servir à contourner la propriété.
  t.check(
    "…après une vérification d'appartenance sous RLS",
    /supabase[\s\S]{0,120}\.from\("stores"\)[\s\S]{0,200}if \(!owned\) return \{\};/.test(creds),
    true,
  );

  // =========================================================================
  // 5. L'ÉCHEC D'AUDIT N'EST PLUS ATTRIBUÉ AU HASARD
  // =========================================================================
  /*
    LES DEUX MÉPRISES, REPRODUITES ICI DANS LES DEUX SENS.

    Le message d'échec contient le CORPS BRUT du fournisseur —
    `AI Gateway ${status}: ${errText}` — et l'ancien classement cherchait des
    fragments sans jamais se demander d'où ils venaient.
  */
  // Notre clé refusée par le fournisseur disait au marchand de reconnecter sa
  // boutique Shopify. On l'envoyait défaire une connexion saine — exactement la
  // boucle dont il venait de sortir.
  t.check(
    "un 401 du fournisseur n'accuse plus Shopify",
    classifyAuditFailure('AI Gateway 401: {"error":"invalid api key"}'),
    "configuration_ia",
  );
  t.check(
    "un 403 du fournisseur non plus",
    classifyAuditFailure("AI Gateway 403: forbidden"),
    "configuration_ia",
  );
  // Et l'inverse : une panne Shopify était imputée au fournisseur d'analyse.
  t.check(
    "un 503 de Shopify n'accuse plus le fournisseur d'analyse",
    classifyAuditFailure("Shopify 503 Service Unavailable"),
    "shopify_injoignable",
  );
  t.check(
    "un « unauthorized » sans Shopify nommé ne conclut pas à un jeton expiré",
    classifyAuditFailure("unauthorized") === "shopify_expire",
    false,
  );

  // SATURATION ET PANNE SONT DEUX CHOSES.
  t.check(
    "429 reste une saturation",
    classifyAuditFailure("AI Gateway 429: overloaded"),
    "modele_surcharge",
  );
  t.check(
    "500 est une panne du fournisseur",
    classifyAuditFailure("AI Gateway 500: internal"),
    "modele_en_panne",
  );
  t.check(
    "la saturation seule invite à réessayer vite",
    /dizaine de minutes/.test(explainAuditFailure("AI Gateway 429: overloaded").next),
    true,
  );
  t.check(
    "la panne, elle, ne le fait pas",
    /dizaine de minutes/.test(explainAuditFailure("AI Gateway 500: internal").next),
    false,
  );

  // NOTRE CONFIGURATION EST DITE NÔTRE, et surtout : elle ne renvoie pas le
  // marchand vers sa boutique.
  const conf = explainAuditFailure("Configuration IA absente : renseignez AI_BASE_URL");
  t.check("une configuration absente est imputée à nous", conf.whose, "nous");
  t.check(
    "…et dissuade explicitement de reconnecter la boutique",
    /surtout pas de reconnecter/.test(conf.next),
    true,
  );
  // Et elle ne nomme aucun secret au marchand, comme partout ailleurs.
  t.check(
    "aucun nom de secret n'atteint le marchand",
    /AI_BASE_URL|AI_API_KEY/.test(`${conf.what} ${conf.next}`),
    false,
  );

  // =========================================================================
  // 6. UNE ERREUR N'EN MASQUE PLUS UNE AUTRE
  // =========================================================================
  /*
    LE CHEMIN COMPLET DU MASQUAGE, ET SES TROIS MAILLONS.

    Un seul `try` couvrait les trois sources : Shopify qui expire, et Meta comme
    Google n'étaient même pas tentés. L'échec n'allait qu'au journal. Et
    `data_gaps` n'était écrit que dans la mise à jour de SUCCÈS — donc perdu
    précisément quand l'audit échouait ensuite.

    Résultat : le marchand dont le jeton Shopify venait d'expirer lisait, en
    tout et pour tout, « notre fournisseur d'analyse était saturé ».
  */
  const runner = sansCommentaires(lire("src/lib/audit-runner.server.ts"));
  for (const source of ["Shopify", "Meta", "Google"]) {
    t.check(
      `la collecte ${source} est rattrapée séparément`,
      new RegExp(`collecte ${source} impossible`).test(runner),
      true,
    );
  }
  t.check(
    "un échec de collecte devient un rapport injoignable",
    (runner.match(/reachable: false/g) ?? []).length >= 4,
    true,
  );
  // LE POINT D'ÉCRITURE EST CE QUI FAIT TOUT : avant l'appel au fournisseur, la
  // trace survit à son échec ; après, elle disparaît avec lui.
  const iManques = runner.indexOf("data_gaps: allGaps(reports)");
  const iModele = runner.indexOf("AI Gateway");
  t.check("les manques sont enregistrés", iManques > -1, true);
  t.check("…avant l'appel au fournisseur", iManques < iModele, true);

  const rapport = sansCommentaires(lire("src/routes/_authenticated/audits.$auditId.tsx"));
  t.check(
    "l'écran d'échec montre ce qui n'avait déjà pas pu être lu",
    /Ce que nous n'avions déjà pas pu lire/.test(rapport),
    true,
  );
  t.check("…et dit dans quel ordre corriger", /corrigez-les d'abord/.test(rapport), true);
  // La colonne est du JSON : une entrée à moitié écrite ne doit pas s'afficher.
  t.check(
    "les manques illisibles sont écartés, pas rendus",
    /label && reason && id \? \[\{ id, label, reason \}\] : \[\]/.test(rapport),
    true,
  );

  // L'ABSENCE DE SOURCE EST UN ÉTAT, PAS UNE PANNE.
  const vide = explainAuditFailure("Aucune source de données connectée pour cette boutique");
  t.check("l'absence de source a son propre verdict", vide.kind, "donnees_absentes");
  t.check("…et elle oriente vers la bonne action", /Connectez Shopify/.test(vide.next), true);
});
