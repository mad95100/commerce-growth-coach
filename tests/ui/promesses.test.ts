import { readdirSync, readFileSync, statSync } from "node:fs";
import { defineSuite } from "../harness";
import { REVERTIBLE_BY_TOOL, revertibilityNotice } from "@/lib/action-plan";
import { shouldRefundAudit } from "@/lib/audit-errors";

/**
 * CE QUE LE PRODUIT PROMET, LE PRODUIT LE FAIT.
 *
 * POURQUOI CETTE SUITE EXISTE. Une phrase d'interface est un engagement, et le
 * code ne sait pas qu'il en a pris un. Les deux se séparent en silence : le
 * texte reste, la fonction change, et plus rien ne les compare. Personne ne
 * s'en aperçoit avant un marchand — au moment précis où il vérifie, c'est-à-dire
 * au moment où il a déjà un doute.
 *
 * LE CAS QUI A OUVERT CETTE SUITE. Après une panne venue de chez nous, l'écran
 * affichait : « Relancez l'audit dans quelques heures ; votre passage ne vous a
 * pas été décompté. » Le quota était prélevé au lancement et rien ne le rendait.
 * La phrase était fausse, et fausse au pire endroit : celui où le marchand vient
 * vérifier son compteur après une panne dont il n'est pas responsable. Ce n'est
 * pas théorique — c'est ce qui s'est produit en production le jour où le modèle
 * configuré a disparu.
 *
 * LE SECOND. « Nous remesurons automatiquement, et nous vous prévenons si la
 * situation ne se rétablit pas. » Le produit n'envoie ni courriel ni
 * notification : l'alerte s'affiche dans l'application, et un marchand qui ne
 * l'ouvre pas n'est prévenu de rien. Promettre plus que ce qu'on fait, sur un
 * sujet de dégradation, est le meilleur moyen de n'être plus cru sur le reste.
 *
 * CE QUI EST VÉRIFIÉ ICI EST TOUJOURS UN LIEN, jamais un texte isolé : une
 * phrase et le mécanisme qui doit la rendre vraie.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const lire = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");

function fichiersDe(dossier: string): string[] {
  const out: string[] = [];
  for (const entrée of readdirSync(`${ROOT}${dossier}`)) {
    const relatif = `${dossier}/${entrée}`;
    if (statSync(`${ROOT}${relatif}`).isDirectory()) out.push(...fichiersDe(relatif));
    else if (relatif.endsWith(".ts") || relatif.endsWith(".tsx")) out.push(relatif);
  }
  return out;
}

const sansCommentaires = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

export default defineSuite("Produit — les promesses faites au marchand sont tenues", (t) => {
  // =========================================================================
  // 1. Aucune promesse de nous manifester : nous n'avons aucun moyen de le faire
  // =========================================================================
  // Le produit n'a ni courriel transactionnel, ni notification. Tant que ce
  // canal n'existe pas, aucune phrase ne doit laisser croire qu'on viendra
  // chercher le marchand — il attendrait un avertissement qui n'arrivera jamais,
  // sur des sujets où l'attente coûte cher (une correction qui dégrade).
  const PROMESSES_IMPOSSIBLES = [
    "nous vous préviendrons",
    "nous vous prévenons",
    "vous serez prévenu",
    "vous recevrez un",
    "nous vous enverrons",
    "nous vous notifierons",
    "vous serez averti",
  ];
  const fichiers = [
    ...fichiersDe("src/components"),
    ...fichiersDe("src/routes"),
    ...fichiersDe("src/lib"),
  ];
  t.check("le relevé parcourt bien le produit", fichiers.length >= 40, true);

  /**
   * Les envois RÉELS dont dispose le produit.
   *
   * Ils viennent tous de Supabase — confirmation d'inscription, lien de
   * réinitialisation. Il n'existe aucun autre canal. Une promesse n'est donc
   * pas interdite en soi : elle est interdite là où rien ne l'envoie.
   * Interdire la phrase partout aurait été plus simple et faux — la page de
   * connexion promet bien un courriel, et le fait vraiment.
   */
  const ENVOIS_REELS = /resetPasswordForEmail|signUp\(|resend\(/;
  for (const chemin of fichiers) {
    const source = sansCommentaires(lire(chemin));
    const contenu = source.toLowerCase();
    const promet = PROMESSES_IMPOSSIBLES.some((p) => contenu.includes(p));
    if (!promet) continue;
    t.check(
      `${chemin} promet un envoi : il doit l'envoyer vraiment`,
      ENVOIS_REELS.test(source),
      true,
    );
  }
  // Et la phrase qui a motivé ce contrôle dit désormais OÙ l'alerte apparaît :
  // une promesse tenable se vérifie, une promesse vague ne se vérifie pas.
  const briefing = lire("src/lib/briefing.ts");
  t.check(
    "l'alerte de dégradation dit où elle s'affichera",
    /l'alerte s'affiche en haut de votre tableau de bord/.test(briefing),
    true,
  );

  // =========================================================================
  // 2. « Votre passage ne vous a pas été décompté » — et il ne l'est pas
  // =========================================================================
  const messages = lire("src/lib/audit-errors.ts");
  t.check(
    "la promesse de non-décompte est bien écrite au marchand",
    /pas été décompté/.test(messages),
    true,
  );
  // Elle n'est faite que sur les pannes qui ne lui incombent pas…
  t.check("et elle vaut pour une panne de notre côté", shouldRefundAudit("AI Gateway 404"), true);
  t.check(
    "mais pas pour un accès qu'il doit reconnecter",
    shouldRefundAudit("Jeton Shopify illisible."),
    false,
  );
  // …et le mécanisme qui la rend vraie existe, au bon endroit.
  const jobs = sansCommentaires(lire("src/lib/audit-jobs.server.ts"));
  t.check(
    "la restitution est appelée à l'abandon",
    /shouldRefundAudit\(message\)/.test(jobs),
    true,
  );
  t.check("elle passe par le décompte réel", /refundQuota\(/.test(jobs), true);
  // UNE SEULE FOIS. Un rejeu du même échec ne doit pas créditer deux fois.
  t.check("elle est conditionnée à l'état précédent", /avant\.state !== "failed"/.test(jobs), true);

  // =========================================================================
  // 3. « Vous pourrez annuler cette action » — et l'annulation existe
  // =========================================================================
  // La phrase est écrite AVANT l'écriture, à partir d'une table statique. Si
  // cette table déclarait réversible un outil sans procédure d'annulation, le
  // marchand accepterait une écriture sur la foi d'un retour en arrière qui
  // n'existe pas.
  const revert = sansCommentaires(lire("src/lib/revert.server.ts"));
  const annulables = Object.entries(REVERTIBLE_BY_TOOL)
    .filter(([, ok]) => ok)
    .map(([outil]) => outil);
  t.check("plusieurs outils sont annoncés annulables", annulables.length >= 4, true);
  for (const outil of annulables) {
    t.check(
      `« ${outil} » annoncé annulable a bien sa procédure`,
      new RegExp(`case "${outil}":`).test(revert),
      true,
    );
  }
  // La phrase elle-même distingue les deux cas, et dit quoi faire dans l'autre.
  t.check(
    "un outil annulable l'annonce",
    /pourrez annuler/.test(revertibilityNotice("update_product")),
    true,
  );
  const nonAnnulable = revertibilityNotice("meta_update_creative");
  t.check("un outil non annulable le dit", /ne pourra pas être annulée/.test(nonAnnulable), true);
  t.check("et dit quoi faire à la place", /à la main dans votre compte/.test(nonAnnulable), true);

  // =========================================================================
  // 3 bis. UNE ABSENCE DE NOTE N'EST PAS UN ZÉRO
  // =========================================================================
  // La page passait `audit.score ?? 0` : une boutique dont trop peu d'axes
  // avaient pu être mesurés s'affichait 0/100 EN ROUGE — le verdict le plus dur
  // du produit, rendu sur un sujet dont nous n'avions rien dit. C'est la
  // symétrie exacte de « Conversion 100/100 » : là on flattait le vide, ici on
  // le condamnait. Les deux viennent du même geste : remplacer une absence par
  // un nombre.
  const anneau = lire("src/components/ScoreRing.tsx");
  t.check("l'anneau accepte l'absence de note", /score: number \| null/.test(anneau), true);
  t.check("il l'affiche comme telle", /non noté/.test(anneau), true);
  t.check(
    "et sans couleur de jugement",
    /const color = !noté/.test(sansCommentaires(anneau)),
    true,
  );
  // ET LA MÊME ERREUR AILLEURS. La vignette d'historique se décidait sur
  // `score != null` : un audit RÉUSSI mais non notable tombait dans la branche
  // d'échec — croix rouge et « Audit échoué » — alors que ses constats
  // l'attendaient. Une note absente n'est ni un zéro, ni une panne.
  const boutique = lire("src/routes/_authenticated/stores.$storeId.tsx");
  t.check(
    "la vignette d'historique suit le statut, pas la note",
    /\{a\.status === "completed" \? \(\s*<ScoreRing/.test(boutique),
    true,
  );
  t.check(
    "un audit abouti n'est plus annoncé échoué",
    /a\.status === "completed"\s*\?\s*"Analyse terminée"/.test(boutique),
    true,
  );

  const rapport = lire("src/routes/_authenticated/audits.$auditId.tsx");
  t.check(
    "le rapport ne remplace plus l'absence par un zéro",
    /audit\.score \?\? 0/.test(rapport),
    false,
  );
  t.check(
    "et il dit pourquoi il n'y a pas de note",
    /Trop peu de points ont pu être mesurés/.test(rapport),
    true,
  );

  // =========================================================================
  // 3 ter. UNE ABSENCE NE DEVIENT NI UN ZÉRO ACCABLANT, NI UN ZÉRO FLATTEUR
  // =========================================================================
  // Deux formes du même geste, trouvées dans le même passage.
  //
  // L'accablante : le bloc décrivant les ensembles de pubs au modèle écrivait
  // « ROAS 0 » quand la régie n'avait rien remonté — le signal le plus fort qui
  // soit de couper cette dépense. Les garde-fous refusent bien l'écriture sans
  // chiffre, mais le modèle raisonnait déjà sur un zéro fabriqué, et le motif
  // qu'il en tirait était lu par le marchand.
  const applyPrompt = sansCommentaires(lire("src/lib/apply-fix.server.ts"));
  t.check(
    "un ROAS non remonté n'est pas écrit 0",
    /ROAS \$\{a\.roas \?\? 0\}/.test(applyPrompt),
    false,
  );
  t.check("il est déclaré inconnu", /a\.roas \?\? "inconnu"/.test(applyPrompt), true);
  t.check("la dépense absente aussi", /a\.spend \?\? "inconnue"/.test(applyPrompt), true);

  // La flatteuse : « Bénéfice estimé », indication « Marge − pub − charges »,
  // alors que des charges fixes non renseignées valaient zéro charge. Le champ
  // est facultatif — l'ajout de boutique invite à laisser vide ce qu'on ne
  // connaît pas — donc le cas est courant, pas marginal.
  const cockpitFn = sansCommentaires(lire("src/lib/cockpit.functions.ts"));
  t.check(
    "l'absence de charges fixes est signalée",
    /charges fixes mensuelles ne sont pas renseignées/.test(cockpitFn),
    true,
  );
  const cockpitUi = sansCommentaires(lire("src/components/Cockpit.tsx"));
  t.check(
    "l'intitulé suit ce qui a été réellement soustrait",
    /profitIncludesFixedCosts[\s\S]{0,200}charges fixes non renseignées/.test(cockpitUi),
    true,
  );

  // ET LA TROISIÈME FORME, LA PLUS DÉCOURAGEANTE. `computePotential` somme des
  // gains avec `?? 0` : un diagnostic dont AUCUN constat n'était chiffrable
  // renvoie 0, un nombre et non une absence. Le centre de pilotage n'avait que
  // deux branches — un montant, ou « lancez un diagnostic » — et ce cas tombait
  // dans la première : « Potentiel identifié : 0 € à 0 € par mois ». Le rapport
  // d'audit, lui, masque déjà son bloc de gain quand rien n'est chiffré. Les
  // deux écrans du même audit se contredisaient, et c'est le plus visible des
  // deux qui avait tort.
  t.check(
    "un potentiel non chiffré n'est pas annoncé nul",
    /c\.potentialMax === 0/.test(cockpitUi),
    true,
  );
  t.check(
    "et la phrase dit lequel des deux c'est",
    /Ce n'est pas un potentiel nul, c'est un potentiel non mesuré/.test(cockpitUi),
    true,
  );
  // L'ABSENCE D'AUDIT GARDE SA PROPRE PHRASE : la confondre avec « rien à
  // gagner » serait le défaut symétrique, et inviter à lancer un diagnostic
  // déjà lancé n'aiderait personne.
  t.check(
    "l'absence de diagnostic reste distincte",
    /c\.potentialMin == null \|\| c\.potentialMax == null/.test(cockpitUi),
    true,
  );
  // Le rapport, lui, ne doit pas cesser de masquer son bloc.
  t.check(
    "le rapport n'affiche un gain que s'il en a un",
    /totalGainMax > 0 &&/.test(sansCommentaires(rapport)),
    true,
  );

  // =========================================================================
  // 4. « Rien n'a encore été modifié » — l'aperçu ne passe pas par l'écriture
  // =========================================================================
  // L'aperçu affiche cette phrase sous le bouton. Elle n'est vraie que si la
  // proposition et l'exécution restent deux chemins distincts : le jour où
  // l'aperçu appellerait l'écriture pour « voir ce que ça donne », la phrase
  // deviendrait un mensonge sans qu'une seule ligne de texte ait changé.
  const apercu = lire("src/components/ActionPreview.tsx");
  t.check(
    "l'aperçu affirme que rien n'est modifié",
    /Rien n'a encore été modifié/.test(apercu),
    true,
  );
  t.check(
    "et que l'écriture demande un geste explicite",
    /ne part que si vous cliquez/.test(apercu),
    true,
  );
  const applique = sansCommentaires(lire("src/lib/apply-fix.server.ts"));
  // La fonction qui écrit chez le partenaire est nommée, isolée, et n'a qu'UN
  // SEUL appelant. C'est ce compte qui protège la phrase : deux points d'entrée
  // vers l'écriture, et l'un des deux finira par être atteint depuis l'aperçu.
  t.check(
    "l'écriture est isolée dans sa propre fonction",
    /async function writeValidated\(/.test(applique),
    true,
  );
  t.check("et n'a qu'un seul point d'appel", (applique.match(/writeValidated\(/g) ?? []).length, 2);
});
