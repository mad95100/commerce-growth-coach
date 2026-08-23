import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MIN_ATTRIBUTION_COVERAGE_PCT,
  MIN_ORDERS_FOR_SHARES,
  ORIGINS,
  attributionObservations,
  breakdownOrders,
  classifyOrigin,
  isOfflineOrder,
  type AttributedOrder,
} from "../../src/lib/connectors/order-attribution";
import { crossSignals, HIGH_PAID_DEPENDENCE_PCT } from "../../src/lib/cross-source";
import { observationValue, type Observation } from "../../src/lib/observations";
import { assessDiagnostics } from "../../src/lib/diagnostics";
import { SHOPIFY_REQUESTED_SCOPES } from "../../src/lib/connectors/shopify-scopes";
import { defineSuite } from "../../tests/harness";

/**
 * D'OÙ VIENNENT LES COMMANDES, et ce qu'on n'a pas le droit d'en conclure.
 *
 * CE QUE CETTE SOURCE APPORTE. Meta et Google attribuent chacun de leur côté :
 * additionner leurs achats donne régulièrement plus de commandes que la
 * boutique n'en a enregistré, et rien ne permettait de dire laquelle exagère.
 * Les commandes, elles, appartiennent au marchand. Elles portent le référent et
 * la page d'arrivée de la session — la seule mesure d'acquisition qui puisse
 * contredire une régie.
 *
 * CE QUI REND CETTE DONNÉE DANGEREUSE. Le référent est vide bien plus souvent
 * qu'on ne le croit : navigateurs intégrés aux applications, politiques de
 * référent restrictives, liens copiés. Une part « directe » élevée est presque
 * toujours une absence de trace, pas du trafic direct. Publier une répartition
 * calculée sur la minorité tracée, en la présentant comme celle de l'ensemble,
 * orienterait un budget entier dans la mauvaise direction.
 *
 * D'où la règle vérifiée ici de bout en bout : la couverture d'abord, et rien
 * en dessous du seuil.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

const order = (over: Partial<AttributedOrder> = {}): AttributedOrder => ({
  referring_site: "",
  landing_site: "/collections/all",
  source_name: "web",
  total_price: "50.00",
  ...over,
});

/** N commandes identiques, pour dépasser le plancher d'échantillon. */
const many = (n: number, over: Partial<AttributedOrder> = {}) =>
  Array.from({ length: n }, () => order(over));

export default defineSuite("Organique — origine réelle des commandes", (t) => {
  // =========================================================================
  // 1. Reconnaître l'origine, sans se tromper de canal
  // =========================================================================

  t.check(
    "un identifiant de clic Google marque la commande comme payante",
    classifyOrigin(order({ landing_site: "/produit?gclid=abc123" })),
    "payant",
  );
  t.check(
    "un identifiant de clic Meta aussi",
    classifyOrigin(order({ landing_site: "/produit?fbclid=xyz" })),
    "payant",
  );
  t.check(
    "un utm_medium=cpc aussi",
    classifyOrigin(order({ landing_site: "/p?utm_source=bing&utm_medium=cpc" })),
    "payant",
  );
  for (const marker of ["gbraid", "wbraid", "ttclid", "msclkid"]) {
    t.check(
      `l'identifiant « ${marker} » est reconnu`,
      classifyOrigin(order({ landing_site: `/p?${marker}=1` })),
      "payant",
    );
  }

  // LE PIÈGE. Un clic publicitaire depuis Google arrive avec google.com en
  // référent. Le compter en recherche naturelle ferait couper le budget qui
  // marche, en croyant que le naturel porte les ventes.
  t.check(
    "un clic payant depuis Google n'est pas compté en recherche naturelle",
    classifyOrigin(
      order({ referring_site: "https://www.google.com/", landing_site: "/p?gclid=abc" }),
    ),
    "payant",
  );
  t.check(
    "et un clic payant depuis Facebook n'est pas compté en social",
    classifyOrigin(
      order({ referring_site: "https://l.facebook.com/", landing_site: "/p?fbclid=abc" }),
    ),
    "payant",
  );

  t.check(
    "une visite depuis Google sans marqueur est de la recherche naturelle",
    classifyOrigin(order({ referring_site: "https://www.google.fr/search?q=bougie" })),
    "recherche",
  );
  for (const engine of ["bing.com", "duckduckgo.com", "ecosia.org", "qwant.com", "yandex.ru"]) {
    t.check(
      `« ${engine} » est reconnu comme moteur de recherche`,
      classifyOrigin(order({ referring_site: `https://${engine}/` })),
      "recherche",
    );
  }
  for (const social of ["instagram.com", "tiktok.com", "pinterest.fr", "t.co", "x.com"]) {
    t.check(
      `« ${social} » est reconnu comme réseau social`,
      classifyOrigin(order({ referring_site: `https://${social}/` })),
      "social",
    );
  }
  t.check(
    "un autre site est un référent",
    classifyOrigin(order({ referring_site: "https://leblogdeco.fr/article" })),
    "referent",
  );
  t.check("sans référent ni paramètre, c'est du direct", classifyOrigin(order()), "direct");
  t.check(
    "sans référent mais avec une campagne non payante, l'origine reste inconnue",
    classifyOrigin(order({ landing_site: "/p?utm_source=newsletter" })),
    "inconnu",
  );
  t.check(
    "un référent illisible ne devient pas une origine inventée",
    classifyOrigin(order({ referring_site: "   " })),
    "direct",
  );

  // Les ventes en boutique physique ne sont pas du commerce en ligne : les
  // laisser dans le calcul gonflerait le « direct » d'une boutique qui a
  // pignon sur rue, et ferait croire à une acquisition naturelle inexistante.
  t.check(
    "une vente en caisse est hors ligne",
    isOfflineOrder(order({ source_name: "pos" })),
    true,
  );
  t.check(
    "un brouillon de commande aussi",
    isOfflineOrder(order({ source_name: "shopify_draft_order" })),
    true,
  );
  t.check("une commande web ne l'est pas", isOfflineOrder(order({ source_name: "web" })), false);
  t.check("un canal inconnu n'est pas écarté", isOfflineOrder(order({ source_name: "" })), false);

  // =========================================================================
  // 2. La répartition, et sa couverture
  // =========================================================================
  const mixed = [
    ...many(30, { landing_site: "/p?gclid=a" }),
    ...many(20, { referring_site: "https://google.com/" }),
    ...many(10, { referring_site: "https://instagram.com/" }),
    ...many(40),
    ...many(5, { source_name: "pos" }),
  ];
  const b = breakdownOrders(mixed);
  t.check("les ventes en caisse sont écartées du dénominateur", b.offline, 5);
  t.check("et le reste compté en ligne", b.online, 100);
  t.check("les commandes payantes sont comptées", b.counts.payant, 30);
  t.check("la recherche naturelle aussi", b.counts.recherche, 20);
  t.check("le social aussi", b.counts.social, 10);
  t.check("le direct aussi", b.counts.direct, 40);
  t.check("la couverture ne compte que ce qui porte une trace", b.coveragePct, 60);
  t.check("le chiffre d'affaires suit la même répartition", b.revenue.payant, 1500);
  t.check(
    "toutes les origines sont initialisées, même à zéro",
    ORIGINS.every((o) => typeof b.counts[o] === "number"),
    true,
  );
  t.check(
    "aucune commande ne donne aucune couverture inventée",
    breakdownOrders([]).coveragePct,
    0,
  );

  // =========================================================================
  // 3. LA RÈGLE : rien n'est publié sans couverture suffisante
  // =========================================================================
  const traceless = attributionObservations({
    orders: [...many(70), ...many(30, { referring_site: "https://google.com/" })],
    currency: "EUR",
  });
  t.check(
    "sous le seuil, la couverture est quand même mesurée et annoncée",
    observationValue(traceless.observations, "organic.attribution_coverage"),
    30,
  );
  t.check(
    "mais AUCUNE répartition n'est publiée",
    traceless.observations.some((o) => o.id.endsWith("_order_share")),
    false,
  );
  t.check(
    "le manque est nommé à la place",
    traceless.gaps.some((g) => g.id === "organic.order_origin"),
    true,
  );
  const gap = traceless.gaps.find((g) => g.id === "organic.order_origin");
  t.check(
    "et la raison explique pourquoi la trace disparaît",
    gap?.reason.includes("navigateurs intégrés"),
    true,
  );
  t.check(
    "le seuil franchi débloque la répartition",
    attributionObservations({
      orders: [...many(50, { referring_site: "https://google.com/" }), ...many(50)],
      currency: "EUR",
    }).observations.some((o) => o.id === "organic.recherche_order_share"),
    true,
  );

  // Un échantillon trop mince ne produit aucun pourcentage non plus.
  const tiny = attributionObservations({
    orders: many(MIN_ORDERS_FOR_SHARES - 1, { referring_site: "https://google.com/" }),
    currency: "EUR",
  });
  t.check("trop peu de commandes : aucune observation", tiny.observations.length, 0);
  t.check("et le manque est nommé", tiny.gaps[0]?.id, "organic.order_origin");
  t.check(
    "la raison chiffre le plancher",
    tiny.gaps[0]?.reason.includes(String(MIN_ORDERS_FOR_SHARES)),
    true,
  );
  t.check(
    "le seuil de couverture est un pourcentage plausible",
    MIN_ATTRIBUTION_COVERAGE_PCT > 0 && MIN_ATTRIBUTION_COVERAGE_PCT < 100,
    true,
  );

  // =========================================================================
  // 4. Ce qui est publié porte sa preuve et son échantillon
  // =========================================================================
  const healthy = attributionObservations({
    orders: [
      ...many(20, { landing_site: "/p?gclid=a" }),
      ...many(50, { referring_site: "https://google.com/" }),
      ...many(30),
    ],
    currency: "EUR",
  });
  for (const o of healthy.observations) {
    t.check(`« ${o.id} » porte sa preuve`, o.evidence.length > 20, true);
    t.check(`« ${o.id} » est rattachée au canal organique`, o.source, "organic");
    t.check(`« ${o.id} » porte sa fenêtre`, o.periodDays > 0, true);
  }
  t.check(
    "la part sans marqueur publicitaire est calculée",
    observationValue(healthy.observations, "organic.non_paid_order_share"),
    80,
  );
  const revenue = healthy.observations.find((o) => o.id === "organic.non_paid_revenue_30d");
  t.check("le chiffre d'affaires non payant porte sa devise", revenue?.currency, "EUR");
  t.check(
    "l'impossibilité de connaître les requêtes est déclarée",
    healthy.gaps.some((g) => g.id === "organic.search_terms"),
    true,
  );
  t.check(
    "et elle dit ce qu'il faudrait pour la lever",
    healthy.gaps.find((g) => g.id === "organic.search_terms")?.reason.includes("Search Console"),
    true,
  );

  // =========================================================================
  // 5. LE CROISEMENT : ce qu'aucune source ne dit seule
  // =========================================================================
  const dependent = attributionObservations({
    orders: [...many(85, { landing_site: "/p?gclid=a" }), ...many(15)],
    currency: "EUR",
  }).observations;
  const depSignals = crossSignals(dependent);
  t.check(
    "une boutique portée par le budget est signalée",
    depSignals.some((s) => s.id === "cross.dependance_payant"),
    true,
  );
  const dep = depSignals.find((s) => s.id === "cross.dependance_payant");
  t.check(
    "et le signal interdit d'y voir une contre-performance",
    dep?.doNotConclude.includes("n'est pas une contre-performance"),
    true,
  );
  t.check("le seuil de dépendance est franchi par 85 %", 85 >= HIGH_PAID_DEPENDENCE_PCT, true);

  const organic = attributionObservations({
    orders: [
      ...many(15, { landing_site: "/p?gclid=a" }),
      ...many(85, { referring_site: "https://google.com/" }),
    ],
    currency: "EUR",
  }).observations;
  const orgSignals = crossSignals(organic);
  t.check(
    "un socle organique est reconnu",
    orgSignals.some((s) => s.id === "cross.socle_organique"),
    true,
  );
  const socle = orgSignals.find((s) => s.id === "cross.socle_organique");
  t.check(
    "sans conclure que la publicité ne sert à rien",
    socle?.doNotConclude.includes("vue et non cliquée"),
    true,
  );

  // Le croisement qui contredit une régie : Meta annonce 80 achats, la boutique
  // n'a que 20 commandes marquées payant.
  const contradicted = crossSignals([
    ...organic,
    {
      id: "meta.purchases_30d",
      source: "meta",
      domain: "acquisition",
      label: "Achats attribués",
      value: 80,
      unit: "count",
      periodDays: 30,
      evidence: "80 achats attribués (Meta Insights)",
      sample: 80,
    } as Observation,
  ]);
  t.check(
    "une attribution contredite par les commandes est signalée",
    contradicted.some((s) => s.id === "cross.attribution_contredite"),
    true,
  );
  const contra = contradicted.find((s) => s.id === "cross.attribution_contredite");
  t.check(
    "sans accuser la régie de mentir",
    contra?.doNotConclude.includes("pas une fraude"),
    true,
  );

  // Couverture insuffisante : le croisement le DIT au lieu de se taire.
  const blind = crossSignals(traceless.observations);
  const blindSignal = blind.find((s) => s.id === "cross.origine_intraçable");
  t.check("une origine intraçable est annoncée", Boolean(blindSignal), true);
  t.check(
    "et il est explicitement interdit d'y lire du trafic direct",
    blindSignal?.doNotConclude.includes("jamais une origine"),
    true,
  );

  // =========================================================================
  // 6. Les diagnostics que cette source débloque, et ceux qu'elle bloque
  // =========================================================================
  const withOrigin = assessDiagnostics(healthy.observations);
  t.check(
    "la dépendance au budget devient instruisible",
    withOrigin.available.some((a) => a.diagnostic.id === "acquisition.dependance_budget"),
    true,
  );
  t.check(
    "le socle organique aussi",
    withOrigin.available.some((a) => a.diagnostic.id === "acquisition.socle_organique"),
    true,
  );
  const withoutOrigin = assessDiagnostics(traceless.observations);
  t.check(
    "sans attribution, ces diagnostics sont explicitement bloqués",
    withoutOrigin.blocked.some((b) => b.diagnostic.id === "acquisition.dependance_budget"),
    true,
  );
  t.check(
    "et la donnée manquante est nommée",
    withoutOrigin.blocked
      .find((b) => b.diagnostic.id === "acquisition.dependance_budget")
      ?.missing.includes("organic.payant_order_share"),
    true,
  );

  // =========================================================================
  // 7. Le chemin réel : lu depuis Shopify, sans permission nouvelle
  // =========================================================================
  const connector = read("src/lib/connectors/shopify-observe.server.ts");
  t.check(
    "les champs d'origine sont réellement demandés à Shopify",
    ["referring_site", "landing_site", "source_name"].every((f) => connector.includes(f)),
    true,
  );
  t.check(
    "un seul appel produit les deux sources",
    connector.includes("organic: organicReport(raw)"),
    true,
  );
  t.check(
    "une boutique injoignable ne produit aucun zéro organique",
    connector.includes(
      'organic: { source: "organic", observations: [], gaps: [], reachable: false',
    ),
    true,
  );
  // LA CONTRAINTE QUI DÉCIDE DE TOUT ICI. Élargir le périmètre Shopify
  // imposerait une réinstallation de l'app à chaque marchand déjà connecté.
  // L'origine des commandes tenait donc d'être lisible sous `read_orders`, déjà
  // accordé — sinon cette source n'aurait pas dû être construite.
  t.check(
    "l'origine des commandes relève de `read_orders`, déjà accordé",
    SHOPIFY_REQUESTED_SCOPES.includes("read_orders"),
    true,
  );
  t.check(
    "et le périmètre demandé n'a pas bougé",
    [...SHOPIFY_REQUESTED_SCOPES].sort(),
    [
      "read_customers",
      "read_analytics",
      "read_discounts",
      "read_orders",
      "read_price_rules",
      "read_products",
      "write_discounts",
      "write_price_rules",
      "write_products",
    ].sort(),
  );
  const runner = read("src/lib/audit-runner.server.ts");
  // LA RÈGLE : un seul appel Shopify produit DEUX rapports — l'état de la
  // boutique et l'origine des commandes — et les deux atteignent le moteur.
  // La collecte étant désormais menée de front, ils sont rendus par la tâche
  // puis poussés dans l'ordre d'avant : `allGaps` déduplique en gardant la
  // PREMIÈRE occurrence, et cet ordre décide donc quelle cause survit.
  t.check(
    "l'audit verse bien les deux rapports au moteur",
    /rapports: \[r\.shopify, r\.organic\]/.test(runner),
    true,
  );
  t.check(
    "…et l'ordre d'ajout est préservé",
    /reports\.push\(\s*\.\.\.surShopify\.rapports,\s*\.\.\.surMeta\.rapports,\s*\.\.\.surGoogle\.rapports,?\s*\)/.test(
      runner,
    ),
    true,
  );
  t.check(
    "le module croisé reste pur : il n'importe aucun connecteur",
    /from "@\/lib\/connectors\//.test(read("src/lib/cross-source.ts")),
    false,
  );

  // =========================================================================
  // 8. Le marchand voit ce que le moteur a croisé
  // =========================================================================
  // Le défaut déjà rencontré ailleurs : le moteur calcule, et l'écran n'en
  // montre rien. Les signaux croisés sont les seules conclusions qu'aucune
  // source ne produit seule — un tableau de bord de régie ne dira jamais que la
  // régie se compte trop d'achats.
  const cockpit = read("src/components/Cockpit.tsx");
  t.check("le cockpit affiche les signaux croisés", cockpit.includes("c.crossSignals.map"), true);
  t.check(
    "avec ce qu'ils ne permettent PAS de conclure",
    cockpit.includes("signal.doNotConclude"),
    true,
  );
  t.check("et leur degré de certitude", cockpit.includes("CERTAINTY_LABELS"), true);
  t.check("ainsi que les pistes à instruire", cockpit.includes("signal.investigate.map"), true);
  t.check(
    "les signaux traversent bien la fonction serveur",
    read("src/lib/cockpit.functions.ts").includes("crossSignals: crossed"),
    true,
  );
});
