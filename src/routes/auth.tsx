import { createFileRoute, Link, useNavigate, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Rocket, Loader2, Eye, EyeOff, MailCheck, ArrowLeft, ShieldCheck } from "lucide-react";
import {
  CONFIRMATION_TITLE,
  MIN_PASSWORD_LENGTH,
  authErrorMessage,
  confirmationMessage,
  passwordHint,
  signupOutcome,
} from "@/lib/auth-messages";

const searchSchema = z.object({
  mode: z.enum(["signin", "signup"]).optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Connexion — EcomPilot AI" },
      { name: "description", content: "Connectez-vous ou créez votre compte EcomPilot AI." },
    ],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/dashboard" });
  },
  component: AuthPage,
});

function AuthPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup" | "oubli">(search.mode ?? "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  /**
   * Écran d'attente après inscription ou demande de réinitialisation.
   *
   * Il remplace le formulaire au lieu de s'ajouter à côté : laisser le
   * formulaire visible inviterait à recommencer, et l'utilisateur recevrait
   * deux e-mails dont un seul fonctionne.
   */
  const [sent, setSent] = useState<null | { titre: string; message: string }>(null);
  const hint = passwordHint(password);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "oubli") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth`,
        });
        if (error) throw error;
        // AUCUNE INDICATION SUR L'EXISTENCE DU COMPTE. Le même écran s'affiche
        // que l'adresse existe ou non : répondre différemment permettrait de
        // découvrir, une adresse à la fois, qui a un compte chez nous.
        setSent({
          titre: "Regardez votre boîte e-mail",
          message: `Si un compte existe pour ${email}, un lien de réinitialisation vient d'y être envoyé. Il est valable une heure.`,
        });
        return;
      }

      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/dashboard`,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;

        // LE DÉFAUT CORRIGÉ ICI. L'écran annonçait « Compte créé ! » puis
        // envoyait vers une page protégée — y compris quand Supabase exige une
        // confirmation par e-mail et ne rend AUCUNE session. La page protégée
        // renvoyait alors vers la connexion, qui refusait le compte tout juste
        // créé. L'utilisateur bouclait, avec un message de succès en mémoire.
        //
        // La présence d'une session est donc LUE, jamais supposée.
        if (signupOutcome(data.session) === "confirmation_requise") {
          setSent({ titre: CONFIRMATION_TITLE, message: confirmationMessage(email) });
          return;
        }
        toast.success("Compte créé. Commençons par votre boutique.");
        navigate({ to: "/onboarding" });
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      navigate({ to: "/dashboard" });
    } catch (err) {
      // Les messages de Supabase sont en anglais et techniques. Ils sont
      // traduits en une phrase qui dit aussi le geste suivant.
      toast.error(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    try {
      // Fournisseur Google natif de Supabase. Il redirige le navigateur puis
      // revient sur `redirectTo`, où le client Supabase reprend la session : il
      // n'y a donc rien à faire ici après l'appel, la page est déjà partie.
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/dashboard` },
      });
      if (error) throw error;
    } catch (err) {
      toast.error(authErrorMessage(err));
      setLoading(false);
    }
  }

  // ÉCRAN D'ATTENTE. Il remplace tout le formulaire : le laisser visible
  // inviterait à recommencer, et l'utilisateur recevrait deux e-mails dont un
  // seul fonctionne.
  if (sent) {
    return (
      <Cadre>
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <MailCheck className="h-6 w-6" />
        </div>
        <h1 className="mt-5 font-display text-2xl font-bold">{sent.titre}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{sent.message}</p>
        <Button
          variant="outline"
          className="mt-8 w-full"
          onClick={() => {
            setSent(null);
            setMode("signin");
          }}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Revenir à la connexion
        </Button>
      </Cadre>
    );
  }

  if (mode === "oubli") {
    return (
      <Cadre>
        <h1 className="font-display text-2xl font-bold">Mot de passe oublié</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Indiquez votre adresse : nous vous enverrons un lien pour en choisir un nouveau.
        </p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email-oubli">Adresse e-mail</Label>
            <Input
              id="email-oubli"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vous@exemple.com"
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Envoyer le lien
          </Button>
        </form>
        <button
          type="button"
          onClick={() => setMode("signin")}
          className="mt-6 flex w-full items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Revenir à la connexion
        </button>
      </Cadre>
    );
  }

  return (
    <Cadre>
      <h1 className="font-display text-2xl font-bold tracking-tight">
        {mode === "signup" ? "Créez votre compte" : "Connexion à votre compte"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {mode === "signup"
          ? "Votre premier audit est gratuit, sans carte bancaire."
          : "Connectez-vous pour retrouver vos boutiques."}
      </p>

      <Button
        type="button"
        variant="outline"
        className="mt-6 h-11 w-full"
        onClick={handleGoogle}
        disabled={loading}
      >
        <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
        Continuer avec Google
      </Button>

      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs uppercase tracking-wider text-muted-foreground">ou</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === "signup" && (
          <div className="space-y-1.5">
            <Label htmlFor="name">Votre prénom</Label>
            <Input
              id="name"
              autoComplete="given-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Alex"
              required
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="email">Adresse e-mail</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="vous@exemple.com"
            required
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Mot de passe</Label>
            {mode === "signin" && (
              <button
                type="button"
                onClick={() => setMode("oubli")}
                className="text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                Oublié ?
              </button>
            )}
          </div>
          <div className="relative">
            <Input
              id="password"
              /* UN MOT DE PASSE SE TAPE À L'AVEUGLE, et c'est la première cause
                 d'échec de connexion. Le bouton coûte deux lignes. */
              type={showPassword ? "text" : "password"}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={
                mode === "signup"
                  ? `${MIN_PASSWORD_LENGTH} caractères minimum`
                  : "Votre mot de passe"
              }
              minLength={mode === "signup" ? MIN_PASSWORD_LENGTH : undefined}
              className="pr-10"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {mode === "signup" && password.length > 0 && (
            <p className={`text-xs ${hint.ok ? "text-emerald-500" : "text-muted-foreground"}`}>
              {hint.text}
            </p>
          )}
        </div>
        <Button
          type="submit"
          className="h-11 w-full bg-gradient-primary text-primary-foreground"
          disabled={loading}
        >
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {mode === "signup" ? "Créer mon compte" : "Me connecter"}
        </Button>
      </form>

      {mode === "signup" && (
        <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          EcomPilot lit vos données Shopify pour les analyser. Il ne modifie jamais votre boutique
          sans que vous l'ayez demandé.
        </p>
      )}

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {mode === "signup" ? "Vous avez déjà un compte ?" : "Pas encore de compte ?"}{" "}
        <button
          type="button"
          onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
          className="font-medium text-primary hover:underline"
        >
          {mode === "signup" ? "Se connecter" : "En créer un"}
        </button>
      </p>
    </Cadre>
  );
}

/**
 * Le cadre commun aux quatre états de la page.
 *
 * Le logo, le centrage et la carte sont identiques partout : les dupliquer
 * ferait diverger les quatre écrans au premier ajustement, et l'utilisateur
 * verrait la page « sauter » en passant de l'un à l'autre.
 */
function Cadre({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-primary">
            <Rocket className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-display text-xl font-bold">EcomPilot AI</span>
        </Link>
        <div className="card-elevated rounded-2xl p-8">{children}</div>
      </div>
    </div>
  );
}
