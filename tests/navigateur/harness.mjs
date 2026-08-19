// Harnais de revue visuelle : rend l'application réelle avec un backend simulé.
// Aucun identifiant réel n'y figure — le compte de test n'est pas utilisé ici,
// le backend de production étant hors d'atteinte depuis cet environnement.
import { chromium } from "playwright";

export const BASE = "http://127.0.0.1:8080";
export const REF = "bexepsagfrohwdmhjjxk";

const USER = {
  id: "11111111-1111-4111-8111-111111111111",
  aud: "authenticated",
  role: "authenticated",
  email: "marchand@exemple.test",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  app_metadata: { provider: "email" },
  user_metadata: { full_name: "Camille Rousseau" },
  identities: [],
};

const SESSION = {
  access_token: "harness.access.token",
  refresh_token: "harness.refresh.token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: USER,
};

export const STORE_A = "22222222-2222-4222-8222-222222222222";
export const STORE_B = "33333333-3333-4333-8333-333333333333";
export const AUDIT_1 = "44444444-4444-4444-8444-444444444444";
export const AUDIT_0 = "55555555-5555-4555-8555-555555555555";

const stores = [
  {
    id: STORE_A,
    owner_id: USER.id,
    name: "Atelier Lumen",
    url: "https://atelier-lumen.myshopify.com",
    niche: "Luminaires artisanaux",
    monthly_revenue: 18400,
    monthly_ad_budget: 4200,
    revenue_goal: 30000,
    goal: "Atteindre 30 000 € par mois d'ici la fin de l'année sans augmenter le budget publicitaire.",
    avg_product_cost_ratio: 42,
    fixed_costs_monthly: 2600,
    currency: "EUR",
    situation: "few_sales",
    updated_at: "2026-08-14T09:00:00Z",
    created_at: "2026-03-02T09:00:00Z",
  },
  {
    id: STORE_B,
    owner_id: USER.id,
    name: "Brume Cosmétiques",
    url: "https://brume-cosmetiques.myshopify.com",
    niche: "Cosmétique naturelle",
    monthly_revenue: 5200,
    monthly_ad_budget: null,
    revenue_goal: null,
    goal: null,
    avg_product_cost_ratio: null,
    fixed_costs_monthly: null,
    currency: "EUR",
    situation: "no_sales",
    updated_at: "2026-05-18T09:00:00Z",
    created_at: "2026-05-18T09:00:00Z",
  },
];

export const AUDIT_ECHOUE = "77777777-7777-4777-8777-777777777779";

const audits = [
  {
    id: AUDIT_ECHOUE,
    store_id: STORE_A,
    status: "failed",
    score: null,
    category_scores: {},
    potential_gain_min: null,
    potential_gain_max: null,
    verdict: null,
    summary: null,
    error_message: "AI Gateway 429: overloaded",
    data_gaps: [
      {
        id: "shopify.unreachable",
        label: "Shopify",
        source: "shopify",
        reason: "Source injoignable — aucune donnée de ce canal.",
        wouldEnable: "Tout le diagnostic Shopify.",
      },
    ],
    created_at: "2026-08-18T09:00:00Z",
    completed_at: null,
  },
  {
    id: AUDIT_1,
    store_id: STORE_A,
    status: "completed",
    score: 58,
    category_scores: { offre: 64, conversion: 41, acquisition: 55, retention: 72, operations: 60 },
    potential_gain_min: 1800,
    potential_gain_max: 3400,
    verdict:
      "Votre tunnel perd la vente juste avant le paiement : trois visiteurs sur quatre qui ajoutent au panier ne paient jamais.",
    summary:
      "La boutique attire correctement, mais convertit mal. L'essentiel du potentiel se trouve entre le panier et le paiement.",
    created_at: "2026-08-14T10:12:00Z",
    completed_at: "2026-08-14T10:14:00Z",
  },
  {
    id: AUDIT_0,
    store_id: STORE_A,
    status: "completed",
    score: 44,
    category_scores: { offre: 52, conversion: 30, acquisition: 48, retention: 60, operations: 55 },
    potential_gain_min: 2400,
    potential_gain_max: 4100,
    verdict: "Les fiches produit ne disent pas à qui le produit s'adresse.",
    summary: "Premier diagnostic complet.",
    created_at: "2026-07-02T10:12:00Z",
    completed_at: "2026-07-02T10:15:00Z",
  },
];

const findings = [
  {
    id: "66666666-6666-4666-8666-666666666661",
    audit_id: AUDIT_1,
    title: "Les frais de livraison n'apparaissent qu'au paiement",
    category: "conversion",
    severity: "critical",
    evidence: {
      based_on:
        "Sur les 30 derniers jours relevés dans Shopify : 412 paniers créés, 149 paiements engagés, 107 commandes payées. Les frais n'apparaissent sur aucune fiche produit ni dans le panier.",
      assumptions:
        "Nous supposons que la chute entre le panier et le paiement tient d'abord au montant découvert tard. Nous n'avons pas de mesure du motif d'abandon déclaré par vos clients.",
    },
    impact_description:
      "Trois paniers sur quatre n'aboutissent pas. Au panier moyen constaté, cela représente entre 900 € et 1 700 € par mois.",
    root_cause: "Le montant de la livraison n'est annoncé nulle part avant l'écran de paiement.",
    action_steps: [
      { text: "Affichez le montant de la livraison sur chaque fiche produit." },
      { text: "Rappelez le seuil de livraison gratuite dans le panier." },
    ],
    estimated_gain_min: 900,
    estimated_gain_max: 1700,
    difficulty: 1,
    time_minutes: 40,
    confidence: "high",
    epistemic_level: "fait",
    timeframe: "today",
    auto_correction: null,
  },
  {
    id: "66666666-6666-4666-8666-666666666662",
    audit_id: AUDIT_1,
    title: "Aucune relance de panier abandonné",
    category: "retention",
    severity: "high",
    evidence: {
      based_on: "Aucune automatisation de relance n'est active sur la boutique.",
      assumptions:
        "Nous supposons que les paniers abandonnés relevés sont récupérables. Nous n'avons pas mesuré votre taux de réponse aux e-mails.",
    },
    impact_description: "Les paniers abandonnés ne sont jamais relancés.",
    root_cause: "Aucune séquence de relance n'a été mise en place.",
    action_steps: [{ text: "Programmez une relance à 1 h, puis à 24 h." }],
    estimated_gain_min: 600,
    estimated_gain_max: 1200,
    difficulty: 2,
    time_minutes: 60,
    confidence: "medium",
    epistemic_level: "observe",
    timeframe: "this_week",
    auto_correction: { kind: "email", body: "..." },
  },
  {
    id: "66666666-6666-4666-8666-666666666663",
    audit_id: AUDIT_1,
    title: "La page d'accueil ne dit pas ce que vous vendez",
    category: "offre",
    severity: "medium",
    evidence: {
      based_on: "Titre principal relevé sur la page d'accueil : « Collection ».",
      assumptions: "Nous n'avons pas mesuré le taux de rebond par source de trafic.",
    },
    impact_description: "Un visiteur ne peut pas savoir ce qu'il achète.",
    root_cause: "Le premier écran n'annonce ni le produit ni le public.",
    action_steps: [{ text: "Remplacez le titre par ce que vous vendez et pour qui." }],
    estimated_gain_min: 300,
    estimated_gain_max: 500,
    difficulty: 1,
    time_minutes: 20,
    confidence: "high",
    epistemic_level: "hypothese",
    timeframe: "this_month",
    auto_correction: { kind: "copy", body: "..." },
  },
];

const connections = [
  {
    id: "77777777-7777-4777-8777-777777777771",
    store_id: STORE_A,
    provider: "shopify",
    status: "active",
    account_label: "atelier-lumen.myshopify.com",
    account_id: "atelier-lumen.myshopify.com",
    connected_at: "2026-08-10T08:00:00Z",
    last_error: null,
    scope: "read_products,read_orders",
    metadata: {},
    expires_at: null,
  },
];

const profile = {
  id: "88888888-8888-4888-8888-888888888888",
  user_id: USER.id,
  full_name: "Camille Rousseau",
  email: USER.email,
  experience_level: "beginner",
  subscription_tier: "free",
  audits_used: 1,
  created_at: "2026-01-01T00:00:00Z",
};

/** Charge du cockpit, construite d'après le type rendu par `cockpit.functions.ts`. */
export const COCKPIT = {
  storeId: STORE_A,
  currency: "EUR",
  adSpendCurrency: "EUR",
  revenue: 18400,
  revenueGoal: 30000,
  orders: 107,
  aov: 172,
  adSpend: 4200,
  roas: 4.38,
  margin: 10672,
  profit: 3872,
  profitIncludesFixedCosts: true,
  score: 58,
  categoryScores: { offre: 64, conversion: 41, acquisition: 55, retention: 72, operations: 60 },
  potentialMin: 1800,
  potentialMax: 3400,
  lastSyncAt: "2026-08-17T06:00:00Z",
  unavailable: [],
  priorities: [
    {
      id: "66666666-6666-4666-8666-666666666661",
      title: "Les frais de livraison n'apparaissent qu'au paiement",
      category: "conversion",
      severity: "critical",
      impact_min: 900,
      impact_max: 1700,
      difficulty: 1,
      time_minutes: 40,
      confidence: "high",
      audit_id: AUDIT_1,
      has_auto_fix: false,
      band: "critique",
      reason: "C'est la marche où le plus grand volume disparaît.",
      unlocks: [],
      measure: "le taux de passage du panier au paiement, dans Shopify",
    },
  ],
  plan: null,
  briefing: {
    headline: "Priorité #1 — Les frais de livraison n'apparaissent qu'au paiement",
    impact: "Entre 900 € et 1 700 € par mois, au panier moyen constaté.",
    proof: [
      "412 paniers créés, 149 paiements engagés, 107 commandes payées (Shopify, 30 derniers jours).",
      "Aucun montant de livraison n'apparaît sur les fiches produit ni dans le panier.",
    ],
    certainty: {
      level: "mesure",
      label: "Mesuré",
      hint: "Les volumes viennent directement de votre boutique.",
    },
    rootCause: "Le montant de la livraison n'est annoncé nulle part avant l'écran de paiement.",
    known: [
      "Le volume perdu se situe entre le panier et le paiement.",
      "Le panier moyen est de 172 €.",
    ],
    unknown: [
      "Le motif d'abandon déclaré par vos clients : aucune source ne le mesure.",
      "La part des visiteurs venus d'un comparateur de prix.",
    ],
    action: {
      kind: "guider",
      label: "Afficher les frais de livraison sur la fiche produit",
      why: "Aucune correction automatique n'existe pour un thème Shopify : la modification se fait chez vous, et nous ne touchons pas à votre thème.",
      steps: [
        "Ouvrez votre thème Shopify, section « Fiche produit ».",
        "Ajoutez le montant de la livraison, ou le seuil de gratuité, sous le prix.",
        "Rappelez la même information dans le panier.",
      ],
      writes: false,
    },
    expected: "Le passage du panier au paiement devrait remonter vers 45 %.",
    verification: "Nous comparerons les mêmes volumes sur 14 jours après la correction.",
    nextDecision:
      "Si le taux ne bouge pas, la cause est ailleurs et nous reprendrons le diagnostic.",
  },
  funnel: {
    steps: [
      {
        stage: "sessions",
        label: "Visiteurs",
        value: 6820,
        evidence: "Shopify, 30 derniers jours",
      },
      {
        stage: "carts",
        label: "Paniers créés",
        value: 412,
        evidence: "Shopify, 30 derniers jours",
      },
      {
        stage: "checkouts",
        label: "Paiements engagés",
        value: 149,
        evidence: "Shopify, 30 derniers jours",
      },
      {
        stage: "orders",
        label: "Commandes payées",
        value: 107,
        evidence: "Shopify, 30 derniers jours",
      },
    ],
    unknown: ["product_views"],
    leaks: [
      {
        from: "carts",
        to: "checkouts",
        fromLabel: "Paniers créés",
        toLabel: "Paiements engagés",
        entered: 412,
        exited: 149,
        rate: 36,
        reference: 55,
        referenceNote: "Ordre de grandeur courant en e-commerce, pas une loi.",
        missing: 78,
        costPerMonth: 1300,
        currency: "EUR",
        evidence: ["Shopify, 30 derniers jours"],
      },
    ],
    worst: {
      from: "carts",
      to: "checkouts",
      fromLabel: "Paniers créés",
      toLabel: "Paiements engagés",
      entered: 412,
      exited: 149,
      rate: 36,
      reference: 55,
      referenceNote: "Ordre de grandeur courant en e-commerce, pas une loi.",
      missing: 78,
      costPerMonth: 1300,
      currency: "EUR",
    },
  },
  crossSignals: [
    {
      id: "croise-1",
      statement:
        "La publicité amène du trafic — 1 840 clics — mais seulement 1,42 % débouchent sur une commande. La fuite est APRÈS le clic, pas avant.",
      investigate: [
        "Le passage du panier au paiement, où le volume disparaît.",
        "La correspondance entre la promesse de l'annonce et la fiche produit.",
      ],
      doNotConclude:
        "Ceci ne dit pas que vos publicités sont mauvaises : le ciblage peut être juste et la boutique ne pas transformer.",
      certainty: "deduction_forte",
      evidence: [
        "1 840 clics payants sur 30 jours (Meta Ads).",
        "107 commandes payées sur la même période (Shopify).",
      ],
    },
  ],
  dataGaps: [
    {
      id: "product_views",
      label: "Vues de fiches produit",
      reason: "Aucune source connectée ne mesure les vues produit.",
      wouldEnable: "Localiser une fuite entre la visite et le panier.",
    },
  ],
  work: { a_faire: 3, en_attente: 1, en_mesure: 1, prouve: 2, sans_effet: 0, regression: 0 },
};

function tableOf(url) {
  const m = url.pathname.match(/\/rest\/v1\/([a-z_]+)/);
  return m ? m[1] : null;
}

/** Filtre grossier `col=eq.valeur` — suffisant pour un rendu fidèle. */
function applyEq(rows, url) {
  let out = rows;
  for (const [k, v] of url.searchParams) {
    if (["select", "order", "limit", "offset"].includes(k)) continue;
    if (typeof v === "string" && v.startsWith("eq.")) {
      const want = v.slice(3);
      out = out.filter((r) => String(r[k]) === want);
    }
  }
  return out;
}

export function fixtureFor(url, scenario) {
  const t = tableOf(url);
  if (!t) return null;
  if (scenario === "erreur") return { status: 500, body: { message: "boom" } };
  if (scenario === "interdit") return { status: 403, body: { message: "interdit" } };

  let rows;
  switch (t) {
    case "stores":
      rows = scenario === "vide" ? [] : scenario === "mono" ? [stores[0]] : stores;
      rows = rows.map((s) => ({
        ...s,
        data_connections: connections
          .filter((c) => c.store_id === s.id)
          .map((c) => ({ provider: c.provider, status: c.status })),
        audits: audits
          .filter((a) => a.store_id === s.id)
          .map((a) => ({
            id: a.id,
            score: a.score,
            status: a.status,
            created_at: a.created_at,
            verdict: a.verdict,
          })),
      }));
      break;
    case "audits": {
      const st = (id) => {
        const s = stores.find((x) => x.id === id);
        return s ? { id: s.id, name: s.name, currency: s.currency } : null;
      };
      rows =
        scenario === "vide"
          ? []
          : audits.map((a) => ({
              ...a,
              stores: scenario === "sansboutique" ? null : st(a.store_id),
            }));
      break;
    }
    case "audit_findings":
      rows = findings;
      break;
    case "data_connections":
      rows = scenario === "vide" || scenario === "sansconnexion" ? [] : connections;
      break;
    case "profiles":
      rows = [profile];
      break;
    default:
      rows = [];
  }
  rows = applyEq(rows, url);
  return { status: 200, body: rows };
}

/**
 * `tablesEnPanne` : une PANNE PARTIELLE.
 *
 * Le scénario « erreur » fait tomber toutes les lectures d'un coup — la page
 * part alors sur son écran d'échec global, et l'on ne voit jamais ce qui se
 * passe quand UNE SEULE requête échoue au milieu d'un écran par ailleurs
 * complet. C'est pourtant la forme réelle du défaut : `metadata` refusé sur
 * `data_connections` n'a jamais empêché la lecture des boutiques.
 */
export async function makeContext(
  browser,
  { scenario = "normal", mobile = false, tablesEnPanne = [], fonctionsEnPanne = [] } = {},
) {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    isMobile: mobile,
    hasTouch: mobile,
    ignoreHTTPSErrors: true,
    locale: "fr-FR",
  });

  await ctx.addInitScript(
    ([ref, session]) => {
      localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session));
    },
    [REF, SESSION],
  );

  // Les fonctions serveur de TanStack : l'identifiant encodé dans l'adresse
  // nomme le fichier et l'export, ce qui permet de répondre par fonction.
  await ctx.route(/_serverFn/, async (route) => {
    const m = route
      .request()
      .url()
      .match(/_serverFn\/([^?/]+)/);
    let nom = "";
    try {
      nom = JSON.parse(Buffer.from(m[1], "base64").toString("utf8")).export ?? "";
    } catch {
      nom = "";
    }
    const json = (body) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (fonctionsEnPanne.some((f) => nom.startsWith(f))) {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "panne simulée" } }),
      });
    }
    if (nom.startsWith("getCockpit")) return json({ result: COCKPIT });
    if (nom.toLowerCase().includes("entitlement"))
      return json({
        result: {
          tier: "free",
          periodStart: "2026-08-01",
          used: { audits: 1, fixes: 2, coach_messages: 0 },
          remaining: { audits: 0, fixes: 3, coach_messages: 10 },
        },
      });
    return json({ result: null });
  });

  await ctx.route(/supabase\.co/, async (route) => {
    const url = new URL(route.request().url());
    // Scénario « lent » : seules les LECTURES DE DONNÉES traînent, pas l'auth —
    // sinon la route protégée n'a pas encore rendu et il n'y a rien à voir.
    if (scenario === "lent" && url.pathname.startsWith("/rest/")) {
      await new Promise((r) => setTimeout(r, 15000));
    }
    const json = (status, body) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.startsWith("/auth/v1/user")) return json(200, USER);
    if (url.pathname.startsWith("/auth/v1/token")) return json(200, SESSION);
    if (url.pathname.startsWith("/auth/v1/logout")) return json(204, {});
    if (url.pathname.startsWith("/auth/v1/")) return json(200, {});

    const table = tableOf(url);
    if (table && tablesEnPanne.includes(table)) {
      return json(500, { message: "panne simulée", code: "XX000" });
    }

    const fx = fixtureFor(url, scenario);
    if (fx) {
      const single = (route.request().headers()["accept"] || "").includes("vnd.pgrst.object");
      if (single) {
        const row = Array.isArray(fx.body) ? fx.body[0] : fx.body;
        if (!row) return json(406, { message: "no rows" });
        return json(fx.status, row);
      }
      return json(fx.status, fx.body);
    }
    return json(200, []);
  });

  return ctx;
}

export async function launch() {
  return chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-sandbox", "--force-color-profile=srgb"],
  });
}
