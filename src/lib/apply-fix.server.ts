import {
  createDiscountCode,
  getToken,
  listProducts,
  updateProduct,
} from "@/lib/connectors/shopify-apply.server";

const APPLY_MODEL = "google/gemini-2.5-flash";

const APPLY_SYSTEM_PROMPT = `Tu es EcomPilot AI, directeur e-commerce senior avec un accès en écriture à la boutique Shopify de l'utilisateur.

On te donne : un problème identifié lors d'un audit, le contexte de la boutique, et la liste réelle de ses produits.

Ta mission : APPLIQUER la correction toi-même en appelant l'outil adapté. Tu n'expliques pas, tu agis.

Outils disponibles :
- update_product : réécrire le titre et/ou la description HTML d'un produit existant (utilise un product_id de la liste fournie).
- create_discount_code : créer un vrai code promo dans la boutique (offre d'appel, urgence, relance panier).
- no_action : uniquement si AUCUNE action Shopify ne peut régler ce problème (ex : problème de ciblage publicitaire). Donne alors une raison courte en français.

RÈGLES pour update_product :
- Le titre est clair, orienté bénéfice, max 70 caractères, sans emoji excessif.
- La description (body_html) est du HTML simple et complet : accroche, <ul> de 5 bénéfices, paragraphe rassurance (livraison, garantie, retours), mini FAQ en 3 questions.
- Vouvoiement (texte destiné aux clients de la boutique), français impeccable, zéro placeholder du type [PRODUIT].
- Ne jamais inventer de produit : utilise un id existant de la liste.

RÈGLES pour create_discount_code :
- code en MAJUSCULES sans espace, percentage entre 5 et 25, days entre 3 et 30.`;

type ApplyTool =
  | { name: "update_product"; args: { product_id: number; title?: string; body_html?: string; summary: string } }
  | { name: "create_discount_code"; args: { title: string; code: string; percentage: number; days: number; summary: string } }
  | { name: "no_action"; args: { reason: string } };

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "update_product",
      description: "Met à jour le titre et/ou la description d'un produit Shopify existant",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          product_id: { type: "number", description: "Identifiant du produit dans la liste fournie" },
          title: { type: "string" },
          body_html: { type: "string" },
          summary: { type: "string", description: "Résumé en une phrase de ce que tu as changé" },
        },
        required: ["product_id", "title", "body_html", "summary"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_discount_code",
      description: "Crée un code promo réel dans la boutique Shopify",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          code: { type: "string" },
          percentage: { type: "number" },
          days: { type: "number" },
          summary: { type: "string" },
        },
        required: ["title", "code", "percentage", "days", "summary"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "no_action",
      description: "Aucune action Shopify possible pour ce problème",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { reason: { type: "string" } },
        required: ["reason"],
      },
    },
  },
];

export type ApplyResult = {
  action: string;
  summary: string;
  detail?: string;
  adminUrl?: string;
};

export async function applyFixOnShopify(params: {
  shop: string;
  encryptedToken: string;
  store: { name: string; niche: string | null; url: string | null };
  finding: {
    category: string;
    severity: string;
    title: string;
    root_cause: string | null;
    impact_description: string | null;
  };
}): Promise<ApplyResult> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY manquant");

  const token = getToken(params.encryptedToken);
  const products = await listProducts(params.shop, token, 20);

  const productList = products.length
    ? products
        .map(
          (p) =>
            `- id ${p.id} | "${p.title}" | prix ${p.price ?? "?"} | description actuelle : ${
              (p.body_html ?? "(vide)").replace(/<[^>]+>/g, " ").slice(0, 200)
            }`,
        )
        .join("\n")
    : "(aucun produit trouvé dans la boutique)";

  const userPrompt = `Boutique : ${params.store.name}
Niche : ${params.store.niche || "(non précisée)"}
URL : ${params.store.url || "(non fournie)"}

Problème à corriger (${params.finding.category}, sévérité ${params.finding.severity}) :
${params.finding.title}

Cause racine : ${params.finding.root_cause || "(non détaillée)"}
Impact : ${params.finding.impact_description || "(non détaillé)"}

Produits réels de la boutique :
${productList}

Applique maintenant la correction en appelant l'outil le plus pertinent.`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: APPLY_MODEL,
      messages: [
        { role: "system", content: APPLY_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      tools: TOOLS,
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

  const parsed = { name: call.function.name, args: JSON.parse(call.function.arguments) } as ApplyTool;

  if (parsed.name === "update_product") {
    const exists = products.some((p) => p.id === Number(parsed.args.product_id));
    if (!exists) throw new Error("L'IA a visé un produit qui n'existe plus. Réessaie.");
    const updated = await updateProduct(params.shop, token, Number(parsed.args.product_id), {
      ...(parsed.args.title ? { title: parsed.args.title } : {}),
      ...(parsed.args.body_html ? { body_html: parsed.args.body_html } : {}),
    });
    return {
      action: "update_product",
      summary: parsed.args.summary,
      detail: `Produit mis à jour : « ${updated.title} »`,
      adminUrl: updated.adminUrl,
    };
  }

  if (parsed.name === "create_discount_code") {
    const created = await createDiscountCode(params.shop, token, {
      title: parsed.args.title,
      code: parsed.args.code.toUpperCase().replace(/\s+/g, ""),
      percentage: Math.min(Math.max(parsed.args.percentage, 5), 25),
      days: Math.min(Math.max(parsed.args.days, 3), 30),
    });
    return {
      action: "create_discount_code",
      summary: parsed.args.summary,
      detail: `Code promo créé : ${created.code}`,
      adminUrl: created.adminUrl,
    };
  }

  return { action: "no_action", summary: parsed.args.reason };
}
