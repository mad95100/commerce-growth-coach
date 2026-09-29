import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useOrg, useSession } from "@/app/session.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Alert, FormError } from "@/components/ui/feedback.tsx";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form.tsx";
import { Card, CardTitle } from "@/components/ui/layout.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { t } from "@/lib/i18n.tsx";
import { EMIRATES } from "@/lib/plates.ts";
import { supabase } from "@/lib/supabase.ts";

export function GaragePanel() {
  const org = useOrg();
  const { reload } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const s = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  const [f, setF] = useState({
    name: org.name, legal_name: s(org.legal_name), trn: s(org.trn), trade_license_no: s(org.trade_license_no), vat_registered: org.vat_registered,
    address: s(org.address), city: s(org.city), emirate: s(org.emirate), phone: s(org.phone), email: s(org.email), website: s(org.website), logo_url: s(org.logo_url),
    default_payment_terms_days: s(org.default_payment_terms_days), estimate_validity_days: s(org.estimate_validity_days), default_labor_rate: s(org.default_labor_rate),
    large_amount_threshold: s(org.large_amount_threshold), invoice_terms: s(org.invoice_terms), estimate_terms: s(org.estimate_terms), receipt_footer: s(org.receipt_footer),
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const n = (v: string) => (v.trim() === "" ? null : v.trim());
    const { error } = await supabase
      .from("organizations")
      .update({
        name: f.name.trim(), legal_name: n(f.legal_name), trn: n(f.trn), trade_license_no: n(f.trade_license_no), vat_registered: f.vat_registered,
        address: n(f.address), city: n(f.city), emirate: n(f.emirate), phone: n(f.phone), email: n(f.email), website: n(f.website), logo_url: n(f.logo_url),
        default_payment_terms_days: Number(f.default_payment_terms_days || 0), estimate_validity_days: Number(f.estimate_validity_days || 14),
        default_labor_rate: Number(f.default_labor_rate || 0), large_amount_threshold: Number(f.large_amount_threshold || 0),
        invoice_terms: n(f.invoice_terms), estimate_terms: n(f.estimate_terms), receipt_footer: n(f.receipt_footer),
      })
      .eq("id", org.id);
    setBusy(false);
    if (error) return setError(error);
    await reload();
    await qc.invalidateQueries();
    toast(t("Settings saved."));
  }
  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <Card>
        <CardTitle>{t("Garage identity")}</CardTitle>
        <p className="mb-4 text-sm text-muted">{t("Printed on every document. Issued invoices keep the details they were issued with.")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Garage name")} required>{(id) => <Input id={id} value={f.name} onChange={set("name")} />}</Field>
          <Field label={t("Legal name")}>{(id) => <Input id={id} value={f.legal_name} onChange={set("legal_name")} />}</Field>
          <Field label={t("Trade licence number")}>{(id) => <Input id={id} value={f.trade_license_no} onChange={set("trade_license_no")} />}</Field>
          <Field label={t("TRN (Tax Registration Number)")}>{(id) => <Input id={id} value={f.trn} onChange={set("trn")} />}</Field>
          <Field label={t("Address")}>{(id) => <Input id={id} value={f.address} onChange={set("address")} />}</Field>
          <Field label={t("City / area")}>{(id) => <Input id={id} value={f.city} onChange={set("city")} />}</Field>
          <Field label={t("Emirate")}>
            {(id) => (
              <Select id={id} value={f.emirate} onChange={set("emirate")}>
                <option value="">—</option>
                {EMIRATES.map((e) => (
                  <option key={e.code} value={e.code}>
                    {t(e.en)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("Phone")}>{(id) => <Input id={id} value={f.phone} onChange={set("phone")} />}</Field>
          <Field label={t("Email")}>{(id) => <Input id={id} type="email" value={f.email} onChange={set("email")} />}</Field>
          <Field label={t("Website")}>{(id) => <Input id={id} value={f.website} onChange={set("website")} />}</Field>
          <Field label={t("Logo address (URL)")} hint={t("A link to an image of your logo. Leave empty to use the BS Garage mark.")}>{(id, d) => <Input id={id} aria-describedby={d} value={f.logo_url} onChange={set("logo_url")} placeholder="https://" />}</Field>
        </div>
      </Card>
      <Card>
        <CardTitle>{t("VAT")}</CardTitle>
        <Checkbox label={t("The garage is registered for VAT (documents are titled “Tax Invoice”)")} checked={f.vat_registered} onChange={(e) => setF({ ...f, vat_registered: e.target.checked })} />
        <Alert tone="neutral" className="mt-3">{t("Rates are managed in the VAT rates tab. BS Garage applies the settings you enter; check them with your accountant.")}</Alert>
      </Card>
      <Card>
        <CardTitle>{t("Billing defaults")}</CardTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Payment terms (days)")} hint={t("0 = due on receipt. Sets the due date of new invoices.")}>{(id, d) => <Input id={id} aria-describedby={d} inputMode="numeric" value={f.default_payment_terms_days} onChange={set("default_payment_terms_days")} />}</Field>
          <Field label={t("Estimate validity (days)")}>{(id) => <Input id={id} inputMode="numeric" value={f.estimate_validity_days} onChange={set("estimate_validity_days")} />}</Field>
          <Field label={t("Default labor rate per hour (AED)")}>{(id) => <Input id={id} inputMode="decimal" value={f.default_labor_rate} onChange={set("default_labor_rate")} />}</Field>
          <Field label={t("“Large amount” threshold (AED)")} hint={t("Used by the Outstanding invoices filter.")}>{(id, d) => <Input id={id} aria-describedby={d} inputMode="decimal" value={f.large_amount_threshold} onChange={set("large_amount_threshold")} />}</Field>
        </div>
        <div className="mt-4 space-y-4">
          <Field label={t("Invoice terms & conditions")}>{(id) => <Textarea id={id} value={f.invoice_terms} onChange={set("invoice_terms")} />}</Field>
          <Field label={t("Estimate terms & conditions")}>{(id) => <Textarea id={id} value={f.estimate_terms} onChange={set("estimate_terms")} />}</Field>
          <Field label={t("Footer on invoices and receipts")}>{(id) => <Input id={id} value={f.receipt_footer} onChange={set("receipt_footer")} placeholder={t("Thank you for your business.")} />}</Field>
        </div>
      </Card>
      <FormError error={error} />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="lg" loading={busy}>
          {t("Save settings")}
        </Button>
      </div>
    </form>
  );
}
