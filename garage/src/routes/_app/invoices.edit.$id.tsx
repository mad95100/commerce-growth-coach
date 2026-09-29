import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useSession } from "@/app/session.tsx";
import { DocumentEditor } from "@/components/documents/DocumentEditor.tsx";
import { ErrorState, Loading } from "@/components/ui/feedback.tsx";
import { NotAllowed, PageHeader } from "@/components/ui/layout.tsx";
import { useInvoice } from "@/api/documents.ts";
import { t } from "@/lib/i18n.tsx";

export const Route = createFileRoute("/_app/invoices/edit/$id")({ component: EditInvoice });

function EditInvoice() {
  const { id } = Route.useParams();
  const { can } = useSession();
  const q = useInvoice(id);
  if (!can("invoices.create")) return <NotAllowed />;
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (q.data.inv.status !== "draft") return <Navigate to="/invoices/$id" params={{ id }} />;
  return (
    <div>
      <PageHeader title={t("Edit draft invoice")} back={{ to: "/invoices/$id", label: t("Back to the invoice"), params: { id } }} />
      <DocumentEditor kind="invoice" existing={{ header: q.data.inv, lines: q.data.lines }} />
    </div>
  );
}
