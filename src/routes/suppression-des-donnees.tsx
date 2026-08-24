import { createFileRoute, Link } from "@tanstack/react-router";
import { Rocket } from "lucide-react";

export const Route = createFileRoute("/suppression-des-donnees")({
  head: () => ({
    meta: [
      { title: "Suppression des données — EcomPilot AI" },
      {
        name: "description",
        content: "Comment demander la suppression des données qu'EcomPilot a collectées.",
      },
    ],
  }),
  component: SuppressionDesDonnees,
});

/*
  CETTE PAGE EST CE QUE META VÉRIFIE À LA REVUE D'APP : elle doit dire
  précisément comment un marchand obtient la suppression de ses données,
  y compris celles issues d'un compte Meta connecté.

  Les deux premiers gestes sont RÉELLEMENT en libre-service, vérifié dans
  `connection-writes.server.ts` (suppression de ligne, pas désactivation) et
  dans la migration qui pose `ON DELETE CASCADE` sur `stores`. Le troisième —
  la suppression du compte entier — n'a PAS de parcours automatique : il n'y a
  rien à cacher, c'est dit tel quel plutôt que présenté comme un geste en un
  clic qui n'existe pas.
*/
function SuppressionDesDonnees() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border/40 bg-background/60 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center px-6 py-4">
          <Link to="/" className="flex shrink-0 items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-primary">
              <Rocket className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-display text-lg font-bold">EcomPilot AI</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="font-display text-3xl font-bold">Suppression de vos données</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Cette page explique comment demander la suppression des données qu'EcomPilot a collectées
          vous concernant, y compris celles issues d'un compte Meta, Google ou Shopify que vous avez
          connecté.
        </p>

        <section className="mt-10">
          <h2 className="font-display text-xl font-bold">Supprimer une seule connexion</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Depuis la page de votre boutique, dans « Sources de données », un bouton « Déconnecter »
            retire immédiatement la clé d'accès à Meta Ads, Google Ads ou Shopify. Aucune nouvelle
            lecture n'a lieu après ce geste, et la clé précédente est effacée, pas seulement
            désactivée.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-xl font-bold">Supprimer une boutique</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Depuis la page de la boutique, vous pouvez la supprimer entièrement. Cela efface ses
            connexions et les clés d'accès associées, tous ses diagnostics, et tout son historique
            de corrections. Cette action est définitive.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-xl font-bold">Supprimer votre compte entier</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            La suppression complète du compte n'est pas encore en libre-service. Écrivez à{" "}
            <a href="mailto:ecom.pilot.ia@gmail.com" className="text-primary underline">
              ecom.pilot.ia@gmail.com
            </a>{" "}
            depuis l'adresse e-mail de votre compte, en précisant que vous demandez la suppression
            totale de vos données. Nous confirmons une fois la suppression effectuée.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-xl font-bold">Ce qui est supprimé, précisément</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
            <li>vos informations de compte (prénom, adresse e-mail) ;</li>
            <li>les boutiques que vous avez créées et tout ce qui leur est rattaché ;</li>
            <li>les clés d'accès chiffrées à vos comptes Meta, Google et Shopify ;</li>
            <li>vos diagnostics, constats et historique de corrections.</li>
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-xl font-bold">Délai</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Déconnecter une source ou supprimer une boutique prend effet immédiatement. Une demande
            de suppression de compte par e-mail est confirmée sous 30 jours.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-xl font-bold">Nous contacter</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            <a href="mailto:ecom.pilot.ia@gmail.com" className="text-primary underline">
              ecom.pilot.ia@gmail.com
            </a>
          </p>
        </section>
      </main>

      <footer className="border-t border-border/40 py-10">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-6 text-sm text-muted-foreground sm:flex-row sm:justify-between">
          <span>© {new Date().getFullYear()} EcomPilot AI</span>
          <div className="flex gap-4">
            <Link to="/confidentialite" className="hover:text-foreground">
              Confidentialité
            </Link>
            <Link to="/" className="hover:text-foreground">
              Accueil
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
