import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useSession } from "@/app/session.tsx";
import { PurchaseOrderEditor } from "@/components/catalog/PurchaseOrderEditor.tsx";
import { ErrorState, Loading } from "@/components/ui/feedback.tsx";
import { NotAllowed, PageHeader } from "@/components/ui/layout.tsx";
import { fetchPurchaseOrder } from "@/api/documents2.ts";
import { t } from "@/lib/i18n.tsx";

export const Route = createFileRoute("/_app/purchase-orders/edit/$id")({ component: EditPO });

function EditPO() {
  const { id } = Route.useParams();
  const { can } = useSession();
  const q = useQuery({ queryKey: ["po", id], queryFn: () => fetchPurchaseOrder(id) });
  if (!can("purchases.manage")) return <NotAllowed />;
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (q.data.po.status !== "draft") return <Navigate to="/purchase-orders/$id" params={{ id }} />;
  return (
    <div>
      <PageHeader title={t("Edit {number}", { number: q.data.po.number })} back={{ to: "/purchase-orders/$id", label: t("Back"), params: { id } }} />
      <PurchaseOrderEditor existing={q.data} />
    </div>
  );
}
