import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { extractJsonBlock } from "@/lib/audit-parse";
import {
  computeCategoryScores,
  computeGlobalScore,
  computePotential,
  computePriority,
} from "@/lib/scoring";


const AUDIT_INPUT = z.object({ storeId: z.string().uuid() });

const AUDIT_MODEL = "google/gemini-2.5-pro";

const SYSTEM_PROMPT = `Tu es EcomPilot AI, le directeur e-commerce personnel de l'utilisateur.

Ta mission : le faire passer de "je ne vends pas / je ne comprends pas pourquoi" à "je génère des ventes et j'améliore ma rentabilité".

RÈGLES ABSOLUES :
- Parle comme un mentor bienveillant, JAMAIS comme un analyste de données.
- Zéro jargon. Si un terme technique est nécessaire, explique-le entre parenthèses.
- Tutoie l'utilisateur. Utilise des analogies concrètes.
- Encourage systématiquement ("Bonne nouvelle : c'est réparable rapidement.").

RÈGLES SUR LES DONNÉES (non négociables) :
- Utilise EN PRIORITÉ les chiffres réels fournis. Ne les recalcule pas au hasard.
- N'invente JAMAIS une métrique. Si une donnée manque, dis-le et baisse la confiance.
- Distingue toujours fait mesuré et hypothèse : le champ "evidence" doit contenir
  { "based_on": "...", "assumptions": "..." } en français simple.
- Ne promets jamais un revenu garanti : donne une fourchette réaliste.
- Explique la base du calcul de chaque gain estimé dans impact_description.

POUR CHAQUE PROBLÈME tu dois fournir :
- category : offre | produit | boutique | conversion | acquisition | retention | rentabilite | operations
- severity : critical | high | medium | low
- title : titre clair et court en français simple
- root_cause : pourquoi ça arrive, expliqué à un débutant
- impact_description : ce que ça coûte + comment tu l'as estimé
- estimated_gain_min / estimated_gain_max : fourchette euros/mois réaliste
- difficulty : 1 (très facile) à 5 (expert)
- time_minutes : temps nécessaire pour le corriger
- confidence : low | medium | high selon la qualité des données disponibles
- evidence : { based_on, assumptions }
- action_steps : 2 à 4 étapes concrètes
- auto_correction : { title, content } si tu peux produire un texte prêt à l'emploi
- timeframe : today | this_week | this_month

Tu es un directeur e-commerce senior obsédé par une chose : que l'utilisateur gagne plus d'argent, avec honnêteté sur ce que tu sais et ce que tu supposes.`;

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

    // Données réelles de toutes les sources connectées (tolérant aux pannes)
    const { captureAndStoreSnapshot, getSnapshotAround, snapshotToPromptBlock } = await import(
      "@/lib/snapshots.server"
    );
    const snapshot = await captureAndStoreSnapshot(supabase as never, store.id);
    const previous = await getSnapshotAround(supabase as never, store.id, 7);
    const dataBlock = snapshotToPromptBlock(snapshot, previous, store.currency ?? "EUR");

    const { data: profile } = await supabase
      .from("profiles")
      .select("experience_level")
      .eq("user_id", userId)
      .maybeSingle();

    const levelHint =
      profile?.experience_level === "avance"
        ? "Utilisateur AVANCÉ : tu peux être plus technique et plus dense."
        : profile?.experience_level === "intermediaire"
          ? "Utilisateur INTERMÉDIAIRE : reste simple mais tu peux utiliser les termes courants (ROAS, CPA, AOV) en les rappelant."
          : "Utilisateur DÉBUTANT : phrases courtes, zéro jargon, maximum 4 problèmes, et commence par ce qui bloque la toute première vente.";

    const situationHint =
      store.situation === "no_sales"
        ? "Situation : AUCUNE VENTE. Concentre-toi en priorité sur offre, prix, page produit, confiance, trafic, tracking et checkout."
        : store.situation === "few_sales"
          ? "Situation : QUELQUES VENTES. Cherche ce qui empêche de passer à l'échelle."
          : store.situation === "plateau"
            ? "Situation : CA QUI STAGNE. Cherche le plafond : offre, panier moyen, acquisition, rétention."
            : store.situation === "not_profitable"
              ? "Situation : DU CA MAIS PAS RENTABLE. Priorise marge, coût d'acquisition, ROAS minimum rentable."
              : "Situation non précisée.";

    const userPrompt = `Voici les infos de la boutique à auditer :

- Nom : ${store.name}
- URL : ${store.url || "(non fournie)"}
- Niche : ${store.niche || "(non précisée)"}
- Chiffre d'affaires déclaré : ${store.monthly_revenue ? `${store.monthly_revenue} €/mois` : "(non renseigné)"}
- Budget pub déclaré : ${store.monthly_ad_budget ? `${store.monthly_ad_budget} €/mois` : "(non renseigné)"}
- Objectif de CA : ${store.revenue_goal ? `${store.revenue_goal} €/mois` : store.goal || "(non précisé)"}
- Coût produit moyen : ${store.avg_product_cost_ratio ? `${Math.round(store.avg_product_cost_ratio * 100)} % du prix de vente` : "(non renseigné)"}
- Charges fixes : ${store.fixed_costs_monthly ? `${store.fixed_costs_monthly} €/mois` : "(non renseignées)"}

${levelHint}
${situationHint}

DONNÉES RÉELLES DISPONIBLES :
${dataBlock}

Analyse cette boutique comme un directeur e-commerce senior. Couvre l'offre, le produit, la boutique, la conversion, l'acquisition, la rétention et la rentabilité. Ne retiens que les problèmes qui coûtent réellement de l'argent, du plus coûteux au moins coûteux.

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
                  difficulty: { type: "integer", description: "1 très facile à 5 expert" },
                  time_minutes: { type: "integer", description: "Temps estimé en minutes" },
                  confidence: { type: "string", enum: ["low", "medium", "high"] },
                  evidence: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      based_on: { type: "string" },
                      assumptions: { type: "string" },
                    },
                    required: ["based_on", "assumptions"],
                  },
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
                  "difficulty",
                  "time_minutes",
                  "confidence",
                  "evidence",
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
          difficulty?: number;
          time_minutes?: number;
          confidence?: string;
          evidence?: { based_on: string; assumptions: string };
        }>;
      };

      // Scoring et priorisation déterministes côté serveur (jamais devinés par l'IA)
      const categoryScores = computeCategoryScores(parsed.findings);
      const globalScore = computeGlobalScore(categoryScores);
      const potential = computePotential(parsed.findings);

      const ranked = parsed.findings
        .map((f) => ({ f, priority: computePriority(f) }))
        .sort((a, b) => b.priority - a.priority);

      await supabase
        .from("audits")
        .update({
          status: "completed",
          score: globalScore,
          category_scores: categoryScores,
          potential_gain_min: potential.min,
          potential_gain_max: potential.max,
          verdict: parsed.verdict,
          summary: parsed.summary,
          completed_at: new Date().toISOString(),
        })
        .eq("id", audit.id);

      if (ranked.length > 0) {
        const rows = ranked.map(({ f, priority }, i) => ({
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
          difficulty: Math.min(5, Math.max(1, f.difficulty ?? 2)),
          time_minutes: f.time_minutes ?? 30,
          confidence: f.confidence === "high" || f.confidence === "low" ? f.confidence : "medium",
          evidence: f.evidence ?? {},
          priority_score: priority,
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

// `applyFix` a été retiré : il écrivait directement chez Shopify / Meta / Google
// sans confirmation, sans journal et sans possibilité d’annulation. Le chemin est
// désormais `proposeFix` puis `confirmAction` dans `@/lib/actions.functions`.
