import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineSuite } from "../harness";

/**
 * Cohérence de l'historique des migrations.
 *
 * POURQUOI CE TEST EXISTE. Un déploiement a été perdu sur un décalage d'UNE
 * SECONDE : le dépôt portait `20260728074838`, la base avait enregistré
 * `20260728074839`. `supabase db push` considérait donc la migration initiale
 * comme non appliquée et la rejouait — des `CREATE TYPE` sur un schéma déjà en
 * place, et le déploiement s'arrêtait là.
 *
 * Le décalage lui-même n'est pas vérifiable ici : il faudrait interroger la
 * base. Ce qui l'est, ce sont les propriétés qui rendent l'incident possible ou
 * lui donnent sa gravité — versions dupliquées, nommage non trié, et surtout
 * une migration récente non idempotente.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const DIR = join(ROOT, "supabase/migrations");

/** Horodatage en tête de nom de fichier, seule chose que Supabase compare. */
const VERSION = /^(\d{14})_/;

export default defineSuite("Infrastructure — historique des migrations", (t) => {
  const fichiers = readdirSync(DIR)
    .filter((n) => n.endsWith(".sql"))
    .sort();

  t.check("des migrations existent", fichiers.length > 0, true);

  const versions = fichiers.map((n) => VERSION.exec(n)?.[1] ?? null);

  t.check(
    "chaque migration porte un horodatage à 14 chiffres",
    versions.filter((v) => v === null),
    [],
  );

  // Deux fichiers de même version : Supabase n'en applique qu'un, l'autre est
  // silencieusement ignoré. C'est la panne la plus difficile à diagnostiquer.
  const doublons = versions.filter((v, i) => v !== null && versions.indexOf(v) !== i);
  t.check("aucune version dupliquée", doublons, []);

  // L'ordre alphabétique des noms doit être l'ordre chronologique d'application.
  const triees = [...versions].sort();
  t.check("les versions sont ordonnées", versions, triees);

  // La migration de durcissement doit rester rejouable sans dommage : elle sera
  // appliquée par la CI sur une base de production vivante.
  const durcissement = fichiers.find((n) => n.includes("rls_hardening"));
  t.check("la migration de durcissement RLS est présente", Boolean(durcissement), true);

  if (durcissement) {
    const sql = readFileSync(join(DIR, durcissement), "utf8");

    // `REVOKE` et `GRANT` sont idempotents par nature ; `CREATE POLICY` ne
    // l'est pas et doit donc être précédé d'un `DROP POLICY IF EXISTS`.
    const creations = (sql.match(/CREATE POLICY/gi) ?? []).length;
    const suppressions = (sql.match(/DROP POLICY IF EXISTS/gi) ?? []).length;
    t.check(
      "chaque politique créée est précédée d'une suppression conditionnelle",
      creations > 0 && suppressions >= creations,
      true,
    );

    // Une migration de privilèges ne doit ni détruire de table ni de donnée.
    for (const interdit of ["DROP TABLE", "TRUNCATE", "DELETE FROM"]) {
      t.check(
        `la migration ne contient pas « ${interdit} »`,
        new RegExp(interdit, "i").test(sql),
        false,
      );
    }

    // Ce que le durcissement doit réellement faire, vérifié sur le texte.
    t.check(
      "les colonnes de jetons sont retirées au rôle authenticated",
      /REVOKE\s+ALL\s+ON\s+public\.data_connections\s+FROM\s+authenticated/i.test(sql),
      true,
    );
    t.check(
      "la colonne du jeton chiffré n'est jamais re-accordée",
      /GRANT\s+SELECT\s*\([^)]*access_token_ciphertext/i.test(sql),
      false,
    );
  }

  // Le déploiement doit annoncer ce qu'il va appliquer avant de l'appliquer.
  const deploy = readFileSync(join(ROOT, ".github/workflows/deploy.yml"), "utf8");
  t.check(
    "le déploiement liste l'état des migrations",
    /supabase migration list/.test(deploy),
    true,
  );
  t.check("le déploiement annonce les migrations à venir", /db push --dry-run/.test(deploy), true);
  t.check(
    "les migrations sont appliquées après le déploiement",
    deploy.indexOf("Déployer sur Cloudflare Workers") <
      deploy.indexOf("Appliquer les migrations Supabase"),
    true,
  );
});
