import { readdirSync, readFileSync, statSync } from "node:fs";
import { defineSuite } from "../harness";
import { errorBody, escapeHtml, page, successBody } from "../../src/lib/oauth-page.server";

/**
 * LES PAGES DE RETOUR OAUTH : ÉCHAPPÉES, ET TOUTES LES TROIS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI A ÉTÉ TROUVÉ, ET COMMENT.
 *
 * En parcourant le chemin réel du marchand — OAuth, retour, boutique reconnue —
 * on lit les trois fichiers de retour. Celui de Shopify avait été corrigé
 * plusieurs fois ; les deux autres portaient encore la forme d'origine :
 *
 *     if (oauthError) return htmlResponse(`Autorisation refusée : ${oauthError}`, 400);
 *
 * `oauthError` vient de la CHAÎNE DE REQUÊTE. Rien ne l'échappait : chaque
 * fichier avait sa propre `htmlResponse`, et aucune des trois ne touchait au
 * texte qu'on lui donnait. Une adresse fabriquée exécutait donc du script sur
 * l'origine de l'application — celle où la session Supabase est rangée dans le
 * stockage local, sous `sb-<ref>-auth-token`. Aucun compte n'était nécessaire :
 * il suffisait d'un lien.
 *
 * Vérifié au navigateur avant correction, sur les deux retours :
 *
 *     meta   : script injecté exécuté = true
 *     google : script injecté exécuté = true
 *
 * Trois autres textes entraient par le même chemin sans échappement : la
 * réponse brute du fournisseur en cas d'échange refusé, le message d'erreur
 * interne du `catch` final, et le nom du compte publicitaire renvoyé par Meta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE N'EST PAS UNE ÉTOURDERIE MAIS UNE DÉRIVE.
 *
 * Trois copies d'une même fonction, dans trois fichiers, portant le même nom.
 * Corriger l'une ne corrige rien ailleurs, et rien ne signale l'écart. La
 * correction ne consiste donc pas seulement à échapper : les trois retours
 * partagent désormais UN module, `src/lib/oauth-page.server.ts`, dont la
 * signature ne laisse plus d'endroit où concaténer sans y penser.
 *
 * Ce contrôle vérifie les deux moitiés — que le module échappe, et qu'aucun
 * retour ne se remette à fabriquer ses pages lui-même.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const lire = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");

function fichiersDe(dossier: string): string[] {
  const out: string[] = [];
  for (const entrée of readdirSync(`${ROOT}${dossier}`)) {
    const relatif = `${dossier}/${entrée}`;
    if (statSync(`${ROOT}${relatif}`).isDirectory()) out.push(...fichiersDe(relatif));
    else if (relatif.endsWith(".ts")) out.push(relatif);
  }
  return out;
}

const sansCommentaires = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

/** Le corps rendu, sans l'enveloppe. */
const corps = (html: string) => html.slice(html.indexOf("<body>") + 6, -"</body></html>".length);

export default defineSuite("Sécurité — les pages de retour OAuth n'exécutent rien", async (t) => {
  // =========================================================================
  // 1. LE MODULE ÉCHAPPE — sur les charges qui ont servi à constater la panne
  // =========================================================================
  const CHARGES = [
    "<img src=x onerror=alert(1)>",
    "<script>alert(1)</script>",
    `"><svg onload=alert(1)>`,
    `'><iframe srcdoc='<script>alert(1)</script>'>`,
    "javascript:alert(1)",
    "&lt;déjà échappé&gt;",
  ];

  for (const charge of CHARGES) {
    const échappé = escapeHtml(charge);
    // Aucun caractère capable d'ouvrir un élément ou de fermer un attribut ne
    // survit. `'` compte : une valeur d'attribut peut être délimitée ainsi.
    t.check(`« ${charge} » : plus aucun chevron ouvrant`, /</.test(échappé), false);
    t.check(`« ${charge} » : plus aucun chevron fermant`, />/.test(échappé), false);
    t.check(`« ${charge} » : plus aucun guillemet double`, /"/.test(échappé), false);
    t.check(`« ${charge} » : plus aucune apostrophe droite`, /'/.test(échappé), false);
    // L'esperluette d'abord : l'échapper en dernier produirait `&amp;lt;`, et
    // laisserait `&lt;` reconstructible.
    t.check(
      `« ${charge} » : l'esperluette est échappée en premier`,
      !/&(?!amp;|lt;|gt;|quot;|#39;)/.test(échappé),
      true,
    );
  }

  // =========================================================================
  // 2. LES DEUX PORTES D'ENTRÉE DU TEXTE ÉTRANGER
  // =========================================================================
  // `errorBody` et `successBody` sont les seules fonctions par lesquelles un
  // texte non maîtrisé atteint la page. Si l'une cessait d'échapper, tout le
  // reste ne servirait à rien.
  const charge = `<img src=x onerror=alert(1)>`;

  const erreur = errorBody(charge, charge);
  t.check("errorBody échappe le titre et le détail", /<img/.test(erreur), false);
  t.check("errorBody laisse toujours une sortie", /href="\/dashboard"/.test(erreur), true);

  const succès = successBody(charge, charge, "22222222-2222-4222-8222-222222222222");
  t.check("successBody échappe le titre et le détail", /<img/.test(succès), false);
  t.check(
    "successBody offre un lien de secours vers la boutique",
    /href="\/stores\/22222222-2222-4222-8222-222222222222"/.test(succès),
    true,
  );

  /*
    L'IDENTIFIANT DE BOUTIQUE EST ENCODÉ, PAS ÉCHAPPÉ — et il faut vérifier la
    bonne chose. `encodeURIComponent` ne touche pas aux lettres : chercher le
    mot « onmouseover » dans le résultat le trouve toujours, encodé ou non, et
    ne prouve donc rien. Ce qui compte est qu'aucun caractère ne puisse SORTIR
    de la valeur d'attribut — le guillemet qui la ferme, et le chevron qui
    fermerait l'élément.
  */
  const succèsIdSale = successBody("t", "d", `" onmouseover="alert(1)`);
  const href = /href="([^"]*)"/.exec(succèsIdSale)?.[1] ?? "";
  t.check("successBody produit bien un href", href.length > 0, true);
  t.check("l'identifiant ne peut pas fermer l'attribut", /["'<>]/.test(href), false);
  t.check("…et il reste bien encodé", href.includes("%22%20onmouseover"), true);

  // =========================================================================
  // 3. LA REDIRECTION, ELLE AUSSI, EST UNE VALEUR D'ATTRIBUT
  // =========================================================================
  const réponse = page("Titre", "<p>corps</p>", 200, `/stores/x" onload="alert(1)`);
  const html = await réponse.text();
  t.check("l'adresse de redirection est échappée", /onload="alert/.test(html), false);
  t.check("la redirection ne passe pas par un script", /<script/.test(html), false);
  t.check(
    "…mais bien par un rafraîchissement déclaratif",
    /<meta http-equiv="refresh"/.test(html),
    true,
  );
  // Le titre d'onglet est fourni par l'appelant : il vaut mieux qu'il le soit
  // aussi.
  const titreSale = await page(`</title><script>alert(1)</script>`, "x").text();
  t.check("le titre d'onglet est échappé", /<script/.test(titreSale), false);

  // Le corps, lui, est du HTML construit ici : il doit passer intact, sinon
  // `errorBody` et `successBody` ne pourraient rien mettre en forme.
  t.check("le corps construit ici passe intact", corps(html).includes("<p>corps</p>"), true);

  // =========================================================================
  // 4. AUCUN RETOUR NE REFABRIQUE SES PAGES
  // =========================================================================
  /*
    C'EST LA MOITIÉ QUI COMPTE VRAIMENT.

    Échapper dans un module partagé ne protège que ce qui passe par lui. La
    panne d'origine n'était pas un défaut d'échappement — c'était TROIS COPIES
    qui ont divergé. Un quatrième retour écrit sur le modèle des deux anciens
    ramènerait exactement la même faille, et tous les contrôles ci-dessus
    resteraient verts.
  */
  const retours = fichiersDe("src/routes/api/public/oauth").filter((f) =>
    f.endsWith("callback.ts"),
  );
  t.check("les trois retours OAuth sont bien trouvés", retours.length >= 3, true);

  for (const chemin of retours) {
    const source = sansCommentaires(lire(chemin));

    t.check(
      `${chemin} : les pages viennent du module partagé`,
      /from "@\/lib\/oauth-page\.server"/.test(source),
      true,
    );
    // Plus aucune fabrique locale : c'est elle qui permettait la divergence.
    t.check(
      `${chemin} : aucune fabrique de page locale`,
      /function htmlResponse\s*\(/.test(source),
      false,
    );
    t.check(
      `${chemin} : aucun document construit sur place`,
      /<!doctype html/i.test(source),
      false,
    );

    // La forme exacte qui a produit l'injection : du texte interpolé dans un
    // élément, sans passer par `errorBody` / `successBody`.
    t.check(
      `${chemin} : aucun texte interpolé directement dans un élément`,
      /<(?:h1|p|div|span)[^>]*>[^`]*\$\{/.test(source),
      false,
    );
    // Et plus de redirection par script, qui laisse le marchand bloqué quand
    // elle ne part pas.
    t.check(`${chemin} : aucune redirection par script`, /<script>/.test(source), false);
  }

  // =========================================================================
  // 5. CE QUE LE MARCHAND LIT NE NOMME NI SECRET NI RÉPONSE DE FOURNISSEUR
  // =========================================================================
  // Les réponses brutes des fournisseurs allaient dans la page. Elles vont
  // désormais au journal, où elles servent à réparer.
  for (const chemin of retours) {
    const source = sansCommentaires(lire(chemin));
    t.check(
      `${chemin} : la réponse brute du fournisseur ne va plus à la page`,
      /htmlResponse\([^)]{0,40}await \w+Res\.text\(\)/.test(source),
      false,
    );
    t.check(
      `${chemin} : le message interne ne va plus à la page`,
      /htmlResponse\(\s*`?[^)]{0,60}err instanceof Error \? err\.message/.test(source),
      false,
    );
    // La PostgrestError du `upsert` : un objet nu, que `String()` rendait
    // « [object Object] » sur la page qui suit l'autorisation.
    t.check(
      `${chemin} : l'échec d'enregistrement n'est plus relancé à l'aveugle`,
      /if \(error\) throw error;/.test(source),
      false,
    );
    t.check(
      `${chemin} : …il a sa propre page, qui dit que rien n'est actif`,
      /Autorisation reçue, mais pas enregistrée/.test(source),
      true,
    );
  }
});
