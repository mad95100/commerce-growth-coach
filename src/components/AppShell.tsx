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
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  // `shortLabel` sert la barre basse : sous un pouce, « Tableau de bord » sur
  // trois lignes est moins lisible qu'un mot.
  const navItems = [
    { to: "/dashboard", label: "Tableau de bord", shortLabel: "Pilotage", icon: LayoutDashboard },
    { to: "/stores", label: "Mes boutiques", shortLabel: "Boutiques", icon: Store },
    { to: "/settings", label: "Paramètres", shortLabel: "Réglages", icon: Settings },
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
        <div className="border-t border-border/50 p-4">
          <Button variant="ghost" size="sm" onClick={signOut} className="w-full justify-start">
            <LogOut className="mr-2 h-4 w-4" />
            Se déconnecter
          </Button>
        </div>
      </aside>

      <div className="flex-1">
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
  description = "La connexion au serveur a échoué. Tes données ne sont pas perdues — réessaie dans un instant.",
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
