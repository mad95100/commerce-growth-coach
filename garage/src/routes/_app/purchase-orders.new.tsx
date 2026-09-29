import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@/app/session.tsx";
import { PurchaseOrderEditor } from "@/components/catalog/PurchaseOrderEditor.tsx";
import { NotAllowed, PageHeader } from "@/components/ui/layout.tsx";
import { t } from "@/lib/i18n.tsx";

export const Route = createFileRoute("/_app/purchase-orders/new")({
  component: NewPO,
  validateSearch: (s: Record<string, unknown>): { supplier?: string } => ({ supplier: typeof s.supplier === "string" ? s.supplier : undefined }),
});

function NewPO() {
  const { can } = useSession();
  const { supplier } = Route.useSearch();
  if (!can("purchases.manage")) return <NotAllowed />;
  return (
    <div>
      <PageHeader title={t("New purchase order")} back={{ to: "/purchase-orders", label: t("Purchase orders") }} />
      <PurchaseOrderEditor supplierId={supplier} />
    </div>
  );
}
