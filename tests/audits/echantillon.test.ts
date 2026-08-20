import { defineSuite } from "../harness";
import {
  storefrontObservations,
  type FetchedPage,
  type PageRole,
  type StorefrontRaw,
} from "@/lib/connectors/storefront";
import {
  MAX_PRODUCT_PAGES,
  VITRINE_SLOTS,
  productSample,
} from "@/lib/connectors/storefront.server";
import {
  EVIDENCE_WEIGHT,
  RULES,
  capLevel,
  lirePortee,
  runRules,
  type RuleContext,
} from "@/lib/audit-rules";
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

  // Sans catalogue connu, l'échantillon reste celui de la vitrine : c'est le
  // comportement de repli, et il doit rester intact.
  const e = productSample(depuisAccueil, depuisCollection).chemins;
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
    productSample(depuisAccueil, depuisCollection).chemins,
    e,
  );

  const beaucoup = Array.from({ length: 40 }, (_, i) => `/products/p${i}`);
  t.check("l'échantillon est borné", productSample([], beaucoup).chemins.length, MAX_PRODUCT_PAGES);
  t.check("…et la borne reste raisonnable pour la boutique", MAX_PRODUCT_PAGES <= 8, true);
  // Un petit catalogue est inspecté ENTIÈREMENT : l'échantillon est alors le
  // catalogue, et le constat a le droit de le dire.
  t.check(
    "un petit catalogue passe en entier",
    productSample([], depuisCollection).chemins.length,
    3,
  );
  t.check("aucune fiche, aucun échantillon", productSample([], []).chemins, []);

  // =========================================================================
  // 1 bis. L'ÉCHANTILLON HYBRIDE — LE BIAIS DE VITRINE
  // =========================================================================
  /*
    LE DÉFAUT QUE CECI CORRIGE. Ne suivre que les liens de l'accueil et de la
    collection revient à n'inspecter que ce que la boutique MET EN AVANT — ses
    meilleures pages. Un tel échantillon surestime la qualité moyenne du
    catalogue par construction, et rien dans le rapport ne le signalait.

    Les identifiants de catalogue viennent de l'API Admin, du même appel qui
    alimente déjà les observations de catalogue : aucun appel de plus, aucune
    permission de plus.
  */
  const catalogue = Array.from({ length: 100 }, (_, i) => `article-${i}`);
  const hybride = productSample(depuisAccueil, depuisCollection, catalogue);
  t.check("l'échantillon reste borné", hybride.chemins.length, MAX_PRODUCT_PAGES);
  t.check("la vitrine garde ses places réservées", hybride.vitrine, VITRINE_SLOTS);
  t.check("…et le catalogue occupe le reste", hybride.catalogue, MAX_PRODUCT_PAGES - VITRINE_SLOTS);
  t.check(
    "les deux premières viennent bien de la vitrine",
    hybride.chemins.slice(0, VITRINE_SLOTS).every((p) => !p.includes("article-")),
    true,
  );
  // LE PAS EST RÉGULIER : prendre les premiers du catalogue ne lirait que les
  // fiches les plus anciennes, et un tirage au sort rendrait deux audits
  // successifs incomparables.
  const indices = hybride.chemins
    .filter((p) => p.includes("article-"))
    .map((p) => Number(p.split("article-")[1]));
  t.check("le catalogue est balayé de bout en bout", Math.max(...indices) >= 60, true);
  t.check("…et pas seulement au début", new Set(indices).size, indices.length);
  t.check(
    "deux passages rendent le même échantillon hybride",
    productSample(depuisAccueil, depuisCollection, catalogue).chemins,
    hybride.chemins,
  );

  // Sans vitrine, le catalogue prend toutes les places.
  const sansVitrine = productSample([], [], catalogue);
  t.check("sans vitrine, tout vient du catalogue", sansVitrine.catalogue, MAX_PRODUCT_PAGES);
  t.check("…et rien de la vitrine", sansVitrine.vitrine, 0);

  // Un petit catalogue est lu entièrement, sans doublon avec la vitrine.
  const petit = productSample([], ["/products/article-0"], ["article-0", "article-1", "article-2"]);
  t.check(
    "un petit catalogue ne produit pas de doublon",
    new Set(petit.chemins).size,
    petit.chemins.length,
  );
  t.check("…et il est lu en entier", petit.chemins.length, 3);

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
  /*
    LA COUVERTURE DÉCIDE DU POIDS, PAS DE LA VÉRITÉ. « 3 des 5 fiches
    inspectées » reste exact sur un catalogue de trois cents. Mais le marchand
    agit sur son catalogue, et cinq fiches sur trois cents ne soutiennent pas la
    même décision que cinq fiches sur douze. Le constat garde sa formulation et
    perd du poids — donc il descend dans le classement sans rien dire de faux.
  */
  t.check("…et une couverture calculée", plusieurs.couverture, 5 / 300);
  t.check("…qui empêche de PROUVER sur un catalogue mince", plusieurs.plafond, "fortement_suggere");
  const bienCouvert = lirePortee(3, 5, 12);
  t.check("une couverture large autorise la preuve", bienCouvert.plafond, "prouve");
  t.check("…et la couverture est lisible", bienCouvert.couverture, 5 / 12);
  t.check("sans catalogue connu, aucune couverture", lirePortee(3, 5).couverture, null);
  t.check("…et rien ne vient rabaisser le constat", lirePortee(3, 5).plafond, "prouve");

  // Le catalogue entièrement inspecté est la SEULE portée où parler du
  // catalogue n'est pas une extrapolation.
  const complet = lirePortee(4, 6, 6);
  t.check("catalogue complet", complet.portee, "catalogue_complet");
  t.check(
    "…et la phrase le dit",
    /fiches du catalogue, toutes inspectées/.test(complet.phrase),
    true,
  );
  t.check("…et elle prouve", complet.plafond, "prouve");

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
  // 4 bis. LA PROVENANCE DE L'ÉCHANTILLON ENTRE DANS LA PREUVE
  // =========================================================================
  /*
    « 5 fiches inspectées » ne dit pas la même chose selon qu'elles viennent de
    la page d'accueil — donc des fiches que le marchand a choisi de mettre en
    avant — ou d'un balayage du catalogue. Le premier échantillon surestime la
    qualité moyenne par construction. Un lecteur qui ne peut pas faire la
    différence lit le second alors qu'on lui montre le premier.
  */
  const avecProvenance = (origin: { vitrine: number; catalogue: number }, connu: number) =>
    storefrontObservations({
      ...scan([
        ["a", ""],
        ["b", ""],
      ]),
      sampleOrigin: origin,
      catalogueKnown: connu,
    }).observations.find((o) => o.id === "storefront.produits_inspectes")?.evidence ?? "";

  const vitrineSeule = avecProvenance({ vitrine: 2, catalogue: 0 }, 0);
  t.check(
    "un échantillon de vitrine le dit",
    /parcours visible/.test(vitrineSeule) &&
      /catalogue complet n'ayant pas été consulté/.test(vitrineSeule),
    true,
  );
  t.check(
    "…et il avertit de ce que cela signifie",
    /met en avant, pas sa moyenne/.test(vitrineSeule),
    true,
  );
  const hybrideProuve = avecProvenance({ vitrine: 1, catalogue: 1 }, 100);
  t.check(
    "un échantillon hybride compte ses deux moitiés",
    /1 issues? du parcours visible et 1 réparties? à pas régulier sur les 100/.test(hybrideProuve),
    true,
  );
  t.check(
    "une provenance inconnue ne s'invente pas",
    /provenance de l'échantillon non renseignée/.test(
      avecProvenance({ vitrine: 0, catalogue: 0 }, 0),
    ),
    true,
  );

  // LE BIAIS, DÉMONTRÉ. Sur la même boutique, l'échantillon de vitrine ne voit
  // que les fiches soignées ; l'hybride voit le catalogue tel qu'il est.
  const soignee: [string, string] = ["vedette", AVEC_TOUT];
  const brouillon = (h: string): [string, string] => [h, ""];
  const vitrineOnly = storefrontObservations(scan([soignee, ["autre-vedette", AVEC_TOUT]]));
  const hybrideScan = storefrontObservations(
    scan([soignee, ["autre-vedette", AVEC_TOUT], brouillon("a"), brouillon("b"), brouillon("c")]),
  );
  const manquants = (o: ReturnType<typeof storefrontObservations>) =>
    o.observations.find((x) => x.id === "storefront.produits_sans_ajout_panier")?.value;
  t.check("la vitrine seule ne voit aucun défaut", manquants(vitrineOnly), 0);
  t.check("…l'échantillon élargi en voit trois", manquants(hybrideScan), 3);

  // =========================================================================
  // 4 ter. LA COUVERTURE PÈSE SUR LA PRIORITÉ, PAS SUR LA VÉRITÉ
  // =========================================================================
  /*
    Une observation issue de 5 fiches sur un catalogue de 100 ne doit pas être
    traitée comme une observation portant sur 100. Le constat reste vrai — il
    porte sur l'échantillon — mais il pèse moins dans le classement.
  */
  const base = {
    "storefront.produits_sans_livraison": 4,
    "storefront.produits_inspectes": 5,
    "shopify.cart_abandonment_rate": 0.82,
    "shopify.orders_30d": 140,
  };
  const mince = constat(
    ctxDe({ ...base, "shopify.product_count": 300 }),
    "conversion.livraison_absente_fiche",
  );
  const large = constat(
    ctxDe({ ...base, "shopify.product_count": 12 }),
    "conversion.livraison_absente_fiche",
  );
  t.check("couverture mince : le constat sort quand même", Boolean(mince), true);
  t.check("couverture large : le constat sort aussi", Boolean(large), true);
  t.check(
    "les deux disent la même chose de l'échantillon",
    /4 des 5 fiches produit inspectées/.test(mince?.statement ?? "") &&
      /4 des 5 fiches produit inspectées/.test(large?.statement ?? ""),
    true,
  );
  /*
    CE QUE LE PLAFOND DE COUVERTURE FAIT, ET CE QU'IL NE FAIT PAS.

    C'est un PLAFOND, pas une pénalité : il abaisse un constat qui prétendrait
    prouver, il ne fait pas descendre un constat déjà plus bas. Sur les règles
    produit d'aujourd'hui, un autre plafond mord toujours en premier — le
    plafond technique pour celles qui lisent un document servi, la corroboration
    commerciale pour celle des frais de livraison. Le plafond de couverture est
    donc un garde-fou en attente, et le contrôle porte sur la composition
    elle-même plutôt que sur un effet qu'aucune règle ne produit encore.
  */
  t.check(
    "le plafond mince abaisse un constat qui prouverait",
    lirePortee(4, 5, 300).plafond,
    "fortement_suggere",
  );
  t.check(
    "…et n'abaisse rien de plus bas",
    capLevel("a_verifier", lirePortee(4, 5, 300).plafond),
    "a_verifier",
  );
  t.check(
    "une couverture large laisse prouver",
    capLevel("prouve", lirePortee(4, 5, 12).plafond),
    "prouve",
  );
  t.check(
    "…et le poids de priorité suit ce plafond",
    EVIDENCE_WEIGHT["fortement_suggere"] < EVIDENCE_WEIGHT["prouve"],
    true,
  );
  // Toute règle qui lit une portée doit la composer avec `capLevel` : c'est le
  // seul endroit où le plafond d'échantillon peut être oublié.
  for (const r of RULES) {
    const src = r.evaluate.toString();
    if (src.includes("lirePortee(")) {
      t.check(`${r.id} compose son niveau avec la portée`, src.includes("capLevel("), true);
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
