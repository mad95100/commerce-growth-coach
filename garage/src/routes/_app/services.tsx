import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ClipboardList, Plus, Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useOrg, useRefData, useSession } from "@/app/session.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { Badge, EmptyState, ErrorState, FormError, Loading } from "@/components/ui/feedback.tsx";
import { Checkbox, Chips, Field, Input, Select, Textarea } from "@/components/ui/form.tsx";
import { Card, NotAllowed, PageHeader, TableWrap, tableClass, td, th, trClass } from "@/components/ui/layout.tsx";
import { Money } from "@/components/ui/money.tsx";
import { t, useLang } from "@/lib/i18n.tsx";
import { formatMoney, parseAmount } from "@/lib/money.ts";
import { SUGGESTED_SERVICES } from "@/lib/labels.ts";
import { supabase } from "@/lib/supabase.ts";
import type { Service } from "@/api/types.ts";

export const Route = createFileRoute("/_app/services")({ component: Services });

const SUGGESTED = SUGGESTED_SERVICES;

function Services() {
  const org = useOrg();
  const { can } = useSession();
  const { lang } = useLang();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<Service | "new" | null>(null);
  const q = useQuery({
    queryKey: ["services", org.id],
    enabled: can("catalog.view"),
    queryFn: async () => {
      const { data, error } = await supabase.from("services").select("*").eq("org_id", org.id).order("category").order("name");
      if (error) throw error;
      return data as Service[];
    },
  });
  if (!can("catalog.view")) return <NotAllowed />;
  const s = text.trim().toLowerCase();
  const rows = (q.data ?? []).filter((x) => !s || [x.name, x.category, x.code].some((v) => (v ?? "").toLowerCase().includes(s)));
  return (
    <div>
      <PageHeader
        title={t("Services & labor")}
        subtitle={t("Your price list of services: fixed price, or hours × hourly rate.")}
        actions={can("catalog.manage") && <Button variant="primary" onClick={() => setEditing("new")} icon={<Plus className="size-4" />}>{t("New service")}</Button>}
      />
      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
        <Input aria-label={t("Search services")} placeholder={t("Name, category, code…")} value={text} onChange={(e) => setText(e.target.value)} className="ps-9" />
      </div>
      <Card padded={false}>
        {q.isPending && <Loading />}
        {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} className="m-4" />}
        {q.isSuccess && rows.length === 0 && (
          <EmptyState
            icon={<ClipboardList className="size-6" />}
            title={s ? t("No service matches") : t("No service in the list yet")}
            text={!s ? t("Common services: {list}. Add them with your own prices.", { list: SUGGESTED.map((x) => t(x)).join(", ") }) : undefined}
            action={!s && can("catalog.manage") && <Button variant="primary" onClick={() => setEditing("new")} icon={<Plus className="size-4" />}>{t("New service")}</Button>}
          />
        )}
        {rows.length > 0 && (
          <TableWrap>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={th}>{t("Service")}</th>
                  <th className={`${th} hidden md:table-cell`}>{t("Category")}</th>
                  <th className={th}>{t("Pricing")}</th>
                  <th className={`${th} text-end`}>{t("Price")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.id} className={`${trClass} ${can("catalog.manage") ? "cursor-pointer" : ""}`} onClick={() => can("catalog.manage") && setEditing(x)}>
                    <td className={td}>
                      <span className="font-medium">{x.name}</span> {!x.active && <Badge tone="muted">{t("Inactive")}</Badge>}
                      {x.description && <div className="line-clamp-1 text-xs text-muted">{x.description}</div>}
                    </td>
                    <td className={`${td} hidden md:table-cell`}>{x.category}</td>
                    <td className={td}>{x.pricing === "hourly" ? t("{h} h × {rate}", { h: Number(x.duration_hours), rate: formatMoney(x.labor_rate, lang) }) : t("Fixed price")}</td>
                    <td className={`${td} text-end`}>
                      <Money value={x.pricing === "hourly" ? Number(x.labor_rate) * Number(x.duration_hours) : x.price} strong />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      {editing && <ServiceDialog service={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await qc.invalidateQueries(); }} />}
    </div>
  );
}

function ServiceDialog({ service, onClose, onSaved }: { service: Service | null; onClose: () => void; onSaved: () => void }) {
  const org = useOrg();
  const ref = useRefData();
  const [f, setF] = useState({
    name: service?.name ?? "",
    code: service?.code ?? "",
    category: service?.category ?? "",
    description: service?.description ?? "",
    pricing: service?.pricing ?? ("fixed" as "fixed" | "hourly"),
    price: service ? String(service.price) : "",
    labor_rate: service?.labor_rate != null ? String(service.labor_rate) : org.default_labor_rate ? String(org.default_labor_rate) : "",
    duration_hours: service?.duration_hours != null ? String(service.duration_hours) : "1",
    tax_rate_id: service?.tax_rate_id ?? "",
    active: service?.active ?? true,
  });
  const [invalid, setInvalid] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) return setInvalid(t("Enter the service name."));
    const price = parseAmount(f.price || "0");
    const rate = parseAmount(f.labor_rate || "0");
    const hours = Number(f.duration_hours.replace(",", "."));
    if (f.pricing === "fixed" && price === null) return setInvalid(t("Enter a valid price."));
    if (f.pricing === "hourly" && (rate === null || !(hours > 0))) return setInvalid(t("Enter the hourly rate and the duration."));
    setInvalid(null);
    setBusy(true);
    const row = {
      name: f.name.trim(),
      code: f.code.trim() || null,
      category: f.category.trim() || null,
      description: f.description.trim() || null,
      pricing: f.pricing,
      price: f.pricing === "fixed" ? (price ?? 0) / 100 : 0,
      labor_rate: f.pricing === "hourly" ? (rate ?? 0) / 100 : null,
      duration_hours: f.pricing === "hourly" ? hours : null,
      tax_rate_id: f.tax_rate_id || null,
      active: f.active,
    };
    const res = service ? await supabase.from("services").update(row).eq("id", service.id) : await supabase.from("services").insert({ ...row, org_id: org.id });
    setBusy(false);
    if (res.error) return setError(res.error);
    onSaved();
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={service ? t("Edit service") : t("New service")}
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="primary" type="submit" form="svc-form" loading={busy}>
            {t("Save")}
          </Button>
        </>
      }
    >
      <form id="svc-form" onSubmit={submit} className="space-y-4" noValidate>
        <Field label={t("Name")} required>
          {(id) => (
            <>
              <Input id={id} list="svc-suggest" value={f.name} onChange={set("name")} autoFocus />
              <datalist id="svc-suggest">{SUGGESTED.map((x) => <option key={x} value={t(x)} />)}</datalist>
            </>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Category")}>{(id) => <Input id={id} value={f.category} onChange={set("category")} placeholder={t("Maintenance, Brakes, AC…")} />}</Field>
          <Field label={t("Code")}>{(id) => <Input id={id} value={f.code} onChange={set("code")} />}</Field>
        </div>
        <Chips
          label={t("Pricing")}
          value={f.pricing}
          onChange={(v) => setF({ ...f, pricing: v })}
          options={[
            { value: "fixed", label: t("Fixed price") },
            { value: "hourly", label: t("Hours × rate") },
          ]}
        />
        {f.pricing === "fixed" ? (
          <Field label={t("Price (AED, excl. VAT)")}>{(id) => <Input id={id} inputMode="decimal" value={f.price} onChange={set("price")} className="max-w-48 text-end num" />}</Field>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Hourly rate (AED)")}>{(id) => <Input id={id} inputMode="decimal" value={f.labor_rate} onChange={set("labor_rate")} className="text-end num" />}</Field>
            <Field label={t("Standard duration (hours)")}>{(id) => <Input id={id} inputMode="decimal" value={f.duration_hours} onChange={set("duration_hours")} className="text-end num" />}</Field>
          </div>
        )}
        {org.vat_registered && (
          <Field label={t("VAT rate")}>
            {(id) => (
              <Select id={id} value={f.tax_rate_id} onChange={set("tax_rate_id")}>
                <option value="">{t("Default ({rate}%)", { rate: Number(ref.data?.defaultTaxRate?.rate ?? 0) })}</option>
                {(ref.data?.taxRates ?? []).filter((r) => r.active).map((r) => (
                  <option key={r.id} value={r.id}>
                    {Number(r.rate)}% {r.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label={t("Description")}>{(id) => <Textarea id={id} value={f.description} onChange={set("description")} />}</Field>
        <Checkbox label={t("Active (available on documents)")} checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
        {invalid && <p className="text-sm text-bad">{invalid}</p>}
        <FormError error={error} />
      </form>
    </Dialog>
  );
}
