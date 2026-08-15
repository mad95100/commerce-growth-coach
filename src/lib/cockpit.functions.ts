import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeCurrency } from "@/lib/currency";
import {
  buildNextMovePlan,
  type MeasuredOutcome,
  type NextMovePlan,
  type PlannableFinding,
} from "@/lib/next-move";
import type { PriorityBand } from "@/lib/finding-graph";
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
  /** Bande de priorité, `null` sur les audits antérieurs au moteur causal. */
  band: PriorityBand | null;
  /** Pourquoi cette priorité, calculé à l'audit. `null` de même. */
  reason: string | null;
  /** Titres des problèmes que cette correction fait tomber. */
  unlocks: string[];
  /** Ce qu'il faudra regarder pour savoir si ça a marché, et sur quelle fenêtre. */
  measure: string;
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
  /**
   * Ce que ferait un directeur e-commerce maintenant, et pourquoi celui-là.
   * `null` tant qu'aucun diagnostic n'est terminé.
   */
  plan: NextMovePlan | null;
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
      { payload: Record<string, CockpitSnapshotValue>; fetched_at: string } | undefined;
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
    let plan: NextMovePlan | null = null;
    if (audit) {
      // TOUS les problèmes de l'audit, corrigés compris — et non les trois
      // premiers par score. La sélection ne peut plus se faire en SQL : savoir
      // si un problème est exécutable demande de connaître l'état de ses
      // causes, donc de les avoir toutes sous la main. Un audit compte quelques
      // dizaines de lignes ; les charger ne coûte rien et évite de proposer un
      // symptôme dont la cause est encore en place.
      const { data: findings } = await supabase
        .from("audit_findings")
        .select(
          "id, title, category, severity, status, estimated_gain_min, estimated_gain_max, difficulty, time_minutes, confidence, auto_correction, audit_id, finding_key, caused_by, priority_score, priority_band, priority_reason, epistemic_level, blocks_count, sort_order",
        )
        .eq("audit_id", audit.id)
        .order("sort_order");

      const rows = (findings ?? []) as PlannableFinding[];

      // Ce que les corrections déjà appliquées ont réellement produit. Une
      // régression prend la tête du plan : réparer un dégât passe avant tout
      // gain potentiel.
      const { data: measured } = await supabase
        .from("fix_outcomes")
        .select("finding_id, verdict, headline, rollback_recommended, rollback_possible, action_id")
        .eq("store_id", store.id)
        .not("verdict", "is", null);

      type MeasuredRow = {
        finding_id: string;
        verdict: string | null;
        headline: string | null;
        rollback_recommended: boolean | null;
        rollback_possible: boolean | null;
        action_id: string | null;
      };
      const titleById = new Map(rows.map((f) => [f.id, f.title]));
      const outcomes: MeasuredOutcome[] = ((measured ?? []) as MeasuredRow[])
        // Un suivi dont le problème appartient à un audit plus ancien n'a pas
        // de titre ici : on ne l'invente pas, on l'ignore.
        .filter((m) => titleById.has(m.finding_id))
        .map((m) => ({
          findingId: m.finding_id,
          title: titleById.get(m.finding_id)!,
          verdict: m.verdict,
          headline: m.headline,
          rollbackRecommended: m.rollback_recommended,
          rollbackPossible: m.rollback_possible,
          actionId: m.action_id,
        }));

      plan = buildNextMovePlan(rows, outcomes);

      // Les trois gestes du plan, dans l'ordre du plan, avec les champs
      // d'affichage que le centre de pilotage utilisait déjà.
      const byId = new Map(rows.map((f) => [f.id, f as Record<string, CockpitSnapshotValue>]));
      priorities = [plan.now, ...plan.then]
        .filter((move): move is NonNullable<typeof move> => Boolean(move))
        .map((move) => {
          const f = byId.get(move.id)!;
          return {
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
            band: move.band,
            reason: move.reason,
            unlocks: move.unlocks,
            measure: move.measure,
          };
        });
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
      plan,
    };
  });
