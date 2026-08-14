import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getEntitlements } from "@/lib/actions.functions";
import { PLAN_LABELS, QUOTA_LABELS, type QuotaKey } from "@/lib/plans";

const SHOWN: QuotaKey[] = ["audits", "fixes"];

/**
 * Plan en cours et consommation du mois.
 *
 * N'affiche que les compteurs adossés à une fonctionnalité existante : le coach
 * a sa colonne en base mais aucun écran, montrer un solde pour quelque chose
 * d'inatteignable ne renseignerait personne.
 *
 * Affichage seul. La décision d'autoriser ou de refuser est prise côté serveur
 * au moment d'agir : ce qui est montré ici ne fait qu'informer.
 */
export function PlanUsageCard() {
  const fetchEntitlements = useServerFn(getEntitlements);
  const q = useQuery({
    queryKey: ["entitlements"],
    queryFn: () => fetchEntitlements({ data: undefined }),
  });

  if (q.isLoading) {
    return <div className="text-sm text-muted-foreground">Chargement de ton plan...</div>;
  }
  if (!q.data) return null;
  const e = q.data;

  const periodLabel = new Date(`${e.periodStart}T00:00:00Z`).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="rounded-2xl border border-border/60 bg-card/50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold">Plan {PLAN_LABELS[e.tier]}</h2>
        <span className="text-xs text-muted-foreground">Période : {periodLabel}</span>
      </div>

      <div className="mt-4 space-y-3">
        {SHOWN.map((key) => {
          const used = e.used[key];
          const left = e.remaining[key];
          const unlimited = left === null;
          const total = unlimited ? null : used + left;
          const pct = total && total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

          return (
            <div key={key}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="capitalize text-muted-foreground">{QUOTA_LABELS[key]}</span>
                <span className={!unlimited && left === 0 ? "text-destructive" : ""}>
                  {unlimited ? `${used} utilisés · sans limite` : `${used} / ${total} utilisés`}
                </span>
              </div>
              {!unlimited && (
                <div className="h-1.5 overflow-hidden rounded-full bg-border/60">
                  <div
                    className={`h-full rounded-full ${left === 0 ? "bg-destructive" : "bg-gradient-primary"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {e.tier === "free" && (
        <p className="mt-4 text-xs text-muted-foreground">
          Les compteurs repartent à zéro le 1er de chaque mois.
        </p>
      )}
    </div>
  );
}
