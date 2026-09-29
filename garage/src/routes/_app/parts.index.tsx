import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Download, Package, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useOrg, useSession } from "@/app/session.tsx";
import { PartDialog } from "@/components/catalog/PartDialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge, EmptyState, ErrorState, Loading } from "@/components/ui/feedback.tsx";
import { Chips, Input } from "@/components/ui/form.tsx";
import { Card, NotAllowed, PageHeader, TableWrap, tableClass, td, th, trClass } from "@/components/ui/layout.tsx";
import { Money } from "@/components/ui/money.tsx";
import { toCsv } from "@/lib/csv.ts";
import { downloadText } from "@/lib/download.ts";
import { t } from "@/lib/i18n.tsx";
import { supabase } from "@/lib/supabase.ts";
import type { Part } from "@/api/types.ts";

export const Route = createFileRoute("/_app/parts/")({ component: Parts });

type Row = Part & { stock_levels: Array<{ quantity: number; branch_id: string }>; suppliers: { name: string } | null };

function Parts() {
  const org = useOrg();
  const { can, branchId } = useSession();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [dq, setDq] = useState("");
  const [show, setShow] = useState<"active" | "low" | "inactive">("active");
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setDq(text.trim().replace(/[,()%*\\]/g, " ")), 250);
    return () => clearTimeout(id);
  }, [text]);
  const q = useQuery({
    queryKey: ["parts", org.id, dq, show],
    enabled: can("catalog.view"),
    queryFn: async () => {
      let r = supabase.from("parts").select("*, stock_levels(quantity, branch_id), suppliers(name)").eq("org_id", org.id).eq("active", show !== "inactive");
      if (dq) r = r.or(`name.ilike.%${dq}%,sku.ilike.%${dq}%,part_number.ilike.%${dq}%,oem_ref.ilike.%${dq}%,barcode.eq.${dq},brand.ilike.%${dq}%,category.ilike.%${dq}%`);
      const { data, error } = await r.order("name").limit(500);
      if (error) throw error;
      return data as Row[];
    },
  });
  const stockOf = (p: Row) => (p.stock_levels ?? []).filter((l) => !branchId || l.branch_id === branchId).reduce((s, l) => s + Number(l.quantity), 0);
  const rows = (q.data ?? []).filter((p) => show !== "low" || (p.track_stock && stockOf(p) <= Number(p.min_stock)));

  if (!can("catalog.view")) return <NotAllowed />;
  return (
    <div>
      <PageHeader
        title={t("Parts")}
        subtitle={t("Catalog of parts with prices, margins and stock.")}
        actions={
          <>
            <Button
              icon={<Download className="size-4" />}
              onClick={() =>
                downloadText(
                  "parts.csv",
                  toCsv(rows, [
                    { header: "SKU", value: (p) => p.sku },
                    { header: "Name", value: (p) => p.name },
                    { header: "Part number", value: (p) => p.part_number },
                    { header: "OEM reference", value: (p) => p.oem_ref },
                    { header: "Brand", value: (p) => p.brand },
                    { header: "Category", value: (p) => p.category },
                    { header: "Purchase price", value: (p) => p.purchase_price },
                    { header: "Selling price", value: (p) => p.selling_price },
                    { header: "Stock", value: (p) => stockOf(p) },
                    { header: "Minimum stock", value: (p) => p.min_stock },
                    { header: "Location", value: (p) => p.location },
                    { header: "Barcode", value: (p) => p.barcode },
                    { header: "Supplier", value: (p) => p.suppliers?.name },
                  ]),
                )
              }
            >
              {t("Export CSV")}
            </Button>
            {can("catalog.manage") && (
              <Button variant="primary" onClick={() => setCreating(true)} icon={<Plus className="size-4" />}>
                {t("New part")}
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1 lg:max-w-md">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <Input aria-label={t("Search parts")} placeholder={t("Name, SKU, part number, OEM, barcode, brand…")} value={text} onChange={(e) => setText(e.target.value)} className="ps-9" />
        </div>
        <Chips
          label={t("Show")}
          value={show}
          onChange={setShow}
          options={[
            { value: "active", label: t("Active") },
            { value: "low", label: t("Low stock") },
            { value: "inactive", label: t("Inactive") },
          ]}
        />
      </div>
      <Card padded={false}>
        {q.isPending && <Loading />}
        {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} className="m-4" />}
        {q.isSuccess && rows.length === 0 && (
          <EmptyState
            icon={<Package className="size-6" />}
            title={dq || show !== "active" ? t("No part matches") : t("No part in the catalog yet")}
            text={!dq && show === "active" ? t("Add your parts once: they are then found by name, SKU or barcode on every invoice, and stock is updated automatically.") : undefined}
            action={!dq && show === "active" && can("catalog.manage") && <Button variant="primary" onClick={() => setCreating(true)} icon={<Plus className="size-4" />}>{t("New part")}</Button>}
          />
        )}
        {rows.length > 0 && (
          <TableWrap>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={th}>{t("Part")}</th>
                  <th className={`${th} hidden md:table-cell`}>{t("Part number")}</th>
                  <th className={`${th} hidden lg:table-cell`}>{t("Brand")}</th>
                  <th className={`${th} hidden text-end sm:table-cell`}>{t("Cost")}</th>
                  <th className={`${th} text-end`}>{t("Price")}</th>
                  <th className={`${th} hidden text-end xl:table-cell`}>{t("Margin")}</th>
                  <th className={`${th} text-end`}>{t("Stock")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const stock = stockOf(p);
                  const low = p.track_stock && stock <= Number(p.min_stock);
                  const margin = Number(p.selling_price) > 0 ? Math.round(((Number(p.selling_price) - Number(p.purchase_price)) / Number(p.selling_price)) * 1000) / 10 : null;
                  return (
                    <tr key={p.id} className={trClass}>
                      <td className={td}>
                        <Link to="/parts/$id" params={{ id: p.id }} className="font-medium text-brand hover:underline">
                          {p.name}
                        </Link>
                        <div className="text-xs text-muted">
                          {p.sku}
                          {p.category && ` · ${p.category}`}
                        </div>
                      </td>
                      <td className={`${td} hidden md:table-cell`}>{p.part_number}</td>
                      <td className={`${td} hidden lg:table-cell`}>{p.brand}</td>
                      <td className={`${td} hidden text-end sm:table-cell`}>
                        <Money value={p.purchase_price} />
                      </td>
                      <td className={`${td} text-end`}>
                        <Money value={p.selling_price} />
                      </td>
                      <td className={`${td} hidden text-end num xl:table-cell`}>{margin !== null ? `${margin}%` : "—"}</td>
                      <td className={`${td} text-end`}>
                        {p.track_stock ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`num font-medium ${stock < 0 ? "text-bad" : ""}`}>{stock}</span>
                            {low && <Badge tone={stock <= 0 ? "bad" : "warn"}>{t("Low")}</Badge>}
                          </span>
                        ) : (
                          <span className="text-xs text-muted">{t("Not tracked")}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      {creating && <PartDialog open onClose={() => setCreating(false)} onSaved={(p) => navigate({ to: "/parts/$id", params: { id: p.id } })} />}
    </div>
  );
}
