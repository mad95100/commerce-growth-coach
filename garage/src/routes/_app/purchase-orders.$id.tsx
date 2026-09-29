import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PackageCheck, Pencil, Send } from "lucide-react";
import { useState } from "react";
import { useOrg, useSession } from "@/app/session.tsx";
import { ActivityCard } from "@/components/actions/ActivityCard.tsx";
import { PurchaseOrderDoc } from "@/components/documents/docs2.tsx";
import { Button, ButtonLink } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { ErrorState, FormError, Loading, StatusBadge } from "@/components/ui/feedback.tsx";
import { Input } from "@/components/ui/form.tsx";
import { NotAllowed, PageHeader } from "@/components/ui/layout.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { fetchPurchaseOrder } from "@/api/documents2.ts";
import { t } from "@/lib/i18n.tsx";
import { mailtoUrl } from "@/lib/phone.ts";
import { PO_STATUS } from "@/lib/status.ts";
import { rpc } from "@/lib/supabase.ts";

export const Route = createFileRoute("/_app/purchase-orders/$id")({ component: POPage });

function POPage() {
  const { id } = Route.useParams();
  const org = useOrg();
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["po", id], queryFn: () => fetchPurchaseOrder(id) });
  const [receiving, setReceiving] = useState<Record<string, string> | null>(null);
  const status = useMutation({ mutationFn: (s: string) => rpc("set_purchase_order_status", { p_id: id, p_status: s }), onSuccess: () => qc.invalidateQueries() });
  const receive = useMutation({
    mutationFn: (lines: Array<{ line_id: string; quantity: number }>) => rpc("receive_purchase_order", { p: { id, lines } }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      setReceiving(null);
      toast(t("Goods received and added to stock."));
    },
  });
  if (!can("suppliers.view")) return <NotAllowed />;
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const { po, lines, supplier } = q.data;
  const manage = can("purchases.manage");
  const mail = mailtoUrl(supplier.email, t("Purchase order {number} — {garage}", { number: po.number, garage: org.name }), [t("Hello,"), "", t("Please find our purchase order {number}. The printed order is attached.", { number: po.number }), "", org.name].join("\n"));
  return (
    <div>
      <PageHeader
        back={{ to: "/purchase-orders", label: t("Purchase orders") }}
        title={po.number}
        badge={<StatusBadge map={PO_STATUS} status={po.status} />}
        subtitle={supplier.name}
        actions={
          <>
            {manage && po.status === "draft" && (
              <>
                <ButtonLink to="/purchase-orders/edit/$id" params={{ id }} icon={<Pencil className="size-4" />}>
                  {t("Edit")}
                </ButtonLink>
                <Button variant="primary" loading={status.isPending} onClick={() => status.mutate("ordered")} icon={<Send className="size-4" />}>
                  {t("Mark as ordered")}
                </Button>
              </>
            )}
            {manage && ["ordered", "partially_received"].includes(po.status) && (
              <Button variant="success" onClick={() => setReceiving({})} icon={<PackageCheck className="size-4" />}>
                {t("Receive goods")}
              </Button>
            )}
            <a href={`/print/purchase-order/${id}`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium hover:bg-canvas">
              {t("Print / PDF")}
            </a>
            {mail && (
              <a href={mail} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium hover:bg-canvas">
                {t("Email")}
              </a>
            )}
            {manage && ["draft", "ordered"].includes(po.status) && (
              <Button variant="ghost" className="text-bad" onClick={() => status.mutate("cancelled")}>
                {t("Cancel")}
              </Button>
            )}
          </>
        }
      />
      <FormError error={status.error} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <PurchaseOrderDoc b={q.data} />
        <ActivityCard entityIds={[id]} />
      </div>
      {receiving && (
        <Dialog
          open
          onClose={() => setReceiving(null)}
          title={t("Receive goods")}
          size="lg"
          footer={
            <>
              <Button onClick={() => setReceiving(null)}>{t("Cancel")}</Button>
              <Button
                variant="success"
                loading={receive.isPending}
                onClick={() => receive.mutate(lines.map((l) => ({ line_id: l.id, quantity: Number(receiving[l.id] || 0) })).filter((l) => l.quantity > 0))}
              >
                {t("Add to stock")}
              </Button>
            </>
          }
        >
          <ul className="space-y-2">
            {lines.map((l) => {
              const left = Number(l.quantity) - Number(l.received_quantity);
              return (
                <li key={l.id} className="flex items-center gap-3 rounded-lg border border-line p-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{l.description}</p>
                    <p className="text-xs text-muted">{t("Ordered {q} · received {r}", { q: Number(l.quantity), r: Number(l.received_quantity) })}</p>
                  </div>
                  <Input aria-label={t("Quantity received")} inputMode="decimal" disabled={left <= 0} className="w-24 text-end num" value={receiving[l.id] ?? ""} placeholder="0" onChange={(e) => setReceiving({ ...receiving, [l.id]: e.target.value })} />
                  <Button size="sm" disabled={left <= 0} onClick={() => setReceiving({ ...receiving, [l.id]: String(left) })}>
                    {t("All")}
                  </Button>
                </li>
              );
            })}
          </ul>
          <div className="mt-3">
            <FormError error={receive.error} />
          </div>
        </Dialog>
      )}
    </div>
  );
}
