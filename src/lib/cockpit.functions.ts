import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeCurrency } from "@/lib/currency";
import { z } from "zod";

/**
 * Valeur issue d'un instantané stocké en `jsonb`.
 *
 * La forme exacte varie selon les canaux connectés : la décrire entièrement
 * figerait un contrat que la base ne garantit pas. `any` est ici assumé pour
 * cette raison précise, et cantonné à ce seul alias plutôt que dispersé.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CockpitSnapshotValue = any;

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
  /** Devise de la boutique, code ISO 4217, ou `null` si indéterminée. */
  currency: string | null;
  /** Devise de la dépense publicitaire, qui peut différer de celle de la boutique. */
  adSpendCurrency: string | null;
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
      | { payload: Record<string, CockpitSnapshotValue>; fetched_at: string }
      | undefined;
    const snap = snapRow?.payload ?? null;

    const revenue = snap?.shopify?.revenue_30d ?? store.monthly_revenue ?? null;
    const orders = snap?.shopify?.orders_30d ?? null;
    const aov = snap?.shopify?.aov ?? (revenue && orders ? revenue / orders : null);

    // La devise de référence est celle de la boutique. Les montants saisis par
    // l'utilisateur (objectif, charges fixes, budget publicitaire) sont exprimés
    // dans cette même devise : c'est celle que l'interface affiche à la saisie.
    const currency = normalizeCurrency(store.currency);

    // Les comptes publicitaires ont leur propre devise, qui n'est pas forcément
    // celle de la boutique. Additionner Meta et Google, ou retrancher la dépense
    // du chiffre d'affaires, n'a de sens que si tout coïncide. Sinon on ne
    // calcule rien : un nombre faux serait pire qu'une absence.
    const spendParts: Array<{ amount: number; currency: string | null }> = [];
    if (snap?.meta?.spend != null) {
      spendParts.push({ amount: snap.meta.spend, currency: normalizeCurrency(snap.meta.currency) });
    }
    if (snap?.google?.cost != null) {
      spendParts.push({
        amount: snap.google.cost,
        currency: normalizeCurrency(snap.google.currency),
      });
    }

    const unavailable: string[] = [...((snap?.unavailable as string[]) ?? [])];

    let adSpend: number | null = null;
    let adSpendCurrency: string | null = null;
    if (spendParts.length > 0) {
      const currencies = new Set(spendParts.map((p) => p.currency));
      if (currencies.size === 1 && spendParts[0].currency !== null) {
        adSpend = spendParts.reduce((sum, p) => sum + p.amount, 0);
        adSpendCurrency = spendParts[0].currency;
      } else {
        unavailable.push(
          currencies.has(null)
            ? "Dépenses publicitaires : devise d'un compte non déterminée, total non calculé."
            : `Dépenses publicitaires en devises différentes (${[...currencies].join(", ")}) : total non calculé, aucune conversion disponible.`,
        );
      }
    } else if (store.monthly_ad_budget != null) {
      // Budget déclaré par l'utilisateur : exprimé dans la devise de la boutique.
      adSpend = store.monthly_ad_budget;
      adSpendCurrency = currency;
    }

    const spendComparable =
      adSpend != null && adSpendCurrency !== null && adSpendCurrency === currency;
    if (adSpend != null && !spendComparable) {
      unavailable.push(
        `Rentabilité non calculée : la dépense publicitaire (${adSpendCurrency ?? "devise inconnue"}) et le chiffre d'affaires (${currency ?? "devise inconnue"}) ne sont pas dans la même devise.`,
      );
    }

    const roas =
      snap?.meta?.roas ?? (revenue && adSpend && spendComparable ? revenue / adSpend : null);

    const costRatio = store.avg_product_cost_ratio ?? null;
    // La marge est un pourcentage du chiffre d'affaires : elle reste dans sa devise.
    const margin = revenue != null && costRatio != null ? revenue * (1 - costRatio) : null;
    // Le bénéfice retranche la dépense publicitaire : il exige la même devise.
    const profit =
      margin != null && spendComparable
        ? margin - (adSpend ?? 0) - (store.fixed_costs_monthly ?? 0)
        : null;

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

      priorities = (findings ?? []).map((f: Record<string, CockpitSnapshotValue>) => ({
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
      currency,
      adSpendCurrency,
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
      unavailable,
      priorities,
    };
  });
