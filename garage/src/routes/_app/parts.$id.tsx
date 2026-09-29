import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowDownUp, Pencil } from "lucide-react";
import { useState } from "react";
import { useSession } from "@/app/session.tsx";
import { PartDialog } from "@/components/catalog/PartDialog.tsx";
import { StockDialog } from "@/components/catalog/StockDialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge, EmptyState, ErrorState, Loading } from "@/components/ui/feedback.tsx";
import { Card, CardTitle, DescriptionList, NotAllowed, PageHeader, TableWrap, tableClass, td, th, trClass } from "@/components/ui/layout.tsx";
import { Money } from "@/components/ui/money.tsx";
import { formatDateTime } from "@/lib/dates.ts";
import { t, useLang } from "@/lib/i18n.tsx";
import { formatMoney } from "@/lib/money.ts";
import { MOVEMENT_LABEL } from "@/lib/status.ts";
import { supabase } from "@/lib/supabase.ts";
import type { Part, StockMovement, StockRow } from "@/api/types.ts";

export const Route = createFileRoute("/_app/parts/$id")({ component: PartPage });


function PartPage() {
  const { id } = Route.useParams();
  const { can } = useSession();
  const { lang } = useLang();
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const q = useQuery({
    queryKey: ["part", id],
    queryFn: async () => {
      const [p, lv, mv, sp] = await Promise.all([
        supabase.from("parts").select("*, suppliers(id, name)").eq("id", id).maybeSingle(),
        supabase.from("v_stock").select("*").eq("part_id", id),
        supabase.from("stock_movements").select("*").eq("part_id", id).order("created_at", { ascending: false }).limit(100),
        supabase.from("supplier_parts").select("*, suppliers(id, name)").eq("part_id", id),
      ]);
      for (const r of [p, lv, mv, sp]) if (r.error) throw r.error;
      if (!p.data) throw { message: "bsg.not_found", details: "part" };
      return {
        part: p.data as Part & { suppliers: { id: string; name: string } | null },
        levels: lv.data as StockRow[],
        movements: mv.data as StockMovement[],
        supplierPrices: sp.data as Array<{ supplier_id: string; price: number | null; supplier_sku: string | null; lead_time_days: number | null; updated_at: string; suppliers: { id: string; name: string } }>,
      };
    },
  });
  if (!can("catalog.view")) return <NotAllowed />;
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const { part: p, levels, movements, supplierPrices } = q.data;
  const total = levels.reduce((s, l) => s + Number(l.quantity), 0);
  const margin = Number(p.selling_price) - Number(p.purchase_price);
  return (
    <div>
      <PageHeader
        back={{ to: "/parts", label: t("Parts") }}
        title={p.name}
        badge={!p.active ? <Badge tone="muted">{t("Inactive")}</Badge> : undefined}
        subtitle={[p.sku, p.part_number, p.brand].filter(Boolean).join(" · ")}
        actions={
          <>
            {can("stock.adjust") && p.track_stock && (
              <Button variant="primary" onClick={() => setAdjust(true)} icon={<ArrowDownUp className="size-4" />}>
                {t("Adjust stock")}
              </Button>
            )}
            {can("catalog.manage") && (
              <Button onClick={() => setEdit(true)} icon={<Pencil className="size-4" />}>
                {t("Edit")}
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardTitle>{t("Stock by branch")}</CardTitle>
            {!p.track_stock ? (
              <p className="text-sm text-muted">{t("Stock is not tracked for this part.")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {levels.map((l) => (
                  <li key={l.branch_id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span>{l.branch_name}</span>
                    <span className="flex items-center gap-2">
                      <span className={`font-semibold num ${Number(l.quantity) < 0 ? "text-bad" : ""}`}>
                        {Number(l.quantity)} {p.unit}
                      </span>
                      {l.is_low && <Badge tone={Number(l.quantity) <= 0 ? "bad" : "warn"}>{t("Low")}</Badge>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card padded={false}>
            <div className="p-4 pb-0 sm:p-5 sm:pb-0">
              <CardTitle>{t("Movement history")}</CardTitle>
            </div>
            {movements.length === 0 ? (
              <EmptyState title={t("No stock movement yet")} className="py-8" />
            ) : (
              <TableWrap>
                <table className={tableClass}>
                  <thead>
                    <tr>
                      <th className={th}>{t("Date")}</th>
                      <th className={th}>{t("Movement")}</th>
                      <th className={`${th} text-end`}>{t("Qty")}</th>
                      <th className={`${th} text-end`}>{t("Balance")}</th>
                      <th className={`${th} hidden md:table-cell`}>{t("By")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((m) => (
                      <tr key={m.id} className={trClass}>
                        <td className={`${td} whitespace-nowrap`}>{formatDateTime(m.created_at, lang)}</td>
                        <td className={td}>
                          {t(MOVEMENT_LABEL[m.kind] ?? m.kind)}
                          {m.reference_number && (
                            <span className="text-xs text-muted">
                              {" "}
                              ·{" "}
                              {m.reference_type === "invoice" && m.reference_id ? (
                                <Link to="/invoices/$id" params={{ id: m.reference_id }} className="text-brand hover:underline">
                                  {m.reference_number}
                                </Link>
                              ) : m.reference_type === "purchase_order" && m.reference_id ? (
                                <Link to="/purchase-orders/$id" params={{ id: m.reference_id }} className="text-brand hover:underline">
                                  {m.reference_number}
                                </Link>
                              ) : (
                                m.reference_number
                              )}
                            </span>
                          )}
                          {m.note && <div className="text-xs text-muted">{m.note}</div>}
                        </td>
                        <td className={`${td} text-end font-medium num ${Number(m.quantity) < 0 ? "text-bad" : "text-ok"}`}>{Number(m.quantity) > 0 ? `+${Number(m.quantity)}` : Number(m.quantity)}</td>
                        <td className={`${td} text-end num`}>{Number(m.balance_after)}</td>
                        <td className={`${td} hidden md:table-cell`}>{m.created_by_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </div>
        <div className="min-w-0 space-y-5">
          <Card>
            <CardTitle>{t("Prices")}</CardTitle>
            <DescriptionList
              className="sm:grid-cols-1"
              items={[
                [t("Selling price"), <Money key="s" value={p.selling_price} strong />],
                [t("Purchase price (last cost)"), <Money key="b" value={p.purchase_price} />],
                [t("Margin"), Number(p.selling_price) > 0 ? `${formatMoney(margin, lang)} (${Math.round((margin / Number(p.selling_price)) * 1000) / 10}%)` : "—"],
                [t("Total stock"), p.track_stock ? `${total} ${p.unit}` : t("Not tracked")],
                [t("Minimum stock"), `${Number(p.min_stock)} ${p.unit}`],
                [t("Location"), p.location],
                [t("OEM reference"), p.oem_ref],
                [t("Barcode"), p.barcode],
                [t("Category"), p.category],
                [t("Main supplier"), p.suppliers ? <Link key="sup" to="/suppliers/$id" params={{ id: p.suppliers.id }} className="text-brand hover:underline">{p.suppliers.name}</Link> : null],
                [t("Description"), p.description],
              ]}
            />
          </Card>
          <Card>
            <CardTitle>{t("Supplier prices")}</CardTitle>
            {supplierPrices.length === 0 ? (
              <p className="text-sm text-muted">{t("Recorded automatically when goods are received on a purchase order, or from the supplier's page.")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {supplierPrices.map((s) => (
                  <li key={s.supplier_id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <Link to="/suppliers/$id" params={{ id: s.supplier_id }} className="text-brand hover:underline">
                      {s.suppliers.name}
                    </Link>
                    <span>{s.price != null ? <Money value={s.price} /> : "—"}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      {edit && <PartDialog open part={p} onClose={() => setEdit(false)} onSaved={async () => { setEdit(false); await qc.invalidateQueries(); }} />}
      {adjust && <StockDialog open part={p} onClose={() => setAdjust(false)} />}
    </div>
  );
}
