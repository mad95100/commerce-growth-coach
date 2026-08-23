import { formatMoney } from "@/lib/currency";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, CardSkeleton, EmptyState, ErrorState } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles, Store as StoreIcon, TrendingUp } from "lucide-react";
import { ScoreRing } from "@/components/ScoreRing";
import { Cockpit } from "@/components/Cockpit";
import { useEffect } from "react";
import { donneesOuLeve } from "@/integrations/supabase/throw-on-error";

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
      const data = donneesOuLeve(
        await supabase
          .from("stores")
          .select("*, audits(id, score, status, created_at, verdict)")
          .order("created_at", { ascending: false }),
      );
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
      {/*
        LE TITRE DIT OÙ L'ON EST, PAS BONJOUR.

        « Salut 👋 » occupait le titre de niveau 1 de la page la plus consultée
        du produit. Un emoji en guise de titre, et pas un mot sur ce que l'écran
        contient : ni le nom de la boutique regardée, ni la date de ce qui est
        montré. C'est la première chose que voit un marchand qui vient vérifier
        ses chiffres, et cela ne l'informe de rien.

        `flex-wrap` et `items-start` : sur téléphone, le titre et le bouton se
        chevauchaient, le second poussant le premier sur deux lignes.
      */}
      {/*
        L'EN-TÊTE BRÛLAIT LE PREMIER ÉCRAN MOBILE.

        Mesuré au navigateur, à 390 px : « Tableau de bord » en 30 px, une
        phrase de contexte sur deux lignes, puis un bouton « Nouvelle
        boutique » occupant sa propre rangée. Le marchand faisait défiler tout
        cela AVANT de voir un seul chiffre. Sur l'écran qui doit répondre à
        « comment va ma boutique ? », le premier tiers ne répondait rien.

        Trois corrections, dans cet ordre d'importance :

        · Le titre passe en `text-xl` : il nomme la page, il n'est pas la page.
          Le nom de la BOUTIQUE monte à sa place — c'est lui qui dit de quoi on
          parle quand on en a plusieurs.
        · La phrase de contexte disparaît. Elle disait « Ce que nous voyons
          aujourd'hui sur Atelier Lumen » : le titre et le sélecteur le disaient
          déjà, deux fois.
        · « Nouvelle boutique » redevient une action secondaire — icône seule
          sur mobile, libellé à partir de `sm`. Ce n'est pas ce que le marchand
          vient faire ici.
      */}
      <div className="mb-6 flex items-center justify-between gap-3">
        {/* Avec plusieurs boutiques, le sélecteur juste en dessous nomme déjà
            celle qui est affichée : répéter son nom dans le titre écrivait la
            même chose deux fois, à deux lignes d'intervalle. Avec une seule
            boutique il n'y a pas de sélecteur, et c'est le titre qui la nomme. */}
        <h1 className="min-w-0 truncate font-display text-xl font-bold">
          {(storesQ.data?.length ?? 0) > 1
            ? "Tableau de bord"
            : activeStore.name || "Tableau de bord"}
        </h1>
        <Link to="/onboarding" className="shrink-0">
          <Button variant="outline" size="sm" aria-label="Ajouter une boutique">
            <StoreIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Ajouter</span>
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
          {/*
            LE SÉLECTEUR DE BOUTIQUE, RENDU VISIBLE COMME UN CHOIX.

            CE QU'IL ÉTAIT. « Boutique : » suivi de noms nus. Seul l'élément
            ACTIF portait un fond ; les autres étaient du texte gris, sans
            bordure ni relief. Rien n'annonçait qu'ils étaient cliquables — un
            marchand à deux boutiques ne pouvait pas deviner qu'il pouvait
            changer de vue, et lisait donc les chiffres de la première en
            croyant qu'il n'y avait rien d'autre.

            Sur téléphone, c'était pire : la deuxième boutique passait à la
            ligne, alignée nulle part, et se lisait comme une phrase égarée.

            CE QU'IL EST. Un groupe d'onglets déclaré comme tel, dans un cadre
            qui montre où le choix commence et où il finit. Les options
            inactives portent une bordure : elles se voient et s'atteignent au
            pouce. Le groupe défile horizontalement plutôt que de se replier,
            pour qu'une boutique de plus ne casse pas la mise en page.
          */}
          {storesQ.data.length > 1 && (
            <div
              role="tablist"
              aria-label="Choisir la boutique à afficher"
              className="mb-5 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
            >
              {storesQ.data.map((s) => {
                const actif = s.id === activeStore.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={actif}
                    onClick={() => void navigate({ to: "/dashboard", search: { store: s.id } })}
                    className={`shrink-0 rounded-full border px-4 py-1.5 text-sm transition-colors ${
                      actif
                        ? "border-primary/40 bg-primary/10 font-medium text-primary"
                        : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
                    }`}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
          )}
          <Cockpit storeId={activeStore.id} />
        </div>
      )}

      {storesQ.isLoading ? (
        <CardSkeleton />
      ) : storesQ.isError ? (
        // L'ÉCHEC AVANT LE VIDE. Testé en premier délibérément : sur erreur,
        // `data` est indéfini, et la branche suivante annoncerait « aucune
        // boutique » à un marchand qui en a.
        <ErrorState onRetry={() => void storesQ.refetch()} />
      ) : !storesQ.data || storesQ.data.length === 0 ? (
        <EmptyState
          title="Aucune boutique connectée"
          description="Connectez votre boutique pour lancer un premier diagnostic. Nous lisons votre catalogue, vos commandes et les pages que vos visiteurs reçoivent, puis nous vous disons ce qui bloque — avec la preuve de chaque constat."
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
                className="card-elevated group min-w-0 rounded-2xl p-6 transition-all hover:border-primary/40"
              >
                {/* `min-w-0` sur la colonne flexible, sans quoi `truncate` ne
                    tronque rien : une adresse de boutique ne comporte aucune
                    coupure possible, la colonne prend sa largeur entière et la
                    carte déborde du cadre. Mesuré à 320 px : 343 px de large. */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs uppercase tracking-wider text-muted-foreground">
                      {store.niche || "Boutique"}
                    </div>
                    <h2 className="mt-1 truncate font-display text-xl font-bold">{store.name}</h2>
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
                    Prête pour un premier diagnostic
                  </div>
                )}
                <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" />
                    {store.monthly_revenue
                      ? `${formatMoney(store.monthly_revenue, store.currency)}/mois`
                      : "Chiffre d'affaires à renseigner"}
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
