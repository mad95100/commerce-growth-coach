import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Check, FileText, Pencil, RotateCcw, Wallet, Wrench, X } from "lucide-react";
import { useState } from "react";
import { useOrg, useRefData, useSession } from "@/app/session.tsx";
import { ActivityCard } from "@/components/actions/ActivityCard.tsx";
import { PaymentDialog, type PaymentTarget } from "@/components/actions/PaymentDialog.tsx";
import { SendButtons } from "@/components/actions/SendButtons.tsx";
import { EstimateDoc } from "@/components/documents/docs.tsx";
import { Button, ButtonLink } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { Alert, Badge, ErrorState, FormError, Loading, StatusBadge } from "@/components/ui/feedback.tsx";
import { Field, Input, Select } from "@/components/ui/form.tsx";
import { Card, CardTitle, NotAllowed, PageHeader } from "@/components/ui/layout.tsx";
import { Money } from "@/components/ui/money.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { fetchEstimate } from "@/api/documents.ts";
import { dubaiTimestamp, formatDate, formatDateTime } from "@/lib/dates.ts";
import { t, useLang } from "@/lib/i18n.tsx";
import { estimateMessage } from "@/lib/messages.ts";
import { ESTIMATE_STATUS } from "@/lib/status.ts";
import { rpc } from "@/lib/supabase.ts";

export const Route = createFileRoute("/_app/estimates/$id")({ component: EstimatePage });

function EstimatePage() {
  const { id } = Route.useParams();
  const org = useOrg();
  const ref = useRefData();
  const { can } = useSession();
  const { lang } = useLang();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["estimate", id], queryFn: () => fetchEstimate(id) });
  const [pay, setPay] = useState<PaymentTarget | null>(null);
  const [convert, setConvert] = useState(false);
  const [jc, setJc] = useState({ technician_id: "", date: "", time: "17:00" });

  const status = useMutation({
    mutationFn: (s: string) => rpc("set_estimate_status", { p_id: id, p_status: s }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const toJob = useMutation({
    mutationFn: () => rpc<string>("convert_estimate_to_job_card", { p_id: id, p: { technician_id: jc.technician_id || null, promised_at: jc.date ? dubaiTimestamp(jc.date, jc.time) : null } }),
    onSuccess: async (jcId) => {
      await qc.invalidateQueries();
      toast(t("Job card opened."));
      navigate({ to: "/job-cards/$id", params: { id: jcId } });
    },
  });
  const toInvoice = useMutation({
    mutationFn: () => rpc<string>("create_invoice_from_estimate", { p_id: id }),
    onSuccess: async (invId) => {
      await qc.invalidateQueries();
      toast(t("Draft invoice created from the estimate."));
      navigate({ to: "/invoices/$id", params: { id: invId } });
    },
  });

  if (!can("estimates.view")) return <NotAllowed />;
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const { est: e, customer, vehicle, payments } = q.data;
  const open = ["draft", "sent", "pending"].includes(e.status);
  const convertible = ["draft", "sent", "pending", "approved"].includes(e.status) && !e.job_card_id && !e.invoice_id;
  const manage = can("estimates.manage");
  const msg = estimateMessage({ garage: org.name, customer: customer.display_name, number: e.number, total: Number(e.total), validUntil: e.valid_until, vehicle });
  const err = status.error ?? toJob.error ?? toInvoice.error;

  return (
    <div>
      <PageHeader
        back={{ to: "/estimates", label: t("Estimates") }}
        title={t("Estimate {number}", { number: e.number })}
        badge={<StatusBadge map={ESTIMATE_STATUS} status={e.display_status} />}
        subtitle={`${customer.display_name} · ${formatDate(e.issue_date, lang)}`}
        actions={
          <>
            {open && manage && (
              <ButtonLink to="/estimates/edit/$id" params={{ id }} icon={<Pencil className="size-4" />}>
                {t("Edit")}
              </ButtonLink>
            )}
            {convertible && can("job_cards.manage") && manage && (
              <Button variant="primary" onClick={() => (e.vehicle_id ? setConvert(true) : null)} disabled={!e.vehicle_id} title={!e.vehicle_id ? t("Add a vehicle to the estimate first.") : undefined} icon={<Wrench className="size-4" />}>
                {e.status === "approved" ? t("Create job card") : t("Approve & create job card")}
              </Button>
            )}
            {convertible && can("invoices.create") && (
              <Button loading={toInvoice.isPending} onClick={() => toInvoice.mutate()} icon={<FileText className="size-4" />}>
                {t("Invoice directly")}
              </Button>
            )}
          </>
        }
      />
      {err && (
        <div className="mb-4">
          <FormError error={err} />
        </div>
      )}
      {e.display_status === "expired" && <Alert tone="warn" className="mb-4">{t("This estimate passed its validity date. Check prices before approving it.")}</Alert>}
      {e.job_card_id && (
        <Alert tone="brand" className="mb-4">
          {t("Converted to a job card.")}{" "}
          <Link to="/job-cards/$id" params={{ id: e.job_card_id }} className="font-semibold text-brand underline">
            {t("Open the job card")}
          </Link>
        </Alert>
      )}
      {e.invoice_id && (
        <Alert tone="brand" className="mb-4">
          {t("Invoiced directly.")}{" "}
          <Link to="/invoices/$id" params={{ id: e.invoice_id }} className="font-semibold text-brand underline">
            {t("Open the invoice")}
          </Link>
        </Alert>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <EstimateDoc b={q.data} />
        </div>
        <div className="min-w-0 space-y-5">
          <Card>
            <CardTitle>{t("Customer decision")}</CardTitle>
            {manage && (open || e.status === "approved" || e.status === "rejected") ? (
              <div className="flex flex-wrap gap-2">
                {open && (
                  <Button variant="success" loading={status.isPending && status.variables === "approved"} onClick={() => status.mutate("approved")} icon={<Check className="size-4" />}>
                    {t("Approved")}
                  </Button>
                )}
                {open && (
                  <Button variant="ghost" className="text-bad" loading={status.isPending && status.variables === "rejected"} onClick={() => status.mutate("rejected")} icon={<X className="size-4" />}>
                    {t("Rejected")}
                  </Button>
                )}
                {(e.status === "draft" || e.status === "sent") && (
                  <Button variant="ghost" onClick={() => status.mutate("pending")}>
                    {t("Customer is thinking")}
                  </Button>
                )}
                {(e.status === "approved" || e.status === "rejected") && (
                  <Button variant="ghost" onClick={() => status.mutate("draft")} icon={<RotateCcw className="size-4" />}>
                    {t("Reopen")}
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted">{e.decided_at ? t("Decided on {date}", { date: formatDateTime(e.decided_at, lang) }) : t("No decision recorded.")}</p>
            )}
          </Card>
          <Card>
            <CardTitle>{t("Send to the customer")}</CardTitle>
            <div className="flex flex-wrap gap-2">
              <SendButtons ctx={{ purpose: "estimate", message: msg, phone: customer.whatsapp ?? customer.phone, email: customer.email, refs: { customer_id: customer.id, estimate_id: id }, printHref: `/print/estimate/${id}` }} />
            </div>
            {e.sent_at && <p className="mt-2 text-xs text-muted">{t("Sent on {date}", { date: formatDateTime(e.sent_at, lang) })}</p>}
          </Card>
          <Card>
            <CardTitle
              action={
                can("payments.record") && e.status !== "rejected" && !e.invoice_id ? (
                  <Button size="sm" onClick={() => setPay({ kind: "deposit", estimate_id: id, job_card_id: e.job_card_id, label: t("Estimate {number}", { number: e.number }), max: null, customer: { id: customer.id, name: customer.display_name, phone: customer.phone, whatsapp: customer.whatsapp, email: customer.email } })} icon={<Wallet className="size-4" />}>
                    {t("Record deposit")}
                  </Button>
                ) : undefined
              }
            >
              {t("Deposits")}
            </CardTitle>
            {!can("invoices.view") ? (
              <p className="text-sm text-muted">{t("Deposits received:")} <Money value={e.deposits} /></p>
            ) : payments.length === 0 ? (
              <p className="text-sm text-muted">{t("No deposit. A deposit is deducted automatically from the final invoice.")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-sm">
                      <Link to="/payments/$id" params={{ id: p.id }} className="font-medium text-brand hover:underline">
                        {p.number}
                      </Link>{" "}
                      · {p.method_name} {p.voided_at && <Badge tone="muted">{t("Void")}</Badge>}
                    </span>
                    <Money value={p.kind === "refund" ? -p.amount : p.amount} className={p.voided_at ? "text-faint line-through" : ""} />
                  </li>
                ))}
              </ul>
            )}
            {Number(e.deposits) > 0 && (
              <p className="mt-2 text-sm">
                {t("Remaining after deposit:")} <Money value={Number(e.total) - Number(e.deposits)} strong />
              </p>
            )}
          </Card>
          <ActivityCard entityIds={[id]} />
        </div>
      </div>

      {pay && <PaymentDialog open target={pay} onClose={() => setPay(null)} />}
      <Dialog
        open={convert}
        onClose={() => setConvert(false)}
        title={t("Open a job card")}
        footer={
          <>
            <Button onClick={() => setConvert(false)}>{t("Cancel")}</Button>
            <Button variant="primary" loading={toJob.isPending} onClick={() => toJob.mutate()}>
              {t("Create job card")}
            </Button>
          </>
        }
      >
        <p className="mb-4 text-sm text-muted">{t("Lines, customer, vehicle, mileage and deposits are copied. Nothing to type again.")}</p>
        <div className="space-y-4">
          <Field label={t("Mechanic")}>
            {(fid) => (
              <Select id={fid} value={jc.technician_id} onChange={(ev) => setJc({ ...jc, technician_id: ev.target.value })}>
                <option value="">{t("Not assigned")}</option>
                {(ref.data?.technicians ?? []).filter((x) => x.active).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Promised date")}>{(fid) => <Input id={fid} type="date" value={jc.date} onChange={(ev) => setJc({ ...jc, date: ev.target.value })} />}</Field>
            <Field label={t("Promised time")}>{(fid) => <Input id={fid} type="time" value={jc.time} onChange={(ev) => setJc({ ...jc, time: ev.target.value })} />}</Field>
          </div>
          <FormError error={toJob.error} />
        </div>
      </Dialog>
    </div>
  );
}
