import {
  createDiscountCode,
  getToken,
  listProducts,
  updateProduct,
} from "@/lib/connectors/shopify-apply.server";
import {
  fetchMetaSnapshot,
  metaAdsManagerUrl,
  metaPauseAdSet,
  metaToken,
  metaUpdateAdCreative,
  metaUpdateBudget,
  metaUpdateTargeting,
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
} from "@/lib/action-guards";

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
- Budget : variation raisonnable (-50% à +100% du budget actuel), jamais sous 5 € / jour.
- Créa : texte principal accrocheur (max 125 caractères idéalement), titre max 40 caractères, français impeccable, bénéfice + preuve + appel à l'action.
- Ciblage : n'élargis/resserre que si les données le justifient (CTR faible, CPC élevé).

RÈGLES Google Ads :
- Titres RSA max 30 caractères, descriptions max 90 caractères, au moins 5 titres et 2 descriptions.
- Mots-clés à exclure : uniquement des requêtes clairement non acheteuses (gratuit, occasion, emploi, avis, pdf...).
- Budget : jamais sous 5 € / jour.`;

export type ApplyResult = {
  action: string;
  summary: string;
  detail?: string;
  adminUrl?: string;
  channel?: "shopify" | "meta_ads" | "google_ads" | "none";
};

type Tool = { type: "function"; function: { name: string; description: string; parameters: unknown } };

function tool(name: string, description: string, props: Record<string, unknown>, required: string[]): Tool {
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

export async function applyFixAcrossChannels(ctx: ApplyContext): Promise<ApplyResult> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY manquant");

  const tools: Tool[] = [];
  const contextBlocks: string[] = [];

  // ---- Shopify ----
  let shopifyToken: string | null = null;
  let products: Awaited<ReturnType<typeof listProducts>> = [];
  if (ctx.shopify) {
    shopifyToken = getToken(ctx.shopify.encryptedToken);
    products = await listProducts(ctx.shopify.shop, shopifyToken, 20).catch(() => []);
    contextBlocks.push(
      `SHOPIFY (${ctx.shopify.shop}) — produits :\n` +
        (products.length
          ? products
              .map(
                (p) =>
                  `- id ${p.id} | "${p.title}" | prix ${p.price ?? "?"} | description : ${(p.body_html ?? "(vide)")
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

  // ---- Meta Ads ----
  let metaTok: string | null = null;
  // Conservé au-delà du bloc : les garde-fous ont besoin de l'état AVANT écriture.
  let metaSnap: MetaSnapshot | null = null;
  if (ctx.meta) {
    metaTok = metaToken(ctx.meta.encryptedToken);
    metaSnap = await fetchMetaSnapshot(ctx.meta.accountId, metaTok).catch(() => null);
    if (metaSnap) {
      contextBlocks.push(
        `META ADS (${ctx.meta.accountId}) — ensembles de pubs (30j) :\n` +
          (metaSnap.adsets.length
            ? metaSnap.adsets
                .map(
                  (a) =>
                    `- adset ${a.id} | "${a.name}" | ${a.status} | budget/j ${a.daily_budget_eur ?? "?"}€ | dépense ${
                      a.spend ?? 0
                    }€ | achats ${a.purchases ?? 0} | ROAS ${a.roas ?? 0} | CTR ${a.ctr ?? 0}% | CPC ${
                      a.cpc ?? 0
                    }€ | ciblage : ${a.targeting_summary}`,
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
          { adset_id: S, daily_budget_eur: N, summary: S },
          ["adset_id", "daily_budget_eur", "summary"],
        ),
        tool("meta_pause_adset", "Met en pause un ensemble de publicités Meta non rentable", { adset_id: S, summary: S }, [
          "adset_id",
          "summary",
        ]),
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
  }

  // ---- Google Ads ----
  let googleTok: string | null = null;
  // Conservé au-delà du bloc : les garde-fous ont besoin de l'état AVANT écriture.
  let googleSnap: GoogleSnapshot | null = null;
  if (ctx.google) {
    googleTok = await googleAccessToken(ctx.google.encryptedRefreshToken).catch(() => null);
    if (googleTok) {
      googleSnap = await fetchGoogleSnapshot(ctx.google.customerId, googleTok).catch(() => null);
      if (googleSnap) {
        contextBlocks.push(
          `GOOGLE ADS (${ctx.google.customerId}) — campagnes (30j) :\n` +
            (googleSnap.campaigns.length
              ? googleSnap.campaigns
                  .map(
                    (c) =>
                      `- campagne ${c.resource_name} | "${c.name}" | ${c.status} | ${c.channel} | budget ${
                        c.budget_resource_name ?? "?"
                      } (${c.daily_budget_eur ?? "?"}€/j) | coût ${c.cost_30d}€ | clics ${c.clicks_30d} | conversions ${
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
            { budget_resource_name: S, daily_budget_eur: N, summary: S },
            ["budget_resource_name", "daily_budget_eur", "summary"],
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
    }
  }

  tools.push(tool("no_action", "Aucun canal connecté ne peut régler ce problème", { reason: S }, ["reason"]));

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

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: APPLY_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      tools,
      tool_choice: "required",
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 429) throw new Error("Trop de demandes, réessaie dans une minute.");
    if (res.status === 402) throw new Error("Crédits IA épuisés.");
    throw new Error(`AI Gateway ${res.status}: ${errText}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { tool_calls?: Array<{ function: { name: string; arguments: string } }> } }>;
  };
  const call = json.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) throw new Error("L'IA n'a proposé aucune action. Réessaie.");

  const toolName = call.function.name;
  if (!isKnownTool(toolName)) {
    throw new Error(`L'IA a proposé un outil inconnu (${toolName}). Rien n'a été modifié.`);
  }

  let rawArgs: unknown;
  try {
    rawArgs = JSON.parse(call.function.arguments);
  } catch {
    throw new Error("Réponse IA illisible (arguments non JSON). Relance la correction.");
  }

  const channelUnavailable = (label: string) =>
    new Error(`L'IA a visé ${label}, qui n'est pas connecté. Rien n'a été modifié.`);

  // ---------- Exécution ----------
  // Chaque branche : arguments validés (zod) -> cible vérifiée -> garde-fou métier
  // -> écriture. Une valeur hors bornes est refusée, jamais ramenée en douce.

  if (toolName === "no_action") {
    const args = unwrapGuard(parseToolArgs(toolName, rawArgs));
    return { action: toolName, channel: "none", summary: args.reason };
  }

  // ---- Shopify ----
  if (toolName === "update_product") {
    if (!ctx.shopify || !shopifyToken) throw channelUnavailable("Shopify");
    const args = unwrapGuard(parseToolArgs(toolName, rawArgs));
    const product = unwrapGuard(
      guardTargetExists(
        products.find((p) => p.id === args.product_id) ?? null,
        `Le produit ${args.product_id}`,
      ),
    );
    const updated = await updateProduct(ctx.shopify.shop, shopifyToken, product.id, {
      title: args.title,
      body_html: args.body_html,
    });
    return {
      action: toolName,
      channel: "shopify",
      summary: args.summary ?? "Fiche produit réécrite.",
      detail: `Produit mis à jour : « ${updated.title} »`,
      adminUrl: updated.adminUrl,
    };
  }

  if (toolName === "create_discount_code") {
    if (!ctx.shopify || !shopifyToken) throw channelUnavailable("Shopify");
    const args = unwrapGuard(parseToolArgs(toolName, rawArgs));
    const discount = unwrapGuard(guardDiscount({ percentage: args.percentage, days: args.days }));
    const created = await createDiscountCode(ctx.shopify.shop, shopifyToken, {
      title: args.title,
      code: args.code.toUpperCase().replace(/\s+/g, ""),
      percentage: discount.percentage,
      days: discount.days,
    });
    return {
      action: toolName,
      channel: "shopify",
      summary: args.summary ?? "Code promo créé.",
      detail: `Code promo créé : ${created.code} (−${discount.percentage} % pendant ${discount.days} jours)`,
      adminUrl: created.adminUrl,
    };
  }

  // ---- Meta Ads ----
  if (
    toolName === "meta_update_budget" ||
    toolName === "meta_pause_adset" ||
    toolName === "meta_update_targeting" ||
    toolName === "meta_update_creative"
  ) {
    if (!ctx.meta || !metaTok || !metaSnap) throw channelUnavailable("Meta Ads");
    const adminUrl = metaAdsManagerUrl(ctx.meta.accountId);

    if (toolName === "meta_update_budget") {
      const args = unwrapGuard(parseToolArgs(toolName, rawArgs));
      const adset = unwrapGuard(
        guardTargetExists(
          metaSnap.adsets.find((a) => a.id === args.adset_id) ?? null,
          `L'ensemble de publicités ${args.adset_id}`,
        ),
      );
      const budget = unwrapGuard(
        guardDailyBudget({
          targetLabel: `« ${adset.name} »`,
          requestedEur: args.daily_budget_eur,
          currentDailyBudgetEur: adset.daily_budget_eur,
        }),
      );
      await metaUpdateBudget(adset.id, metaTok, budget);
      return {
        action: toolName,
        channel: "meta_ads",
        summary: args.summary ?? "Budget publicitaire ajusté.",
        detail: `Budget quotidien de « ${adset.name} » : ${adset.daily_budget_eur} € → ${budget} €`,
        adminUrl,
      };
    }

    if (toolName === "meta_pause_adset") {
      const args = unwrapGuard(parseToolArgs(toolName, rawArgs));
      const adset = unwrapGuard(
        guardTargetExists(
          metaSnap.adsets.find((a) => a.id === args.adset_id) ?? null,
          `L'ensemble de publicités ${args.adset_id}`,
        ),
      );
      const evidence = unwrapGuard(
        guardMetaPause({
          targetLabel: `« ${adset.name} »`,
          spend: adset.spend,
          roas: adset.roas,
        }),
      );
      await metaPauseAdSet(adset.id, metaTok);
      return {
        action: toolName,
        channel: "meta_ads",
        summary: args.summary ?? "Ensemble de publicités mis en pause.",
        detail: `« ${adset.name} » mis en pause : ${Math.round(
          evidence.spend,
        )} € dépensés sur 30 jours pour un ROAS de ${evidence.roas.toFixed(2)}`,
        adminUrl,
      };
    }

    if (toolName === "meta_update_targeting") {
      const args = unwrapGuard(parseToolArgs(toolName, rawArgs));
      const adset = unwrapGuard(
        guardTargetExists(
          metaSnap.adsets.find((a) => a.id === args.adset_id) ?? null,
          `L'ensemble de publicités ${args.adset_id}`,
        ),
      );
      const r = await metaUpdateTargeting(adset.id, metaTok, {
        age_min: args.age_min,
        age_max: args.age_max,
        genders: args.genders,
        countries: args.countries,
      });
      return {
        action: toolName,
        channel: "meta_ads",
        summary: args.summary ?? "Ciblage ajusté.",
        detail: `Nouveau ciblage de « ${adset.name} » : ${r.targeting_summary}`,
        adminUrl,
      };
    }

    if (toolName === "meta_update_creative") {
      const args = unwrapGuard(parseToolArgs(toolName, rawArgs));
      const ad = unwrapGuard(
        guardTargetExists(
          metaSnap.ads.find((a) => a.id === args.ad_id) ?? null,
          `La publicité ${args.ad_id}`,
        ),
      );
      await metaUpdateAdCreative(ad.id, ctx.meta.accountId, metaTok, {
        primary_text: args.primary_text,
        headline: args.headline,
        description: args.description,
      });
      return {
        action: toolName,
        channel: "meta_ads",
        summary: args.summary ?? "Création publicitaire réécrite.",
        detail: `Nouvelle création sur « ${ad.name} » — titre : « ${args.headline} »`,
        adminUrl,
      };
    }
  }

  // ---- Google Ads ----
  if (
    toolName === "google_update_budget" ||
    toolName === "google_pause_campaign" ||
    toolName === "google_add_negative_keywords" ||
    toolName === "google_update_rsa"
  ) {
    if (!ctx.google || !googleTok || !googleSnap) throw channelUnavailable("Google Ads");
    const cid = ctx.google.customerId;
    const adminUrl = googleAdsUrl(cid);

    if (toolName === "google_update_budget") {
      const args = unwrapGuard(parseToolArgs(toolName, rawArgs));
      const campaign = unwrapGuard(
        guardTargetExists(
          googleSnap.campaigns.find((c) => c.budget_resource_name === args.budget_resource_name) ??
            null,
          "La campagne visée",
        ),
      );
      const budget = unwrapGuard(
        guardDailyBudget({
          targetLabel: `« ${campaign.name} »`,
          requestedEur: args.daily_budget_eur,
          currentDailyBudgetEur: campaign.daily_budget_eur,
        }),
      );
      await googleUpdateBudget(cid, googleTok, args.budget_resource_name, budget);
      return {
        action: toolName,
        channel: "google_ads",
        summary: args.summary ?? "Budget publicitaire ajusté.",
        detail: `Budget quotidien de « ${campaign.name} » : ${campaign.daily_budget_eur} € → ${budget} €`,
        adminUrl,
      };
    }

    if (toolName === "google_pause_campaign") {
      const args = unwrapGuard(parseToolArgs(toolName, rawArgs));
      const campaign = unwrapGuard(
        guardTargetExists(
          googleSnap.campaigns.find((c) => c.resource_name === args.campaign_resource_name) ?? null,
          "La campagne visée",
        ),
      );
      const evidence = unwrapGuard(
        guardGooglePause({
          targetLabel: `« ${campaign.name} »`,
          cost30d: campaign.cost_30d,
          conversions30d: campaign.conversions_30d,
        }),
      );
      await googlePauseCampaign(cid, googleTok, campaign.resource_name);
      return {
        action: toolName,
        channel: "google_ads",
        summary: args.summary ?? "Campagne mise en pause.",
        detail: `« ${campaign.name} » mise en pause : ${Math.round(
          evidence.cost,
        )} € dépensés sur 30 jours pour 0 conversion`,
        adminUrl,
      };
    }

    if (toolName === "google_add_negative_keywords") {
      const args = unwrapGuard(parseToolArgs(toolName, rawArgs));
      const campaign = unwrapGuard(
        guardTargetExists(
          googleSnap.campaigns.find((c) => c.resource_name === args.campaign_resource_name) ?? null,
          "La campagne visée",
        ),
      );
      await googleAddNegativeKeywords(cid, googleTok, campaign.resource_name, args.keywords);
      return {
        action: toolName,
        channel: "google_ads",
        summary: args.summary ?? "Mots-clés à exclure ajoutés.",
        detail: `Mots-clés exclus ajoutés sur « ${campaign.name} » : ${args.keywords.join(", ")}`,
        adminUrl,
      };
    }

    if (toolName === "google_update_rsa") {
      const args = unwrapGuard(parseToolArgs(toolName, rawArgs));
      const ad = unwrapGuard(
        guardTargetExists(
          googleSnap.ads.find((a) => a.resource_name === args.ad_group_ad_resource_name) ?? null,
          "L'annonce responsive visée",
        ),
      );
      const r = await googleUpdateRsaText(cid, googleTok, ad.resource_name, {
        headlines: args.headlines,
        descriptions: args.descriptions,
      });
      return {
        action: toolName,
        channel: "google_ads",
        summary: args.summary ?? "Annonce réécrite.",
        detail: `Annonce de « ${ad.campaign_name} » réécrite — ${r.headlines.length} titres, ${r.descriptions.length} descriptions`,
        adminUrl,
      };
    }
  }

  // Aucun aiguillage n'a répondu : on ne devine pas, on n'écrit rien.
  throw new Error(
    `L'action « ${toolName} » ne peut pas être appliquée sur les canaux connectés. Rien n'a été modifié.`,
  );
}
