import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles, Store as StoreIcon, TrendingUp } from "lucide-react";
import { ScoreRing } from "@/components/ScoreRing";
import { Cockpit } from "@/components/Cockpit";
import { useEffect } from "react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Tableau de bord — EcomPilot AI" },
      { name: "description", content: "Vue d'ensemble de tes boutiques et audits." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const navigate = useNavigate();
  const storesQ = useQuery({
    queryKey: ["stores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stores")
        .select("*, audits(id, score, status, created_at, verdict)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (storesQ.data && storesQ.data.length === 0) {
      navigate({ to: "/onboarding" });
    }
  }, [storesQ.data, navigate]);

  return (
    <AppShell>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold">Salut 👋</h1>
          <p className="mt-1 text-sm text-muted-foreground">Voici l'état de tes boutiques.</p>
        </div>
        <Link to="/onboarding">
          <Button variant="outline">
            <StoreIcon className="mr-2 h-4 w-4" /> Nouvelle boutique
          </Button>
        </Link>
      </div>

      {storesQ.data && storesQ.data.length > 0 && (
        <div className="mb-10">
          <Cockpit storeId={storesQ.data[0]!.id} />
        </div>
      )}

      {storesQ.isLoading ? (
        <div className="text-sm text-muted-foreground">Chargement...</div>
      ) : !storesQ.data || storesQ.data.length === 0 ? (
        <EmptyState
          title="Aucune boutique pour l'instant"
          description="Ajoute ta première boutique pour lancer ton premier audit gratuit."
          actionLabel="Ajouter ma boutique"
          onAction={() => navigate({ to: "/onboarding" })}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {storesQ.data.map((store) => {
            const latest = (store.audits as Array<{ id: string; score: number | null; status: string; verdict: string | null; created_at: string }>)
              ?.filter((a) => a.status === "completed")
              .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
            return (
              <Link
                key={store.id}
                to="/stores/$storeId"
                params={{ storeId: store.id }}
                className="card-elevated group rounded-2xl p-6 transition-all hover:border-primary/40"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">
                      {store.niche || "Boutique"}
                    </div>
                    <h3 className="mt-1 font-display text-xl font-bold">{store.name}</h3>
                    {store.url && (
                      <div className="mt-1 truncate text-xs text-muted-foreground">{store.url}</div>
                    )}
                  </div>
                  {latest?.score != null && <ScoreRing score={latest.score} size={64} />}
                </div>
                {latest ? (
                  <p className="mt-4 line-clamp-2 text-sm text-muted-foreground">
                    {latest.verdict}
                  </p>
                ) : (
                  <div className="mt-4 flex items-center gap-2 text-sm text-primary">
                    <Sparkles className="h-4 w-4" />
                    Prête à être auditée
                  </div>
                )}
                <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" />
                    {store.monthly_revenue ? `${store.monthly_revenue} €/mois` : "CA à définir"}
                  </span>
                  <span className="flex items-center gap-1 text-primary group-hover:translate-x-1 transition-transform">
                    Ouvrir <ArrowRight className="h-3 w-3" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
