import { formatMoney } from "@/lib/currency";
/**
 * Annulation d'une action automatique déjà appliquée.
 *
 * Une annulation est une ÉCRITURE comme une autre : elle repasse par les mêmes
 * garde-fous que l'application. `before_value` et `after_value` proviennent de la
 * table `actions`, modifiable par le client via PostgREST — ils sont donc validés
 * par schéma, puis bornés (un budget « restauré » à 999 999 € est refusé).
 *
 * L'état courant est re-collecté avant chaque annulation : si la cible a changé
 * depuis l'application, on refuse plutôt que d'écraser une modification manuelle.
 */
import { collectChannelState, type ApplyContext } from "@/lib/apply-fix.server";
import {
  guardRestoreBudget,
  guardTargetExists,
  isRevertableTool,
  parseRevertPayload,
  unwrapGuard,
} from "@/lib/action-guards";
import { deletePriceRule, updateProduct } from "@/lib/connectors/shopify-apply.server";
import { metaAdsManagerUrl, metaSetAdSetStatus } from "@/lib/connectors/meta-apply.server";
import {
  googleAdsUrl,
  googleRemoveCampaignCriteria,
  googleSetCampaignStatus,
  googleUpdateBudget,
} from "@/lib/connectors/google-apply.server";
import { metaUpdateBudget } from "@/lib/connectors/meta-apply.server";

export type RevertResult = {
  tool: string;
  detail: string;
  adminUrl?: string;
};

/** Tolérance de comparaison des budgets : Meta et Google renvoient des arrondis. */
const BUDGET_EPSILON = 0.01;

function channelUnavailable(label: string): Error {
  return new Error(`${label} n'est plus connecté : impossible d'annuler. Rien n'a été modifié.`);
}

function changedSince(what: string): Error {
  return new Error(
    `${what} a changé depuis l'application : nous n'écrasons pas une modification que vous avez faite vous-même. Rien n'a été modifié.`,
  );
}

export async function executeRevert(
  ctx: ApplyContext,
  input: {
    tool: string;
    targetRef: string | null;
    beforeValue: unknown;
    afterValue: unknown;
  },
): Promise<RevertResult> {
  if (!isRevertableTool(input.tool)) {
    throw new Error(`L'action « ${input.tool} » ne peut pas être annulée automatiquement.`);
  }

  const state = await collectChannelState(ctx);
  const payload = { before: input.beforeValue, after: input.afterValue };

  switch (input.tool) {
    case "update_product": {
      if (!ctx.shopify || !state.shopifyToken) throw channelUnavailable("Shopify");
      const { before } = unwrapGuard(parseRevertPayload("update_product", payload));
      const productId = Number(input.targetRef);
      const product = unwrapGuard(
        guardTargetExists(
          state.products.find((p) => p.id === productId) ?? null,
          `Le produit ${input.targetRef}`,
        ),
      );
      // Pas de comparaison stricte du HTML : Shopify normalise le balisage, une
      // égalité exacte bloquerait des annulations légitimes.
      const restored = await updateProduct(ctx.shopify.shop, state.shopifyToken, product.id, {
        title: before.title,
        body_html: before.body_html,
      });
      return {
        tool: input.tool,
        detail: `Fiche produit rétablie : « ${restored.title} »`,
        adminUrl: restored.adminUrl,
      };
    }

    case "create_discount_code": {
      if (!ctx.shopify || !state.shopifyToken) throw channelUnavailable("Shopify");
      const { after } = unwrapGuard(parseRevertPayload("create_discount_code", payload));
      const result = await deletePriceRule(
        ctx.shopify.shop,
        state.shopifyToken,
        after.price_rule_id,
      );
      return {
        tool: input.tool,
        detail: result.alreadyGone
          ? "Le code promo n'existait déjà plus."
          : "Code promo supprimé de votre boutique.",
        adminUrl: `https://${ctx.shopify.shop}/admin/discounts`,
      };
    }

    case "meta_update_budget": {
      if (!ctx.meta || !state.metaTok || !state.metaSnap) throw channelUnavailable("Meta Ads");
      const { before } = unwrapGuard(parseRevertPayload("meta_update_budget", payload));
      const adset = unwrapGuard(
        guardTargetExists(
          state.metaSnap.adsets.find((a) => a.id === input.targetRef) ?? null,
          `L'ensemble de publicités ${input.targetRef}`,
        ),
      );
      const applied = (input.afterValue as { daily_budget?: number } | null)?.daily_budget;
      if (
        applied != null &&
        adset.daily_budget != null &&
        Math.abs(adset.daily_budget - applied) > BUDGET_EPSILON
      ) {
        throw changedSince(`Le budget de « ${adset.name} »`);
      }
      // Rétablir n'est pas augmenter : le budget antérieur est celui du marchand,
      // pas une valeur proposée par un modèle. Il ne repasse donc pas par le
      // plafond des hausses, qui rendait irréversible toute baisse partant d'un
      // budget déjà supérieur à ce plafond.
      const budget = unwrapGuard(
        guardRestoreBudget({
          targetLabel: `« ${adset.name} »`,
          currency: state.metaSnap.currency,
          previousDailyBudget: before.daily_budget,
        }),
      );
      await metaUpdateBudget(adset.id, state.metaTok, budget);
      return {
        tool: input.tool,
        detail: `Budget quotidien de « ${adset.name} » rétabli à ${formatMoney(budget, state.metaSnap.currency)}`,
        adminUrl: metaAdsManagerUrl(ctx.meta.accountId),
      };
    }

    case "meta_pause_adset": {
      if (!ctx.meta || !state.metaTok || !state.metaSnap) throw channelUnavailable("Meta Ads");
      const { before } = unwrapGuard(parseRevertPayload("meta_pause_adset", payload));
      const adset = unwrapGuard(
        guardTargetExists(
          state.metaSnap.adsets.find((a) => a.id === input.targetRef) ?? null,
          `L'ensemble de publicités ${input.targetRef}`,
        ),
      );
      if (adset.status !== "PAUSED") {
        throw changedSince(`Le statut de « ${adset.name} » (${adset.status})`);
      }
      await metaSetAdSetStatus(adset.id, state.metaTok, before.status);
      return {
        tool: input.tool,
        detail: `« ${adset.name} » rétabli au statut ${before.status}`,
        adminUrl: metaAdsManagerUrl(ctx.meta.accountId),
      };
    }

    case "google_update_budget": {
      if (!ctx.google || !state.googleTok || !state.googleSnap)
        throw channelUnavailable("Google Ads");
      const { before } = unwrapGuard(parseRevertPayload("google_update_budget", payload));
      const campaign = unwrapGuard(
        guardTargetExists(
          state.googleSnap.campaigns.find((c) => c.budget_resource_name === input.targetRef) ??
            null,
          "La campagne visée",
        ),
      );
      const applied = (input.afterValue as { daily_budget?: number } | null)?.daily_budget;
      if (
        applied != null &&
        campaign.daily_budget != null &&
        Math.abs(campaign.daily_budget - applied) > BUDGET_EPSILON
      ) {
        throw changedSince(`Le budget de « ${campaign.name} »`);
      }
      const budget = unwrapGuard(
        guardRestoreBudget({
          targetLabel: `« ${campaign.name} »`,
          currency: state.googleSnap.currency,
          previousDailyBudget: before.daily_budget,
        }),
      );
      await googleUpdateBudget(
        ctx.google.customerId,
        state.googleTok,
        input.targetRef as string,
        budget,
      );
      return {
        tool: input.tool,
        detail: `Budget quotidien de « ${campaign.name} » rétabli à ${formatMoney(budget, state.googleSnap.currency)}`,
        adminUrl: googleAdsUrl(ctx.google.customerId),
      };
    }

    case "google_pause_campaign": {
      if (!ctx.google || !state.googleTok || !state.googleSnap)
        throw channelUnavailable("Google Ads");
      const { before } = unwrapGuard(parseRevertPayload("google_pause_campaign", payload));
      const campaign = unwrapGuard(
        guardTargetExists(
          state.googleSnap.campaigns.find((c) => c.resource_name === input.targetRef) ?? null,
          "La campagne visée",
        ),
      );
      if (campaign.status !== "PAUSED") {
        throw changedSince(`Le statut de « ${campaign.name} » (${campaign.status})`);
      }
      await googleSetCampaignStatus(
        ctx.google.customerId,
        state.googleTok,
        campaign.resource_name,
        before.status,
      );
      return {
        tool: input.tool,
        detail: `« ${campaign.name} » rétablie au statut ${before.status}`,
        adminUrl: googleAdsUrl(ctx.google.customerId),
      };
    }

    case "google_add_negative_keywords": {
      if (!ctx.google || !state.googleTok) throw channelUnavailable("Google Ads");
      const { after } = unwrapGuard(parseRevertPayload("google_add_negative_keywords", payload));
      const removed = await googleRemoveCampaignCriteria(
        ctx.google.customerId,
        state.googleTok,
        after.criteria_resource_names,
      );
      return {
        tool: input.tool,
        detail: `${removed.removed} mot(s)-clé(s) à exclure retiré(s).`,
        adminUrl: googleAdsUrl(ctx.google.customerId),
      };
    }
  }
}
