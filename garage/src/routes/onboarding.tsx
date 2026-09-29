import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useSession } from "@/app/session.tsx";
import { AuthLayout } from "@/components/auth/AuthLayout.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Alert, FormError, Loading } from "@/components/ui/feedback.tsx";
import { Checkbox, Field, Input, Select } from "@/components/ui/form.tsx";
import { t } from "@/lib/i18n.tsx";
import { EMIRATES } from "@/lib/plates.ts";
import { rpc } from "@/lib/supabase.ts";

export const Route = createFileRoute("/onboarding")({ component: Onboarding });

function Onboarding() {
  const { status, user, reload, signOut } = useSession();
  const [f, setF] = useState({
    name: "BS Garage",
    owner_name: String(user?.user_metadata?.full_name ?? ""),
    phone: "",
    email: user?.email ?? "",
    address: "",
    emirate: "DXB",
    trn: "",
    trade_license_no: "",
    vat_registered: true,
    vat_rate: "",
    default_labor_rate: "",
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (status === "loading") return <Loading />;
  if (status === "signed_out") return <Navigate to="/login" search={{ redirect: undefined }} />;
  if (status === "ready") return <Navigate to="/" />;

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await rpc("create_organization", {
        p: {
          ...f,
          vat_rate: f.vat_registered ? Number(f.vat_rate.replace(",", ".")) : null,
          default_labor_rate: f.default_labor_rate ? Number(f.default_labor_rate) : 0,
        },
      });
      await reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={t("Set up your garage")} subtitle={t("These details appear on your invoices. You can change them later in Settings.")}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t("Garage name")} required>{(id) => <Input id={id} required value={f.name} onChange={set("name")} />}</Field>
        <Field label={t("Your name")}>{(id) => <Input id={id} value={f.owner_name} onChange={set("owner_name")} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Phone")}>{(id) => <Input id={id} type="tel" value={f.phone} onChange={set("phone")} />}</Field>
          <Field label={t("Email")}>{(id) => <Input id={id} type="email" value={f.email} onChange={set("email")} />}</Field>
        </div>
        <Field label={t("Address")}>{(id) => <Input id={id} value={f.address} onChange={set("address")} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Emirate")}>
            {(id) => (
              <Select id={id} value={f.emirate} onChange={set("emirate")}>
                {EMIRATES.map((e) => (
                  <option key={e.code} value={e.code}>
                    {e.en}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("Trade licence number")}>{(id) => <Input id={id} value={f.trade_license_no} onChange={set("trade_license_no")} />}</Field>
        </div>
        <Checkbox label={t("The garage is registered for VAT")} checked={f.vat_registered} onChange={(e) => setF({ ...f, vat_registered: e.target.checked })} />
        {f.vat_registered && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("TRN (Tax Registration Number)")}>{(id) => <Input id={id} inputMode="numeric" value={f.trn} onChange={set("trn")} />}</Field>
            <Field label={t("Standard VAT rate (%)")} required hint={t("Check the current rate with your accountant.")}>
              {(id, d) => <Input id={id} aria-describedby={d} inputMode="decimal" required placeholder="5" value={f.vat_rate} onChange={set("vat_rate")} />}
            </Field>
          </div>
        )}
        <Field label={t("Default labor rate per hour (AED)")} hint={t("Used as the starting price of labor lines. Optional.")}>
          {(id, d) => <Input id={id} aria-describedby={d} inputMode="decimal" value={f.default_labor_rate} onChange={set("default_labor_rate")} />}
        </Field>
        <Alert tone="neutral">{t("BS Garage helps you apply the VAT settings you enter. It does not replace advice from your accountant or the tax authority.")}</Alert>
        <FormError error={error} />
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          {t("Create my garage")}
        </Button>
        <p className="text-center text-sm text-muted">
          {t("Joining an existing garage? Ask its owner to invite {email}, then sign in again.", { email: user?.email ?? "" })}{" "}
          <button type="button" className="font-medium text-brand hover:underline" onClick={() => signOut()}>
            {t("Sign out")}
          </button>
        </p>
      </form>
    </AuthLayout>
  );
}
