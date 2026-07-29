import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { ScoreRing } from "@/components/ScoreRing";
import { ConnectionsPanel } from "@/components/ConnectionsPanel";
import { runAudit } from "@/lib/audit.functions";
import { toast } from "sonner";
import { useState } from "react";
import { Sparkles, Loader2, ExternalLink, ArrowRight, Clock, CheckCircle2, XCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/stores/$storeId")({
  head: () => ({ meta: [{ title: "Boutique — EcomPilot AI" }] }),
  component: StorePage,
});

function StorePage() {
  const { storeId } = Route.useParams();
  const navigate = useNavigate();
  const runAuditFn = useServerFn(runAudit);
  const [launching, setLaunching] = useState(false);

  const storeQ = useQuery({
    queryKey: ["store", storeId],
    queryFn: async () => {
      const { data, error } = await supabase.from("stores").select("*").eq("id", storeId).single();
      if (error) throw error;
      return data;
    },
  });

  const auditsQ = useQuery({
    queryKey: ["audits", storeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audits")
        .select("*")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  async function handleAudit() {
    setLaunching(true);
    toast.info("Audit en cours... l'IA analyse ta boutique.");
    try {
      const res = await runAuditFn({ data: { storeId } });
      toast.success("Audit terminé !");
      navigate({ to: "/audits/$auditId", params: { auditId: res.auditId } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur audit");
    } finally {
      setLaunching(false);
    }
  }

  if (storeQ.isLoading) return <AppShell><div>Chargement...</div></AppShell>;
  if (!storeQ.data) return <AppShell><div>Boutique introuvable</div></AppShell>;
  const store = storeQ.data;

  return (
    <AppShell>
      <div className="mb-8">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{store.niche || "Boutique"}</div>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl font-bold">{store.name}</h1>
          {store.url && (
            <a
              href={store.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
            >
              <ExternalLink className="h-3 w-3" /> Voir la boutique
            </a>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Stat label="CA mensuel" value={store.monthly_revenue ? `${store.monthly_revenue} €` : "—"} />
        <Stat label="Budget pub" value={store.monthly_ad_budget ? `${store.monthly_ad_budget} €` : "—"} />
        <Stat label="Objectif" value={store.goal || "—"} />
      </div>

      <div className="mt-8">
        <ConnectionsPanel storeId={store.id} storeUrl={store.url} />
      </div>

      <div className="mt-8 card-elevated rounded-2xl p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold">Lancer un nouvel audit</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              L'IA analyse ta boutique et te sort un plan d'action en 2 min.
            </p>
          </div>
          <Button
            onClick={handleAudit}
            disabled={launching}
            className="bg-gradient-primary text-primary-foreground glow-primary"
            size="lg"
          >
            {launching ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyse en cours...</>
            ) : (
              <><Sparkles className="mr-2 h-4 w-4" /> Lancer l'audit</>
            )}
          </Button>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="mb-4 font-display text-xl font-bold">Historique</h2>
        {auditsQ.isLoading ? (
          <div className="text-sm text-muted-foreground">...</div>
        ) : !auditsQ.data || auditsQ.data.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Aucun audit pour l'instant. Lance le premier ci-dessus.
          </div>
        ) : (
          <div className="space-y-3">
            {auditsQ.data.map((a) => (
              <Link
                key={a.id}
                to="/audits/$auditId"
                params={{ auditId: a.id }}
                className="card-elevated flex items-center gap-4 rounded-xl p-4 transition-colors hover:border-primary/40"
              >
                {a.status === "completed" && a.score != null ? (
                  <ScoreRing score={a.score} size={56} />
                ) : a.status === "running" ? (
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
                    <XCircle className="h-5 w-5 text-destructive" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs uppercase text-muted-foreground flex items-center gap-1">
                    {a.status === "completed" && <CheckCircle2 className="h-3 w-3 text-success" />}
                    {a.status === "running" && <Clock className="h-3 w-3" />}
                    {new Date(a.created_at).toLocaleString("fr-FR")}
                  </div>
                  <div className="mt-0.5 truncate font-medium">
                    {a.verdict || (a.status === "running" ? "En cours..." : "Audit échoué")}
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-elevated rounded-xl p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-lg font-bold truncate">{value}</div>
    </div>
  );
}
