import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@/app/session.tsx";
import { DocumentEditor } from "@/components/documents/DocumentEditor.tsx";
import { NotAllowed, PageHeader } from "@/components/ui/layout.tsx";
import { t } from "@/lib/i18n.tsx";

export const Route = createFileRoute("/_app/invoices/new")({
  component: NewInvoice,
  validateSearch: (s: Record<string, unknown>): { customer?: string; vehicle?: string } => ({
    customer: typeof s.customer === "string" ? s.customer : undefined,
    vehicle: typeof s.vehicle === "string" ? s.vehicle : undefined,
  }),
});

function NewInvoice() {
  const { can } = useSession();
  const { customer, vehicle } = Route.useSearch();
  if (!can("invoices.create")) return <NotAllowed />;
  return (
    <div>
      <PageHeader title={t("New Invoice")} back={{ to: "/invoices", label: t("Invoices") }} />
      <DocumentEditor kind="invoice" initialCustomerId={customer ?? null} initialVehicleId={vehicle ?? null} />
    </div>
  );
}
