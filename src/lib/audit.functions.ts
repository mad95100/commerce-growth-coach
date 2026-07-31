import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { extractJsonBlock } from "@/lib/audit-parse";


const AUDIT_INPUT = z.object({ storeId: z.string().uuid() });

const AUDIT_MODEL = "google/gemini-2.5-pro";

const SYSTEM_PROMPT = `Tu es EcomPilot AI, le meilleur consultant e-commerce du monde.

Ta mission : faire gagner plus d'argent à l'utilisateur, qui est un DÉBUTANT en e-commerce et n'arrive pas à vendre ou à convertir.

RÈGLES ABSOLUES :
- Parle comme un mentor bienveillant, JAMAIS comme un analyste de données.
- Zéro jargon. Si un terme technique est nécessaire, explique-le entre parenthèses.
- Tutoie l'utilisateur.
- Utilise des analogies concrètes (ex : "c'est comme une boutique physique avec la porte fermée").
- Chaque recommandation doit être orientée vers la CROISSANCE, la CONVERSION et la RENTABILITÉ.
- Chiffre chaque gain estimé en euros/mois (fourchette réaliste).
- Encourage systématiquement ("Bonne nouvelle : c'est réparable rapidement.").

STRUCTURE OBLIGATOIRE de ta réponse (JSON) :
1. score : 0 à 100 selon l'état actuel de la boutique.
2. verdict : UNE phrase percutante qui résume la situation.
3. summary : 2-3 phrases qui contextualisent le score.
4. findings : 3 à 6 problèmes classés du plus critique au moins critique. Chaque finding :
   - category : offre | produit | boutique | conversion | acquisition | retention | rentabilite | operations
   - severity : critical | high | medium | low
   - title : titre clair et court en français simple
   - root_cause : pourquoi ça arrive, expliqué à un débutant
   - impact_description : ce que ça coûte en ventes perdues
   - estimated_gain_min et estimated_gain_max : fourchette euros/mois potentiels
   - action_steps : liste de 2-4 étapes concrètes, chacune avec un texte
   - auto_correction : objet optionnel avec { title, content } si tu peux générer un texte prêt à copier (fiche produit réécrite, email de relance panier, accroche pub, etc.)
   - timeframe : today | this_week | this_month

Tu es un directeur e-commerce senior qui a une seule obsession : que l'utilisateur gagne plus d'argent MAINTENANT.`;

export const runAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AUDIT_INPUT.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Fetch store
    const { data: store, error: storeErr } = await supabase
      .from("stores")
      .select("*")
      .eq("id", data.storeId)
      .single();
    if (storeErr || !store) throw new Error("Boutique introuvable");

    // Create audit row
    const { data: audit, error: auditErr } = await supabase
      .from("audits")
      .insert({
        store_id: store.id,
        created_by: userId,
        status: "running",
        input_snapshot: {
          name: store.name,
          url: store.url,
          niche: store.niche,
          monthly_revenue: store.monthly_revenue,
          monthly_ad_budget: store.monthly_ad_budget,
          goal: store.goal,
        },
      })
      .select()
      .single();
    if (auditErr || !audit) throw new Error("Impossible de créer l'audit");

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY manquant");

    // Enrichissement Shopify (si connecté)
    let shopifyBlock = "";
    const { data: shopifyConn } = await supabase
      .from("data_connections")
      .select("account_id, access_token_ciphertext, status")
      .eq("store_id", store.id)
      .eq("provider", "shopify")
      .maybeSingle();
    if (shopifyConn?.status === "active" && shopifyConn.access_token_ciphertext && shopifyConn.account_id) {
      const { fetchShopifySnapshot } = await import("@/lib/connectors/shopify.server");
      const snap = await fetchShopifySnapshot(shopifyConn.account_id, shopifyConn.access_token_ciphertext);
      if (snap) {
        shopifyBlock = `

Données Shopify réelles (30 derniers jours) :
- Nom boutique : ${snap.shopName}
- Domaine : ${snap.domain}
- Devise : ${snap.currency}
- Nombre de produits : ${snap.productCount ?? "?"}
- Commandes payées (30j) : ${snap.ordersLast30d ?? "?"}
- Chiffre d'affaires (30j) : ${snap.revenueLast30d != null ? snap.revenueLast30d.toFixed(2) + " " + snap.currency : "?"}
- Panier moyen : ${snap.avgOrderValue != null ? snap.avgOrderValue.toFixed(2) + " " + snap.currency : "?"}
`;
      }
    }

    const userPrompt = `Voici les infos de la boutique à auditer :

- Nom : ${store.name}
- URL : ${store.url || "(non fournie)"}
- Niche : ${store.niche || "(non précisée)"}
- Chiffre d'affaires actuel : ${store.monthly_revenue ? `${store.monthly_revenue} €/mois` : "(non renseigné, probablement très faible ou zéro)"}
- Budget pub mensuel : ${store.monthly_ad_budget ? `${store.monthly_ad_budget} €/mois` : "(non renseigné ou zéro)"}
- Objectif : ${store.goal || "(non précisé)"}${shopifyBlock}

Analyse cette boutique comme un directeur e-commerce senior qui veut aider un débutant à enfin vendre. Base-toi sur les meilleures pratiques du e-commerce moderne et sur les erreurs typiques des débutants (offre floue, page produit qui ne vend pas, absence de preuve sociale, prix mal positionné, tunnel de conversion cassé, pas de relance panier, ciblage pub trop large, etc.).

Réponds STRICTEMENT en JSON valide selon la structure demandée.`;

    const tool = {
      type: "function" as const,
      function: {
        name: "submit_audit",
        description: "Soumet le résultat de l'audit e-commerce",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            score: { type: "integer", description: "Score global 0-100" },
            verdict: { type: "string" },
            summary: { type: "string" },
            findings: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  category: {
                    type: "string",
                    enum: [
                      "offre",
                      "produit",
                      "boutique",
                      "conversion",
                      "acquisition",
                      "retention",
                      "rentabilite",
                      "operations",
                    ],
                  },
                  severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                  title: { type: "string" },
                  root_cause: { type: "string" },
                  impact_description: { type: "string" },
                  estimated_gain_min: { type: "number" },
                  estimated_gain_max: { type: "number" },
                  action_steps: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: { text: { type: "string" } },
                      required: ["text"],
                    },
                  },
                  auto_correction: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      title: { type: "string" },
                      content: { type: "string" },
                    },
                    required: ["title", "content"],
                  },
                  timeframe: { type: "string", enum: ["today", "this_week", "this_month"] },
                },
                required: [
                  "category",
                  "severity",
                  "title",
                  "root_cause",
                  "impact_description",
                  "estimated_gain_min",
                  "estimated_gain_max",
                  "action_steps",
                  "timeframe",
                ],

              },
            },
          },
          required: ["score", "verdict", "summary", "findings"],
        },
      },
    };

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: AUDIT_MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          tools: [tool],
          tool_choice: { type: "function", function: { name: "submit_audit" } },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`AI Gateway ${res.status}: ${errText}`);
      }

      const json = await res.json();
      const message = json.choices?.[0]?.message;
      const rawArgs: string | undefined =
        message?.tool_calls?.[0]?.function?.arguments ??
        // Certains modèles répondent en texte brut malgré tool_choice : on récupère le JSON.
        extractJsonBlock(
          typeof message?.content === "string"
            ? message.content
            : Array.isArray(message?.content)
              ? message.content.map((p: { text?: string }) => p?.text ?? "").join("")
              : "",
        );
      if (!rawArgs) {
        throw new Error(
          `Réponse IA invalide (${json.choices?.[0]?.finish_reason ?? "sans contenu"}). Relance l'audit.`,
        );
      }
      const parsed = JSON.parse(rawArgs) as {

        score: number;
        verdict: string;
        summary: string;
        findings: Array<{
          category: string;
          severity: string;
          title: string;
          root_cause: string;
          impact_description: string;
          estimated_gain_min: number;
          estimated_gain_max: number;
          action_steps: Array<{ text: string }>;
          auto_correction: { title: string; content: string } | null;
          timeframe: string;
        }>;
      };

      // Update audit
      await supabase
        .from("audits")
        .update({
          status: "completed",
          score: parsed.score,
          verdict: parsed.verdict,
          summary: parsed.summary,
          completed_at: new Date().toISOString(),
        })
        .eq("id", audit.id);

      // Insert findings
      if (parsed.findings.length > 0) {
        const rows = parsed.findings.map((f, i) => ({
          audit_id: audit.id,
          category: f.category,
          severity: f.severity,
          title: f.title,
          root_cause: f.root_cause,
          impact_description: f.impact_description,
          estimated_gain_min: f.estimated_gain_min,
          estimated_gain_max: f.estimated_gain_max,
          action_steps: f.action_steps,
          auto_correction: f.auto_correction ?? null,
          timeframe: f.timeframe,
          sort_order: i,
        }));
        // @ts-expect-error union type accepted by insert
        const { error: fErr } = await supabase.from("audit_findings").insert(rows);
        if (fErr) throw fErr;
      }

      return { auditId: audit.id };
    } catch (err) {
      await supabase
        .from("audits")
        .update({
          status: "failed",
          error_message: err instanceof Error ? err.message : String(err),
        })
        .eq("id", audit.id);
      throw err;
    }
  });

export const updateFindingStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      findingId: z.string().uuid(),
      status: z.enum(["todo", "in_progress", "done"]),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("audit_findings")
      .update({ status: data.status })
      .eq("id", data.findingId);
    if (error) throw error;
    return { ok: true };
  });

const FIX_MODEL = "google/gemini-2.5-flash";

const FIX_SYSTEM_PROMPT = `Tu es EcomPilot AI, directeur e-commerce senior.
On te donne un problème identifié sur une boutique e-commerce d'un débutant.
Ta mission : générer UN texte concret, prêt à copier-coller, qui règle ce problème.

Selon la catégorie, ça peut être :
- une fiche produit réécrite (titre + 5 bullets bénéfices + description + FAQ 3 questions)
- un email de relance panier (objet + corps HTML simple)
- une accroche + description publicitaire (Meta ou Google Ads)
- une structure d'offre (bundle, garantie, urgence, prix ancre)
- un script d'objection ou une bannière d'urgence

RÈGLES :
- Français, tutoiement de l'utilisateur (mais vouvoiement pour les textes destinés aux clients de la boutique).
- Zéro placeholder du type [NOM DU PRODUIT] : invente une version plausible basée sur la niche.
- Texte concret, punchy, orienté conversion.
- Le "title" est court (max 60 caractères) et décrit ce que c'est.
- Le "content" est directement utilisable, sans préambule ni explication.`;

export const generateFix = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ findingId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: finding, error: fErr } = await supabase
      .from("audit_findings")
      .select("*, audits(store_id, stores(name, url, niche))")
      .eq("id", data.findingId)
      .single();
    if (fErr || !finding) throw new Error("Problème introuvable");

    const store = (finding.audits as { stores: { name: string; url: string | null; niche: string | null } }).stores;

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY manquant");

    const userPrompt = `Boutique : ${store.name}
Niche : ${store.niche || "(non précisée)"}
URL : ${store.url || "(non fournie)"}

Problème (${finding.category}, sévérité ${finding.severity}) :
${finding.title}

Cause racine :
${finding.root_cause || "(non détaillée)"}

Impact :
${finding.impact_description || "(non détaillé)"}

Génère la correction prête à copier-coller adaptée à ce problème et à cette niche.`;

    const tool = {
      type: "function" as const,
      function: {
        name: "submit_fix",
        description: "Soumet la correction générée",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            content: { type: "string" },
          },
          required: ["title", "content"],
        },
      },
    };

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: FIX_MODEL,
        messages: [
          { role: "system", content: FIX_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        tools: [tool],
        tool_choice: { type: "function", function: { name: "submit_fix" } },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      if (res.status === 429) throw new Error("Trop de demandes, réessaie dans une minute.");
      if (res.status === 402) throw new Error("Crédits IA épuisés — passe à l'offre Pro pour continuer.");
      throw new Error(`AI Gateway ${res.status}: ${errText}`);
    }

    const json = await res.json();
    const call = json.choices?.[0]?.message?.tool_calls?.[0];
    if (!call?.function?.arguments) throw new Error("Réponse IA invalide");
    const parsed = JSON.parse(call.function.arguments) as { title: string; content: string };

    const { error: uErr } = await supabase
      .from("audit_findings")
      .update({ auto_correction: parsed })
      .eq("id", data.findingId);
    if (uErr) throw uErr;

    return parsed;
  });

/**
 * Applique directement la correction dans la boutique Shopify de l'utilisateur
 * (réécriture de fiche produit, création de code promo, etc.).
 */
export const applyFix = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ findingId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: finding, error: fErr } = await supabase
      .from("audit_findings")
      .select("*, audits(store_id, stores(name, url, niche))")
      .eq("id", data.findingId)
      .single();
    if (fErr || !finding) throw new Error("Problème introuvable");

    const auditRel = finding.audits as {
      store_id: string;
      stores: { name: string; url: string | null; niche: string | null };
    };

    const { data: conn } = await supabase
      .from("data_connections")
      .select("account_id, access_token_ciphertext, status")
      .eq("store_id", auditRel.store_id)
      .eq("provider", "shopify")
      .maybeSingle();

    if (!conn || conn.status !== "active" || !conn.access_token_ciphertext || !conn.account_id) {
      throw new Error(
        "Connecte d'abord ta boutique Shopify pour que je puisse appliquer les corrections directement.",
      );
    }

    const { applyFixOnShopify } = await import("@/lib/apply-fix.server");
    const result = await applyFixOnShopify({
      shop: conn.account_id,
      encryptedToken: conn.access_token_ciphertext,
      store: auditRel.stores,
      finding: {
        category: finding.category,
        severity: finding.severity,
        title: finding.title,
        root_cause: finding.root_cause,
        impact_description: finding.impact_description,
      },
    });

    if (result.action === "no_action") {
      const { error } = await supabase
        .from("audit_findings")
        .update({ applied_result: result })
        .eq("id", data.findingId);
      if (error) throw error;
      return result;
    }

    const { error: uErr } = await supabase
      .from("audit_findings")
      .update({ applied_at: new Date().toISOString(), applied_result: result, status: "done" })
      .eq("id", data.findingId);
    if (uErr) throw uErr;

    return result;
  });
