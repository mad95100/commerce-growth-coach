import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { currencyLabel, normalizeCurrency } from "@/lib/currency";
import { z } from "zod";
import { extractJsonBlock } from "@/lib/audit-parse";
import {
  computeCategoryScores,
  computeGlobalScore,
  computePotential,
  computePriority,
} from "@/lib/scoring";

const AUDIT_INPUT = z.object({ storeId: z.string().uuid() });

/**
 * Demande un audit.
 *
 * Ne fait plus que le travail court : vérifier la boutique, décompter le quota,
 * créer la ligne, et rendre la main. L'analyse elle-même — trois plateformes
 * interrogées puis un appel au modèle — est exécutée par `processAudit`, hors
 * du délai d'expiration de cette requête.
 *
 * Le quota reste décompté ici, une seule fois par audit demandé : le compter à
 * chaque tentative ferait payer les reprises à l'utilisateur.
 */
export const runAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AUDIT_INPUT.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: store, error: storeErr } = await supabase
      .from("stores")
      .select("*")
      .eq("id", data.storeId)
      .single();
    if (storeErr || !store) throw new Error("Boutique introuvable");

    // Quota décompté AVANT la création de l'audit : un audit refusé ne doit
    // laisser ni ligne en base ni facture chez le fournisseur d'IA.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { consumeQuota } = await import("@/lib/billing.server");
    await consumeQuota(supabaseAdmin, userId, "audits");

    const { INITIAL_JOB } = await import("@/lib/audit-jobs");

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
          job: INITIAL_JOB,
        },
      })
      .select()
      .single();
    if (auditErr || !audit) throw new Error("Impossible de créer l'audit");

    return { auditId: audit.id };
  });

/**
 * Exécute une tranche de travail sur un audit en attente.
 *
 * Appelable autant de fois qu'on veut : la réclamation est atomique, donc deux
 * appels simultanés ne produisent jamais deux exécutions. Un audit dont
 * l'exécution précédente a disparu — conteneur recyclé, onglet fermé — redevient
 * réclamable à l'expiration de son bail, ce qui suffit à le reprendre.
 *
 * Renvoie l'état du travail après la tentative, pour que l'interface sache si
 * elle doit rappeler.
 */
export const processAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ auditId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { claimAudit, finishAudit, failAuditAttempt, loadAuditJob } =
      await import("@/lib/audit-jobs.server");

    const claim = await claimAudit(supabase, data.auditId);
    if (!claim.claimed) return { state: claim.job.state, attempts: claim.job.attempts };

    try {
      const { executeAuditWork } = await import("@/lib/audit-runner.server");
      await executeAuditWork({
        supabase,
        userId,
        store: claim.store,
        auditId: data.auditId,
      });
      await finishAudit(supabase, data.auditId);
      return { state: "completed" as const, attempts: claim.job.attempts };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await failAuditAttempt(supabase, data.auditId, message);
      const after = await loadAuditJob(supabase, data.auditId);
      return { state: after.state, attempts: after.attempts };
    }
  });

/** État du travail d'un audit, pour que l'interface puisse le suivre. */
export const getAuditJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ auditId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { loadAuditJob } = await import("@/lib/audit-jobs.server");
    const { describeJob, isClaimable } = await import("@/lib/audit-jobs");
    const job = await loadAuditJob(context.supabase, data.auditId);
    return {
      state: job.state,
      attempts: job.attempts,
      label: describeJob(job),
      /** `true` si un appel à `processAudit` ferait avancer les choses. */
      resumable: isClaimable(job),
      lastError: job.lastError,
    };
  });

export const updateFindingStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        findingId: z.string().uuid(),
        status: z.enum(["todo", "in_progress", "done"]),
      })
      .parse(input),
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
  .inputValidator((input: unknown) => z.object({ findingId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { consumeQuota } = await import("@/lib/billing.server");
    await consumeQuota(supabaseAdmin, userId, "fixes");

    const { data: finding, error: fErr } = await supabase
      .from("audit_findings")
      .select("*, audits(store_id, stores(name, url, niche))")
      .eq("id", data.findingId)
      .single();
    if (fErr || !finding) throw new Error("Problème introuvable");

    const store = (
      finding.audits as { stores: { name: string; url: string | null; niche: string | null } }
    ).stores;

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
      if (res.status === 402)
        throw new Error("Crédits IA épuisés — passe à l'offre Pro pour continuer.");
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
