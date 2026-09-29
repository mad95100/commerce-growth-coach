import { useState, type FormEvent } from "react";
import { useOrg } from "@/app/session.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { FormError } from "@/components/ui/feedback.tsx";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form.tsx";
import { t } from "@/lib/i18n.tsx";
import { supabase } from "@/lib/supabase.ts";
import type { Supplier } from "@/api/types.ts";

export function SupplierDialog({ supplier, onClose, onSaved }: { supplier: Supplier | null; onClose: () => void; onSaved: (s: Supplier) => void }) {
  const org = useOrg();
  const [f, setF] = useState({
    name: supplier?.name ?? "",
    contact_name: supplier?.contact_name ?? "",
    phone: supplier?.phone ?? "",
    email: supplier?.email ?? "",
    address: supplier?.address ?? "",
    trn: supplier?.trn ?? "",
    payment_terms: supplier?.payment_terms ?? "",
    notes: supplier?.notes ?? "",
    active: supplier?.active ?? true,
  });
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) return setInvalid(true);
    setBusy(true);
    const row = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === "string" ? v.trim() || null : v]));
    const res = supplier ? await supabase.from("suppliers").update(row).eq("id", supplier.id).select().single() : await supabase.from("suppliers").insert({ ...row, org_id: org.id }).select().single();
    setBusy(false);
    if (res.error) return setError(res.error);
    onSaved(res.data as Supplier);
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={supplier ? t("Edit supplier") : t("New supplier")}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="primary" type="submit" form="sup-form" loading={busy}>
            {t("Save")}
          </Button>
        </>
      }
    >
      <form id="sup-form" onSubmit={submit} className="space-y-4" noValidate>
        <Field label={t("Company")} required error={invalid ? t("Enter the company name.") : null}>{(id, d) => <Input id={id} aria-describedby={d} aria-invalid={invalid} value={f.name} onChange={set("name")} autoFocus />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Contact")}>{(id) => <Input id={id} value={f.contact_name} onChange={set("contact_name")} />}</Field>
          <Field label={t("Phone")}>{(id) => <Input id={id} type="tel" value={f.phone} onChange={set("phone")} />}</Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Email")}>{(id) => <Input id={id} type="email" value={f.email} onChange={set("email")} />}</Field>
          <Field label={t("TRN")}>{(id) => <Input id={id} value={f.trn} onChange={set("trn")} />}</Field>
        </div>
        <Field label={t("Address")}>{(id) => <Input id={id} value={f.address} onChange={set("address")} />}</Field>
        <Field label={t("Payment terms")}>{(id) => <Input id={id} value={f.payment_terms} onChange={set("payment_terms")} placeholder={t("e.g. 30 days, cash on delivery")} />}</Field>
        <Field label={t("Notes")}>{(id) => <Textarea id={id} value={f.notes} onChange={set("notes")} />}</Field>
        <Checkbox label={t("Active")} checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
        <FormError error={error} />
      </form>
    </Dialog>
  );
}
