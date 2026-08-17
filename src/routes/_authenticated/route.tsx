import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, PageSkeleton } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  /*
    L'ÉCRAN NOIR DU DÉMARRAGE.

    CE QUI SE PASSAIT. `beforeLoad` interroge le RÉSEAU — `getUser()` valide le
    jeton auprès de Supabase — et il bloque le rendu de toute la branche
    protégée. Sans composant d'attente, le routeur n'affiche RIEN pendant ce
    temps : pas le cadre, pas le logo, pas un point. Un fond sombre et vide.

    CE QUE CELA COÛTAIT. Ce n'est pas un écran rare : c'est le PREMIER de chaque
    visite, sur chaque page protégée, y compris après un simple rechargement.
    Sur une connexion mobile ordinaire, le marchand regardait plusieurs secondes
    de noir avant de voir quoi que ce soit — l'écran d'une application qui ne
    démarre pas. Le produit paraissait cassé au moment exact où il devait
    paraître fiable.

    LA CORRECTION. Le cadre de l'application s'affiche immédiatement, avec une
    ossature à la place du contenu : le marchand voit tout de suite où il est.

    `pendingMs: 300` plutôt que la seconde par défaut : au-delà d'un tiers de
    seconde l'absence de réponse se remarque, et en deçà l'ossature clignoterait
    inutilement sur les chargements rapides. `pendingMinMs` la maintient assez
    longtemps pour qu'elle ne soit pas perçue comme un défaut d'affichage.
  */
  pendingMs: 300,
  pendingMinMs: 400,
  pendingComponent: () => (
    <AppShell>
      <PageSkeleton />
    </AppShell>
  ),
  component: () => <Outlet />,
});
