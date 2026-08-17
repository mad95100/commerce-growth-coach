import { readFileSync } from "node:fs";
import { defineSuite } from "../harness";

/**
 * LA PAGE BOUTIQUE, TELLE QU'ELLE SE PRÉSENTAIT AU MARCHAND.
 *
 * Quatre défauts relevés en la parcourant réellement au navigateur.
 *
 * 1. L'ACTION PRINCIPALE ARRIVAIT EN SEPTIÈME POSITION. Le grand formulaire
 *    « Votre modèle économique » ouvrait la page ; « Lancer un nouvel audit »
 *    venait après les réglages, les sources, la comparaison et le suivi des
 *    gains. Un marchand qui ouvre sa boutique pour lancer un diagnostic — la
 *    raison d'être du produit — tombait d'abord sur des champs à remplir.
 *
 * 2. DEUX « OBJECTIF » SUR UN SEUL ÉCRAN. La vignette affichait `stores.goal`,
 *    un texte libre saisi une seule fois à l'inscription. Le formulaire, dix
 *    centimètres plus bas, éditait `revenue_goal`, un nombre. Le marchand qui
 *    renseignait « Objectif de CA : 30 000 » voyait donc « Objectif — » juste
 *    au-dessus. C'est `revenue_goal` que le cockpit compare au chiffre
 *    d'affaires : c'est lui, le vrai objectif du produit.
 *
 * 3. `goal` SE SAISISSAIT UNE FOIS ET NE SE REVOYAIT JAMAIS. Demandé au dernier
 *    champ de l'inscription, transmis au moteur d'audit, puis affiché nulle part
 *    et modifiable nulle part. Un marchand qui l'avait laissé vide ne pouvait
 *    plus le renseigner ; un marchand dont l'objectif avait changé continuait
 *    d'être audité contre une intention périmée.
 *
 * 4. LA SEULE ACTION IRRÉVERSIBLE PORTAIT L'HABILLAGE D'UN BOUTON ORDINAIRE.
 *    « Supprimer la boutique » était un `outline`, indiscernable des huit autres
 *    boutons de la page.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const lire = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");

/**
 * Les commentaires de ces fichiers CITENT le code fautif pour expliquer ce qui
 * a été corrigé — c'est leur raison d'être. Une recherche d'interdiction menée
 * sur la source brute trouverait donc l'explication et déclarerait le défaut
 * toujours présent. On cherche dans le CODE seul.
 */
const sansCommentaires = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const PAGE = "src/routes/_authenticated/stores.$storeId.tsx";
const CHAMPS = "src/components/StoreEconomicsFields.tsx";

export default defineSuite("Interface — la page boutique", (t) => {
  const page = sansCommentaires(lire(PAGE));
  const champs = sansCommentaires(lire(CHAMPS));

  // =========================================================================
  // 1. L'ordre suit ce que le marchand vient faire
  // =========================================================================
  const iAudit = page.indexOf("Lancer un nouvel audit");
  const iHistorique = page.indexOf(">Historique<");
  const iSources = page.indexOf("<ConnectionsPanel");
  const iModele = page.indexOf("<StoreEconomicsCard");
  const iDanger = page.indexOf("<DangerZone");

  t.check("l'action principale est présente", iAudit > -1, true);
  t.check("l'historique est présent", iHistorique > -1, true);
  t.check("les sources sont présentes", iSources > -1, true);
  t.check("le formulaire de réglages est présent", iModele > -1, true);

  t.check("lancer un audit vient avant l'historique", iAudit < iHistorique, true);
  t.check("l'historique vient avant les sources", iHistorique < iSources, true);
  // LE POINT DE LA CORRECTION : le formulaire n'ouvre plus la page.
  t.check("le formulaire de réglages vient après l'action", iModele > iAudit, true);
  t.check("…et après les sources de données", iModele > iSources, true);
  t.check("la suppression reste en dernier", iDanger > iModele, true);

  // =========================================================================
  // 2. La vignette lit le champ que le formulaire modifie
  // =========================================================================
  t.check(
    "la vignette d'objectif lit `revenue_goal`",
    /label="Objectif de CA" value=\{formatMoney\(store\.revenue_goal/.test(page),
    true,
  );
  t.check(
    "elle ne lit plus le texte libre `goal`",
    /label="Objectif" value=\{store\.goal/.test(page),
    false,
  );
  // Et elle est formatée comme un montant, pas rendue telle quelle : une phrase
  // libre dans une vignette prévue pour un nombre débordait de son cadre.
  t.check(
    "elle est formatée comme les deux autres montants",
    (page.match(/formatMoney\(store\.\w+, store\.currency\)/g) ?? []).length >= 3,
    true,
  );

  // =========================================================================
  // 3. L'objectif en toutes lettres est désormais visible et modifiable
  // =========================================================================
  t.check("une carte porte l'objectif principal", /function StoreGoalCard/.test(page), true);
  t.check("elle est rendue sur la page", /<StoreGoalCard/.test(page), true);
  t.check(
    "elle écrit bien dans la colonne `goal`",
    /\.update\(\{ goal: valeur \}\)/.test(page),
    true,
  );
  // VIDÉ, LE CHAMP REDEVIENT `null`. La chaîne vide serait une valeur : le
  // moteur ne pourrait plus distinguer « aucun objectif déclaré » d'un objectif
  // blanc, et le contexte d'audit recevrait du vide en croyant recevoir une
  // intention.
  t.check(
    "un objectif effacé redevient `null`, pas une chaîne vide",
    /texte\.trim\(\) === "" \? null : texte\.trim\(\)/.test(page),
    true,
  );
  t.check(
    "le bouton reste inerte tant que rien n'a changé",
    /disabled=\{saving \|\| !modifié\}/.test(page),
    true,
  );

  // =========================================================================
  // 4. L'unité d'un champ n'annonce pas un état interne
  // =========================================================================
  // « Objectif de CA (Devise non déterminée/mois) » s'affichait sur le PREMIER
  // formulaire rencontré par tout nouveau marchand : à l'inscription, la
  // boutique n'existe pas encore, donc aucune devise n'est connue.
  t.check(
    "les libellés n'interpolent plus le libellé d'en-tête",
    /currencyLabel/.test(champs),
    false,
  );
  t.check(
    "ils lisent un code ISO, ou rien",
    /normalizeCurrency\(currency \?\? null\)/.test(champs),
    true,
  );
  t.check(
    "sans devise connue, l'unité disparaît au lieu de s'expliquer",
    /code \? `\$\{code\}\/mois` : "par mois"/.test(champs),
    true,
  );

  // =========================================================================
  // 5. L'action irréversible se voit
  // =========================================================================
  t.check(
    "le bouton de suppression porte la couleur du danger",
    /border-destructive\/40 text-destructive/.test(page),
    true,
  );
  // La protection qui existait déjà ne doit pas se perdre : retaper le nom.
  t.check("la suppression exige encore le nom de la boutique", /correspond/.test(page), true);
});
