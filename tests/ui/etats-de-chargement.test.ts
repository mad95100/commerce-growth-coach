import { readdirSync, readFileSync, statSync } from "node:fs";
import { defineSuite } from "../harness";

/**
 * L'ATTENTE, ET CE QU'ELLE MONTRAIT.
 *
 * TROIS DÉFAUTS RELEVÉS EN PARCOURANT L'APPLICATION RENDUE.
 *
 * 1. L'ÉCRAN NOIR DU DÉMARRAGE. La branche `_authenticated` valide le jeton par
 *    le RÉSEAU dans `beforeLoad`, ce qui bloque le rendu de toute la branche.
 *    Sans `pendingComponent`, le routeur n'affichait rien : ni cadre, ni logo,
 *    ni point. Ce n'est pas un écran rare — c'est le PREMIER de chaque visite,
 *    sur chaque page protégée, et après chaque rechargement.
 *
 * 2. SEPT ATTENTES EN TEXTE NU. « Chargement... », « Chargement de votre
 *    pilotage... », « ... ». Une ligne de vingt pixels remplacée par un bloc de
 *    six cents : tout ce qui suivait descendait d'un coup, sous les yeux du
 *    marchand en train de lire.
 *
 * 3. L'ÉCHEC AFFICHÉ COMME UNE ABSENCE. La page boutique annonçait « Boutique
 *    introuvable » aussi bien quand la requête avait ÉCHOUÉ que lorsque la
 *    boutique n'existait pas. Un marchand dont la connexion hoquette lisait donc
 *    que sa boutique n'existait plus — la phrase la plus inquiétante possible, et
 *    la seule qui ne lui laissait rien à faire.
 *
 * CE QUE CE CONTRÔLE PROTÈGE. Qu'aucune attente ne reparaisse en texte nu, que
 * la branche protégée garde son composant d'attente, et que les trois états
 * — chargement, échec, vide — restent distincts partout où ils coexistent.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const lire = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");

function fichiersDe(dossier: string): string[] {
  const out: string[] = [];
  for (const entrée of readdirSync(`${ROOT}${dossier}`)) {
    const relatif = `${dossier}/${entrée}`;
    if (statSync(`${ROOT}${relatif}`).isDirectory()) out.push(...fichiersDe(relatif));
    else if (relatif.endsWith(".tsx")) out.push(relatif);
  }
  return out;
}

const sansCommentaires = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

/** Les écrans du produit. `ui/` est la bibliothèque de base, hors sujet ici. */
const ECRANS = [...fichiersDe("src/routes"), ...fichiersDe("src/components")].filter(
  (f) => !f.startsWith("src/components/ui/"),
);

export default defineSuite("Interface — l'attente occupe la place de ce qu'elle annonce", (t) => {
  t.check("les écrans du produit sont bien trouvés", ECRANS.length >= 10, true);

  // =========================================================================
  // 1. Plus une seule attente en texte nu
  // =========================================================================
  // La forme exacte qui a été corrigée : un élément dont le SEUL contenu est le
  // mot « Chargement ». Un « Analyse en cours… » à l'intérieur d'un bouton, lui,
  // reste légitime : le bouton occupe déjà sa place, rien ne se déplace.
  const TEXTE_NU = />\s*(?:Chargement|\.\.\.|…)[^<]*</;
  for (const chemin of ECRANS) {
    const source = sansCommentaires(lire(chemin));
    t.check(`${chemin} : aucune attente en texte nu`, TEXTE_NU.test(source), false);
  }

  // =========================================================================
  // 2. La branche protégée ne démarre plus sur du vide
  // =========================================================================
  const branche = lire("src/routes/_authenticated/route.tsx");
  t.check(
    "la branche protégée valide bien le jeton par le réseau",
    /beforeLoad: async \(\) => \{[\s\S]*supabase\.auth\.getUser\(\)/.test(branche),
    true,
  );
  t.check("…et déclare donc un composant d'attente", /pendingComponent:/.test(branche), true);
  t.check("qui rend le cadre de l'application", /<AppShell>/.test(branche), true);
  t.check("et une ossature à la place du contenu", /<PageSkeleton \/>/.test(branche), true);
  // Le délai par défaut du routeur est d'une seconde : trop long pour une
  // validation réseau, qui la dépasse presque toujours sur mobile.
  t.check("l'ossature apparaît avant la seconde par défaut", /pendingMs: 300/.test(branche), true);

  // =========================================================================
  // 3. Ce que « introuvable » disait à la place de « pas pu lire »
  // =========================================================================
  // `ui/states.test.ts` couvre déjà l'ORDRE des branches et la présence d'un
  // état d'échec. Ce qui suit ne le refait pas : il porte sur les deux écrans
  // qui répondaient « introuvable » à un échec de lecture — un mot qui annonce
  // au marchand la disparition de sa boutique ou de son rapport, là où la
  // lecture avait simplement raté.
  for (const [chemin, sujet] of [
    ["src/routes/_authenticated/stores.$storeId.tsx", "boutique"],
    ["src/routes/_authenticated/audits.$auditId.tsx", "rapport"],
  ] as const) {
    const source = sansCommentaires(lire(chemin));
    t.check(
      `${chemin} : l'échec de lecture a son propre écran`,
      /isError\)\s*\n?\s*return \([\s\S]{0,200}<ErrorState/.test(source),
      true,
    );
    t.check(
      `${chemin} : et il rassure sur ce qui n'est pas perdu`,
      /n'est pas perdu|ne sont pas perdues|sont intacts/.test(source),
      true,
    );
    t.check(
      `${chemin} : l'absence réelle du ${sujet} reste un état vide, pas une erreur`,
      /<EmptyState/.test(source),
      true,
    );
  }

  // =========================================================================
  // 4. Les ossatures restent annoncées à qui ne les voit pas
  // =========================================================================
  const shell = lire("src/components/AppShell.tsx");
  t.check("l'attente est annoncée aux lecteurs d'écran", /role="status"/.test(shell), true);
  t.check("…et marquée comme occupée", /aria-busy="true"/.test(shell), true);
  t.check(
    "les formes décoratives sont masquées à ces mêmes lecteurs",
    /aria-hidden="true"/.test(shell),
    true,
  );
  t.check(
    "chaque zone d'attente porte un intitulé lisible",
    /<span className="sr-only">\{label\}<\/span>/.test(shell),
    true,
  );
});
