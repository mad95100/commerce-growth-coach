import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Rocket } from "lucide-react";

import appCss from "../styles.css?url";
import { reportError } from "../lib/error-reporting";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";

/**
 * LA SORTIE DE SECOURS RENVOYAIT LE MARCHAND À LA PAGE DE VENTE.
 *
 * Une adresse inconnue dans une application d'une seule page, c'est presque
 * toujours un marchand DÉJÀ CONNECTÉ : un signet périmé, un lien collé de
 * travers, une ressource supprimée. Le seul bouton proposé le renvoyait vers
 * l'accueil commercial — l'écran qui explique le produit à quelqu'un qui ne
 * l'a pas encore. Il perdait sa place et relisait un argumentaire.
 *
 * Les deux sorties sont maintenant offertes, le tableau de bord en premier.
 * Un visiteur non connecté qui le suit est simplement reconduit vers la
 * connexion : aucune des deux issues ne mène nulle part.
 *
 * Le logo a été ajouté : sans lui, cette page ne portait AUCUNE marque du
 * produit et se lisait comme une erreur de serveur, pas comme un écran
 * d'EcomPilot.
 */
function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-primary">
          <Rocket className="h-5 w-5 text-primary-foreground" />
        </div>
        <h1 className="mt-8 font-display text-6xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 font-display text-xl font-semibold">Page introuvable</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Cette adresse n'existe pas, ou la page a été déplacée. Rien n'est perdu de votre côté.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-2 sm:flex-row">
          <Link
            to="/dashboard"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Retour au tableau de bord
          </Link>
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md border border-input px-4 py-2 text-sm font-medium transition-colors hover:bg-accent/10"
          >
            Page d'accueil
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        {/* TUTOIEMENT DANS LA FRONTIÈRE D'ERREUR GLOBALE — le dernier écran
            que voit un marchand quand tout le reste a échoué, et le seul qui
            tutoyait encore. « Recharge » manquait à la liste des impératifs
            surveillés : une liste nommée ne protège que de ce qu'elle nomme. */}
        <h1 className="font-display text-xl font-semibold">Une erreur inattendue est survenue</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Rien n'a été perdu. Réessayez, ou revenez à votre tableau de bord.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Réessayer
          </button>
          <a
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Tableau de bord
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "EcomPilot AI — Découvrez pourquoi votre boutique ne vend pas" },
      {
        name: "description",
        content:
          "L'IA qui audite votre boutique et vous dit exactement quoi corriger pour enfin vendre. Diagnostic en 2 minutes.",
      },
      { property: "og:title", content: "EcomPilot AI — Audit e-commerce IA" },
      {
        property: "og:description",
        content: "Découvrez pourquoi votre boutique ne vend pas et corrigez-le en 2 minutes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "",
      },
      {
        rel: "stylesheet",
        // Public Sans pour le texte, Bricolage Grotesque pour les titres,
        // Instrument Serif pour le rapport d'audit — voir `styles.css`.
        href: "https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700&family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Instrument+Serif&display=swap",
      },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster />
    </QueryClientProvider>
  );
}
