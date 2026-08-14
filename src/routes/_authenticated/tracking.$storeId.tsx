import { formatMoney } from "@/lib/currency";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getStoreTracking, refreshTracking } from "@/lib/tracking.functions";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowDownRight,
  ArrowUpRight,
  Loader2,
  Minus,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/tracking/$storeId")({
  head: () => ({
    meta: [
      { title: "Suivi des gains — EcomPilot AI" },
      {
        name: "description",
        content: "Compare tes indicateurs avant et après chaque correction appliquée par l'IA.",
      },
      { property: "og:title", content: "Suivi des gains — EcomPilot AI" },
      {
        property: "og:description",
        content: "Avant / après : conversion, CTR, ROAS et alertes quand les gains n'arrivent pas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TrackingPage,
});

type Delta = {
  /** Devise du montant pour les métriques monétaires, `null` sinon ou si inconnue. */
  currency: string | null;
  key: string;
  label: string;
  channel: "shopify" | "meta" | "google";
  format: "currency" | "number" | "percent" | "ratio";
  before: number | null;
  after: number | null;
  change_pct: number | null;
  higher_is_better: boolean;
};

type Outcome = {
  id: string;
  applied_at: string;
  checked_at: string | null;
  status: "measuring" | "on_track" | "underperforming" | "regressed";
  alert_message: string | null;
  expected_gain_min: number | null;
  expected_gain_max: number | null;
  delta: Delta[] | null;
  audit_findings: {
    id: string;
    title: string;
    category: string;
    severity: string;
    audit_id: string;
  } | null;
};

const STATUS_META: Record<Outcome["status"], { label: string; className: string }> = {
  measuring: { label: "Mesure en cours", className: "bg-muted text-muted-foreground" },
  on_track: { label: "Gains confirmés", className: "bg-primary/15 text-primary" },
  underperforming: { label: "Gains absents", className: "bg-yellow-500/15 text-yellow-500" },
  regressed: { label: "En recul", className: "bg-destructive/15 text-destructive" },
};

function fmt(value: number | null, format: Delta["format"], currency: string | null = null) {
  if (value == null) return "—";
  // Chaque métrique monétaire porte sa devise : jamais de symbole supposé.
  if (format === "currency") return formatMoney(value, currency);
  if (format === "percent") return `${value.toFixed(2)} %`;
  if (format === "ratio") return `${value.toFixed(2)}x`;
  return value.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
}

function TrackingPage() {
  const { storeId } = Route.useParams();
  const queryClient = useQueryClient();
  const getTracking = useServerFn(getStoreTracking);
  const refresh = useServerFn(refreshTracking);

  const trackingQ = useQuery({
    queryKey: ["tracking", storeId],
    queryFn: async () => (await getTracking({ data: { storeId } })) as unknown as Outcome[],
  });

  const refreshM = useMutation({
    mutationFn: async () => refresh({ data: { storeId } }),
    onSuccess: () => {
      toast.success("Indicateurs remesurés.");
      queryClient.invalidateQueries({ queryKey: ["tracking", storeId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Mesure impossible"),
  });

  const outcomes = trackingQ.data ?? [];
  const alerts = outcomes.filter((o) => o.alert_message);

  return (
    <AppShell>
      <Link
        to="/stores/$storeId"
        params={{ storeId }}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="h-3 w-3" /> Retour à la boutique
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Suivi des gains</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ce que chaque correction a réellement changé : conversion, CTR, ROAS, chiffre
            d'affaires.
          </p>
        </div>
        <Button
          onClick={() => refreshM.mutate()}
          disabled={refreshM.isPending}
          className="bg-gradient-primary text-primary-foreground"
        >
          {refreshM.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Mesure...
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" /> Remesurer maintenant
            </>
          )}
        </Button>
      </div>

      {alerts.length > 0 && (
        <div className="mt-6 space-y-3">
          {alerts.map((o) => (
            <div
              key={`alert-${o.id}`}
              className="flex gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4"
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <div className="text-sm font-semibold">
                  {o.audit_findings?.title ?? "Correction appliquée"}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{o.alert_message}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 space-y-6">
        {trackingQ.isLoading ? (
          <div className="text-sm text-muted-foreground">Chargement...</div>
        ) : outcomes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            Aucune correction suivie pour l'instant. Applique une correction depuis un rapport
            d'audit, puis reviens ici pour voir l'avant / après.
          </div>
        ) : (
          outcomes.map((o) => {
            const meta = STATUS_META[o.status];
            const deltas = o.delta ?? [];
            return (
              <div key={o.id} className="card-elevated rounded-2xl p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-lg font-bold">
                      {o.audit_findings?.title ?? "Correction appliquée"}
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Appliquée le {new Date(o.applied_at).toLocaleDateString("fr-FR")}
                      {o.checked_at &&
                        ` · dernière mesure le ${new Date(o.checked_at).toLocaleDateString("fr-FR")}`}
                      {o.expected_gain_min != null && ` · gain estimé ${o.expected_gain_min}`}
                      {o.expected_gain_max != null && ` – ${o.expected_gain_max}`}
                    </p>
                  </div>
                  <Badge className={meta.className}>{meta.label}</Badge>
                </div>

                {deltas.length === 0 ? (
                  <p className="mt-4 text-sm text-muted-foreground">
                    Pas encore de mesure. Clique sur « Remesurer maintenant » (compte au moins 3
                    jours de recul pour un verdict fiable).
                  </p>
                ) : (
                  <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {deltas.map((d) => {
                      const good =
                        d.change_pct == null
                          ? null
                          : d.higher_is_better
                            ? d.change_pct > 0
                            : d.change_pct < 0;
                      const Icon =
                        d.change_pct == null || Math.abs(d.change_pct) < 0.5
                          ? Minus
                          : good
                            ? ArrowUpRight
                            : ArrowDownRight;
                      const tone =
                        d.change_pct == null || Math.abs(d.change_pct) < 0.5
                          ? "text-muted-foreground"
                          : good
                            ? "text-primary"
                            : "text-destructive";
                      return (
                        <div
                          key={d.key}
                          className="rounded-xl border border-border/60 bg-card/40 p-4"
                        >
                          <div className="text-xs uppercase tracking-wider text-muted-foreground">
                            {d.label}
                          </div>
                          <div className="mt-2 flex items-baseline gap-2">
                            <span className="text-sm text-muted-foreground line-through">
                              {fmt(d.before, d.format, d.currency)}
                            </span>
                            <span className="font-display text-xl font-bold">
                              {fmt(d.after, d.format, d.currency)}
                            </span>
                          </div>
                          <div
                            className={`mt-1 flex items-center gap-1 text-sm font-medium ${tone}`}
                          >
                            <Icon className="h-3.5 w-3.5" />
                            {d.change_pct == null
                              ? "—"
                              : `${d.change_pct > 0 ? "+" : ""}${d.change_pct.toFixed(1)} %`}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {o.audit_findings?.audit_id && (
                  <Link
                    to="/audits/$auditId"
                    params={{ auditId: o.audit_findings.audit_id }}
                    className="mt-4 inline-block text-sm text-primary hover:underline"
                  >
                    Voir le rapport d'audit
                  </Link>
                )}
              </div>
            );
          })
        )}
      </div>
    </AppShell>
  );
}
