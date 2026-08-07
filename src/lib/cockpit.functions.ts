import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type CockpitPriority = {
  id: string;
  title: string;
  category: string;
  severity: string;
  impact_min: number | null;
  impact_max: number | null;
  difficulty: number;
  time_minutes: number;
  confidence: string;
  audit_id: string;
  has_auto_fix: boolean;
};

export type Cockpit = {
  storeId: string;
  currency: string;
  revenue: number | null;
  revenueGoal: number | null;
  orders: number | null;
  aov: number | null;
  adSpend: number | null;
  roas: number | null;
  margin: number | null;
  profit: number | null;
  score: number | null;
  categoryScores: Record<string, number>;
  potentialMin: number | null;
  potentialMax: number | null;
  lastSyncAt: string | null;
  unavailable: string[];
  priorities: CockpitPriority[];
};

/** Tout ce qu'il faut pour le centre de pilotage, en un seul appel. */
export const getCockpit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ storeId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<Cockpit> => {
    const { supabase } = context;

    const { data: store, error: storeErr } = await supabase
      .from("stores")
      .select("*")
      .eq("id", data.storeId)
      .single();
    if (storeErr || !store) throw new Error("Boutique introuvable");

    const { data: snapRows } = await supabase
      .from("data_snapshots")
      .select("payload, fetched_at")
      .eq("store_id", store.id)
      .eq("kind", "composite")
      .order("fetched_at", { ascending: false })
      .limit(1);

    const snapRow = (snapRows ?? [])[0] as
      | { payload: Record<string, any>; fetched_at: string }
      | undefined;
    const snap = snapRow?.payload ?? null;

    const revenue = snap?.shopify?.revenue_30d ?? store.monthly_revenue ?? null;
    const orders = snap?.shopify?.orders_30d ?? null;
    const aov = snap?.shopify?.aov ?? (revenue && orders ? revenue / orders : null);
    const adSpend =
      (snap?.meta?.spend ?? 0) + (snap?.google?.cost ?? 0) || store.monthly_ad_budget || null;
    const roas = snap?.meta?.roas ?? (revenue && adSpend ? revenue / adSpend : null);

    const costRatio = store.avg_product_cost_ratio ?? null;
    const margin = revenue != null && costRatio != null ? revenue * (1 - costRatio) : null;
    const profit =
      margin != null ? margin - (adSpend ?? 0) - (store.fixed_costs_monthly ?? 0) : null;

    const { data: audit } = await supabase
      .from("audits")
      .select("id, score, category_scores, potential_gain_min, potential_gain_max")
      .eq("store_id", store.id)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let priorities: CockpitPriority[] = [];
    if (audit) {
      const { data: findings } = await supabase
        .from("audit_findings")
        .select(
          "id, title, category, severity, estimated_gain_min, estimated_gain_max, difficulty, time_minutes, confidence, auto_correction, audit_id",
        )
        .eq("audit_id", audit.id)
        .neq("status", "done")
        .order("priority_score", { ascending: false })
        .limit(3);

      priorities = (findings ?? []).map((f: any) => ({
        id: f.id,
        title: f.title,
        category: f.category,
        severity: f.severity,
        impact_min: f.estimated_gain_min,
        impact_max: f.estimated_gain_max,
        difficulty: f.difficulty ?? 2,
        time_minutes: f.time_minutes ?? 30,
        confidence: f.confidence ?? "medium",
        audit_id: f.audit_id,
        has_auto_fix: Boolean(f.auto_correction),
      }));
    }

    return {
      storeId: store.id,
      currency: store.currency ?? "EUR",
      revenue,
      revenueGoal: store.revenue_goal ?? null,
      orders,
      aov,
      adSpend: adSpend || null,
      roas,
      margin,
      profit,
      score: audit?.score ?? null,
      categoryScores: (audit?.category_scores as Record<string, number>) ?? {},
      potentialMin: audit?.potential_gain_min ?? null,
      potentialMax: audit?.potential_gain_max ?? null,
      lastSyncAt: snapRow?.fetched_at ?? null,
      unavailable: (snap?.unavailable as string[]) ?? [],
      priorities,
    };
  });
