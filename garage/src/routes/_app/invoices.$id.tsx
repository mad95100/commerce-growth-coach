import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Ban, CheckCircle2, CreditCard, FileMinus, Pencil, Printer, RotateCcw, Send, Trash2, Undo2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useOrg, useSession } from "@/app/session.tsx";
import { ActivityCard } from "@/components/actions/ActivityCard.tsx";
import { CreditNoteDialog } from "@/components/actions/CreditNoteDialog.tsx";
import { PaymentDialog, type PaymentTarget } from "@/components/actions/PaymentDialog.tsx";
import { ReasonDialog } from "@/components/actions/ReasonDialog.tsx";
import { SendButtons } from "@/components/actions/SendButtons.tsx";
import { InvoiceDoc } from "@/components/documents/docs.tsx";
import { Button, ButtonLink } from "@/components/ui/button.tsx";
import { Alert, Badge, ErrorState, FormError, Loading, StatusBadge } from "@/components/ui/feedback.tsx";
import { Card, CardTitle, NotAllowed, PageHeader } from "@/components/ui/layout.tsx";
import { Money } from "@/components/ui/money.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { useInvoice } from "@/api/documents.ts";
import { formatDate, formatDateTime } from "@/lib/dates.ts";
import { t, tn, useLang } from "@/lib/i18n.tsx";
import { invoiceMessage, reminderMessage } from "@/lib/messages.ts";
import { INVOICE_STATUS } from "@/lib/status.ts";
import { rpc } from "@/lib/supabase.ts";

export const Route = createFileRoute("/_app/invoices/$id")({ component: InvoicePage });

function InvoicePage() {
  const { id } = Route.useParams();
  const org = useOrg();
  const { can } = useSession();
  const { lang } = useLang();
  const q = useInvoice(id);
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [payTarget, setPayTarget] = useState<PaymentTarget | null>(null);
  const [dialog, setDialog] = useState<null | "cancel" | "credit" | "delete" | { void: string }>(null);

  const issue = useMutation({
    mutationFn: () => rpc<string>("issue_invoice", { p_id: id }),
    onSuccess: async (n) => {
      toast(t("Invoice {number} issued.", { number: n }));
      await qc.invalidateQueries();
    },
  });
  const markSent = useMutation({
    mutationFn: () => rpc("mark_invoice_sent", { p_id: id }),
    onSuccess: () => qc.invalidateQueries(),
  });

  if (!can("invoices.view")) return <NotAllowed />;
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const b = q.data;
  const inv = b.inv;
  const draft = inv.status === "draft";
  const issued = inv.status === "issued";
  const balance = Number(inv.balance);
  const customer = {
    id: inv.customer_id,
    name: inv.customer_name,
    phone: inv.customer_phone,
    whatsapp: inv.customer_whatsapp,
    email: inv.customer_email,
  };
  const vehicle = { plate_emirate: inv.plate_emirate, plate_code: inv.plate_code, plate_number: inv.plate_number, make: inv.make, model: inv.model };
  const msg =
    issued && balance > 0 && inv.days_overdue > 0
      ? reminderMessage({ garage: org.name, customer: inv.customer_name, number: inv.number ?? "", date: inv.issue_date, balance, daysOverdue: inv.days_overdue, phone: org.phone })
      : invoiceMessage({ garage: org.name, customer: inv.customer_name, number: inv.number ?? "", date: inv.issue_date, total: Number(inv.total) - Number(inv.credited), balance: Math.max(0, balance), vehicle });

  return (
    <div>
      <PageHeader
        back={{ to: "/invoices", label: t("Invoices") }}
        title={inv.number ?? t("Draft invoice")}
        badge={<StatusBadge map={INVOICE_STATUS} status={inv.display_status} />}
        subtitle={
          <>
            {inv.customer_name}
            {inv.issue_date && ` · ${formatDate(inv.issue_date, lang)}`}
            {inv.days_overdue > 0 && <span className="text-bad"> · {tn(inv.days_overdue, "{n} day late", "{n} days late")}</span>}
          </>
        }
        actions={
          <>
            {draft && can("invoices.create") && (
              <ButtonLink to="/invoices/edit/$id" params={{ id }} icon={<Pencil className="size-4" />}>
                {t("Edit")}
              </ButtonLink>
            )}
            {draft && can("invoices.issue") && (
              <Button variant="primary" loading={issue.isPending} onClick={() => issue.mutate()} icon={<CheckCircle2 className="size-4" />}>
                {t("Issue invoice")}
              </Button>
            )}
            {issued && balance > 0 && can("payments.record") && (
              <Button variant="success" onClick={() => setPayTarget({ kind: "payment", invoice_id: id, label: t("Invoice {number}", { number: inv.number ?? "" }), max: balance, suggested: balance, customer })} icon={<CreditCard className="size-4" />}>
                {t("Record payment")}
              </Button>
            )}
            {issued && balance < 0 && can("refunds.record") && (
              <Button variant="danger" onClick={() => setPayTarget({ kind: "refund", invoice_id: id, credit_note_id: b.creditNotes.at(-1)?.id ?? null, label: t("Invoice {number}", { number: inv.number ?? "" }), max: -balance, suggested: -balance, customer })} icon={<Undo2 className="size-4" />}>
                {t("Record refund")}
              </Button>
            )}
            <a href={`/print/invoice/${id}`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium hover:bg-canvas">
              <Printer className="size-4" aria-hidden /> {t("Print / PDF")}
            </a>
          </>
        }
      />
      {issue.isError && (
        <div className="mb-4">
          <FormError error={issue.error} />
        </div>
      )}
      {issued && balance < 0 && (
        <Alert tone="refund" className="mb-4" title={t("The customer is owed money.")}>
          <Money value={-balance} strong /> — {t("A credit note reduced the invoice after payment. Record the refund when you pay the customer back.")}
        </Alert>
      )}
      {draft && Number(inv.paid) > 0 && (
        <Alert tone="info" className="mb-4">
          {t("A deposit is attached to this draft and will reduce the balance when the invoice is issued:")} <Money value={inv.paid} strong />
        </Alert>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <InvoiceDoc b={b} />
        </div>
        <div className="min-w-0 space-y-5">
          <Card>
            <CardTitle>{t("Balance")}</CardTitle>
            <dl className="space-y-2 text-sm">
              <Line label={t("Total")} value={<Money value={inv.total} />} />
              {Number(inv.credited) > 0 && <Line label={t("Credit notes")} value={<Money value={-Number(inv.credited)} />} />}
              <Line label={draft ? t("Deposits") : t("Paid")} value={<Money value={Number(inv.paid)} />} />
              {Number(inv.refunded) > 0 && <Line label={t("Refunded")} value={<Money value={Number(inv.refunded)} />} />}
              <div className="border-t border-line pt-2">
                <Line label={balance < 0 ? t("Refund due") : t("Balance due")} value={<Money value={balance} strong className={balance > 0 ? "text-lg text-bad" : balance < 0 ? "text-lg text-refund" : "text-lg text-ok"} />} />
              </div>
            </dl>
          </Card>

          {issued && (
            <Card>
              <CardTitle>{t("Send to the customer")}</CardTitle>
              <div className="flex flex-wrap gap-2">
                <SendButtons ctx={{ purpose: inv.days_overdue > 0 ? "invoice_reminder" : "invoice", message: msg, phone: inv.customer_whatsapp ?? inv.customer_phone, email: inv.customer_email, refs: { customer_id: inv.customer_id, invoice_id: id } }} />
                {!inv.sent_at && (
                  <Button variant="ghost" loading={markSent.isPending} onClick={() => markSent.mutate()} icon={<Send className="size-4" />}>
                    {t("Mark as sent")}
                  </Button>
                )}
              </div>
              <p className="mt-2 text-xs text-muted">{t("WhatsApp and email open with the message ready; you press send. Print / PDF to attach the invoice.")}</p>
              {b.messages.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-line pt-3 text-xs text-muted">
                  {b.messages.map((m) => (
                    <li key={m.id}>
                      {m.channel === "whatsapp" ? "WhatsApp" : t("Email")} · {m.purpose === "invoice_reminder" ? t("Reminder") : t("Invoice")} · {formatDateTime(m.created_at, lang)} · {m.created_by_name}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card>
            <CardTitle
              action={
                draft && can("payments.record") ? (
                  <Button size="sm" onClick={() => setPayTarget({ kind: "deposit", invoice_id: id, label: t("Draft invoice"), max: null, customer })}>
                    {t("Record deposit")}
                  </Button>
                ) : undefined
              }
            >
              {t("Payments")}
            </CardTitle>
            {b.payments.length === 0 ? (
              <p className="text-sm text-muted">{t("No payment yet.")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {b.payments.map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        <Link to="/payments/$id" params={{ id: p.id }} className="text-brand hover:underline">
                          {p.number}
                        </Link>{" "}
                        · {t(p.method_name)} {p.kind !== "payment" && <Badge tone={p.kind === "refund" ? "refund" : "info"}>{p.kind === "refund" ? t("Refund") : t("Deposit")}</Badge>}
                      </p>
                      <p className="text-xs text-muted">
                        {formatDateTime(p.paid_at, lang)} · {p.received_by_name}
                        {p.reference && ` · ${p.reference}`}
                      </p>
                      {p.voided_at && <p className="text-xs text-bad">{t("Voided: {reason}", { reason: p.void_reason ?? "" })}</p>}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Money value={p.kind === "refund" ? -p.amount : p.amount} className={p.voided_at ? "text-faint line-through" : ""} />
                      {!p.voided_at && can("payments.void") && (
                        <button type="button" onClick={() => setDialog({ void: p.id })} className="min-h-8 text-xs text-bad hover:underline">
                          {t("Void")}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {(b.creditNotes.length > 0 || (issued && can("credit_notes.create"))) && (
            <Card>
              <CardTitle
                action={
                  issued && can("credit_notes.create") && Number(inv.total) - Number(inv.credited) > 0 ? (
                    <Button size="sm" onClick={() => setDialog("credit")} icon={<FileMinus className="size-4" />}>
                      {t("Credit note")}
                    </Button>
                  ) : undefined
                }
              >
                {t("Credit notes")}
              </CardTitle>
              {b.creditNotes.length === 0 ? (
                <p className="text-sm text-muted">{t("No credit note. Use one to correct an issued invoice.")}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {b.creditNotes.map((c) => (
                    <li key={c.id} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <Link to="/credit-notes/$id" params={{ id: c.id }} className="text-sm font-medium text-brand hover:underline">
                          {c.number}
                        </Link>
                        <p className="truncate text-xs text-muted">{c.reason}</p>
                      </div>
                      <Money value={-c.total} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {(issued || draft) && (
            <Card>
              <CardTitle>{t("Other actions")}</CardTitle>
              <div className="flex flex-wrap gap-2">
                {issued && can("invoices.cancel") && (
                  <Button variant="ghost" className="text-bad" onClick={() => setDialog("cancel")} icon={<Ban className="size-4" />}>
                    {t("Cancel invoice")}
                  </Button>
                )}
                {draft && can("invoices.create") && (
                  <Button variant="ghost" className="text-bad" onClick={() => setDialog("delete")} icon={<Trash2 className="size-4" />}>
                    {t("Delete draft")}
                  </Button>
                )}
                {inv.job_card_id && (
                  <ButtonLink to="/job-cards/$id" params={{ id: inv.job_card_id }} variant="ghost" icon={<RotateCcw className="size-4" />}>
                    {t("Job card {number}", { number: inv.job_card_number ?? "" })}
                  </ButtonLink>
                )}
                {inv.vehicle_id && (
                  <ButtonLink to="/vehicles/$id" params={{ id: inv.vehicle_id }} variant="ghost">
                    {t("Vehicle history")}
                  </ButtonLink>
                )}
                <ButtonLink to="/customers/$id" params={{ id: inv.customer_id }} variant="ghost">
                  {t("Customer profile")}
                </ButtonLink>
              </div>
            </Card>
          )}
          <ActivityCard entityIds={[id, ...b.payments.map((p) => p.id), ...b.creditNotes.map((c) => c.id)]} />
        </div>
      </div>

      {payTarget && <PaymentDialog open target={payTarget} onClose={() => setPayTarget(null)} />}
      {dialog === "credit" && <CreditNoteDialog open inv={inv} lines={b.lines} onClose={() => setDialog(null)} />}
      {dialog === "cancel" && (
        <ReasonDialog
          open
          title={t("Cancel invoice {number}", { number: inv.number ?? "" })}
          warning={t("The invoice keeps its number and is marked cancelled. Parts go back to stock and a job card can be invoiced again. This cannot be undone.")}
          confirmLabel={t("Cancel invoice")}
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await rpc("cancel_invoice", { p_id: id, p_reason: reason });
            await qc.invalidateQueries();
            toast(t("Invoice cancelled."));
          }}
        />
      )}
      {dialog === "delete" && (
        <ReasonDialog
          open
          reasonRequired={false}
          title={t("Delete this draft?")}
          warning={t("The draft has no number yet. Deposits attached to it go back to their job card or estimate.")}
          confirmLabel={t("Delete draft")}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await rpc("delete_invoice_draft", { p_id: id });
            await qc.invalidateQueries();
            toast(t("Draft deleted."));
            navigate({ to: "/invoices" });
          }}
        />
      )}
      {dialog && typeof dialog === "object" && (
        <ReasonDialog
          open
          title={t("Void this payment?")}
          warning={t("The receipt stays in the history, marked void, and the balance goes back up. Use this for a payment recorded by mistake or reversed by the bank.")}
          confirmLabel={t("Void payment")}
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await rpc("void_payment", { p_id: dialog.void, p_reason: reason });
            await qc.invalidateQueries();
            toast(t("Payment voided."));
          }}
        />
      )}
    </div>
  );
}

function Line({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-2">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
