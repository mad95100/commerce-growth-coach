import { readdirSync, readFileSync, statSync } from "node:fs";
import { defineSuite } from "../harness";

/**
 * LE PRODUIT PARLE COMME UN CONSULTANT, PAS COMME UNE CHECKLIST.
 *
 * CE QUE CETTE SUITE GARDE. Le vouvoiement est déjà vérifié ailleurs, et
 * l'absence de jargon aussi. Ce qui manquait est plus insidieux : des phrases
 * grammaticalement irréprochables, polies, et vides — « il est important de »,
 * « pensez à », « optimisez votre boutique ». Elles ne sont fausses nulle part,
 * ce qui les rend impossibles à corriger par un test de vérité ; elles sont
 * simplement interchangeables d'une boutique à l'autre, et c'est exactement ce
 * qui distingue une checklist d'un diagnostic.
 *
 * LA SECONDE PROTECTION porte sur les consignes envoyées au modèle. Elles
 * ordonnaient « Tutoie l'utilisateur » et « Parle comme un mentor bienveillant »
 * — l'inverse de ce que tout le reste du produit vérifie. Le rapport est le
 * texte le plus lu d'EcomPilot, et il était le seul écrit sous des consignes
 * contraires.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const lire = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");

function fichiersDe(dossier: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(`${ROOT}${dossier}`)) {
    const rel = `${dossier}/${e}`;
    if (statSync(`${ROOT}${rel}`).isDirectory()) out.push(...fichiersDe(rel));
    else if (rel.endsWith(".ts") || rel.endsWith(".tsx")) out.push(rel);
  }
  return out;
}

/** Les commentaires expliquent le code : ils ne s'adressent à aucun marchand. */
const sansCommentaires = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

/**
 * Formules qui ne disent rien de la boutique qu'on regarde.
 *
 * Chacune est vraie de n'importe quel site, donc aucune n'est un diagnostic.
 * Elles sont cherchées dans les ÉCRANS, là où le marchand les lirait — les
 * consignes au modèle les citent au contraire pour les interdire, et le
 * contrôle ne doit pas confondre l'interdiction avec l'infraction.
 */
const FORMULES_CREUSES = [
  "il est important de",
  "pensez à ",
  "optimisez votre boutique",
  "améliorez votre conversion",
  "rendez votre boutique plus attractive",
  "votre boutique n'est pas optimisée",
  "cela peut faire fuir",
  "les visiteurs risquent de",
];

export default defineSuite("Éditorial — le produit parle comme un consultant", (t) => {
  const ecrans = [...fichiersDe("src/routes"), ...fichiersDe("src/components")];
  t.check("le relevé parcourt bien les écrans", ecrans.length >= 30, true);

  for (const chemin of ecrans) {
    const texte = sansCommentaires(lire(chemin)).toLowerCase();
    for (const formule of FORMULES_CREUSES) {
      t.check(`${chemin} ne dit pas « ${formule.trim()} »`, texte.includes(formule), false);
    }
  }

  // =========================================================================
  // LES CONSIGNES AU MODÈLE PORTENT LA MÊME EXIGENCE
  // =========================================================================
  const consignes = lire("src/lib/audit-prompt.ts");
  t.check("elles imposent le vouvoiement", /VOUVOIEMENT partout/.test(consignes), true);
  t.check("…et n'ordonnent plus de tutoyer", /Tutoie l'utilisateur/.test(consignes), false);
  t.check(
    "…et bannissent le ton de mentor encourageant",
    /mentor bienveillant|Encourage systématiquement/.test(consignes),
    false,
  );
  t.check(
    "…et interdisent les formules creuses par leur nom",
    FORMULES_CREUSES.filter((f) => consignes.toLowerCase().includes(f.trim())).length >= 3,
    true,
  );
  t.check(
    "…et rappellent que la portée n'est pas un effet de style",
    /Cinq fiches inspectées ne sont pas "votre catalogue"/.test(consignes),
    true,
  );
  t.check("…et exigent la recopie littérale de la preuve", /MOT POUR MOT/.test(consignes), true);
  t.check(
    "…et interdisent d'inventer un gain",
    /N'inventez JAMAIS une métrique, un pourcentage de gain/.test(consignes),
    true,
  );

  // =========================================================================
  // PRIORITÉ ET CERTITUDE NE SE CONFONDENT JAMAIS À L'ÉCRAN
  // =========================================================================
  /*
    Deux pastilles se suivaient sur chaque carte — « Critique » puis « Mesuré » —
    sans que rien ne dise qu'elles répondent à deux questions différentes. Un
    lecteur pressé les additionne, et conclut qu'un constat critique est un
    constat certain. Ce sont deux axes indépendants : un constat peut être
    critique et hypothétique, ou secondaire et mesuré.
  */
  const rapport = lire("src/routes/_authenticated/audits.$auditId.tsx");
  t.check("la pastille de priorité se nomme", /Priorité : critique/.test(rapport), true);
  t.check("…jusque dans ses degrés faibles", /Priorité : opportunité/.test(rapport), true);
  t.check(
    "la pastille de certitude se nomme",
    /Certitude : \{EPISTEMIC_LABELS/.test(rapport),
    true,
  );
  t.check(
    "le rapport nomme le diagnostic, pas un vague « pourquoi »",
    /> ?Diagnostic ?</.test(rapport),
    true,
  );
  t.check(
    "…et ce que le problème empêche, plutôt qu'un mot seul",
    /Ce que cela empêche/.test(rapport),
    true,
  );
  // Un manque de donnée ne se referme pas sur lui-même : il dit ce qu'il
  // interdit de conclure.
  t.check(
    "une donnée manquante dit ce qu'elle empêche",
    /nous ne pouvons ni les chiffrer, ni les classer/.test(rapport),
    true,
  );
  // Et une note absente s'explique au lieu de ressembler à une panne.
  t.check("une note absente s'explique", /Nous n'attribuons pas de note/.test(rapport), true);
});
