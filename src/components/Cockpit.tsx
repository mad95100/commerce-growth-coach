import { UNDETERMINED_CURRENCY_LABEL, formatMoney } from "@/lib/currency";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { getCockpit } from "@/lib/cockpit.functions";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScoreRing } from "@/components/ScoreRing";
import {
  CATEGORY_LABELS,
  CONFIDENCE_LABELS,
  DIFFICULTY_LABELS,
  formatMinutes,
  type Category,
  type Confidence,
} from "@/lib/scoring";
import { AlertTriangle, ArrowRight, Clock, Gauge, Target, TrendingUp } from "lucide-react";

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/50 p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-xl font-bold">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function Cockpit({ storeId }: { storeId: string }) {
  const fetchCockpit = useServerFn(getCockpit);
  const q = useQuery({
    queryKey: ["cockpit", storeId],
    queryFn: () => fetchCockpit({ data: { storeId } }),
  });

  if (q.isLoading) {
    return <div className="text-sm text-muted-foreground">Chargement de ton pilotage...</div>;
  }
  if (!q.data) return null;
  const c = q.data;

  const goalPct =
    c.revenueGoal && c.revenueGoal > 0 && c.revenue != null
      ? Math.min(100, Math.round((c.revenue / c.revenueGoal) * 100))
      : null;

  return (
    <section className="space-y-6">
      {c.unavailable.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>
            Certaines données ne sont pas disponibles actuellement ({c.unavailable.join(", ")}). Le
            reste de l'analyse continue avec ce qui est accessible.
          </span>
        </div>
      )}

      <div className="card-elevated rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Score e-commerce
            </div>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              {c.potentialMin != null && c.potentialMax != null
                ? `Potentiel identifié : ${formatMoney(c.potentialMin, c.currency)} à ${formatMoney(c.potentialMax, c.currency)} par mois.`
                : "Lance un diagnostic pour connaître ton potentiel."}
            </p>
          </div>
          {c.score != null && <ScoreRing score={c.score} size={80} />}
        </div>

        {goalPct != null && (
          <div className="mt-5">
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Target className="h-3 w-3" /> Objectif {formatMoney(c.revenueGoal, c.currency)}
                /mois
              </span>
              <span>{goalPct} %</span>
            </div>
            <Progress value={goalPct} />
          </div>
        )}
      </div>

      {c.currency === null && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {UNDETERMINED_CURRENCY_LABEL} pour cette boutique. Les montants sont affichés sans unité
          tant que Shopify ne l'a pas renvoyée — aucune devise n'est supposée.
        </p>
      )}
      {c.adSpendCurrency !== null && c.currency !== null && c.adSpendCurrency !== c.currency && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Les dépenses publicitaires sont en {c.adSpendCurrency} alors que la boutique est en{" "}
          {c.currency}. Rentabilité et ROAS ne sont pas calculés : aucune conversion n'est
          disponible.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="CA 30 j" value={formatMoney(c.revenue, c.currency)} />
        <Kpi label="Commandes" value={c.orders != null ? String(c.orders) : "—"} />
        <Kpi label="Panier moyen" value={formatMoney(c.aov, c.currency)} />
        <Kpi label="Dépenses pub" value={formatMoney(c.adSpend, c.adSpendCurrency)} />
        <Kpi label="ROAS" value={c.roas != null ? `${c.roas.toFixed(2)}x` : "—"} />
        <Kpi
          label="Marge estimée"
          value={formatMoney(c.margin, c.currency)}
          hint="Après coût produit"
        />
        <Kpi
          label="Bénéfice estimé"
          value={formatMoney(c.profit, c.currency)}
          hint="Marge − pub − charges"
        />
        <Kpi
          label="Potentiel"
          value={c.potentialMax != null ? `+${formatMoney(c.potentialMax, c.currency)}` : "—"}
          hint="par mois"
        />
      </div>

      <div>
        <h2 className="font-display text-xl font-bold">Tes priorités aujourd'hui</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Trois actions maximum. On ne passe à la suite qu'une fois celles-ci faites.
        </p>

        {c.priorities.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
            Aucune priorité en attente. Lance un nouveau diagnostic pour trouver le prochain levier.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {c.priorities.map((p, i) => (
              <div key={p.id} className="card-elevated rounded-2xl p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="text-xs uppercase tracking-wider text-primary">
                      #{i + 1} — {CATEGORY_LABELS[p.category as Category] ?? p.category}
                    </div>
                    <h3 className="mt-1 font-display text-lg font-bold">{p.title}</h3>
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1 text-primary">
                        <TrendingUp className="h-3 w-3" />
                        Impact : +{formatMoney(p.impact_min, c.currency)} à +
                        {formatMoney(p.impact_max, c.currency)}/mois
                      </span>
                      <span className="flex items-center gap-1">
                        <Gauge className="h-3 w-3" />
                        {DIFFICULTY_LABELS[p.difficulty] ?? "Moyen"}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatMinutes(p.time_minutes)}
                      </span>
                      <span>
                        Confiance : {CONFIDENCE_LABELS[p.confidence as Confidence] ?? "Moyenne"}
                      </span>
                    </div>
                  </div>
                </div>
                <Link
                  to="/audits/$auditId"
                  params={{ auditId: p.audit_id }}
                  className="mt-4 inline-block"
                >
                  <Button className="bg-gradient-primary text-primary-foreground">
                    Faire maintenant <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
