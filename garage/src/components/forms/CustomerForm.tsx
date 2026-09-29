import { useState, type FormEvent } from "react";
import { useOrg } from "@/app/session.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { FormError } from "@/components/ui/feedback.tsx";
import { Checkbox, Chips, Field, Input, Select, Textarea } from "@/components/ui/form.tsx";
import { t } from "@/lib/i18n.tsx";
import { EMIRATES } from "@/lib/plates.ts";
import { supabase } from "@/lib/supabase.ts";
import type { Customer } from "@/api/types.ts";

const blank = (v: string) => (v.trim() === "" ? null : v.trim());

export function CustomerDialog({
  open,
  onClose,
  customer,
  onSaved,
  initialName,
}: {
  open: boolean;
  onClose: () => void;
  customer?: Customer | null;
  onSaved: (c: Customer) => void;
  initialName?: string;
}) {
  const org = useOrg();
  const [f, setF] = useState(() => ({
    type: customer?.type ?? ("individual" as "individual" | "company"),
    first_name: customer?.first_name ?? (initialName && !/\d/.test(initialName) ? initialName : ""),
    last_name: customer?.last_name ?? "",
    company_name: customer?.company_name ?? "",
    phone: customer?.phone ?? (initialName && /^[+\d\s-]{7,}$/.test(initialName) ? initialName : ""),
    whatsapp: customer?.whatsapp ?? "",
    sameWhatsapp: customer ? customer.whatsapp === customer.phone : true,
    email: customer?.email ?? "",
    address: customer?.address ?? "",
    emirate: customer?.emirate ?? org.emirate ?? "DXB",
    trn: customer?.trn ?? "",
    trade_license_no: customer?.trade_license_no ?? "",
    notes: customer?.notes ?? "",
  }));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setInvalid(null);
    if (f.type === "individual" && !f.first_name.trim() && !f.last_name.trim()) return setInvalid("name");
    if (f.type === "company" && !f.company_name.trim()) return setInvalid("company");
    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return setInvalid("email");
    setBusy(true);
    setError(null);
    const row = {
      type: f.type,
      first_name: blank(f.first_name),
      last_name: blank(f.last_name),
      company_name: f.type === "company" ? blank(f.company_name) : null,
      phone: blank(f.phone),
      whatsapp: f.sameWhatsapp ? blank(f.phone) : blank(f.whatsapp),
      email: blank(f.email),
      address: blank(f.address),
      emirate: blank(f.emirate),
      trn: f.type === "company" ? blank(f.trn) : null,
      trade_license_no: f.type === "company" ? blank(f.trade_license_no) : null,
      notes: blank(f.notes),
    };
    const res = customer
      ? await supabase.from("customers").update(row).eq("id", customer.id).select().single()
      : await supabase.from("customers").insert({ ...row, org_id: org.id }).select().single();
    setBusy(false);
    if (res.error) return setError(res.error);
    onSaved(res.data as Customer);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={customer ? t("Edit customer") : t("New customer")}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="primary" type="submit" form="customer-form" loading={busy}>
            {customer ? t("Save") : t("Create customer")}
          </Button>
        </>
      }
    >
      <form id="customer-form" onSubmit={submit} className="space-y-4" noValidate>
        <Chips
          label={t("Customer type")}
          value={f.type}
          onChange={(v) => setF({ ...f, type: v })}
          options={[
            { value: "individual", label: t("Individual") },
            { value: "company", label: t("Company") },
          ]}
        />
        {f.type === "company" && (
          <Field label={t("Company name")} required error={invalid === "company" ? t("Enter the company name.") : null}>
            {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={invalid === "company"} value={f.company_name} onChange={set("company_name")} autoFocus />}
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={f.type === "company" ? t("Contact first name") : t("First name")} required={f.type === "individual"} error={invalid === "name" ? t("Enter a first or last name.") : null}>
            {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={invalid === "name"} value={f.first_name} onChange={set("first_name")} autoFocus={f.type === "individual"} />}
          </Field>
          <Field label={f.type === "company" ? t("Contact last name") : t("Last name")}>{(id) => <Input id={id} value={f.last_name} onChange={set("last_name")} />}</Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Phone")}>{(id) => <Input id={id} type="tel" inputMode="tel" placeholder="050 123 4567" value={f.phone} onChange={set("phone")} />}</Field>
          <div>
            {f.sameWhatsapp ? (
              <div className="pt-6">
                <Checkbox label={t("WhatsApp on the same number")} checked={f.sameWhatsapp} onChange={(e) => setF({ ...f, sameWhatsapp: e.target.checked })} />
              </div>
            ) : (
              <Field label={t("WhatsApp")}>
                {(id) => <Input id={id} type="tel" inputMode="tel" value={f.whatsapp} onChange={set("whatsapp")} />}
              </Field>
            )}
            {!f.sameWhatsapp && <Checkbox label={t("WhatsApp on the same number")} checked={false} onChange={(e) => setF({ ...f, sameWhatsapp: e.target.checked })} />}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Email")} error={invalid === "email" ? t("Enter a valid email address.") : null}>
            {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={invalid === "email"} type="email" value={f.email} onChange={set("email")} />}
          </Field>
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
        </div>
        <Field label={t("Address")}>{(id) => <Input id={id} value={f.address} onChange={set("address")} />}</Field>
        {f.type === "company" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("TRN")}>{(id) => <Input id={id} inputMode="numeric" value={f.trn} onChange={set("trn")} />}</Field>
            <Field label={t("Trade licence number")}>{(id) => <Input id={id} value={f.trade_license_no} onChange={set("trade_license_no")} />}</Field>
          </div>
        )}
        <Field label={t("Notes")}>{(id) => <Textarea id={id} value={f.notes} onChange={set("notes")} />}</Field>
        <FormError error={error} />
      </form>
    </Dialog>
  );
}
