import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Store,
  Settings,
  LogOut,
  Rocket,
  Plus,
  AlertTriangle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // La session est déjà en mémoire côté client : cette lecture ne déclenche pas
  // d'appel réseau, et son échec n'a aucune conséquence — le cadre s'affiche
  // sans l'adresse plutôt que de faire tomber toutes les pages avec lui.
  const sessionQ = useQuery({
    queryKey: ["session-email"],
    queryFn: async () => (await supabase.auth.getSession()).data.session?.user.email ?? null,
    staleTime: 5 * 60 * 1000,
  });
  const email = sessionQ.data ?? null;

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  /*
    UN SEUL MOT PAR DESTINATION.

    LE DÉFAUT. La barre latérale disait « Tableau de bord », « Mes boutiques »,
    « Paramètres » ; la barre basse disait « Pilotage », « Boutiques »,
    « Réglages ». Six mots pour trois endroits. Un marchand qui passe du
    téléphone à l'ordinateur — le cas ordinaire : on consulte sur l'un, on
    corrige sur l'autre — devait apprendre deux vocabulaires pour la même
    application, et ne pouvait pas être sûr que « Pilotage » et « Tableau de
    bord » menaient au même endroit.

    Les libellés sont désormais identiques. « Boutiques » perd son « Mes » sur
    la barre basse, où la place manque réellement — c'est un raccourcissement du
    même mot, pas un autre mot.
  */
  const navItems = [
    { to: "/dashboard", label: "Tableau de bord", shortLabel: "Tableau", icon: LayoutDashboard },
    { to: "/stores", label: "Mes boutiques", shortLabel: "Boutiques", icon: Store },
    { to: "/settings", label: "Paramètres", shortLabel: "Paramètres", icon: Settings },
  ];

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 border-r border-border/50 bg-sidebar md:flex md:flex-col">
        <div className="border-b border-border/50 p-6">
          <Link to="/dashboard" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-primary">
              <Rocket className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-display font-bold">EcomPilot AI</span>
          </Link>
        </div>
        <nav className="flex-1 space-y-1 p-4">
          {navItems.map((item) => {
            const active = pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent/10 hover:text-foreground"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        {/*
          QUI EST CONNECTÉ. Aucun écran ne le disait. Le produit gère plusieurs
          boutiques et se destine à des gens qui ont souvent deux adresses — une
          personnelle, une professionnelle : rien ne permettait de savoir dans
          quel compte on se trouvait, ni pourquoi la boutique attendue n'y était
          pas. L'adresse est tronquée par le milieu plutôt que coupée, pour que
          le domaine reste lisible : c'est lui qui distingue deux comptes.
        */}
        <div className="border-t border-border/50 p-4">
          {email && (
            <div className="mb-2 px-3">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Connecté en tant que
              </div>
              <div className="truncate text-sm" title={email}>
                {email}
              </div>
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={signOut} className="w-full justify-start">
            <LogOut className="mr-2 h-4 w-4" />
            Se déconnecter
          </Button>
        </div>
      </aside>

      {/*
        `min-w-0` N'EST PAS UN DÉTAIL : c'est ce qui laisse la page rétrécir.

        MESURÉ AU NAVIGATEUR, à 320 px de large : le document de la page boutique
        faisait 1065 px — plus de trois fois le cadre. Toute la page défilait
        latéralement, l'en-tête compris, et il fallait balayer de côté pour lire
        la moindre phrase.

        LA CAUSE. Un élément flexible a `min-width: auto` par défaut : il refuse
        de descendre sous la largeur intrinsèque de son contenu. Il suffit donc
        d'UN descendant large — un tableau, une adresse qui ne se coupe pas, un
        élément en `whitespace-nowrap` — pour que ce conteneur s'élargisse, et
        avec lui l'application entière. Le contenu n'a jamais reçu l'autorisation
        de se réduire ; il l'a maintenant, et ce qui déborde déborde
        localement, dans son propre cadre, au lieu d'emporter la page.
      */}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-border/50 bg-background/60 px-6 py-3 backdrop-blur md:hidden">
          <Link to="/dashboard" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-primary">
              <Rocket className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-display font-bold">EcomPilot AI</span>
          </Link>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="h-4 w-4" />
          </Button>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8 pb-24 md:pb-8">{children}</main>

        {/*
          NAVIGATION MOBILE.

          POURQUOI ELLE MANQUAIT, ET CE QUE CELA COÛTAIT. La barre latérale est
          masquée en dessous de `md`, et l'en-tête mobile ne portait que le logo
          et la déconnexion. Sur un téléphone, l'application n'offrait donc
          AUCUN chemin vers les boutiques ni les paramètres : un marchand y
          était enfermé sur le tableau de bord, sans autre issue que de se
          déconnecter. Les tests passaient — il n'y avait rien à casser.

          Barre basse plutôt que menu déroulant : elle ne demande aucun geste
          d'ouverture, ne dépend d'aucun état, et reste atteignable au pouce.
          Le contenu reçoit une marge basse correspondante pour que la dernière
          ligne d'une page ne finisse jamais dessous.
        */}
        <nav
          aria-label="Navigation principale"
          className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border/50 bg-background/95 backdrop-blur md:hidden"
        >
          {navItems.map((item) => {
            const active = pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={`flex flex-1 flex-col items-center gap-1 px-2 py-2 text-[11px] font-medium transition-colors ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <item.icon className="h-5 w-5" />
                {item.shortLabel}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

/**
 * L'ATTENTE, QUI DOIT OCCUPER LA PLACE DE CE QU'ELLE ANNONCE.
 *
 * CE QUI SE PASSAIT. Sept écrans affichaient l'attente par une ligne de texte
 * nue — « Chargement de votre pilotage... », « Chargement de l'historique… »,
 * « Chargement... ». Trois conséquences, toutes vérifiées à l'écran :
 *
 *   1. LE SAUT. Une ligne de 20 pixels est remplacée par un bloc de 600 : tout
 *      ce qui suit descend d'un coup. Sur la page boutique, le marchand qui
 *      commençait à lire ses connexions les voyait partir vers le bas.
 *   2. LA TAILLE INCONNUE. Rien n'indique si ce qui arrive est une ligne ou une
 *      page. L'attente paraît donc plus longue qu'elle ne l'est.
 *   3. L'IMPRESSION D'INACHEVÉ. Trois points de suspension sur fond vide, c'est
 *      ce qu'affiche une page à moitié construite. Pour un produit qui demande
 *      un accès à la boutique du marchand, cela se paie en confiance.
 *
 * CE QUE CES COMPOSANTS FONT. Ils occupent la FORME de ce qui va venir. Le saut
 * disparaît parce qu'il n'y a plus de changement de hauteur, et l'attente
 * devient lisible : on voit qu'un tableau arrive, et combien de lignes.
 *
 * `aria-busy` et un texte lisible par les lecteurs d'écran accompagnent chaque
 * ossature : une forme grise ne dit rien à qui ne la voit pas, et l'ancien texte
 * nu, lui, était au moins annoncé.
 */
function Ossature({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-foreground/[0.06] ${className}`} />;
}

/** Enveloppe commune : annonce l'attente une seule fois, pour tout le bloc. */
function ZoneEnAttente({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

/** Une carte de la même hauteur que celles de la grille des boutiques. */
export function CardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <ZoneEnAttente label="Chargement de vos boutiques">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="card-elevated rounded-2xl p-6">
            <Ossature className="h-3 w-24" />
            <Ossature className="mt-3 h-6 w-40" />
            <Ossature className="mt-2 h-3 w-52" />
            <Ossature className="mt-5 h-3 w-full" />
            <Ossature className="mt-2 h-3 w-2/3" />
            <div className="mt-6 flex items-center justify-between">
              <Ossature className="h-4 w-28" />
              <Ossature className="h-4 w-16" />
            </div>
          </div>
        ))}
      </div>
    </ZoneEnAttente>
  );
}

/** Des lignes d'égale hauteur : historique, listes, tableaux. */
export function ListSkeleton({
  rows = 3,
  label = "Chargement",
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <ZoneEnAttente label={label}>
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="card-elevated flex items-center gap-4 rounded-xl p-4">
            <Ossature className="h-10 w-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Ossature className="h-3 w-32" />
              <Ossature className="mt-2 h-4 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    </ZoneEnAttente>
  );
}

/** Le pilotage : un bloc haut, dont l'absence déplaçait toute la page. */
export function CockpitSkeleton() {
  return (
    <ZoneEnAttente label="Chargement de votre pilotage">
      <div className="card-elevated rounded-2xl p-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <Ossature className="h-28 w-28 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Ossature className="h-3 w-28" />
            <Ossature className="mt-3 h-7 w-4/5" />
            <Ossature className="mt-3 h-4 w-2/3" />
          </div>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border/60 p-4">
              <Ossature className="h-3 w-20" />
              <Ossature className="mt-2 h-6 w-24" />
            </div>
          ))}
        </div>
      </div>
    </ZoneEnAttente>
  );
}

/** La carte de plan des paramètres, qui précède le formulaire et le déplaçait. */
export function PlanSkeleton() {
  return (
    <ZoneEnAttente label="Chargement de votre plan">
      <div className="card-elevated rounded-2xl p-6">
        <div className="flex items-center justify-between gap-4">
          <Ossature className="h-5 w-32" />
          <Ossature className="h-6 w-20 rounded-full" />
        </div>
        <Ossature className="mt-4 h-2 w-full rounded-full" />
        <Ossature className="mt-3 h-3 w-48" />
      </div>
    </ZoneEnAttente>
  );
}

/** Attente à l'échelle d'une route entière, avant tout titre. */
export function PageSkeleton() {
  return (
    <ZoneEnAttente label="Chargement de la page">
      <Ossature className="h-3 w-24" />
      <Ossature className="mt-3 h-9 w-72" />
      <div className="mt-8">
        <CockpitSkeletonInterne />
      </div>
    </ZoneEnAttente>
  );
}

/** Même forme que `CockpitSkeleton`, sans sa propre annonce d'attente. */
function CockpitSkeletonInterne() {
  return (
    <div className="card-elevated rounded-2xl p-6">
      <Ossature className="h-5 w-48" />
      <Ossature className="mt-4 h-4 w-full" />
      <Ossature className="mt-2 h-4 w-5/6" />
      <Ossature className="mt-2 h-4 w-2/3" />
    </div>
  );
}

/**
 * L'ÉCHEC DE CHARGEMENT, QUI N'EST PAS UN VIDE.
 *
 * POURQUOI CE COMPOSANT EXISTE SÉPARÉMENT. Le tableau de bord affichait
 * « Aucune boutique pour l'instant » dès que la requête ne rendait pas de
 * données — y compris quand elle avait ÉCHOUÉ. Un marchand dont la connexion
 * hoquette voyait donc sa boutique disparaître et s'entendait proposer d'en
 * créer une nouvelle. Rien n'était perdu, mais il n'avait aucun moyen de le
 * savoir, et le geste proposé était le pire possible.
 *
 * Une absence de données et un échec de lecture ne se ressemblent pas et ne
 * doivent jamais s'afficher pareil : le premier appelle une création, le second
 * un nouvel essai.
 */
export function ErrorState({
  title = "Impossible de charger ces données",
  description = "La connexion au serveur a échoué. Vos données ne sont pas perdues — réessayez dans un instant.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="card-elevated flex flex-col items-center rounded-2xl p-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <h3 className="mt-4 font-display text-xl font-bold">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      {onRetry && (
        <Button onClick={onRetry} variant="outline" className="mt-6">
          Réessayer
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="card-elevated flex flex-col items-center rounded-2xl p-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Plus className="h-6 w-6" />
      </div>
      <h3 className="mt-4 font-display text-xl font-bold">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      {actionLabel && onAction && (
        <Button onClick={onAction} className="mt-6 bg-gradient-primary text-primary-foreground">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
