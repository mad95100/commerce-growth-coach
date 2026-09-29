import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { useRefData } from "@/app/session.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { Alert, FormError } from "@/components/ui/feedback.tsx";
import { Checkbox, Chips, Field, Input, Select, Textarea } from "@/components/ui/form.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { t, useLang } from "@/lib/i18n.tsx";
import { formatMoney, parseAmount } from "@/lib/money.ts";
import { rpc, supabase } from "@/lib/supabase.ts";
import { useQuery } from "@tanstack/react-query";
import type { DocLine, InvoiceRow } from "@/api/types.ts";

/**
 * Credit note on an issued invoice: by lines (quantities returned or not
 * charged, parts optionally back to stock) or by amount (goodwill).
 */
export function CreditNoteDialog({ open, onClose, inv, lines }: { open: boolean; onClose: () => void; inv: InvoiceRow; lines: DocLine[] }) {
  const ref = useRefData();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { lang } = useLang();
  const [mode, setMode] = useState<"lines" | "amount">("lines");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState("");
  const [rateId, setRateId] = useState<string>(ref.data?.defaultTaxRate?.id ?? "");
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(true);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const remaining = Math.round((Number(inv.total) - Number(inv.credited)) * 100) / 100;

  const credited = useQuery({
    queryKey: ["credited-lines", inv.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("doc_lines").select("source_line_id, quantity").in("source_line_id", lines.map((l) => l.id));
      if (error) throw error;
      const m: Record<string, number> = {};
      for (const r of data ?? []) m[r.source_line_id as string] = (m[r.source_line_id as string] ?? 0) + Number(r.quantity);
      return m;
    },
  });

  const estimate = useMemo(() => {
    let sum = 0;
    for (const l of lines) {
      const q = Number(qty[l.id] || 0);
      if (q > 0) sum += (Number(l.total) * q) / Number(l.quantity);
    }
    return Math.round(sum * 100) / 100;
  }, [qty, lines]);
  const hasParts = lines.some((l) => l.part_id && Number(qty[l.id] || 0) > 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setInvalid(null);
    if (!reason.trim()) return setInvalid(t("A reason is required."));
    const p: Record<string, unknown> = { invoice_id: inv.id, mode, reason: reason.trim(), restock: mode === "lines" && restock };
    if (mode === "lines") {
      const sel = lines.filter((l) => Number(qty[l.id] || 0) > 0).map((l) => ({ line_id: l.id, quantity: Number(qty[l.id]) }));
      if (sel.length === 0) return setInvalid(t("Enter the quantity to credit on at least one line."));
      p.lines = sel;
    } else {
      const fils = parseAmount(amount);
      if (!fils) return setInvalid(t("Enter an amount above zero, with 2 decimals at most."));
      p.amount = fils / 100;
      p.tax_rate_id = rateId || null;
    }
    setBusy(true);
    setError(null);
    try {
      const id = await rpc<string>("create_credit_note", { p });
      await qc.invalidateQueries();
      toast(t("Credit note created."));
      onClose();
      navigate({ to: "/credit-notes/$id", params: { id } });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("Credit note for {number}", { number: inv.number ?? "" })}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="primary" type="submit" form="cn-form" loading={busy}>
            {t("Create credit note")}
          </Button>
        </>
      }
    >
      <form id="cn-form" onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm text-muted">{t("Still creditable on this invoice: {amount}", { amount: formatMoney(remaining, lang) })}</p>
        <Chips
          label={t("Credit type")}
          value={mode}
          onChange={setMode}
          options={[
            { value: "lines", label: t("Credit lines") },
            { value: "amount", label: t("Credit an amount") },
          ]}
        />
        {mode === "lines" ? (
          <div className="space-y-2">
            {lines.map((l) => {
              const already = credited.data?.[l.id] ?? 0;
              const left = Number(l.quantity) - already;
              return (
                <div key={l.id} className="flex items-center gap-3 rounded-lg border border-line p-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{l.description}</p>
                    <p className="text-xs text-muted">
                      {t("Invoiced {q} · already credited {c}", { q: Number(l.quantity), c: already })} · {formatMoney(l.total, lang)}
                    </p>
                  </div>
                  <Input aria-label={t("Quantity to credit")} inputMode="decimal" disabled={left <= 0} placeholder="0" value={qty[l.id] ?? ""} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} className="w-20 text-end num" />
                  <Button size="sm" disabled={left <= 0} onClick={() => setQty({ ...qty, [l.id]: String(left) })}>
                    {t("All")}
                  </Button>
                </div>
              );
            })}
            <p className="text-end text-sm">
              {t("Approximate credit: {amount}", { amount: formatMoney(estimate, lang) })}
            </p>
            {hasParts && <Checkbox label={t("Put the returned parts back into stock")} checked={restock} onChange={(e) => setRestock(e.target.checked)} />}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Amount incl. VAT (AED)")}>{(id) => <Input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-end num" />}</Field>
            {inv.vat_registered && (
              <Field label={t("VAT rate")}>
                {(id) => (
                  <Select id={id} value={rateId} onChange={(e) => setRateId(e.target.value)}>
                    {(ref.data?.taxRates ?? []).map((r) => (
                      <option key={r.id} value={r.id}>
                        {Number(r.rate)}% {r.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
          </div>
        )}
        <Field label={t("Reason")} required>{(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("e.g. Part returned unused, goodwill for delay")} />}</Field>
        {invalid && <Alert tone="bad">{invalid}</Alert>}
        <Alert tone="neutral">{t("If the invoice was already paid, the customer will be owed money: record the refund afterwards.")}</Alert>
        <FormError error={error} />
      </form>
    </Dialog>
  );
}
