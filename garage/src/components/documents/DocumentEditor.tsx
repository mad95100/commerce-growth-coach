import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import clsx from "clsx";
import { CheckCircle2, FileText, Save } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useOrg, useRefData, useSession } from "@/app/session.tsx";
import { PartyPicker } from "@/components/pickers/PartyPicker.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Alert, FormError } from "@/components/ui/feedback.tsx";
import { Field, Input, Select, Textarea } from "@/components/ui/form.tsx";
import { Card, CardTitle } from "@/components/ui/layout.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { addDays, dubaiParts, dubaiTimestamp, todayISO } from "@/lib/dates.ts";
import { t, useLang } from "@/lib/i18n.tsx";
import { formatMoney, parseAmount } from "@/lib/money.ts";
import { rpc } from "@/lib/supabase.ts";
import type { DiscountType } from "@/lib/totals.ts";
import type { DocLine, EstimateRow, InvoiceRow, JobCardRow } from "@/api/types.ts";
import { fromDocLine, lineProblems, previewTotals, toPayload, type EditLine } from "./lines.ts";
import { LineEditor } from "./LineEditor.tsx";

type Kind = "invoice" | "estimate" | "job_card";

export interface EditorProps {
  kind: Kind;
  existing?: { header: InvoiceRow | EstimateRow | JobCardRow; lines: DocLine[] };
  initialCustomerId?: string | null;
  initialVehicleId?: string | null;
}

function Step({ n, title, children, aside }: { n: number; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <span className="flex size-7 items-center justify-center rounded-full bg-brand text-sm text-white">{n}</span>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </Card>
  );
}

export function DocumentEditor({ kind, existing, initialCustomerId, initialVehicleId }: EditorProps) {
  const org = useOrg();
  const ref = useRefData();
  const { branchId, can } = useSession();
  const { lang } = useLang();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const h = existing?.header as (InvoiceRow & EstimateRow & JobCardRow) | undefined;

  const [customerId, setCustomerId] = useState<string | null>(h?.customer_id ?? initialCustomerId ?? null);
  const [vehicleId, setVehicleId] = useState<string | null>(h?.vehicle_id ?? initialVehicleId ?? null);
  const [lines, setLinesState] = useState<EditLine[]>(() => (existing?.lines ?? []).map(fromDocLine));
  const setLines = useCallback((fn: (l: EditLine[]) => EditLine[]) => setLinesState(fn), []);
  const [discountType, setDiscountType] = useState<DiscountType>(h?.discount_type ?? null);
  const [discountValue, setDiscountValue] = useState(h?.discount_value ? String(h.discount_value) : "");
  const promised = h?.promised_at ? dubaiParts(h.promised_at) : null;
  const [f, setF] = useState({
    mileage: String(h?.mileage ?? h?.mileage_in ?? ""),
    description: h?.description ?? h?.complaint ?? "",
    diagnosis: h?.diagnosis ?? "",
    work_done: h?.work_done ?? "",
    internal_notes: h?.internal_notes ?? "",
    notes: h?.notes ?? "",
    terms: h?.terms ?? (kind === "invoice" ? (org.invoice_terms ?? "") : kind === "estimate" ? (org.estimate_terms ?? "") : ""),
    valid_until: h?.valid_until ?? addDays(todayISO(), org.estimate_validity_days),
    technician_id: h?.technician_id ?? "",
    promised_date: promised?.date ?? "",
    promised_time: promised?.time ?? "17:00",
  });
  const [pay, setPay] = useState({ amount: "", method_id: "", reference: "" });
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<null | "draft" | "issue">(null);

  const taxRates = useMemo(() => ref.data?.taxRates ?? [], [ref.data]);
  const totals = useMemo(
    () => previewTotals(lines, taxRates, ref.data?.defaultTaxRate ?? null, discountType, discountValue, org.vat_registered),
    [lines, taxRates, ref.data?.defaultTaxRate, discountType, discountValue, org.vat_registered],
  );
  const deposits = kind === "invoice" ? Number(h?.paid ?? 0) : Number(h?.deposits ?? 0);
  const due = Math.round((totals.total - deposits) * 100) / 100;
  const methods = (ref.data?.methods ?? []).filter((m) => m.active);
  const lockedParties = kind === "invoice" && !!h?.job_card_id;
  const onParty = useCallback((c: string | null, v: string | null) => {
    setCustomerId(c);
    setVehicleId(v);
  }, []);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const problems = [
    !customerId ? t("Choose a customer.") : null,
    kind === "job_card" && !vehicleId ? t("Choose the vehicle.") : null,
    lines.some((l) => lineProblems(l).length > 0) ? t("Some lines are incomplete.") : null,
    discountType === "percent" && (Number(discountValue) > 100 || Number(discountValue) < 0) ? t("A discount must be between 0 and 100%.") : null,
    f.mileage && !/^\d+$/.test(f.mileage.replace(/[\s,]/g, "")) ? t("Mileage must be a number of kilometres.") : null,
  ].filter(Boolean) as string[];
  const payFils = pay.amount.trim() ? parseAmount(pay.amount) : null;
  const payProblem = pay.amount.trim() && (payFils === null || payFils <= 0) ? t("Enter a valid amount.") : pay.amount.trim() && !pay.method_id ? t("Choose how the customer paid.") : payFils !== null && payFils > Math.round(due * 100) ? t("The payment is more than the amount due.") : null;

  async function save(mode: "draft" | "issue") {
    setShowErrors(true);
    setError(null);
    if (problems.length || (mode === "issue" && payProblem)) return;
    if (mode === "issue" && lines.length === 0) return setError({ message: "bsg.invoice_empty" });
    setBusy(mode);
    const mileage = f.mileage ? Number(f.mileage.replace(/[\s,]/g, "")) : null;
    const common = {
      id: h?.id ?? null,
      org_id: org.id,
      branch_id: h?.branch_id ?? branchId,
      customer_id: customerId,
      vehicle_id: vehicleId,
      discount_type: discountType,
      discount_value: discountType ? Number(discountValue || 0) : 0,
      lines: toPayload(lines),
    };
    try {
      let target: { to: string; id: string };
      if (kind === "invoice") {
        const r = await rpc<{ invoice_id: string; number: string | null; payment_id: string | null }>("save_invoice", {
          p: {
            ...common,
            mileage,
            description: f.description,
            notes: f.notes,
            terms: f.terms,
            issue: mode === "issue",
            payment: mode === "issue" && payFils ? { amount: payFils / 100, method_id: pay.method_id, reference: pay.reference } : null,
          },
        });
        toast(mode === "issue" ? t("Invoice {number} issued.", { number: r.number ?? "" }) : t("Draft saved."));
        target = { to: "/invoices/$id", id: r.invoice_id };
      } else if (kind === "estimate") {
        const id = await rpc<string>("save_estimate", { p: { ...common, mileage, description: f.description, notes: f.notes, terms: f.terms, valid_until: f.valid_until || null } });
        toast(t("Estimate saved."));
        target = { to: "/estimates/$id", id };
      } else {
        const id = await rpc<string>("save_job_card", {
          p: {
            ...common,
            mileage_in: mileage,
            complaint: f.description,
            diagnosis: f.diagnosis,
            work_done: f.work_done,
            internal_notes: f.internal_notes,
            technician_id: f.technician_id || null,
            promised_at: f.promised_date ? dubaiTimestamp(f.promised_date, f.promised_time || "17:00") : null,
          },
        });
        toast(t("Job card saved."));
        target = { to: "/job-cards/$id", id };
      }
      await qc.invalidateQueries();
      navigate({ to: target.to, params: { id: target.id } });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  const title = kind === "invoice" ? t("Invoice details") : kind === "estimate" ? t("Estimate details") : t("Job details");

  return (
    // Not a <form>: dialogs inside (new customer, vehicle) have their own
    // forms, and Enter in a field must never issue an invoice.
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <Step n={1} title={t("Customer & vehicle")}>
          <PartyPicker customerId={customerId} vehicleId={vehicleId} onChange={onParty} locked={lockedParties} vehicleRequired={kind === "job_card"} />
          {showErrors && !customerId && <p className="mt-2 text-sm text-bad">{t("Choose a customer.")}</p>}
          {showErrors && kind === "job_card" && customerId && !vehicleId && <p className="mt-2 text-sm text-bad">{t("Choose the vehicle.")}</p>}
        </Step>

        <Step n={2} title={t("Parts, labor & services")}>
          <LineEditor lines={lines} setLines={setLines} totals={totals} showErrors={showErrors} />
        </Step>

        <Step n={3} title={title}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={kind === "job_card" ? t("Mileage in (km)") : t("Mileage (km)")}>{(id) => <Input id={id} inputMode="numeric" value={f.mileage} onChange={set("mileage")} />}</Field>
            {kind === "estimate" && <Field label={t("Valid until")}>{(id) => <Input id={id} type="date" value={f.valid_until} onChange={set("valid_until")} />}</Field>}
            {kind === "job_card" && (
              <Field label={t("Mechanic")}>
                {(id) => (
                  <Select id={id} value={f.technician_id} onChange={set("technician_id")}>
                    <option value="">{t("Not assigned")}</option>
                    {(ref.data?.technicians ?? []).filter((x) => x.active).map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
          </div>
          <div className="mt-4 space-y-4">
            <Field label={kind === "job_card" ? t("Customer complaint") : kind === "estimate" ? t("Work requested") : t("Description of work")}>
              {(id) => <Textarea id={id} value={f.description} onChange={set("description")} />}
            </Field>
            {kind === "job_card" && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("Promised date")}>{(id) => <Input id={id} type="date" value={f.promised_date} onChange={set("promised_date")} />}</Field>
                  <Field label={t("Promised time")}>{(id) => <Input id={id} type="time" value={f.promised_time} onChange={set("promised_time")} />}</Field>
                </div>
                <Field label={t("Diagnosis")}>{(id) => <Textarea id={id} value={f.diagnosis} onChange={set("diagnosis")} />}</Field>
                <Field label={t("Work done")}>{(id) => <Textarea id={id} value={f.work_done} onChange={set("work_done")} />}</Field>
                <Field label={t("Internal notes")} hint={t("Not printed for the customer.")}>{(id, d) => <Textarea id={id} aria-describedby={d} value={f.internal_notes} onChange={set("internal_notes")} />}</Field>
              </>
            )}
            {kind !== "job_card" && (
              <>
                <Field label={t("Notes for the customer")}>{(id) => <Textarea id={id} value={f.notes} onChange={set("notes")} />}</Field>
                <Field label={t("Terms & conditions")}>{(id) => <Textarea id={id} value={f.terms} onChange={set("terms")} />}</Field>
              </>
            )}
          </div>
        </Step>
      </div>

      <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
        <Card>
          <CardTitle>{t("Totals")}</CardTitle>
          <div className="mb-4 grid grid-cols-[1fr_1fr] gap-2">
            <Field label={t("Discount")}>
              {(id) => (
                <Select id={id} value={discountType ?? ""} onChange={(e) => setDiscountType((e.target.value || null) as DiscountType)}>
                  <option value="">{t("No discount")}</option>
                  <option value="percent">{t("Percent (%)")}</option>
                  <option value="amount">{t("Amount (AED)")}</option>
                </Select>
              )}
            </Field>
            {discountType && <Field label={discountType === "percent" ? "%" : "AED"}>{(id) => <Input id={id} inputMode="decimal" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} className="text-end num" />}</Field>}
          </div>
          <dl className="space-y-2 text-sm">
            <Row label={t("Subtotal")} value={formatMoney(totals.subtotal, lang)} />
            {totals.lineDiscounts > 0 && <Row label={t("incl. line discounts")} value={`−${formatMoney(totals.lineDiscounts, lang)}`} muted />}
            {totals.docDiscount > 0 && <Row label={t("Discount")} value={`−${formatMoney(totals.docDiscount, lang)}`} />}
            {org.vat_registered &&
              (totals.vatBreakdown.length > 0 ? (
                totals.vatBreakdown.map((g) => <Row key={g.rate} label={t("VAT {rate}%", { rate: g.rate })} value={formatMoney(g.vat, lang)} />)
              ) : (
                <Row label={t("VAT")} value={formatMoney(0, lang)} />
              ))}
            <div className="border-t border-line pt-2">
              <Row label={t("Total")} value={formatMoney(totals.total, lang)} strong />
            </div>
            {deposits > 0 && <Row label={t("Deposit received")} value={`−${formatMoney(deposits, lang)}`} />}
            {deposits > 0 && <Row label={t("Balance due")} value={formatMoney(due, lang)} strong />}
          </dl>

          {kind === "invoice" && can("invoices.issue") && can("payments.record") && (
            <div className="mt-5 border-t border-line pt-4">
              <p className="mb-2 text-sm font-semibold">{t("Payment now (optional)")}</p>
              <div className="flex gap-2">
                <Input aria-label={t("Amount paid")} inputMode="decimal" placeholder="0.00" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} className="text-end num" />
                <Button size="md" onClick={() => setPay({ ...pay, amount: due > 0 ? due.toFixed(2) : "" })}>
                  {t("Full")}
                </Button>
              </div>
              <div role="radiogroup" aria-label={t("Payment method")} className="mt-2 flex flex-wrap gap-1.5">
                {methods.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={pay.method_id === m.id}
                    onClick={() => setPay({ ...pay, method_id: m.id })}
                    className={clsx("min-h-10 rounded-lg border px-3 text-sm", pay.method_id === m.id ? "border-brand bg-brand-soft font-medium text-brand-ink" : "border-line-strong hover:bg-canvas")}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
              {pay.amount && <Input aria-label={t("Reference")} placeholder={t("Reference (card approval, transfer no.)")} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} className="mt-2" />}
              {showErrors && payProblem && <p className="mt-2 text-sm text-bad">{payProblem}</p>}
            </div>
          )}

          {showErrors && problems.length > 0 && (
            <Alert tone="bad" className="mt-4">
              <ul className="list-disc ps-4">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Alert>
          )}
          <div className="mt-4">
            <FormError error={error} />
          </div>

          <div className="mt-4 flex flex-col gap-2">
            {kind === "invoice" && can("invoices.issue") && (
              <Button type="button" variant="primary" size="lg" loading={busy === "issue"} disabled={!!busy} onClick={() => save("issue")} icon={<CheckCircle2 className="size-5" />}>
                {payFils ? t("Issue & record {amount}", { amount: formatMoney(payFils / 100, lang) }) : t("Issue invoice")}
              </Button>
            )}
            <Button type="button" variant={kind === "invoice" && can("invoices.issue") ? "secondary" : "primary"} size="lg" loading={busy === "draft"} disabled={!!busy} onClick={() => save("draft")} icon={kind === "invoice" ? <FileText className="size-5" /> : <Save className="size-5" />}>
              {kind === "invoice" ? t("Save as draft") : t("Save")}
            </Button>
          </div>
          {kind === "invoice" && <p className="mt-3 text-xs text-muted">{t("Issuing gives the invoice its number and locks it. Stock is updated at that moment.")}</p>}
        </Card>
      </aside>
    </div>
  );
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={clsx("flex items-baseline justify-between gap-3", muted && "text-xs text-muted")}>
      <dt className={strong ? "font-semibold" : "text-ink-2"}>{label}</dt>
      <dd className={clsx("num", strong ? "text-lg font-bold" : "font-medium")}>{value}</dd>
    </div>
  );
}
