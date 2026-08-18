import { readdirSync, readFileSync, statSync } from "node:fs";
import { defineSuite } from "../harness";

/**
 * CE QUE L'APPLICATION DIT À QUI NE LA VOIT PAS.
 *
 * RELEVÉ DANS L'ARBRE D'ACCESSIBILITÉ DU NAVIGATEUR, page par page, en vue
 * bureau puis mobile. Trois défauts, tous vérifiés avant et après correction.
 *
 * 1. LE BOUTON QUI DÉCONNECTE NE DISAIT PAS SON NOM. En vue mobile, l'en-tête
 *    ne porte que le logo et une icône de sortie. Cette icône s'annonçait
 *    « button », sans plus : c'est la SEULE action de cet en-tête, et elle met
 *    fin à la session. Un utilisateur de lecteur d'écran ne pouvait pas savoir
 *    ce qu'il déclenchait avant de l'avoir déclenché.
 *
 * 2. UN CHAMP NOMMÉ PAR SON TEXTE D'EXEMPLE. Le champ « Votre objectif
 *    principal » n'avait ni `id`, ni étiquette reliée : le navigateur se
 *    rabattait sur son `placeholder`. Or un texte d'exemple disparaît à la
 *    première frappe — le champ perdait donc son nom au moment exact où le
 *    marchand écrivait dedans, c'est-à-dire quand il en avait besoin.
 *
 * 3. DES SAUTS DE NIVEAU DE TITRE. Quatre écrans passaient de `h1` à `h3` sans
 *    `h2`. La navigation par titres est le principal moyen de parcourir une
 *    page sans la voir : un niveau manquant y laisse un trou, et le lecteur ne
 *    peut plus savoir si ce qu'il lit dépend de ce qui précède.
 *
 * CE QUE CE CONTRÔLE NE FAIT PAS. Il ne calcule aucun nom accessible — seul un
 * navigateur le peut. Il protège les corrections posées, pour qu'un remaniement
 * ne les retire pas en silence.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const lire = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");

const sansCommentaires = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

function fichiersDe(dossier: string): string[] {
  const out: string[] = [];
  for (const entrée of readdirSync(`${ROOT}${dossier}`)) {
    const relatif = `${dossier}/${entrée}`;
    if (statSync(`${ROOT}${relatif}`).isDirectory()) out.push(...fichiersDe(relatif));
    else if (relatif.endsWith(".tsx")) out.push(relatif);
  }
  return out;
}

const ECRANS = [...fichiersDe("src/routes"), ...fichiersDe("src/components")].filter(
  (f) => !f.startsWith("src/components/ui/"),
);

export default defineSuite("Interface — ce qui est dit à qui ne voit pas l'écran", (t) => {
  t.check("les écrans sont bien trouvés", ECRANS.length >= 10, true);

  // =========================================================================
  // 1. Aucun bouton réduit à une icône sans nom
  // =========================================================================
  // On cherche la forme exacte du défaut : un `<Button>` dont le contenu se
  // limite à une icône, sans `aria-label`. C'est étroit et vérifiable — une
  // règle plus large accuserait les boutons qui portent une icône ET du texte,
  // qui n'ont eux aucun besoin d'étiquette.
  const ICONE_SEULE =
    /<Button(?![^>]*aria-label)[^>]*>\s*\{?\s*<[A-Z]\w+\s[^>]*\/>\s*\}?\s*<\/Button>/g;
  for (const chemin of ECRANS) {
    const source = sansCommentaires(lire(chemin));
    const nus = [...source.matchAll(ICONE_SEULE)];
    t.check(`${chemin} : aucun bouton-icône sans nom accessible`, nus.length, 0);
  }

  // Et la correction précise, nommée, sur l'en-tête mobile : c'est le seul
  // bouton de cet en-tête, et il déconnecte.
  const shell = sansCommentaires(lire("src/components/AppShell.tsx"));
  t.check(
    "la déconnexion mobile porte son nom",
    /onClick=\{signOut\} aria-label="Se déconnecter"/.test(shell),
    true,
  );

  // =========================================================================
  // 2. Aucun champ ne dépend de son texte d'exemple pour être nommé
  // =========================================================================
  // Un `placeholder` est un exemple, pas une étiquette : il disparaît dès la
  // première frappe. Chaque champ doit porter un `id` relié à un `<Label>`, ou
  // un `aria-label`/`aria-labelledby`.
  const CHAMP = /<(Input|Textarea)\b([^>]*)>/g;
  for (const chemin of ECRANS) {
    const source = sansCommentaires(lire(chemin));
    for (const m of source.matchAll(CHAMP)) {
      const attributs = m[2];
      const nommé =
        /\bid=/.test(attributs) ||
        /aria-label=/.test(attributs) ||
        /aria-labelledby=/.test(attributs);
      t.check(`${chemin} : <${m[1]}> nommé autrement que par son exemple`, nommé, true);
    }
  }

  t.check(
    "le champ d'objectif est relié au titre de sa carte",
    /aria-labelledby=\{`objectif-\$\{storeId\}`\}/.test(
      sansCommentaires(lire("src/routes/_authenticated/stores.$storeId.tsx")),
    ),
    true,
  );

  // =========================================================================
  // 3. Aucun saut de niveau de titre
  // =========================================================================
  // Les états vide et d'échec sont des SECTIONS de la page, pas des
  // sous-sections : posés en `h3` sous le `h1` d'un écran sans `h2`, ils
  // creusaient un trou dans la navigation par titres.
  t.check(
    "l'état vide est une section de premier rang",
    /<h2 className="mt-4 font-display/.test(shell),
    true,
  );
  t.check(
    "l'état d'échec aussi",
    (shell.match(/<h2 className="mt-4 font-display/g) ?? []).length >= 2,
    true,
  );

  const rapport = sansCommentaires(lire("src/routes/_authenticated/audits.$auditId.tsx"));
  t.check(
    "les titres de constat sont des sections sous le verdict",
    /<h2 className=\{`mt-2 font-display/.test(rapport),
    true,
  );
  t.check(
    "aucun titre de constat n'est resté en h3",
    /<h3[^>]*>\s*\{finding\.title\}/.test(rapport),
    false,
  );

  const tableau = sansCommentaires(lire("src/routes/_authenticated/dashboard.tsx"));
  t.check(
    "les cartes de boutique sont des sections sous le titre de page",
    /<h2 className="mt-1 truncate font-display/.test(tableau),
    true,
  );

  // =========================================================================
  // 4. Ce qui existait déjà et ne doit pas se perdre
  // =========================================================================
  t.check(
    "la langue du document est déclarée",
    /lang="fr"/.test(lire("src/routes/__root.tsx")),
    true,
  );
  t.check(
    "la barre de navigation est nommée",
    /aria-label="Navigation principale"/.test(shell),
    true,
  );
  t.check("la page courante est signalée", /aria-current=\{active \? "page"/.test(shell), true);
  t.check(
    "les zones d'attente sont annoncées",
    /role="status"/.test(shell) && /aria-busy="true"/.test(shell),
    true,
  );
});
