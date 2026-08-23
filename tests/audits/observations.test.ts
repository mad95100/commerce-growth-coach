import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OBSERVATION_SOURCES,
  allGaps,
  allObservations,
  formatObservation,
  observationValue,
  observationsToPromptBlock,
  type Observation,
  type SourceReport,
} from "../../src/lib/observations";
import {
  DIAGNOSTICS,
  assessDiagnostics,
  diagnosticsToPromptBlock,
} from "../../src/lib/diagnostics";
import {
  hasDescription,
  isOutOfStock,
  shopifyObservations,
  shopifyUnreachable,
  type RawOrder,
  type ShopifyRaw,
} from "../../src/lib/connectors/shopify-observe";
import { defineSuite } from "../harness";

/**
 * Sources → observations → diagnostics possibles.
 *
 * CE QUI EST EN JEU. Le moteur savait raisonner, mais sur trois chiffres. Ce
 * qui l'alimente décide donc de ce qu'il peut établir — et, plus important, de
 * ce qu'il doit refuser d'affirmer.
 *
 * DEUX RÈGLES PORTENT TOUT :
 *
 * 1. **Ce qui n'est pas observé n'existe pas.** Une source qui ne fournit pas
 *    la donnée ne produit AUCUNE observation. Surtout pas une observation à
 *    zéro, qui se lirait comme une mesure et ferait passer une boutique neuve
 *    pour une boutique en échec.
 *
 * 2. **Un diagnostic déclare ses prérequis.** Ce que les données ne permettent
 *    pas d'établir part dans le prompt comme une interdiction nommée, pas comme
 *    un silence que le modèle comblerait.
 *
 * L'architecture est vérifiée ici comme commune : ce que Shopify produit,
 * Meta, Google et l'organique devront le produire à l'identique.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

function order(overrides: Partial<RawOrder> = {}): RawOrder {
  return {
    id: 1,
    total_price: "100.00",
    financial_status: "paid",
    created_at: "2026-08-01T00:00:00Z",
    line_items: [{ product_id: 1, title: "A", quantity: 1, price: "100.00" }],
    ...overrides,
  };
}

function raw(overrides: Partial<ShopifyRaw> = {}): ShopifyRaw {
  return {
    currency: "EUR",
    productCount: 3,
    products: [],
    orders: [],
    abandonedCheckouts: null,
    productsComplete: true,
    ...overrides,
  };
}

export default defineSuite("Sources — observations et diagnosticabilité", (t) => {
  // --- L'architecture est commune, pas un silo ----------------------------
  // Le compte suit l'ajout de sources ; ce qui ne doit pas bouger, c'est que
  // chacune passe par la MÊME couche. Le site public s'y est ajouté comme les
  // autres, sans rouvrir le moteur.
  t.check("chaque source prévue est déclarée", OBSERVATION_SOURCES.length, 8);
  for (const source of [
    "shopify",
    "meta",
    "google",
    "organic",
    "storefront",
    "market",
    "competitors",
  ]) {
    t.check(
      `« ${source} » alimentera le même moteur`,
      (OBSERVATION_SOURCES as readonly string[]).includes(source),
      true,
    );
  }
  const observationsModule = read("src/lib/observations.ts");
  t.check(
    "la couche commune ne dépend d'aucune source en particulier",
    /shopify\.|meta\.|google\./.test(
      observationsModule
        .split("\n")
        .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
        .join("\n"),
    ),
    false,
  );

  // --- Une observation porte sa preuve -------------------------------------
  const report = shopifyObservations(
    raw({ orders: [order(), order({ id: 2 })], abandonedCheckouts: 6 }),
  );
  const orders = report.observations.find((o) => o.id === "shopify.orders_30d")!;
  t.check(
    "chaque observation porte sa preuve",
    orders.evidence.includes("Shopify /orders.json"),
    true,
  );
  t.check("et sa taille d'échantillon", orders.sample, 2);
  t.check("et sa fenêtre", orders.periodDays, 30);
  t.check("et son unité", orders.unit, "count");
  t.check(
    "un montant porte sa devise, jamais supposée",
    report.observations.find((o) => o.id === "shopify.revenue_30d")!.currency,
    "EUR",
  );
  t.check(
    "les montants s'affichent avec leur devise",
    formatObservation(report.observations.find((o) => o.id === "shopify.revenue_30d")!),
    "200 EUR",
  );
  t.check(
    "les taux s'affichent en pourcentage",
    formatObservation({
      id: "x",
      source: "shopify",
      domain: "conversion",
      label: "L",
      value: 12.345,
      unit: "percent",
      periodDays: 30,
      evidence: "e",
      sample: 10,
    }),
    "12.35 %",
  );

  // --- Ce que Shopify permet réellement de calculer ------------------------
  const full = shopifyObservations(
    raw({
      productCount: 4,
      products: [
        {
          id: 1,
          body_html: "<p>Une vraie description bien assez longue</p>",
          images: [{}],
          variants: [{ price: "20", inventory_management: "shopify", inventory_quantity: 5 }],
        },
        {
          id: 2,
          body_html: "<p></p>",
          images: [],
          variants: [{ price: "40", inventory_management: "shopify", inventory_quantity: 0 }],
        },
        {
          id: 3,
          body_html: null,
          images: [{}],
          variants: [{ price: "60", inventory_management: null }],
        },
        {
          id: 4,
          body_html: "<p>Autre description suffisamment longue ici</p>",
          images: [{}],
          variants: [{ price: "80", inventory_management: "shopify", inventory_quantity: 2 }],
        },
      ],
      orders: [
        order({
          id: 1,
          refunds: [{}],
          discount_codes: [{ code: "PROMO" }],
          customer: { id: 9, orders_count: 3 },
        }),
        order({
          id: 2,
          line_items: [
            { product_id: 1, price: "50", quantity: 1 },
            { product_id: 2, price: "50", quantity: 1 },
          ],
          customer: { id: 10, orders_count: 1 },
        }),
        order({ id: 3, financial_status: "pending" }),
      ],
      abandonedCheckouts: 8,
    }),
  );
  const value = (id: string) => observationValue(full.observations, id);

  t.check("les commandes payées sont comptées, pas les autres", value("shopify.orders_30d"), 2);
  t.check("le chiffre d'affaires suit", value("shopify.revenue_30d"), 200);
  t.check("le panier moyen aussi", value("shopify.aov"), 100);
  t.check(
    "les fiches sans description sont repérées",
    value("shopify.products_without_description"),
    2,
  );
  t.check("les fiches sans visuel aussi", value("shopify.products_without_image"), 1);
  t.check("les ruptures aussi", value("shopify.products_out_of_stock"), 1);
  t.check("le prix médian est calculé", value("shopify.price_median"), 50);
  t.check("le prix le plus bas", value("shopify.price_min"), 20);
  t.check("le prix le plus élevé", value("shopify.price_max"), 80);
  t.check("le taux de remboursement", value("shopify.refund_rate_30d"), 50);
  t.check("la part de commandes sous promo", value("shopify.discounted_order_share"), 50);
  t.check("la part de commandes multi-articles", value("shopify.multi_item_order_share"), 50);
  t.check("la part de clients déjà venus", value("shopify.returning_customer_rate"), 50);
  t.check("les paniers abandonnés", value("shopify.abandoned_checkouts_30d"), 8);
  t.check(
    "le taux d'abandon rapporte aux paniers ouverts",
    value("shopify.cart_abandonment_rate"),
    80,
  );
  t.check(
    "la concentration produit est mesurée",
    value("shopify.top_product_revenue_share") !== null,
    true,
  );

  // --- Une description vide n'est pas une description ----------------------
  // C'est ce que renvoie l'éditeur Shopify quand le marchand n'a rien écrit.
  t.check("un paragraphe vide ne compte pas", hasDescription("<p></p>"), false);
  t.check("un saut de ligne non plus", hasDescription("<br>"), false);
  t.check("des espaces insécables non plus", hasDescription("<p>&nbsp;&nbsp;</p>"), false);
  t.check("un texte trop court non plus", hasDescription("<p>Beau</p>"), false);
  t.check(
    "une vraie description compte",
    hasDescription("<p>Un texte descriptif complet ici</p>"),
    true,
  );
  t.check("null ne compte pas", hasDescription(null), false);

  // --- La rupture ne se juge que sur les variantes suivies -----------------
  t.check(
    "toutes les variantes suivies à zéro font une rupture",
    isOutOfStock({ variants: [{ inventory_management: "shopify", inventory_quantity: 0 }] }),
    true,
  );
  t.check(
    "une seule variante disponible suffit",
    isOutOfStock({
      variants: [
        { inventory_management: "shopify", inventory_quantity: 0 },
        { inventory_management: "shopify", inventory_quantity: 3 },
      ],
    }),
    false,
  );
  // Un produit dont le stock n'est pas suivi est toujours vendable : le
  // compter en rupture inventerait un problème inexistant.
  t.check(
    "un stock non suivi n'est jamais une rupture",
    isOutOfStock({ variants: [{ inventory_management: null, inventory_quantity: 0 }] }),
    false,
  );
  t.check("un produit sans variante non plus", isOutOfStock({ variants: [] }), false);

  // ET UNE QUANTITÉ QU'ON N'A PAS LUE N'EST PAS UN ZÉRO. Le calcul écrivait
  // `inventory_quantity ?? 0` : la variante suivie dont Shopify ne renvoie pas
  // la quantité — un champ déclaré facultatif, donc dont l'absence est prévue —
  // devenait une variante à zéro, et le produit partait en rupture avec une
  // preuve qui affirme la mesure. C'est le même raisonnement que deux contrôles
  // plus haut, appliqué à l'autre façon de ne pas savoir.
  t.check(
    "une quantité absente n'est pas une rupture",
    isOutOfStock({ variants: [{ inventory_management: "shopify" }] }),
    false,
  );
  t.check(
    "une quantité nulle non plus",
    isOutOfStock({ variants: [{ inventory_management: "shopify", inventory_quantity: null }] }),
    false,
  );
  // UNE SEULE VARIANTE ILLISIBLE SUFFIT À EMPÊCHER DE CONCLURE : l'affirmation
  // à démontrer est que TOUTES sont à zéro, et elle ne se démontre pas sur un
  // ensemble dont un membre n'a pas été lu.
  t.check(
    "une variante illisible empêche de conclure à la rupture",
    isOutOfStock({
      variants: [
        { inventory_management: "shopify", inventory_quantity: 0 },
        { inventory_management: "shopify", inventory_quantity: null },
      ],
    }),
    false,
  );
  // Le cas mesuré, lui, conclut toujours : la prudence ne doit pas rendre le
  // constat impossible à produire.
  t.check(
    "deux variantes lues et à zéro font toujours une rupture",
    isOutOfStock({
      variants: [
        { inventory_management: "shopify", inventory_quantity: 0 },
        { inventory_management: "shopify", inventory_quantity: 0 },
      ],
    }),
    true,
  );

  // --- CE QUI N'EST PAS OBSERVÉ N'EXISTE PAS ------------------------------
  // La règle qui protège une boutique neuve d'être diagnostiquée comme une
  // boutique en échec.
  const empty = shopifyObservations(raw());
  t.check(
    "sans produit lu, aucune mesure de catalogue",
    value2(empty, "shopify.products_without_description"),
    undefined,
  );
  t.check("sans commande, pas de panier moyen inventé", value2(empty, "shopify.aov"), undefined);
  t.check("ni de taux de remboursement", value2(empty, "shopify.refund_rate_30d"), undefined);
  // En revanche zéro commande EST une mesure, et la plus importante à établir.
  t.check(
    "zéro commande est bien mesuré",
    observationValue(empty.observations, "shopify.orders_30d"),
    0,
  );
  t.check(
    "sans panier abandonné lisible, c'est un manque déclaré",
    empty.gaps.some((g) => g.id === "shopify.abandoned_checkouts_30d"),
    true,
  );

  // Le trafic n'est pas dans l'API Admin. Il est déclaré manquant, jamais
  // approché : inventer une estimation fabriquerait précisément le chiffre sur
  // lequel tout le monde décide.
  t.check(
    "les sessions sont déclarées absentes",
    empty.gaps.some((g) => g.id === "shopify.sessions_30d"),
    true,
  );
  t.check(
    "les vues produit aussi",
    empty.gaps.some((g) => g.id === "shopify.product_views_30d"),
    true,
  );
  t.check(
    "et chaque manque dit ce qu'il débloquerait",
    empty.gaps.every((g) => g.wouldEnable.length > 10),
    true,
  );
  t.check(
    "aucune observation de trafic n'est fabriquée",
    empty.observations.some((o) => o.id.includes("session") || o.id.includes("view")),
    false,
  );

  // --- Source injoignable ---------------------------------------------------
  const down = shopifyUnreachable("boum");
  t.check("une source injoignable ne produit aucune observation", down.observations, []);
  t.check("et le dit", down.reachable, false);
  t.check("les observations d'une source injoignable sont ignorées", allObservations([down]), []);
  t.check("et son silence devient un manque global", allGaps([down]).length, 1);

  // --- Le même manque ne se dit qu'une fois ---------------------------------
  /*
    RELEVÉ SUR UN RAPPORT RÉEL. « Nous ne savons pas encore combien de personnes
    visitent votre boutique » apparaissait DEUX FOIS, mot pour mot, dans la
    liste « Ce que nous n'avons pas pu regarder ». Le compteur annonçait neuf
    manques là où il y en avait huit.

    La cause n'est pas une faute de raisonnement : deux collectes butent
    légitimement sur la même donnée — le connecteur Shopify et la lecture de
    l'entonnoir signalent tous deux l'absence de sessions. Chacune a raison de
    le dire ; rien ne les rassemblait avant de montrer la liste.

    Un rapport qui se répète paraît écrit par une machine qui ne se relit pas,
    et le marchand n'a aucun moyen de savoir si c'est un doublon ou deux
    problèmes différents portant le même nom.
  */
  const manque = (id: string, source: SourceReport["source"]) => ({
    id,
    label: "Sessions",
    source,
    reason: "raison",
    wouldEnable: "quelque chose",
  });
  const rapport = (source: SourceReport["source"], ids: string[]): SourceReport => ({
    source,
    observations: [],
    gaps: ids.map((id) => manque(id, source)),
    reachable: true,
  });

  t.check(
    "deux sources qui signalent le même manque ne le disent qu'une fois",
    allGaps([
      rapport("shopify", ["shopify.sessions_30d"]),
      rapport("shopify", ["shopify.sessions_30d"]),
    ]).length,
    1,
  );
  t.check(
    "deux manques différents restent deux",
    allGaps([rapport("shopify", ["shopify.sessions_30d", "shopify.conversion_rate"])]).length,
    2,
  );
  // LA PREMIÈRE OCCURRENCE EST GARDÉE : les rapports arrivent dans l'ordre de
  // collecte, et le premier à constater le manque est le plus proche de la
  // source.
  t.check(
    "c'est la première occurrence qui survit",
    allGaps([
      {
        ...rapport("shopify", ["x.y"]),
        gaps: [{ ...manque("x.y", "shopify"), reason: "première" }],
      },
      { ...rapport("google", ["x.y"]), gaps: [{ ...manque("x.y", "google"), reason: "seconde" }] },
    ])[0].reason,
    "première",
  );
  // ET LE SILENCE D'UNE SOURCE N'ÉCRASE PAS CELUI D'UNE AUTRE : deux sources
  // muettes sont deux manques, ils portent des identifiants distincts.
  t.check(
    "deux sources muettes restent deux manques",
    allGaps([shopifyUnreachable("boum"), { ...shopifyUnreachable("boum"), source: "google" }])
      .length,
    2,
  );

  // --- Diagnosticabilité ----------------------------------------------------
  const availability = assessDiagnostics(full.observations);
  const availableIds = availability.available.map((a) => a.diagnostic.id);
  const blockedIds = availability.blocked.map((b) => b.diagnostic.id);

  t.check(
    "l'abandon panier est diagnosticable",
    availableIds.includes("conversion.abandon_panier"),
    true,
  );
  t.check(
    "les fiches incomplètes aussi",
    availableIds.includes("catalogue.fiches_incompletes"),
    true,
  );
  t.check("les ruptures aussi", availableIds.includes("catalogue.ruptures"), true);
  t.check("la dispersion des prix aussi", availableIds.includes("offre.dispersion_prix"), true);

  // LE point qui compte : ce qui n'est pas calculable est nommé, pas passé
  // sous silence.
  t.check(
    "le taux de conversion n'est pas diagnosticable",
    blockedIds.includes("conversion.taux"),
    true,
  );
  t.check("le vu-contre-acheté non plus", blockedIds.includes("produit.vus_vs_achetes"), true);
  t.check(
    "le positionnement prix non plus, faute de comparaison marché",
    blockedIds.includes("offre.positionnement_prix"),
    true,
  );
  t.check(
    "et on dit exactement quelle donnée manque",
    availability.blocked.find((b) => b.diagnostic.id === "conversion.taux")!.missing,
    ["shopify.sessions_30d"],
  );

  // Une valeur nulle ne compte pas comme une donnée : une case vide n'est pas
  // une mesure, et la traiter comme telle rouvrirait la porte fermée ici.
  const nulled: Observation[] = [
    {
      id: "shopify.orders_30d",
      source: "shopify",
      domain: "conversion",
      label: "L",
      value: null,
      unit: "count",
      periodDays: 30,
      evidence: "e",
      sample: null,
    },
    {
      id: "shopify.abandoned_checkouts_30d",
      source: "shopify",
      domain: "conversion",
      label: "L",
      value: null,
      unit: "count",
      periodDays: 30,
      evidence: "e",
      sample: null,
    },
  ];
  t.check(
    "une observation vide ne rend rien diagnosticable",
    assessDiagnostics(nulled).available.length,
    0,
  );
  t.check("sans aucune donnée, tout est bloqué", assessDiagnostics([]).available.length, 0);
  t.check(
    "et tout le catalogue est alors annoncé comme hors de portée",
    assessDiagnostics([]).blocked.length,
    DIAGNOSTICS.length,
  );

  // Chaque diagnostic doit déclarer des prérequis et une conclusion, sans quoi
  // il ne sert ni à établir ni à refuser.
  for (const d of DIAGNOSTICS) {
    t.check(`« ${d.id} » déclare ses prérequis`, d.requires.length > 0, true);
    t.check(`« ${d.id} » dit ce qu'il conclut`, d.concludes.length > 20, true);
  }

  // --- Ce qui part dans le prompt ------------------------------------------
  const factsBlock = observationsToPromptBlock([full]);
  t.check("les faits sont annoncés comme mesurés", factsBlock.includes("FAITS MESURÉS"), true);
  t.check("avec leur source", factsBlock.includes("/orders.json"), true);
  t.check(
    "les manques sont annoncés séparément",
    factsBlock.includes("DONNÉES NON DISPONIBLES"),
    true,
  );
  t.check(
    "avec l'interdiction de conclure dessus",
    factsBlock.includes("Tu n'as PAS le droit de conclure"),
    true,
  );
  t.check(
    "une source injoignable interdit d'inventer",
    observationsToPromptBlock([down]).includes("N'invente AUCUN chiffre"),
    true,
  );
  t.check(
    "sans aucune source, tout devient hypothèse",
    observationsToPromptBlock([]).includes('confiance "low"'),
    true,
  );

  const scopeBlock = diagnosticsToPromptBlock(availability, full.gaps);
  t.check(
    "le modèle sait ce qu'il peut établir",
    scopeBlock.includes("CE QUE LES DONNÉES TE PERMETTENT D'ÉTABLIR"),
    true,
  );
  t.check(
    "et ce qu'il lui est interdit d'affirmer",
    scopeBlock.includes("INTERDICTION FORMELLE"),
    true,
  );
  t.check(
    "avec la consigne qui produit « donnée manquante »",
    scopeBlock.includes('laisse "evidence.based_on" VIDE'),
    true,
  );

  // --- Le branchement -------------------------------------------------------
  const runner = read("src/lib/audit-runner.server.ts");
  t.check("l'audit collecte les observations", runner.includes("fetchShopifyObservations"), true);
  t.check("les injecte comme des faits", runner.includes("observationsToPromptBlock"), true);
  t.check("et cadre ce qui est diagnosticable", runner.includes("diagnosticsToPromptBlock"), true);
  /*
    UNE COLLECTE EN ÉCHEC NE FAIT PAS ÉCHOUER L'AUDIT — ET LAISSE UNE TRACE.

    Ce contrôle cherchait la trace d'un `catch` unique autour des trois sources.
    Cette forme portait deux défauts. Un seul `catch` : Shopify qui expire, et
    Meta comme Google n'étaient même pas TENTÉS, la première exception sortant du
    bloc. Et l'échec n'allait qu'au journal : le marchand recevait un diagnostic
    bâti sur ses seuls chiffres saisis, sans jamais apprendre que sa boutique
    n'avait pas pu être lue — ou, si l'audit échouait ensuite chez le fournisseur
    d'analyse, s'entendait dire « fournisseur saturé » pendant que la vraie
    première cause restait invisible.

    Chaque source est désormais tentée séparément, et son échec produit un
    rapport `reachable: false` que `allGaps` transforme en manque nommé.
  */
  for (const source of ["Shopify", "Meta", "Google"]) {
    t.check(
      `une collecte ${source} en échec est rattrapée séparément`,
      new RegExp(`collecte ${source} impossible`).test(runner),
      true,
    );
  }
  t.check(
    "…et l'échec devient un rapport injoignable, pas un silence",
    (runner.match(/reachable: false/g) ?? []).length >= 4,
    true,
  );
  t.check(
    "le manque est alors nommé par la mécanique existante",
    /gaps: allGaps\(reports\)/.test(runner) && /data_gaps: allGaps\(reports\)/.test(runner),
    true,
  );

  const connector = read("src/lib/connectors/shopify-observe.server.ts");
  t.check("chaque ressource est lue indépendamment", connector.includes("Promise.all"), true);
  t.check(
    "un jeton illisible ne fait pas échouer l'audit",
    connector.includes("Jeton Shopify illisible"),
    true,
  );
  // Une permission de plus imposerait une réautorisation à chaque marchand
  // déjà connecté : le connecteur doit tenir dans ce qui est déjà accordé.
  const scopes = read("src/lib/connectors/shopify-scopes.ts");
  for (const endpoint of ["products", "orders", "checkouts", "shop"]) {
    t.check(
      `« ${endpoint} » est couvert par les permissions déjà accordées`,
      endpoint === "checkouts" || endpoint === "shop" ? true : scopes.includes(`read_${endpoint}`),
      true,
    );
  }
});

/** Valeur d'une observation, ou `undefined` si elle n'existe pas du tout. */
function value2(report: SourceReport, id: string): number | null | undefined {
  const found = report.observations.find((o) => o.id === id);
  return found ? found.value : undefined;
}
