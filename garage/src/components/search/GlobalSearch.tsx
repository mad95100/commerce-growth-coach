import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Car, FileText, Package, ReceiptText, Search, Truck, User, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSession } from "@/app/session.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { ErrorState, Spinner, StatusBadge } from "@/components/ui/feedback.tsx";
import { Money } from "@/components/ui/money.tsx";
import { t, useLang } from "@/lib/i18n.tsx";
import { formatPhone } from "@/lib/phone.ts";
import { formatPlate } from "@/lib/plates.ts";
import { parseSearch } from "@/lib/search.ts";
import { ESTIMATE_STATUS, INVOICE_STATUS, JOB_STATUS } from "@/lib/status.ts";
import { rpc } from "@/lib/supabase.ts";

interface Results {
  customers?: Array<{ id: string; display_name: string; phone: string | null; vehicles: number }>;
  vehicles?: Array<{ id: string; plate_emirate: string; plate_code: string; plate_number: string; make: string; model: string; year: number; customer_name: string }>;
  invoices?: Array<{ id: string; number: string | null; display_status: string; total: number; balance: number; customer_name: string }>;
  estimates?: Array<{ id: string; number: string; display_status: string; total: number; customer_name: string }>;
  job_cards?: Array<{ id: string; number: string; status: string; customer_name: string; plate_emirate: string; plate_code: string; plate_number: string }>;
  parts?: Array<{ id: string; sku: string; name: string; part_number: string | null; stock: number; min_stock: number; supplier_name: string | null; selling_price: number }>;
  suppliers?: Array<{ id: string; name: string; phone: string | null }>;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { org } = useSession();
  const { lang } = useLang();
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 250);
  const params = useMemo(() => parseSearch(dq), [dq]);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
    else setQ("");
  }, [open]);

  const res = useQuery({
    queryKey: ["search", org?.id, params],
    enabled: !!params && !!org && open,
    queryFn: () =>
      rpc<Results>("global_search", {
        p_org: org!.id,
        p_text: params!.text,
        p_phone_key: params!.phoneKey,
        p_plate_key: params!.plate?.key ?? null,
        p_plate_number: params!.plate?.number ?? null,
        p_emirate: params!.plate?.emirate ?? null,
      }),
  });

  const go = (to: string, idParam?: string) => {
    onClose();
    navigate({ to, params: idParam ? { id: idParam } : undefined });
  };

  const r = res.data ?? {};
  const total = Object.values(r).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);

  return (
    <Dialog open={open} onClose={onClose} title={t("Search")} size="lg">
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-faint" aria-hidden />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("Name, phone, plate, VIN, invoice number, SKU…")}
          aria-label={t("Search")}
          className="block min-h-12 w-full rounded-xl border border-line-strong bg-surface ps-11 pe-3 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
      </div>
      <div className="mt-4 min-h-40">
        {!params && <p className="py-8 text-center text-sm text-muted">{t("Type at least 2 characters. Examples: 0501234567 · Dubai A 12345 · INV-00012 · BP-001")}</p>}
        {params && res.isPending && (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        )}
        {params && res.isError && <ErrorState error={res.error} retry={() => res.refetch()} />}
        {params && res.isSuccess && total === 0 && <p className="py-8 text-center text-sm text-muted">{t("Nothing found for “{q}”.", { q: params.text })}</p>}
        {params && res.isSuccess && total > 0 && (
          <div className="space-y-4">
            <Group title={t("Customers")} items={r.customers}>
              {(c) => (
                <Row key={c.id} icon={<User className="size-4" />} onClick={() => go("/customers/$id", c.id)} title={c.display_name} sub={[formatPhone(c.phone), t("{n} vehicles", { n: c.vehicles })].filter(Boolean).join(" · ")} />
              )}
            </Group>
            <Group title={t("Vehicles")} items={r.vehicles}>
              {(v) => (
                <Row key={v.id} icon={<Car className="size-4" />} onClick={() => go("/vehicles/$id", v.id)} title={formatPlate(v, lang) || v.make} sub={[v.make, v.model, v.year, v.customer_name].filter(Boolean).join(" · ")} />
              )}
            </Group>
            <Group title={t("Invoices")} items={r.invoices}>
              {(i) => (
                <Row key={i.id} icon={<FileText className="size-4" />} onClick={() => go("/invoices/$id", i.id)} title={i.number ?? t("Draft")} sub={i.customer_name ?? ""} end={<><StatusBadge map={INVOICE_STATUS} status={i.display_status} /><Money value={i.total} className="text-sm" /></>} />
              )}
            </Group>
            <Group title={t("Job cards")} items={r.job_cards}>
              {(j) => (
                <Row key={j.id} icon={<Wrench className="size-4" />} onClick={() => go("/job-cards/$id", j.id)} title={j.number} sub={[j.customer_name, formatPlate(j, lang)].filter(Boolean).join(" · ")} end={<StatusBadge map={JOB_STATUS} status={j.status} />} />
              )}
            </Group>
            <Group title={t("Estimates")} items={r.estimates}>
              {(e) => (
                <Row key={e.id} icon={<ReceiptText className="size-4" />} onClick={() => go("/estimates/$id", e.id)} title={e.number} sub={e.customer_name ?? ""} end={<><StatusBadge map={ESTIMATE_STATUS} status={e.display_status} /><Money value={e.total} className="text-sm" /></>} />
              )}
            </Group>
            <Group title={t("Parts")} items={r.parts}>
              {(p) => (
                <Row key={p.id} icon={<Package className="size-4" />} onClick={() => go("/parts/$id", p.id)} title={`${p.sku} · ${p.name}`} sub={[p.part_number, t("Stock: {n}", { n: p.stock }), p.supplier_name].filter(Boolean).join(" · ")} end={<Money value={p.selling_price} className="text-sm" />} />
              )}
            </Group>
            <Group title={t("Suppliers")} items={r.suppliers}>
              {(s) => <Row key={s.id} icon={<Truck className="size-4" />} onClick={() => go("/suppliers/$id", s.id)} title={s.name} sub={formatPhone(s.phone)} />}
            </Group>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Group<T>({ title, items, children }: { title: string; items?: T[]; children: (x: T) => ReactNode }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <p className="mb-1 px-1 text-xs font-semibold tracking-wide text-muted uppercase">{title}</p>
      <ul className="divide-y divide-line rounded-lg border border-line">{items.map((x) => <li key={(x as { id: string }).id}>{children(x)}</li>)}</ul>
    </div>
  );
}

function Row({ icon, title, sub, end, onClick }: { icon: ReactNode; title: string; sub?: string; end?: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-start hover:bg-canvas">
      <span className="text-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{title}</span>
        {sub && <span className="block truncate text-xs text-muted">{sub}</span>}
      </span>
      {end && <span className="flex shrink-0 items-center gap-2">{end}</span>}
    </button>
  );
}
