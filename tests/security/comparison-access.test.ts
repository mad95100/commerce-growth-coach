import { readFileSync } from "node:fs";
import { defineSuite } from "../harness";

/**
 * LA COMPARAISON NE DOIT PAS DEVENIR UNE FUITE.
 *
 * POURQUOI CETTE SUITE EXISTE. Comparer deux audits demande TROIS identifiants
 * fournis par le navigateur : une boutique et deux audits. C'est exactement la
 * forme d'appel qui fuit, parce qu'il est tentant de ne vérifier que le dernier
 * maillon — « ces deux audits existent-ils ? » — en oubliant que n'importe qui
 * peut envoyer les identifiants de n'importe qui.
 *
 * Le rôle de service contourne RLS : la vérification d'appartenance ne peut donc
 * pas être déléguée à la base. Elle doit être écrite, et elle doit être lue par
 * un test, sans quoi elle disparaîtra un jour dans une simplification.
 *
 * Cette suite lit le code. C'est le seul moyen : exécuter la fonction
 * demanderait une base et une session, et un test qui ne s'exécute jamais ne
 * protège rien.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");

export default defineSuite("Sécurité — isolation de la comparaison d'audits", (t) => {
  const src = read("src/lib/comparison.functions.ts");

  // --- 1. L'authentification est exigée -----------------------------------
  const middlewares = src.match(/\.middleware\(\[requireSupabaseAuth\]\)/g) ?? [];
  t.check("les deux fonctions exigent une session", middlewares.length, 2);
  t.check(
    "aucune fonction n'est exposée sans garde",
    (src.match(/createServerFn\(/g) ?? []).length,
    middlewares.length,
  );

  // --- 2. LA BOUTIQUE EST VÉRIFIÉE AVANT LES AUDITS -----------------------
  // C'est l'ordre qui compte. Vérifier seulement que les audits existent
  // laisserait comparer ceux de n'importe qui, à condition d'en connaître les
  // identifiants.
  const posProprietaire = src.indexOf("store.owner_id !== userId");
  const posAudits = src.indexOf('.from("audits")');
  t.check("l'appartenance de la boutique est vérifiée", posProprietaire > 0, true);
  t.check("elle est vérifiée AVANT de lire les audits", posProprietaire < posAudits, true);
  t.check(
    "les deux fonctions vérifient l'appartenance",
    (src.match(/owner_id !== userId/g) ?? []).length,
    2,
  );

  // --- 3. Les audits sont bornés à la boutique ----------------------------
  // Sans ce filtre, deux audits d'une AUTRE boutique du même utilisateur — ou
  // d'un autre utilisateur — seraient comparés sans que rien ne l'empêche.
  t.check(
    "la lecture des audits est filtrée sur la boutique",
    /\.from\("audits"\)[\s\S]{0,320}\.eq\("store_id", data\.storeId\)/.test(src),
    true,
  );
  t.check(
    "l'absence d'un des deux audits est refusée explicitement",
    /introuvable pour cette boutique/.test(src),
    true,
  );
  // Les constats se lisent par identifiant d'audit, et ces identifiants ont
  // été validés juste avant : la chaîne de confiance reste entière.
  t.check(
    "les constats sont lus sur les seuls audits validés",
    /\.from\("audit_findings"\)[\s\S]{0,220}\.in\("audit_id", \[before\.id, after\.id\]\)/.test(
      src,
    ),
    true,
  );

  // --- 4. Un audit inachevé ne se compare pas -----------------------------
  // Ce n'est pas une question de sécurité mais de vérité : comparer un audit
  // partiel à un audit complet produit un récit de dégradation massive alors
  // que rien n'a bougé.
  t.check(
    "un audit non terminé est refusé",
    /status !== "completed"/.test(src) && /ne s'est pas terminé/.test(src),
    true,
  );
  t.check(
    "la liste ne propose que des audits terminés",
    /\.eq\("status", "completed"\)/.test(src),
    true,
  );

  // --- 5. Les entrées sont validées ---------------------------------------
  // Trois identifiants venus du navigateur : aucun n'est utilisé sans être
  // reconnu comme un UUID, sinon ils partiraient tels quels dans une requête.
  t.check(
    "les trois identifiants sont validés",
    (src.match(/z\.string\(\)\.uuid\(\)/g) ?? []).length >= 4,
    true,
  );

  // --- 6. Un axe dont on ignore l'état n'est jamais compté comme mesuré ----
  // La lecture du `jsonb` est le point où une valeur absente pourrait devenir
  // `true` par inadvertance — et produire exactement les dégradations
  // imaginaires que le module de comparaison existe pour empêcher.
  t.check("l'état de mesure est lu strictement", /measured: a\.measured === true/.test(src), true);
  t.check(
    "un constat sans clé stable est ignoré",
    /if \(!f\.finding_key\) continue;/.test(src),
    true,
  );

  // --- 7. L'ordre chronologique est imposé par l'appelant ------------------
  // La fonction pure ne devine pas lequel est l'ancien — c'est délibéré — donc
  // quelqu'un doit le garantir. Deux audits comparés à l'envers racontent
  // exactement l'inverse de la vérité.
  t.check(
    "l'ordre est établi sur les dates avant comparaison",
    /createdAt <= apres\.createdAt/.test(src),
    true,
  );

  // --- 8. Le moteur écrit bien ce que la comparaison relit ----------------
  // Une comparaison qui lit des colonnes que personne n'écrit ne compare rien.
  const runner = read("src/lib/audit-runner.server.ts");
  t.check("les causes racines sont enregistrées", /root_causes: causes\.map/.test(runner), true);
  t.check(
    "les scores par axe sont enregistrés",
    /axis_scores: ruleReport\.axes\.map/.test(runner),
    true,
  );
  t.check(
    "l'état de mesure de chaque axe est enregistré",
    /measured: a\.measured/.test(runner),
    true,
  );
  // La migration doit exister, sinon l'écriture échouerait en production.
  const migration = read("supabase/migrations/20260817090000_audit_causes.sql");
  t.check(
    "la colonne des causes est créée",
    /ADD COLUMN IF NOT EXISTS root_causes jsonb/.test(migration),
    true,
  );
  t.check(
    "la colonne des scores par axe est créée",
    /ADD COLUMN IF NOT EXISTS axis_scores jsonb/.test(migration),
    true,
  );

  // --- 9. L'écran est réellement branché ----------------------------------
  const page = read("src/routes/_authenticated/stores.$storeId.tsx");
  t.check(
    "l'écran de comparaison est monté sur la page boutique",
    /<AuditComparison storeId=/.test(page),
    true,
  );
  const composant = read("src/components/AuditComparison.tsx");
  t.check("l'écran appelle la fonction serveur", /compareTwoAudits/.test(composant), true);
  // Les trois états d'une lecture distante : sans eux, un échec s'affiche comme
  // une absence de données.
  t.check("l'écran a un état de chargement", /isLoading/.test(composant), true);
  t.check(
    "l'écran a un état d'échec",
    /isError/.test(composant) && /ErrorState/.test(composant),
    true,
  );
  t.check(
    "un seul audit n'est pas présenté comme une erreur",
    /audits\.length < 2/.test(composant) && /Il faut deux audits/.test(composant),
    true,
  );
  // LE CHIFFRE NE DOIT JAMAIS S'AFFICHER QUAND LE MOTEUR A REFUSÉ DE LE
  // CALCULER : c'est la garantie que la réserve prend sa place.
  t.check(
    "le score ne s'affiche que s'il est comparable",
    /c\.scoreDelta !== null \?/.test(composant),
    true,
  );
  t.check("sinon la réserve est affichée", /c\.scoreCaveat/.test(composant), true);
  t.check(
    "les points perdus de vue sont expliqués à l'écran",
    /!x\.comparable && x\.before !== null && x\.after === null/.test(composant),
    true,
  );
});
