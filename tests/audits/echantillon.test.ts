import { defineSuite } from "../harness";
import {
  storefrontObservations,
  type FetchedPage,
  type PageRole,
  type StorefrontRaw,
} from "@/lib/connectors/storefront";
import { MAX_PRODUCT_PAGES, productSample } from "@/lib/connectors/storefront.server";
import { RULES, lirePortee, runRules, type RuleContext } from "@/lib/audit-rules";
import {
  EPISTEMIC_LABELS,
  EPISTEMIC_LEVELS,
  citeUneMesure,
  classifyEpistemic,
  hasSubstance,
} from "@/lib/finding-graph";
import type { Observation } from "@/lib/observations";

/**
 * UN CATALOGUE NE SE JUGE PAS SUR UNE FICHE.
 *
 * LE DÉFAUT. Le scan ouvrait UNE page produit — la première adresse
 * `/products/` rencontrée sur l'accueil — et tous les constats produit du
 * moteur en découlaient. Une boutique dont la fiche mise en avant est soignée
 * passait pour irréprochable ; une boutique dont la première fiche est un
 * brouillon oublié était condamnée sur cet unique exemplaire. Le rapport
 * écrivait « les fiches produit n'ont pas de description » : une phrase vraie
 * de la page lue, fausse de la boutique, et rien ne permettait de distinguer
 * les deux.
 *
 * Cette suite garde deux choses : que plusieurs fiches soient réellement lues,
 * et qu'AUCUN constat ne dise du catalogue ce qui n'a été vu que sur
 * l'échantillon. Le dénominateur n'est pas un détail de méthode — c'est lui qui
 * autorise ou interdit de généraliser.
 *
 * Elle couvre aussi le contrat de classification épistémique, qui ne peut pas
 * être éprouvé en production depuis cet environnement : l'appel au fournisseur
 * est injoignable. Ce qui EST vérifiable ici l'est intégralement — l'entrée, la
 * sortie, les cinq niveaux, et surtout le comportement sur une réponse
 * ambiguë.
 */

const fiche = (handle: string, contenu = "") =>
  `<!doctype html><html><head><title>${handle}</title></head><body>
<h1>${handle}</h1>${contenu}</body></html>`;

const AVEC_TOUT = `<form action="/cart/add"><button>Ajouter au panier</button></form>
<p>Livraison offerte dès 60 €</p>
<script type="application/ld+json">{"@type":"Product","offers":{"price":"49.00","priceCurrency":"EUR"},"aggregateRating":{"ratingValue":"4.6"}}</script>`;

const page = (role: PageRole, url: string, html: string | null, status = 200): FetchedPage => ({
  url,
  role,
  status,
  elapsedMs: 120,
  bytes: html?.length ?? 0,
  html,
});

const scan = (fiches: Array<[string, string]>): StorefrontRaw => ({
  origin: "https://atelier-vela.fr",
  pages: [
    page("accueil", "https://atelier-vela.fr/", fiche("Accueil")),
    ...fiches.map(([handle, contenu]) =>
      page("produit", `https://atelier-vela.fr/products/${handle}`, fiche(handle, contenu)),
    ),
  ],
  robots: null,
  sitemapFound: true,
  linkChecks: [],
  landingChecks: [],
  mobileHome: null,
});

const valeur = (raw: StorefrontRaw, id: string) =>
  storefrontObservations(raw).observations.find((o) => o.id === id);

const ctxDe = (valeurs: Record<string, number>): RuleContext => ({
  observations: Object.entries(valeurs).map(([id, value]): Observation => ({
    id,
    source: id.startsWith("shopify.") ? "shopify" : "storefront",
    domain: "produit",
    label: id,
    value,
    unit: "count",
    periodDays: 0,
    evidence: `${id} = ${value}`,
    sample: valeurs["storefront.produits_inspectes"] ?? 1,
  })),
  gaps: [],
  currency: "EUR",
});

const constat = (ctx: RuleContext, ruleId: string) =>
  runRules(ctx).find((f) => f.ruleId === ruleId);

const preuve = (based_on: string, assumptions = "") => ({ based_on, assumptions });

export default defineSuite("Échantillon et certitude — ce qu'une page autorise à dire", (t) => {
  // =========================================================================
  // 1. L'ÉCHANTILLON EST DÉTERMINISTE, BORNÉ, ET DANS L'ORDRE DE LA BOUTIQUE
  // =========================================================================
  const depuisCollection = [
    "/products/besace",
    "/products/besace?variant=7",
    "/products/cabas",
    "/products/sac-marin",
  ];
  const depuisAccueil = ["/products/nouveaute", "/products/besace", "/collections/tout"];

  const e = productSample(depuisAccueil, depuisCollection);
  t.check("la collection passe avant l'accueil", e[0], "/products/besace");
  t.check("…puis l'accueil complète", e.includes("/products/nouveaute"), true);
  t.check(
    "une variante ne consomme pas une place",
    e.filter((p) => p.includes("besace")).length,
    1,
  );
  t.check(
    "aucun lien non produit n'entre",
    e.some((p) => p.includes("/collections/")),
    false,
  );
  // DÉTERMINISTE : deux appels sur les mêmes documents rendent le même
  // échantillon. Sans cela, deux audits successifs ne seraient pas comparables.
  t.check(
    "deux passages rendent le même échantillon",
    productSample(depuisAccueil, depuisCollection),
    e,
  );

  const beaucoup = Array.from({ length: 40 }, (_, i) => `/products/p${i}`);
  t.check("l'échantillon est borné", productSample([], beaucoup).length, MAX_PRODUCT_PAGES);
  t.check("…et la borne reste raisonnable pour la boutique", MAX_PRODUCT_PAGES <= 8, true);
  // Un petit catalogue est inspecté ENTIÈREMENT : l'échantillon est alors le
  // catalogue, et le constat a le droit de le dire.
  t.check("un petit catalogue passe en entier", productSample([], depuisCollection).length, 3);
  t.check("aucune fiche, aucun échantillon", productSample([], []), []);

  // =========================================================================
  // 2. PLUSIEURS FICHES PRODUISENT UNE OBSERVATION AGRÉGÉE, AVEC SON DÉNOMINATEUR
  // =========================================================================
  const melange = scan([
    ["besace", AVEC_TOUT],
    ["cabas", ""],
    ["sac-marin", ""],
  ]);

  const inspectees = valeur(melange, "storefront.produits_inspectes");
  t.check("le nombre de fiches lues est une observation", inspectees?.value, 3);
  t.check(
    "…et la preuve nomme les adresses ouvertes",
    /besace.*cabas.*sac-marin/s.test(inspectees?.evidence ?? ""),
    true,
  );

  const sansPanier = valeur(melange, "storefront.produits_sans_ajout_panier");
  t.check("les manques sont comptés, pas constatés une fois", sansPanier?.value, 2);
  t.check("…sur un dénominateur explicite", sansPanier?.sample, 3);
  t.check(
    "…et la preuve porte les DEUX nombres",
    /2 des 3 fiche/.test(sansPanier?.evidence ?? ""),
    true,
  );
  t.check(
    "…et nomme les fiches concernées",
    /cabas/.test(sansPanier?.evidence ?? "") && /sac-marin/.test(sansPanier?.evidence ?? ""),
    true,
  );
  t.check(
    "la fiche saine n'est pas comptée dans les manques",
    /products\/besace/.test(sansPanier?.evidence ?? ""),
    false,
  );

  for (const [id, attendu] of [
    ["storefront.produits_sans_livraison", 2],
    ["storefront.produits_sans_avis", 2],
    ["storefront.produits_sans_donnees_structurees", 2],
    ["storefront.produits_sans_prix", 2],
  ] as const) {
    const o = valeur(melange, id);
    t.check(`${id} est agrégé`, o?.value, attendu);
    t.check(`${id} porte son dénominateur`, o?.sample, 3);
  }

  // Aucun manque : l'observation existe quand même, à zéro. Un compteur à zéro
  // est une mesure ; l'absence d'observation serait autre chose.
  const impeccable = scan([
    ["besace", AVEC_TOUT],
    ["cabas", AVEC_TOUT],
  ]);
  const rien = valeur(impeccable, "storefront.produits_sans_ajout_panier");
  t.check("zéro manque reste une mesure", rien?.value, 0);
  t.check("…dite comme telle", /Aucune des 2 fiche/.test(rien?.evidence ?? ""), true);

  // Aucune fiche lisible : pas d'observation agrégée du tout, et un manque
  // déclaré. Un dénominateur nul ne produit pas des compteurs à zéro.
  const aveugle = storefrontObservations(scan([]));
  t.check(
    "sans fiche lue, aucune observation agrégée",
    aveugle.observations.some((o) => o.id.startsWith("storefront.produits_")),
    false,
  );
  t.check(
    "…mais le manque est nommé",
    aveugle.gaps.some((g) => g.id === "storefront.product_page"),
    true,
  );

  // =========================================================================
  // 3. LA PORTÉE : CE QU'UN ÉCHANTILLON AUTORISE À DIRE
  // =========================================================================
  t.check("aucune fiche ouverte", lirePortee(0, 0).portee, "aucune");
  t.check("…et cela ne prouve rien", lirePortee(0, 0).plafond, "donnee_insuffisante");
  t.check("aucun manque sur des fiches lues", lirePortee(0, 5).portee, "aucune");

  const une = lirePortee(1, 1, 300);
  t.check("une seule fiche est nommée comme telle", une.portee, "une_fiche");
  t.check("…et son plafond interdit d'en faire une preuve", une.plafond, "a_verifier");
  t.check(
    "…la phrase dit « la seule fiche »",
    /seule fiche produit inspectée/.test(une.phrase),
    true,
  );
  t.check(
    "…et rappelle la taille du catalogue",
    /catalogue de 300 produits/.test(une.phrase),
    true,
  );

  const plusieurs = lirePortee(3, 5, 300);
  t.check("plusieurs fiches", plusieurs.portee, "plusieurs_fiches");
  t.check("…avec les deux nombres dans la phrase", /3 des 5 fiches/.test(plusieurs.phrase), true);
  t.check("…et une preuve possible", plusieurs.plafond, "prouve");

  const toutes = lirePortee(5, 5, 300);
  t.check("toutes les inspectées", toutes.portee, "toutes_les_inspectees");
  t.check(
    "…et la phrase dit « inspectées », pas « du catalogue »",
    /inspectées/.test(toutes.phrase),
    true,
  );
  t.check(
    "…elle n'affirme jamais le catalogue entier",
    /toutes les fiches produit de la boutique|tout le catalogue/i.test(toutes.phrase),
    false,
  );
  // Le rappel du catalogue disparaît quand l'échantillon EST le catalogue.
  t.check(
    "un catalogue entièrement lu ne se rappelle pas",
    lirePortee(4, 4, 4).phrase.includes("catalogue de"),
    false,
  );

  // =========================================================================
  // 4. UNE SEULE FICHE NE PRODUIT PAS UNE CONCLUSION « CATALOGUE »
  // =========================================================================
  /*
    LE CONTRÔLE CENTRAL DE CETTE SUITE. Les constats produit gardent le droit de
    sortir sur une fiche unique — un produit inachetable est un problème réel —
    mais ils ne peuvent plus être PROUVÉS sur elle, ni parler du catalogue.
  */
  const surUne = constat(
    ctxDe({ "storefront.produits_sans_ajout_panier": 1, "storefront.produits_inspectes": 1 }),
    "produit.achat_impossible",
  );
  t.check("le constat sort sur une fiche", Boolean(surUne), true);
  t.check("…mais plafonné à « à vérifier »", surUne?.level, "a_verifier");
  t.check(
    "…et il dit qu'il n'a vu qu'une fiche",
    /seule fiche produit inspectée/.test(surUne?.statement ?? ""),
    true,
  );

  const surCinq = constat(
    ctxDe({ "storefront.produits_sans_ajout_panier": 5, "storefront.produits_inspectes": 5 }),
    "produit.achat_impossible",
  );
  t.check(
    "…et il compte ce qu'il a vu",
    /5 fiches produit inspectées/.test(surCinq?.statement ?? ""),
    true,
  );
  /*
    DEUX PLAFONDS DISTINCTS, ET ILS NE SE REMPLACENT PAS. Celui-ci reste « à
    vérifier » même sur cinq fiches, mais pour une autre raison : un thème qui
    construit son bouton après l'affichage sert un document sans formulaire, et
    aucun échantillon ne lève ce doute-là. C'est le plafond TECHNIQUE.
  */
  t.check("le plafond technique survit à un grand échantillon", surCinq?.level, "a_verifier");
  /*
    Le plafond d'ÉCHANTILLON se voit sur une règle non technique. Sans
    corroboration commerciale elle vaut « à vérifier » de toute façon ; avec
    elle, elle monte — mais seulement si plusieurs fiches ont été lues.
  */
  const corrobore = {
    "shopify.cart_abandonment_rate": 0.82,
    "shopify.orders_30d": 140,
  };
  t.check(
    "une fiche unique bloque la montée en preuve",
    constat(
      ctxDe({
        "storefront.produits_sans_livraison": 1,
        "storefront.produits_inspectes": 1,
        ...corrobore,
      }),
      "conversion.livraison_absente_fiche",
    )?.level,
    "a_verifier",
  );
  t.check(
    "…plusieurs fiches la permettent",
    constat(
      ctxDe({
        "storefront.produits_sans_livraison": 4,
        "storefront.produits_inspectes": 5,
        ...corrobore,
      }),
      "conversion.livraison_absente_fiche",
    )?.level,
    "fortement_suggere",
  );

  // Un manque isolé ne fait pas un constat de catalogue sur les traits « mous ».
  t.check(
    "une fiche sur cinq sans avis ne déclenche rien",
    constat(
      ctxDe({ "storefront.produits_sans_avis": 1, "storefront.produits_inspectes": 5 }),
      "trust.avis_absents_fiche",
    ),
    undefined,
  );
  t.check(
    "trois sur cinq, oui",
    Boolean(
      constat(
        ctxDe({ "storefront.produits_sans_avis": 3, "storefront.produits_inspectes": 5 }),
        "trust.avis_absents_fiche",
      ),
    ),
    true,
  );

  // AUCUNE EXTRAPOLATION ABUSIVE, sur aucun constat produit.
  const tous = runRules(
    ctxDe({
      "storefront.produits_inspectes": 3,
      "storefront.produits_sans_ajout_panier": 3,
      "storefront.produits_sans_livraison": 3,
      "storefront.produits_sans_avis": 3,
      "storefront.produits_sans_donnees_structurees": 3,
      "shopify.product_count": 240,
    }),
  );
  t.check("il y a bien des constats produit à contrôler", tous.length >= 3, true);
  for (const f of tous) {
    const texte = `${f.title} ${f.statement} ${f.why}`;
    t.check(
      `${f.ruleId} ne généralise pas au catalogue`,
      /toutes? les fiches produit de la boutique|tout le catalogue|l'ensemble des fiches|chaque fiche du catalogue/i.test(
        texte,
      ),
      false,
    );
    t.check(
      `${f.ruleId} nomme son échantillon`,
      /fiches? produit inspectées?|fiche produit inspectée/i.test(texte),
      true,
    );
  }

  // Le dénominateur manquant fait taire la règle : elle ne suppose pas « une ».
  t.check(
    "sans dénombrement des fiches lues, la règle se tait",
    constat(ctxDe({ "storefront.produits_sans_ajout_panier": 3 }), "produit.achat_impossible"),
    undefined,
  );

  // Toute règle lisant un compte de fiches doit lire aussi le dénominateur.
  for (const r of RULES) {
    if (r.requires.some((id) => id.startsWith("storefront.produits_sans_"))) {
      t.check(
        `${r.id} exige le dénombrement des fiches inspectées`,
        r.requires.includes("storefront.produits_inspectes"),
        true,
      );
    }
  }

  // =========================================================================
  // 5. LA CLASSIFICATION ÉPISTÉMIQUE — LES CINQ NIVEAUX
  // =========================================================================
  /*
    CE QUI EST VÉRIFIABLE ICI, ET CE QUI NE L'EST PAS. L'appel au fournisseur
    est injoignable depuis cet environnement : la production réelle n'est pas
    vérifiable. Ce qui l'est : le contrat d'entrée qu'attend `classifyEpistemic`,
    sa sortie sur chacun des cinq niveaux, et son comportement quand la réponse
    du modèle est incomplète ou contradictoire.
  */
  const mesure = "1 240 sessions et 87 commandes payées sur 30 jours (Shopify)";
  const releve = "Titre principal relevé sur la page d'accueil : « Collection »";
  const suppose = "Nous supposons que le trafic est comparable au mois dernier";

  t.check("les cinq niveaux existent", EPISTEMIC_LEVELS.length, 5);
  for (const niveau of EPISTEMIC_LEVELS) {
    t.check(`${niveau} porte un libellé lisible`, EPISTEMIC_LABELS[niveau].length > 2, true);
  }

  t.check(
    "MESURÉ : une base chiffrée, sourcée, sans hypothèse, confiance élevée",
    classifyEpistemic({ confidence: "high", evidence: preuve(mesure) }),
    "fait",
  );
  t.check(
    "OBSERVÉ : une constatation non chiffrée, sans hypothèse, confiance élevée",
    classifyEpistemic({ confidence: "high", evidence: preuve(releve) }),
    "observe",
  );
  t.check(
    "DÉDUIT : une hypothèse assumée avec une confiance élevée",
    classifyEpistemic({ confidence: "high", evidence: preuve(mesure, suppose) }),
    "deduction_forte",
  );
  t.check(
    "HYPOTHÈSE : une confiance faible, quelle que soit la base",
    classifyEpistemic({ confidence: "low", evidence: preuve(mesure) }),
    "hypothese",
  );
  t.check(
    "DONNÉE MANQUANTE : aucune base citée",
    classifyEpistemic({ confidence: "high", evidence: preuve("") }),
    "donnee_manquante",
  );

  // --- Une réponse ambiguë ne devient PAS « Observé » ----------------------
  /*
    LE POINT QUE LE PRODUIT NE PEUT PAS SE PERMETTRE DE RATER. « Observé » est
    un niveau CONFIANT : il affirme que la chose a été constatée. Si une réponse
    incomplète y tombait par défaut, chaque défaillance du modèle produirait une
    affirmation. Le défaut est « moyenne », qui mène à « Déduit ».
  */
  for (const [nom, confiance] of [
    ["absente", undefined],
    ["nulle", null],
    ["vide", ""],
    ["inconnue", "peut-être"],
    ["mal orthographiée", "HIGH"],
    ["numérique", "0.9"],
  ] as const) {
    t.check(
      `confiance ${nom} : jamais « Observé » par défaut`,
      classifyEpistemic({ confidence: confiance as string, evidence: preuve(releve) }) ===
        "observe",
      false,
    );
    t.check(
      `confiance ${nom} : le repli est « Déduit »`,
      classifyEpistemic({ confidence: confiance as string, evidence: preuve(releve) }),
      "deduction_forte",
    );
  }
  // …et une base vide prime sur tout, y compris sur une confiance élevée.
  for (const vide of ["", "   ", "n/a", "aucune", "-"]) {
    t.check(
      `base « ${vide} » : donnée manquante malgré la confiance annoncée`,
      classifyEpistemic({ confidence: "high", evidence: preuve(vide) }),
      "donnee_manquante",
    );
  }
  t.check("une preuve absente n'a pas de substance", hasSubstance(undefined), false);
  t.check("un objet n'est pas une preuve", hasSubstance({ texte: "…" }), false);

  // La frontière MESURÉ / OBSERVÉ tient sur une quantité ET une origine.
  t.check(
    "un décompte de page n'est pas une mesure",
    citeUneMesure("aucun verbe d'action sur 34 liens"),
    false,
  );
  t.check("une référence chiffrée non plus", citeUneMesure("Référence 4021 absente"), false);
  t.check("quantité + source = mesure", citeUneMesure(mesure), true);
  t.check(
    "…et une preuve d'échantillon reste une observation",
    citeUneMesure("3 des 5 fiches produit inspectées n'exposent aucun prix"),
    false,
  );
});
