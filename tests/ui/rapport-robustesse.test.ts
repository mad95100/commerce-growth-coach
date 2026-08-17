import { readFileSync } from "node:fs";
import { defineSuite } from "../harness";

/**
 * LE RAPPORT NE DOIT PAS TOMBER POUR UNE DONNÉE D'ORNEMENT.
 *
 * LE DÉFAUT. La page d'audit lisait la boutique par une JOINTURE :
 * `.select("*, stores(id, name, currency)")`. Deux endroits en tiraient ensuite
 * une valeur par un cast non gardé :
 *
 *     params={{ storeId: (audit.stores as { id: string }).id }}
 *     Score global — {(audit.stores as { name: string }).name}
 *
 * `stores(...)` est une ressource EMBARQUÉE. PostgREST la rend `null` — pas
 * absente, `null` — dès que la ligne liée n'est pas visible : politique RLS,
 * boutique supprimée entre le chargement et l'affichage, jointure retirée d'un
 * `select` lors d'un remaniement. Le cast ne protège de rien : il ment au
 * compilateur. À l'exécution, `null.id` lève, et c'est la PAGE ENTIÈRE qui part
 * sur la frontière d'erreur.
 *
 * CE QUE CELA COÛTAIT. Le rapport d'audit est le livrable du produit : ce que
 * le marchand a attendu, et parfois payé. Il le perdait entièrement — écran
 * d'erreur générique — à cause du nom d'une boutique affiché en petites
 * capitales au-dessus du titre, et d'un lien de retour dont la cible était
 * disponible ailleurs.
 *
 * LA CORRECTION, DANS LES DEUX SENS. Le lien de retour utilise `audit.store_id`,
 * porté par la ligne d'audit elle-même, donc toujours présent — et déjà utilisé
 * par les deux AUTRES liens de la même page, ce qui rendait le cast inutile
 * autant que dangereux. Le nom, lui, est un ornement : absent, le titre se lit
 * « Score global » et le rapport reste entier.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const lire = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");

const RAPPORT = "src/routes/_authenticated/audits.$auditId.tsx";

export default defineSuite("Rapport — une jointure absente ne fait pas tomber la page", (t) => {
  const rapport = lire(RAPPORT);

  // =========================================================================
  // 1. Plus aucun cast non gardé sur la ressource embarquée
  // =========================================================================
  // La forme exacte qui a causé la panne, interdite littéralement.
  t.check(
    "aucun cast `audit.stores as { ... }` suivi d'un accès direct",
    /\(audit\.stores as \{[^}]*\}\)\.\w+/.test(rapport),
    false,
  );

  // Toute lecture de la jointure passe par un accès optionnel. On relève les
  // occurrences plutôt que de faire confiance : un futur `audit.stores.id`
  // écrit sans cast serait tout aussi fatal.
  const lectures = [...rapport.matchAll(/audit\??\.stores/g)];
  t.check("la jointure est bien encore lue quelque part", lectures.length >= 2, true);
  for (const m of lectures) {
    const suite = rapport.slice(m.index!, m.index! + 120);
    t.check(
      `lecture de la jointure gardée (…${suite.slice(0, 48).replace(/\s+/g, " ")}…)`,
      /audit\??\.stores as \{[^}]*\} \| undefined\)\?\./.test(suite),
      true,
    );
  }

  // =========================================================================
  // 2. Le lien de retour ne dépend plus de la jointure
  // =========================================================================
  t.check(
    "le retour à la boutique utilise `audit.store_id`",
    /params=\{\{ storeId: audit\.store_id \}\}/.test(rapport),
    true,
  );
  // Et il n'est pas seul : la page l'utilisait DÉJÀ ailleurs, ce qui prouve que
  // la valeur était disponible sans jointure au moment où le cast a été écrit.
  const parStoreId = [...rapport.matchAll(/storeId: audit\.store_id/g)].length;
  t.check("tous les liens vers la boutique passent par `store_id`", parStoreId >= 3, true);

  // =========================================================================
  // 3. Le nom manquant dégrade le titre, il ne le casse pas
  // =========================================================================
  t.check(
    "le nom de boutique est lu sans cast dur",
    /const storeName =[\s\S]{0,160}\?\.name\?\.trim\(\) \|\| null;/.test(rapport),
    true,
  );
  t.check(
    "le titre se replie sur « Score global » seul",
    /storeName \? `Score global — \$\{storeName\}` : "Score global"/.test(rapport),
    true,
  );

  // =========================================================================
  // 4. La devise, elle, était déjà gardée — la garde ne doit pas se perdre
  // =========================================================================
  // C'est la ligne qui prouvait que l'auteur savait la jointure faillible :
  // elle utilisait déjà `?.`. Les deux autres accès ne l'avaient pas.
  t.check(
    "la devise reste lue par accès optionnel",
    /currency\?: string \| null \} \| undefined\)\?\.currency/.test(rapport),
    true,
  );
});
