import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Zap, Target, TrendingUp, Sparkles, ShieldCheck, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "EcomPilot AI — Découvre pourquoi ta boutique ne vend pas" },
      {
        name: "description",
        content:
          "L'IA qui audite ta boutique Shopify et te dit exactement quoi corriger pour enfin vendre. Diagnostic en 2 minutes.",
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
              <Button variant="ghost" size="sm">Se connecter</Button>
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
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-1.5 text-xs text-muted-foreground">
            <Sparkles className="h-3 w-3 text-primary" />
            L'audit IA pour débutants e-commerce
          </div>
          <h1 className="mt-6 font-display text-5xl font-bold leading-tight md:text-7xl">
            Ta boutique ne vend pas ?<br />
            <span className="text-gradient-primary">Découvre pourquoi.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
            En 2 minutes, EcomPilot AI analyse ta boutique et te dit exactement
            quoi corriger pour enfin transformer tes visiteurs en clients.
            Pas de jargon. Que des actions concrètes.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link to="/auth" search={{ mode: "signup" }}>
              <Button size="lg" className="bg-gradient-primary text-primary-foreground glow-primary">
                Lancer mon audit gratuit
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <div className="text-sm text-muted-foreground">Aucune carte bancaire requise</div>
          </div>

          {/* Score preview */}
          <div className="mx-auto mt-16 max-w-3xl card-elevated rounded-2xl p-8">
            <div className="flex flex-col items-center gap-6 md:flex-row md:text-left">
              <ScoreCircle score={42} />
              <div className="flex-1">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Score global</div>
                <div className="mt-1 font-display text-2xl font-bold">Ta boutique a du potentiel bloqué</div>
                <p className="mt-2 text-sm text-muted-foreground">
                  3 problèmes critiques t'empêchent de convertir. Bonne nouvelle :
                  tous les 3 sont réparables cette semaine.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Tag color="destructive">Page produit floue</Tag>
                  <Tag color="warning">Pas de relance panier</Tag>
                  <Tag color="warning">Prix mal positionné</Tag>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="mx-auto max-w-5xl px-6 py-24">
          <div className="text-center">
            <h2 className="font-display text-4xl font-bold">Comment ça marche</h2>
            <p className="mt-3 text-muted-foreground">Trois étapes. Zéro compétence technique.</p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {[
              {
                icon: Target,
                title: "1. Dis-nous ta situation",
                desc: "URL de ta boutique, ta niche, ton budget. On s'occupe du reste.",
              },
              {
                icon: Zap,
                title: "2. L'IA audite en 2 min",
                desc: "On identifie ce qui tue tes ventes : offre, page produit, prix, tunnel...",
              },
              {
                icon: TrendingUp,
                title: "3. Applique les corrections",
                desc: "Actions classées par impact. Textes prêts à copier. Gains estimés en euros.",
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
              title="Un langage simple, jamais de jargon"
              desc="On parle comme un mentor, pas comme un analyste. Chaque problème est expliqué avec un exemple concret."
            />
            <FeatureCard
              icon={TrendingUp}
              title="Chaque action chiffrée en euros"
              desc="Tu sais exactement combien tu peux gagner par mois en corrigeant chaque problème."
            />
            <FeatureCard
              icon={Sparkles}
              title="Corrections prêtes à copier-coller"
              desc="Fiches produit réécrites, emails de relance, accroches pubs. Zéro rédaction à faire."
            />
            <FeatureCard
              icon={Rocket}
              title="Suivi de tes progrès"
              desc="Marque les actions faites. Nouveaux audits pour mesurer ton évolution."
            />
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-4xl px-6 py-24">
          <div className="card-elevated rounded-3xl p-12 text-center">
            <h2 className="font-display text-4xl font-bold">
              Arrête de deviner. <span className="text-gradient-primary">Commence à vendre.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              Ton premier audit est gratuit. Aucune installation. Aucune carte bancaire.
            </p>
            <Link to="/auth" search={{ mode: "signup" }}>
              <Button size="lg" className="mt-8 bg-gradient-primary text-primary-foreground glow-primary">
                Lancer mon audit maintenant
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/40 py-8">
        <div className="mx-auto max-w-6xl px-6 text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} EcomPilot AI — Fait pour les entrepreneurs qui veulent vendre.
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
        <circle cx="60" cy="60" r={radius} stroke="oklch(1 0 0 / 0.1)" strokeWidth="10" fill="none" />
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

function Tag({ children, color }: { children: React.ReactNode; color: "destructive" | "warning" | "success" }) {
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
