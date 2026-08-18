import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, CardSkeleton, EmptyState, ErrorState } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { ScoreRing } from "@/components/ScoreRing";
import { formatMoney } from "@/lib/currency";
import { ArrowRight, Plug, PlugZap, Sparkles, Store as StoreIcon } from "lucide-react";
import { donneesOuLeve } from "@/integrations/supabase/throw-on-error";

/**
 * LA LISTE DES BOUTIQUES.
 *
 * CE QUE CETTE ROUTE ÉTAIT. Sept lignes, dont une redirection sèche vers le
 * tableau de bord. La barre de navigation portait pourtant « Mes boutiques »
 * depuis toujours, sur les deux tailles d'écran.
 *
 * CE QUE CELA PRODUISAIT. Trois entrées de navigation pour deux destinations.
 * Le marchand cliquait « Mes boutiques » et arrivait sur « Tableau de bord » —
 * avec, pour finir, la mauvaise entrée surlignée, puisque l'adresse était
 * devenue `/dashboard`. Une navigation qui répond autre chose que ce qu'elle
 * annonce est pire qu'une entrée manquante : elle apprend à ne pas s'y fier.
 *
 * CE QUE CETTE PAGE APPORTE QUE LE TABLEAU DE BORD N'A PAS. Le tableau de bord
 * est centré sur UNE boutique — le cockpit, le briefing, le prochain geste.
 * Cette page répond à l'autre question, celle qu'on se pose avec plusieurs
 * boutiques : « où en est chacune ? ». Elle montre donc ce que les cartes du
 * tableau de bord taisent : l'état des SOURCES DE DONNÉES. C'est la première
 * cause d'un audit décevant, et elle était invisible sans ouvrir chaque
 * boutique une par une.
 */
export const Route = createFileRoute("/_authenticated/stores/")({
  head: () => ({
    meta: [
      { title: "Mes boutiques — EcomPilot AI" },
      { name: "description", content: "Toutes vos boutiques et l'état de leurs connexions." },
    ],
  }),
  component: StoresIndex,
});

type AuditRésumé = {
  id: string;
  score: number | null;
  status: string;
  verdict: string | null;
  created_at: string;
};

function StoresIndex() {
  const navigate = useNavigate();

  const q = useQuery({
    queryKey: ["stores-with-connections"],
    queryFn: async () => {
      const data = donneesOuLeve(
        await supabase
          .from("stores")
          .select(
            "*, audits(id, score, status, created_at, verdict), data_connections(provider, status)",
          )
          .order("created_at", { ascending: false }),
      );
      return data;
    },
  });

  return (
    <AppShell>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Mes boutiques</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {q.data && q.data.length > 0
              ? `${q.data.length} boutique${q.data.length > 1 ? "s" : ""} · l'état de chacune et de ses sources de données.`
              : "L'état de chacune de vos boutiques et de ses sources de données."}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/onboarding">
            <StoreIcon className="mr-2 h-4 w-4" /> Nouvelle boutique
          </Link>
        </Button>
      </div>

      {/* L'échec avant le vide : sur erreur, `data` est indéfini, et la branche
          suivante annoncerait « aucune boutique » à un marchand qui en a. */}
      {q.isLoading ? (
        <CardSkeleton />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : !q.data || q.data.length === 0 ? (
        <EmptyState
          title="Aucune boutique pour l'instant"
          description="Ajoutez votre première boutique pour lancer votre premier diagnostic."
          actionLabel="Ajouter ma boutique"
          onAction={() => void navigate({ to: "/onboarding" })}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {q.data.map((store) => {
            const audits = (store.audits ?? []) as AuditRésumé[];
            const dernier = audits
              .filter((a) => a.status === "completed")
              .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];

            const connexions = (store.data_connections ?? []) as Array<{
              provider: string;
              status: string;
            }>;
            const actives = connexions.filter((c) => c.status === "active");

            return (
              <div key={store.id} className="card-elevated flex flex-col rounded-2xl p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">
                      {store.niche || "Boutique"}
                    </div>
                    <h2 className="mt-1 truncate font-display text-xl font-bold">{store.name}</h2>
                    {store.url && (
                      <div className="mt-1 truncate text-xs text-muted-foreground">{store.url}</div>
                    )}
                  </div>
                  {dernier && <ScoreRing score={dernier.score} size={64} />}
                </div>

                {dernier ? (
                  <p className="mt-4 line-clamp-2 text-sm text-muted-foreground">
                    {dernier.verdict}
                  </p>
                ) : (
                  <div className="mt-4 flex items-center gap-2 text-sm text-primary">
                    <Sparkles className="h-4 w-4" /> Prête à être auditée
                  </div>
                )}

                {/*
                  L'ÉTAT DES SOURCES, ICI ET NULLE PART AILLEURS. Une boutique
                  sans connexion produit un audit fondé sur les seuls chiffres
                  saisis à la main. Le diagnostic paraît alors pauvre, et rien
                  n'expliquait pourquoi : il fallait ouvrir la boutique pour
                  découvrir qu'aucune source n'était branchée.
                */}
                <div className="mb-6 mt-4 flex items-center gap-2 text-sm">
                  {actives.length > 0 ? (
                    <>
                      <PlugZap className="h-4 w-4 shrink-0 text-success" />
                      <span className="text-muted-foreground">
                        {actives.length} source{actives.length > 1 ? "s" : ""} connectée
                        {actives.length > 1 ? "s" : ""} :{" "}
                        {actives.map((c) => NOMS_DE_SOURCE[c.provider] ?? c.provider).join(", ")}
                      </span>
                    </>
                  ) : (
                    <>
                      <Plug className="h-4 w-4 shrink-0 text-warning" />
                      <span className="text-muted-foreground">
                        Aucune source connectée — le diagnostic n'aura que vos chiffres saisis.
                      </span>
                    </>
                  )}
                </div>

                {/* `mt-auto` colle le pied de carte en bas : sans lui, deux
                    cartes côte à côte dont l'une porte un verdict long et
                    l'autre non alignent leurs actions à des hauteurs
                    différentes, et la grille paraît bancale. */}
                <div className="mt-auto flex items-center justify-between gap-4 border-t border-border/50 pt-4">
                  <span className="text-xs text-muted-foreground">
                    {store.monthly_revenue
                      ? `${formatMoney(store.monthly_revenue, store.currency)}/mois`
                      : "Chiffre d'affaires à renseigner"}
                  </span>
                  <div className="flex items-center gap-2">
                    {dernier && (
                      <Button asChild variant="ghost" size="sm">
                        <Link to="/audits/$auditId" params={{ auditId: dernier.id }}>
                          Dernier rapport
                        </Link>
                      </Button>
                    )}
                    <Button asChild size="sm" variant="outline">
                      <Link to="/stores/$storeId" params={{ storeId: store.id }}>
                        Ouvrir <ArrowRight className="ml-1 h-3 w-3" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

/** Le nom que le marchand connaît, pas la clé technique. */
const NOMS_DE_SOURCE: Record<string, string> = {
  shopify: "Shopify",
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  ga4: "Google Analytics",
};
