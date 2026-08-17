import { currencyLabel, formatMoney } from "@/lib/currency";
import {
  createDiscountCode,
  getToken,
  listProducts,
  updateProduct,
  type ShopifyProduct,
} from "@/lib/connectors/shopify-apply.server";
import {
  fetchMetaSnapshot,
  metaAdsManagerUrl,
  metaPauseAdSet,
  metaToken,
  metaUpdateAdCreative,
  metaUpdateBudget,
  metaUpdateTargeting,
  type MetaAd,
  type MetaAdSet,
  type MetaSnapshot,
} from "@/lib/connectors/meta-apply.server";
import {
  fetchGoogleSnapshot,
  googleAccessToken,
  googleAddNegativeKeywords,
  googleAdsUrl,
  googlePauseCampaign,
  googleUpdateBudget,
  googleUpdateRsaText,
  type GoogleCampaign,
  type GoogleRsa,
  type GoogleSnapshot,
} from "@/lib/connectors/google-apply.server";
import {
  guardDailyBudget,
  guardDiscount,
  guardGooglePause,
  guardMetaPause,
  guardTargetExists,
  isKnownTool,
  parseToolArgs,
  unwrapGuard,
  type ToolArgs,
  type ToolName,
} from "@/lib/action-guards";
import {
  isRevertible,
  sameActionState,
  type ActionChannel,
  type PreviewLine,
} from "@/lib/action-plan";

const APPLY_MODEL = "google/gemini-2.5-flash";

const SYSTEM_PROMPT = `Tu es EcomPilot AI, directeur e-commerce senior avec un accès en ÉCRITURE aux outils de l'utilisateur (boutique Shopify, compte Meta Ads, compte Google Ads).

On te donne : un problème identifié lors d'un audit, le contexte de la boutique et l'état réel des canaux connectés.

Ta mission : APPLIQUER la correction toi-même en appelant l'outil adapté au canal concerné. Tu n'expliques pas, tu agis. Une seule action, la plus rentable.

Choix du canal :
- Problème de fiche produit, d'offre, de prix, de conversion boutique -> outils Shopify.
- Problème d'acquisition payante, de créa publicitaire, de ciblage, de budget, de ROAS -> outils Meta Ads ou Google Ads selon le canal réellement connecté et concerné.
- no_action seulement si aucun outil connecté ne peut régler ce problème.

RÈGLES Shopify :
- Titre clair, orienté bénéfice, max 70 caractères.
- body_html complet : accroche, <ul> de 5 bénéfices, paragraphe rassurance, mini FAQ en 3 questions. Vouvoiement, zéro placeholder.
- Codes promo : code en MAJUSCULES, remise 5-25%, durée 3-30 jours.

RÈGLES Meta Ads :
- Ne coupe un ensemble de pubs que s'il a dépensé sans conversions (ROAS < 1 sur dépense significative).
- Budget : variation raisonnable (-50% à +100% du budget actuel), jamais sous 5 / jour
  dans la devise du compte publicitaire indiquée ci-dessous.
- Créa : texte principal accrocheur (max 125 caractères idéalement), titre max 40 caractères, français impeccable, bénéfice + preuve + appel à l'action.
- Ciblage : n'élargis/resserre que si les données le justifient (CTR faible, CPC élevé).

RÈGLES Google Ads :
- Titres RSA max 30 caractères, descriptions max 90 caractères, au moins 5 titres et 2 descriptions.
- Mots-clés à exclure : uniquement des requêtes clairement non acheteuses (gratuit, occasion, emploi, avis, pdf...).
- Budget : jamais sous 5 / jour, dans la devise du compte publicitaire indiquée ci-dessous.`;

export type ApplyResult = {
  action: string;
  summary: string;
  detail?: string;
  adminUrl?: string;
  channel?: "shopify" | "meta_ads" | "google_ads" | "none";
  /**
   * Réversibilité RÉELLE, constatée après l'écriture, et données nécessaires à
   * l'annulation. `supported` ne vaut `true` que si l'information indispensable a
   * effectivement été obtenue — jamais sur la foi d'une hypothèse.
   */
  revert?: { supported: boolean; data: Record<string, unknown> };
};

type Tool = {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
};

function tool(
  name: string,
  description: string,
  props: Record<string, unknown>,
  required: string[],
): Tool {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", additionalProperties: false, properties: props, required },
    },
  };
}

const S = { type: "string" };
const N = { type: "number" };

export type ApplyContext = {
  store: { name: string; niche: string | null; url: string | null };
  finding: {
    category: string;
    severity: string;
    title: string;
    root_cause: string | null;
    impact_description: string | null;
  };
  shopify?: { shop: string; encryptedToken: string };
  meta?: { accountId: string; encryptedToken: string };
  google?: { customerId: string; encryptedRefreshToken: string };
};

// ---------------------------------------------------------------------------
// État réel des canaux — collecté à la proposition ET à la confirmation.
// C'est ce qui permet de re-vérifier la fraîcheur avant d'écrire.
// ---------------------------------------------------------------------------

type ChannelState = {
  shopifyToken: string | null;
  products: ShopifyProduct[];
  metaTok: string | null;
  metaSnap: MetaSnapshot | null;
  googleTok: string | null;
  googleSnap: GoogleSnapshot | null;
};

export async function collectChannelState(ctx: ApplyContext): Promise<ChannelState> {
  const state: ChannelState = {
    shopifyToken: null,
    products: [],
    metaTok: null,
    metaSnap: null,
    googleTok: null,
    googleSnap: null,
  };

  if (ctx.shopify) {
    state.shopifyToken = getToken(ctx.shopify.encryptedToken);
    state.products = await listProducts(ctx.shopify.shop, state.shopifyToken, 20).catch(() => []);
  }

  if (ctx.meta) {
    state.metaTok = metaToken(ctx.meta.encryptedToken);
    state.metaSnap = await fetchMetaSnapshot(ctx.meta.accountId, state.metaTok).catch(() => null);
  }

  if (ctx.google) {
    state.googleTok = await googleAccessToken(ctx.google.encryptedRefreshToken).catch(() => null);
    if (state.googleTok) {
      state.googleSnap = await fetchGoogleSnapshot(ctx.google.customerId, state.googleTok).catch(
        () => null,
      );
    }
  }

  return state;
}

function buildToolsAndContext(
  ctx: ApplyContext,
  state: ChannelState,
): { tools: Tool[]; contextBlocks: string[] } {
  const tools: Tool[] = [];
  const contextBlocks: string[] = [];

  if (ctx.shopify) {
    contextBlocks.push(
      `SHOPIFY (${ctx.shopify.shop}) — produits :\n` +
        (state.products.length
          ? state.products
              .map(
                (p) =>
                  `- id ${p.id} | "${p.title}" | prix ${p.price ?? "?"} | description : ${(
                    p.body_html ?? "(vide)"
                  )
                    .replace(/<[^>]+>/g, " ")
                    .slice(0, 160)}`,
              )
              .join("\n")
          : "(aucun produit)"),
    );
    tools.push(
      tool(
        "update_product",
        "Réécrit le titre et la description d'un produit Shopify",
        { product_id: N, title: S, body_html: S, summary: S },
        ["product_id", "title", "body_html", "summary"],
      ),
      tool(
        "create_discount_code",
        "Crée un vrai code promo dans la boutique Shopify",
        { title: S, code: S, percentage: N, days: N, summary: S },
        ["title", "code", "percentage", "days", "summary"],
      ),
    );
  }

  const metaSnap = state.metaSnap;
  if (ctx.meta && metaSnap) {
    // La devise du compte accompagne chaque montant : le modèle propose des
    // budgets chiffrés, il doit savoir dans quelle unité il raisonne.
    const metaCur = currencyLabel(metaSnap.currency);
    contextBlocks.push(
      `META ADS (${ctx.meta.accountId}, devise ${metaCur}) — ensembles de pubs (30j) :\n` +
        (metaSnap.adsets.length
          ? metaSnap.adsets
              .map(
                (a) =>
                  `- adset ${a.id} | "${a.name}" | ${a.status} | budget/j ${a.daily_budget ?? "?"} ${metaCur} | dépense ${
                    a.spend ?? 0
                  } ${metaCur} | achats ${a.purchases ?? 0} | ROAS ${a.roas ?? 0} | CTR ${a.ctr ?? 0}% | CPC ${
                    a.cpc ?? 0
                  } ${metaCur} | ciblage : ${a.targeting_summary}`,
              )
              .join("\n")
          : "(aucun ensemble de pubs)") +
        `\nPublicités :\n` +
        (metaSnap.ads.length
          ? metaSnap.ads
              .map(
                (a) =>
                  `- ad ${a.id} | "${a.name}" | ${a.status} | titre : ${a.headline ?? "(vide)"} | texte : ${(
                    a.primary_text ?? "(vide)"
                  ).slice(0, 140)}`,
              )
              .join("\n")
          : "(aucune publicité)"),
    );
    tools.push(
      tool(
        "meta_update_budget",
        "Change le budget quotidien d'un ensemble de publicités Meta",
        { adset_id: S, daily_budget: N, summary: S },
        ["adset_id", "daily_budget", "summary"],
      ),
      tool(
        "meta_pause_adset",
        "Met en pause un ensemble de publicités Meta non rentable",
        { adset_id: S, summary: S },
        ["adset_id", "summary"],
      ),
      tool(
        "meta_update_targeting",
        "Ajuste le ciblage d'un ensemble de publicités Meta (âge, genres, pays)",
        {
          adset_id: S,
          age_min: N,
          age_max: N,
          genders: { type: "array", items: { type: "number" } },
          countries: { type: "array", items: { type: "string" } },
          summary: S,
        },
        ["adset_id", "summary"],
      ),
      tool(
        "meta_update_creative",
        "Réécrit la création d'une publicité Meta (texte principal, titre, description)",
        { ad_id: S, primary_text: S, headline: S, description: S, summary: S },
        ["ad_id", "primary_text", "headline", "summary"],
      ),
    );
  }

  const googleSnap = state.googleSnap;
  if (ctx.google && googleSnap) {
    const googleCur = currencyLabel(googleSnap.currency);
    contextBlocks.push(
      `GOOGLE ADS (${ctx.google.customerId}, devise ${googleCur}) — campagnes (30j) :\n` +
        (googleSnap.campaigns.length
          ? googleSnap.campaigns
              .map(
                (c) =>
                  `- campagne ${c.resource_name} | "${c.name}" | ${c.status} | ${c.channel} | budget ${
                    c.budget_resource_name ?? "?"
                  } (${c.daily_budget ?? "?"} ${googleCur}/j) | coût ${c.cost_30d} ${googleCur} | clics ${c.clicks_30d} | conversions ${
                    c.conversions_30d
                  } | CTR ${c.ctr_30d}`,
              )
              .join("\n")
          : "(aucune campagne)") +
        `\nAnnonces responsives :\n` +
        (googleSnap.ads.length
          ? googleSnap.ads
              .map(
                (a) =>
                  `- annonce ${a.resource_name} | campagne "${a.campaign_name}" | titres : ${a.headlines.join(
                    " / ",
                  )} | descriptions : ${a.descriptions.join(" / ")}`,
              )
              .join("\n")
          : "(aucune annonce responsive)"),
    );
    tools.push(
      tool(
        "google_update_budget",
        "Change le budget quotidien d'une campagne Google Ads",
        { budget_resource_name: S, daily_budget: N, summary: S },
        ["budget_resource_name", "daily_budget", "summary"],
      ),
      tool(
        "google_pause_campaign",
        "Met en pause une campagne Google Ads non rentable",
        { campaign_resource_name: S, summary: S },
        ["campaign_resource_name", "summary"],
      ),
      tool(
        "google_add_negative_keywords",
        "Ajoute des mots-clés à exclure sur une campagne Google Ads",
        {
          campaign_resource_name: S,
          keywords: { type: "array", items: { type: "string" } },
          summary: S,
        },
        ["campaign_resource_name", "keywords", "summary"],
      ),
      tool(
        "google_update_rsa",
        "Réécrit les titres et descriptions d'une annonce responsive Google Ads",
        {
          ad_group_ad_resource_name: S,
          headlines: { type: "array", items: { type: "string" } },
          descriptions: { type: "array", items: { type: "string" } },
          summary: S,
        },
        ["ad_group_ad_resource_name", "headlines", "descriptions", "summary"],
      ),
    );
  }

  tools.push(
    tool("no_action", "Aucun canal connecté ne peut régler ce problème", { reason: S }, ["reason"]),
  );

  return { tools, contextBlocks };
}

// ---------------------------------------------------------------------------
// Validation — exécutée à la proposition ET rejouée à la confirmation.
// La ligne `actions` étant modifiable par le client via PostgREST, rien de ce
// qui y est stocké n'est digne de confiance : tout repasse par ici avant écriture.
// ---------------------------------------------------------------------------

type ValidatedAction =
  | { kind: "update_product"; args: ToolArgs<"update_product">; product: ShopifyProduct }
  | {
      kind: "create_discount_code";
      args: ToolArgs<"create_discount_code">;
      discount: { percentage: number; days: number };
    }
  | {
      kind: "meta_update_budget";
      args: ToolArgs<"meta_update_budget">;
      adset: MetaAdSet;
      budget: number;
      /** Devise du compte publicitaire, pour formater les montants en aval. */
      currency: string | null;
    }
  | {
      kind: "meta_pause_adset";
      args: ToolArgs<"meta_pause_adset">;
      adset: MetaAdSet;
      evidence: { spend: number; roas: number };
      /** Devise du compte publicitaire, pour formater les montants en aval. */
      currency: string | null;
    }
  | { kind: "meta_update_targeting"; args: ToolArgs<"meta_update_targeting">; adset: MetaAdSet }
  | { kind: "meta_update_creative"; args: ToolArgs<"meta_update_creative">; ad: MetaAd }
  | {
      kind: "google_update_budget";
      args: ToolArgs<"google_update_budget">;
      campaign: GoogleCampaign;
      budget: number;
      /** Devise du compte publicitaire, pour formater les montants en aval. */
      currency: string | null;
    }
  | {
      kind: "google_pause_campaign";
      args: ToolArgs<"google_pause_campaign">;
      campaign: GoogleCampaign;
      evidence: { cost: number; conversions: number };
      /** Devise du compte publicitaire, pour formater les montants en aval. */
      currency: string | null;
    }
  | {
      kind: "google_add_negative_keywords";
      args: ToolArgs<"google_add_negative_keywords">;
      campaign: GoogleCampaign;
    }
  | { kind: "google_update_rsa"; args: ToolArgs<"google_update_rsa">; ad: GoogleRsa };

function channelUnavailable(label: string): Error {
  return new Error(`L'IA a visé ${label}, qui n'est pas connecté. Rien n'a été modifié.`);
}

export function validateAgainstState(
  ctx: ApplyContext,
  state: ChannelState,
  toolName: Exclude<ToolName, "no_action">,
  rawArgs: unknown,
): ValidatedAction {
  switch (toolName) {
    case "update_product": {
      if (!ctx.shopify || !state.shopifyToken) throw channelUnavailable("Shopify");
      const args = unwrapGuard(parseToolArgs(toolName, rawArgs));
      const product = unwrapGuard(
        guardTargetExists(
          state.products.find((p) => p.id === args.product_id) ?? null,
          `Le produit ${args.product_id}`,
        ),
      );
      return { kind: toolName, args, product };
    }

    case "create_discount_code": {
      if (!ctx.shopify || !state.shopifyToken) throw channelUnavailable("Shopify");
      const args = unwrapGuard(parseToolArgs(toolName, rawArgs));
      const discount = unwrapGuard(guardDiscount({ percentage: args.percentage, days: args.days }));
      return { kind: toolName, args, discount };
    }

    case "meta_update_budget": {
      if (!ctx.meta || !state.metaTok || !state.metaSnap) throw channelUnavailable("Meta Ads");
      const args = unwrapGuard(parseToolArgs(toolName, rawArgs));
      const adset = unwrapGuard(
        guardTargetExists(
          state.metaSnap.adsets.find((a) => a.id === args.adset_id) ?? null,
          `L'ensemble de publicités ${args.adset_id}`,
        ),
      );
      const budget = unwrapGuard(
        guardDailyBudget({
          targetLabel: `« ${adset.name} »`,
          // Les seuils s'appliquent aux montants tels que Meta les renvoie,
          // donc dans la devise du compte publicitaire.
          currency: state.metaSnap.currency,
          requested: args.daily_budget,
          currentDailyBudget: adset.daily_budget,
        }),
      );
      return { kind: toolName, args, adset, budget, currency: state.metaSnap.currency };
    }

    case "meta_pause_adset": {
      if (!ctx.meta || !state.metaTok || !state.metaSnap) throw channelUnavailable("Meta Ads");
      const args = unwrapGuard(parseToolArgs(toolName, rawArgs));
      const adset = unwrapGuard(
        guardTargetExists(
          state.metaSnap.adsets.find((a) => a.id === args.adset_id) ?? null,
          `L'ensemble de publicités ${args.adset_id}`,
        ),
      );
      const evidence = unwrapGuard(
        guardMetaPause({
          targetLabel: `« ${adset.name} »`,
          currency: state.metaSnap.currency,
          spend: adset.spend,
          roas: adset.roas,
        }),
      );
      return { kind: toolName, args, adset, evidence, currency: state.metaSnap.currency };
    }

    case "meta_update_targeting": {
      if (!ctx.meta || !state.metaTok || !state.metaSnap) throw channelUnavailable("Meta Ads");
      const args = unwrapGuard(parseToolArgs(toolName, rawArgs));
      const adset = unwrapGuard(
        guardTargetExists(
          state.metaSnap.adsets.find((a) => a.id === args.adset_id) ?? null,
          `L'ensemble de publicités ${args.adset_id}`,
        ),
      );
      return { kind: toolName, args, adset };
    }

    case "meta_update_creative": {
      if (!ctx.meta || !state.metaTok || !state.metaSnap) throw channelUnavailable("Meta Ads");
      const args = unwrapGuard(parseToolArgs(toolName, rawArgs));
      const ad = unwrapGuard(
        guardTargetExists(
          state.metaSnap.ads.find((a) => a.id === args.ad_id) ?? null,
          `La publicité ${args.ad_id}`,
        ),
      );
      return { kind: toolName, args, ad };
    }

    case "google_update_budget": {
      if (!ctx.google || !state.googleTok || !state.googleSnap)
        throw channelUnavailable("Google Ads");
      const args = unwrapGuard(parseToolArgs(toolName, rawArgs));
      const campaign = unwrapGuard(
        guardTargetExists(
          state.googleSnap.campaigns.find(
            (c) => c.budget_resource_name === args.budget_resource_name,
          ) ?? null,
          "La campagne visée",
        ),
      );
      const budget = unwrapGuard(
        guardDailyBudget({
          targetLabel: `« ${campaign.name} »`,
          currency: state.googleSnap.currency,
          requested: args.daily_budget,
          currentDailyBudget: campaign.daily_budget,
        }),
      );
      return { kind: toolName, args, campaign, budget, currency: state.googleSnap.currency };
    }

    case "google_pause_campaign": {
      if (!ctx.google || !state.googleTok || !state.googleSnap)
        throw channelUnavailable("Google Ads");
      const args = unwrapGuard(parseToolArgs(toolName, rawArgs));
      const campaign = unwrapGuard(
        guardTargetExists(
          state.googleSnap.campaigns.find((c) => c.resource_name === args.campaign_resource_name) ??
            null,
          "La campagne visée",
        ),
      );
      const evidence = unwrapGuard(
        guardGooglePause({
          targetLabel: `« ${campaign.name} »`,
          currency: state.googleSnap.currency,
          cost30d: campaign.cost_30d,
          conversions30d: campaign.conversions_30d,
        }),
      );
      return { kind: toolName, args, campaign, evidence, currency: state.googleSnap.currency };
    }

    case "google_add_negative_keywords": {
      if (!ctx.google || !state.googleTok || !state.googleSnap)
        throw channelUnavailable("Google Ads");
      const args = unwrapGuard(parseToolArgs(toolName, rawArgs));
      const campaign = unwrapGuard(
        guardTargetExists(
          state.googleSnap.campaigns.find((c) => c.resource_name === args.campaign_resource_name) ??
            null,
          "La campagne visée",
        ),
      );
      return { kind: toolName, args, campaign };
    }

    case "google_update_rsa": {
      if (!ctx.google || !state.googleTok || !state.googleSnap)
        throw channelUnavailable("Google Ads");
      const args = unwrapGuard(parseToolArgs(toolName, rawArgs));
      const ad = unwrapGuard(
        guardTargetExists(
          state.googleSnap.ads.find((a) => a.resource_name === args.ad_group_ad_resource_name) ??
            null,
          "L'annonce responsive visée",
        ),
      );
      return { kind: toolName, args, ad };
    }
  }
}

// ---------------------------------------------------------------------------
// Description d'une action validée : ce qui est montré à l'utilisateur, et ce
// qui sert d'empreinte de fraîcheur (`beforeValue`).
// ---------------------------------------------------------------------------

export type ActionDescription = {
  channel: ActionChannel;
  title: string;
  targetRef: string;
  targetLabel: string;
  /** État exact que l'écriture va écraser. Sert aussi d'empreinte de fraîcheur. */
  beforeValue: Record<string, unknown> | null;
  afterValue: Record<string, unknown>;
  lines: PreviewLine[];
};

function stripHtml(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function excerpt(value: string, max = 220): string {
  const clean = value.trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export function describeValidated(v: ValidatedAction): ActionDescription {
  switch (v.kind) {
    case "update_product":
      return {
        channel: "shopify",
        title: "Réécrire la fiche produit",
        targetRef: String(v.product.id),
        targetLabel: `Produit « ${v.product.title} »`,
        beforeValue: { title: v.product.title, body_html: v.product.body_html },
        afterValue: { title: v.args.title, body_html: v.args.body_html },
        lines: [
          { label: "Titre", before: v.product.title, after: v.args.title },
          {
            label: "Description",
            before: excerpt(stripHtml(v.product.body_html)) || "(vide)",
            after: excerpt(stripHtml(v.args.body_html)),
          },
        ],
      };

    case "create_discount_code":
      return {
        channel: "shopify",
        title: "Créer un code promo",
        targetRef: v.args.code.toUpperCase().replace(/\s+/g, ""),
        targetLabel: "Boutique Shopify",
        beforeValue: null,
        afterValue: {
          code: v.args.code.toUpperCase().replace(/\s+/g, ""),
          percentage: v.discount.percentage,
          days: v.discount.days,
        },
        lines: [
          {
            label: "Code promo",
            before: null,
            after: `${v.args.code.toUpperCase().replace(/\s+/g, "")} — ${v.discount.percentage} % pendant ${v.discount.days} jours`,
          },
        ],
      };

    case "meta_update_budget":
      return {
        channel: "meta_ads",
        title: "Changer le budget quotidien",
        targetRef: v.adset.id,
        targetLabel: `Ensemble de publicités « ${v.adset.name} »`,
        beforeValue: { daily_budget: v.adset.daily_budget },
        afterValue: { daily_budget: v.budget },
        lines: [
          {
            label: "Budget quotidien",
            before: formatMoney(v.adset.daily_budget, v.currency),
            after: formatMoney(v.budget, v.currency),
          },
        ],
      };

    case "meta_pause_adset":
      return {
        channel: "meta_ads",
        title: "Mettre en pause l'ensemble de publicités",
        targetRef: v.adset.id,
        targetLabel: `Ensemble de publicités « ${v.adset.name} »`,
        beforeValue: { status: v.adset.status },
        afterValue: { status: "PAUSED" },
        lines: [
          { label: "Statut", before: v.adset.status, after: "PAUSED (en pause)" },
          {
            label: "Justification mesurée",
            before: null,
            after: `${formatMoney(v.evidence.spend, v.currency)} dépensés sur 30 jours, ROAS ${v.evidence.roas.toFixed(2)}`,
          },
        ],
      };

    case "meta_update_targeting":
      return {
        channel: "meta_ads",
        title: "Ajuster le ciblage",
        targetRef: v.adset.id,
        targetLabel: `Ensemble de publicités « ${v.adset.name} »`,
        beforeValue: { targeting_summary: v.adset.targeting_summary },
        afterValue: {
          age_min: v.args.age_min ?? null,
          age_max: v.args.age_max ?? null,
          genders: v.args.genders ?? null,
          countries: v.args.countries ?? null,
        },
        lines: [
          {
            label: "Ciblage",
            before: v.adset.targeting_summary,
            after:
              [
                v.args.age_min || v.args.age_max
                  ? `âge ${v.args.age_min ?? "?"}-${v.args.age_max ?? "?"}`
                  : null,
                v.args.countries?.length ? `pays ${v.args.countries.join(", ")}` : null,
                v.args.genders?.length ? `genres ${v.args.genders.join(", ")}` : null,
              ]
                .filter(Boolean)
                .join(" | ") || "(inchangé)",
          },
        ],
      };

    case "meta_update_creative":
      return {
        channel: "meta_ads",
        title: "Réécrire la publicité",
        targetRef: v.ad.id,
        targetLabel: `Publicité « ${v.ad.name} »`,
        beforeValue: { primary_text: v.ad.primary_text, headline: v.ad.headline },
        afterValue: {
          primary_text: v.args.primary_text,
          headline: v.args.headline,
          description: v.args.description ?? null,
        },
        lines: [
          { label: "Titre", before: v.ad.headline ?? "(vide)", after: v.args.headline },
          {
            label: "Texte principal",
            before: excerpt(v.ad.primary_text ?? "") || "(vide)",
            after: excerpt(v.args.primary_text),
          },
        ],
      };

    case "google_update_budget":
      return {
        channel: "google_ads",
        title: "Changer le budget quotidien",
        targetRef: v.args.budget_resource_name,
        targetLabel: `Campagne « ${v.campaign.name} »`,
        beforeValue: { daily_budget: v.campaign.daily_budget },
        afterValue: { daily_budget: v.budget },
        lines: [
          {
            label: "Budget quotidien",
            before: formatMoney(v.campaign.daily_budget, v.currency),
            after: formatMoney(v.budget, v.currency),
          },
        ],
      };

    case "google_pause_campaign":
      return {
        channel: "google_ads",
        title: "Mettre en pause la campagne",
        targetRef: v.campaign.resource_name,
        targetLabel: `Campagne « ${v.campaign.name} »`,
        beforeValue: { status: v.campaign.status },
        afterValue: { status: "PAUSED" },
        lines: [
          { label: "Statut", before: v.campaign.status, after: "PAUSED (en pause)" },
          {
            label: "Justification mesurée",
            before: null,
            after: `${formatMoney(v.evidence.cost, v.currency)} dépensés sur 30 jours, 0 conversion`,
          },
        ],
      };

    case "google_add_negative_keywords":
      return {
        channel: "google_ads",
        title: "Ajouter des mots-clés à exclure",
        targetRef: v.campaign.resource_name,
        targetLabel: `Campagne « ${v.campaign.name} »`,
        // Action additive : aucun état écrasé, donc aucune contrainte de fraîcheur.
        beforeValue: {},
        afterValue: { keywords: v.args.keywords },
        lines: [
          { label: "Mots-clés exclus ajoutés", before: null, after: v.args.keywords.join(", ") },
        ],
      };

    case "google_update_rsa":
      return {
        channel: "google_ads",
        title: "Réécrire l'annonce responsive",
        targetRef: v.ad.resource_name,
        targetLabel: `Annonce de la campagne « ${v.ad.campaign_name} »`,
        beforeValue: { headlines: v.ad.headlines, descriptions: v.ad.descriptions },
        afterValue: { headlines: v.args.headlines, descriptions: v.args.descriptions },
        lines: [
          {
            label: "Titres",
            before: v.ad.headlines.join(" / ") || "(vide)",
            after: v.args.headlines.join(" / "),
          },
          {
            label: "Descriptions",
            before: v.ad.descriptions.join(" / ") || "(vide)",
            after: v.args.descriptions.join(" / "),
          },
        ],
      };
  }
}

// ---------------------------------------------------------------------------
// Proposition — AUCUNE écriture externe sur ce chemin.
// ---------------------------------------------------------------------------

export type PlanOutcome =
  | { kind: "no_action"; reason: string }
  | {
      kind: "plan";
      tool: Exclude<ToolName, "no_action">;
      /** Arguments bruts du modèle, restockés tels quels et re-validés à la confirmation. */
      rawArgs: unknown;
      reason: string;
      revertible: boolean;
      description: ActionDescription;
    };

export async function planFixAcrossChannels(ctx: ApplyContext): Promise<PlanOutcome> {
  const { aiChatCompletion, aiModel } = await import("@/lib/ai-gateway.server");

  const state = await collectChannelState(ctx);
  const { tools, contextBlocks } = buildToolsAndContext(ctx, state);

  const userPrompt = `Boutique : ${ctx.store.name}
Niche : ${ctx.store.niche || "(non précisée)"}
URL : ${ctx.store.url || "(non fournie)"}

Problème à corriger (${ctx.finding.category}, sévérité ${ctx.finding.severity}) :
${ctx.finding.title}

Cause racine : ${ctx.finding.root_cause || "(non détaillée)"}
Impact : ${ctx.finding.impact_description || "(non détaillé)"}

État réel des canaux connectés :
${contextBlocks.join("\n\n") || "(aucun canal connecté)"}

Applique maintenant la correction en appelant l'outil le plus pertinent.`;

  const res = await aiChatCompletion({
    model: aiModel("fix"),
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    tools,
    tool_choice: "required",
  });

  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 429) throw new Error("Trop de demandes, réessaie dans une minute.");
    if (res.status === 402) throw new Error("Crédits IA épuisés.");
    throw new Error(`AI Gateway ${res.status}: ${errText}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{
      message?: { tool_calls?: Array<{ function: { name: string; arguments: string } }> };
    }>;
  };
  const call = json.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) throw new Error("L'IA n'a proposé aucune action. Réessayez.");

  const toolName = call.function.name;
  if (!isKnownTool(toolName)) {
    throw new Error(`L'IA a proposé un outil inconnu (${toolName}). Rien n'a été modifié.`);
  }

  let rawArgs: unknown;
  try {
    rawArgs = JSON.parse(call.function.arguments);
  } catch {
    throw new Error("Réponse IA illisible (arguments non JSON). Relancez la correction.");
  }

  if (toolName === "no_action") {
    const args = unwrapGuard(parseToolArgs(toolName, rawArgs));
    return { kind: "no_action", reason: args.reason };
  }

  const validated = validateAgainstState(ctx, state, toolName, rawArgs);
  const description = describeValidated(validated);
  const reason =
    (validated.args as { summary?: string }).summary ?? "Correction proposée par EcomPilot AI.";

  return {
    kind: "plan",
    tool: toolName,
    rawArgs,
    reason,
    revertible: isRevertible(toolName),
    description,
  };
}

// ---------------------------------------------------------------------------
// Exécution — seul chemin qui écrit réellement chez Shopify / Meta / Google.
// ---------------------------------------------------------------------------

async function writeValidated(
  ctx: ApplyContext,
  state: ChannelState,
  v: ValidatedAction,
  d: ActionDescription,
): Promise<ApplyResult> {
  const reason = (v.args as { summary?: string }).summary;

  switch (v.kind) {
    case "update_product": {
      const updated = await updateProduct(ctx.shopify!.shop, state.shopifyToken!, v.product.id, {
        title: v.args.title,
        body_html: v.args.body_html,
      });
      return {
        action: v.kind,
        channel: "shopify",
        summary: reason ?? "Fiche produit réécrite.",
        detail: `Produit mis à jour : « ${updated.title} »`,
        adminUrl: updated.adminUrl,
        // L'ancien titre et l'ancienne description sont dans before_value.
        revert: { supported: true, data: {} },
      };
    }

    case "create_discount_code": {
      const created = await createDiscountCode(ctx.shopify!.shop, state.shopifyToken!, {
        title: v.args.title,
        code: v.args.code.toUpperCase().replace(/\s+/g, ""),
        percentage: v.discount.percentage,
        days: v.discount.days,
      });
      return {
        action: v.kind,
        channel: "shopify",
        summary: reason ?? "Code promo créé.",
        detail: `Code promo créé : ${created.code} (−${v.discount.percentage} % pendant ${v.discount.days} jours)`,
        adminUrl: created.adminUrl,
        revert: {
          supported: Number.isInteger(created.priceRuleId) && created.priceRuleId > 0,
          data: { price_rule_id: created.priceRuleId },
        },
      };
    }

    case "meta_update_budget": {
      await metaUpdateBudget(v.adset.id, state.metaTok!, v.budget);
      return {
        action: v.kind,
        channel: "meta_ads",
        summary: reason ?? "Budget publicitaire ajusté.",
        detail: `Budget quotidien de « ${v.adset.name} » : ${formatMoney(v.adset.daily_budget, v.currency)} → ${formatMoney(v.budget, v.currency)}`,
        adminUrl: metaAdsManagerUrl(ctx.meta!.accountId),
        // guardDailyBudget garantit un budget antérieur connu et strictement positif.
        revert: { supported: v.adset.daily_budget != null, data: {} },
      };
    }

    case "meta_pause_adset": {
      await metaPauseAdSet(v.adset.id, state.metaTok!);
      return {
        action: v.kind,
        channel: "meta_ads",
        summary: reason ?? "Ensemble de publicités mis en pause.",
        detail: `« ${v.adset.name} » mis en pause : ${formatMoney(v.evidence.spend, v.currency)} dépensés sur 30 jours pour un ROAS de ${v.evidence.roas.toFixed(2)}`,
        adminUrl: metaAdsManagerUrl(ctx.meta!.accountId),
        // On ne sait rétablir que les statuts qu'on s'autorise à écrire.
        revert: { supported: v.adset.status === "ACTIVE", data: {} },
      };
    }

    case "meta_update_targeting": {
      const r = await metaUpdateTargeting(v.adset.id, state.metaTok!, {
        age_min: v.args.age_min,
        age_max: v.args.age_max,
        genders: v.args.genders,
        countries: v.args.countries,
      });
      return {
        action: v.kind,
        channel: "meta_ads",
        summary: reason ?? "Ciblage ajusté.",
        detail: `Nouveau ciblage de « ${v.adset.name} » : ${r.targeting_summary}`,
        adminUrl: metaAdsManagerUrl(ctx.meta!.accountId),
        // before_value ne contient qu'un résumé textuel du ciblage, pas l'objet
        // complet : impossible de rétablir l'état exact. On ne le promet donc pas.
        revert: { supported: false, data: {} },
      };
    }

    case "meta_update_creative": {
      const r = await metaUpdateAdCreative(v.ad.id, ctx.meta!.accountId, state.metaTok!, {
        primary_text: v.args.primary_text,
        headline: v.args.headline,
        description: v.args.description,
      });
      return {
        action: v.kind,
        channel: "meta_ads",
        summary: reason ?? "Création publicitaire réécrite.",
        detail: `Nouvelle création sur « ${v.ad.name} » — titre : « ${v.args.headline} »`,
        adminUrl: metaAdsManagerUrl(ctx.meta!.accountId),
        // L'ancienne création est tracée, mais rien ne prouve qu'elle reste
        // rattachable après détachement : on ne promet pas l'annulation.
        revert: {
          supported: false,
          data: { previous_creative_id: r.previousCreativeId, new_creative_id: r.creativeId },
        },
      };
    }

    case "google_update_budget": {
      await googleUpdateBudget(
        ctx.google!.customerId,
        state.googleTok!,
        v.args.budget_resource_name,
        v.budget,
      );
      return {
        action: v.kind,
        channel: "google_ads",
        summary: reason ?? "Budget publicitaire ajusté.",
        detail: `Budget quotidien de « ${v.campaign.name} » : ${formatMoney(v.campaign.daily_budget, v.currency)} → ${formatMoney(v.budget, v.currency)}`,
        adminUrl: googleAdsUrl(ctx.google!.customerId),
        revert: { supported: v.campaign.daily_budget != null, data: {} },
      };
    }

    case "google_pause_campaign": {
      await googlePauseCampaign(ctx.google!.customerId, state.googleTok!, v.campaign.resource_name);
      return {
        action: v.kind,
        channel: "google_ads",
        summary: reason ?? "Campagne mise en pause.",
        detail: `« ${v.campaign.name} » mise en pause : ${formatMoney(v.evidence.cost, v.currency)} dépensés sur 30 jours pour 0 conversion`,
        adminUrl: googleAdsUrl(ctx.google!.customerId),
        revert: { supported: v.campaign.status === "ENABLED", data: {} },
      };
    }

    case "google_add_negative_keywords": {
      const r = await googleAddNegativeKeywords(
        ctx.google!.customerId,
        state.googleTok!,
        v.campaign.resource_name,
        v.args.keywords,
      );
      return {
        action: v.kind,
        channel: "google_ads",
        summary: reason ?? "Mots-clés à exclure ajoutés.",
        detail: `Mots-clés exclus ajoutés sur « ${v.campaign.name} » : ${v.args.keywords.join(", ")}`,
        adminUrl: googleAdsUrl(ctx.google!.customerId),
        // Réversible seulement si l'API nous a réellement rendu les références des
        // critères créés. Liste vide = pas d'annulation promise.
        revert: {
          supported: r.createdResourceNames.length > 0,
          data: { criteria_resource_names: r.createdResourceNames },
        },
      };
    }

    case "google_update_rsa": {
      const r = await googleUpdateRsaText(
        ctx.google!.customerId,
        state.googleTok!,
        v.ad.resource_name,
        { headlines: v.args.headlines, descriptions: v.args.descriptions },
      );
      return {
        action: v.kind,
        channel: "google_ads",
        summary: reason ?? "Annonce réécrite.",
        detail: `Annonce de « ${d.targetLabel} » réécrite — ${r.headlines.length} titres, ${r.descriptions.length} descriptions`,
        adminUrl: googleAdsUrl(ctx.google!.customerId),
        // La mutabilité d'une annonce servie n'est pas démontrée : pas de promesse.
        revert: { supported: false, data: {} },
      };
    }
  }
}

/**
 * Exécute une action précédemment proposée.
 *
 * Rejoue l'intégralité de la validation contre un état FRAÎCHEMENT collecté, puis
 * vérifie que l'état qu'on s'apprête à écraser est bien celui montré à
 * l'utilisateur. Rien de ce qui vient de la base n'est exécuté tel quel.
 */
export async function executePlannedAction(
  ctx: ApplyContext,
  input: {
    tool: Exclude<ToolName, "no_action">;
    rawArgs: unknown;
    expectedBefore: Record<string, unknown> | null;
  },
): Promise<ApplyResult> {
  const state = await collectChannelState(ctx);
  const validated = validateAgainstState(ctx, state, input.tool, input.rawArgs);
  const description = describeValidated(validated);

  // Comparaison indépendante de l'ordre des clés : `expectedBefore` vient d'une
  // colonne jsonb, qui ne préserve pas l'ordre d'insertion. Les valeurs, elles,
  // restent comparées strictement.
  if (!sameActionState(description.beforeValue, input.expectedBefore)) {
    throw new Error(
      `${description.targetLabel} a changé depuis la proposition : nous n'écrasons pas une modification que vous n'avez pas vue. Rien n'a été modifié — relancez la correction pour repartir de l'état actuel.`,
    );
  }

  return writeValidated(ctx, state, validated, description);
}
