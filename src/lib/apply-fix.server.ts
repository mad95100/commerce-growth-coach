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
} from "@/lib/connectors/meta-apply.server";
import {
  fetchGoogleSnapshot,
  googleAccessToken,
  googleAddNegativeKeywords,
  googleAdsUrl,
  googlePauseCampaign,
  googleUpdateBudget,
  googleUpdateRsaText,
} from "@/lib/connectors/google-apply.server";

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
  if (ctx.meta) {
    metaTok = metaToken(ctx.meta.encryptedToken);
    const snap = await fetchMetaSnapshot(ctx.meta.accountId, metaTok).catch(() => null);
    if (snap) {
      contextBlocks.push(
        `META ADS (${ctx.meta.accountId}) — ensembles de pubs (30j) :\n` +
          (snap.adsets.length
            ? snap.adsets
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
          (snap.ads.length
            ? snap.ads
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
  if (ctx.google) {
    googleTok = await googleAccessToken(ctx.google.encryptedRefreshToken).catch(() => null);
    if (googleTok) {
      const snap = await fetchGoogleSnapshot(ctx.google.customerId, googleTok).catch(() => null);
      if (snap) {
        contextBlocks.push(
          `GOOGLE ADS (${ctx.google.customerId}) — campagnes (30j) :\n` +
            (snap.campaigns.length
              ? snap.campaigns
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
            (snap.ads.length
              ? snap.ads
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

  const name = call.function.name;
  const args = JSON.parse(call.function.arguments) as Record<string, any>;

  // ---------- Exécution ----------
  if (name === "update_product" && ctx.shopify && shopifyToken) {
    const exists = products.some((p) => p.id === Number(args.product_id));
    if (!exists) throw new Error("L'IA a visé un produit qui n'existe plus. Réessaie.");
    const updated = await updateProduct(ctx.shopify.shop, shopifyToken, Number(args.product_id), {
      ...(args.title ? { title: args.title } : {}),
      ...(args.body_html ? { body_html: args.body_html } : {}),
    });
    return {
      action: name,
      channel: "shopify",
      summary: args.summary,
      detail: `Produit mis à jour : « ${updated.title} »`,
      adminUrl: updated.adminUrl,
    };
  }

  if (name === "create_discount_code" && ctx.shopify && shopifyToken) {
    const created = await createDiscountCode(ctx.shopify.shop, shopifyToken, {
      title: args.title,
      code: String(args.code).toUpperCase().replace(/\s+/g, ""),
      percentage: Math.min(Math.max(Number(args.percentage), 5), 25),
      days: Math.min(Math.max(Number(args.days), 3), 30),
    });
    return {
      action: name,
      channel: "shopify",
      summary: args.summary,
      detail: `Code promo créé : ${created.code}`,
      adminUrl: created.adminUrl,
    };
  }

  if (ctx.meta && metaTok && name.startsWith("meta_")) {
    const adminUrl = metaAdsManagerUrl(ctx.meta.accountId);
    if (name === "meta_update_budget") {
      const budget = Math.max(5, Number(args.daily_budget_eur));
      await metaUpdateBudget(String(args.adset_id), metaTok, budget);
      return {
        action: name,
        channel: "meta_ads",
        summary: args.summary,
        detail: `Budget quotidien passé à ${budget} € sur l'ensemble ${args.adset_id}`,
        adminUrl,
      };
    }
    if (name === "meta_pause_adset") {
      await metaPauseAdSet(String(args.adset_id), metaTok);
      return {
        action: name,
        channel: "meta_ads",
        summary: args.summary,
        detail: `Ensemble de publicités ${args.adset_id} mis en pause`,
        adminUrl,
      };
    }
    if (name === "meta_update_targeting") {
      const r = await metaUpdateTargeting(String(args.adset_id), metaTok, {
        age_min: args.age_min ? Number(args.age_min) : undefined,
        age_max: args.age_max ? Number(args.age_max) : undefined,
        genders: Array.isArray(args.genders) ? args.genders.map(Number) : undefined,
        countries: Array.isArray(args.countries) ? args.countries.map(String) : undefined,
      });
      return {
        action: name,
        channel: "meta_ads",
        summary: args.summary,
        detail: `Nouveau ciblage : ${r.targeting_summary}`,
        adminUrl,
      };
    }
    if (name === "meta_update_creative") {
      await metaUpdateAdCreative(String(args.ad_id), ctx.meta.accountId, metaTok, {
        primary_text: args.primary_text,
        headline: args.headline,
        description: args.description,
      });
      return {
        action: name,
        channel: "meta_ads",
        summary: args.summary,
        detail: `Nouvelle création appliquée sur la publicité ${args.ad_id} — titre : « ${args.headline ?? ""} »`,
        adminUrl,
      };
    }
  }

  if (ctx.google && googleTok && name.startsWith("google_")) {
    const cid = ctx.google.customerId;
    const adminUrl = googleAdsUrl(cid);
    if (name === "google_update_budget") {
      const budget = Math.max(5, Number(args.daily_budget_eur));
      await googleUpdateBudget(cid, googleTok, String(args.budget_resource_name), budget);
      return {
        action: name,
        channel: "google_ads",
        summary: args.summary,
        detail: `Budget quotidien passé à ${budget} €`,
        adminUrl,
      };
    }
    if (name === "google_pause_campaign") {
      await googlePauseCampaign(cid, googleTok, String(args.campaign_resource_name));
      return {
        action: name,
        channel: "google_ads",
        summary: args.summary,
        detail: "Campagne mise en pause",
        adminUrl,
      };
    }
    if (name === "google_add_negative_keywords") {
      const kws = (args.keywords as string[]).map(String);
      await googleAddNegativeKeywords(cid, googleTok, String(args.campaign_resource_name), kws);
      return {
        action: name,
        channel: "google_ads",
        summary: args.summary,
        detail: `Mots-clés exclus ajoutés : ${kws.join(", ")}`,
        adminUrl,
      };
    }
    if (name === "google_update_rsa") {
      const r = await googleUpdateRsaText(cid, googleTok, String(args.ad_group_ad_resource_name), {
        headlines: (args.headlines as string[])?.map(String),
        descriptions: (args.descriptions as string[])?.map(String),
      });
      return {
        action: name,
        channel: "google_ads",
        summary: args.summary,
        detail: `Annonce réécrite — ${r.headlines.length} titres, ${r.descriptions.length} descriptions`,
        adminUrl,
      };
    }
  }

  return { action: "no_action", channel: "none", summary: args.reason ?? "Aucune action applicable." };
}
