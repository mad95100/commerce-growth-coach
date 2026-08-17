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
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-primary">
              <Rocket className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-display text-lg font-bold">EcomPilot AI</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link to="/auth">
              <Button variant="ghost" size="sm">
                Se connecter
              </Button>
            </Link>
            <Link to="/auth" search={{ mode: "signup" }}>
              <Button size="sm" className="bg-gradient-primary text-primary-foreground">
                Commencer <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-5xl px-6 py-24 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-destructive/40 bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
            <Sparkles className="h-3 w-3" />
            Chaque jour sans audit = de l'argent qui part
          </div>
          <h1 className="mt-6 font-display text-5xl font-bold leading-tight md:text-7xl">
            Votre boutique perd de l'argent.
            <br />
            <span className="text-gradient-primary">Nous vous disons exactement où.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
            EcomPilot AI audite votre boutique en 2 minutes, chiffre chaque fuite en euros et génère
            les corrections prêtes à coller. Pas de blabla. Que du chiffre d'affaires à récupérer.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link to="/auth" search={{ mode: "signup" }}>
              <Button
                size="lg"
                className="bg-gradient-primary text-primary-foreground glow-primary"
              >
                Auditer ma boutique maintenant
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <div className="text-sm text-muted-foreground">1er audit gratuit · sans CB</div>
          </div>

          {/* Score preview */}
          <div className="mx-auto mt-16 max-w-3xl card-elevated rounded-2xl p-8">
            <div className="flex flex-col items-center gap-6 md:flex-row md:text-left">
              <ScoreCircle score={42} />
              <div className="flex-1">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Score global
                </div>
                <div className="mt-1 font-display text-2xl font-bold">
                  Vous laissez ~2 400 €/mois sur la table
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  3 fuites majeures identifiées. Toutes réparables cette semaine avec les textes que
                  nous générons.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Tag color="destructive">Page produit qui tue la vente</Tag>
                  <Tag color="warning">0 relance panier</Tag>
                  <Tag color="warning">Prix mal ancré</Tag>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="mx-auto max-w-5xl px-6 py-24">
          <div className="text-center">
            <h2 className="font-display text-4xl font-bold">3 étapes. Cash récupéré.</h2>
            <p className="mt-3 text-muted-foreground">
              Zéro compétence technique. Zéro tableau de bord à lire.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {[
              {
                icon: Target,
                title: "1. Vous donnez votre adresse",
                desc: "Votre boutique, votre niche, votre budget publicitaire. 60 secondes. C'est tout.",
              },
              {
                icon: Zap,
                title: "2. L'IA trouve les fuites",
                desc: "Offre floue, prix cassé, tunnel troué, pubs qui brûlent : tout chiffré en euros/mois.",
              },
              {
                icon: TrendingUp,
                title: "3. Vous collez les corrections",
                desc: "Fiches produit, emails, accroches pubs. Un clic, un copier-coller, plus de ventes.",
              },
            ].map((step) => (
              <div key={step.title} className="card-elevated rounded-2xl p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <step.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-display text-xl font-bold">{step.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{step.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section className="mx-auto max-w-5xl px-6 py-24">
          <div className="grid gap-8 md:grid-cols-2">
            <FeatureCard
              icon={ShieldCheck}
              title="Zéro jargon. Que du concret."
              desc="On parle cash, pas Google Analytics. Chaque problème = une phrase, un exemple, une action."
            />
            <FeatureCard
              icon={TrendingUp}
              title="Chaque fuite chiffrée en €/mois"
              desc="Vous savez combien vous récupérez en corrigeant chaque point. Priorité = impact financier."
            />
            <FeatureCard
              icon={Sparkles}
              title={"Bouton \u00abCorrige maintenant\u00bb"}
              desc="L'IA écrit votre fiche produit, votre e-mail de relance, votre accroche publicitaire. Vous collez. C'est réglé."
            />
            <FeatureCard
              icon={Rocket}
              title="Suivi de vos progrès"
              desc="Cochez les actions faites. Nouvel audit → vous voyez votre score grimper et vos ventes suivre."
            />
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-4xl px-6 py-24">
          <div className="card-elevated rounded-3xl p-12 text-center">
            <h2 className="font-display text-4xl font-bold">
              Arrêtez de brûler votre budget.{" "}
              <span className="text-gradient-primary">Récupérez votre chiffre d'affaires.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              Votre premier audit est gratuit. Aucune installation. Aucune carte bancaire. Résultats
              en 2 minutes.
            </p>
            <Link to="/auth" search={{ mode: "signup" }}>
              <Button
                size="lg"
                className="mt-8 bg-gradient-primary text-primary-foreground glow-primary"
              >
                Lancer mon audit gratuit
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/40 py-8">
        <div className="mx-auto max-w-6xl px-6 text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} EcomPilot AI — Fait pour les entrepreneurs qui veulent enfin
          vendre.
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
