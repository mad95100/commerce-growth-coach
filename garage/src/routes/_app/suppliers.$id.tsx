import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Pencil, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { useState } from "react";
import { useOrg, useSession } from "@/app/session.tsx";
import { SupplierDialog } from "@/components/catalog/SupplierDialog.tsx";
import { CatalogPicker } from "@/components/pickers/CatalogPicker.tsx";
import { Button, ButtonLink } from "@/components/ui/button.tsx";
import { EmptyState, ErrorState, FormError, Loading, StatusBadge } from "@/components/ui/feedback.tsx";
import { Input } from "@/components/ui/form.tsx";
import { Card, CardTitle, DescriptionList, NotAllowed, PageHeader, TableWrap, tableClass, td, th, trClass } from "@/components/ui/layout.tsx";
import { Money } from "@/components/ui/money.tsx";
import { formatDate } from "@/lib/dates.ts";
import { t, useLang } from "@/lib/i18n.tsx";
import { parseAmount } from "@/lib/money.ts";
import { formatPhone } from "@/lib/phone.ts";
import { PO_STATUS } from "@/lib/status.ts";
import { supabase } from "@/lib/supabase.ts";
import type { Supplier } from "@/api/types.ts";
import type { PurchaseOrder } from "@/api/documents2.ts";

export const Route = createFileRoute("/_app/suppliers/$id")({ component: SupplierPage });

interface SupplierPart {
  part_id: string;
  supplier_sku: string | null;
  price: number | null;
  updated_at: string;
  parts: { id: string; name: string; sku: string; purchase_price: number };
}

function SupplierPage() {
  const { id } = Route.useParams();
  const org = useOrg();
  const { can } = useSession();
  const { lang } = useLang();
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const q = useQuery({
    queryKey: ["supplier", id],
    queryFn: async () => {
      const [s, sp, po] = await Promise.all([
        supabase.from("suppliers").select("*").eq("id", id).maybeSingle(),
        supabase.from("supplier_parts").select("part_id, supplier_sku, price, updated_at, parts(id, name, sku, purchase_price)").eq("supplier_id", id),
        supabase.from("purchase_orders").select("*").eq("supplier_id", id).order("created_at", { ascending: false }),
      ]);
      for (const r of [s, sp, po]) if (r.error) throw r.error;
      if (!s.data) throw { message: "bsg.not_found", details: "supplier" };
      return { supplier: s.data as Supplier, parts: sp.data as unknown as SupplierPart[], orders: po.data as PurchaseOrder[] };
    },
  });
  if (!can("suppliers.view")) return <NotAllowed />;
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const { supplier: s, parts, orders } = q.data;
  const manage = can("suppliers.manage");

  async function run(p: PromiseLike<{ error: unknown }>) {
    setErr(null);
    const { error } = await p;
    if (error) setErr(error);
    await qc.invalidateQueries({ queryKey: ["supplier", id] });
  }

  return (
    <div>
      <PageHeader
        back={{ to: "/suppliers", label: t("Suppliers") }}
        title={s.name}
        subtitle={[s.contact_name, formatPhone(s.phone), s.email].filter(Boolean).join(" · ")}
        actions={
          <>
            {can("purchases.manage") && (
              <ButtonLink to="/purchase-orders/new" search={{ supplier: id }} variant="primary" icon={<ShoppingCart className="size-4" />}>
                {t("New purchase order")}
              </ButtonLink>
            )}
            {manage && (
              <Button onClick={() => setEdit(true)} icon={<Pencil className="size-4" />}>
                {t("Edit")}
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardTitle>{t("Parts from this supplier")}</CardTitle>
            {manage && (
              <div className="mb-3">
                <CatalogPicker onPick={(i) => i.type === "part" && run(supabase.from("supplier_parts").insert({ org_id: org.id, supplier_id: id, part_id: i.part.id, price: i.part.purchase_price }))} />
              </div>
            )}
            <FormError error={err} />
            {parts.length === 0 ? (
              <p className="text-sm text-muted">{t("No part linked yet. Receiving a purchase order links parts and prices automatically.")}</p>
            ) : (
              <TableWrap>
                <table className={tableClass}>
                  <thead>
                    <tr>
                      <th className={th}>{t("Part")}</th>
                      <th className={`${th} text-end`}>{t("Supplier price")}</th>
                      <th className={`${th} hidden text-end sm:table-cell`}>{t("Updated")}</th>
                      {manage && <th className={th}><span className="sr-only">{t("Actions")}</span></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {parts.map((p) => (
                      <tr key={p.part_id} className={trClass}>
                        <td className={td}>
                          <Link to="/parts/$id" params={{ id: p.part_id }} className="font-medium text-brand hover:underline">
                            {p.parts.name}
                          </Link>
                          <div className="text-xs text-muted">{p.parts.sku}</div>
                        </td>
                        <td className={`${td} text-end`}>
                          {manage ? (
                            <Input
                              aria-label={t("Supplier price")}
                              inputMode="decimal"
                              className="ms-auto w-28 text-end num"
                              value={prices[p.part_id] ?? (p.price != null ? String(p.price) : "")}
                              onChange={(e) => setPrices({ ...prices, [p.part_id]: e.target.value })}
                              onBlur={() => {
                                const v = prices[p.part_id];
                                if (v === undefined) return;
                                const fils = parseAmount(v);
                                if (fils === null && v.trim() !== "") return setErr({ code: "22P02" });
                                run(supabase.from("supplier_parts").update({ price: fils === null ? null : fils / 100 }).eq("supplier_id", id).eq("part_id", p.part_id));
                              }}
                            />
                          ) : p.price != null ? (
                            <Money value={p.price} />
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className={`${td} hidden text-end text-xs text-muted sm:table-cell`}>{formatDate(p.updated_at.slice(0, 10), lang)}</td>
                        {manage && (
                          <td className={`${td} text-end`}>
                            <button type="button" aria-label={t("Remove")} onClick={() => run(supabase.from("supplier_parts").delete().eq("supplier_id", id).eq("part_id", p.part_id))} className="inline-flex size-10 items-center justify-center rounded-lg text-muted hover:bg-bad-soft hover:text-bad">
                              <Trash2 className="size-4" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
          <Card padded={false}>
            <div className="p-4 pb-0 sm:p-5 sm:pb-0">
              <CardTitle>{t("Purchase history")}</CardTitle>
            </div>
            {orders.length === 0 ? (
              <EmptyState title={t("No purchase order yet")} className="py-8" action={can("purchases.manage") && <ButtonLink to="/purchase-orders/new" search={{ supplier: id }} icon={<Plus className="size-4" />}>{t("New purchase order")}</ButtonLink>} />
            ) : (
              <ul className="divide-y divide-line">
                {orders.map((o) => (
                  <li key={o.id}>
                    <Link to="/purchase-orders/$id" params={{ id: o.id }} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 hover:bg-canvas sm:px-5">
                      <span>
                        <span className="block font-medium text-brand">{o.number}</span>
                        <span className="block text-xs text-muted">{formatDate(o.order_date, lang)}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <Money value={o.total} />
                        <StatusBadge map={PO_STATUS} status={o.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card className="self-start">
          <CardTitle>{t("Supplier details")}</CardTitle>
          <DescriptionList className="sm:grid-cols-1" items={[[t("Contact"), s.contact_name], [t("Phone"), formatPhone(s.phone)], [t("Email"), s.email], [t("Address"), s.address], [t("TRN"), s.trn], [t("Payment terms"), s.payment_terms], [t("Notes"), s.notes]]} />
        </Card>
      </div>
      {edit && <SupplierDialog supplier={s} onClose={() => setEdit(false)} onSaved={async () => { setEdit(false); await qc.invalidateQueries(); }} />}
    </div>
  );
}
