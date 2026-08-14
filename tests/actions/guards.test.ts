/**
 * Vérification exécutable ponctuelle des garde-fous (hors dépôt, non commitée).
 * Ne remplace pas une vraie suite de tests : cadré priorité n°9.
 */
import {
  guardDailyBudget,
  guardDiscount,
  guardGooglePause,
  guardMetaPause,
  guardTargetExists,
  isKnownTool,
  parseToolArgs,
} from "../../src/lib/action-guards";
import { defineSuite } from "../../tests/harness";

export default defineSuite("Actions — garde-fous sur les écritures", async (t) => {
  const budget = (current: number | null, requested: number) =>
    guardDailyBudget({
      targetLabel: "cible",
      currency: "USD",
      requested,
      currentDailyBudget: current,
    }).ok;

  // --- Budget : plafond ×2, plafond absolu 100 €, plancher 5 € ---
  t.check("budget 20 -> 40 (×2 pile)", budget(20, 40), true);
  t.check("budget 20 -> 41 (au-delà de ×2)", budget(20, 41), false);
  t.check("budget 20 -> 50", budget(20, 50), false);
  t.check("budget 20 -> 4 (sous le plancher)", budget(20, 4), false);
  t.check("budget 20 -> 5 (plancher pile)", budget(20, 5), true);
  t.check("budget 80 -> 100 (plafond absolu pile)", budget(80, 100), true);
  t.check("budget 80 -> 101 (au-delà du plafond absolu)", budget(80, 101), false);
  t.check("budget 60 -> 120 (×2 mais > plafond absolu)", budget(60, 120), false);
  t.check("budget 200 -> 150 (BAISSE au-dessus du plafond)", budget(200, 150), true);
  t.check("budget 200 -> 250 (hausse)", budget(200, 250), false);
  t.check("budget actuel inconnu", budget(null, 20), false);
  t.check("budget actuel à 0", budget(0, 20), false);

  // --- Pause Meta : dépense >= 50 € ET ROAS < 1 ---
  const metaPause = (spend: number | undefined, roas: number | undefined) =>
    guardMetaPause({ targetLabel: "adset", spend, roas }).ok;
  t.check("meta pause : 100 € / ROAS 0.5", metaPause(100, 0.5), true);
  t.check("meta pause : 100 € / ROAS absent (=> 0 achat)", metaPause(100, undefined), true);
  t.check("meta pause : 100 € / ROAS 1 (rentable)", metaPause(100, 1), false);
  t.check("meta pause : 100 € / ROAS 2", metaPause(100, 2), false);
  t.check("meta pause : 49 € (dépense insuffisante)", metaPause(49, 0), false);
  t.check("meta pause : 50 € pile", metaPause(50, 0), true);
  t.check("meta pause : dépense inconnue", metaPause(undefined, 0), false);

  // --- Pause Google : coût >= 50 € ET conversions == 0 ---
  const gPause = (cost: number | null, conv: number | null) =>
    guardGooglePause({ targetLabel: "campagne", cost30d: cost, conversions30d: conv }).ok;
  t.check("google pause : 100 € / 0 conv", gPause(100, 0), true);
  t.check("google pause : 100 € / 1 conv", gPause(100, 1), false);
  t.check("google pause : 100 € / 0.5 conv", gPause(100, 0.5), false);
  t.check("google pause : 20 € / 0 conv", gPause(20, 0), false);
  t.check("google pause : coût inconnu", gPause(null, 0), false);
  t.check("google pause : conversions inconnues", gPause(100, null), false);

  // --- Remise : 5-25 %, 3-30 jours, sans clamp ---
  const disc = (percentage: number, days: number) => guardDiscount({ percentage, days }).ok;
  t.check("remise 20 % / 10 j", disc(20, 10), true);
  t.check("remise 90 % (refus, pas de clamp)", disc(90, 10), false);
  t.check("remise 1 %", disc(1, 10), false);
  t.check("remise 20 % / 60 j", disc(20, 60), false);
  t.check("remise 20 % / 0 j", disc(20, 0), false);
  t.check("remise 20 % / 10.5 j (non entier)", disc(20, 10.5), false);

  // --- Validation des arguments du modèle ---
  const p = (tool: any, args: unknown) => parseToolArgs(tool, args).ok;
  t.check(
    "budget en chaîne « 42 »",
    p("meta_update_budget", { adset_id: "a1", daily_budget: "42" }),
    true,
  );
  t.check(
    "budget chaîne vide",
    p("meta_update_budget", { adset_id: "a1", daily_budget: "" }),
    false,
  );
  t.check(
    "budget non numérique",
    p("meta_update_budget", { adset_id: "a1", daily_budget: "beaucoup" }),
    false,
  );
  t.check("adset_id manquant", p("meta_update_budget", { daily_budget: 20 }), false);
  t.check(
    "product_id = 0",
    p("update_product", { product_id: 0, title: "t", body_html: "<p>x</p>" }),
    false,
  );
  t.check(
    "update_product valide",
    p("update_product", { product_id: 12, title: "t", body_html: "<p>x</p>" }),
    true,
  );
  t.check(
    "update_product titre vide",
    p("update_product", { product_id: 12, title: "  ", body_html: "<p>x</p>" }),
    false,
  );
  t.check(
    "RSA valide",
    p("google_update_rsa", {
      ad_group_ad_resource_name: "r",
      headlines: ["a", "b", "c"],
      descriptions: ["d1", "d2"],
    }),
    true,
  );
  t.check(
    "RSA : 2 titres seulement",
    p("google_update_rsa", {
      ad_group_ad_resource_name: "r",
      headlines: ["a", "b"],
      descriptions: ["d1", "d2"],
    }),
    false,
  );
  t.check(
    "RSA : titre de 31 caractères",
    p("google_update_rsa", {
      ad_group_ad_resource_name: "r",
      headlines: ["x".repeat(31), "b", "c"],
      descriptions: ["d1", "d2"],
    }),
    false,
  );
  t.check(
    "21 mots-clés à exclure",
    p("google_add_negative_keywords", {
      campaign_resource_name: "c",
      keywords: Array.from({ length: 21 }, (_, i) => `k${i}`),
    }),
    false,
  );
  t.check("résumé absent (cosmétique) toléré", p("meta_pause_adset", { adset_id: "a1" }), true);
  t.check("no_action sans motif", p("no_action", {}), false);
  t.check("outil inconnu", isKnownTool("rm_rf"), false);
  t.check("outil connu", isKnownTool("meta_pause_adset"), true);
  t.check("cible absente", guardTargetExists(null, "La campagne").ok, false);
  t.check("cible présente", guardTargetExists({ id: 1 }, "La campagne").ok, true);
});
