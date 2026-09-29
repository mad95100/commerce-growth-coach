import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useSession } from "@/app/session.tsx";
import { AuthLayout } from "@/components/auth/AuthLayout.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Alert, FormError } from "@/components/ui/feedback.tsx";
import { Field, Input } from "@/components/ui/form.tsx";
import { t } from "@/lib/i18n.tsx";
import { supabase } from "@/lib/supabase.ts";

export const Route = createFileRoute("/signup")({ component: Signup });

function Signup() {
  const { status } = useSession();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  if (status === "ready") return <Navigate to="/" />;
  if (status === "no_org") return <Navigate to="/onboarding" />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError({ error_code: "weak_password" });
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { full_name: name.trim() } } });
    setBusy(false);
    if (error) setError(error);
    else if (!data.session) setCheckEmail(true);
    else navigate({ to: "/onboarding" });
  }

  if (checkEmail) {
    return (
      <AuthLayout title={t("Check your email")}>
        <Alert tone="info" title={t("We sent you a confirmation link.")}>
          {t("Open the link in the email sent to {email}, then sign in.", { email })}
        </Alert>
        <Link to="/login" className="mt-4 inline-block text-sm font-medium text-brand hover:underline">
          {t("Go to sign in")}
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t("Create your account")} subtitle={t("Set up your garage in two minutes. Team members you invite will join with their own email.")}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t("Your name")}>{(id) => <Input id={id} autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label={t("Email")}>{(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label={t("Password")} hint={t("At least 8 characters.")}>
          {(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <FormError error={error} />
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          {t("Create account")}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        {t("Already have an account?")}{" "}
        <Link to="/login" className="font-medium text-brand hover:underline">
          {t("Sign in")}
        </Link>
      </p>
    </AuthLayout>
  );
}
