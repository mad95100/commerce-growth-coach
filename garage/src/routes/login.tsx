import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useSession } from "@/app/session.tsx";
import { AuthLayout } from "@/components/auth/AuthLayout.tsx";
import { Button } from "@/components/ui/button.tsx";
import { FormError } from "@/components/ui/feedback.tsx";
import { Field, Input } from "@/components/ui/form.tsx";
import { t } from "@/lib/i18n.tsx";
import { supabase } from "@/lib/supabase.ts";

export const Route = createFileRoute("/login")({
  component: Login,
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => ({ redirect: typeof s.redirect === "string" ? s.redirect : undefined }),
});

function Login() {
  const { status } = useSession();
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (status === "ready" || status === "no_org") return <Navigate to={redirect ?? "/"} />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error);
    else navigate({ to: redirect ?? "/" });
  }

  return (
    <AuthLayout title={t("Sign in")} subtitle={t("Welcome back. Sign in to your garage.")}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t("Email")}>{(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label={t("Password")}>{(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        <FormError error={error} />
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          {t("Sign in")}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        {t("New garage?")}{" "}
        <Link to="/signup" className="font-medium text-brand hover:underline">
          {t("Create an account")}
        </Link>
      </p>
    </AuthLayout>
  );
}
