import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MIN_PURCHASES_FOR_ROAS,
  SPEND_WITHOUT_RESULT_FLOOR,
  metaObservations,
  metaUnreachable,
  purchaseValueOf,
  purchasesOf,
  type MetaRaw,
  type RawMetaInsight,
} from "../../src/lib/connectors/meta-observe";
import {
  HEALTHY_POST_CLICK_PCT,
  LOW_CTR_PCT,
  MIN_CLICKS_FOR_POST_CLICK,
  crossSignals,
  crossSignalsToPromptBlock,
} from "../../src/lib/cross-source";
import { assessDiagnostics } from "../../src/lib/diagnostics";
import { observationValue, type Observation } from "../../src/lib/observations";
import { defineSuite } from "../harness";

/**
 * Meta Ads, et le raisonnement croisé.
 *
 * CE QUI EST EN JEU. La question qui coûte le plus cher à un marchand n'est pas
 * « mes publicités sont-elles bonnes ? » mais « ma publicité est-elle mauvaise,
 * ou ma boutique perd-elle les gens qu'elle amène ? ». Se tromper de réponse
 * fait couper une campagne rentable, ou nourrir une campagne qui remplit une
 * boutique incapable de vendre. Les deux erreurs coûtent des mois.
 *
 * NI META NI SHOPIFY NE PEUT Y RÉPONDRE SEUL. Meta connaît ses clics, Shopify
 * ses commandes ; le rapport des deux — le taux de transformation après clic —
 * n'existe que dans le croisement. C'est la raison d'être de ce bloc, et ces
 * contrôles portent d'abord sur lui.
 *
 * TROIS PRUDENCES VÉRIFIÉES ICI :
 * - un signal croisé ORIENTE, il ne condamne pas : chacun porte ce qu'il
 *   n'autorise PAS à conclure ;
 * - deux devises différentes interdisent tout rapprochement chiffré ;
 * - le volume commande la certitude, et la fait redescendre en hypothèse.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

function insight(overrides: Partial<RawMetaInsight> = {}): RawMetaInsight {
  return {
    campaign_id: "1",
    campaign_name: "Campagne",
    spend: "1000",
    impressions: "100000",
    reach: "60000",
    clicks: "2000",
    actions: [{ action_type: "purchase", value: "50" }],
    action_values: [{ action_type: "purchase", value: "4000" }],
    ...overrides,
  };
}

function raw(overrides: Partial<MetaRaw> = {}): MetaRaw {
  return {
    currency: "EUR",
    campaigns: [insight()],
    adsets: [],
    activeAds: 4,
    previous: null,
    ...overrides,
  };
}

/** Observation Shopify minimale, pour les croisements. */
function shop(id: string, value: number, currency?: string): Observation {
  return {
    id,
    source: "shopify",
    domain: "conversion",
    label: id,
    value,
    unit: currency ? "currency" : "count",
    currency: currency ?? null,
    periodDays: 30,
    evidence: `${value} (Shopify)`,
    sample: value,
  };
}

export default defineSuite("Meta Ads — observations et croisement", (t) => {
  // =========================================================================
  // 1. CE QUE META ÉTABLIT SEUL
  // =========================================================================
  const report = metaObservations(raw());
  const v = (id: string) => observationValue(report.observations, id);

  t.check("la dépense est mesurée", v("meta.spend_30d"), 1000);
  t.check("les impressions aussi", v("meta.impressions_30d"), 100000);
  t.check("la portée aussi", v("meta.reach_30d"), 60000);
  t.check("les clics aussi", v("meta.clicks_30d"), 2000);
  t.check("les achats attribués aussi", v("meta.purchases_30d"), 50);
  t.check("la valeur des achats aussi", v("meta.purchase_value_30d"), 4000);
  t.check("les publicités actives aussi", v("meta.active_ads"), 4);

  // CTR, CPC, CPM et ROAS sont RECALCULÉS sur les totaux : moyenner des taux
  // de campagnes de tailles différentes donne trop de poids aux petites.
  t.check("le CTR est recalculé sur les totaux", v("meta.ctr_30d"), 2);
  t.check("le CPC aussi", v("meta.cpc_30d"), 0.5);
  t.check("le CPM aussi", v("meta.cpm_30d"), 10);
  t.check("le ROAS aussi", v("meta.roas_30d"), 4);

  t.check(
    "chaque observation porte sa preuve",
    report.observations.every((o) => o.evidence.length > 10),
    true,
  );
  t.check("et sa fenêtre", report.observations.filter((o) => o.periodDays === 30).length > 5, true);
  t.check(
    "les montants portent la devise du COMPTE publicitaire",
    report.observations.find((o) => o.id === "meta.spend_30d")!.currency,
    "EUR",
  );
  // Le ROAS porte comme échantillon le nombre d'ACHATS, pas de campagnes :
  // c'est ce qui permet au moteur de refuser de conclure sur trois achats.
  t.check(
    "le ROAS porte le nombre d'achats comme échantillon",
    report.observations.find((o) => o.id === "meta.roas_30d")!.sample,
    50,
  );

  t.check("les achats sont extraits des actions", purchasesOf(insight()), 50);
  t.check("leur valeur aussi", purchaseValueOf(insight()), 4000);
  t.check("une action absente ne vaut pas zéro", purchasesOf(insight({ actions: [] })), null);

  // --- Campagne déficitaire : dépense sans un seul achat -------------------
  const wasteful = metaObservations(
    raw({
      campaigns: [
        insight({ campaign_id: "1", campaign_name: "Bonne" }),
        insight({
          campaign_id: "2",
          campaign_name: "Gouffre",
          spend: "800",
          actions: [],
          action_values: [],
        }),
      ],
    }),
  );
  t.check(
    "une campagne qui dépense sans achat est comptée",
    observationValue(wasteful.observations, "meta.campaigns_without_result"),
    1,
  );
  t.check(
    "la dépense perdue est chiffrée",
    observationValue(wasteful.observations, "meta.wasted_spend_30d"),
    800,
  );
  t.check(
    "et la campagne est nommée dans la preuve",
    wasteful.observations
      .find((o) => o.id === "meta.campaigns_without_result")!
      .evidence.includes("Gouffre"),
    true,
  );
  t.check(
    "sans gaspillage, aucune dépense perdue n'est inventée",
    report.observations.some((o) => o.id === "meta.wasted_spend_30d"),
    false,
  );
  t.check(
    "une dépense infime ne compte pas comme gaspillage",
    observationValue(
      metaObservations(
        raw({
          campaigns: [insight({ spend: String(SPEND_WITHOUT_RESULT_FLOOR / 2), actions: [] })],
        }),
      ).observations,
      "meta.campaigns_without_result",
    ),
    0,
  );

  // --- Évolution par période ------------------------------------------------
  const evolving = metaObservations(
    raw({
      previous: [insight({ spend: "500", actions: [{ action_type: "purchase", value: "25" }] })],
    }),
  );
  t.check(
    "l'évolution de la dépense est mesurée",
    observationValue(evolving.observations, "meta.spend_change_pct"),
    100,
  );
  t.check(
    "celle des achats aussi",
    observationValue(evolving.observations, "meta.purchases_change_pct"),
    100,
  );
  t.check(
    "sans historique, c'est un manque déclaré, pas un zéro",
    report.gaps.some((g) => g.id === "meta.previous_period"),
    true,
  );

  // --- Données Meta insuffisantes -------------------------------------------
  const nothing = metaObservations(raw({ campaigns: [], adsets: [] }));
  t.check("sans campagne, aucune observation n'est fabriquée", nothing.observations, []);
  t.check(
    "et le manque est déclaré",
    nothing.gaps.some((g) => g.id === "meta.insights"),
    true,
  );
  t.check("un compte injoignable ne produit rien", metaUnreachable("x").observations, []);
  t.check("et se déclare comme tel", metaUnreachable("x").reachable, false);
  // Meta ne voit pas ce qui se passe après le clic : le dire est ce qui rend
  // le croisement nécessaire plutôt qu'optionnel.
  t.check(
    "l'angle mort de Meta est déclaré",
    report.gaps.some((g) => g.id === "meta.post_click_behaviour"),
    true,
  );
  t.check(
    "aucune observation de chiffre d'affaires réel n'est inventée",
    report.observations.some((o) => o.id.includes("revenue")),
    false,
  );

  // =========================================================================
  // 2. LE CROISEMENT
  // =========================================================================
  const metaObs = report.observations;

  // --- Meta bon, Shopify mauvais : NE PAS accuser Meta --------------------
  // 2000 clics, 4 commandes = 0,2 %. La publicité fait entrer des gens ; ce
  // sont eux qui repartent.
  const leak = crossSignals([...metaObs, shop("shopify.orders_30d", 4)]);
  const leakSignal = leak.find((s) => s.id === "cross.trafic_qui_nachete_pas")!;
  t.check("la fuite après clic est détectée", Boolean(leakSignal), true);
  t.check(
    "et située explicitement après le clic",
    leakSignal.statement.includes("APRÈS le clic"),
    true,
  );
  t.check(
    "on interdit d'accuser les campagnes",
    leakSignal.doNotConclude.includes("Ne conclus pas que les campagnes sont mauvaises"),
    true,
  );
  t.check("et on oriente vers plusieurs causes", leakSignal.investigate.length >= 3, true);
  t.check("les preuves des deux sources sont citées", leakSignal.evidence.length, 2);

  // Les pistes s'enrichissent des observations Shopify réellement présentes.
  const leakRich = crossSignals([
    ...metaObs,
    shop("shopify.orders_30d", 4),
    { ...shop("shopify.cart_abandonment_rate", 82), unit: "percent" },
    shop("shopify.products_out_of_stock", 3),
    shop("shopify.products_without_description", 7),
  ]);
  const rich = leakRich.find((s) => s.id === "cross.trafic_qui_nachete_pas")!;
  t.check(
    "un abandon panier élevé passe en tête des pistes",
    rich.investigate[0].includes("tunnel de commande"),
    true,
  );
  t.check(
    "les ruptures sont citées",
    rich.investigate.some((l) => l.includes("rupture")),
    true,
  );
  t.check(
    "les fiches sans description aussi",
    rich.investigate.some((l) => l.includes("sans description")),
    true,
  );

  // --- Meta mauvais, Shopify bon : problème d'acquisition -----------------
  const healthy = crossSignals([...metaObs, shop("shopify.orders_30d", 60)]);
  const good = healthy.find((s) => s.id === "cross.boutique_transforme")!;
  t.check("une boutique qui transforme est reconnue", Boolean(good), true);
  t.check(
    "et on oriente alors vers l'acquisition",
    good.investigate.some((l) => l.includes("coût d'acquisition")),
    true,
  );
  t.check(
    "sans conclure que tout va bien",
    good.doNotConclude.includes("ne dit rien du trafic non payant"),
    true,
  );
  t.check(
    "le seuil de bonne santé est celui déclaré",
    (60 / 2000) * 100 >= HEALTHY_POST_CLICK_PCT,
    true,
  );

  // --- Volume insuffisant : ne rien conclure ------------------------------
  const tiny = metaObservations(
    raw({ campaigns: [insight({ clicks: "80", impressions: "5000", spend: "60" })] }),
  );
  const tinyCross = crossSignals([...tiny.observations, shop("shopify.orders_30d", 1)]);
  const insufficient = tinyCross.find((s) => s.id === "cross.volume_insuffisant")!;
  t.check("un volume trop faible est signalé", Boolean(insufficient), true);
  t.check(
    "et interdit toute conclusion",
    insufficient.doNotConclude.includes("Ne conclus RIEN"),
    true,
  );
  t.check(
    "aucun taux après clic n'est calculé en dessous du seuil",
    tinyCross.some((s) => s.id === "cross.trafic_qui_nachete_pas"),
    false,
  );
  t.check("le seuil de clics est explicite", MIN_CLICKS_FOR_POST_CLICK > 0, true);

  // --- CTR faible : hypothèse, jamais un fait -----------------------------
  const lowCtr = metaObservations(
    raw({ campaigns: [insight({ clicks: "500", impressions: "100000" })] }),
  );
  const ctrSignal = crossSignals(lowCtr.observations).find((s) => s.id === "cross.ctr_faible")!;
  t.check("un CTR bas est repéré", Boolean(ctrSignal), true);
  t.check("il est classé comme hypothèse", ctrSignal.certainty, "hypothese");
  t.check(
    "le fait et sa cause sont explicitement séparés",
    ctrSignal.doNotConclude.includes("Sa CAUSE"),
    true,
  );
  t.check(
    "un CTR correct ne déclenche rien",
    crossSignals(metaObs).some((s) => s.id === "cross.ctr_faible"),
    false,
  );
  t.check("le seuil est déclaré", LOW_CTR_PCT < 1, true);

  // --- ROAS élevé sur volume dérisoire ------------------------------------
  const thinRoas = metaObservations(
    raw({
      campaigns: [
        insight({
          spend: "300",
          actions: [{ action_type: "purchase", value: "3" }],
          action_values: [{ action_type: "purchase", value: "1800" }],
        }),
      ],
    }),
  );
  const thin = crossSignals(thinRoas.observations).find((s) => s.id === "cross.roas_sans_volume")!;
  t.check("un ROAS sans volume est signalé", Boolean(thin), true);
  t.check(
    "et on refuse de déclarer la campagne excellente",
    thin.doNotConclude.includes("Ne déclare pas cette campagne excellente"),
    true,
  );
  t.check("c'est une hypothèse", thin.certainty, "hypothese");
  t.check(
    "au-dessus du seuil d'achats, plus d'alerte",
    crossSignals(metaObs).some((s) => s.id === "cross.roas_sans_volume"),
    false,
  );
  t.check("le seuil d'achats est déclaré", MIN_PURCHASES_FOR_ROAS >= 10, true);

  // --- Écart d'attribution --------------------------------------------------
  const gap = crossSignals([...metaObs, shop("shopify.orders_30d", 20)]);
  const attribution = gap.find((s) => s.id === "cross.attribution_optimiste")!;
  t.check("un écart d'attribution est constaté", Boolean(attribution), true);
  t.check("c'est un fait, pas une hypothèse", attribution.certainty, "fait");
  t.check(
    "sans accuser d'erreur ni de fraude",
    attribution.doNotConclude.includes("ni à une erreur de suivi"),
    true,
  );

  // --- Rentabilité réelle, et le piège des devises ------------------------
  const sameCurrency = crossSignals([
    ...metaObs,
    shop("shopify.orders_30d", 60),
    shop("shopify.revenue_30d", 6000, "EUR"),
  ]);
  const realRoas = sameCurrency.find((s) => s.id === "cross.roas_reel")!;
  t.check("le rapport réel est calculé", realRoas.statement.includes("6.00"), true);
  t.check("c'est une déduction forte", realRoas.certainty, "deduction_forte");
  t.check(
    "sans être présenté comme un ROAS",
    realRoas.doNotConclude.includes("n'est pas un ROAS"),
    true,
  );

  // LE piège : compte publicitaire en dollars, boutique en euros. Comparer
  // produirait un rapport faux que personne ne verrait passer.
  const mixed = crossSignals([
    ...metaObs,
    shop("shopify.orders_30d", 60),
    shop("shopify.revenue_30d", 6000, "USD"),
  ]);
  t.check(
    "deux devises différentes interdisent le rapprochement",
    mixed.some((s) => s.id === "cross.devises_incomparables"),
    true,
  );
  t.check(
    "et aucun rapport n'est calculé",
    mixed.some((s) => s.id === "cross.roas_reel"),
    false,
  );
  t.check(
    "l'interdiction est formelle",
    mixed.find((s) => s.id === "cross.devises_incomparables")!.doNotConclude.includes("JAMAIS"),
    true,
  );

  // --- Une seule source : aucun croisement --------------------------------
  t.check(
    "sans Shopify, pas de croisement après clic",
    crossSignals(metaObs).some((s) => s.id === "cross.trafic_qui_nachete_pas"),
    false,
  );
  t.check(
    "sans Meta, aucun croisement du tout",
    crossSignals([shop("shopify.orders_30d", 40)]),
    [],
  );
  t.check("sans rien, aucun croisement", crossSignals([]), []);
  t.check(
    "et le prompt le dit au lieu de laisser un vide",
    crossSignalsToPromptBlock([]).includes("AUCUN CROISEMENT POSSIBLE"),
    true,
  );

  // --- Ce qui part dans le prompt ------------------------------------------
  const block = crossSignalsToPromptBlock(leak);
  t.check(
    "chaque signal porte son niveau de certitude",
    block.includes("[HYPOTHÈSE]") || block.includes("[DÉDUCTION FORTE]"),
    true,
  );
  t.check("les pistes à creuser sont listées", block.includes("À creuser"), true);
  t.check("l'interdiction est portée à côté", block.includes("NE CONCLUS PAS"), true);
  t.check(
    "et le cadre général rappelle qu'on oriente sans accuser",
    block.includes("ORIENTENT la recherche, ils ne désignent pas un coupable"),
    true,
  );

  // =========================================================================
  // 3. DIAGNOSTICABILITÉ
  // =========================================================================
  const withBoth = assessDiagnostics([
    ...metaObs,
    shop("shopify.orders_30d", 40),
    shop("shopify.aov", 90, "EUR"),
  ]);
  const availableIds = withBoth.available.map((a) => a.diagnostic.id);
  t.check(
    "le croisement après clic devient diagnosticable",
    availableIds.includes("croisement.apres_clic"),
    true,
  );
  t.check(
    "la dépense sans résultat aussi",
    availableIds.includes("acquisition.depense_sans_resultat"),
    true,
  );
  t.check(
    "le coût du clic rapporté au panier aussi",
    availableIds.includes("acquisition.cout_du_clic"),
    true,
  );
  t.check("l'accroche aussi", availableIds.includes("acquisition.accroche"), true);

  // Sans Shopify, le croisement redevient hors de portée — et on dit laquelle
  // des deux données manque.
  const metaOnly = assessDiagnostics(metaObs);
  const blocked = metaOnly.blocked.find((b) => b.diagnostic.id === "croisement.apres_clic")!;
  t.check("sans Shopify, le croisement est hors de portée", Boolean(blocked), true);
  t.check("et la donnée manquante est nommée", blocked.missing, ["shopify.orders_30d"]);
  t.check(
    "sans Meta, le coût du clic est hors de portée",
    assessDiagnostics([shop("shopify.aov", 90, "EUR")]).blocked.some(
      (b) => b.diagnostic.id === "acquisition.cout_du_clic",
    ),
    true,
  );

  // =========================================================================
  // 4. LE BRANCHEMENT
  // =========================================================================
  const runner = read("src/lib/audit-runner.server.ts");
  t.check("l'audit collecte Meta", runner.includes("fetchMetaObservations"), true);
  t.check("et croise les sources", runner.includes("crossSignals"), true);
  t.check("le croisement part dans le prompt", runner.includes("crossSignalsToPromptBlock"), true);
  t.check(
    "le croisement lit toutes les sources, pas une",
    runner.includes("crossSignals(allObservations(reports))"),
    true,
  );

  const connector = read("src/lib/connectors/meta-observe.server.ts");
  t.check("les ressources sont lues indépendamment", connector.includes("Promise.all"), true);
  t.check(
    "un jeton illisible ne fait pas échouer l'audit",
    connector.includes("Jeton Meta illisible"),
    true,
  );
  t.check(
    "la période précédente est strictement antérieure",
    connector.includes("2 * META_WINDOW_DAYS"),
    true,
  );
  // Une permission de plus imposerait une réautorisation à chaque marchand.
  const metaFunctions = read("src/lib/connectors/meta.functions.ts");
  t.check("aucune permission nouvelle n'est demandée", metaFunctions.includes("ads_read"), true);
  // Contrôle sur les lignes de CODE : les commentaires du connecteur citent
  // délibérément la permission déjà accordée pour expliquer qu'il s'y tient.
  const connectorCode = connector
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  t.check(
    "et le connecteur n'en réclame aucune dans son code",
    /ads_management|business_management|ads_read/.test(connectorCode),
    false,
  );

  const cross = read("src/lib/cross-source.ts");
  t.check("le module croisé ne dépend d'aucun connecteur", /connectors\//.test(cross), false);
});
