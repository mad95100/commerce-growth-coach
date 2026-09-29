import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useOrg, useSession } from "@/app/session.tsx";
import { SendButtons } from "@/components/actions/SendButtons.tsx";
import { CreditNoteDoc } from "@/components/documents/docs.tsx";
import { ButtonLink } from "@/components/ui/button.tsx";
import { ErrorState, Loading } from "@/components/ui/feedback.tsx";
import { NotAllowed, PageHeader } from "@/components/ui/layout.tsx";
import { fetchCreditNote } from "@/api/documents.ts";
import { t, useLang } from "@/lib/i18n.tsx";
import { formatMoney } from "@/lib/money.ts";

export const Route = createFileRoute("/_app/credit-notes/$id")({ component: CreditNotePage });

function CreditNotePage() {
  const { id } = Route.useParams();
  const org = useOrg();
  const { can } = useSession();
  const { lang } = useLang();
  const q = useQuery({ queryKey: ["credit-note", id], queryFn: () => fetchCreditNote(id) });
  if (!can("invoices.view")) return <NotAllowed />;
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const { cn, invoice } = q.data;
  const body = [
    t("Dear {name},", { name: cn.customer_name ?? "" }),
    "",
    t("We have issued credit note {number} of {amount} on invoice {invoice}.", { number: cn.number, amount: formatMoney(cn.total, lang), invoice: invoice.number ?? "" }),
    t("Reason: {reason}", { reason: cn.reason }),
    "",
    t("Thank you, {garage}", { garage: org.name }),
  ].join("\n");
  return (
    <div>
      <PageHeader
        back={{ to: "/credit-notes", label: t("Credit notes") }}
        title={t("Credit note {number}", { number: cn.number })}
        subtitle={cn.customer_name}
        actions={
          <>
            <ButtonLink to="/invoices/$id" params={{ id: cn.invoice_id }}>
              {t("Invoice {number}", { number: invoice.number ?? "" })}
            </ButtonLink>
            <SendButtons ctx={{ purpose: "credit_note", message: { subject: t("Credit note {number} — {garage}", { number: cn.number, garage: org.name }), body }, phone: invoice.customer_whatsapp ?? invoice.customer_phone, email: invoice.customer_email, refs: { customer_id: cn.customer_id, invoice_id: cn.invoice_id, credit_note_id: cn.id }, printHref: `/print/credit-note/${cn.id}` }} />
          </>
        }
      />
      <CreditNoteDoc b={q.data} />
    </div>
  );
}
