import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useOrg, useRefData, useSession } from "@/app/session.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { FormError } from "@/components/ui/feedback.tsx";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form.tsx";
import { t, useLang } from "@/lib/i18n.tsx";
import { formatMoney, parseAmount } from "@/lib/money.ts";
import { rpc, supabase } from "@/lib/supabase.ts";
import type { Part, Supplier } from "@/api/types.ts";

const blank = (v: string) => (v.trim() === "" ? null : v.trim());

export function PartDialog({ open, onClose, part, onSaved }: { open: boolean; onClose: () => void; part?: Part | null; onSaved: (p: Part) => void }) {
  const org = useOrg();
  const ref = useRefData();
  const { branchId } = useSession();
  const { lang } = useLang();
  const suppliers = useQuery({
    queryKey: ["suppliers", "options", org.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("id, name").eq("org_id", org.id).eq("active", true).order("name");
      if (error) throw error;
      return data as Pick<Supplier, "id" | "name">[];
    },
  });
  const [f, setF] = useState({
    sku: part?.sku ?? "",
    name: part?.name ?? "",
    part_number: part?.part_number ?? "",
    oem_ref: part?.oem_ref ?? "",
    brand: part?.brand ?? "",
    category: part?.category ?? "",
    description: part?.description ?? "",
    unit: part?.unit ?? "pcs",
    purchase_price: part ? String(part.purchase_price) : "",
    selling_price: part ? String(part.selling_price) : "",
    tax_rate_id: part?.tax_rate_id ?? "",
    min_stock: part ? String(part.min_stock) : "0",
    location: part?.location ?? "",
    barcode: part?.barcode ?? "",
    supplier_id: part?.supplier_id ?? "",
    track_stock: part?.track_stock ?? true,
    active: part?.active ?? true,
    opening_stock: "",
  });
  const [invalid, setInvalid] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const buy = parseAmount(f.purchase_price || "0");
  const sell = parseAmount(f.selling_price || "0");
  const margin = buy !== null && sell !== null && sell > 0 ? { amount: (sell - buy) / 100, pct: Math.round(((sell - buy) / sell) * 1000) / 10 } : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const inv: Record<string, string> = {};
    if (!f.sku.trim()) inv.sku = t("Required.");
    if (!f.name.trim()) inv.name = t("Required.");
    if (buy === null) inv.purchase_price = t("Enter a valid amount.");
    if (sell === null) inv.selling_price = t("Enter a valid amount.");
    if (!/^\d+(\.\d{1,2})?$/.test(f.min_stock || "0")) inv.min_stock = t("Enter a number.");
    if (f.opening_stock && !/^\d+(\.\d{1,2})?$/.test(f.opening_stock)) inv.opening_stock = t("Enter a number.");
    setInvalid(inv);
    if (Object.keys(inv).length) return;
    setBusy(true);
    setError(null);
    const row = {
      sku: f.sku.trim().toUpperCase(),
      name: f.name.trim(),
      part_number: blank(f.part_number),
      oem_ref: blank(f.oem_ref),
      brand: blank(f.brand),
      category: blank(f.category),
      description: blank(f.description),
      unit: f.unit || "pcs",
      purchase_price: (buy ?? 0) / 100,
      selling_price: (sell ?? 0) / 100,
      tax_rate_id: f.tax_rate_id || null,
      min_stock: Number(f.min_stock || 0),
      location: blank(f.location),
      barcode: blank(f.barcode),
      supplier_id: f.supplier_id || null,
      track_stock: f.track_stock,
      active: f.active,
    };
    const res = part ? await supabase.from("parts").update(row).eq("id", part.id).select().single() : await supabase.from("parts").insert({ ...row, org_id: org.id }).select().single();
    if (res.error) {
      setBusy(false);
      return setError(res.error);
    }
    if (!part && f.opening_stock && Number(f.opening_stock) > 0 && f.track_stock) {
      try {
        await rpc("adjust_stock", { p: { org_id: org.id, branch_id: branchId, part_id: res.data.id, kind: "stock_in", quantity: Number(f.opening_stock), unit_cost: row.purchase_price, note: "Opening stock" } });
      } catch (err) {
        setBusy(false);
        return setError(err);
      }
    }
    setBusy(false);
    onSaved(res.data as Part);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={part ? t("Edit part") : t("New part")}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="primary" type="submit" form="part-form" loading={busy}>
            {part ? t("Save") : t("Add part")}
          </Button>
        </>
      }
    >
      <form id="part-form" onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
          <Field label={t("SKU")} required error={invalid.sku}>{(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!invalid.sku} value={f.sku} onChange={set("sku")} className="uppercase" autoFocus />}</Field>
          <Field label={t("Name")} required error={invalid.name}>{(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!invalid.name} value={f.name} onChange={set("name")} />}</Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("Part number")}>{(id) => <Input id={id} value={f.part_number} onChange={set("part_number")} />}</Field>
          <Field label={t("OEM reference")}>{(id) => <Input id={id} value={f.oem_ref} onChange={set("oem_ref")} />}</Field>
          <Field label={t("Barcode")}>{(id) => <Input id={id} value={f.barcode} onChange={set("barcode")} />}</Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("Brand")}>{(id) => <Input id={id} value={f.brand} onChange={set("brand")} />}</Field>
          <Field label={t("Category")}>{(id) => <Input id={id} value={f.category} onChange={set("category")} placeholder={t("Brakes, Filters, Oil…")} />}</Field>
          <Field label={t("Unit")}>{(id) => <Input id={id} value={f.unit} onChange={set("unit")} placeholder="pcs, L, set" />}</Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("Purchase price (AED)")} error={invalid.purchase_price}>{(id, d) => <Input id={id} aria-describedby={d} inputMode="decimal" value={f.purchase_price} onChange={set("purchase_price")} className="text-end num" />}</Field>
          <Field label={t("Selling price (AED)")} error={invalid.selling_price} hint={margin ? t("Margin {amount} ({pct}%)", { amount: formatMoney(margin.amount, lang), pct: margin.pct }) : undefined}>
            {(id, d) => <Input id={id} aria-describedby={d} inputMode="decimal" value={f.selling_price} onChange={set("selling_price")} className="text-end num" />}
          </Field>
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
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("Minimum stock")} error={invalid.min_stock} hint={t("Alert when stock falls to this level.")}>{(id, d) => <Input id={id} aria-describedby={d} inputMode="decimal" value={f.min_stock} onChange={set("min_stock")} className="text-end num" />}</Field>
          <Field label={t("Location")}>{(id) => <Input id={id} value={f.location} onChange={set("location")} placeholder={t("Shelf B-3")} />}</Field>
          <Field label={t("Main supplier")}>
            {(id) => (
              <Select id={id} value={f.supplier_id} onChange={set("supplier_id")}>
                <option value="">—</option>
                {(suppliers.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {!part && f.track_stock && (
          <Field label={t("Opening stock")} error={invalid.opening_stock} hint={t("Quantity on the shelf now. Recorded as a stock movement.")}>
            {(id, d) => <Input id={id} aria-describedby={d} inputMode="decimal" value={f.opening_stock} onChange={set("opening_stock")} className="max-w-40 text-end num" />}
          </Field>
        )}
        <Field label={t("Description")}>{(id) => <Textarea id={id} value={f.description} onChange={set("description")} />}</Field>
        <div className="flex flex-wrap gap-4">
          <Checkbox label={t("Track stock for this part")} checked={f.track_stock} onChange={(e) => setF({ ...f, track_stock: e.target.checked })} />
          <Checkbox label={t("Active (available on documents)")} checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
        </div>
        <FormError error={error} />
      </form>
    </Dialog>
  );
}
