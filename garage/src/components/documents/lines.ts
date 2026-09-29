import { computeTotals, type DiscountType, type Totals } from "@/lib/totals.ts";
import type { DocLine, TaxRate } from "@/api/types.ts";

/** A line as edited on screen: inputs stay strings until saved. */
export interface EditLine {
  key: string;
  kind: "part" | "labor" | "service" | "other";
  part_id: string | null;
  service_id: string | null;
  technician_id: string | null;
  description: string;
  part_number: string;
  quantity: string;
  unit_price: string;
  discount_pct: string;
  tax_rate_id: string | null;
}

let seq = 0;
export const newKey = () => `l${Date.now()}${seq++}`;

export function num(s: string): number {
  const n = Number(String(s).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : NaN;
}

export function fromDocLine(l: DocLine): EditLine {
  return {
    key: newKey(),
    kind: l.kind,
    part_id: l.part_id,
    service_id: l.service_id,
    technician_id: l.technician_id,
    description: l.description,
    part_number: l.part_number ?? "",
    quantity: String(l.quantity),
    unit_price: String(l.unit_price),
    discount_pct: l.discount_pct ? String(l.discount_pct) : "",
    tax_rate_id: l.tax_rate_id,
  };
}

export function lineProblems(l: EditLine): Array<"description" | "quantity" | "unit_price" | "discount_pct"> {
  const out: Array<"description" | "quantity" | "unit_price" | "discount_pct"> = [];
  const two = (s: string) => /^\d+(\.\d{1,2})?$/.test(s.replace(/,/g, "").trim());
  if (!l.description.trim()) out.push("description");
  if (!two(l.quantity) || !(num(l.quantity) > 0)) out.push("quantity");
  if (!two(l.unit_price)) out.push("unit_price");
  if (l.discount_pct.trim() !== "" && (!two(l.discount_pct) || num(l.discount_pct) > 100)) out.push("discount_pct");
  return out;
}

export function previewTotals(
  lines: EditLine[],
  taxRates: TaxRate[],
  defaultRate: TaxRate | null,
  discountType: DiscountType,
  discountValue: string,
  vatRegistered: boolean,
): Totals {
  const rateOf = (id: string | null) => taxRates.find((r) => r.id === (id ?? defaultRate?.id))?.rate ?? 0;
  return computeTotals(
    lines.map((l) => ({
      quantity: num(l.quantity) > 0 ? num(l.quantity) : 0,
      unitPrice: num(l.unit_price) >= 0 ? num(l.unit_price) : 0,
      discountPct: num(l.discount_pct || "0") || 0,
      taxRate: rateOf(l.tax_rate_id),
    })),
    discountType,
    num(discountValue || "0") || 0,
    { vatRegistered },
  );
}

export function toPayload(lines: EditLine[]) {
  return lines.map((l) => ({
    kind: l.kind,
    part_id: l.part_id,
    service_id: l.service_id,
    technician_id: l.technician_id,
    description: l.description.trim(),
    part_number: l.part_number.trim() || null,
    quantity: num(l.quantity),
    unit_price: num(l.unit_price),
    discount_pct: num(l.discount_pct || "0"),
    tax_rate_id: l.tax_rate_id,
  }));
}
