import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MICROS,
  SHOPPING_CHANNELS,
  googleObservations,
  googleUnreachable,
  type GoogleRaw,
  type RawGoogleCampaign,
} from "../../src/lib/connectors/google-observe";
import { crossSignals } from "../../src/lib/cross-source";
import { buildFunnel } from "../../src/lib/funnel";
import { assessDiagnostics } from "../../src/lib/diagnostics";
import { observationValue, type Observation } from "../../src/lib/observations";
import { defineSuite } from "../harness";

/**
 * Google Ads, et l'attribution entre canaux.
 *
 * POURQUOI GOOGLE APPARTIENT AU CHEMIN DE VALIDATION RÉELLE. Un audit
 * d'acquisition incomplet ne se contente pas d'être incomplet : il ATTRIBUE
 * MAL. Une boutique dont Meta va mal et Google va bien recevrait, sans Google,
 * le verdict « ton acquisition ne fonctionne pas ». C'est faux, et c'est cher :
 * le marchand coupe ce qui marchait, ou refait ce qui marche déjà.
 *
 * Le troisième canal ne s'ajoute pas au diagnostic — il le corrige. Ces
 * contrôles portent d'abord là-dessus.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

function campaign(overrides: Partial<RawGoogleCampaign> = {}): RawGoogleCampaign {
  return {
    id: "1",
    name: "Recherche marque",
    status: "ENABLED",
    channel: "SEARCH",
    cost_micros: 1000 * MICROS,
    impressions: 50000,
    clicks: 1500,
    conversions: 40,
    conversions_value: 4000,
    ...overrides,
  };
}

function raw(overrides: Partial<GoogleRaw> = {}): GoogleRaw {
  return { currency: "EUR", campaigns: [campaign()], previous: null, ...overrides };
}

function obs(id: string, value: number, currency?: string): Observation {
  const source = id.startsWith("meta") ? "meta" : id.startsWith("google") ? "google" : "shopify";
  return {
    id,
    source,
    domain: "acquisition",
    label: id,
    value,
    unit: currency ? "currency" : id.includes("roas") ? "ratio" : "count",
    currency: currency ?? null,
    periodDays: 30,
    evidence: `${value} relevé (${source})`,
    sample: value,
  };
}

export default defineSuite("Google Ads — observations et attribution", (t) => {
  // =========================================================================
  // 1. CE QUE GOOGLE ÉTABLIT SEUL
  // =========================================================================
  const report = googleObservations(raw());
  const v = (id: string) => observationValue(report.observations, id);

  // Les montants Google sont en micros : un euro s'écrit 1 000 000. Une
  // conversion oubliée produit des chiffres faux d'un facteur un million.
  t.check("la dépense est convertie depuis les micros", v("google.spend_30d"), 1000);
  t.check("les impressions sont lues", v("google.impressions_30d"), 50000);
  t.check("les clics aussi", v("google.clicks_30d"), 1500);
  t.check("les conversions aussi", v("google.conversions_30d"), 40);
  t.check("leur valeur aussi", v("google.conversion_value_30d"), 4000);
  t.check("le CTR est recalculé sur les totaux", v("google.ctr_30d"), 3);
  t.check("le CPC aussi", Number(v("google.cpc_30d")?.toFixed(4)), 0.6667);
  t.check("le ROAS aussi", v("google.roas_30d"), 4);
  t.check("les campagnes sont comptées", v("google.campaign_count"), 1);
  t.check(
    "les montants portent la devise du compte Google",
    report.observations.find((o) => o.id === "google.spend_30d")!.currency,
    "EUR",
  );
  // Le ROAS porte le nombre de CONVERSIONS : c'est ce qui permet de refuser
  // de conclure sur trois conversions.
  t.check(
    "le ROAS porte les conversions comme échantillon",
    report.observations.find((o) => o.id === "google.roas_30d")!.sample,
    40,
  );
  t.check(
    "et la preuve rappelle que ce sont les conversions de Google",
    report.observations
      .find((o) => o.id === "google.conversions_30d")!
      .evidence.includes("ce ne sont pas les commandes de la boutique"),
    true,
  );

  // --- Campagne déficitaire -------------------------------------------------
  const wasteful = googleObservations(
    raw({
      campaigns: [
        campaign(),
        campaign({
          id: "2",
          name: "Display large",
          cost_micros: 700 * MICROS,
          conversions: 0,
          conversions_value: 0,
        }),
      ],
    }),
  );
  t.check(
    "une campagne qui dépense sans convertir est comptée",
    observationValue(wasteful.observations, "google.campaigns_without_result"),
    1,
  );
  t.check(
    "la dépense perdue est chiffrée",
    observationValue(wasteful.observations, "google.wasted_spend_30d"),
    700,
  );
  t.check(
    "et la campagne est nommée",
    wasteful.observations
      .find((o) => o.id === "google.campaigns_without_result")!
      .evidence.includes("Display large"),
    true,
  );

  // --- Shopping -------------------------------------------------------------
  t.check("Performance Max compte comme Shopping", SHOPPING_CHANNELS.has("PERFORMANCE_MAX"), true);
  const shopping = googleObservations(
    raw({
      campaigns: [
        campaign({ cost_micros: 400 * MICROS }),
        campaign({ id: "2", channel: "SHOPPING", cost_micros: 600 * MICROS }),
      ],
    }),
  );
  t.check(
    "les campagnes Shopping sont repérées",
    observationValue(shopping.observations, "google.shopping_campaigns"),
    1,
  );
  t.check(
    "et leur part de budget calculée",
    observationValue(shopping.observations, "google.shopping_spend_share"),
    60,
  );
  t.check(
    "sans Shopping, c'est un manque déclaré et non un zéro",
    report.gaps.some((g) => g.id === "google.shopping_campaigns"),
    true,
  );

  // --- Données insuffisantes ------------------------------------------------
  const empty = googleObservations(raw({ campaigns: [] }));
  t.check("sans campagne, aucune observation n'est fabriquée", empty.observations, []);
  t.check(
    "et le manque est déclaré",
    empty.gaps.some((g) => g.id === "google.insights"),
    true,
  );
  t.check(
    "en disant ce qu'il empêche de distinguer",
    empty.gaps.find((g) => g.id === "google.insights")!.wouldEnable.includes("Meta porte seul"),
    true,
  );
  t.check("un compte injoignable ne produit rien", googleUnreachable("x").observations, []);
  t.check("et se déclare comme tel", googleUnreachable("x").reachable, false);
  t.check(
    "l'angle mort de Google est déclaré",
    report.gaps.some((g) => g.id === "google.post_click_behaviour"),
    true,
  );

  // --- Évolution ------------------------------------------------------------
  const evolving = googleObservations(
    raw({ previous: [campaign({ cost_micros: 500 * MICROS, conversions: 20 })] }),
  );
  t.check(
    "l'évolution de la dépense est mesurée",
    observationValue(evolving.observations, "google.spend_change_pct"),
    100,
  );
  t.check(
    "celle des conversions aussi",
    observationValue(evolving.observations, "google.conversions_change_pct"),
    100,
  );

  // =========================================================================
  // 2. L'ATTRIBUTION ENTRE CANAUX — la raison d'être de ce bloc
  // =========================================================================

  // Meta mauvais + Google bon : NE PAS condamner toute l'acquisition.
  const metaBadGoogleGood = crossSignals([
    obs("meta.roas_30d", 0.8),
    obs("google.roas_30d", 4),
    obs("shopify.orders_30d", 100),
  ]);
  const isolated = metaBadGoogleGood.find((s) => s.id === "cross.canal_isole")!;
  t.check("l'écart est situé entre les canaux", Boolean(isolated), true);
  t.check(
    "et on interdit de condamner l'acquisition entière",
    isolated.doNotConclude.includes("Ne conclus SURTOUT PAS que l'acquisition ne fonctionne pas"),
    true,
  );
  t.check("le canal qui marche est nommé", isolated.doNotConclude.includes("Google"), true);
  t.check("c'est une déduction forte, pas un fait", isolated.certainty, "deduction_forte");
  t.check(
    "et on oriente vers ce qui distingue les deux",
    isolated.investigate.some((i) => i.includes("distingue")),
    true,
  );

  // Google mauvais + Meta bon : symétrique.
  const googleBad = crossSignals([obs("meta.roas_30d", 4), obs("google.roas_30d", 0.7)]);
  t.check(
    "le cas symétrique est traité",
    googleBad.find((s) => s.id === "cross.canal_isole")!.statement.includes("Google rapporte"),
    true,
  );

  // Les deux mauvais : le raisonnement facile serait « les régies sont mal
  // réglées ». Deux canaux indépendants qui échouent ensemble désignent ce
  // qu'ils partagent.
  const bothBad = crossSignals([obs("meta.roas_30d", 0.9), obs("google.roas_30d", 1.1)]);
  const global = bothBad.find((s) => s.id === "cross.acquisition_globale")!;
  t.check("deux canaux faibles sont vus ensemble", Boolean(global), true);
  t.check(
    "sans conclure que les régies sont mal réglées",
    global.doNotConclude.includes("Ne conclus pas que les deux régies sont mal réglées"),
    true,
  );
  t.check(
    "on cherche ce qu'ils partagent",
    global.doNotConclude.includes("la boutique, l'offre et le prix"),
    true,
  );

  // Les deux bons : aucun signal d'attribution ne doit apparaître.
  t.check(
    "deux canaux performants ne déclenchent aucune alerte d'attribution",
    crossSignals([obs("meta.roas_30d", 3), obs("google.roas_30d", 4)]).some(
      (s) => s.id === "cross.canal_isole" || s.id === "cross.acquisition_globale",
    ),
    false,
  );

  // Un seul canal mesuré : le dire, pour que la certitude baisse au lieu de
  // généraliser depuis l'unique canal visible.
  const metaOnly = crossSignals([obs("meta.roas_30d", 0.8)]);
  const missing = metaOnly.find((s) => s.id === "cross.canal_manquant")!;
  t.check("un canal manquant est signalé", Boolean(missing), true);
  t.check("il est nommé", missing.statement.includes("Google"), true);
  t.check(
    "et on interdit de généraliser",
    missing.doNotConclude.includes("Ne généralisez pas à toute l'acquisition"),
    true,
  );
  t.check("c'est un fait", missing.certainty, "fait");
  t.check(
    "le cas symétrique aussi",
    crossSignals([obs("google.roas_30d", 0.8)])
      .find((s) => s.id === "cross.canal_manquant")!
      .statement.includes("Meta"),
    true,
  );

  // --- Le trafic payant est la SOMME des canaux ---------------------------
  // Rapporter les commandes aux seuls clics Meta sur une boutique qui fait
  // aussi du Google surestimerait le taux de transformation.
  const bothChannels = crossSignals([
    obs("meta.clicks_30d", 1000),
    obs("google.clicks_30d", 1000),
    obs("shopify.orders_30d", 8),
  ]);
  const leak = bothChannels.find((s) => s.id === "cross.trafic_qui_nachete_pas")!;
  t.check(
    "les clics des deux canaux sont additionnés",
    leak.statement.includes("2000 clics"),
    true,
  );
  t.check("et la preuve nomme les canaux", leak.evidence[0].includes("meta"), true);
  t.check("les deux", leak.evidence[0].includes("google"), true);
  // Avec Meta seul, 8/1000 = 0,8 % passerait au-dessus du seuil de fuite.
  // Avec les deux, 8/2000 = 0,4 % le déclenche. C'est la différence.
  t.check(
    "un seul canal aurait manqué la fuite",
    crossSignals([obs("meta.clicks_30d", 1000), obs("shopify.orders_30d", 8)]).some(
      (s) => s.id === "cross.trafic_qui_nachete_pas",
    ),
    false,
  );

  // --- CTR Google : hypothèse, avec des causes propres à Google ------------
  const lowCtr = crossSignals([obs("google.ctr_30d", 0.4)]);
  const ctrSignal = lowCtr.find((s) => s.id === "cross.ctr_google_faible")!;
  t.check("un CTR Google bas est repéré", Boolean(ctrSignal), true);
  t.check("c'est une hypothèse", ctrSignal.certainty, "hypothese");
  t.check(
    "avec les causes propres à la recherche",
    ctrSignal.investigate.some((i) => i.includes("mots-clés")),
    true,
  );
  t.check(
    "et la distinction fait/cause maintenue",
    ctrSignal.doNotConclude.includes("sa cause est une hypothèse"),
    true,
  );

  // --- Devises entre régies -------------------------------------------------
  const mixedCurrencies = crossSignals([
    { ...obs("meta.spend_30d", 1000, "EUR") },
    { ...obs("google.spend_30d", 1000, "USD") },
  ]);
  t.check(
    "deux régies en devises différentes sont signalées",
    mixedCurrencies.some((s) => s.id === "cross.devises_regies"),
    true,
  );
  t.check(
    "et l'addition est interdite",
    mixedCurrencies.find((s) => s.id === "cross.devises_regies")!.doNotConclude.includes("JAMAIS"),
    true,
  );

  // --- L'entonnoir compte tout le trafic payant ----------------------------
  const funnel = buildFunnel([
    obs("meta.impressions_30d", 60000),
    obs("google.impressions_30d", 40000),
    obs("meta.clicks_30d", 1200),
    obs("google.clicks_30d", 800),
    obs("shopify.orders_30d", 60),
    obs("shopify.abandoned_checkouts_30d", 240),
    obs("shopify.aov", 80, "EUR"),
  ]);
  t.check(
    "les impressions des deux canaux sont additionnées",
    funnel.steps.find((s) => s.stage === "impressions")!.value,
    100000,
  );
  t.check("les clics aussi", funnel.steps.find((s) => s.stage === "clics")!.value, 2000);
  t.check(
    "et la preuve nomme les canaux additionnés",
    funnel.steps.find((s) => s.stage === "clics")!.evidence!.includes("meta"),
    true,
  );
  t.check(
    "un seul canal reste utilisable tel quel",
    buildFunnel([obs("google.clicks_30d", 800), obs("shopify.orders_30d", 60)]).steps.find(
      (s) => s.stage === "clics",
    )!.value,
    800,
  );

  // --- Diagnosticabilité ----------------------------------------------------
  const both = assessDiagnostics([
    obs("meta.roas_30d", 2),
    obs("google.roas_30d", 3),
    obs("google.spend_30d", 1000, "EUR"),
    obs("google.campaigns_without_result", 1),
    obs("google.ctr_30d", 2),
    obs("google.impressions_30d", 50000),
  ]);
  const ids = both.available.map((a) => a.diagnostic.id);
  t.check(
    "l'attribution entre canaux devient diagnosticable",
    ids.includes("croisement.attribution_canal"),
    true,
  );
  t.check(
    "le gaspillage Google aussi",
    ids.includes("acquisition.google_depense_sans_resultat"),
    true,
  );
  t.check("l'adéquation requête/annonce aussi", ids.includes("acquisition.google_requete"), true);

  const onlyMeta = assessDiagnostics([obs("meta.roas_30d", 2)]);
  const blocked = onlyMeta.blocked.find((b) => b.diagnostic.id === "croisement.attribution_canal")!;
  t.check("sans Google, l'attribution est hors de portée", Boolean(blocked), true);
  t.check("et la donnée manquante est nommée", blocked.missing, ["google.roas_30d"]);

  // =========================================================================
  // 3. LE CHEMIN D'EXÉCUTION RÉEL
  // =========================================================================
  // Un test unitaire ne prouve pas qu'une fonctionnalité tourne en production.
  // Ce qu'on peut vérifier ici : que le chemin réel appelle bien le code, et
  // qu'aucune branche ne court-circuite la collecte.
  const runner = read("src/lib/audit-runner.server.ts");
  t.check("l'audit collecte Shopify", runner.includes("fetchShopifyObservations"), true);
  t.check("Meta", runner.includes("fetchMetaObservations"), true);
  t.check("et Google", runner.includes("fetchGoogleObservations"), true);
  // LA RÈGLE : aucun canal n'est interrogé sans identifiants. La collecte est
  // passée de trois blocs successifs à trois tâches menées de front — la garde
  // s'écrit donc en sortie anticipée, elle n'a pas disparu.
  t.check(
    "chaque canal n'est lu que s'il est connecté",
    /if \(!creds\.google\) return \{ rapports: \[\] \};/.test(runner),
    true,
  );
  /*
    CE QUE LA MISE EN PARALLÈLE NE DOIT SURTOUT PAS EMPORTER.

    Shopify, Meta et Google étaient interrogés l'un après l'autre : leurs délais
    s'additionnaient sans raison, aucun des trois n'ayant besoin des deux
    autres. Ils partent désormais ensemble.

    Mais `Promise.all` rejette dès la PREMIÈRE tâche qui lève — il ferait donc
    tomber les trois sources pour une seule, exactement l'inverse de la garantie
    la plus ancienne du moteur. Chaque tâche est donc écrite pour ne jamais
    lever : elle rend un rapport `reachable: false` et rien d'autre.
  */
  t.check("les trois sources partent ensemble", /await Promise\.all\(\[/.test(runner), true);
  for (const source of ["Shopify", "Meta", "Google"]) {
    t.check(
      `…et ${source} garde son propre filet`,
      new RegExp(`console\\.error\\("\\[audit\\] collecte ${source} impossible`).test(runner),
      true,
    );
  }
  // Le scan du site public reste APRÈS Shopify : il lui emprunte les pages
  // d'arrivée et les identifiants du catalogue. C'est la seule séquence que la
  // donnée impose, et elle doit le rester.
  t.check(
    "le scan de vitrine reste après la collecte Shopify",
    runner.indexOf("await Promise.all([") < runner.indexOf("scanStorefront("),
    true,
  );
  t.check(
    "la collecte précède le croisement",
    runner.indexOf("fetchGoogleObservations") < runner.indexOf("crossSignals("),
    true,
  );
  // L'APPEL AU MODÈLE NE S'ÉCRIT NI `aiChatCompletion({` NI `aiChatCompletion(`.
  // construit par une fonction pour que le modèle principal et le modèle de
  // secours partagent EXACTEMENT la même demande. On repère donc l'appel, pas
  // sa ponctuation — sinon ce contrôle rend -1 et passe pour vrai à l'envers.
  t.check(
    "et le croisement précède la demande au modèle",
    runner.indexOf("crossSignals(") < runner.lastIndexOf("aiChatCompletion"),
    true,
  );

  const connector = read("src/lib/connectors/google-observe.server.ts");
  t.check("le connecteur lit les impressions", connector.includes("metrics.impressions"), true);
  t.check("et la valeur des conversions", connector.includes("metrics.conversions_value"), true);
  t.check("et le type de campagne", connector.includes("advertising_channel_type"), true);
  // Un jeton de développeur absent est un défaut de CONFIGURATION du service,
  // pas un compte vide chez le marchand. Les confondre lui ferait croire que
  // ses campagnes n'existent pas.
  t.check(
    "un jeton de développeur manquant est distingué d'un compte vide",
    connector.includes("GOOGLE_ADS_DEVELOPER_TOKEN non configuré"),
    true,
  );
  t.check(
    "la période précédente ne chevauche pas la courante",
    connector.includes("2 * GOOGLE_WINDOW_DAYS"),
    true,
  );
  t.check(
    "aucune permission nouvelle n'est demandée",
    /adwords/.test(read("src/lib/connectors/google.functions.ts")),
    true,
  );

  // Le chemin réel ne doit contenir aucune donnée de démonstration.
  for (const file of [
    "src/lib/connectors/google-observe.server.ts",
    "src/lib/connectors/meta-observe.server.ts",
    "src/lib/connectors/shopify-observe.server.ts",
  ]) {
    const code = read(file);
    t.check(
      `« ${file} » ne contient aucune donnée de démonstration`,
      /mockData|fakeData|DEMO_|sampleResponse|stubResponse/i.test(code),
      false,
    );
  }
});
