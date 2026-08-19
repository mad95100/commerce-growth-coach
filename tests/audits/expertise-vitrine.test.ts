import { defineSuite } from "../harness";
import {
  analysePage,
  storefrontObservations,
  type FetchedPage,
  type PageRole,
  type StorefrontRaw,
} from "@/lib/connectors/storefront";
import { RULES, THRESHOLDS, runRules, type RuleContext } from "@/lib/audit-rules";
import { extractExperience, experienceFindings } from "@/lib/storefront-experience";
import { citeUneMesure, classifyEpistemic } from "@/lib/finding-graph";
import type { Observation } from "@/lib/observations";

/**
 * CE QUE LE MOTEUR SAIT DIRE D'UNE BOUTIQUE EN PARTICULIER.
 *
 * LE DÉFAUT QUE CETTE SUITE GARDE. Le scan téléchargeait la page de collection
 * à chaque audit, la comptait dans les temps de réponse, puis la jetait sans
 * l'analyser. Le titre d'onglet était extrait et jamais rapporté. Vingt-quatre
 * observations de vitrine sur vingt-neuf n'étaient lues par AUCUNE règle : le
 * moteur les mesurait, les transmettait au modèle, et le même prompt lui
 * interdisait d'en tirer un constat.
 *
 * Le résultat tenait dans une phrase : le rapport pouvait être recopié d'une
 * boutique à l'autre sans qu'on s'en aperçoive. C'est ce que cette suite
 * empêche — non pas en épinglant des formulations, mais en exigeant qu'un
 * constat de vitrine cite ce qu'il a lu.
 */

const HTML_ACCUEIL = `<!doctype html><html><head>
<title>Atelier Vela — sacs en toile cirée cousus à Nantes</title>
<meta name="viewport" content="width=device-width">
<meta name="description" content="Sacs et bagages en toile cirée, cousus en France.">
</head><body>
<nav><a href="/collections/sacs">Sacs</a><a href="/collections/bagages">Bagages</a></nav>
<h1>Sacs en toile cirée cousus à Nantes</h1>
<a href="/products/besace-vela">Découvrir la besace</a>
<a href="/products/besace-vela?variant=42">Besace, coloris marine</a>
<a href="/collections/sacs">Voir les sacs</a>
<a href="/pages/a-propos">À propos</a>
</body></html>`;

const HTML_COLLECTION = `<!doctype html><html><head>
<title>Sacs — Atelier Vela</title>
<meta name="viewport" content="width=device-width">
</head><body>
<h1>Sacs</h1>
<a href="/products/besace-vela">Besace</a>
<a href="/products/besace-vela?variant=7">Besace marine</a>
<a href="/products/cabas-loire">Cabas</a>
</body></html>`;

const page = (role: PageRole, url: string, html: string | null, status = 200): FetchedPage => ({
  url,
  role,
  status,
  elapsedMs: 120,
  bytes: html?.length ?? 0,
  html,
});

const raw = (over: Partial<StorefrontRaw> = {}): StorefrontRaw => ({
  origin: "https://atelier-vela.fr",
  pages: [
    page("accueil", "https://atelier-vela.fr/", HTML_ACCUEIL),
    page("collection", "https://atelier-vela.fr/collections/sacs", HTML_COLLECTION),
  ],
  robots: null,
  sitemapFound: true,
  linkChecks: [],
  landingChecks: [],
  mobileHome: null,
  ...over,
});

/** Fabrique un contexte de règles à partir d'observations nommées. */
const ctxDe = (valeurs: Record<string, number>, currency: string | null = "EUR"): RuleContext => ({
  observations: Object.entries(valeurs).map(([id, value]): Observation => ({
    id,
    source: "storefront",
    domain: "conversion",
    label: id,
    value,
    unit: "count",
    periodDays: 0,
    evidence: `${id} = ${value} sur https://atelier-vela.fr`,
    sample: 1,
  })),
  gaps: [],
  currency,
});

const constat = (ctx: RuleContext, ruleId: string) =>
  runRules(ctx).find((f) => f.ruleId === ruleId);

export default defineSuite("Vitrine — le moteur parle de CETTE boutique", (t) => {
  // =========================================================================
  // 1. LA PAGE DE COLLECTION EST ENFIN LUE
  // =========================================================================
  /*
    Elle était téléchargée depuis toujours et jetée. C'est pourtant la page où
    le visiteur CHOISIT : la fiche ne fait que confirmer un choix déjà fait
    ailleurs. Le contrôle porte sur le comportement, pas sur une ligne de code.
  */
  const { observations } = storefrontObservations(raw());
  const ids = observations.map((o) => o.id);

  t.check(
    "la collection produit ses observations de structure",
    ids.includes("storefront.collection_viewport"),
    true,
  );
  t.check(
    "…et le compte de produits qu'elle met réellement à portée",
    ids.includes("storefront.collection_produits_listes"),
    true,
  );
  t.check("…et l'état de ses filtres", ids.includes("storefront.collection_filtres"), true);

  // Le dédoublonnage porte sur la FICHE, pas sur l'URL : `?variant=` mène au
  // même produit, et le compter deux fois gonflerait la richesse apparente.
  const listes = observations.find((o) => o.id === "storefront.collection_produits_listes");
  t.check("une variante ne compte pas pour un produit de plus", listes?.value, 2);
  t.check(
    "la preuve nomme la page dont on parle",
    /atelier-vela\.fr\/collections\/sacs/.test(listes?.evidence ?? ""),
    true,
  );

  // =========================================================================
  // 2. LE TITRE D'ONGLET, LU DEPUIS TOUJOURS ET JAMAIS RAPPORTÉ
  // =========================================================================
  const titre = observations.find((o) => o.id === "storefront.accueil_title");
  t.check("le titre de la page devient une observation", Boolean(titre), true);
  t.check(
    "…et la preuve le cite mot pour mot",
    /Atelier Vela — sacs en toile cirée cousus à Nantes/.test(titre?.evidence ?? ""),
    true,
  );
  t.check(
    "…avec sa longueur, qui est le fait mesuré",
    titre?.value,
    "Atelier Vela — sacs en toile cirée cousus à Nantes".length,
  );

  // Une page sans titre le dit, au lieu de ne rien dire.
  const sansTitre = storefrontObservations(
    raw({ pages: [page("accueil", "https://atelier-vela.fr/", "<html><body></body></html>")] }),
  ).observations.find((o) => o.id === "storefront.accueil_title");
  t.check("une page sans titre produit quand même l'observation", Boolean(sansTitre), true);
  t.check("…à zéro caractère", sansTitre?.value, 0);

  // =========================================================================
  // 3. LES PORTES D'ENTRÉE DU CATALOGUE
  // =========================================================================
  const facts = analysePage(HTML_ACCUEIL, "https://atelier-vela.fr");
  t.check("les collections atteignables sont comptées", facts.collectionLinks, 2);
  t.check("les fiches atteignables aussi, dédoublonnées", facts.productLinks, 1);
  t.check("la recherche absente est un fait, pas un silence", facts.hasSearchForm, false);
  t.check("les filtres absents aussi", facts.hasFacetFilters, false);

  const avecFiltres = analysePage(
    `<html><body><a href="/collections/sacs?filter.v.price.gte=20">Moins de 20</a></body></html>`,
    "https://atelier-vela.fr",
  );
  t.check("une facette Shopify est reconnue", avecFiltres.hasFacetFilters, true);

  // =========================================================================
  // 4. LES OBSERVATIONS MESURÉES SONT DÉSORMAIS LUES PAR UNE RÈGLE
  // =========================================================================
  /*
    C'est le cœur du défaut. Chaque identifiant ci-dessous était produit à
    chaque audit et n'entrait dans aucune règle : mesuré, transmis, inutilisable.
  */
  const requis = new Set(RULES.flatMap((r) => r.requires));
  const source = RULES.map((r) => r.evaluate.toString()).join("\n");
  for (const id of [
    "storefront.produits_sans_ajout_panier",
    "storefront.produits_sans_livraison",
    "storefront.produits_sans_avis",
    "storefront.policy_pages",
    "storefront.collection_produits_listes",
    "storefront.collection_filtres",
    "storefront.accueil_collection_links",
    "storefront.response_ms",
  ]) {
    t.check(`${id} est consommé par une règle`, requis.has(id) || source.includes(id), true);
  }
  // Le `noindex` est lu sur les trois rôles de page, pas seulement l'un d'eux.
  for (const role of ["accueil", "produit", "collection"]) {
    t.check(
      `le noindex de la page ${role} est lu`,
      source.includes("_noindex") && source.includes(role),
      true,
    );
  }

  // =========================================================================
  // 5. UN CONTRÔLE SAUTÉ N'EST PAS UN CONTRÔLE RÉUSSI
  // =========================================================================
  /*
    `ux.mobile_viewport_missing` n'exigeait que l'observation MOBILE, qui
    n'existe que si la requête en agent mobile a abouti. Sur un site lent, ce
    contrôle est le premier que le budget du scan abandonne : une boutique
    réellement dépourvue de balise viewport ne produisait alors aucun constat,
    alors que l'observation d'accueil portait déjà la réponse.
  */
  const sansMobile = constat(
    ctxDe({ "storefront.accueil_viewport": 0 }),
    "ux.mobile_viewport_missing",
  );
  t.check("viewport absent constaté sans le scan mobile", Boolean(sansMobile), true);

  const mobilePresent = constat(
    ctxDe({ "storefront.accueil_viewport": 0, "storefront.mobile_viewport": 1 }),
    "ux.mobile_viewport_missing",
  );
  t.check("…et la mesure mobile prime quand elle existe", mobilePresent, undefined);

  // =========================================================================
  // 6. LA CORROBORATION CHANGE CE QU'UN CONSTAT A LE DROIT D'AFFIRMER
  // =========================================================================
  /*
    L'absence de mention de livraison sur la fiche est un fait de page. Elle ne
    devient une explication de perte que si un abandon de panier a été MESURÉ,
    sur assez de commandes. C'est la seule règle du moteur où le niveau de
    preuve dépend d'une seconde source — et c'est exactement ce que la règle
    absolue du module décrit.
  */
  const seul = constat(
    ctxDe({ "storefront.produits_sans_livraison": 3, "storefront.produits_inspectes": 3 }),
    "conversion.livraison_absente_fiche",
  );
  t.check("sans mesure d'abandon, le constat reste à vérifier", seul?.level, "a_verifier");
  t.check(
    "…et il ne prétend pas expliquer une perte",
    /première cause/.test(seul?.why ?? ""),
    false,
  );

  const croise = constat(
    ctxDe({
      "storefront.produits_sans_livraison": 3,
      "storefront.produits_inspectes": 3,
      "shopify.cart_abandonment_rate": 0.82,
      "shopify.orders_30d": 140,
    }),
    "conversion.livraison_absente_fiche",
  );
  t.check("avec un abandon mesuré, le constat monte d'un cran", croise?.level, "fortement_suggere");
  // …mais jamais sur une fiche unique : la corroboration commerciale ne
  // remplace pas l'échantillon.
  t.check(
    "une seule fiche plafonne le constat, abandon mesuré ou non",
    constat(
      ctxDe({
        "storefront.produits_sans_livraison": 1,
        "storefront.produits_inspectes": 1,
        "shopify.cart_abandonment_rate": 0.82,
        "shopify.orders_30d": 140,
      }),
      "conversion.livraison_absente_fiche",
    )?.level,
    "a_verifier",
  );
  t.check(
    "…et il dit que les deux ne se corrigent pas séparément",
    /ne donnera rien/.test(croise?.why ?? ""),
    true,
  );
  t.check("…en citant les deux preuves, pas une", (croise?.evidence.length ?? 0) >= 3, true);

  // Un abandon mesuré sur trop peu de commandes ne corrobore rien.
  const mince = constat(
    ctxDe({
      "storefront.produits_sans_livraison": 3,
      "storefront.produits_inspectes": 3,
      "shopify.cart_abandonment_rate": 0.82,
      "shopify.orders_30d": THRESHOLDS.MIN_ORDERS_FOR_RATES - 1,
    }),
    "conversion.livraison_absente_fiche",
  );
  t.check("un dénominateur mince ne corrobore pas", mince?.level, "a_verifier");

  // =========================================================================
  // 7. LES NOUVELLES RÈGLES SE DÉCLENCHENT, ET SEULEMENT QUAND IL LE FAUT
  // =========================================================================
  const cas: Array<[string, string, Record<string, number>, Record<string, number>]> = [
    [
      "une fiche sans ajout au panier",
      "produit.achat_impossible",
      { "storefront.produits_sans_ajout_panier": 1, "storefront.produits_inspectes": 3 },
      { "storefront.produits_sans_ajout_panier": 0, "storefront.produits_inspectes": 3 },
    ],
    [
      "une fiche sans avis",
      "trust.avis_absents_fiche",
      { "storefront.produits_sans_avis": 3, "storefront.produits_inspectes": 3 },
      { "storefront.produits_sans_avis": 0, "storefront.produits_inspectes": 3 },
    ],
    [
      "des politiques incomplètes",
      "trust.policy_pages_incomplete",
      { "storefront.policy_pages": 1 },
      { "storefront.policy_pages": THRESHOLDS.EXPECTED_POLICY_PAGES },
    ],
    [
      "une collection qui ne fait rien choisir",
      "merchandising.collection_maigre",
      { "storefront.collection_produits_listes": 2 },
      { "storefront.collection_produits_listes": THRESHOLDS.MIN_PRODUCTS_IN_COLLECTION },
    ],
    [
      "un accueil sans porte d'entrée",
      "ux.catalogue_invisible_depuis_accueil",
      { "storefront.accueil_collection_links": 0 },
      { "storefront.accueil_collection_links": 3 },
    ],
    [
      "une page en noindex",
      "seo.noindex_declare",
      { "storefront.produit_noindex": 1 },
      { "storefront.produit_noindex": 0 },
    ],
  ];
  for (const [nom, ruleId, declenche, pas] of cas) {
    t.check(`${nom} : le constat sort`, Boolean(constat(ctxDe(declenche), ruleId)), true);
    t.check(`${nom} : et pas quand tout va bien`, constat(ctxDe(pas), ruleId), undefined);
  }

  // Les politiques totalement absentes relèvent de l'autre règle : les deux ne
  // doivent jamais sortir ensemble sur la même boutique.
  const zeroPolitique = runRules(ctxDe({ "storefront.policy_pages": 0 })).map((f) => f.ruleId);
  t.check(
    "zéro politique : un seul des deux constats",
    zeroPolitique.filter((id) => id.startsWith("trust.policy_pages")).length,
    1,
  );

  // Un catalogue trop petit ne réclame pas de filtres : le seuil vient de
  // l'API, pas de la page, parce qu'une collection paginée masque sa taille.
  t.check(
    "un petit catalogue n'exige pas de filtres",
    constat(
      ctxDe({ "storefront.collection_filtres": 0, "shopify.product_count": 8 }),
      "merchandising.collection_sans_filtres",
    ),
    undefined,
  );
  t.check(
    "un grand catalogue sans filtre, si",
    Boolean(
      constat(
        ctxDe({
          "storefront.collection_filtres": 0,
          "shopify.product_count": THRESHOLDS.CATALOG_NEEDS_FILTERS + 10,
        }),
        "merchandising.collection_sans_filtres",
      ),
    ),
    true,
  );

  // =========================================================================
  // 8. LA LENTEUR RESTE UNE LENTEUR TANT QUE RIEN NE LA CORROBORE
  // =========================================================================
  const lentSansCommerce = constat(
    ctxDe({ "storefront.response_ms": 3400 }),
    "technique.reponse_lente",
  );
  t.check("une réponse lente est constatée", Boolean(lentSansCommerce), true);
  t.check(
    "…sans prétendre savoir ce qu'elle coûte",
    /rien ne permet de dire ce que ce délai lui coûte/.test(lentSansCommerce?.why ?? ""),
    true,
  );
  const lentAvecCommerce = constat(
    ctxDe({ "storefront.response_ms": 3400, "shopify.orders_30d": 90 }),
    "technique.reponse_lente",
  );
  t.check(
    "avec du commerce mesuré, le constat le dit autrement",
    lentAvecCommerce?.why === lentSansCommerce?.why,
    false,
  );
  t.check(
    "…mais reste plafonné : un fait technique ne devient pas une perte",
    lentAvecCommerce?.level,
    "a_verifier",
  );

  // =========================================================================
  // 9. AUCUN CONSTAT DE VITRINE N'EST UNE PHRASE INTERCHANGEABLE
  // =========================================================================
  /*
    LE CRITÈRE QUI COMPTE, et le seul qui distingue un audit d'une checklist :
    un lecteur doit pouvoir dire de QUELLE boutique on parle. Une preuve qui ne
    porte ni chiffre, ni adresse, ni citation vaut pour n'importe quel site.
  */
  const experience = experienceFindings(extractExperience(HTML_ACCUEIL), null);
  const toutesPreuves = [
    ...experience.flatMap((f) => f.evidence),
    ...runRules(
      ctxDe({
        "storefront.produits_sans_ajout_panier": 2,
        "storefront.produits_sans_avis": 3,
        "storefront.produits_inspectes": 3,
        "storefront.policy_pages": 1,
        "storefront.collection_produits_listes": 2,
        "storefront.accueil_collection_links": 0,
        "storefront.produit_noindex": 1,
        "storefront.response_ms": 3400,
      }),
    ).flatMap((f) => f.evidence),
  ];
  t.check("il y a bien des preuves à contrôler", toutesPreuves.length > 0, true);
  for (const preuve of toutesPreuves) {
    t.check(
      `la preuve porte un fait vérifiable : ${preuve.slice(0, 48)}…`,
      /\d/.test(preuve) || /https?:\/\/|«/.test(preuve),
      true,
    );
  }

  // Le cas nommément visé : « aucun appel à l'action » disait la même chose de
  // toutes les boutiques du monde.
  const sansCta = experienceFindings(
    extractExperience(`<html><body><h1>Une boutique de sacs en toile</h1>
      <a href="/pages/a-propos">À propos</a><a href="/account">Connexion</a></body></html>`),
    null,
  ).find((f) => f.id === "experience.aucun_cta");
  t.check("l'absence de bouton d'action est constatée", Boolean(sansCta), true);
  t.check(
    "…avec le nombre de liens réellement inspectés",
    /2 lien/.test(sansCta?.evidence.join(" ") ?? ""),
    true,
  );
  t.check(
    "…et les libellés lus, qui rendent le constat vérifiable",
    /À propos/.test(sansCta?.evidence.join(" ") ?? ""),
    true,
  );

  // La navigation absente ne s'affirme plus : un thème sans balise `<nav>`
  // produisait un constat faux, présenté comme prouvé.
  const sansNav = experienceFindings(
    extractExperience(`<html><body><h1>Sacs en toile cirée cousus à Nantes</h1>
      <a href="/collections/sacs">Voir les sacs</a></body></html>`),
    null,
  ).find((f) => f.id === "experience.navigation_absente");
  t.check("un menu illisible n'est plus affirmé absent", sansNav?.level, "a_verifier");
  t.check(
    "…et la sortie proposée commence par regarder la page",
    /vérifier qu'un menu principal s'affiche/i.test(sansNav?.recommendation ?? ""),
    true,
  );

  // =========================================================================
  // 10. UNE LECTURE DE PAGE N'EST PAS UNE MESURE
  // =========================================================================
  /*
    `citeUneMesure` acceptait la préposition « sur » suivie d'un nombre. Les
    constats de vitrine en sont pleins — « aucun verbe d'action sur 34 liens »,
    « 3 fiches sur 120 au catalogue » — et remontaient donc en « Mesuré », au
    même rang qu'un relevé Shopify daté. Le niveau « Observé » ne se déclenchait
    pratiquement jamais.
  */
  t.check(
    "un décompte de page n'est pas une mesure",
    citeUneMesure("Aucun verbe d'action sur 34 liens relevés sur la page d'accueil"),
    false,
  );
  t.check(
    "…et il se classe donc « Observé »",
    classifyEpistemic({
      confidence: "high",
      evidence: {
        based_on: "34 lien(s) et bouton(s) relevés sur la page d'accueil, aucun verbe d'action",
        assumptions: "",
      },
    }),
    "observe",
  );
  // Ce qui est réellement mesuré ne redescend pas pour autant.
  t.check(
    "une mesure datée reste une mesure",
    citeUneMesure("412 paniers créés sur les 30 derniers jours (Shopify)"),
    true,
  );
  t.check(
    "…et se classe « Mesuré »",
    classifyEpistemic({
      confidence: "high",
      evidence: {
        based_on: "1 240 sessions et 87 commandes payées sur 30 jours (Shopify)",
        assumptions: "",
      },
    }),
    "fait",
  );
});
