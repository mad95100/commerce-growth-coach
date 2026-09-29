import clsx from "clsx";
import { ChevronDown, ChevronUp, Hammer, Plus, Trash2 } from "lucide-react";
import { useOrg, useRefData } from "@/app/session.tsx";
import { CatalogPicker, type CatalogItem } from "@/components/pickers/CatalogPicker.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/feedback.tsx";
import { inputClass } from "@/components/ui/form.tsx";
import { t, useLang } from "@/lib/i18n.tsx";
import { formatMoney } from "@/lib/money.ts";
import { LINE_KINDS } from "@/lib/status.ts";
import type { Totals } from "@/lib/totals.ts";
import { lineProblems, newKey, type EditLine } from "./lines.ts";

const cell = clsx(inputClass, "min-h-10 px-2");

/**
 * Lines of an estimate, job card or invoice: parts, labor (hours × rate),
 * services and free lines. Totals are previewed instantly with the same
 * algorithm the database applies when saving.
 */
export function LineEditor({
  lines,
  setLines,
  totals,
  showErrors,
}: {
  lines: EditLine[];
  setLines: (fn: (l: EditLine[]) => EditLine[]) => void;
  totals: Totals;
  showErrors: boolean;
}) {
  const org = useOrg();
  const ref = useRefData();
  const { lang } = useLang();
  const taxRates = (ref.data?.taxRates ?? []).filter((r) => r.active);
  const technicians = (ref.data?.technicians ?? []).filter((x) => x.active);
  const vat = org.vat_registered;

  const update = (key: string, patch: Partial<EditLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));
  const move = (key: string, dir: -1 | 1) =>
    setLines((ls) => {
      const i = ls.findIndex((l) => l.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ls.length) return ls;
      const c = [...ls];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });

  function add(item: CatalogItem) {
    if (item.type === "part") {
      const p = item.part;
      setLines((ls) => {
        const same = ls.find((l) => l.part_id === p.id);
        if (same) return ls.map((l) => (l === same ? { ...l, quantity: String(Number(l.quantity || 0) + 1) } : l));
        return [...ls, { key: newKey(), kind: "part", part_id: p.id, service_id: null, technician_id: null, description: p.name, part_number: p.part_number ?? p.sku, quantity: "1", unit_price: String(p.selling_price), discount_pct: "", tax_rate_id: p.tax_rate_id }];
      });
    } else {
      const s = item.service;
      const hourly = s.pricing === "hourly";
      setLines((ls) => [
        ...ls,
        { key: newKey(), kind: "service", part_id: null, service_id: s.id, technician_id: null, description: s.name, part_number: "", quantity: hourly ? String(s.duration_hours ?? 1) : "1", unit_price: String(hourly ? s.labor_rate : s.price), discount_pct: "", tax_rate_id: s.tax_rate_id },
      ]);
    }
  }

  const addLabor = () =>
    setLines((ls) => [...ls, { key: newKey(), kind: "labor", part_id: null, service_id: null, technician_id: null, description: t("Labor"), part_number: "", quantity: "1", unit_price: org.default_labor_rate ? String(org.default_labor_rate) : "", discount_pct: "", tax_rate_id: null }]);
  const addOther = () =>
    setLines((ls) => [...ls, { key: newKey(), kind: "other", part_id: null, service_id: null, technician_id: null, description: "", part_number: "", quantity: "1", unit_price: "", discount_pct: "", tax_rate_id: null }]);

  return (
    <div>
      <div className="flex flex-col gap-2 lg:flex-row">
        <div className="flex-1">
          <CatalogPicker onPick={add} />
        </div>
        <div className="flex gap-2">
          <Button onClick={addLabor} icon={<Hammer className="size-4" />} className="flex-1 lg:flex-none">
            {t("Labor")}
          </Button>
          <Button onClick={addOther} icon={<Plus className="size-4" />} className="flex-1 lg:flex-none">
            {t("Custom line")}
          </Button>
        </div>
      </div>

      {lines.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted">
          {t("No line yet. Search the catalog above, or add labor or a custom line.")}
        </p>
      ) : (
        <ol className="mt-4 space-y-3">
          {lines.map((l, idx) => {
            const bad = showErrors ? lineProblems(l) : [];
            const amounts = totals.lines[idx];
            const isLabor = l.kind === "labor" || (l.kind === "service" && l.part_id === null);
            return (
              <li key={l.key} className={clsx("rounded-xl border bg-surface p-3", bad.length ? "border-bad/50" : "border-line")}>
                <div className="flex items-start gap-2">
                  <Badge tone={l.kind === "part" ? "info" : l.kind === "other" ? "neutral" : "brand"} className="mt-2.5">
                    {t(LINE_KINDS[l.kind])}
                  </Badge>
                  <input
                    aria-label={t("Description")}
                    aria-invalid={bad.includes("description")}
                    value={l.description}
                    onChange={(e) => update(l.key, { description: e.target.value })}
                    placeholder={t("Description")}
                    className={clsx(cell, "flex-1 font-medium")}
                  />
                  <div className="flex shrink-0">
                    <button type="button" onClick={() => move(l.key, -1)} disabled={idx === 0} aria-label={t("Move up")} className="hidden size-10 items-center justify-center rounded-lg text-muted hover:bg-canvas disabled:opacity-30 sm:inline-flex">
                      <ChevronUp className="size-4" />
                    </button>
                    <button type="button" onClick={() => move(l.key, 1)} disabled={idx === lines.length - 1} aria-label={t("Move down")} className="hidden size-10 items-center justify-center rounded-lg text-muted hover:bg-canvas disabled:opacity-30 sm:inline-flex">
                      <ChevronDown className="size-4" />
                    </button>
                    <button type="button" onClick={() => remove(l.key)} aria-label={t("Remove line")} className="inline-flex size-10 items-center justify-center rounded-lg text-muted hover:bg-bad-soft hover:text-bad">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
                <div className={clsx("mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4", vat ? "lg:grid-cols-[1.3fr_0.7fr_1fr_0.7fr_0.9fr_1fr]" : "lg:grid-cols-[1.3fr_0.7fr_1fr_0.7fr_1fr]")}>
                  {l.kind === "part" || l.kind === "other" ? (
                    <label className="min-w-0">
                      <span className="mb-0.5 block text-[11px] text-muted">{t("Part number")}</span>
                      <input value={l.part_number} onChange={(e) => update(l.key, { part_number: e.target.value })} className={cell} />
                    </label>
                  ) : (
                    <label className="min-w-0">
                      <span className="mb-0.5 block text-[11px] text-muted">{t("Technician")}</span>
                      <select value={l.technician_id ?? ""} onChange={(e) => update(l.key, { technician_id: e.target.value || null })} className={cell}>
                        <option value="">—</option>
                        {technicians.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="min-w-0">
                    <span className="mb-0.5 block text-[11px] text-muted">{isLabor && l.kind === "labor" ? t("Hours") : t("Qty")}</span>
                    <input inputMode="decimal" aria-invalid={bad.includes("quantity")} value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} className={clsx(cell, "text-end num")} />
                  </label>
                  <label className="min-w-0">
                    <span className="mb-0.5 block text-[11px] text-muted">{l.kind === "labor" ? t("Rate / hour") : t("Unit price")}</span>
                    <input inputMode="decimal" aria-invalid={bad.includes("unit_price")} value={l.unit_price} onChange={(e) => update(l.key, { unit_price: e.target.value })} className={clsx(cell, "text-end num")} placeholder="0.00" />
                  </label>
                  <label className="min-w-0">
                    <span className="mb-0.5 block text-[11px] text-muted">{t("Disc. %")}</span>
                    <input inputMode="decimal" aria-invalid={bad.includes("discount_pct")} value={l.discount_pct} onChange={(e) => update(l.key, { discount_pct: e.target.value })} className={clsx(cell, "text-end num")} placeholder="0" />
                  </label>
                  {vat && (
                    <label className="min-w-0">
                      <span className="mb-0.5 block text-[11px] text-muted">{t("VAT")}</span>
                      <select value={l.tax_rate_id ?? ref.data?.defaultTaxRate?.id ?? ""} onChange={(e) => update(l.key, { tax_rate_id: e.target.value || null })} className={cell}>
                        {taxRates.map((r) => (
                          <option key={r.id} value={r.id} title={r.name}>
                            {Number(r.rate)}%{r.rate === 0 && !r.is_default ? ` ${r.name}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div className="min-w-0 text-end">
                    <span className="mb-0.5 block text-[11px] text-muted">{vat ? t("Total incl. VAT") : t("Total")}</span>
                    <span className="flex min-h-10 items-center justify-end text-sm font-semibold num">{amounts ? formatMoney(amounts.total, lang) : "—"}</span>
                  </div>
                </div>
                {bad.length > 0 && <p className="mt-1 text-xs text-bad">{t("Check the highlighted fields of this line.")}</p>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
