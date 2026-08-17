import { readFileSync, readdirSync } from "node:fs";
import { defineSuite } from "../harness";

/**
 * CE QUE L'ÉCRAN DIT QUAND LA LECTURE ÉCHOUE.
 *
 * POURQUOI CETTE SUITE EXISTE. Un écran qui confond « il n'y a rien » et « je
 * n'ai pas réussi à lire » ment au marchand sur l'état de ses données. Le
 * tableau de bord le faisait : sur échec de la requête, `data` est indéfini, et
 * la branche du vide s'affichait — « Aucune boutique pour l'instant », avec un
 * bouton pour en créer une. Un marchand dont la connexion hoquette voyait sa
 * boutique disparaître et s'entendait proposer de la recréer.
 *
 * Aucun test unitaire ne pouvait l'attraper : le code fonctionnait exactement
 * comme il était écrit. Ces contrôles portent donc sur la STRUCTURE des écrans
 * — l'ordre des branches, et la présence d'un état d'échec là où une lecture
 * peut échouer.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");

/** Écrans qui lisent des données distantes et peuvent donc échouer. */
const ECRANS = [
  "src/routes/_authenticated/dashboard.tsx",
  "src/routes/_authenticated/stores.$storeId.tsx",
  "src/routes/_authenticated/audits.$auditId.tsx",
];

export default defineSuite("Interface — vide, chargement et échec", (t) => {
  // --- L'état d'échec existe et se distingue du vide -----------------------
  const shell = read("src/components/AppShell.tsx");
  t.check("un état d'échec distinct existe", /export function ErrorState/.test(shell), true);
  t.check("l'état vide existe toujours", /export function EmptyState/.test(shell), true);
  // Le message doit rassurer sur la persistance des données : c'est exactement
  // la peur qu'un écran vide déclenche.
  t.check(
    "l'échec dit que les données ne sont pas perdues",
    /ne sont pas perdues/.test(shell),
    true,
  );
  t.check("l'échec propose de réessayer", /Réessayer/.test(shell), true);
  // Les deux états ne doivent pas se ressembler : un vide invite à créer, un
  // échec invite à réessayer. Même icône, même lecture, même erreur.
  const blocErreur = shell.slice(
    shell.indexOf("export function ErrorState"),
    shell.indexOf("export function EmptyState"),
  );
  t.check(
    "l'état d'échec ne propose pas de créer quelque chose",
    /actionLabel/.test(blocErreur),
    false,
  );
  t.check("l'état d'échec porte sa propre icône", /AlertTriangle/.test(blocErreur), true);

  // --- Le tableau de bord teste l'échec AVANT le vide ----------------------
  const dashboard = read("src/routes/_authenticated/dashboard.tsx");
  t.check("le tableau de bord affiche un état d'échec", /<ErrorState/.test(dashboard), true);
  // Les positions se comparent DANS LE RENDU seulement : `data.length === 0`
  // apparaît aussi plus haut, dans la redirection automatique, et la comparer
  // depuis le début du fichier mesurerait autre chose que l'ordre des branches.
  const rendu = dashboard.slice(dashboard.indexOf("storesQ.isLoading ?"));
  const posErreur = rendu.indexOf("storesQ.isError");
  const posVide = rendu.indexOf("storesQ.data.length === 0");
  t.check("la branche d'échec existe", posErreur > 0, true);
  t.check("l'échec est testé avant le vide", posErreur > 0 && posErreur < posVide, true);
  t.check(
    "l'échec propose un nouvel essai réel",
    /onRetry=\{\(\) => void storesQ\.refetch\(\)\}/.test(dashboard),
    true,
  );

  // LE RENVOI AUTOMATIQUE NE PART QUE SUR UN SUCCÈS. Rediriger vers la création
  // de boutique parce qu'une lecture a échoué est le même défaut, en pire : il
  // déplace le marchand sans qu'il ait rien demandé.
  t.check(
    "la redirection vers l'accueil n'a lieu que sur un succès",
    /isSuccess && storesQ\.data\.length === 0/.test(dashboard),
    true,
  );

  // --- Chaque écran distant a ses trois états ------------------------------
  for (const ecran of ECRANS) {
    const src = read(ecran);
    const nom = ecran.split("/").pop();
    t.check(
      `${nom} a un état de chargement`,
      /isLoading|isPending|Skeleton|Loader2/.test(src),
      true,
    );
    t.check(`${nom} a un état d'échec`, /isError|ErrorState|\.error\b/.test(src), true);
  }

  // --- Le téléphone n'est pas une impasse ----------------------------------
  // POURQUOI CE CONTRÔLE EXISTE. La barre latérale est masquée en dessous de
  // `md`, et l'en-tête mobile ne portait que le logo et la déconnexion :
  // l'application n'offrait AUCUN chemin vers les boutiques ni les paramètres
  // sur un téléphone. Un marchand y était enfermé sur le tableau de bord, sans
  // autre issue que de se déconnecter. Aucun test ne pouvait le voir — il n'y
  // avait rien de cassé, seulement quelque chose d'absent.
  t.check(
    "la barre latérale est bien masquée sur petit écran",
    /hidden[^"]*md:flex/.test(shell),
    true,
  );
  t.check(
    "une navigation existe pour les petits écrans",
    /md:hidden[\s\S]{0,400}navItems\.map/.test(shell),
    true,
  );
  t.check(
    "elle mène aux mêmes destinations que la barre latérale",
    (shell.match(/navItems\.map/g) ?? []).length >= 2,
    true,
  );
  // Une barre fixée en bas recouvre la fin du contenu si rien ne l'en empêche.
  t.check("le contenu réserve la place de la barre basse", /pb-24 md:pb-8/.test(shell), true);
  t.check(
    "la navigation mobile est annoncée aux lecteurs d'écran",
    /aria-label="Navigation principale"/.test(shell),
    true,
  );
  t.check("la page courante est signalée", /aria-current=\{active \? "page"/.test(shell), true);

  // --- L'application entière a un filet ------------------------------------
  const root = read("src/routes/__root.tsx");
  t.check("une frontière d'erreur globale est posée", /errorComponent:/.test(root), true);
  t.check("une page introuvable est gérée", /notFoundComponent:/.test(root), true);

  // --- Toute route authentifiée exige une session -------------------------
  // Une page de données atteinte sans session afficherait un écran vide au lieu
  // d'un écran de connexion.
  const garde = read("src/routes/_authenticated/route.tsx");
  t.check(
    "les routes authentifiées redirigent vers la connexion",
    /redirect\(\{ to: "\/auth"/.test(garde),
    true,
  );
  const fichiers = readdirSync(`${ROOT}src/routes/_authenticated`);
  t.check("le dossier gardé porte bien sa route de garde", fichiers.includes("route.tsx"), true);
});
