import { readFileSync } from "node:fs";
import { defineSuite } from "../harness";

/**
 * « SOIT ENVIRON UNDEFINED EUR PAR MOIS. »
 *
 * CE QUE LE MARCHAND POUVAIT LIRE, mot pour mot, dans la phrase qui chiffre sa
 * perte sur le tableau de bord :
 *
 *     36 % seulement passent cette étape, contre 55 % habituellement —
 *     il en manque . Soit environ undefined EUR par mois.
 *
 * POURQUOI LA GARDE NE GARDAIT RIEN. Le code testait `costPerMonth !== null`,
 * et la valeur n'était pas `null` : elle était ABSENTE. `undefined !== null`
 * vaut `true`, donc la branche « on connaît le montant » était prise, avec un
 * montant qui n'existait pas.
 *
 * D'OÙ VIENT L'ABSENCE. L'entonnoir n'est pas calculé à l'affichage : il est
 * relu d'une COLONNE JSON, par un simple cast —
 * `audit.funnel as Funnel | null`, dans `cockpit.functions.ts`, sans aucune
 * validation. Le type est donc une déclaration d'intention sur ce que le moteur
 * écrit AUJOURD'HUI, pas une garantie sur ce que la base contient. Un audit
 * enregistré avant l'introduction de `costPerMonth` ne porte pas le champ, et
 * rien ne le signale : ni le compilateur, qui croit le cast, ni l'exécution,
 * qui rend `undefined` sans broncher.
 *
 * POURQUOI C'EST GRAVE ICI PLUS QU'AILLEURS. Tout l'argument du produit est de
 * n'avancer aucun chiffre qu'il ne peut pas justifier — le moteur refuse de
 * noter un axe non mesuré, le rapport masque son bloc de gain quand rien n'est
 * chiffrable, le cockpit distingue « potentiel nul » de « potentiel non
 * mesuré ». Afficher le mot `undefined` à la place d'un montant contredit tout
 * cela en un seul mot, et le contredit précisément là où l'on parle d'argent.
 *
 * LA PHRASE DE REPLI EXISTAIT DÉJÀ et dit exactement ce qu'il faut : « Cette
 * perte ne peut pas être chiffrée sans votre panier moyen. » Elle n'était
 * simplement jamais atteinte.
 *
 * CE QUI A ÉTÉ VÉRIFIÉ ET LAISSÉ INTACT. Les autres gardes `!== null` de
 * l'interface portent sur des valeurs CALCULÉES en TypeScript — `scoreDelta`
 * est assigné explicitement à `null` quand la comparaison n'a pas de sens — ou
 * servent de filtre, où `undefined` retombe déjà du bon côté. Elles n'ont pas
 * été touchées : une correction posée là où il n'y a pas de défaut ne fait
 * qu'ajouter du bruit.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const lire = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");

const sansCommentaires = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

export default defineSuite("Interface — aucune valeur absente ne s'affiche telle quelle", (t) => {
  const vue = sansCommentaires(lire("src/components/FunnelView.tsx"));
  const cockpit = sansCommentaires(lire("src/lib/cockpit.functions.ts"));

  // =========================================================================
  // 1. Le fait qui rend la garde nécessaire
  // =========================================================================
  // Si l'entonnoir cessait un jour d'être lu depuis une colonne JSON, ce
  // contrôle perdrait sa raison d'être — et il faut alors le savoir.
  t.check(
    "l'entonnoir est bien relu d'une colonne JSON par un cast",
    /audit\.funnel as Funnel \| null/.test(cockpit),
    true,
  );

  // =========================================================================
  // 2. La forme fautive est interdite
  // =========================================================================
  t.check(
    "le montant n'est plus testé par `!== null`",
    /leak\.costPerMonth !== null/.test(vue),
    false,
  );
  t.check(
    "il est testé par `== null`, qui couvre aussi l'absence",
    /leak\.costPerMonth != null/.test(vue),
    true,
  );
  t.check(
    "…et vérifié comme un nombre réel",
    /Number\.isFinite\(leak\.costPerMonth\)/.test(vue),
    true,
  );
  t.check(
    "le compte manquant est vérifié de la même façon",
    /Number\.isFinite\(leak\.missing\)/.test(vue),
    true,
  );

  // =========================================================================
  // 3. L'absence produit une phrase, pas un trou
  // =========================================================================
  // Le repli existait déjà : il n'était jamais atteint. Il doit rester.
  t.check(
    "la perte non chiffrable est annoncée comme telle",
    /Cette perte ne peut pas être chiffrée sans votre panier moyen/.test(vue),
    true,
  );
  // Sans compte manquant, le tiret et le nombre disparaissent ensemble : sinon
  // la phrase se terminait par « il en manque . », ponctuation orpheline
  // comprise.
  t.check(
    "le fragment « il en manque » disparaît avec son nombre",
    /\? ` — il en manque \$\{leak\.missing\}` : ""/.test(vue),
    true,
  );

  // =========================================================================
  // 4. Ce qui a été vérifié et n'avait pas à changer
  // =========================================================================
  // `scoreDelta` est calculé en TypeScript et mis à `null` explicitement : le
  // `!== null` y est juste. Le contrôle le fige, pour qu'une correction de
  // masse ne vienne pas « harmoniser » ce qui n'est pas cassé.
  const comparaison = sansCommentaires(lire("src/lib/audit-comparison.ts"));
  t.check(
    "l'écart de note est explicitement mis à `null` quand il n'a pas de sens",
    /const scoreDelta = scoreComparable \? [\s\S]{0,60} : null;/.test(comparaison),
    true,
  );
  // Le filtre des marches mesurées : `undefined > 0` est faux, donc une marche
  // absente est déjà écartée. Rien à corriger.
  t.check(
    "les marches non mesurées sont écartées par comparaison, pas par égalité",
    /s\.value !== null && s\.value > 0/.test(vue),
    true,
  );
});
