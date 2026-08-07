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
  formatEur,
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
                ? `Potentiel identifié : ${formatEur(c.potentialMin)} à ${formatEur(c.potentialMax)} par mois.`
                : "Lance un diagnostic pour connaître ton potentiel."}
            </p>
          </div>
          {c.score != null && <ScoreRing score={c.score} size={80} />}
        </div>

        {goalPct != null && (
          <div className="mt-5">
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Target className="h-3 w-3" /> Objectif {formatEur(c.revenueGoal)}/mois
              </span>
              <span>{goalPct} %</span>
            </div>
            <Progress value={goalPct} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="CA 30 j" value={formatEur(c.revenue)} />
        <Kpi label="Commandes" value={c.orders != null ? String(c.orders) : "—"} />
        <Kpi label="Panier moyen" value={formatEur(c.aov)} />
        <Kpi label="Dépenses pub" value={formatEur(c.adSpend)} />
        <Kpi label="ROAS" value={c.roas != null ? `${c.roas.toFixed(2)}x` : "—"} />
        <Kpi label="Marge estimée" value={formatEur(c.margin)} hint="Après coût produit" />
        <Kpi label="Bénéfice estimé" value={formatEur(c.profit)} hint="Marge − pub − charges" />
        <Kpi
          label="Potentiel"
          value={c.potentialMax != null ? `+${formatEur(c.potentialMax)}` : "—"}
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
                        Impact : +{formatEur(p.impact_min)} à +{formatEur(p.impact_max)}/mois
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
