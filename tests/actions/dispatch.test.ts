/**
 * Exercice LOCAL du vrai code d'aiguillage (phases 1 et 2).
 *
 * Ce n'est PAS un test d'API : aucun appel réseau n'est émis. On appelle les
 * fonctions de production `validateAgainstState` et `describeValidated` avec un
 * état de canaux synthétique, pour vérifier la chaîne complète
 * validation -> résolution de cible -> garde-fou -> before/after.
 *
 * Script hors dépôt, non commité.
 */
import {
  validateAgainstState,
  describeValidated,
  type ApplyContext,
} from "../../src/lib/apply-fix.server";
import { isRevertible } from "../../src/lib/action-plan";
import { defineSuite } from "../../tests/harness";

export default defineSuite("Actions — aiguillage Meta et Google Ads", async (t) => {
  function expectOk(label: string, fn: () => unknown): unknown {
    try {
      const v = fn();
      t.check(label, true, true);
      return v;
    } catch (e) {
      t.check(`${label} — attendu AUTORISÉ`, (e as Error).message.slice(0, 110), "aucune erreur");
      return undefined;
    }
  }

  function expectRefused(label: string, fn: () => unknown, mustContain?: string) {
    try {
      fn();
      t.check(`${label} — attendu REFUSÉ`, "autorisé", "refusé");
    } catch (e) {
      const msg = (e as Error).message;
      if (mustContain && !msg.includes(mustContain)) {
        t.check(`${label} — motif du refus`, msg.slice(0, 110), "motif attendu");
      } else t.check(label, true, true);
    }
  }

  function expectEqual(label: string, got: unknown, want: unknown) {
    t.check(label, got, want);
  }

  const ctx: ApplyContext = {
    store: { name: "Boutique test", niche: "test", url: null },
    finding: {
      category: "acquisition",
      severity: "high",
      title: "t",
      root_cause: null,
      impact_description: null,
    },
    shopify: { shop: "test.myshopify.com", encryptedToken: "x" },
    meta: { accountId: "act_1", encryptedToken: "x" },
    google: { customerId: "1234567890", encryptedRefreshToken: "x" },
  };

  const state: any = {
    shopifyToken: "tok",
    products: [
      { id: 111, title: "Ancien titre", body_html: "<p>ancien</p>", handle: "h", price: "30.00" },
    ],
    metaTok: "tok",
    metaSnap: {
      accountId: "act_1",
      currency: "USD",
      adsets: [
        // Déficitaire : dépense significative, ROAS < 1
        {
          id: "as_deficit",
          name: "Déficitaire",
          status: "ACTIVE",
          daily_budget: 20,
          targeting_summary: "âge 18-65",
          spend: 120,
          roas: 0.4,
        },
        // Rentable
        {
          id: "as_rentable",
          name: "Rentable",
          status: "ACTIVE",
          daily_budget: 20,
          targeting_summary: "âge 25-45",
          spend: 120,
          roas: 2.1,
        },
        // Dépense trop faible pour conclure
        {
          id: "as_jeune",
          name: "Jeune",
          status: "ACTIVE",
          daily_budget: 20,
          targeting_summary: "large",
          spend: 10,
          roas: 0,
        },
        // Sans budget quotidien connu (budget géré au niveau campagne)
        {
          id: "as_sans_budget",
          name: "Sans budget",
          status: "ACTIVE",
          daily_budget: null,
          targeting_summary: "large",
          spend: 120,
          roas: 0.2,
        },
      ],
      ads: [
        {
          id: "ad_1",
          name: "Pub 1",
          status: "ACTIVE",
          adset_id: "as_deficit",
          primary_text: "texte",
          headline: "titre",
        },
      ],
    },
    googleTok: "tok",
    googleSnap: {
      customerId: "1234567890",
      currency: "USD",
      campaigns: [
        {
          resource_name: "customers/1234567890/campaigns/1",
          id: "1",
          name: "Sans conversion",
          status: "ENABLED",
          channel: "SEARCH",
          budget_resource_name: "customers/1234567890/campaignBudgets/10",
          daily_budget: 30,
          cost_30d: 120,
          clicks_30d: 400,
          conversions_30d: 0,
          ctr_30d: 0.02,
        },
        {
          resource_name: "customers/1234567890/campaigns/2",
          id: "2",
          name: "Qui convertit",
          status: "ENABLED",
          channel: "SEARCH",
          budget_resource_name: "customers/1234567890/campaignBudgets/20",
          daily_budget: 30,
          cost_30d: 120,
          clicks_30d: 400,
          conversions_30d: 3,
          ctr_30d: 0.02,
        },
      ],
      ads: [
        {
          resource_name: "customers/1234567890/adGroupAds/1~1",
          campaign_name: "Sans conversion",
          ad_group_name: "ag",
          headlines: ["A", "B", "C"],
          descriptions: ["D1", "D2"],
        },
      ],
    },
  };

  const V = (tool: any, args: unknown) => validateAgainstState(ctx, state, tool, args);
  const D = (tool: any, args: unknown) => describeValidated(V(tool, args) as never);

  console.log("--- Shopify ---");
  const prod = D("update_product", {
    product_id: 111,
    title: "Nouveau titre",
    body_html: "<p>nouveau</p>",
  }) as any;
  expectOk("update_product : cible résolue", () => prod);
  expectEqual("update_product : before_value = état écrasé", prod?.beforeValue, {
    title: "Ancien titre",
    body_html: "<p>ancien</p>",
  });
  expectEqual("update_product : canal", prod?.channel, "shopify");
  expectRefused(
    "update_product : produit inexistant",
    () => V("update_product", { product_id: 999, title: "x", body_html: "y" }),
    "introuvable",
  );

  const promo = D("create_discount_code", {
    title: "Promo",
    code: " bienvenue ",
    percentage: 20,
    days: 10,
  }) as any;
  expectEqual(
    "create_discount_code : code normalisé",
    (promo?.afterValue as any)?.code,
    "BIENVENUE",
  );
  expectEqual("create_discount_code : aucun état écrasé", promo?.beforeValue, null);
  expectRefused(
    "create_discount_code : remise 90 % refusée (pas de clamp)",
    () => V("create_discount_code", { title: "P", code: "ABC", percentage: 90, days: 10 }),
    "Remise refusée",
  );

  console.log("--- Meta Ads ---");
  const mb = D("meta_update_budget", { adset_id: "as_deficit", daily_budget: 40 }) as any;
  expectEqual("meta_update_budget : before", mb?.beforeValue, { daily_budget: 20 });
  expectEqual("meta_update_budget : after", mb?.afterValue, { daily_budget: 40 });
  expectRefused(
    "meta_update_budget : 20 -> 50 (au-delà de ×2)",
    () => V("meta_update_budget", { adset_id: "as_deficit", daily_budget: 50 }),
    "Hausse de budget refusée",
  );
  expectRefused(
    "meta_update_budget : 20 -> 4 (sous le plancher)",
    () => V("meta_update_budget", { adset_id: "as_deficit", daily_budget: 4 }),
    "trop bas",
  );
  expectRefused(
    "meta_update_budget : budget actuel inconnu",
    () => V("meta_update_budget", { adset_id: "as_sans_budget", daily_budget: 20 }),
    "à l'aveugle",
  );
  expectRefused(
    "meta_update_budget : adset inexistant",
    () => V("meta_update_budget", { adset_id: "nope", daily_budget: 20 }),
    "introuvable",
  );

  const mp = D("meta_pause_adset", { adset_id: "as_deficit" }) as any;
  expectEqual("meta_pause_adset : before = statut", mp?.beforeValue, { status: "ACTIVE" });
  expectEqual("meta_pause_adset : after = PAUSED", mp?.afterValue, { status: "PAUSED" });
  expectRefused(
    "meta_pause_adset : adset rentable",
    () => V("meta_pause_adset", { adset_id: "as_rentable" }),
    "rapporte plus qu'il ne coûte",
  );
  expectRefused(
    "meta_pause_adset : dépense insuffisante",
    () => V("meta_pause_adset", { adset_id: "as_jeune" }),
    "trop peu pour conclure",
  );

  console.log("--- Google Ads ---");
  const gb = D("google_update_budget", {
    budget_resource_name: "customers/1234567890/campaignBudgets/10",
    daily_budget: 60,
  }) as any;
  expectEqual("google_update_budget : before", gb?.beforeValue, { daily_budget: 30 });
  expectRefused(
    "google_update_budget : 30 -> 61 (au-delà de ×2)",
    () =>
      V("google_update_budget", {
        budget_resource_name: "customers/1234567890/campaignBudgets/10",
        daily_budget: 61,
      }),
    "Hausse de budget refusée",
  );

  const gp = D("google_pause_campaign", {
    campaign_resource_name: "customers/1234567890/campaigns/1",
  }) as any;
  expectEqual("google_pause_campaign : before = statut", gp?.beforeValue, { status: "ENABLED" });
  expectRefused(
    "google_pause_campaign : campagne qui convertit",
    () =>
      V("google_pause_campaign", { campaign_resource_name: "customers/1234567890/campaigns/2" }),
    "qui convertit",
  );
  expectRefused(
    "google_pause_campaign : campagne inexistante",
    () =>
      V("google_pause_campaign", { campaign_resource_name: "customers/1234567890/campaigns/99" }),
    "introuvable",
  );

  const gk = D("google_add_negative_keywords", {
    campaign_resource_name: "customers/1234567890/campaigns/1",
    keywords: ["gratuit", "occasion"],
  }) as any;
  expectEqual(
    "google_add_negative_keywords : action additive, aucun état écrasé",
    gk?.beforeValue,
    {},
  );

  const rsa = D("google_update_rsa", {
    ad_group_ad_resource_name: "customers/1234567890/adGroupAds/1~1",
    headlines: ["H1", "H2", "H3"],
    descriptions: ["D1", "D2"],
  }) as any;
  expectEqual("google_update_rsa : before = textes actuels", rsa?.beforeValue, {
    headlines: ["A", "B", "C"],
    descriptions: ["D1", "D2"],
  });

  console.log("--- Réversibilité annoncée dans l'aperçu ---");
  const expected: Record<string, boolean> = {
    update_product: true,
    create_discount_code: true,
    meta_update_budget: true,
    meta_pause_adset: true,
    google_update_budget: true,
    google_pause_campaign: true,
    google_add_negative_keywords: false,
    meta_update_targeting: false,
    meta_update_creative: false,
    google_update_rsa: false,
  };
  for (const [tool, want] of Object.entries(expected)) {
    expectEqual(`isRevertible(${tool})`, isRevertible(tool), want);
  }
});
