import { readdirSync, readFileSync, statSync } from "node:fs";
import { defineSuite } from "../harness";

/**
 * ON NE DEMANDE PAS AU MARCHAND CE QU'IL NE PEUT PAS FAIRE.
 *
 * LE DÉFAUT, EN TROIS ENDROITS. Le retour Shopify non authentifié affichait :
 * « vérifie que SHOPIFY_CLIENT_SECRET correspond bien à l'app Shopify
 * utilisée ». La page qui manquait ses identifiants annonçait :
 * « SHOPIFY_CLIENT_ID ou SHOPIFY_CLIENT_SECRET manque côté serveur ». Et le
 * bouton « Connecter Meta » remontait dans une notification :
 * « META_CLIENT_ID non configuré. Ajoutez les clés Meta dans les secrets. »
 *
 * CE QUE CELA PRODUIT. Le marchand n'a aucun accès aux secrets du serveur : on
 * lui donne à faire une chose impossible, au moment exact où il vient de nous
 * confier l'accès à sa boutique. Il ne lit pas « la panne est chez eux » — il
 * lit une consigne, la cherche, ne la trouve pas, et conclut que son compte est
 * en cause. Une phrase qui désigne une action irréalisable est pire que le
 * silence : le silence, au moins, n'envoie personne chercher.
 *
 * ET LE NOM DE LA VARIABLE A UN BON ENDROIT : le journal du serveur. C'est là
 * qu'on le cherche quand on répare, et c'est le seul endroit où quelqu'un peut
 * en faire quelque chose. Les corrections ne l'ont donc pas supprimé, elles
 * l'ont déplacé.
 *
 * CE QUE CE CONTRÔLE COUVRE, ET PAS PLUS. Les deux chemins par lesquels un
 * message de serveur atteint réellement le marchand :
 *
 *   1. `errorBody(...)` dans les retours OAuth publics — du HTML rendu dans son
 *      navigateur, sans rien entre lui et le texte.
 *   2. Les `throw` des fonctions serveur `*.functions.ts` — l'interface les
 *      affiche telles quelles, `toast.error(err.message)`, dans cinq écrans.
 *
 * Les erreurs qui n'empruntent NI l'un NI l'autre gardent le droit de nommer
 * une variable : celles du moteur d'audit, par exemple, ne sont jamais réémises
 * telles quelles — `explainAuditFailure` les reclasse en un message écrit pour
 * le marchand. Interdire le nom partout aurait donc appauvri les journaux sans
 * rien gagner pour personne.
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

/** Nom de variable d'environnement : préfixe connu, capitales, souligné. */
const NOM_DE_SECRET =
  /\b(?:SHOPIFY|META|GOOGLE|SUPABASE|AI|OAUTH|DATA_CONNECTIONS|APP|VITE)_[A-Z][A-Z0-9_]{2,}\b/;

/**
 * Le contenu d'un appel, parenthèses comptées.
 *
 * Une expression régulière ne peut pas délimiter un appel dont un argument
 * contient lui-même des parenthèses, et les messages de ce produit en
 * contiennent. On compte donc, plutôt que de deviner.
 */
function appels(source: string, ouverture: RegExp): string[] {
  const out: string[] = [];
  const global = new RegExp(ouverture.source, "g");
  for (const m of source.matchAll(global)) {
    let i = m.index! + m[0].length;
    let profondeur = 1;
    let corps = "";
    while (i < source.length && profondeur > 0) {
      const c = source[i]!;
      if (c === "(") profondeur++;
      else if (c === ")") profondeur--;
      if (profondeur > 0) corps += c;
      i++;
    }
    out.push(corps);
  }
  return out;
}

const sansCommentaires = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

export default defineSuite("Interface — aucun message ne renvoie le marchand à un secret", (t) => {
  // =========================================================================
  // 1. Les pages d'erreur des retours OAuth publics
  // =========================================================================
  const retours = fichiersDe("src/routes/api/public/oauth");
  t.check("les retours OAuth sont bien trouvés", retours.length >= 3, true);

  let pagesRelevées = 0;
  for (const chemin of retours) {
    const source = sansCommentaires(lire(chemin));
    for (const corps of appels(source, /errorBody\s*\(/)) {
      pagesRelevées++;
      t.check(
        `${chemin} : une page d'erreur ne nomme pas de secret`,
        NOM_DE_SECRET.test(corps),
        false,
      );
    }
  }
  // GARDE-FOU DU RELEVÉ. Si `errorBody` était renommé, la boucle ci-dessus ne
  // trouverait plus rien et se déclarerait conforme sans avoir lu une page.
  t.check("des pages d'erreur ont bien été relevées", pagesRelevées >= 5, true);

  // =========================================================================
  // 2. Les erreurs que l'interface affiche telles quelles
  // =========================================================================
  const serveur = [...fichiersDe("src/lib")].filter((f) => f.endsWith(".functions.ts"));
  t.check("les fonctions serveur sont bien trouvées", serveur.length >= 8, true);

  let jetsRelevés = 0;
  for (const chemin of serveur) {
    const source = sansCommentaires(lire(chemin));
    for (const corps of appels(source, /throw new Error\s*\(/)) {
      jetsRelevés++;
      t.check(
        `${chemin} : une erreur montrée au marchand ne nomme pas de secret`,
        NOM_DE_SECRET.test(corps),
        false,
      );
      // LE NOM PEUT ÊTRE ASSEMBLÉ À L'EXÉCUTION, et c'est ainsi qu'un message
      // est passé : « Connexion Shopify impossible : ${missing.join(", ")}
      // manquant(s) côté serveur. Ajoutez ces clés dans les secrets du projet. »
      // Les quatre noms de secrets étaient bien là, mais dans une VARIABLE — la
      // recherche de littéraux ne pouvait pas les voir, et la phrase demandait
      // au marchand d'aller modifier des secrets auxquels il n'a aucun accès.
      //
      // On ne peut pas deviner ce que contiendra une interpolation. On cherche
      // donc la CONSIGNE, qui est le vrai défaut : un message d'interface ne
      // demande jamais de toucher aux secrets ou à la configuration du serveur.
      t.check(
        `${chemin} : une erreur montrée au marchand ne lui demande pas d'agir sur le serveur`,
        /(?:ajoutez|renseignez|configurez|définissez|vérifiez)[^"'`]{0,60}(?:secrets?|variables? d'environnement|configuration du (?:serveur|projet))/i.test(
          corps,
        ),
        false,
      );
      t.check(
        `${chemin} : une erreur montrée au marchand n'invoque pas « côté serveur »`,
        /côté serveur/i.test(corps),
        false,
      );
    }
  }
  t.check("des erreurs ont bien été relevées", jetsRelevés >= 10, true);

  // C'EST BIEN L'INTERFACE QUI LES AFFICHE. Sans cette vérification, la règle
  // ci-dessus reposerait sur une croyance ; elle repose ici sur le code.
  const affiche = ["src/components/ConnectionsPanel.tsx", "src/routes/_authenticated/settings.tsx"];
  for (const écran of affiche) {
    t.check(
      `${écran} affiche bien le message d'erreur tel quel`,
      /toast\.error\(err instanceof Error \? err\.message/.test(lire(écran)),
      true,
    );
  }

  // =========================================================================
  // 3. Le nom déplacé, pas supprimé
  // =========================================================================
  // La correction consistait à mettre la variable au journal. Si elle en
  // disparaissait, on aurait échangé un mauvais message contre une panne muette
  // — et personne ne saurait plus quoi brancher.
  for (const [fichier, variable] of [
    ["src/lib/connectors/meta.functions.ts", "META_CLIENT_ID"],
    ["src/lib/connectors/google.functions.ts", "GOOGLE_CLIENT_ID"],
    ["src/routes/api/public/oauth/shopify/callback.ts", "SHOPIFY_CLIENT_SECRET"],
  ] as const) {
    const source = lire(fichier);
    const journal = appels(sansCommentaires(source), /console\.error\s*\(/).join("\n");
    t.check(`${variable} est nommée dans le journal`, journal.includes(variable), true);
  }

  // Et la phrase lue par le marchand dit à qui incombe la suite : c'est ce qui
  // le dispense de chercher.
  const meta = lire("src/lib/connectors/meta.functions.ts");
  t.check("le marchand est dispensé d'agir", /Rien à faire de votre côté/.test(meta), true);
  const shopify = lire("src/routes/api/public/oauth/shopify/callback.ts");
  t.check(
    "et la page Shopify dit que rien n'a été enregistré",
    /Rien n'a été enregistré/.test(shopify),
    true,
  );
});
