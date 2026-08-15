import { UNDETERMINED_CURRENCY_LABEL, formatMoney } from "@/lib/currency";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { getCockpit } from "@/lib/cockpit.functions";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScoreRing } from "@/components/ScoreRing";
import { BriefingCard } from "@/components/BriefingCard";
import { FunnelView } from "@/components/FunnelView";
import { WORK_STATE_LABELS, type WorkState } from "@/lib/briefing";
import {
  CATEGORY_LABELS,
  CONFIDENCE_LABELS,
  DIFFICULTY_LABELS,
  formatMinutes,
  type Category,
  type Confidence,
} from "@/lib/scoring";
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  Compass,
  Gauge,
  GitBranch,
  Target,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";

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

      {/* La régression est portée par le briefing lui-même, qui bascule en mode
          alerte : deux encarts disant la même chose se feraient concurrence. */}

      {/* LE BRIEFING. Neuf questions dans l'ordre où on se les pose, assemblées
          depuis le moteur — rien n'est écrit en dur. C'est ce qu'on lit en
          arrivant, avant toute statistique. */}
      {c.briefing && (
        <BriefingCard
          briefing={c.briefing}
          auditId={c.priorities[0]?.audit_id ?? null}
          storeId={storeId}
        />
      )}

      {/* L'entonnoir mesuré. Les étapes non mesurées y apparaissent comme
          telles, jamais comme des barres à zéro. */}
      {c.funnel && <FunnelView funnel={c.funnel} />}

      {/* Où en est chaque chantier. Remplace la liste indifférenciée : le
          marchand voit ce qui reste, ce qui attend, ce qui est acquis. */}
      {c.briefing && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {(Object.keys(WORK_STATE_LABELS) as WorkState[])
            .filter((state) => c.work[state] > 0)
            .map((state) => (
              <div key={state} className="rounded-xl border border-border/60 bg-card/50 p-3">
                <div className="font-display text-xl font-bold">{c.work[state]}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {WORK_STATE_LABELS[state]}
                </div>
              </div>
            ))}
        </div>
      )}

      {/* La réponse du directeur, avant la liste. C'est elle qu'on lit en
          arrivant : un seul geste, et pourquoi celui-là. */}
      {c.plan && !c.briefing && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-6">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-primary">
            <Compass className="h-4 w-4" /> Ce que je ferais maintenant
          </div>
          <p className="mt-3 text-sm leading-relaxed">{c.plan.rationale}</p>

          {/* PROUVER : ce qui a marché, mesuré, pas supposé. */}
          {c.plan.proven.length > 0 && (
            <ul className="mt-4 space-y-1">
              {c.plan.proven.map((p) => (
                <li key={p.findingId} className="text-sm text-primary">
                  ✅ {p.title}
                  {p.headline && <span className="text-muted-foreground"> — {p.headline}</span>}
                </li>
              ))}
            </ul>
          )}
          {/* APPRENDRE : ce qui n'a rien donné. Y revenir serait du temps perdu. */}
          {c.plan.ineffective.length > 0 && (
            <ul className="mt-2 space-y-1">
              {c.plan.ineffective.map((p) => (
                <li key={p.findingId} className="text-sm text-muted-foreground">
                  ❌ {p.title} — sans effet mesurable, ce n'était pas le blocage.
                </li>
              ))}
            </ul>
          )}
          {c.plan.now && (
            <Link
              to="/audits/$auditId"
              params={{ auditId: c.plan.now.auditId ?? "" }}
              className="mt-4 inline-block"
            >
              <Button className="bg-gradient-primary text-primary-foreground">
                Commencer par « {c.plan.now.title} » <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          )}
        </div>
      )}

      <div>
        <h2 className="font-display text-xl font-bold">Tes priorités aujourd'hui</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Trois actions maximum, dans cet ordre. Une cause passe toujours avant ce qu'elle provoque
          — corriger un symptôme sans sa cause ne donne rien.
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
                    {p.unlocks.length > 0 && (
                      <p className="mt-3 flex items-start gap-1.5 text-xs text-primary">
                        <GitBranch className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>
                          Fait tomber aussi : {p.unlocks.map((u) => `« ${u} »`).join(", ")}.
                        </span>
                      </p>
                    )}
                    {p.reason && <p className="mt-2 text-xs text-muted-foreground">{p.reason}</p>}
                    <p className="mt-2 text-xs text-muted-foreground">
                      Ensuite, regarde {p.measure}.
                    </p>
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

        {/* Ce qui attend, et ce qui l'attend. Le dire évite la question
            « pourquoi ce problème grave n'est-il pas dans la liste ? ». */}
        {c.plan && c.plan.blocked.length > 0 && (
          <div className="mt-4 rounded-xl border border-dashed border-border p-4">
            <div className="text-sm font-medium">
              {c.plan.blocked.length} problème{c.plan.blocked.length > 1 ? "s" : ""} en attente
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Rien à faire dessus pour l'instant : ils viennent de ce qui est au-dessus. Ils
              disparaissent peut-être tout seuls.
            </p>
            <ul className="mt-3 space-y-1.5">
              {c.plan.blocked.map((b) => (
                <li key={b.id} className="text-sm">
                  • {b.title}{" "}
                  <span className="text-muted-foreground">
                    — après {b.blockedBy.map((t) => `« ${t} »`).join(" et ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
