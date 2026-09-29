import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { ArrowLeft, Printer } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useSession } from "@/app/session.tsx";
import { CreditNoteDoc, EstimateDoc, InvoiceDoc, JobCardDoc, ReceiptDoc } from "@/components/documents/docs.tsx";
import { InspectionDoc, PurchaseOrderDoc } from "@/components/documents/docs2.tsx";
import { Button } from "@/components/ui/button.tsx";
import { ErrorState, Loading } from "@/components/ui/feedback.tsx";
import { fetchCreditNote, fetchEstimate, fetchInvoice, fetchJobCard, fetchPayment } from "@/api/documents.ts";
import { fetchInspection, fetchPurchaseOrder } from "@/api/documents2.ts";
import { t } from "@/lib/i18n.tsx";

export const Route = createFileRoute("/print/$kind/$id")({ component: PrintPage });

const fetchers: Record<string, (id: string) => Promise<unknown>> = {
  invoice: fetchInvoice,
  estimate: fetchEstimate,
  "job-card": fetchJobCard,
  receipt: fetchPayment,
  "credit-note": fetchCreditNote,
  "purchase-order": fetchPurchaseOrder,
  inspection: fetchInspection,
};

function PrintPage() {
  const { kind, id } = Route.useParams();
  const s = useSession();
  const q = useQuery({ queryKey: ["print", kind, id], enabled: s.status === "ready" && !!fetchers[kind], queryFn: () => fetchers[kind](id) });

  useEffect(() => {
    document.title = `BS Garage — ${kind} `;
  }, [kind]);

  if (s.status === "loading") return <Loading />;
  if (s.status === "signed_out") return <Navigate to="/login" search={{ redirect: `/print/${kind}/${id}` }} />;
  if (s.status !== "ready") return <Navigate to="/" />;
  if (!fetchers[kind]) return <p className="p-6">{t("Unknown document type.")}</p>;

  let doc: ReactNode = null;
  if (q.data) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = q.data as any;
    doc =
      kind === "invoice" ? <InvoiceDoc b={b} /> :
      kind === "estimate" ? <EstimateDoc b={b} /> :
      kind === "job-card" ? <JobCardDoc b={b} showPrices={s.can("job_cards.view")} /> :
      kind === "receipt" ? <ReceiptDoc b={b} /> :
      kind === "credit-note" ? <CreditNoteDoc b={b} /> :
      kind === "purchase-order" ? <PurchaseOrderDoc b={b} /> :
      <InspectionDoc b={b} />;
  }

  return (
    <div className="min-h-full bg-canvas py-4 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] items-center justify-between gap-2 px-4">
        <Button variant="ghost" onClick={() => (history.length > 1 ? history.back() : window.close())} icon={<ArrowLeft className="size-4 rtl:rotate-180" />}>
          {t("Back")}
        </Button>
        <div className="flex items-center gap-2">
          <p className="hidden text-xs text-muted sm:block">{t("In the print dialog, choose “Save as PDF” to download.")}</p>
          <Button variant="primary" onClick={() => window.print()} icon={<Printer className="size-4" />} disabled={!q.data}>
            {t("Print / Save PDF")}
          </Button>
        </div>
      </div>
      <div className="px-2 sm:px-4 print:px-0">
        {q.isPending && <Loading />}
        {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} className="mx-auto max-w-xl" />}
        {doc}
      </div>
    </div>
  );
}
