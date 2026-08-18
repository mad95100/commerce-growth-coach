import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Zap, Target, TrendingUp, Sparkles, ShieldCheck, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "EcomPilot AI — Découvrez pourquoi votre boutique ne vend pas" },
      {
        name: "description",
        content:
          "L'IA qui audite votre boutique Shopify et vous dit exactement quoi corriger pour enfin vendre. Diagnostic en 2 minutes.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border/40 backdrop-blur-sm sticky top-0 z-40 bg-background/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          {/* À 320 px, le mot-symbole, « Se connecter » et « Commencer » font
              ensemble 324 px pour 272 px disponibles : l'en-tête débordait, et
              avec lui toute la page d'accueil. Sous `sm`, l'icône seule tient
              lieu de logo — elle identifie le produit et rend ses cent pixels
              aux deux actions, qui sont ce que le visiteur vient chercher. */}
          <Link to="/" className="flex shrink-0 items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-primary">
              <Rocket className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="hidden font-display text-lg font-bold sm:inline">EcomPilot AI</span>
          </Link>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <Link to="/auth">
              <Button variant="ghost" size="sm" className="px-2 sm:px-3">
                Se connecter
              </Button>
            </Link>
            <Link to="/auth" search={{ mode: "signup" }}>
              <Button size="sm" className="bg-gradient-primary px-3 text-primary-foreground">
                Commencer <ArrowRight className="ml-1 hidden h-4 w-4 sm:inline" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/*
          LA PAGE D'ACCUEIL PARLAIT UNE AUTRE LANGUE QUE LE PRODUIT.

          Ce que le marchand lisait ici : « Chaque jour sans audit = de l'argent
          qui part », « Pas de blabla », « Que du chiffre d'affaires à
          récupérer », « 3 étapes. Cash récupéré. », « Arrêtez de brûler votre
          budget ». Ce qu'il lit une fois entré : « Nous n'avons pas cette
          donnée », « Ce que nous n'avons pas pu mesurer », « Ce n'est pas un
          potentiel nul, c'est un potentiel non mesuré ».

          Deux personnalités pour un seul produit. La première promet, la
          seconde mesure — et c'est la seconde qui fait la valeur de l'outil.
          La page qui vend doit donc parler comme l'outil qui livre, sans quoi
          l'entrée dans le produit se vit comme une déception plutôt que comme
          une confirmation.

          L'urgence artificielle en tête de page est retirée pour la même
          raison : un compteur de perte qu'on ne peut pas justifier est
          exactement ce que le moteur s'interdit d'écrire, à trois écrans de là.
        */}
        <section className="mx-auto max-w-5xl px-6 pb-20 pt-24 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/60 px-4 py-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-3 w-3" />
            Lecture seule au départ · nous ne modifions rien sans votre accord
          </div>
          {/* LE TITRE TENAIT SUR QUATRE LIGNES, et la coupure du dégradé tombait
              au milieu d'une proposition — « …et sur quoi » en couleur, « nous
              nous appuyons » en blanc. Deux lignes, et le dégradé couvre une
              phrase entière. */}
          <h1 className="mx-auto mt-6 max-w-4xl font-display text-4xl font-bold leading-[1.15] sm:text-5xl">
            Vous savez que quelque chose cloche.
            <br className="hidden sm:block" />{" "}
            <span className="text-gradient-primary">Nous vous montrons quoi, et pourquoi.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            EcomPilot lit votre boutique, chiffre ce qui peut l'être et vous donne les corrections
            prêtes à appliquer. Ce que nous ne pouvons pas mesurer, nous le disons — plutôt que de
            le remplir avec une estimation.
          </p>
          {/* Le bouton mesurait 304 px dans un cadre de 320 px moins ses marges :
              il débordait. Pleine largeur sous `sm`, largeur naturelle au-delà. */}
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link to="/auth" search={{ mode: "signup" }} className="w-full sm:w-auto">
              <Button
                size="lg"
                className="w-full bg-gradient-primary text-primary-foreground glow-primary sm:w-auto"
              >
                Lancer mon premier diagnostic
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <div className="text-sm text-muted-foreground">
              Premier diagnostic gratuit · sans carte bancaire
            </div>
          </div>

          {/*
            L'EXEMPLE EST ANNONCÉ COMME TEL.

            Cette carte montre un score, un montant et trois constats. Rien ne
            disait qu'ils étaient inventés pour la démonstration : un visiteur
            pouvait la lire comme un résultat moyen, ou comme le sien. Sur la
            page d'un produit dont l'argument principal est de ne jamais avancer
            un chiffre qu'il ne peut pas justifier, un chiffre décoratif non
            étiqueté est la contradiction la plus coûteuse possible.
          */}
          <div className="card-elevated mx-auto mt-16 max-w-3xl rounded-2xl p-8">
            <div className="mb-6 flex items-center justify-center gap-2 text-xs uppercase tracking-wider text-muted-foreground md:justify-start">
              <span className="rounded-md border border-border px-2 py-0.5">Exemple</span>
              <span>à quoi ressemble un diagnostic</span>
            </div>
            <div className="flex flex-col items-center gap-6 md:flex-row md:text-left">
              <ScoreCircle score={42} />
              <div className="flex-1">
                <div className="font-display text-2xl font-bold">
                  Trois fuites chiffrées, une non mesurable
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Chaque constat arrive avec ce sur quoi il repose et ce qu'il a fallu supposer.
                  Vous pouvez le vérifier avant d'y toucher.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2 md:justify-start">
                  <Tag color="destructive">Frais de livraison découverts trop tard</Tag>
                  <Tag color="warning">Aucune relance de panier</Tag>
                  <Tag color="warning">Page d'accueil muette</Tag>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/*
          LE RYTHME DE LA PAGE. Chaque section portait `py-24` : douze rem de
          vide en bas d'une section, douze en haut de la suivante, soit un trou
          de vingt-quatre rem entre deux blocs. Sur un portable, c'est plus d'un
          écran entier de noir — on croit la page finie, on remonte, on repart.
        */}
        <section className="mx-auto max-w-5xl px-6 py-20">
          <div className="text-center">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">
              Trois étapes, et vous savez où vous en êtes
            </h2>
            <p className="mt-3 text-muted-foreground">
              Aucune compétence technique. Aucun tableau de bord à apprendre.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {[
              {
                icon: Target,
                title: "1. Vous nous donnez l'adresse",
                desc: "Votre boutique et votre situation. Une minute. Vous pourrez compléter le reste plus tard.",
              },
              {
                icon: Zap,
                title: "2. Nous lisons, puis nous chiffrons",
                desc: "Offre, prix, tunnel, publicité. Ce qui se chiffre est chiffré ; ce qui ne se mesure pas est annoncé comme non mesuré.",
              },
              {
                icon: TrendingUp,
                title: "3. Vous appliquez les corrections",
                desc: "Fiches produit, e-mails de relance, accroches publicitaires — rédigés, prêts à coller, et réversibles.",
              },
            ].map((step) => (
              <div key={step.title} className="card-elevated rounded-2xl p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <step.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-display text-lg font-bold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CE BLOC N'AVAIT PAS DE TITRE. Quatre cartes apparaissaient après un
            grand vide, sans rien pour dire ce qu'elles avaient en commun ni
            pourquoi on les lisait là — la seule section de la page dans ce cas. */}
        <section className="mx-auto max-w-5xl px-6 py-20">
          <div className="text-center">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">
              Ce qui distingue ce diagnostic
            </h2>
            <p className="mt-3 text-muted-foreground">
              Un audit ne vaut que si vous pouvez le vérifier avant d'y croire.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            <FeatureCard
              icon={ShieldCheck}
              title="Chaque constat montre sa preuve"
              desc="Sur quoi il repose, et ce qu'il a fallu supposer. Vous jugez avant d'agir, au lieu de nous croire sur parole."
            />
            <FeatureCard
              icon={TrendingUp}
              title="Le chiffrage s'arrête où la mesure s'arrête"
              desc="Une fuite chiffrable est chiffrée en euros par mois. Une fuite non mesurable est signalée comme telle, jamais comblée par une estimation."
            />
            <FeatureCard
              icon={Sparkles}
              title="Les corrections sont écrites et réversibles"
              desc="Nous préparons le texte, vous confirmez avant toute écriture sur votre boutique, et vous pouvez revenir en arrière."
            />
            <FeatureCard
              icon={Rocket}
              title="L'avant / après est mesuré"
              desc="Après une correction, nous revenons vérifier si la conversion a bougé — et nous le disons quand elle n'a pas bougé."
            />
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-6 py-20">
          <div className="card-elevated rounded-3xl p-8 text-center sm:p-12">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">
              Commencez par savoir <span className="text-gradient-primary">où vous en êtes</span>.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              Le premier diagnostic est gratuit. Aucune installation, aucune carte bancaire, et rien
              n'est modifié sur votre boutique sans que vous l'ayez confirmé.
            </p>
            <Link
              to="/auth"
              search={{ mode: "signup" }}
              className="mt-8 inline-block w-full sm:w-auto"
            >
              <Button
                size="lg"
                className="w-full bg-gradient-primary text-primary-foreground glow-primary sm:w-auto"
              >
                Lancer mon premier diagnostic
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/40 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 text-sm text-muted-foreground sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-primary">
              <Rocket className="h-3 w-3 text-primary-foreground" />
            </div>
            <span>© {new Date().getFullYear()} EcomPilot AI</span>
          </div>
          <Link to="/auth" className="hover:text-foreground">
            Se connecter
          </Link>
        </div>
      </footer>
    </div>
  );
}

function ScoreCircle({ score }: { score: number }) {
  const radius = 50;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (score / 100) * circ;
  const color = score < 40 ? "hsl(0 70% 60%)" : score < 70 ? "hsl(40 90% 60%)" : "hsl(155 60% 55%)";
  return (
    <div className="relative flex h-32 w-32 items-center justify-center">
      <svg className="h-32 w-32 -rotate-90" viewBox="0 0 120 120">
        <circle
          cx="60"
          cy="60"
          r={radius}
          stroke="oklch(1 0 0 / 0.1)"
          strokeWidth="10"
          fill="none"
        />
        <circle
          cx="60"
          cy="60"
          r={radius}
          stroke={color}
          strokeWidth="10"
          fill="none"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute text-center">
        <div className="font-display text-3xl font-bold">{score}</div>
        <div className="text-[10px] uppercase text-muted-foreground">/100</div>
      </div>
    </div>
  );
}

function Tag({
  children,
  color,
}: {
  children: React.ReactNode;
  color: "destructive" | "warning" | "success";
}) {
  const cls = {
    destructive: "bg-destructive/15 text-destructive border-destructive/30",
    warning: "bg-warning/15 text-warning border-warning/30",
    success: "bg-success/15 text-success border-success/30",
  }[color];
  return (
    <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  desc,
}: {
  icon: typeof ShieldCheck;
  title: string;
  desc: string;
}) {
  return (
    <div className="card-elevated rounded-2xl p-6">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-4 font-display text-xl font-bold">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}
