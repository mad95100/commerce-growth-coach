import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useSession } from "@/app/session.tsx";
import { DocumentEditor } from "@/components/documents/DocumentEditor.tsx";
import { ErrorState, Loading } from "@/components/ui/feedback.tsx";
import { NotAllowed, PageHeader } from "@/components/ui/layout.tsx";
import { fetchJobCard } from "@/api/documents.ts";
import { t } from "@/lib/i18n.tsx";

export const Route = createFileRoute("/_app/job-cards/edit/$id")({ component: EditJobCard });

function EditJobCard() {
  const { id } = Route.useParams();
  const { can } = useSession();
  const q = useQuery({ queryKey: ["job-card", id], queryFn: () => fetchJobCard(id) });
  if (!can("job_cards.manage")) return <NotAllowed />;
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (q.data.jc.invoice_id || q.data.jc.status === "cancelled") return <Navigate to="/job-cards/$id" params={{ id }} />;
  return (
    <div>
      <PageHeader title={t("Edit job card {number}", { number: q.data.jc.number })} back={{ to: "/job-cards/$id", label: t("Back to the job card"), params: { id } }} />
      <DocumentEditor kind="job_card" existing={{ header: q.data.jc, lines: q.data.lines }} />
    </div>
  );
}
