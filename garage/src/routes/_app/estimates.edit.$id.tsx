import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useSession } from "@/app/session.tsx";
import { DocumentEditor } from "@/components/documents/DocumentEditor.tsx";
import { ErrorState, Loading } from "@/components/ui/feedback.tsx";
import { NotAllowed, PageHeader } from "@/components/ui/layout.tsx";
import { fetchEstimate } from "@/api/documents.ts";
import { t } from "@/lib/i18n.tsx";

export const Route = createFileRoute("/_app/estimates/edit/$id")({ component: EditEstimate });

function EditEstimate() {
  const { id } = Route.useParams();
  const { can } = useSession();
  const q = useQuery({ queryKey: ["estimate", id], queryFn: () => fetchEstimate(id) });
  if (!can("estimates.manage")) return <NotAllowed />;
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (!["draft", "sent", "pending"].includes(q.data.est.status)) return <Navigate to="/estimates/$id" params={{ id }} />;
  return (
    <div>
      <PageHeader title={t("Edit estimate {number}", { number: q.data.est.number })} back={{ to: "/estimates/$id", label: t("Back to the estimate"), params: { id } }} />
      <DocumentEditor kind="estimate" existing={{ header: q.data.est, lines: q.data.lines }} />
    </div>
  );
}
