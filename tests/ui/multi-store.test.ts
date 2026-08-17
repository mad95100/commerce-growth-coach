import { readFileSync } from "node:fs";
import { defineSuite } from "../harness";

/**
 * PLUSIEURS BOUTIQUES SUR UN MÊME COMPTE.
 *
 * DEUX MANQUES QUE CES CONTRÔLES FIGENT.
 *
 * Le premier : le cockpit du tableau de bord affichait TOUJOURS la première
 * boutique, sans dire laquelle. Un marchand qui en gère deux lisait donc des
 * chiffres sans savoir à quoi ils se rapportaient, et n'avait aucun moyen d'en
 * changer. C'était le pire des deux mondes — ni une vue d'ensemble, ni une vue
 * choisie.
 *
 * Le second : rien ne permettait de supprimer une boutique. Ajoutée par erreur
 * ou devenue inutile, elle restait indéfiniment, occupait la liste, comptait
 * dans les quotas, et le traitement périodique continuait de la reprendre.
 *
 * La suppression étant la seule action irréversible du produit — onze tables
 * partent en cascade — ce sont surtout ses garde-fous qui sont vérifiés ici.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");

export default defineSuite("Interface — plusieurs boutiques", (t) => {
  const dashboard = read("src/routes/_authenticated/dashboard.tsx");

  // --- 1. La boutique regardée est nommée et choisie -----------------------
  t.check(
    "le cockpit ne pointe plus en dur sur la première boutique",
    /<Cockpit storeId=\{storesQ\.data\[0\]!\.id\}/.test(dashboard),
    false,
  );
  t.check(
    "le cockpit suit la boutique active",
    /<Cockpit storeId=\{activeStore\.id\}/.test(dashboard),
    true,
  );
  t.check(
    "un sélecteur apparaît dès qu'il y a plusieurs boutiques",
    /storesQ\.data\.length > 1 &&/.test(dashboard),
    true,
  );
  t.check(
    "la boutique active est signalée",
    /aria-current=\{s\.id === activeStore\.id/.test(dashboard),
    true,
  );

  // LE CHOIX VIT DANS L'ADRESSE. Un état local se perdrait au rechargement et
  // ne se met pas en signet : le marchand qui suit deux boutiques devrait
  // recliquer à chaque visite.
  t.check(
    "le choix est déclaré dans l'adresse",
    /validateSearch: z\.object\(\{ store:/.test(dashboard),
    true,
  );
  t.check(
    "changer de boutique passe par la navigation",
    /navigate\(\{ to: "\/dashboard", search: \{ store: s\.id \} \}\)/.test(dashboard),
    true,
  );

  // UN IDENTIFIANT D'ADRESSE NE VIENT PAS DE NOUS. Un signet périmé ou une
  // boutique supprimée doit retomber sur une boutique réelle, pas afficher un
  // cockpit vide sans explication — ni, pire, tenter de lire une boutique qui
  // n'appartient pas au compte.
  t.check(
    "l'identifiant de l'adresse est vérifié contre la liste chargée",
    // Le formatage peut couper la ligne : le contrôle porte sur la logique,
    // pas sur sa mise en page.
    /storesQ\.data\?\.find\(\(s\) => s\.id === search\.store\)\s*\?\?\s*storesQ\.data\?\.\[0\]/.test(
      dashboard,
    ),
    true,
  );

  // --- 2. La suppression existe, avec ses garde-fous ----------------------
  const fn = read("src/lib/stores.functions.ts");
  t.check("une fonction de suppression existe", /export const deleteStore/.test(fn), true);
  t.check("elle exige une session", /\.middleware\(\[requireSupabaseAuth\]\)/.test(fn), true);

  // L'appartenance se vérifie ici ou nulle part : le rôle de service contourne
  // RLS.
  t.check("l'appartenance est vérifiée", /store\.owner_id !== userId/.test(fn), true);
  const posAppartenance = fn.indexOf("owner_id !== userId");
  const posSuppression = fn.indexOf(".delete()");
  t.check(
    "elle est vérifiée AVANT la suppression",
    posAppartenance > 0 && posAppartenance < posSuppression,
    true,
  );
  // Une boutique inexistante et une boutique d'autrui rendent le même message :
  // les distinguer apprendrait quels identifiants existent.
  t.check(
    "l'inexistant et l'inaccessible se confondent",
    /if \(!store \|\| store\.owner_id !== userId\)/.test(fn),
    true,
  );

  // LE NOM RETAPÉ. Il ne protège pas d'un attaquant — il connaît le nom — mais
  // du clic distrait, qui est le risque réel sur une action irréversible.
  t.check(
    "une confirmation par le nom est exigée",
    /confirmation: z\.string\(\)\.min\(1\)/.test(fn),
    true,
  );
  t.check(
    "la comparaison tolère la casse et les espaces",
    /confirmation\.trim\(\)\.toLowerCase\(\) !== attendu/.test(fn),
    true,
  );
  t.check("un nom qui ne correspond pas ne supprime rien", /Rien n'a été supprimé/.test(fn), true);
  t.check(
    "le refus arrive avant la suppression",
    fn.indexOf("Rien n'a été supprimé") < posSuppression,
    true,
  );

  // Les erreurs rendues sont lisibles par un marchand, pas par un développeur.
  t.check(
    "aucun message technique n'est renvoyé",
    /PGRST|postgres|constraint|violates/i.test(fn),
    false,
  );

  // --- 3. L'écran dit ce qui va disparaître -------------------------------
  const page = read("src/routes/_authenticated/stores.$storeId.tsx");
  t.check("la zone de suppression est montée", /<DangerZone storeId=/.test(page), true);
  t.check(
    "l'écran annonce que l'historique part avec",
    /audits, recommandations, mesures et\s+connexions/.test(page),
    true,
  );
  t.check(
    "l'écran annonce le caractère définitif",
    /définitive et nous ne pourrons rien restaurer/.test(page),
    true,
  );
  // Ce que nous ne pouvons PAS faire doit être dit : supprimer la boutique de
  // notre côté ne désinstalle pas l'application dans l'admin Shopify.
  t.check(
    "l'écran dit ce que la suppression ne fait pas",
    /nous ne pouvons pas la désinstaller/.test(page),
    true,
  );
  // Le bouton reste inerte tant que le nom ne correspond pas.
  t.check(
    "le bouton est bloqué sans correspondance",
    /disabled=\{!correspond \|\| busy\}/.test(page),
    true,
  );
  t.check(
    "la correspondance est calculée sur le nom réel",
    /saisie\.trim\(\)\.toLowerCase\(\) === storeName/.test(page),
    true,
  );
  // Après suppression, les listes en cache contiennent encore la boutique.
  t.check("le cache est vidé après suppression", /invalidateQueries\(\)/.test(page), true);
  t.check(
    "le marchand est ramené au tableau de bord",
    /navigate\(\{ to: "\/dashboard" \}\)/.test(page),
    true,
  );
  // Le formulaire de confirmation ne s'ouvre pas tout seul : deux gestes sont
  // nécessaires avant que le bouton destructeur n'apparaisse.
  t.check("la confirmation demande un premier geste", /!open \?/.test(page), true);
});
