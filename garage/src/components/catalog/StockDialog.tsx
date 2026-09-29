import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useOrg, useRefData, useSession } from "@/app/session.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { FormError } from "@/components/ui/feedback.tsx";
import { Chips, Field, Input, Select } from "@/components/ui/form.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { t } from "@/lib/i18n.tsx";
import { rpc } from "@/lib/supabase.ts";

type Kind = "stock_in" | "stock_out" | "adjustment" | "count";

/** Receive, remove, correct or count stock for one part in one branch. */
export function StockDialog({ open, onClose, part }: { open: boolean; onClose: () => void; part: { id: string; name: string; unit: string } }) {
  const org = useOrg();
  const ref = useRefData();
  const { branchId } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const branches = (ref.data?.branches ?? []).filter((b) => b.active);
  const [f, setF] = useState<{ kind: Kind; quantity: string; note: string; branch: string }>({ kind: "stock_in", quantity: "", note: "", branch: branchId ?? branches[0]?.id ?? "" });
  const [invalid, setInvalid] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const q = f.quantity.replace(",", ".").trim();
    const ok = f.kind === "adjustment" ? /^-?\d+(\.\d{1,2})?$/.test(q) && Number(q) !== 0 : /^\d+(\.\d{1,2})?$/.test(q) && (f.kind === "count" || Number(q) > 0);
    if (!ok) return setInvalid(f.kind === "adjustment" ? t("Enter a positive or negative quantity, e.g. -2.") : t("Enter a quantity."));
    if (f.kind !== "stock_in" && !f.note.trim()) return setInvalid(t("A reason is required."));
    setInvalid(null);
    setBusy(true);
    setError(null);
    try {
      const bal = await rpc<number>("adjust_stock", { p: { org_id: org.id, branch_id: f.branch || null, part_id: part.id, kind: f.kind, quantity: Number(q), note: f.note } });
      await qc.invalidateQueries();
      toast(t("Stock updated: {n} {unit}", { n: Number(bal), unit: part.unit }));
      onClose();
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
      title={t("Stock — {name}", { name: part.name })}
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="primary" type="submit" form="stock-form" loading={busy}>
            {t("Save")}
          </Button>
        </>
      }
    >
      <form id="stock-form" onSubmit={submit} className="space-y-4" noValidate>
        <Chips
          label={t("Operation")}
          value={f.kind}
          onChange={(k) => setF({ ...f, kind: k })}
          options={[
            { value: "stock_in", label: t("Stock in") },
            { value: "stock_out", label: t("Stock out") },
            { value: "adjustment", label: t("Adjustment") },
            { value: "count", label: t("Inventory count") },
          ]}
        />
        {branches.length > 1 && (
          <Field label={t("Branch")}>
            {(id) => (
              <Select id={id} value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label={f.kind === "count" ? t("Quantity counted on the shelf") : f.kind === "adjustment" ? t("Change (+ or −)") : t("Quantity")} error={invalid}>
          {(id, d) => <Input id={id} aria-describedby={d} inputMode="decimal" autoFocus value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} className="max-w-40 text-end num" />}
        </Field>
        <Field label={f.kind === "stock_in" ? t("Note") : t("Reason")} required={f.kind !== "stock_in"}>
          {(id) => <Input id={id} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={f.kind === "stock_out" ? t("e.g. Damaged, used in workshop") : f.kind === "count" ? t("e.g. Monthly count") : ""} />}
        </Field>
        <FormError error={error} />
      </form>
    </Dialog>
  );
}
