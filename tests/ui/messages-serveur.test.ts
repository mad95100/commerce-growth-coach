import { readdirSync, readFileSync, statSync } from "node:fs";
import { defineSuite } from "../harness";
import { messageMarchand, texteTechnique } from "../../src/lib/message-marchand";
import { renderErrorPage } from "../../src/lib/error-page";

/**
 * CE QUE LE MARCHAND LIT QUAND UN ÉCHEC REMONTE DU SERVEUR.
 *
 * LE DÉFAUT QUE CETTE SUITE EXISTE POUR EMPÊCHER. Quinze écrans écrivaient :
 *
 *     toast.error(err instanceof Error ? err.message : "<phrase pour le marchand>")
 *
 * `donneesOuLeve` construit une VRAIE `Error` à partir de la réponse PostgREST.
 * La condition était donc toujours vraie, la phrase de droite n'était jamais
 * affichée, et le marchand lisait le texte de Postgres — en anglais, avec le nom
 * de la table. Par le même chemin remontaient « AI Gateway 503: … », le corps
 * brut d'une réponse Meta, et `GOOGLE_ADS_DEVELOPER_TOKEN manquant` : le nom
 * d'un secret de serveur, dans une notification, à quelqu'un qui n'y a aucun
 * accès.
 *
 * POURQUOI UNE LISTE DE SIGNATURES EST ACCEPTABLE ICI. Une liste noire perd
 * toujours quand le corpus est ouvert — c'est la leçon de `faits-opposables.ts`,
 * où un modèle peut reformuler indéfiniment. Les messages levés par NOTRE code
 * sont un ensemble fermé : cette suite les relève tous dans les sources et
 * vérifie le classement de chacun. Le jour où quelqu'un ajoute un message
 * technique, ce contrôle échoue tant que personne n'a tranché son sort.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const lire = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");

function fichiersDe(dossier: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(`${ROOT}${dossier}`)) {
    const rel = `${dossier}/${e}`;
    if (statSync(`${ROOT}${rel}`).isDirectory()) out.push(...fichiersDe(rel));
    else if (/\.(ts|tsx)$/.test(e)) out.push(rel);
  }
  return out;
}

const sansCommentaires = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

export default defineSuite("Messages du serveur — ce que le marchand a le droit de lire", (t) => {
  // =========================================================================
  // 1. Le classement, sur des textes RÉELLEMENT rencontrés
  // =========================================================================

  /** Textes relevés en production ou dans les sources, et qui sont techniques. */
  const TECHNIQUES = [
    'new row violates row-level security policy for table "stores"',
    "permission denied for column access_token_ciphertext",
    "AI Gateway 503: upstream connect error",
    "AI Gateway 404: models/gemini-2.5-pro is no longer available to new users.",
    'Meta API 400: {"error":{"message":"Invalid parameter"}}',
    "Google Ads API 401: unauthorized",
    "Shopify: modification du produit refusée (422) champ inconnu",
    "GOOGLE_ADS_DEVELOPER_TOKEN manquant",
    "DATA_CONNECTIONS_ENCRYPTION_KEY manquant",
    "OAUTH_STATE_SECRET manquant",
    "Unauthorized: No authorization header provided",
    "[object Object]",
    '{"unhandled":true,"message":"HTTPError"}',
    "Rafraîchissement du token Google échoué : invalid_grant",
    "fetch failed",
    "JSON object requested, multiple (or no) rows returned",
    "Réponse IA illisible (JSON invalide). Relancez l'audit.",
  ];
  for (const texte of TECHNIQUES) {
    t.check(`technique : « ${texte.slice(0, 44)} »`, texteTechnique(texte), true);
  }

  /** Phrases écrites POUR un marchand : aucune ne doit être écartée. */
  const POUR_LE_MARCHAND = [
    "Votre boutique n'a pas pu être enregistrée. Vos réponses sont toujours à l'écran — réessayez dans un instant.",
    "La déconnexion n'a pas abouti. Shopify reste branché — réessayez dans un instant.",
    "Notre fournisseur d'analyse est momentanément saturé. Réessayez dans une minute : rien n'a été modifié sur votre boutique.",
    "La correction n'a pas pu être préparée. Le problème vient de chez nous, pas de votre boutique — réessayez dans un instant.",
    "Cette correction vient d'être appliquée. Rien n'a été fait deux fois.",
    "Cette boutique est introuvable.",
    "Aucune correction automatique n'a pu être préparée pour ce point. Rien n'a été modifié sur votre boutique.",
    "Vous avez utilisé vos 3 audits du mois. Le compteur repart le 1er du mois prochain.",
    "Votre quota n'a pas pu être décompté à cause d'un accès simultané. Réessayez dans un instant.",
  ];
  for (const texte of POUR_LE_MARCHAND) {
    t.check(`pour le marchand : « ${texte.slice(0, 44)} »`, texteTechnique(texte), false);
  }

  // =========================================================================
  // 2. La décision elle-même
  // =========================================================================
  const REPLI = "La lecture a échoué. Rien n'est perdu — réessayez dans un instant.";

  t.check(
    "un message technique laisse la place à la phrase de l'écran",
    messageMarchand(new Error("AI Gateway 500: boom"), REPLI),
    REPLI,
  );
  t.check(
    "une phrase écrite pour le marchand est affichée telle quelle",
    messageMarchand(new Error("Shopify reste branché — réessayez dans un instant."), REPLI),
    "Shopify reste branché — réessayez dans un instant.",
  );

  /*
    LE STATUT SUFFIT, MÊME SI LE TEXTE EST EN FRANÇAIS.

    Une politique d'accès peut très bien répondre une phrase française un jour.
    Ce n'est pas pour autant un message écrit pour le marchand : ce qui le
    disqualifie, c'est son ORIGINE. `donneesOuLeve` recopie `code` et `status`
    sur l'erreur qu'elle lève ; leur présence tranche avant toute lecture du
    texte.
  */
  const postgrest = Object.assign(new Error("La ligne demandée est absente"), {
    code: "PGRST116",
    status: 406,
  });
  t.check("l'origine PostgREST prime sur le texte", messageMarchand(postgrest, REPLI), REPLI);

  const avecStatutSeul = Object.assign(new Error("Accès refusé"), { status: 403 });
  t.check("un statut seul suffit", messageMarchand(avecStatutSeul, REPLI), REPLI);

  t.check(
    "une valeur qui n'est pas une erreur donne le repli",
    messageMarchand(null, REPLI),
    REPLI,
  );
  t.check("une chaîne vide donne le repli", messageMarchand(new Error("   "), REPLI), REPLI);
  t.check(
    "une trace entière n'est pas une phrase",
    messageMarchand(new Error("é".repeat(401)), REPLI),
    REPLI,
  );
  t.check(
    "une chaîne levée telle quelle est lue",
    messageMarchand("Votre objectif reste en place.", REPLI),
    "Votre objectif reste en place.",
  );

  // =========================================================================
  // 3. AUCUN MESSAGE TECHNIQUE NE PEUT ATTEINDRE UN ÉCRAN SANS PASSER PAR LÀ
  // =========================================================================
  /*
    Les fonctions serveur lèvent, et TanStack fait traverser le message jusqu'au
    navigateur : la classe de l'erreur, elle, ne traverse pas. Le seul endroit
    où la décision peut être prise est donc l'écran. Ce contrôle vérifie qu'AUCUN
    `toast.error` n'affiche encore une erreur sans passer par la décision.
  */
  const ecrans = [...fichiersDe("src/routes"), ...fichiersDe("src/components")].filter(
    (f) => !f.includes("/ui/"),
  );
  let attrapesRelevés = 0;
  for (const chemin of ecrans) {
    const source = sansCommentaires(lire(chemin)).replace(/\s+/g, " ");
    /*
      LA RÈGLE PORTE SUR CE QUI SORT D'UN `catch`, PAS SUR TOUT ARGUMENT.

      Une première version exigeait la décision devant TOUTE variable passée à
      `toast.error`. Elle relevait `toast.error(parsed.message)` et
      `toast.error(res.error)` — deux refus TYPÉS, dont le texte est écrit par
      nous, en français, pour le marchand : `parseStoreEconomics` valide un
      formulaire, `deleteStore` refuse une confirmation qui ne correspond pas.
      Ni l'un ni l'autre n'a jamais tenu un message de partenaire.

      Ce qui doit passer par la décision, c'est ce qu'on a ATTRAPÉ : là seulement
      le texte peut venir de Postgres, d'un partenaire ou du réseau.
    */
    for (const m of source.matchAll(/catch \((\w+)\) \{([\s\S]{0,400}?)\}/g)) {
      const [, variable, corps] = m;
      if (!/toast\.error\(/.test(corps)) continue;
      attrapesRelevés += 1;
      t.check(
        `${chemin} : le \`catch (${variable})\` passe par la décision`,
        new RegExp(`(?:messageMarchand|authErrorMessage)\\(\\s*${variable}\\b`).test(corps),
        true,
      );
    }
  }
  t.check("des blocs `catch` affichant un échec ont bien été relevés", attrapesRelevés >= 10, true);

  // =========================================================================
  // 4. LES DEUX CHEMINS DE CORRECTION DISENT LA MÊME CHOSE
  // =========================================================================
  /*
    `audit.functions.ts` avait reçu la correction ; `apply-fix.server.ts`, qui
    porte le VRAI chemin de la correction automatique, l'attendait encore. Deux
    chemins pour un même geste finissent par diverger — l'un reçoit une
    correction, pas l'autre.
  */
  const applique = sansCommentaires(lire("src/lib/apply-fix.server.ts"));
  t.check(
    "le corps brut du fournisseur ne remonte plus",
    /throw new Error\(`AI Gateway \$\{res\.status\}/.test(applique),
    false,
  );
  t.check("…il part au journal", /console\.error\(`\[correction\] AI Gateway/.test(applique), true);
  t.check("plus aucun tutoiement dans ce chemin", /\bréessaie\b/.test(applique), false);
  t.check("aucune promesse de crédits à racheter", /Crédits IA épuisés/.test(applique), false);

  // =========================================================================
  // 5. LA PAGE DE DERNIER RECOURS
  // =========================================================================
  /*
    Servie quand le rendu lui-même a échoué : c'est alors la seule chose que le
    marchand ait sous les yeux. Elle était entièrement en anglais, `lang="en"`
    compris, et son bouton « Try again » rechargeait par un gestionnaire
    JavaScript en ligne — la forme dont les trois retours OAuth ont déjà payé le
    prix : bloquée, la page n'offre plus aucune sortie.
  */
  const page = renderErrorPage("/audits/abc");
  t.check("la page est en français", /<html lang="fr">/.test(page), true);
  t.check(
    "aucun mot anglais résiduel",
    /Try again|Go home|didn't load|went wrong/.test(page),
    false,
  );
  t.check("aucun gestionnaire JavaScript en ligne", /onclick=/i.test(page), false);
  t.check("aucune balise de script", /<script/i.test(page), false);
  t.check("le marchand est renvoyé là où il était", page.includes('href="/audits/abc"'), true);
  t.check("une sortie vers l'accueil existe toujours", page.includes('href="/"'), true);
  t.check("elle dit de quel côté vient le problème", /vient de chez nous/.test(page), true);
  t.check("aucun détail technique", texteTechnique(page.replace(/<[^>]+>/g, " ")), false);

  /*
    UN CHEMIN ÉTRANGER NE DEVIENT PAS UN LIEN. La page reçoit le chemin demandé ;
    sans contrôle, une adresse absolue transformerait cet écran d'erreur en
    tremplin vers un autre site.
  */
  for (const hostile of [
    "https://exemple.test/piege",
    "//exemple.test",
    "javascript:alert(1)",
    '/ok" onmouseover="alert(1)',
  ]) {
    const rendu = renderErrorPage(hostile);
    t.check(`chemin hostile écarté : ${hostile.slice(0, 24)}`, rendu.includes('href="/"'), true);
    t.check(`…et non repris tel quel : ${hostile.slice(0, 24)}`, rendu.includes(hostile), false);
  }
});
