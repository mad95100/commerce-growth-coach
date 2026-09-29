import { useQuery } from "@tanstack/react-query";
import { Package, ScanLine, Search, Wrench } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useOrg, useSession } from "@/app/session.tsx";
import { Spinner } from "@/components/ui/feedback.tsx";
import { t, useLang } from "@/lib/i18n.tsx";
import { formatMoney } from "@/lib/money.ts";
import { supabase } from "@/lib/supabase.ts";
import type { Part, Service } from "@/api/types.ts";

export type CatalogItem =
  | { type: "part"; part: Part & { stock: number } }
  | { type: "service"; service: Service };

function clean(q: string) {
  return q.replace(/[,()%_*\\]/g, " ").trim();
}

/**
 * Adds a part or a service to a document. Searches name, SKU, part number,
 * OEM reference and barcode. A barcode scanner types the code then Enter:
 * an exact barcode or SKU match is added at once.
 */
export function CatalogPicker({ onPick }: { onPick: (item: CatalogItem) => void }) {
  const org = useOrg();
  const { branchId } = useSession();
  const { lang } = useLang();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = setTimeout(() => setDq(clean(q)), 200);
    return () => clearTimeout(id);
  }, [q]);

  const res = useQuery({
    queryKey: ["catalog-search", org.id, dq, branchId],
    enabled: dq.length >= 1,
    queryFn: async () => {
      const like = `%${dq}%`;
      const [p, s] = await Promise.all([
        supabase
          .from("parts")
          .select("*, stock_levels(quantity, branch_id)")
          .eq("org_id", org.id)
          .eq("active", true)
          .or(`name.ilike.${like},sku.ilike.${like},part_number.ilike.${like},oem_ref.ilike.${like},barcode.eq.${dq}`)
          .order("name")
          .limit(8),
        supabase.from("services").select("*").eq("org_id", org.id).eq("active", true).or(`name.ilike.${like},code.ilike.${like},category.ilike.${like}`).order("name").limit(6),
      ]);
      if (p.error) throw p.error;
      if (s.error) throw s.error;
      const items: CatalogItem[] = [
        ...(p.data ?? []).map((row) => {
          const levels = (row.stock_levels ?? []) as Array<{ quantity: number; branch_id: string }>;
          const stock = levels.filter((l) => !branchId || l.branch_id === branchId).reduce((a, l) => a + Number(l.quantity), 0);
          return { type: "part" as const, part: { ...(row as Part), stock } };
        }),
        ...(s.data ?? []).map((row) => ({ type: "service" as const, service: row as Service })),
      ];
      return items;
    },
  });

  const items = res.data ?? [];
  const pick = (i: CatalogItem) => {
    onPick(i);
    setQ("");
    setDq("");
    setOpen(false);
    inputRef.current?.focus();
  };

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const code = clean(q).toUpperCase();
      const exact = items.find((i) => i.type === "part" && (i.part.barcode === clean(q) || i.part.sku.toUpperCase() === code));
      if (exact) pick(exact);
      else if (items[active] && dq === clean(q)) pick(items[active]);
    } else if (e.key === "Escape") setOpen(false);
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-faint" aria-hidden />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKey}
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-controls="catalog-results"
          aria-label={t("Add a part or service")}
          placeholder={t("Add part or service: name, SKU, part number, barcode…")}
          className="block min-h-12 w-full rounded-xl border border-line-strong bg-surface ps-11 pe-10 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        <ScanLine className="pointer-events-none absolute end-3 top-1/2 size-5 -translate-y-1/2 text-faint" aria-hidden />
      </div>
      {open && dq.length >= 1 && (
        <div id="catalog-results" role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-xl border border-line bg-surface shadow-lg">
          {res.isPending && (
            <div className="p-4">
              <Spinner />
            </div>
          )}
          {res.isError && <p className="p-4 text-sm text-bad">{t("The catalog could not be searched. Try again.")}</p>}
          {res.isSuccess && items.length === 0 && <p className="p-4 text-sm text-muted">{t("Nothing in the catalog matches. Add a custom line instead.")}</p>}
          {items.map((i, idx) => (
            <button
              key={i.type === "part" ? `p${i.part.id}` : `s${i.service.id}`}
              type="button"
              role="option"
              aria-selected={idx === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(i)}
              className={`flex min-h-14 w-full items-center gap-3 px-3 py-2 text-start ${idx === active ? "bg-brand-soft" : "hover:bg-canvas"}`}
            >
              {i.type === "part" ? <Package className="size-5 shrink-0 text-muted" aria-hidden /> : <Wrench className="size-5 shrink-0 text-muted" aria-hidden />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{i.type === "part" ? i.part.name : i.service.name}</span>
                <span className="block truncate text-xs text-muted">
                  {i.type === "part"
                    ? [i.part.sku, i.part.part_number, i.part.brand, i.part.track_stock ? t("Stock: {n}", { n: i.part.stock }) : null].filter(Boolean).join(" · ")
                    : [t("Service"), i.service.category, i.service.pricing === "hourly" ? t("{h} h × {rate}", { h: i.service.duration_hours ?? 1, rate: formatMoney(i.service.labor_rate, lang) }) : null].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="shrink-0 text-sm font-medium num">
                {i.type === "part" ? formatMoney(i.part.selling_price, lang) : formatMoney(i.service.pricing === "hourly" ? Number(i.service.labor_rate) * Number(i.service.duration_hours) : i.service.price, lang)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
