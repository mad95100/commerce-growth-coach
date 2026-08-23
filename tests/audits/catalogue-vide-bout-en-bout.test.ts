import { defineSuite } from "../harness";
import { shopifyObservations } from "@/lib/connectors/shopify-observe";
import { storefrontObservations } from "@/lib/connectors/storefront";
import type { FetchedPage, StorefrontRaw } from "@/lib/connectors/storefront";
import { analyse, rulesToPromptBlock } from "@/lib/audit-rules";
import { sanitizeAuditPayload } from "@/lib/audit-sanitize";
import { confronter, faitsEtablis } from "@/lib/faits-opposables";

/**
 * PRODUCT_COUNT = 0, JUSQU'AU TEXTE FINAL.
 *
 * POURQUOI CETTE SUITE EXISTE ALORS QUE TOUT EST DÉJÀ TESTÉ. Chaque couche
 * avait ses contrôles, et ils passaient tous. Le rapport réel se contredisait
 * quand même :
 *
 *   Constat [1] — « Votre boutique ne propose aucun produit à la vente »
 *   Constat [3] — « Ce que nous supposons : Le catalogue contient des produits
 *                   actifs et publiés dans l'administration Shopify, mais aucun
 *                   lien n'a été créé pour les afficher sur la page d'accueil. »
 *
 * Les deux phrases dans le MÊME rapport, à deux constats d'écart. Pire que
 * fausse, la seconde inventait une CAUSE ALTERNATIVE — des produits mal reliés
 * — là où la vraie était déjà établie, et envoyait le marchand créer des liens
 * vers des produits inexistants.
 *
 * Aucun test unitaire ne pouvait voir cela : le défaut ne vivait DANS aucune
 * couche, il vivait entre elles. Cette suite part donc des données brutes de
 * Shopify et va jusqu'au texte que le marchand lira, en injectant au passage la
 * réponse de modèle qui a réellement produit la contradiction.
 *
 * Elle échoue si UNE SEULE couche laisse passer une phrase qui suppose que des
 * produits existent.
 */

const page = (
  role: string,
  url: string,
  html: string | null,
  status: number | null = 200,
): FetchedPage =>
  ({ url, role, status, elapsedMs: 240, bytes: html?.length ?? 0, html }) as FetchedPage;

const sonde = (chemin: string, status: number | null): FetchedPage =>
  ({
    url: `https://ecom-pilot-test.myshopify.com/policies/${chemin}`,
    role: "politique",
    status,
    elapsedMs: null,
    bytes: null,
    html: null,
  }) as FetchedPage;

/** L'accueil réel de la boutique : pas de titre, pas d'appel à l'action. */
const ACCUEIL = `<html><head><title>Ecom Pilot</title></head><body>
<p>Bienvenue</p><a href="/a">un</a><a href="/b">deux</a></body></html>`;

const VITRINE = {
  origin: "https://ecom-pilot-test.myshopify.com",
  pages: [
    page("accueil", "https://ecom-pilot-test.myshopify.com/", ACCUEIL),
    sonde("refund-policy", 200),
    sonde("shipping-policy", 200),
    sonde("terms-of-service", 200),
  ],
  robotsTxt: null,
  unchecked: [],
  linkChecks: [],
  landingChecks: [],
  sampleOrigin: { vitrine: 0, catalogue: 0 },
  catalogueKnown: true,
} as unknown as StorefrontRaw;

/**
 * La réponse du modèle, telle qu'elle a réellement été rendue.
 *
 * La contradiction est recopiée MOT POUR MOT du rapport de production : c'est
 * ce qui donne sa valeur à ce contrôle. Une formulation inventée pour
 * l'occasion prouverait seulement que le filtre attrape ce qu'il attend.
 */
const REPONSE_DU_MODELE = {
  verdict: "Votre boutique est prête techniquement mais n'expose pas son offre.",
  summary: "Le catalogue contient des produits actifs et publiés dans l'administration Shopify.",
  findings: [
    {
      key: "catalogue-vide",
      caused_by: [],
      category: "produit",
      severity: "critical",
      title: "Votre boutique ne propose aucun produit à la vente",
      root_cause: "Aucun produit n'est enregistré dans le catalogue Shopify.",
      impact_description: "Aucune commande ne peut être passée tant qu'il n'y a rien à commander.",
      estimated_gain_min: 0,
      estimated_gain_max: 0,
      action_steps: ["Créer un premier produit."],
      timeframe: "this_week",
      difficulty: 2,
      time_minutes: 30,
      confidence: "high",
      evidence: { based_on: "0 produits (Shopify /products/count.json)", assumptions: "" },
    },
    {
      key: "acces-produits",
      caused_by: [],
      category: "boutique",
      severity: "high",
      title: "Aucun chemin d'accès vers vos produits n'est visible sur la page d'accueil",
      root_cause: "La page d'accueil ne propose aucun menu ni bouton vers les produits.",
      impact_description:
        "Les produits actifs du catalogue restent inatteignables depuis la page d'accueil.",
      estimated_gain_min: 0,
      estimated_gain_max: 0,
      action_steps: ["Ajouter un menu."],
      timeframe: "this_week",
      difficulty: 2,
      time_minutes: 30,
      confidence: "medium",
      evidence: {
        based_on: "Aucun lien de collection depuis l'accueil",
        // LA PHRASE EXACTE DU RAPPORT DE PRODUCTION.
        assumptions:
          "Le catalogue contient des produits actifs et publiés dans l'administration Shopify, mais aucun lien n'a été créé pour les afficher sur la page d'accueil.",
      },
    },
  ],
};

export default defineSuite("Catalogue vide — de la mesure au texte final", (t) => {
  // =========================================================================
  // 1. LA COLLECTE : le fait est compté, pas déduit
  // =========================================================================
  const shopify = shopifyObservations({
    currency: "EUR",
    productCount: 0,
    products: [],
    orders: [],
    abandonedCheckouts: null,
    funnel: null,
  } as unknown as Parameters<typeof shopifyObservations>[0]);

  const compte = shopify.observations.find((o) => o.id === "shopify.product_count");
  t.check("le catalogue est compté", compte !== undefined, true);
  t.check("…et vaut zéro", compte?.value, 0);
  // UN COMPTE À ZÉRO EST UNE MESURE, PAS UNE ABSENCE. C'est toute la
  // différence : une donnée non lue ne produit aucune observation.
  t.check("…comme une valeur, jamais comme un trou", compte?.value === null, false);
  t.check(
    "…et sa preuve cite la source",
    /products\/count\.json/.test(compte?.evidence ?? ""),
    true,
  );

  // =========================================================================
  // 2. LES RÈGLES : le fait devient un constat prioritaire
  // =========================================================================
  const vitrine = storefrontObservations(VITRINE);
  const rapport = analyse({
    observations: [...shopify.observations, ...vitrine.observations],
    gaps: [...shopify.gaps, ...vitrine.gaps],
  });

  const vide = rapport.findings.find((f) => f.ruleId === "merchandising.catalogue_vide");
  t.check("le catalogue vide produit un constat", vide !== undefined, true);
  t.check("…mesuré, pas déduit", vide?.level, "prouve");
  t.check("…avec l'impact maximal", vide?.impact, 5);

  t.check(
    "…et il sort en tête du classement",
    rapport.priorities[0]?.ruleId,
    "merchandising.catalogue_vide",
  );
  // L'ÉCART COMPTE AUTANT QUE LE RANG : une première place obtenue de justesse
  // se perdrait au premier ajout de règle.
  const second = rapport.priorities[1]?.priority ?? 0;
  t.check(
    "…avec une avance nette sur le suivant",
    (rapport.priorities[0]?.priority ?? 0) > second * 2,
    true,
  );

  // LES CONSTATS QUI DEVIENNENT ABSURDES SONT ABSORBÉS. On ne rend pas visible
  // ce qui n'existe pas.
  for (const absorbe of [
    "ux.catalogue_invisible_depuis_accueil",
    "merchandising.catalogue_present_mais_invisible",
  ]) {
    t.check(
      `${absorbe} est absorbé par le catalogue vide`,
      rapport.findings.some((f) => f.ruleId === absorbe),
      false,
    );
  }

  // ET AUCUNE RECOMMANDATION NE DEMANDE DE RELIER UN CATALOGUE ABSENT.
  const conseils = rapport.findings.map((f) => f.recommendation).join(" ");
  t.check(
    "aucun conseil ne demande de mettre en avant des collections",
    /collections mises en avant/.test(conseils),
    false,
  );
  t.check(
    "…et la promesse d'accueil reste à préparer",
    /titre qui dit ce que vous vendez/.test(conseils),
    true,
  );

  /*
    AUCUN TEXTE DU MOTEUR NE CONTREDIT LE FAIT — ET C'EST VÉRIFIÉ EN BLOC.

    Le contrôle ci-dessus vise une phrase connue. Celui-ci passe TOUS les textes
    produits par les règles dans le même garde-fou que les textes du modèle. Une
    règle ajoutée demain, dont la recommandation présupposerait des produits, le
    ferait tomber — sans que personne ait à y penser.

    C'est là que la contradiction naissait : le moteur conseillait « ajoutez une
    section de collections mises en avant » sur une boutique sans catalogue, et
    le modèle n'avait plus qu'à broder l'histoire des produits mal reliés.
  */
  const opposablesMoteur = faitsEtablis([...shopify.observations, ...vitrine.observations]);
  const contradictionsMoteur = rapport.findings.flatMap((f) =>
    [f.title, f.statement, f.why, f.recommendation].flatMap(
      (texte) => confronter(texte, opposablesMoteur).retire,
    ),
  );
  t.check("aucun texte de règle ne contredit le catalogue vide", contradictionsMoteur, []);

  // =========================================================================
  // 3. LE CONTEXTE ENVOYÉ AU MODÈLE
  // =========================================================================
  const bloc = rulesToPromptBlock(rapport);
  t.check(
    "le fait figure dans le bloc source de vérité",
    /ne propose aucun produit à la vente/.test(bloc),
    true,
  );
  t.check("…en position 1", /\[1\][^\n]*aucun produit/.test(bloc), true);
  t.check("…avec sa preuve chiffrée", /Preuve[^\n]*0 produits/.test(bloc), true);
  // ET LE SCORE N'EST PAS COMPOSÉ : sans axe commercial mesuré, pas de note.
  t.check("aucune note globale n'est proposée", rapport.score, null);
  t.check("…et le bloc le dit", /non calculable/.test(bloc), true);

  // =========================================================================
  // 4. LA CONFRONTATION : le modèle ne peut plus publier la contradiction
  // =========================================================================
  const parsed = sanitizeAuditPayload(REPONSE_DU_MODELE);
  const opposables = faitsEtablis([...shopify.observations, ...vitrine.observations]);

  t.check("un fait opposable est établi", opposables.length >= 1, true);
  t.check(
    "…et c'est bien le compte du catalogue",
    opposables.some((f) => f.observation === "shopify.product_count"),
    true,
  );

  const suspect = parsed.findings.find((f) => f.title.includes("chemin d'accès"));
  t.check("le constat contredisant est bien présent avant filtrage", suspect !== undefined, true);

  const apres = confronter(suspect?.evidence.assumptions ?? "", opposables);
  t.check("la contradiction est détectée", apres.retire.length >= 1, true);
  t.check("…et retirée du texte", /catalogue contient des produits/.test(apres.texte), false);
  t.check(
    "…remplacée par ce que le moteur a compté",
    /aucun produit n'y est enregistré/.test(apres.texte),
    true,
  );

  // L'IMPACT AUSSI : la contradiction ne se loge pas que dans « assumptions ».
  const impact = confronter(suspect?.impact_description ?? "", opposables);
  t.check("l'impact contredisant est détecté", impact.retire.length >= 1, true);
  t.check("…et corrigé", /produits actifs/.test(impact.texte), false);

  // ET LE RÉSUMÉ GÉNÉRAL.
  const resume = confronter(parsed.summary, opposables);
  t.check(
    "un résumé contredisant est corrigé",
    /contient des produits actifs/.test(resume.texte),
    false,
  );

  // =========================================================================
  // 5. CE QUE LE FILTRE NE DOIT PAS FAIRE
  // =========================================================================
  /*
    UNE PHRASE QUI DIT LA VÉRITÉ NE DOIT PAS ÊTRE RETIRÉE. Sans garde de
    négation, le filtre supprimerait « aucun produit actif n'a été trouvé » —
    précisément la phrase juste — parce qu'elle contient « produit actif ».
  */
  for (const juste of [
    "Aucun produit actif n'a été trouvé dans le catalogue.",
    "Le catalogue ne contient aucun produit publié.",
    "Vos produits ne sont pas encore créés.",
  ]) {
    const r = confronter(juste, opposables);
    t.check(`« ${juste.slice(0, 40)}… » est conservée`, r.retire.length, 0);
  }

  // LE CONSTAT VRAI TRAVERSE LE FILTRE INTACT.
  const vrai = parsed.findings.find((f) => f.key === "catalogue-vide");
  t.check(
    "le constat du catalogue vide n'est pas touché",
    confronter(vrai?.root_cause ?? "", opposables).retire.length,
    0,
  );

  /*
    SANS MESURE, PAS DE FAIT OPPOSABLE — ET L'HYPOTHÈSE REDEVIENT LÉGITIME.

    C'est la moitié qu'il ne faut pas perdre. Sur une boutique dont le catalogue
    n'a PAS pu être compté — Shopify injoignable, permission absente — supposer
    que des produits existent mais ne sont pas reliés est un raisonnement
    valable. Ce qui l'interdisait ici, c'est la mesure, pas le sujet.
  */
  const sansMesure = faitsEtablis(
    shopify.observations.filter((o) => o.id !== "shopify.product_count"),
  );
  t.check(
    "sans compte du catalogue, rien n'est opposable à ce sujet",
    sansMesure.some((f) => f.observation === "shopify.product_count"),
    false,
  );
  const memePhrase = confronter(
    "Le catalogue contient des produits actifs et publiés dans l'administration Shopify.",
    sansMesure,
  );
  t.check("…et la même hypothèse redevient permise", memePhrase.retire.length, 0);

  // UN CATALOGUE FOURNI N'OPPOSE RIEN NON PLUS.
  const fourni = shopifyObservations({
    currency: "EUR",
    productCount: 12,
    products: [],
    orders: [],
    abandonedCheckouts: null,
    funnel: null,
  } as unknown as Parameters<typeof shopifyObservations>[0]);
  t.check(
    "un catalogue fourni n'oppose rien",
    faitsEtablis(fourni.observations).some((f) => f.observation === "shopify.product_count"),
    false,
  );
});
