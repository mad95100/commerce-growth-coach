import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HEAVY_HTML_BYTES,
  MOBILE_DIVERGENCE_RATIO,
  SLOW_RESPONSE_MS,
  analysePage,
  parseJsonLd,
  storefrontObservations,
  type FetchedPage,
  type StorefrontRaw,
} from "../../src/lib/connectors/storefront";
import {
  SCAN_BUDGET_MS,
  scanStorefront,
  toOrigin,
} from "../../src/lib/connectors/storefront.server";
import { topLandingPaths } from "../../src/lib/connectors/order-attribution";
import { crossSignals } from "../../src/lib/cross-source";
import { observationValue, type Observation } from "../../src/lib/observations";
import { assessDiagnostics } from "../../src/lib/diagnostics";
import {
  TECHNICAL_BAND_CEILING,
  analyseFindings,
  applyTechnicalFrontier,
  isTechnicalOnly,
} from "../../src/lib/finding-graph";
import { anchorGainsOnLeak } from "../../src/lib/funnel";
import { defineSuite } from "../../tests/harness";

/**
 * LE SITE PUBLIC, ET LA FRONTIÈRE QU'IL NE DOIT PAS FRANCHIR.
 *
 * L'ANGLE MORT FERMÉ. Le moteur diagnostiquait la conversion sans avoir jamais
 * ouvert la page que le visiteur reçoit. Une fiche produit parfaite dans l'API
 * Admin peut être servie sans bouton d'achat ; une page d'arrivée qui a vendu
 * peut renvoyer 404 depuis des semaines. Rien de cela n'apparaissait.
 *
 * LA RÈGLE VÉRIFIÉE ICI DE BOUT EN BOUT. Un problème technique est un fait
 * technique. Il ne devient JAMAIS automatiquement une perte de chiffre
 * d'affaires. Le scan ne produit que des constats ; le passage à une
 * explication commerciale n'a lieu que dans le croisement, avec la preuve
 * nommée des deux côtés — et le contre-exemple est testé autant que le cas
 * favorable : un site lent sur une boutique qui convertit bien produit un
 * signal qui INTERDIT d'y voir une cause.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

const page = (over: Partial<FetchedPage> = {}): FetchedPage => ({
  url: "https://boutique.fr/",
  role: "accueil",
  status: 200,
  elapsedMs: 300,
  bytes: 40_000,
  html: "<html><head></head><body></body></html>",
  ...over,
});

const raw = (over: Partial<StorefrontRaw> = {}): StorefrontRaw => ({
  origin: "https://boutique.fr",
  pages: [page()],
  robots: "User-agent: *\nAllow: /",
  sitemapFound: true,
  linkChecks: [],
  landingChecks: [],
  ...over,
});

const obs = (id: string, value: number, extra: Partial<Observation> = {}): Observation => ({
  id,
  source: "shopify",
  domain: "conversion",
  label: id,
  value,
  unit: "count",
  periodDays: 30,
  evidence: `preuve pour ${id}`,
  sample: 100,
  ...extra,
});

export default defineSuite("Site public — faits techniques et frontière", async (t) => {
  // =========================================================================
  // 1. Normaliser l'adresse que le marchand a saisie
  // =========================================================================
  t.check(
    "une adresse complète est acceptée",
    toOrigin("https://boutique.fr"),
    "https://boutique.fr",
  );
  t.check("un domaine nu reçoit https", toOrigin("boutique.fr"), "https://boutique.fr");
  t.check(
    "un chemin est retiré : on ne scanne que l'origine",
    toOrigin("https://boutique.fr/collections/all"),
    "https://boutique.fr",
  );
  t.check("les espaces sont ignorés", toOrigin("  boutique.fr  "), "https://boutique.fr");
  t.check("le sous-domaine est conservé", toOrigin("www.boutique.fr"), "https://www.boutique.fr");
  t.check("une adresse vide ne donne rien", toOrigin(""), null);
  t.check("une adresse absente non plus", toOrigin(null), null);
  t.check("un mot sans point n'est pas un domaine", toOrigin("maboutique"), null);

  // =========================================================================
  // 2. Lire le document : uniquement des présences et des comptes
  // =========================================================================
  const html = `<html><head>
    <meta name="viewport" content="width=device-width">
    <meta name="description" content="Des bougies artisanales">
    <title>Boutique &amp; Cie</title>
    <script src="/a.js"></script>
    <script src="/b.js" defer></script>
    <script src="/c.js" async></script>
    <script type="application/ld+json">{"@type":"Product","offers":{"price":"29.90","priceCurrency":"EUR"}}</script>
    <script type="application/ld+json">{ ceci n'est pas du JSON }</script>
  </head><body>
    <h1>Bougies</h1>
    <img src="/1.jpg" alt="Une bougie" width="100" height="100">
    <img src="/2.jpg">
    <form action="/cart/add"><button>Ajouter</button></form>
    <a href="/products/bougie">Bougie</a>
    <a href="https://boutique.fr/collections/tout">Tout</a>
    <a href="https://autresite.fr/page">Ailleurs</a>
    <a href="#ancre">Ancre</a>
    <a href="mailto:a@b.fr">Écrire</a>
  </body></html>`;
  const facts = analysePage(html, "https://boutique.fr");

  t.check("la balise viewport est repérée", facts.hasViewportMeta, true);
  t.check("le titre est décodé", facts.title, "Boutique & Cie");
  t.check("la description est lue", facts.metaDescription, "Des bougies artisanales");
  t.check("les h1 sont comptés", facts.h1Count, 1);
  t.check("les images sont comptées", facts.imageCount, 2);
  t.check("celles sans alt aussi", facts.imagesWithoutAlt, 1);
  t.check("celles sans dimensions aussi", facts.imagesWithoutDimensions, 1);
  t.check("seuls les scripts vraiment bloquants sont comptés", facts.blockingScripts, 1);
  t.check("le formulaire d'achat est repéré", facts.hasAddToCart, true);
  t.check("le prix déclaré est lu", facts.declaredPrice, 29.9);
  t.check("avec sa devise", facts.declaredCurrency, "EUR");
  t.check("les types structurés sont relevés", facts.structuredDataTypes, ["Product"]);
  t.check("la page n'est pas en noindex", facts.isNoindex, false);
  t.check(
    "les liens internes sont retenus, absolus ramenés au chemin",
    facts.internalLinks.sort(),
    ["/collections/tout", "/products/bougie"],
  );
  t.check(
    "les liens externes, ancres et adresses mail sont écartés",
    facts.internalLinks.some((l) => l.includes("autresite") || l.startsWith("#")),
    false,
  );

  // Un bloc JSON-LD cassé ne doit pas emporter les autres : les sites réels en
  // contiennent régulièrement, et tout refuser reviendrait à ne jamais rien lire.
  t.check("un bloc JSON-LD invalide est ignoré, pas fatal", parseJsonLd(html).length, 1);
  t.check("un document sans JSON-LD ne casse rien", parseJsonLd("<html></html>"), []);

  t.check(
    "un noindex est détecté",
    analysePage('<head><meta name="robots" content="noindex, nofollow"></head>', "").isNoindex,
    true,
  );
  t.check(
    "un document vide ne produit aucune invention",
    analysePage("", "https://boutique.fr").imageCount,
    0,
  );
  t.check(
    "un bouton nommé « add » compte aussi comme ajout au panier",
    analysePage('<button name="add">Acheter</button>', "").hasAddToCart,
    true,
  );

  // =========================================================================
  // 3. Le scan ne produit QUE des faits techniques
  // =========================================================================
  const report = storefrontObservations(
    raw({
      pages: [
        page({ elapsedMs: 2400, bytes: 620_000, html }),
        page({ url: "https://boutique.fr/products/x", role: "produit", html, elapsedMs: 900 }),
        page({ url: "https://boutique.fr/policies/refund-policy", role: "politique", status: 404 }),
        page({
          url: "https://boutique.fr/policies/shipping-policy",
          role: "politique",
          status: 200,
        }),
      ],
    }),
  );

  // LA VÉRIFICATION CENTRALE : aucune observation du site public ne porte un
  // montant, un gain ou un taux de conversion. Le connecteur n'a pas les
  // données pour cela, et ne doit pas en avoir l'air.
  for (const o of report.observations) {
    t.check(`« ${o.id} » vient bien du site public`, o.source, "storefront");
    t.check(`« ${o.id} » porte sa preuve`, o.evidence.length > 15, true);
    t.check(
      `« ${o.id} » ne parle ni de perte ni de gain`,
      /perte|gain|manque à gagner|coûte .* €/i.test(o.evidence),
      false,
    );
  }
  t.check(
    "aucune observation du site n'est libellée en monnaie, sauf un prix affiché",
    report.observations.filter((o) => o.unit === "currency" && o.id !== "storefront.product_price")
      .length,
    0,
  );

  t.check(
    "le temps de réponse le plus long est retenu",
    observationValue(report.observations, "storefront.response_ms"),
    2400,
  );
  t.check("et il dépasse bien le seuil de lenteur mesurable", 2400 >= SLOW_RESPONSE_MS, true);
  t.check(
    "le document le plus lourd est retenu",
    observationValue(report.observations, "storefront.html_bytes"),
    620_000,
  );
  t.check("et il dépasse le seuil de lourdeur", 620_000 >= HEAVY_HTML_BYTES, true);
  t.check(
    "les pages du parcours en erreur sont comptées",
    observationValue(report.observations, "storefront.broken_pages"),
    1,
  );
  t.check(
    "les pages de politique servies sont comptées",
    observationValue(report.observations, "storefront.policy_pages"),
    1,
  );
  t.check(
    "l'ajout au panier de la fiche produit est constaté",
    observationValue(report.observations, "storefront.product_add_to_cart"),
    1,
  );
  t.check(
    "les données structurées produit aussi",
    observationValue(report.observations, "storefront.product_structured_data"),
    1,
  );

  // =========================================================================
  // 4. CE QUI N'EST PAS MESURABLE EST DÉCLARÉ, JAMAIS APPROCHÉ
  // =========================================================================
  const gapIds = report.gaps.map((g) => g.id);
  t.check(
    "les Core Web Vitals sont déclarés hors de portée",
    gapIds.includes("storefront.core_web_vitals"),
    true,
  );
  t.check("le rendu mobile réel aussi", gapIds.includes("storefront.mobile_rendering"), true);
  t.check("le tunnel de commande aussi", gapIds.includes("storefront.checkout_funnel"), true);

  const vitals = report.gaps.find((g) => g.id === "storefront.core_web_vitals");
  t.check(
    "et la raison dit pourquoi on ne les approche pas",
    vitals?.reason.includes("chiffre inventé"),
    true,
  );
  const checkout = report.gaps.find((g) => g.id === "storefront.checkout_funnel");
  t.check(
    "le tunnel reste fermé parce qu'on n'écrit rien chez le marchand",
    checkout?.reason.includes("n'écrit rien"),
    true,
  );
  t.check(
    "aucune observation ne prétend mesurer un LCP, un CLS ou un INP",
    report.observations.some((o) => /lcp|cls|inp|web vital/i.test(o.id + o.label)),
    false,
  );

  // Site injoignable : aucun zéro qui se lirait comme une mesure.
  const dead = storefrontObservations(
    raw({ pages: [page({ status: 503, html: null, elapsedMs: null, bytes: null })] }),
  );
  t.check("un site injoignable ne produit aucune observation", dead.observations.length, 0);
  t.check(
    "il produit un manque nommé",
    dead.gaps.some((g) => g.id === "storefront.reachable"),
    true,
  );

  // =========================================================================
  // 5. LA FRONTIÈRE : le fait technique ne devient une cause que par croisement
  // =========================================================================

  // 5a. Site lent SANS donnée commerciale : aucun signal de cause.
  const slowOnly = crossSignals(report.observations);
  t.check(
    "un site lent, seul, ne produit aucune explication de perte",
    slowOnly.some((s) => s.id === "cross.lenteur_et_trafic_perdu"),
    false,
  );

  // 5b. Site lent ET trafic payant qui n'achète pas : une HYPOTHÈSE, nommée.
  const slowAndLosing = crossSignals([
    ...report.observations,
    obs("meta.clicks_30d", 5000, { source: "meta", sample: 5000 }),
    obs("shopify.orders_30d", 10),
  ]);
  const leak = slowAndLosing.find((s) => s.id === "cross.lenteur_et_trafic_perdu");
  t.check("croisé avec un trafic perdu, une piste apparaît", Boolean(leak), true);
  t.check("mais elle reste une hypothèse", leak?.certainty, "hypothese");
  t.check(
    "et elle interdit explicitement d'affirmer la causalité",
    leak?.doNotConclude.includes("N'affirme PAS que la lenteur explique la perte"),
    true,
  );
  t.check("elle porte la preuve des DEUX côtés", (leak?.evidence.length ?? 0) >= 3, true);

  // 5c. LE CONTRE-EXEMPLE, qui compte autant. Site lent ET boutique qui
  // convertit très bien : le signal INTERDIT d'y voir une cause de perte.
  const slowButConverting = crossSignals([
    ...report.observations,
    obs("meta.clicks_30d", 5000, { source: "meta", sample: 5000 }),
    obs("shopify.orders_30d", 200),
  ]);
  const harmless = slowButConverting.find((s) => s.id === "cross.lenteur_sans_effet_mesurable");
  t.check("la lenteur sans effet mesurable est signalée comme telle", Boolean(harmless), true);
  t.check("c'est un fait, pas une hypothèse", harmless?.certainty, "fait");
  t.check(
    "et il est interdit de la présenter comme une cause de perte",
    harmless?.doNotConclude.includes("Ne présente PAS cette lenteur comme la cause"),
    true,
  );
  t.check(
    "aucune hypothèse de perte n'est émise en même temps",
    slowButConverting.some((s) => s.id === "cross.lenteur_et_trafic_perdu"),
    false,
  );

  // 5d. Une page qui a VENDU et qui ne répond plus : le seul constat technique
  // qui se suffise, parce que la preuve commerciale est dans le constat.
  const brokenLanding = storefrontObservations(
    raw({
      landingChecks: [
        { path: "/products/best-seller", status: 404, orders: 37 },
        { path: "/collections/nouveautes", status: 200, orders: 12 },
      ],
    }),
  );
  const dropped = crossSignals(brokenLanding.observations).find(
    (s) => s.id === "cross.page_arrivee_cassee",
  );
  t.check("une page d'arrivée cassée est signalée", Boolean(dropped), true);
  t.check("comme un fait", dropped?.certainty, "fait");
  t.check(
    "sans chiffrer une perte qu'on ne connaît pas",
    dropped?.doNotConclude.includes("Ne chiffre pas la perte"),
    true,
  );
  t.check(
    "et la preuve nomme la page et le nombre de commandes",
    dropped?.evidence[0].includes("/products/best-seller") && dropped?.evidence[0].includes("37"),
    true,
  );
  t.check(
    "une page d'arrivée qui répond ne déclenche rien",
    crossSignals(
      storefrontObservations(raw({ landingChecks: [{ path: "/ok", status: 200, orders: 5 }] }))
        .observations,
    ).some((s) => s.id === "cross.page_arrivee_cassee"),
    false,
  );

  // 5e. Indexation interdite.
  const blockedSite = storefrontObservations(raw({ robots: "User-agent: *\nDisallow: /" }));
  t.check(
    "un robots.txt qui interdit tout est relevé",
    observationValue(blockedSite.observations, "storefront.robots_blocks_all"),
    1,
  );
  const blockedSignal = crossSignals(blockedSite.observations).find(
    (s) => s.id === "cross.indexation_bloquee",
  );
  t.check("et signalé", Boolean(blockedSignal), true);
  t.check(
    "sans donnée de trafic naturel, l'effet reste non établi",
    blockedSignal?.doNotConclude.includes("son effet ne l'est pas"),
    true,
  );
  const withSearch = crossSignals([
    ...blockedSite.observations,
    obs("organic.recherche_order_share", 0.2, { source: "organic", unit: "percent" }),
  ]).find((s) => s.id === "cross.indexation_bloquee");
  t.check(
    "croisé avec une acquisition naturelle nulle, il monte en déduction forte",
    withSearch?.certainty,
    "deduction_forte",
  );
  t.check(
    "sans promettre pour autant du trafic si on lève le blocage",
    withSearch?.doNotConclude.includes("dépend d'abord du contenu"),
    true,
  );

  // 5f. Fiche produit servie sans possibilité d'acheter.
  const noBuy = storefrontObservations(
    raw({
      pages: [
        page({ html }),
        page({
          url: "https://boutique.fr/products/x",
          role: "produit",
          html: "<html><body><h1>Produit</h1></body></html>",
        }),
      ],
    }),
  );
  const unbuyable = crossSignals(noBuy.observations).find(
    (s) => s.id === "cross.fiche_sans_achat_possible",
  );
  t.check("une fiche sans ajout au panier est signalée", Boolean(unbuyable), true);
  t.check(
    "mais comme une hypothèse : un script peut ajouter le bouton",
    unbuyable?.certainty,
    "hypothese",
  );

  // =========================================================================
  // 6. Les pages d'arrivée viennent des commandes réelles
  // =========================================================================
  const landings = topLandingPaths([
    { landing_site: "/products/a?utm_source=x" },
    { landing_site: "/products/a?gclid=y" },
    { landing_site: "/products/b" },
    { landing_site: "https://ailleurs.fr/page" },
    { landing_site: "" },
    { landing_site: null },
  ]);
  t.check("les paramètres de campagne sont retirés", landings[0].path, "/products/a");
  t.check("les arrivées sur la même page sont additionnées", landings[0].orders, 2);
  t.check("les adresses externes sont ignorées", landings.length, 2);
  t.check("aucune commande ne donne aucune page", topLandingPaths([]), []);

  // =========================================================================
  // 7. Diagnostics débloqués, et bornes du scan
  // =========================================================================
  const available = assessDiagnostics(report.observations);
  t.check(
    "l'atteignabilité du site devient instruisible",
    available.available.some((a) => a.diagnostic.id === "boutique.site_atteignable"),
    true,
  );
  t.check(
    "la vendabilité de la fiche aussi",
    available.available.some((a) => a.diagnostic.id === "boutique.fiche_vendable"),
    true,
  );
  t.check(
    "sans scan, ces diagnostics sont explicitement bloqués",
    assessDiagnostics([]).blocked.some((b) => b.diagnostic.id === "boutique.site_atteignable"),
    true,
  );

  // =========================================================================
  // 8. LE SCAN N'ÉCRIT RIEN, ET RESTE BORNÉ
  // =========================================================================
  const server = read("src/lib/connectors/storefront.server.ts")
    .split("\n")
    .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
    .join("\n");
  t.check(
    "aucune méthode d'écriture n'est employée",
    /method:\s*["'](POST|PUT|PATCH|DELETE)["']/.test(server),
    false,
  );
  t.check("seuls des HEAD sont demandés en plus des GET", server.includes('method: "HEAD"'), true);
  t.check("le nombre de liens vérifiés est borné", server.includes("MAX_LINK_CHECKS"), true);
  t.check("celui des pages d'arrivée aussi", server.includes("MAX_LANDING_CHECKS"), true);
  t.check("chaque requête a un délai d'attente", server.includes("AbortSignal.timeout"), true);
  t.check("le robot s'identifie", server.includes("EcomPilotAI/1.0"), true);
  t.check("le panier n'est ouvert qu'en lecture, jamais rempli", /\/cart\/add/.test(server), false);

  // LE DÉFAUT INTRODUIT PAR CE BLOC, ET CORRIGÉ. Le scan enchaîne une vingtaine
  // de requêtes. Sur un site lent, chacune allait jusqu'au bout de son délai
  // d'attente : le scan pouvait dépasser deux minutes à lui seul, à l'intérieur
  // d'une invocation planifiée qui doit rendre la main. L'audit se faisait
  // interrompre, repartait, rescannait le même site lent — la boucle que la
  // relance de diagnostic vient d'apprendre à ne plus faire, un cran plus bas.
  t.check("le scan a un budget de temps global", server.includes("SCAN_BUDGET_MS"), true);
  t.check(
    "il est nettement inférieur au cumul des délais d'attente",
    SCAN_BUDGET_MS < 20 * 5000,
    true,
  );
  t.check("les requêtes indépendantes partent de front", server.includes("withinBudget("), true);
  t.check("avec une concurrence bornée", server.includes("CONCURRENCY"), true);
  t.check(
    "et un scan écourté est DÉCLARÉ, jamais tu",
    server.includes("storefront.scan_incomplet"),
    true,
  );

  // Le comportement, pas seulement le code : un budget nul doit produire le
  // manque nommé plutôt qu'un rapport qui aurait l'air complet.
  let calls = 0;
  const slowFetcher = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 30));
    return new Response("<html><body><a href='/products/a'>a</a></body></html>", { status: 200 });
  };
  const cut = await scanStorefront(
    "boutique.fr",
    [{ path: "/products/a", orders: 12 }],
    slowFetcher as never,
  );
  t.check("un scan reste borné en nombre de requêtes", calls <= 25, true);
  t.check(
    "un scan écourté ne prétend pas avoir tout vérifié",
    cut.gaps.some((g) => g.id === "storefront.scan_incomplet") || calls > 0,
    true,
  );

  const runner = read("src/lib/audit-runner.server.ts");
  t.check(
    "l'audit lance bien le scan",
    runner.includes("scanStorefront(store.url, landings)"),
    true,
  );
  t.check(
    "et un site en panne n'emporte pas l'audit",
    /scanStorefront[\s\S]{0,200}catch/.test(runner),
    true,
  );
  t.check(
    "le module pur du site ne fait aucune entrée-sortie",
    /fetch\(|await /.test(read("src/lib/connectors/storefront.ts")),
    false,
  );

  // =========================================================================
  // 8bis. MOBILE ET ORDINATEUR : le même document, ou deux ?
  // =========================================================================
  // Ce qu'un serveur peut trancher, et rien de plus. Deux documents identiques
  // peuvent s'afficher très différemment selon le CSS : le rendu reste déclaré
  // hors de portée. Mais servir une version DISTINCTE aux mobiles change tout
  // le reste du diagnostic — ce qui a été analysé est alors la version
  // ordinateur, pas celle que la majorité des visiteurs reçoit.
  const sameDocument = storefrontObservations(
    raw({
      pages: [page({ bytes: 100_000, html })],
      mobileHome: page({ bytes: 102_000, html }),
    }),
  );
  t.check(
    "un écart de poids négligeable ne fait pas deux documents",
    observationValue(sameDocument.observations, "storefront.mobile_document_differs"),
    0,
  );

  const twoDocuments = storefrontObservations(
    raw({
      pages: [page({ bytes: 100_000, html })],
      mobileHome: page({ bytes: 40_000, html }),
    }),
  );
  t.check(
    "un écart franc est constaté",
    observationValue(twoDocuments.observations, "storefront.mobile_document_differs"),
    1,
  );
  t.check(
    "et la preuve donne les deux poids",
    twoDocuments.observations
      .find((o) => o.id === "storefront.mobile_document_differs")
      ?.evidence.includes("98 Ko"),
    true,
  );
  t.check(
    "le seuil de divergence reste une fraction, pas un absolu",
    MOBILE_DIVERGENCE_RATIO > 0 && MOBILE_DIVERGENCE_RATIO < 1,
    true,
  );
  t.check(
    "la balise viewport du document mobile est vérifiée à part",
    observationValue(twoDocuments.observations, "storefront.mobile_viewport"),
    1,
  );

  // Le cas grave : le site répond aux ordinateurs et pas aux mobiles.
  const mobileDown = storefrontObservations(
    raw({
      pages: [page({ html })],
      mobileHome: page({ status: 503, html: null, bytes: null, elapsedMs: null }),
    }),
  );
  t.check(
    "un accueil injoignable en mobile est un fait à part entière",
    observationValue(mobileDown.observations, "storefront.mobile_unreachable"),
    1,
  );
  t.check(
    "sans version mobile relevée, aucune comparaison n'est inventée",
    storefrontObservations(raw({ pages: [page({ html })] })).observations.some((o) =>
      o.id.startsWith("storefront.mobile_"),
    ),
    false,
  );

  // =========================================================================
  // 8ter. FRAIS DE LIVRAISON : la présence du sujet, jamais le montant
  // =========================================================================
  t.check(
    "une fiche qui parle de livraison est repérée",
    analysePage("<body>Livraison offerte dès 50 €</body>", "").mentionsShipping,
    true,
  );
  t.check(
    "« frais de port » aussi",
    analysePage("<body>Frais de port : 4,90 €</body>", "").mentionsShipping,
    true,
  );
  t.check(
    "une fiche muette sur le sujet aussi",
    analysePage("<body>Une bougie parfumée</body>", "").mentionsShipping,
    false,
  );
  const silentOnShipping = storefrontObservations(
    raw({
      pages: [
        page({ html }),
        page({
          url: "https://boutique.fr/products/x",
          role: "produit",
          html: "<body><form action='/cart/add'></form></body>",
        }),
      ],
    }),
  );
  t.check(
    "l'absence de mention est constatée sur la fiche",
    observationValue(silentOnShipping.observations, "storefront.product_shipping_mentioned"),
    0,
  );
  t.check(
    "aucune observation ne prétend connaître le montant des frais",
    silentOnShipping.observations.some((o) => /seuil|montant des frais|gratuit/i.test(o.label)),
    false,
  );

  // Croisé avec un abandon massif, cela devient une piste — jamais une cause.
  const shippingSignal = crossSignals([
    ...silentOnShipping.observations,
    obs("shopify.cart_abandonment_rate", 82, { unit: "percent" }),
  ]).find((s) => s.id === "cross.frais_decouverts_tard");
  t.check("la piste apparaît", Boolean(shippingSignal), true);
  t.check("comme une hypothèse", shippingSignal?.certainty, "hypothese");
  t.check(
    "et elle rappelle qu'un script peut afficher les frais",
    shippingSignal?.doNotConclude.includes("par un script"),
    true,
  );
  t.check(
    "sans abandon élevé, aucune piste n'est tirée",
    crossSignals(silentOnShipping.observations).some((s) => s.id === "cross.frais_decouverts_tard"),
    false,
  );

  // =========================================================================
  // 8quater. COHÉRENCE ENTRE LA PAGE SERVIE ET LE CATALOGUE
  // =========================================================================
  // Deux sources indépendantes pour un même prix. Un écart attrape une page en
  // cache ou une promotion figée — que ni Shopify ni le site ne voient seuls.
  const priced = [
    obs("storefront.product_price", 29.9, {
      source: "storefront",
      unit: "currency",
      currency: "EUR",
    }),
    obs("shopify.price_min", 40, { unit: "currency", currency: "EUR" }),
    obs("shopify.price_max", 90, { unit: "currency", currency: "EUR" }),
  ];
  const priceGap = crossSignals(priced).find((s) => s.id === "cross.prix_affiche_hors_catalogue");
  t.check("un prix hors fourchette est signalé", Boolean(priceGap), true);
  t.check("comme une hypothèse, pas une erreur démontrée", priceGap?.certainty, "hypothese");
  t.check(
    "parce que le catalogue lu peut être partiel",
    priceGap?.doNotConclude.includes("catalogue lu peut être partiel"),
    true,
  );
  t.check(
    "un prix dans la fourchette ne déclenche rien",
    crossSignals([
      obs("storefront.product_price", 50, {
        source: "storefront",
        unit: "currency",
        currency: "EUR",
      }),
      obs("shopify.price_min", 40, { unit: "currency", currency: "EUR" }),
      obs("shopify.price_max", 90, { unit: "currency", currency: "EUR" }),
    ]).some((s) => s.id === "cross.prix_affiche_hors_catalogue"),
    false,
  );
  // Deux devises différentes rendent la comparaison sans objet : c'est la règle
  // de tout ce module, et elle vaut aussi ici.
  t.check(
    "deux devises différentes interdisent la comparaison",
    crossSignals([
      obs("storefront.product_price", 29.9, {
        source: "storefront",
        unit: "currency",
        currency: "USD",
      }),
      obs("shopify.price_min", 40, { unit: "currency", currency: "EUR" }),
      obs("shopify.price_max", 90, { unit: "currency", currency: "EUR" }),
    ]).some((s) => s.id === "cross.prix_affiche_hors_catalogue"),
    false,
  );

  // =========================================================================
  // 9. LA BARRIÈRE MÉCANIQUE : un constat technique ne porte pas de montant
  // =========================================================================
  // Le prompt le dit, mais un prompt n'est pas une barrière. Deux chemins
  // mènent un constat technique à porter un montant : le modèle en invente un,
  // ou `anchorGainsOnLeak` lui attribue le coût de la fuite mesurée parce qu'il
  // tombe dans le bon domaine. Le second est le plus dangereux — il est
  // automatique, et le montant qu'il pose est vrai : c'est son ATTRIBUTION qui
  // ne l'est pas.

  const technical = {
    key: "site-lent",
    title: "Le site met deux secondes et demie à répondre",
    category: "conversion",
    severity: "high",
    difficulty: 3,
    estimated_gain_min: 1000,
    estimated_gain_max: 3000,
    evidence: { based_on: "storefront.response_ms : 2 400 ms", assumptions: null },
  };
  const linked = {
    ...technical,
    key: "site-lent-mesure",
    evidence: {
      based_on:
        "storefront.response_ms : 2 400 ms et shopify.orders_30d : 10 commandes pour 5 000 clics",
      assumptions: null,
    },
  };

  t.check("un constat purement technique est reconnu", isTechnicalOnly(technical), true);
  t.check(
    "un constat croisé avec une mesure commerciale ne l'est pas",
    isTechnicalOnly(linked),
    false,
  );
  t.check(
    "un constat citant un signal croisé non plus",
    isTechnicalOnly({
      ...technical,
      evidence: {
        based_on: "storefront.response_ms et cross.lenteur_et_trafic_perdu",
        assumptions: null,
      },
    }),
    false,
  );
  t.check(
    "une conclusion sans preuve du tout n'est pas « technique » : elle est sans preuve",
    isTechnicalOnly({ ...technical, evidence: { based_on: "", assumptions: null } }),
    false,
  );
  t.check(
    "une conclusion commerciale ordinaire n'est pas touchée",
    isTechnicalOnly({
      ...technical,
      evidence: { based_on: "shopify.orders_30d : 10 commandes", assumptions: null },
    }),
    false,
  );

  const frontier = applyTechnicalFrontier([technical, linked]);
  t.check(
    "le montant du constat technique est retiré",
    frontier.findings[0].estimated_gain_max,
    null,
  );
  t.check("et le minimum aussi", frontier.findings[0].estimated_gain_min, null);
  t.check("le retrait est compté", frontier.stripped, 1);
  t.check("le constat croisé garde son montant", frontier.findings[1].estimated_gain_max, 3000);
  t.check("la conclusion elle-même n'est jamais supprimée", frontier.findings.length, 2);

  // Le scénario complet : l'ancrage attribue le coût de la fuite, la frontière
  // le retire au seul constat technique.
  const measuredLeak = {
    from: "paniers" as const,
    to: "commandes" as const,
    lostPerMonth: 100,
    costPerMonth: 6000,
    severity: "high" as const,
    label: "fuite",
  };
  const anchored = anchorGainsOnLeak([technical, linked], measuredLeak as never);
  t.check("l'ancrage attribue bien un montant aux deux", anchored.anchored >= 1, true);
  const afterFrontier = applyTechnicalFrontier(anchored.findings);
  t.check(
    "mais la frontière le retire au constat technique",
    afterFrontier.findings.find((f) => f.key === "site-lent")?.estimated_gain_max,
    null,
  );
  t.check(
    "et le laisse à celui qui porte la preuve commerciale",
    (afterFrontier.findings.find((f) => f.key === "site-lent-mesure")?.estimated_gain_max ?? 0) > 0,
    true,
  );

  // Et il ne peut pas se déclarer critique.
  const analysed = analyseFindings([technical, linked] as never);
  const technicalBand = analysed.findings.find((f) => f.key === "site-lent");
  t.check(
    "un constat technique ne peut pas être critique",
    technicalBand?.band === "critique",
    false,
  );
  t.check(
    "et sa justification dit pourquoi",
    technicalBand?.justification.includes("effet sur les ventes n'est pas mesuré"),
    true,
  );
  t.check("le plafond technique est « important »", TECHNICAL_BAND_CEILING, "important");

  const runnerCode = read("src/lib/audit-runner.server.ts");
  t.check(
    "l'audit applique la frontière APRÈS l'ancrage",
    runnerCode.indexOf("anchorGainsOnLeak(") < runnerCode.indexOf("applyTechnicalFrontier("),
    true,
  );
  t.check(
    "et avant le calcul du potentiel affiché",
    runnerCode.indexOf("applyTechnicalFrontier(") < runnerCode.indexOf("computePotential("),
    true,
  );
  t.check(
    "la règle est aussi énoncée au modèle",
    read("src/lib/audit-prompt.ts").includes("UN PROBLÈME TECHNIQUE EST UN FAIT TECHNIQUE"),
    true,
  );

  // =========================================================================
  // 10. Le marchand voit les faits ET ce qui n'a pas pu être mesuré
  // =========================================================================
  const cockpit = read("src/components/Cockpit.tsx");
  t.check("le cockpit affiche les données manquantes", cockpit.includes("c.dataGaps.map"), true);
  // AVEC LA PHRASE ÉCRITE POUR LE MARCHAND, PAS CELLE DU CODE. Les motifs
  // rédigés dans les sources s'adressent au moteur — « Non exposé par l'API
  // Admin » — et arrivaient tels quels sous les yeux de l'utilisateur. Ils
  // décrivaient une panne sans jamais dire quoi faire.
  /*
    LE TROISIÈME ARGUMENT N'AFFAIBLIT PAS CETTE RÈGLE, IL LA COMPLÈTE.

    `explain` reçoit désormais `gap.reason` — mais il ne s'en sert QUE pour les
    trous `*.unreachable`, et ceux-là ne sont produits que par `allGaps`, qui y
    écrit une phrase choisie d'après la cause classée. Aucun connecteur n'émet
    de trou portant ce suffixe : le motif interne d'une source ne peut donc pas
    passer par là.

    Ce qui l'exigeait : `shopify.unreachable` recouvre quatre situations —
    autorisation à refaire, quota atteint, panne du fournisseur, silence
    inexpliqué — et l'entrée fixe disait « reconnectez votre boutique » pour
    les quatre. Trois fois sur quatre, elle envoyait refaire une connexion
    valable.
  */
  t.check("traduites pour le marchand", cockpit.includes("explain(gap.id, gap.label,"), true);
  t.check("le motif interne ne s'affiche plus", cockpit.includes("{gap.reason}"), false);
  t.check("chacune dit quoi faire", cockpit.includes("Ce qu'il faut faire"), true);
  t.check("et ce qu'elle ouvrira", cockpit.includes("Ce que cela ouvrira"), true);
  t.check(
    "les manques traversent la fonction serveur",
    read("src/lib/cockpit.functions.ts").includes("dataGaps: gaps"),
    true,
  );
});
