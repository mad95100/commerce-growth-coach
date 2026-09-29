import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, ShoppingCart } from "lucide-react";
import { useState } from "react";
import { useOrg, useSession } from "@/app/session.tsx";
import { ButtonLink } from "@/components/ui/button.tsx";
import { EmptyState, ErrorState, Loading, StatusBadge } from "@/components/ui/feedback.tsx";
import { Chips } from "@/components/ui/form.tsx";
import { Card, NotAllowed, PageHeader, TableWrap, tableClass, td, th, trClass } from "@/components/ui/layout.tsx";
import { Money } from "@/components/ui/money.tsx";
import { formatDate } from "@/lib/dates.ts";
import { t, useLang } from "@/lib/i18n.tsx";
import { PO_STATUS } from "@/lib/status.ts";
import { supabase } from "@/lib/supabase.ts";
import type { PurchaseOrder } from "@/api/documents2.ts";

export const Route = createFileRoute("/_app/purchase-orders/")({ component: PurchaseOrders });

function PurchaseOrders() {
  const org = useOrg();
  const { can, branchId } = useSession();
  const { lang } = useLang();
  const [status, setStatus] = useState<string>("open");
  const q = useQuery({
    queryKey: ["purchase-orders", org.id, branchId],
    enabled: can("suppliers.view"),
    queryFn: async () => {
      let r = supabase.from("purchase_orders").select("*, suppliers(name)").eq("org_id", org.id);
      if (branchId) r = r.eq("branch_id", branchId);
      const { data, error } = await r.order("created_at", { ascending: false }).limit(300);
      if (error) throw error;
      return data as Array<PurchaseOrder & { suppliers: { name: string } }>;
    },
  });
  if (!can("suppliers.view")) return <NotAllowed />;
  const rows = (q.data ?? []).filter((o) => status === "all" || (status === "open" ? ["draft", "ordered", "partially_received"].includes(o.status) : o.status === status));
  return (
    <div>
      <PageHeader title={t("Purchase orders")} actions={can("purchases.manage") && <ButtonLink to="/purchase-orders/new" variant="primary" icon={<Plus className="size-4" />}>{t("New purchase order")}</ButtonLink>} />
      <Chips
        className="mb-4"
        label={t("Status")}
        value={status}
        onChange={setStatus}
        options={[
          { value: "open", label: t("Open") },
          { value: "draft", label: t("Draft") },
          { value: "ordered", label: t("Ordered") },
          { value: "partially_received", label: t("Partially received") },
          { value: "received", label: t("Received") },
          { value: "cancelled", label: t("Cancelled") },
          { value: "all", label: t("All") },
        ]}
      />
      <Card padded={false}>
        {q.isPending && <Loading />}
        {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} className="m-4" />}
        {q.isSuccess && rows.length === 0 && <EmptyState icon={<ShoppingCart className="size-6" />} title={t("No purchase order here")} text={t("Order parts from a supplier; receiving the goods adds them to stock automatically.")} />}
        {rows.length > 0 && (
          <TableWrap>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={th}>{t("PO")}</th>
                  <th className={th}>{t("Supplier")}</th>
                  <th className={`${th} hidden md:table-cell`}>{t("Expected")}</th>
                  <th className={`${th} text-end`}>{t("Total")}</th>
                  <th className={th}>{t("Status")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className={trClass}>
                    <td className={td}>
                      <Link to="/purchase-orders/$id" params={{ id: o.id }} className="font-medium text-brand hover:underline">
                        {o.number}
                      </Link>
                      <div className="text-xs text-muted">{formatDate(o.order_date, lang)}</div>
                    </td>
                    <td className={td}>{o.suppliers?.name}</td>
                    <td className={`${td} hidden md:table-cell`}>{formatDate(o.expected_date, lang)}</td>
                    <td className={`${td} text-end`}>
                      <Money value={o.total} />
                    </td>
                    <td className={td}>
                      <StatusBadge map={PO_STATUS} status={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
