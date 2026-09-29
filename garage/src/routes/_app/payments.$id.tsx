import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useOrg, useSession } from "@/app/session.tsx";
import { ReasonDialog } from "@/components/actions/ReasonDialog.tsx";
import { SendButtons } from "@/components/actions/SendButtons.tsx";
import { ReceiptDoc } from "@/components/documents/docs.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge, ErrorState, Loading } from "@/components/ui/feedback.tsx";
import { NotAllowed, PageHeader } from "@/components/ui/layout.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { fetchPayment } from "@/api/documents.ts";
import { t } from "@/lib/i18n.tsx";
import { receiptMessage } from "@/lib/messages.ts";
import { rpc } from "@/lib/supabase.ts";

export const Route = createFileRoute("/_app/payments/$id")({ component: PaymentPage });

function PaymentPage() {
  const { id } = Route.useParams();
  const org = useOrg();
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [voiding, setVoiding] = useState(false);
  const q = useQuery({ queryKey: ["payment", id], queryFn: () => fetchPayment(id) });
  if (!can("invoices.view")) return <NotAllowed />;
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const { payment: p, invoice, customer } = q.data;
  const msg = receiptMessage({ garage: org.name, customer: customer.display_name, receipt: p.number, invoice: p.invoice_number, amount: p.amount, method: p.method_name, balance: invoice?.status === "issued" ? Number(invoice.balance) : null, refund: p.kind === "refund" });
  return (
    <div>
      <PageHeader
        back={{ to: "/payments", label: t("Payments") }}
        title={p.kind === "refund" ? t("Refund {number}", { number: p.number }) : t("Receipt {number}", { number: p.number })}
        badge={p.voided_at ? <Badge tone="muted">{t("Void")}</Badge> : p.kind === "deposit" ? <Badge tone="info">{t("Deposit")}</Badge> : undefined}
        actions={
          <>
            {!p.voided_at && <SendButtons ctx={{ purpose: "receipt", message: msg, phone: customer.whatsapp ?? customer.phone, email: customer.email, refs: { customer_id: customer.id, payment_id: p.id, invoice_id: p.invoice_id }, printHref: `/print/receipt/${p.id}` }} />}
            {!p.voided_at && can("payments.void") && (
              <Button variant="ghost" className="text-bad" onClick={() => setVoiding(true)}>
                {t("Void")}
              </Button>
            )}
          </>
        }
      />
      <ReceiptDoc b={q.data} />
      {voiding && (
        <ReasonDialog
          open
          title={t("Void this payment?")}
          warning={t("The receipt stays in the history, marked void, and the balance goes back up. Use this for a payment recorded by mistake or reversed by the bank.")}
          confirmLabel={t("Void payment")}
          onClose={() => setVoiding(false)}
          onConfirm={async (reason) => {
            await rpc("void_payment", { p_id: id, p_reason: reason });
            await qc.invalidateQueries();
            toast(t("Payment voided."));
          }}
        />
      )}
    </div>
  );
}
