import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useOrg, useSession } from "@/app/session.tsx";
import { CatalogPicker } from "@/components/pickers/CatalogPicker.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Alert, FormError } from "@/components/ui/feedback.tsx";
import { Field, Input, Select, Textarea, inputClass } from "@/components/ui/form.tsx";
import { Card, CardTitle } from "@/components/ui/layout.tsx";
import { t, useLang } from "@/lib/i18n.tsx";
import { formatMoney } from "@/lib/money.ts";
import { rpc, supabase } from "@/lib/supabase.ts";
import type { Supplier } from "@/api/types.ts";
import type { PurchaseOrderBundle } from "@/api/documents2.ts";

interface Line {
  key: string;
  part_id: string | null;
  description: string;
  quantity: string;
  unit_cost: string;
}
let n = 0;
const key = () => `po${n++}`;

export function PurchaseOrderEditor({ existing, supplierId }: { existing?: PurchaseOrderBundle; supplierId?: string }) {
  const org = useOrg();
  const { branchId } = useSession();
  const { lang } = useLang();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const suppliers = useQuery({
    queryKey: ["suppliers", "options", org.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("id, name").eq("org_id", org.id).eq("active", true).order("name");
      if (error) throw error;
      return data as Pick<Supplier, "id" | "name">[];
    },
  });
  const [supplier, setSupplier] = useState(existing?.po.supplier_id ?? supplierId ?? "");
  const [expected, setExpected] = useState(existing?.po.expected_date ?? "");
  const [notes, setNotes] = useState(existing?.po.notes ?? "");
  const [lines, setLines] = useState<Line[]>(existing?.lines.map((l) => ({ key: key(), part_id: l.part_id, description: l.description, quantity: String(l.quantity), unit_cost: String(l.unit_cost) })) ?? []);
  const [error, setError] = useState<unknown>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ok = (s: string) => /^\d+(\.\d{1,2})?$/.test(s.trim());
  const total = lines.reduce((s, l) => s + (ok(l.quantity) && ok(l.unit_cost) ? Number(l.quantity) * Number(l.unit_cost) : 0), 0);

  async function save() {
    if (!supplier) return setInvalid(t("Choose the supplier."));
    if (lines.length === 0) return setInvalid(t("Add at least one line."));
    if (lines.some((l) => !l.description.trim() || !ok(l.quantity) || Number(l.quantity) <= 0 || !ok(l.unit_cost))) return setInvalid(t("Some lines are incomplete."));
    setInvalid(null);
    setBusy(true);
    setError(null);
    try {
      const id = await rpc<string>("save_purchase_order", {
        p: { id: existing?.po.id ?? null, org_id: org.id, branch_id: existing?.po.branch_id ?? branchId, supplier_id: supplier, expected_date: expected || null, notes, lines: lines.map((l) => ({ part_id: l.part_id, description: l.description.trim(), quantity: Number(l.quantity), unit_cost: Number(l.unit_cost) })) },
      });
      await qc.invalidateQueries();
      navigate({ to: "/purchase-orders/$id", params: { id } });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Supplier")} required>
            {(id) => (
              <Select id={id} value={supplier} onChange={(e) => setSupplier(e.target.value)}>
                <option value="">{t("Choose…")}</option>
                {(suppliers.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("Expected delivery")}>{(id) => <Input id={id} type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />}</Field>
        </div>
      </Card>
      <Card>
        <CardTitle>{t("Items")}</CardTitle>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex-1">
            <CatalogPicker onPick={(i) => i.type === "part" && setLines((ls) => [...ls, { key: key(), part_id: i.part.id, description: i.part.name, quantity: "1", unit_cost: String(i.part.purchase_price) }])} />
          </div>
          <Button onClick={() => setLines((ls) => [...ls, { key: key(), part_id: null, description: "", quantity: "1", unit_cost: "" }])} icon={<Plus className="size-4" />}>
            {t("Custom line")}
          </Button>
        </div>
        <ul className="mt-3 space-y-2">
          {lines.map((l) => (
            <li key={l.key} className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-line p-2 sm:grid-cols-[1fr_90px_120px_auto]">
              <input aria-label={t("Description")} className={`${inputClass} col-span-2 sm:col-span-1`} value={l.description} placeholder={t("Description")} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, description: e.target.value } : x)))} />
              <input aria-label={t("Qty")} inputMode="decimal" className={`${inputClass} text-end num`} value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, quantity: e.target.value } : x)))} />
              <input aria-label={t("Unit cost")} inputMode="decimal" placeholder="0.00" className={`${inputClass} text-end num`} value={l.unit_cost} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, unit_cost: e.target.value } : x)))} />
              <button type="button" aria-label={t("Remove line")} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="inline-flex size-11 items-center justify-center rounded-lg text-muted hover:bg-bad-soft hover:text-bad">
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-end text-sm">
          {t("Total excl. VAT:")} <span className="font-semibold num">{formatMoney(total, lang)}</span>
        </p>
      </Card>
      <Card>
        <Field label={t("Notes for the supplier")}>{(id) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      </Card>
      {invalid && <Alert tone="bad">{invalid}</Alert>}
      <FormError error={error} />
      <div className="flex justify-end">
        <Button variant="primary" size="lg" loading={busy} onClick={save}>
          {t("Save purchase order")}
        </Button>
      </div>
    </div>
  );
}
