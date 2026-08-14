import type { Db } from "@/lib/actions.server";
import { currencyLabel, normalizeCurrency } from "@/lib/currency";
import {
  computeCategoryScores,
  computeGlobalScore,
  computePotential,
  computePriority,
} from "@/lib/scoring";
import { AUDIT_MODEL, SYSTEM_PROMPT } from "@/lib/audit-prompt";
import { extractJsonBlock } from "@/lib/audit-parse";

/**
 * Travail long d'un audit : capture des données des canaux, appel au modèle,
 * calcul du score et écriture des résultats.
 *
 * Extrait tel quel de `runAudit`, sans changement de comportement : mêmes
 * requêtes, même prompt, mêmes règles de scoring, mêmes écritures. Seule change
 * la façon dont il est déclenché — hors du temps de la requête qui l'a demandé,
 * et donc hors de son délai d'expiration.
 *
 * La fonction ne rattrape pas ses propres échecs : elle laisse remonter, et
 * l'appelant décide s'il faut retenter ou déclarer forfait. C'est ce qui rend
 * la reprise possible.
 */
/**
 * Champs de la boutique dont l'audit a besoin.
 *
 * Énumérés plutôt que laissés en `Record<string, any>` : le compilateur signale
 * alors toute faute de frappe sur un nom de colonne, qui produirait sinon
 * silencieusement « (non renseigné) » dans le prompt.
 */
export type AuditStore = {
  id: string;
  name: string;
  url: string | null;
  niche: string | null;
  currency: string | null;
  situation: string | null;
  goal: string | null;
  monthly_revenue: number | null;
  monthly_ad_budget: number | null;
  revenue_goal: number | null;
  avg_product_cost_ratio: number | null;
  fixed_costs_monthly: number | null;
};

export async function executeAuditWork(input: {
  supabase: Db;
  userId: string;
  store: AuditStore;
  auditId: string;
}): Promise<void> {
  const { supabase, userId, store, auditId } = input;

  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY manquant");

  // Données réelles de toutes les sources connectées (tolérant aux pannes)
  const { captureAndStoreSnapshot, getSnapshotAround, snapshotToPromptBlock } =
    await import("@/lib/snapshots.server");
  const snapshot = await captureAndStoreSnapshot(supabase as never, store.id);
  const previous = await getSnapshotAround(supabase as never, store.id, 7);
  const dataBlock = snapshotToPromptBlock(snapshot, previous, normalizeCurrency(store.currency));

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

  // Les montants déclarés par l'utilisateur sont dans la devise de sa
  // boutique. Le modèle doit la connaître : sans elle il raisonnerait en
  // euros par habitude et chiffrerait ses recommandations dans la mauvaise unité.
  const storeCurrency = normalizeCurrency(store.currency);

  const userPrompt = `Voici les infos de la boutique à auditer :

- Nom : ${store.name}
- URL : ${store.url || "(non fournie)"}
- Niche : ${store.niche || "(non précisée)"}
- Devise de la boutique : ${currencyLabel(storeCurrency)}
- Chiffre d'affaires déclaré : ${store.monthly_revenue ? `${store.monthly_revenue} ${currencyLabel(storeCurrency)}/mois` : "(non renseigné)"}
- Budget pub déclaré : ${store.monthly_ad_budget ? `${store.monthly_ad_budget} ${currencyLabel(storeCurrency)}/mois` : "(non renseigné)"}
- Objectif de CA : ${store.revenue_goal ? `${store.revenue_goal} ${currencyLabel(storeCurrency)}/mois` : store.goal || "(non précisé)"}
- Coût produit moyen : ${store.avg_product_cost_ratio ? `${Math.round(store.avg_product_cost_ratio * 100)} % du prix de vente` : "(non renseigné)"}
- Charges fixes : ${store.fixed_costs_monthly ? `${store.fixed_costs_monthly} ${currencyLabel(storeCurrency)}/mois` : "(non renseignées)"}

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
    .eq("id", auditId);

  if (ranked.length > 0) {
    const rows = ranked.map(({ f, priority }, i) => ({
      audit_id: auditId,
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
    const { error: fErr } = await supabase.from("audit_findings").insert(rows);
    if (fErr) throw fErr;
  }
}
