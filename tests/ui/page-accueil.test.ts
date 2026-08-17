import { readFileSync } from "node:fs";
import { defineSuite } from "../harness";

/**
 * LA PAGE QUI VEND DOIT PARLER COMME L'OUTIL QUI LIVRE.
 *
 * CE QUE LE VISITEUR LISAIT AVANT D'ENTRER. « Chaque jour sans audit = de
 * l'argent qui part », « Pas de blabla », « Que du chiffre d'affaires à
 * récupérer », « 3 étapes. Cash récupéré. », « Arrêtez de brûler votre
 * budget », « Un clic, un copier-coller, plus de ventes ».
 *
 * CE QU'IL LIT UNE FOIS ENTRÉ. « Nous n'avons pas cette donnée », « Ce que nous
 * n'avons pas pu mesurer », « Ce n'est pas un potentiel nul, c'est un potentiel
 * non mesuré », « Nous ne savons pas si cette correction… ».
 *
 * DEUX PERSONNALITÉS POUR UN SEUL PRODUIT. La première promet, la seconde
 * mesure — et c'est la seconde qui fait la valeur de l'outil. Un visiteur
 * recruté par la première se sent refroidi par la seconde ; il lit de la
 * prudence là où on lui avait vendu de la certitude, et conclut que le produit
 * est en retrait sur sa promesse. Alors que c'est l'inverse : la prudence EST
 * le produit.
 *
 * LE CAS LE PLUS COÛTEUX : LE CHIFFRE DÉCORATIF. La carte de démonstration
 * affiche un score de 42 et annonçait « Vous laissez ~2 400 €/mois sur la
 * table ». Rien ne disait que ces valeurs étaient inventées pour l'exemple. Sur
 * la page d'un produit dont l'argument central est de n'avancer aucun chiffre
 * qu'il ne peut pas justifier, un chiffre non justifié et non étiqueté est la
 * contradiction la plus chère qui soit — et elle est la première chose que le
 * visiteur regarde.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const lire = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");

const sansCommentaires = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const ACCUEIL = "src/routes/index.tsx";

export default defineSuite("Accueil — la vitrine parle comme le produit", (t) => {
  const brut = lire(ACCUEIL);
  const page = sansCommentaires(brut);

  // =========================================================================
  // 1. L'exemple est annoncé comme un exemple
  // =========================================================================
  t.check("la carte de démonstration est étiquetée", />Exemple</.test(page), true);
  t.check("…et dit de quoi elle est l'exemple", /à quoi ressemble un diagnostic/i.test(page), true);
  // Le montant inventé est retiré : un « ~2 400 €/mois » sans boutique derrière
  // est précisément ce que le moteur refuse d'écrire.
  t.check(
    "aucun gain chiffré n'est avancé sur la vitrine",
    /€\/mois sur la table/.test(page),
    false,
  );

  // =========================================================================
  // 2. Le vocabulaire de l'urgence fabriquée a disparu
  // =========================================================================
  // Chacune de ces phrases était réellement affichée. Elles sont interdites
  // nommément plutôt que par une règle floue : une interdiction qu'on ne peut
  // pas justifier ligne par ligne finit desserrée puis supprimée.
  for (const formule of [
    "Chaque jour sans audit",
    "Pas de blabla",
    "Cash récupéré",
    "Arrêtez de brûler votre budget",
    "Que du chiffre d'affaires à récupérer",
    "plus de ventes.",
  ]) {
    t.check(`« ${formule} » ne figure plus sur la vitrine`, page.includes(formule), false);
  }

  // =========================================================================
  // 3. Ce que la vitrine promet est ce que le produit fait réellement
  // =========================================================================
  // Chaque promesse ci-dessous est reliée à l'endroit du code qui la tient.
  // C'est la seule façon de garantir qu'elles ne redeviennent pas des slogans.
  const rapport = lire("src/routes/_authenticated/audits.$auditId.tsx");
  const actions = lire("src/lib/action-plan.ts");

  t.check(
    "la vitrine annonce que chaque constat montre sa preuve",
    /Chaque constat montre sa preuve/.test(page),
    true,
  );
  t.check("…et le rapport l'affiche réellement", /Sur quoi nous nous appuyons/.test(rapport), true);

  t.check(
    "la vitrine annonce que le chiffrage s'arrête où la mesure s'arrête",
    /Le chiffrage s'arrête où la mesure s'arrête/.test(page),
    true,
  );
  t.check(
    "…et le produit annonce bien un potentiel non mesuré plutôt que nul",
    /non mesuré/.test(lire("src/components/Cockpit.tsx")),
    true,
  );

  t.check(
    "la vitrine annonce une confirmation avant toute écriture",
    /vous confirmez avant toute écriture/.test(page),
    true,
  );
  t.check("…et le plan d'action exige bien cette confirmation", /confirm/i.test(actions), true);

  t.check("la vitrine annonce la réversibilité", /réversibles|revenir en arrière/.test(page), true);

  // La bandeau de tête ne promet plus une perte, il rassure sur l'accès —
  // ce qui est la vraie question d'un marchand qui va confier sa boutique.
  t.check(
    "le bandeau de tête rassure au lieu d'alarmer",
    /nous ne modifions rien sans votre accord/.test(page),
    true,
  );

  // =========================================================================
  // 4. Hiérarchie : aucune section sans titre, et un rythme régulier
  // =========================================================================
  // Le bloc de quatre cartes n'avait aucun titre : il apparaissait après un
  // grand vide, sans rien pour dire ce qu'il montrait.
  const sections = [...page.matchAll(/<section\b/g)].length;
  const titres = [...page.matchAll(/<h[12]\b/g)].length;
  t.check("la page a bien plusieurs sections", sections >= 3, true);
  t.check("chaque section porte un titre", titres >= sections, true);

  // `py-24` de part et d'autre créait vingt-quatre rem de vide entre deux
  // blocs — plus d'un écran de portable, où l'on croit la page terminée.
  t.check("aucune section ne rouvre l'écart de `py-24`", /<section[^>]*py-24/.test(page), false);
});
