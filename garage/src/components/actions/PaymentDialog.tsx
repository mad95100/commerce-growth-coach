import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CheckCircle2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useOrg, useRefData } from "@/app/session.tsx";
import { SendButtons } from "@/components/actions/SendButtons.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { FormError } from "@/components/ui/feedback.tsx";
import { Field, Input, Textarea } from "@/components/ui/form.tsx";
import { dubaiParts, dubaiTimestamp } from "@/lib/dates.ts";
import { t, useLang } from "@/lib/i18n.tsx";
import { receiptMessage } from "@/lib/messages.ts";
import { formatMoney, parseAmount } from "@/lib/money.ts";
import { rpc, supabase } from "@/lib/supabase.ts";

export interface PaymentTarget {
  kind: "payment" | "deposit" | "refund";
  invoice_id?: string | null;
  job_card_id?: string | null;
  estimate_id?: string | null;
  credit_note_id?: string | null;
  label: string; // e.g. "Invoice INV-00012"
  max: number | null; // balance due / refundable; null = no limit (deposit)
  suggested?: number | null;
  customer: { id: string; name: string | null; phone?: string | null; whatsapp?: string | null; email?: string | null };
}

export function PaymentDialog({ open, onClose, target }: { open: boolean; onClose: () => void; target: PaymentTarget }) {
  const org = useOrg();
  const ref = useRefData();
  const qc = useQueryClient();
  const { lang } = useLang();
  const now = dubaiParts(new Date());
  const [f, setF] = useState({ amount: target.suggested ? Number(target.suggested).toFixed(2) : "", method_id: "", reference: "", notes: "", date: now.date, time: now.time });
  const [invalid, setInvalid] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; number: string; amount: number; method: string } | null>(null);
  const methods = (ref.data?.methods ?? []).filter((m) => m.active);
  const refund = target.kind === "refund";

  async function submit(e: FormEvent) {
    e.preventDefault();
    const fils = parseAmount(f.amount);
    if (fils === null || fils <= 0) return setInvalid(t("Enter an amount above zero, with 2 decimals at most."));
    if (target.max !== null && fils > Math.round(target.max * 100)) return setInvalid(t("The amount is more than {max}.", { max: formatMoney(target.max, lang) }));
    if (!f.method_id) return setInvalid(t("Choose the payment method."));
    setInvalid(null);
    setBusy(true);
    setError(null);
    try {
      const p = {
        org_id: org.id,
        kind: target.kind,
        invoice_id: target.invoice_id ?? null,
        job_card_id: target.invoice_id ? null : (target.job_card_id ?? null),
        estimate_id: target.invoice_id || target.job_card_id ? null : (target.estimate_id ?? null),
        credit_note_id: target.credit_note_id ?? null,
        amount: fils / 100,
        method_id: f.method_id,
        reference: f.reference,
        notes: f.notes,
        paid_at: dubaiTimestamp(f.date, f.time),
      };
      const id = await rpc<string>(refund ? "record_refund" : "record_payment", { p });
      const { data: row } = await supabase.from("payments").select("number").eq("id", id).maybeSingle();
      await qc.invalidateQueries();
      setDone({ id, number: (row?.number as string) ?? "", amount: fils / 100, method: methods.find((m) => m.id === f.method_id)?.name ?? "" });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const title = refund ? t("Record a refund") : target.kind === "deposit" ? t("Record a deposit") : t("Record a payment");

  if (done) {
    const remaining = target.max !== null && !refund ? Math.max(0, target.max - done.amount) : null;
    const msg = receiptMessage({ garage: org.name, customer: target.customer.name, receipt: done.number, invoice: target.invoice_id ? target.label : null, amount: done.amount, method: done.method, balance: remaining, refund });
    return (
      <Dialog open={open} onClose={onClose} title={title} footer={<Button variant="primary" onClick={onClose}>{t("Done")}</Button>}>
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <CheckCircle2 className="size-10 text-ok" aria-hidden />
          <p className="text-lg font-semibold">{refund ? t("Refund recorded") : t("Payment recorded")}</p>
          <p className="text-sm font-medium">{t("Receipt {number}", { number: done.number })}</p>
          <p className="text-sm text-muted">
            {formatMoney(done.amount, lang)} · {done.method}
            {remaining !== null && ` · ${t("Remaining balance: {amount}", { amount: formatMoney(remaining, lang) })}`}
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <SendButtons
              ctx={{
                purpose: "receipt",
                message: msg,
                phone: target.customer.whatsapp ?? target.customer.phone,
                email: target.customer.email,
                refs: { customer_id: target.customer.id, invoice_id: target.invoice_id ?? null, payment_id: done.id },
                printHref: `/print/receipt/${done.id}`,
              }}
            />
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button variant={refund ? "danger" : "success"} type="submit" form="payment-form" loading={busy}>
            {refund ? t("Record refund") : t("Record payment")}
          </Button>
        </>
      }
    >
      <form id="payment-form" onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm text-muted">
          {target.label}
          {target.max !== null && ` · ${refund ? t("Refundable: {amount}", { amount: formatMoney(target.max, lang) }) : t("Balance due: {amount}", { amount: formatMoney(target.max, lang) })}`}
        </p>
        <Field label={t("Amount (AED)")} required error={invalid}>
          {(id, d) => (
            <div className="flex gap-2">
              <Input id={id} aria-describedby={d} inputMode="decimal" autoFocus value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className="text-end text-lg font-semibold num" />
              {target.max !== null && (
                <Button onClick={() => setF({ ...f, amount: target.max!.toFixed(2) })}>{t("Full")}</Button>
              )}
            </div>
          )}
        </Field>
        <div>
          <p className="mb-1 text-sm font-medium text-ink-2">{t("Payment method")}</p>
          <div role="radiogroup" aria-label={t("Payment method")} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {methods.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={f.method_id === m.id}
                onClick={() => setF({ ...f, method_id: m.id })}
                className={clsx("min-h-12 rounded-lg border px-3 text-sm", f.method_id === m.id ? "border-brand bg-brand-soft font-semibold text-brand-ink" : "border-line-strong hover:bg-canvas")}
              >
                {m.name}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Date")}>{(id) => <Input id={id} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
          <Field label={t("Time")}>{(id) => <Input id={id} type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />}</Field>
        </div>
        <Field label={t("Reference")} hint={t("Card approval code, transfer number, cheque number…")}>{(id, d) => <Input id={id} aria-describedby={d} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />}</Field>
        <Field label={t("Notes")}>{(id) => <Textarea id={id} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
        <FormError error={error} />
      </form>
    </Dialog>
  );
}
