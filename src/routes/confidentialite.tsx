import { createFileRoute, Link } from "@tanstack/react-router";
import { Rocket } from "lucide-react";

export const Route = createFileRoute("/confidentialite")({
  head: () => ({
    meta: [
      { title: "Confidentialité — EcomPilot AI" },
      {
        name: "description",
        content: "Ce que EcomPilot collecte sur votre boutique, pourquoi, et comment le reprendre.",
      },
    ],
  }),
  component: Confidentialite,
});

/*
  CETTE PAGE DÉCRIT CE QUE LE CODE FAIT RÉELLEMENT, PAS UN TEXTE TYPE.

  Chaque affirmation ci-dessous est vérifiable dans le dépôt : le chiffrement
  des clés d'accès (`crypto.server.ts`, AES-256-GCM), la séparation des
  boutiques par propriétaire (RLS sur `stores.owner_id`), les droits colonne
  par colonne qui empêchent le navigateur de lire un jeton
  (`data_connections`), et la suppression en cascade d'une boutique
  (`ON DELETE CASCADE` sur `audits`, `data_connections`, etc.). Rien n'est
  promis ici que le produit ne fait pas.
*/
function Confidentialite() {
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
        <h1 className="font-display text-3xl font-bold">Confidentialité</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          EcomPilot lit les données de votre boutique pour construire un diagnostic et vous proposer
          des corrections. Cette page décrit précisément ce que nous collectons, pourquoi, et
          comment vous pouvez le reprendre.
        </p>

        <section className="mt-10">
          <h2 className="font-display text-xl font-bold">Ce que vous nous confiez directement</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
            <li>Votre adresse e-mail et votre prénom, pour votre compte.</li>
            <li>
              Le nom et l'adresse de vos boutiques, et les chiffres que vous choisissez de
              renseigner : budget publicitaire, chiffre d'affaires, objectif, marge et charges
              fixes. Rien de tout cela n'est obligatoire au-delà du nom et de l'adresse de la
              boutique.
            </li>
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-xl font-bold">
            Ce que nous lisons chez vos partenaires, avec votre accord
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Quand vous branchez Shopify, Meta Ads ou Google Ads, vous nous donnez accès à un compte
            que vous choisissez, pour la durée que vous décidez. Nous lisons alors :
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
            <li>
              chez Shopify : votre catalogue, vos commandes et le contenu public de votre boutique ;
            </li>
            <li>
              chez Meta Ads et Google Ads : les comptes publicitaires auxquels vous avez accès, leur
              dépense et leurs résultats (achats, clics, taux de conversion).
            </li>
          </ul>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Nous ne lisons que ce qui sert à construire votre diagnostic. Nous n'écrivons rien — pas
            de campagne coupée, pas de fiche modifiée, pas de code promo créé — sans que vous ayez
            validé l'action au préalable.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-xl font-bold">Comment ces accès sont protégés</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Les clés qui nous permettent de lire vos comptes sont chiffrées avant d'être
            enregistrées et ne sont jamais transmises à l'écran : ni vous, ni un autre marchand ne
            peut les consulter, y compris depuis votre propre compte. Chaque boutique n'est visible
            que par la personne qui l'a créée.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-xl font-bold">Ce que nous produisons et conservons</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            À partir de ces données, nous construisons un diagnostic : un score, des constats
            classés, ce qui les prouve, et des corrections possibles. Ces rapports restent liés à
            votre boutique, pour que vous puissiez comparer un diagnostic au suivant.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-xl font-bold">Ce que nous ne faisons jamais</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Nous ne vendons aucune donnée. Nous ne les partageons avec personne d'autre que les
            partenaires strictement nécessaires au fonctionnement du produit (hébergement, base de
            données, fournisseur du modèle qui rédige vos rapports), et uniquement pour cet usage.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-xl font-bold">Combien de temps nous les gardons</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Vos données restent tant que la boutique ou le compte existe. Déconnecter une source
            (Meta Ads, Google Ads, Shopify) supprime immédiatement la clé d'accès correspondante.
            Supprimer une boutique supprime avec elle tous ses diagnostics, ses connexions et son
            historique.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-xl font-bold">Vos droits</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Vous pouvez à tout moment :
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
            <li>déconnecter une source depuis les réglages de votre boutique ;</li>
            <li>supprimer une boutique entière depuis la même page ;</li>
            <li>
              demander la suppression complète de votre compte en écrivant à l'adresse ci-dessous.
            </li>
          </ul>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Le détail de ce dernier point est sur notre page de{" "}
            <Link to="/suppression-des-donnees" className="text-primary underline">
              suppression des données
            </Link>
            .
          </p>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-xl font-bold">Nous contacter</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Pour toute question sur vos données, ou pour demander leur suppression :{" "}
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
            <Link to="/suppression-des-donnees" className="hover:text-foreground">
              Suppression des données
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
