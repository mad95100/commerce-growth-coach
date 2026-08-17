import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineSuite } from "../harness";

/**
 * LE TYPE DIT UNE COLONNE, LA MIGRATION NE LA CRÉE PAS.
 *
 * CE QUI EST VÉRIFIÉ AILLEURS, ET CE QUI NE L'ÉTAIT PAS. Le déploiement compare
 * l'historique local à celui de la base — `supabase migration list`, puis
 * `db push`. Cette comparaison porte sur des NOMS DE FICHIERS : elle affirme que
 * les mêmes migrations ont été jouées de part et d'autre, et rien de plus. Elle
 * ne dit rien de ce que le CODE croit trouver dans ces tables.
 *
 * OR C'EST PAR LÀ QUE LE SCHÉMA SE DÉSACCORDE. `types.ts` est un fichier
 * ENGENDRÉ : on le régénère depuis une base, et si cette base est celle d'un
 * développement où une colonne a été ajoutée à la main, le type entre dans le
 * dépôt sans la migration qui va avec. Rien ne s'y oppose : TypeScript compile —
 * le type existe —, la CI passe — elle ne lit pas le SQL —, le déploiement est
 * vert — les migrations concordent entre elles. Le désaccord n'apparaît qu'à
 * l'exécution, sur la première écriture, chez le marchand.
 *
 * ET IL APPARAÎT AU PIRE MOMENT. PostgREST refuse la ligne entière quand une
 * colonne lui est inconnue : ce n'est pas un champ perdu, c'est l'écriture qui
 * n'a pas lieu. Un audit qui vient de consommer son quota et soixante secondes
 * de modèle perd sa conclusion au moment de l'enregistrer. Le journal du
 * déploiement, lui, reste vert d'un bout à l'autre.
 *
 * CE QUE CE CONTRÔLE NE PEUT PAS FAIRE. Il lit le SQL du dépôt, pas la base. Si
 * quelqu'un ajoute une colonne à la main EN PRODUCTION sans migration, les deux
 * sources lues ici s'accordent toujours et le contrôle reste vert. Ce qu'il
 * ferme, c'est le chemin par lequel le désaccord entre RÉELLEMENT dans le dépôt.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const DIR = join(ROOT, "supabase/migrations");

/** `"public"."audits"` et `public.audits` désignent la même table. */
const nettoie = (nom: string) => nom.replace(/"/g, "").replace(/^public\./, "");

/**
 * Les colonnes que les migrations créent réellement, table par table.
 *
 * LES COMMENTAIRES SONT RETIRÉS D'ABORD. Ce dépôt documente ses migrations
 * abondamment, y compris ENTRE `ALTER TABLE` et son `ADD COLUMN`. Une première
 * version lisait le SQL commentaires compris et déclarait introuvables des
 * colonnes qui étaient là — trente accusations, toutes fausses.
 */
function colonnesDesMigrations(): Map<string, Set<string>> {
  const sql = readdirSync(DIR)
    .filter((n) => n.endsWith(".sql"))
    .sort()
    .map((n) => readFileSync(join(DIR, n), "utf8"))
    .join("\n;\n")
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  const tables = new Map<string, Set<string>>();
  const ajoute = (table: string, colonne: string) => {
    if (!tables.has(table)) tables.set(table, new Set());
    tables.get(table)!.add(colonne);
  };

  // CREATE TABLE : le corps se délimite en comptant les parenthèses, un type
  // comme `numeric(10, 2)` en contenant lui-même.
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)\s*\(/gi)) {
    const table = nettoie(m[1]!);
    if (!tables.has(table)) tables.set(table, new Set());
    let i = m.index! + m[0].length;
    let profondeur = 1;
    let corps = "";
    while (i < sql.length && profondeur > 0) {
      const c = sql[i]!;
      if (c === "(") profondeur++;
      else if (c === ")") profondeur--;
      if (profondeur > 0) corps += c;
      i++;
    }
    for (const déclaration of corps.split(/,(?![^(]*\))/)) {
      const d = déclaration.trim();
      if (!d || /^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK|EXCLUDE|LIKE)\b/i.test(d)) continue;
      const nom = /^([\w"]+)/.exec(d)?.[1];
      if (nom) ajoute(table, nettoie(nom));
    }
  }

  // ALTER TABLE pris dans son ENTIER, jusqu'au point-virgule : une seule
  // instruction porte souvent plusieurs `ADD COLUMN` séparés par des virgules,
  // et n'en lire que le premier fait manquer tous les suivants.
  for (const m of sql.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w."]+)([\s\S]*?);/gi)) {
    const table = nettoie(m[1]!);
    for (const a of m[2]!.matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w"]+)/gi)) {
      ajoute(table, nettoie(a[1]!));
    }
    for (const d of m[2]!.matchAll(/DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?([\w"]+)/gi)) {
      tables.get(table)?.delete(nettoie(d[1]!));
    }
  }

  return tables;
}

/** Les colonnes que `types.ts` déclare, lues dans les blocs `Row`. */
function colonnesDesTypes(): Map<string, Set<string>> {
  const ts = readFileSync(join(ROOT, "src/integrations/supabase/types.ts"), "utf8");
  const tables = new Map<string, Set<string>>();
  for (const m of ts.matchAll(/(\w+):\s*\{\s*Row:\s*\{([\s\S]*?)\n {8}\}/g)) {
    const colonnes = new Set<string>();
    for (const c of m[2]!.matchAll(/^\s{10}(\w+)\??:/gm)) colonnes.add(c[1]!);
    tables.set(m[1]!, colonnes);
  }
  return tables;
}

export default defineSuite("Infrastructure — le schéma promis est le schéma créé", (t) => {
  const sql = colonnesDesMigrations();
  const types = colonnesDesTypes();

  // GARDE-FOU DU RELEVÉ, ET IL EST INDISPENSABLE ICI. Les deux lectures sont
  // des analyses de texte : une expression régulière qui cesse de reconnaître
  // sa cible ne lève rien, elle renvoie du vide — et une comparaison de deux
  // ensembles vides est verte. Sans ces trois lignes, ce contrôle pourrait ne
  // plus rien lire pendant des mois en affichant « conforme ».
  t.check("des tables sont lues dans les migrations", sql.size >= 15, true);
  t.check("des tables sont lues dans les types", types.size >= 15, true);
  t.check("les colonnes des audits sont bien relevées", (sql.get("audits")?.size ?? 0) >= 10, true);

  // LE CONTRÔLE. Chaque table, chaque colonne que le code croit pouvoir lire ou
  // écrire doit avoir une migration qui la crée.
  for (const [table, colonnes] of types) {
    const créées = sql.get(table);
    t.check(`la table « ${table} » est créée par une migration`, Boolean(créées), true);
    if (!créées) continue;
    for (const colonne of colonnes) {
      t.check(`${table}.${colonne} est créée par une migration`, créées.has(colonne), true);
    }
  }

  // L'AUTRE SENS, ET IL NE S'ANNONCE PAS PAREIL. Une table créée en base mais
  // absente de `types.ts` ne casse rien à l'exécution : le code ne peut
  // simplement pas s'en servir. Ce n'est donc pas une faute, mais le signe que
  // les types n'ont pas été régénérés depuis la dernière migration — et le
  // moment où on l'apprend décide de ce qu'il en coûte.
  const oubliées = [...sql.keys()].filter((table) => !types.has(table));
  t.check("aucune table créée n'est absente des types", oubliées, []);
});
