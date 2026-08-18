import { readdirSync, readFileSync, statSync } from "node:fs";
import { defineSuite } from "../harness";
import { codeHttp, estDefinitive, delaiAvantNouvelEssai } from "../../src/lib/query-retry";

/**
 * DEUX DÉFAUTS MESURÉS AU NAVIGATEUR, SUR DE VRAIES RÉPONSES EN ÉCHEC.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 1. LE MARCHAND RECEVAIT LE MOT « ERREUR », SEUL.
 *
 * Relevé sur une réponse 403 réelle, dans le navigateur :
 *
 *     const r = await supabase.from("stores").select("*");
 *     r.error instanceof Error   →  false
 *     r.error.constructor.name   →  "Object"
 *
 * PostgREST ne rend pas une `Error` : il rend un objet nu. Or toute l'interface
 * écrit `toast.error(err instanceof Error ? err.message : "Erreur")`. Le test
 * était donc TOUJOURS faux pour cette classe d'échec, et le marchand qui n'a pas
 * pu enregistrer son modèle économique, son objectif, son profil ou sa nouvelle
 * boutique lisait un seul mot : « Erreur ». Pas la raison, pas le geste suivant.
 * C'est le pire message possible — il dit que quelque chose a cassé, et rien
 * d'autre.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 2. HUIT SECONDES ET DEMIE D'OSSATURE AVANT LE MOINDRE MOT.
 *
 * Chronométré : sur une lecture en échec, la page boutique affichait son
 * ossature de chargement pendant 8,5 s avant d'annoncer quoi que ce soit. Rien
 * n'était cassé — c'est le réglage par défaut de React Query : trois nouveaux
 * essais espacés de 1 s, 2 s puis 4 s, et l'état d'échec seulement après.
 *
 * Le marchand, lui, regarde une page qui charge sans fin. Au bout de trois ou
 * quatre secondes il recharge, ce qui remet le compteur à zéro et reconstruit
 * la même attente. Après correction : 3,1 s, et l'attente ne sert plus qu'aux
 * pannes qui peuvent réellement s'arranger.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ET LES DEUX SE TENAIENT. `if (error) throw error` jetait l'objet d'erreur
 * seul, alors que le STATUT HTTP vit sur la RÉPONSE (`r.status → 403`). En le
 * perdant, plus rien ne pouvait distinguer un refus définitif d'une coupure
 * passagère : un 403 était rejoué trois fois comme une panne réseau.
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

export default defineSuite("Lecture en échec — ce que le marchand voit, et quand", (t) => {
  // =========================================================================
  // 1. Le statut est relevé, quelle que soit la forme de l'erreur
  // =========================================================================
  t.check("statut lu depuis `status`", codeHttp({ status: 403 }), 403);
  t.check("statut lu depuis `statusCode`", codeHttp({ statusCode: 500 }), 500);
  t.check("statut lu depuis une réponse imbriquée", codeHttp({ response: { status: 404 } }), 404);
  t.check("statut lu depuis une chaîne", codeHttp({ status: "429" }), 429);
  t.check("erreur sans statut", codeHttp({ message: "réseau coupé" }), null);
  t.check("valeur non objet", codeHttp("boom"), null);
  t.check("valeur nulle", codeHttp(null), null);
  // UN CODE POSTGREST N'EST PAS UN STATUT HTTP. « PGRST116 » passé à `Number`
  // rend `NaN` ; le confondre avec un code de retour classerait n'importe quoi.
  t.check(
    "un code PostgREST textuel n'est pas pris pour un statut",
    codeHttp({ code: "PGRST116" }),
    null,
  );
  t.check("un nombre hors plage HTTP est refusé", codeHttp({ status: 99 }), null);
  t.check("un nombre hors plage HTTP est refusé (haut)", codeHttp({ status: 600 }), null);

  // =========================================================================
  // 2. Ce qui ne s'arrangera pas n'est pas rejoué
  // =========================================================================
  for (const code of [400, 401, 403, 404, 406, 409, 422]) {
    t.check(`${code} est définitif`, estDefinitive({ status: code }), true);
  }
  // 408 et 429 sont des refus TEMPORAIRES : redemander est la bonne réponse.
  for (const code of [408, 429, 500, 502, 503, 504]) {
    t.check(`${code} reste passager`, estDefinitive({ status: code }), false);
  }
  // UNE ERREUR INCONNUE EST TRAITÉE COMME PASSAGÈRE, délibérément : une coupure
  // réseau ne porte aucun code, et c'est le cas où réessayer sert. Se tromper
  // ainsi coûte une seconde ; l'inverse priverait le produit de sa tolérance.
  t.check("une erreur sans statut reste passagère", estDefinitive({ message: "réseau" }), false);
  t.check("une erreur non objet reste passagère", estDefinitive("boom"), false);

  // =========================================================================
  // 3. L'attente est plafonnée
  // =========================================================================
  t.check("premier délai court", delaiAvantNouvelEssai(0), 400);
  t.check("deuxième délai doublé", delaiAvantNouvelEssai(1), 800);
  // LE DÉFAUT DE LA BIBLIOTHÈQUE MONTE À TRENTE SECONDES. Sur un écran qu'on
  // regarde, une attente pareille est indiscernable d'une panne.
  t.check("le délai est plafonné", delaiAvantNouvelEssai(10), 2000);
  t.check("…et le plafond tient loin", delaiAvantNouvelEssai(50), 2000);

  // =========================================================================
  // 4. La politique est bien branchée sur le client de requêtes
  // =========================================================================
  const routeur = sansCommentaires(lire("src/router.tsx"));
  t.check("le client de requêtes est configuré", /defaultOptions:/.test(routeur), true);
  t.check("les lectures consultent la politique", /!estDefinitive\(erreur\)/.test(routeur), true);
  t.check("le nombre d'essais est borné", /nombreEchecs < 2/.test(routeur), true);
  t.check("le délai plafonné est utilisé", /retryDelay: delaiAvantNouvelEssai/.test(routeur), true);
  // UNE ÉCRITURE NE SE REJOUE JAMAIS SEULE. Le produit modifie de vraies
  // boutiques : un budget, un code promo, une fiche produit. Une requête partie
  // dont la réponse s'est perdue serait rejouée, et l'écriture s'appliquerait
  // deux fois.
  t.check(
    "les écritures ne sont jamais rejouées",
    /mutations: \{[\s\S]{0,200}retry: false/.test(routeur),
    true,
  );

  // =========================================================================
  // 5. Plus aucune erreur de lecture ne perd son statut ni son type
  // =========================================================================
  const ECRANS = [...fichiersDe("src/routes"), ...fichiersDe("src/components")].filter(
    (f) => !f.startsWith("src/components/ui/"),
  );

  let relevés = 0;
  for (const chemin of ECRANS) {
    const source = sansCommentaires(lire(chemin));
    if (!/supabase\s*\n?\s*\.from\(|supabase\.from\(/.test(source)) continue;
    relevés++;
    // La forme exacte qui jetait le statut, interdite littéralement.
    t.check(
      `${chemin} : ne jette plus l'erreur nue`,
      /if \(error\) throw error;/.test(source),
      false,
    );
    t.check(
      `${chemin} : passe par le passeur qui conserve le statut`,
      /donneesOuLeve\(/.test(source),
      true,
    );
  }
  t.check("des écrans lisant la base ont bien été relevés", relevés >= 5, true);

  // =========================================================================
  // 6. Le passeur construit une VRAIE `Error`
  // =========================================================================
  const passeur = sansCommentaires(lire("src/integrations/supabase/throw-on-error.ts"));
  t.check(
    "une véritable `Error` est construite",
    /new Error\(error\.message\)/.test(passeur),
    true,
  );
  t.check("le statut y est attaché", /levee\.status = status/.test(passeur), true);
  t.check("le code PostgREST est conservé", /levee\.code = error\.code/.test(passeur), true);
  // Sans ça, `err instanceof Error` reste faux et l'interface réaffiche
  // « Erreur » — c'était tout le défaut.
  t.check(
    "les écrans testent bien `instanceof Error` avant d'afficher",
    /err instanceof Error \? err\.message/.test(
      lire("src/routes/_authenticated/stores.$storeId.tsx"),
    ),
    true,
  );

  // GoTrue EST HORS SUJET, ET C'EST VOLONTAIRE. Les erreurs d'authentification
  // sont déjà de vraies `Error`, et `authErrorMessage` les traduit en français
  // avec le geste suivant. Les faire passer par le même chemin remplacerait une
  // phrase écrite pour le marchand par le message brut de Supabase, en anglais.
  const auth = sansCommentaires(lire("src/routes/auth.tsx"));
  t.check("l'écran de connexion garde son traducteur", /authErrorMessage\(err\)/.test(auth), true);
  t.check("…et n'utilise pas le passeur PostgREST", /donneesOuLeve/.test(auth), false);
});
