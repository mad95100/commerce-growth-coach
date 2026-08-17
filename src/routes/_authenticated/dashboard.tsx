import { formatMoney } from "@/lib/currency";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState, ErrorState } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles, Store as StoreIcon, TrendingUp } from "lucide-react";
import { ScoreRing } from "@/components/ScoreRing";
import { Cockpit } from "@/components/Cockpit";
import { useEffect } from "react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  // La boutique regardée vit dans l'adresse : le marchand peut la mettre en
  // signet, et un rechargement ne le renvoie pas ailleurs.
  validateSearch: z.object({ store: z.string().uuid().optional() }),
  head: () => ({
    meta: [
      { title: "Tableau de bord — EcomPilot AI" },
      { name: "description", content: "Vue d'ensemble de vos boutiques et audits." },
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

  /**
   * La boutique regardée.
   *
   * L'identifiant de l'adresse ne vient pas de nous : il est vérifié contre la
   * liste réellement chargée. Un identifiant inconnu — signet périmé, boutique
   * supprimée — retombe donc sur la première plutôt que d'afficher un cockpit
   * vide sans explication.
   */
  const search = Route.useSearch();
  const activeStore = storesQ.data?.find((s) => s.id === search.store) ??
    storesQ.data?.[0] ?? { id: "", name: "" };

  useEffect(() => {
    // Uniquement sur un succès qui rend zéro boutique. Sur erreur, `data` est
    // indéfini et la condition est fausse — mais on l'écrit explicitement pour
    // que personne ne « simplifie » un jour en `!storesQ.data`.
    if (storesQ.isSuccess && storesQ.data.length === 0) {
      navigate({ to: "/onboarding" });
    }
  }, [storesQ.isSuccess, storesQ.data, navigate]);

  return (
    <AppShell>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold">Salut 👋</h1>
          <p className="mt-1 text-sm text-muted-foreground">Voici l'état de vos boutiques.</p>
        </div>
        <Link to="/onboarding">
          <Button variant="outline">
            <StoreIcon className="mr-2 h-4 w-4" /> Nouvelle boutique
          </Button>
        </Link>
      </div>

      {/*
        LE COCKPIT MONTRAIT TOUJOURS LA PREMIÈRE BOUTIQUE, sans dire laquelle.
        Avec plusieurs boutiques, le marchand lisait donc des chiffres sans
        savoir à quoi ils se rapportaient — et n'avait aucun moyen d'en changer.
        Le pire des deux mondes : ni une vue d'ensemble, ni une vue choisie.

        Le choix est conservé dans l'adresse, pas dans un état local : le
        marchand peut ainsi mettre en signet la boutique qu'il regarde, et un
        rechargement ne le renvoie pas ailleurs.
      */}
      {storesQ.data && storesQ.data.length > 0 && (
        <div className="mb-10">
          {storesQ.data.length > 1 && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Boutique :</span>
              {storesQ.data.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => void navigate({ to: "/dashboard", search: { store: s.id } })}
                  aria-current={s.id === activeStore.id ? "true" : undefined}
                  className={`rounded-full px-3 py-1 text-sm transition-colors ${
                    s.id === activeStore.id
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-accent/10 hover:text-foreground"
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
          <Cockpit storeId={activeStore.id} />
        </div>
      )}

      {storesQ.isLoading ? (
        <div className="text-sm text-muted-foreground">Chargement...</div>
      ) : storesQ.isError ? (
        // L'ÉCHEC AVANT LE VIDE. Testé en premier délibérément : sur erreur,
        // `data` est indéfini, et la branche suivante annoncerait « aucune
        // boutique » à un marchand qui en a.
        <ErrorState onRetry={() => void storesQ.refetch()} />
      ) : !storesQ.data || storesQ.data.length === 0 ? (
        <EmptyState
          title="Aucune boutique pour l'instant"
          description="Ajoutez votre première boutique pour lancer votre premier audit gratuit."
          actionLabel="Ajouter ma boutique"
          onAction={() => navigate({ to: "/onboarding" })}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {storesQ.data.map((store) => {
            const latest = (
              store.audits as Array<{
                id: string;
                score: number | null;
                status: string;
                verdict: string | null;
                created_at: string;
              }>
            )
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
                  {/* Une boutique déjà auditée garde son anneau même sans
                      note : le faire disparaître laisserait croire qu'aucun
                      audit n'a eu lieu. */}
                  {latest && <ScoreRing score={latest.score} size={64} />}
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
                    {store.monthly_revenue
                      ? `${formatMoney(store.monthly_revenue, store.currency)}/mois`
                      : "CA à définir"}
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
