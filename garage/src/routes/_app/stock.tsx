import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowDownUp, Boxes, Download, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useOrg, useSession } from "@/app/session.tsx";
import { StockDialog } from "@/components/catalog/StockDialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge, EmptyState, ErrorState, Loading } from "@/components/ui/feedback.tsx";
import { Chips, Input } from "@/components/ui/form.tsx";
import { Card, CardTitle, NotAllowed, PageHeader, Stat, TableWrap, tableClass, td, th, trClass } from "@/components/ui/layout.tsx";
import { toCsv } from "@/lib/csv.ts";
import { formatDateTime } from "@/lib/dates.ts";
import { downloadText } from "@/lib/download.ts";
import { t, useLang } from "@/lib/i18n.tsx";
import { formatMoney } from "@/lib/money.ts";
import { MOVEMENT_LABEL } from "@/lib/status.ts";
import { supabase } from "@/lib/supabase.ts";
import type { StockMovement, StockRow } from "@/api/types.ts";

export const Route = createFileRoute("/_app/stock")({
  component: Stock,
  validateSearch: (s: Record<string, unknown>): { filter?: "low" } => ({ filter: s.filter === "low" ? "low" : undefined }),
});

function Stock() {
  const org = useOrg();
  const { can, branchId } = useSession();
  const { lang } = useLang();
  const navigate = useNavigate({ from: Route.fullPath });
  const filter = Route.useSearch().filter ?? "all";
  const [text, setText] = useState("");
  const [adjust, setAdjust] = useState<StockRow | null>(null);
  const levels = useQuery({
    queryKey: ["stock", org.id, branchId],
    enabled: can("stock.view"),
    queryFn: async () => {
      let r = supabase.from("v_stock").select("*").eq("org_id", org.id).eq("active", true).eq("track_stock", true);
      if (branchId) r = r.eq("branch_id", branchId);
      const { data, error } = await r.order("name");
      if (error) throw error;
      return data as StockRow[];
    },
  });
  const moves = useQuery({
    queryKey: ["stock-moves", org.id, branchId],
    enabled: can("stock.view"),
    queryFn: async () => {
      let r = supabase.from("stock_movements").select("*, parts(name, sku)").eq("org_id", org.id);
      if (branchId) r = r.eq("branch_id", branchId);
      const { data, error } = await r.order("created_at", { ascending: false }).limit(30);
      if (error) throw error;
      return data as Array<StockMovement & { parts: { name: string; sku: string } }>;
    },
  });
  const rows = useMemo(() => {
    const s = text.trim().toLowerCase();
    return (levels.data ?? []).filter((r) => (filter !== "low" || r.is_low) && (!s || [r.name, r.sku, r.part_number, r.location, r.category].some((x) => (x ?? "").toLowerCase().includes(s))));
  }, [levels.data, filter, text]);
  if (!can("stock.view")) return <NotAllowed />;
  const value = (levels.data ?? []).reduce((s, r) => s + Math.max(0, Number(r.quantity)) * Number(r.purchase_price), 0);
  const low = (levels.data ?? []).filter((r) => r.is_low).length;
  return (
    <div>
      <PageHeader
        title={t("Stock")}
        subtitle={t("Stock leaves automatically when an invoice is issued, and comes back when it is cancelled or credited.")}
        actions={
          <Button
            icon={<Download className="size-4" />}
            onClick={() =>
              downloadText(
                "stock.csv",
                toCsv(rows, [
                  { header: "SKU", value: (r) => r.sku },
                  { header: "Name", value: (r) => r.name },
                  { header: "Branch", value: (r) => r.branch_name },
                  { header: "Location", value: (r) => r.location },
                  { header: "Quantity", value: (r) => r.quantity },
                  { header: "Minimum", value: (r) => r.min_stock },
                  { header: "Unit cost", value: (r) => r.purchase_price },
                  { header: "Stock value", value: (r) => Math.max(0, Number(r.quantity)) * Number(r.purchase_price) },
                ]),
              )
            }
          >
            {t("Export CSV")}
          </Button>
        }
      />
      {levels.data && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3">
          <Stat label={t("Parts tracked")} value={levels.data.length} />
          <Stat label={t("At or below minimum")} value={low} tone={low ? "warn" : undefined} />
          <Stat label={t("Stock value at cost")} value={formatMoney(value, lang)} />
        </div>
      )}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1 lg:max-w-md">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <Input aria-label={t("Search stock")} placeholder={t("Name, SKU, location…")} value={text} onChange={(e) => setText(e.target.value)} className="ps-9" />
        </div>
        <Chips
          label={t("Show")}
          value={filter}
          onChange={(v) => navigate({ search: { filter: v === "low" ? "low" : undefined } })}
          options={[
            { value: "all", label: t("All") },
            { value: "low", label: t("Low stock"), count: levels.isSuccess ? low : undefined },
          ]}
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card padded={false}>
          {levels.isPending && <Loading />}
          {levels.isError && <ErrorState error={levels.error} retry={() => levels.refetch()} className="m-4" />}
          {levels.isSuccess && rows.length === 0 && <EmptyState icon={<Boxes className="size-6" />} title={filter === "low" ? t("No part is low on stock.") : t("No tracked part yet")} />}
          {rows.length > 0 && (
            <TableWrap>
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={th}>{t("Part")}</th>
                    <th className={`${th} hidden md:table-cell`}>{t("Location")}</th>
                    <th className={`${th} text-end`}>{t("Stock")}</th>
                    <th className={`${th} hidden text-end sm:table-cell`}>{t("Min.")}</th>
                    <th className={th}>
                      <span className="sr-only">{t("Actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.part_id}${r.branch_id}`} className={trClass}>
                      <td className={td}>
                        <Link to="/parts/$id" params={{ id: r.part_id }} className="font-medium text-brand hover:underline">
                          {r.name}
                        </Link>
                        <div className="text-xs text-muted">
                          {r.sku}
                          {!branchId && ` · ${r.branch_name}`}
                        </div>
                      </td>
                      <td className={`${td} hidden md:table-cell`}>{r.location}</td>
                      <td className={`${td} text-end`}>
                        <span className={`font-semibold num ${Number(r.quantity) < 0 ? "text-bad" : ""}`}>{Number(r.quantity)}</span> {r.is_low && <Badge tone={Number(r.quantity) <= 0 ? "bad" : "warn"}>{t("Low")}</Badge>}
                      </td>
                      <td className={`${td} hidden text-end num sm:table-cell`}>{Number(r.min_stock)}</td>
                      <td className={`${td} text-end`}>
                        {can("stock.adjust") && (
                          <Button size="sm" onClick={() => setAdjust(r)} icon={<ArrowDownUp className="size-3.5" />}>
                            {t("Adjust")}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
        <Card>
          <CardTitle>{t("Recent movements")}</CardTitle>
          {moves.isPending && <Loading />}
          {moves.isError && <ErrorState error={moves.error} retry={() => moves.refetch()} />}
          {moves.data && moves.data.length === 0 && <p className="text-sm text-muted">{t("No stock movement yet.")}</p>}
          {moves.data && moves.data.length > 0 && (
            <ul className="space-y-3">
              {moves.data.map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <Link to="/parts/$id" params={{ id: m.part_id }} className="block truncate font-medium hover:underline">
                      {m.parts?.name}
                    </Link>
                    <p className="truncate text-xs text-muted">
                      {t(MOVEMENT_LABEL[m.kind] ?? m.kind)}
                      {m.reference_number && ` · ${m.reference_number}`} · {formatDateTime(m.created_at, lang)}
                    </p>
                  </div>
                  <span className={`shrink-0 font-semibold num ${Number(m.quantity) < 0 ? "text-bad" : "text-ok"}`}>{Number(m.quantity) > 0 ? `+${Number(m.quantity)}` : Number(m.quantity)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {adjust && <StockDialog open part={{ id: adjust.part_id, name: adjust.name, unit: adjust.unit }} onClose={() => setAdjust(null)} />}
    </div>
  );
}
