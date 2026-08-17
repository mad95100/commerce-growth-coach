import { readdirSync, readFileSync, statSync } from "node:fs";
import { defineSuite } from "../harness";

/**
 * UNE SEULE VOIX, DU PREMIER ÉCRAN AU DERNIER.
 *
 * LE DÉFAUT, VISIBLE SUR UNE MÊME PAGE. Le rapport d'audit annonçait
 * « L'IA analyse ta boutique… », puis, trois blocs plus bas, « Nous n'avons pas
 * réussi à lire les données de votre boutique ». Le produit tutoyait sur les
 * écrans écrits en premier et vouvoyait dans tout ce que le moteur produit
 * depuis. Personne ne lit cela comme un choix : cela se lit comme un logiciel
 * assemblé par plusieurs mains qui ne se sont pas parlé — exactement ce qu'un
 * marchand hésite à laisser écrire dans sa boutique.
 *
 * POURQUOI « VOUS ». La promesse du produit est celle d'un consultant qui a
 * accompagné des centaines de boutiques. Un consultant vouvoie. Le tutoiement
 * appartenait au discours d'origine, tourné vers le débutant qu'on met à l'aise ;
 * il entre en contradiction avec un diagnostic qui refuse de conclure sans
 * preuve et annonce ses niveaux de confiance.
 *
 * CE QUI RESTE AU TUTOIEMENT, ET POURQUOI. Les consignes adressées au MODÈLE —
 * « Tu ne chiffres aucun gain qui ne figure pas en Montant constaté » — ne sont
 * lues par aucun marchand. Les convertir n'apporterait rien et alourdirait des
 * instructions dont la précision compte. Ces fichiers sont donc exclus
 * NOMMÉMENT : une exclusion par motif large finirait par couvrir un écran.
 *
 * POURQUOI UN TEST ET PAS UNE CONSIGNE. Un texte se réécrit à chaque nouvelle
 * fonctionnalité, souvent en copiant une phrase voisine. Sans contrôle
 * mécanique, la première page ajoutée après celle-ci rouvrira l'écart.
 */

const ROOT = new URL("../../", import.meta.url).pathname;

/**
 * Fichiers dont les textes s'adressent au MODÈLE, jamais au marchand.
 *
 * Liste nominative et volontairement fastidieuse à allonger : y ajouter un
 * fichier doit être un geste conscient, pas un effet de bord.
 */
const DESTINÉS_AU_MODÈLE = new Set([
  "src/lib/audit-prompt.ts",
  "src/lib/audit-rules.ts",
  "src/lib/audit-runner.server.ts",
  "src/lib/audit.functions.ts",
  "src/lib/apply-fix.server.ts",
  "src/lib/attempt-history.ts",
  "src/lib/audience.ts",
  "src/lib/cross-source.ts",
  "src/lib/diagnostics.ts",
  "src/lib/funnel.ts",
  "src/lib/observations.ts",
  "src/lib/root-cause.ts",
  "src/lib/snapshots.server.ts",
  "src/lib/storefront-experience.ts",
]);

/** Marqueurs du tutoiement. Chacun est sans ambiguïté une fois les mots isolés. */
const TUTOIEMENT = ["tu", "toi", "ta", "ton", "tes", "te"];

function fichiersDe(dossier: string): string[] {
  const out: string[] = [];
  for (const entrée of readdirSync(`${ROOT}${dossier}`)) {
    const relatif = `${dossier}/${entrée}`;
    if (statSync(`${ROOT}${relatif}`).isDirectory()) {
      out.push(...fichiersDe(relatif));
    } else if (relatif.endsWith(".ts") || relatif.endsWith(".tsx")) {
      out.push(relatif);
    }
  }
  return out;
}

/**
 * Retire les commentaires avant de juger.
 *
 * Les commentaires de ce dépôt expliquent le raisonnement à qui lit le code, et
 * c'est là que le tutoiement de travail a sa place. Les inclure interdirait de
 * documenter les modules que ce contrôle protège.
 */
function texteAffiché(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

export default defineSuite("Interface — une seule voix", (t) => {
  const fichiers = [
    ...fichiersDe("src/components"),
    ...fichiersDe("src/routes"),
    ...fichiersDe("src/lib"),
  ].filter((f) => !DESTINÉS_AU_MODÈLE.has(f));

  // GARDE-FOU DU RELEVÉ. Un parcours qui ne trouverait plus rien déclarerait le
  // produit irréprochable sans avoir rien lu.
  t.check("le relevé parcourt bien le produit", fichiers.length >= 40, true);

  for (const chemin of fichiers) {
    const contenu = texteAffiché(readFileSync(`${ROOT}${chemin}`, "utf8"));
    for (const mot of TUTOIEMENT) {
      // PAS `\b` : en JavaScript, une lettre accentuée n'est pas un caractère
      // de mot, si bien que `\bte\b` trouve « te » à l'intérieur de « coûte »
      // et `\btes\b` à l'intérieur de « êtes ». Le contrôle accusait alors des
      // fichiers irréprochables — et, pire, aurait fini par être desserré pour
      // les faire taire. On délimite donc sur les LETTRES, accents compris.
      const trouvé = new RegExp(`(^|[^\\p{L}])${mot}($|[^\\p{L}])`, "iu").test(contenu);
      t.check(`${chemin} n'emploie pas « ${mot} »`, trouvé, false);
    }
  }

  // Les écrans les plus lus disent bien « vous » — un fichier peut passer le
  // contrôle ci-dessus simplement en n'adressant personne.
  const parle = (chemin: string) => texteAffiché(readFileSync(`${ROOT}${chemin}`, "utf8"));
  t.check(
    "l'accueil s'adresse au marchand",
    /\bvotre boutique\b/i.test(parle("src/routes/index.tsx")),
    true,
  );
  t.check(
    "le rapport d'audit s'adresse au marchand",
    /\bvotre\b/i.test(parle("src/routes/_authenticated/audits.$auditId.tsx")),
    true,
  );
  t.check(
    "l'ajout de boutique s'adresse au marchand",
    /\bvotre boutique\b/i.test(parle("src/routes/_authenticated/onboarding.tsx")),
    true,
  );

  // Les consignes au modèle, elles, DOIVENT rester telles quelles : les
  // convertir par excès de zèle abîmerait des instructions dont la précision
  // compte, sans qu'aucun marchand n'y gagne quoi que ce soit.
  t.check(
    "les consignes au modèle gardent leur forme",
    /Tu es EcomPilot AI/.test(readFileSync(`${ROOT}src/lib/audit-prompt.ts`, "utf8")),
    true,
  );
});
