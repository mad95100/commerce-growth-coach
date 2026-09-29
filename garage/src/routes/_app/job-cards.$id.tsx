import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import clsx from "clsx";
import { ClipboardCheck, FileText, Pencil, Wallet } from "lucide-react";
import { useState } from "react";
import { useOrg, useRefData, useSession } from "@/app/session.tsx";
import { ActivityCard } from "@/components/actions/ActivityCard.tsx";
import { PaymentDialog, type PaymentTarget } from "@/components/actions/PaymentDialog.tsx";
import { ReasonDialog } from "@/components/actions/ReasonDialog.tsx";
import { SendButtons } from "@/components/actions/SendButtons.tsx";
import { DocLines } from "@/components/documents/PrintDoc.tsx";
import { Button, ButtonLink } from "@/components/ui/button.tsx";
import { Alert, Badge, ErrorState, FormError, Loading, StatusBadge } from "@/components/ui/feedback.tsx";
import { Field, Select, Textarea } from "@/components/ui/form.tsx";
import { Card, CardTitle, DescriptionList, NotAllowed, PageHeader } from "@/components/ui/layout.tsx";
import { Money } from "@/components/ui/money.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { fetchJobCard } from "@/api/documents.ts";
import { formatDateTime } from "@/lib/dates.ts";
import { t, useLang } from "@/lib/i18n.tsx";
import { vehicleReadyMessage } from "@/lib/messages.ts";
import { formatPhone } from "@/lib/phone.ts";
import { formatPlate } from "@/lib/plates.ts";
import { JOB_STATUS } from "@/lib/status.ts";
import { rpc } from "@/lib/supabase.ts";

export const Route = createFileRoute("/_app/job-cards/$id")({ component: JobCardPage });

const FLOW = ["open", "in_progress", "waiting_parts", "ready", "delivered"] as const;

function JobCardPage() {
  const { id } = Route.useParams();
  const org = useOrg();
  const ref = useRefData();
  const { can } = useSession();
  const { lang } = useLang();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["job-card", id], queryFn: () => fetchJobCard(id) });
  const [pay, setPay] = useState<PaymentTarget | null>(null);
  const [notes, setNotes] = useState<{ diagnosis: string; work_done: string } | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const progress = useMutation({
    mutationFn: (p: Record<string, unknown>) => rpc("update_job_card_progress", { p: { id, ...p } }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      setNotes(null);
    },
  });
  const invoice = useMutation({
    mutationFn: () => rpc<string>("create_invoice_from_job_card", { p_id: id }),
    onSuccess: async (invId) => {
      await qc.invalidateQueries();
      toast(t("Draft invoice created from the job card."));
      navigate({ to: "/invoices/$id", params: { id: invId } });
    },
  });
  const inspect = useMutation({
    mutationFn: () => rpc<string>("create_inspection", { p: { org_id: org.id, vehicle_id: q.data!.jc.vehicle_id, job_card_id: id, technician_id: q.data!.jc.technician_id, mileage: q.data!.jc.mileage_in } }),
    onSuccess: async (insId) => {
      await qc.invalidateQueries();
      navigate({ to: "/inspections/$id", params: { id: insId } });
    },
  });

  const allowed = can("job_cards.view") || can("job_cards.progress");
  if (!allowed) return <NotAllowed />;
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const { jc, customer, vehicle, lines, payments } = q.data;
  const manage = can("job_cards.manage");
  const closed = jc.status === "cancelled";
  const editableLines = manage && !jc.invoice_id && !closed;
  const ready = vehicleReadyMessage({ garage: org.name, customer: customer.display_name, vehicle, balance: null });
  const err = progress.error ?? invoice.error ?? inspect.error;

  return (
    <div>
      <PageHeader
        back={{ to: "/job-cards", label: t("Job cards") }}
        title={t("Job card {number}", { number: jc.number })}
        badge={
          <>
            <StatusBadge map={JOB_STATUS} status={jc.status} />
            {jc.is_delayed && <Badge tone="bad">{t("Delayed")}</Badge>}
          </>
        }
        subtitle={`${formatPlate(vehicle, lang)} · ${[vehicle.make, vehicle.model].filter(Boolean).join(" ")} · ${customer.display_name}`}
        actions={
          <>
            {editableLines && (
              <ButtonLink to="/job-cards/edit/$id" params={{ id }} icon={<Pencil className="size-4" />}>
                {t("Edit lines")}
              </ButtonLink>
            )}
            {!jc.invoice_id && !closed && can("invoices.create") && (
              <Button variant="primary" loading={invoice.isPending} onClick={() => invoice.mutate()} icon={<FileText className="size-4" />}>
                {t("Create invoice")}
              </Button>
            )}
            {jc.invoice_id && can("invoices.view") && (
              <ButtonLink to="/invoices/$id" params={{ id: jc.invoice_id }} variant="primary" icon={<FileText className="size-4" />}>
                {t("Open invoice")}
              </ButtonLink>
            )}
            <a href={`/print/job-card/${id}`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium hover:bg-canvas">
              {t("Print job card")}
            </a>
          </>
        }
      />
      {err && (
        <div className="mb-4">
          <FormError error={err} />
        </div>
      )}
      {closed && <Alert tone="neutral" className="mb-4">{t("This job card was cancelled.")}</Alert>}

      <Card className="mb-5">
        <CardTitle>{t("Progress")}</CardTitle>
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {FLOW.map((s) => {
            const current = jc.status === s;
            const idx = FLOW.indexOf(s);
            const done = FLOW.indexOf(jc.status as (typeof FLOW)[number]) > idx;
            return (
              <li key={s}>
                <button
                  type="button"
                  disabled={closed || current || progress.isPending}
                  onClick={() => progress.mutate({ status: s })}
                  aria-current={current ? "step" : undefined}
                  className={clsx(
                    "flex min-h-14 w-full flex-col items-center justify-center rounded-xl border px-2 text-sm font-medium transition-colors",
                    current ? "border-brand bg-brand text-white" : done ? "border-ok/30 bg-ok-soft text-ok" : "border-line-strong bg-surface text-ink-2 hover:bg-canvas",
                  )}
                >
                  {t(JOB_STATUS[s].label)}
                </button>
              </li>
            );
          })}
        </ol>
        <div className="mt-4 flex flex-wrap gap-2">
          {jc.status === "ready" && (
            <SendButtons ctx={{ purpose: "vehicle_ready", message: ready, phone: customer.whatsapp ?? customer.phone, email: customer.email, refs: { customer_id: customer.id, job_card_id: id } }} />
          )}
          {can("inspections.manage") && !closed && (
            <Button loading={inspect.isPending} onClick={() => inspect.mutate()} icon={<ClipboardCheck className="size-4" />}>
              {t("Start inspection")}
            </Button>
          )}
          {manage && !jc.invoice_id && !closed && (
            <Button variant="ghost" className="text-bad" onClick={() => setCancelling(true)}>
              {t("Cancel job card")}
            </Button>
          )}
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardTitle
              action={
                !closed && !notes ? (
                  <Button size="sm" onClick={() => setNotes({ diagnosis: jc.diagnosis ?? "", work_done: jc.work_done ?? "" })} icon={<Pencil className="size-4" />}>
                    {t("Update")}
                  </Button>
                ) : undefined
              }
            >
              {t("Workshop notes")}
            </CardTitle>
            <p className="text-xs font-semibold tracking-wide text-muted uppercase">{t("Customer complaint")}</p>
            <p className="mt-1 mb-4 whitespace-pre-line text-sm">{jc.complaint || "—"}</p>
            {notes ? (
              <div className="space-y-3">
                <Field label={t("Diagnosis")}>{(fid) => <Textarea id={fid} value={notes.diagnosis} onChange={(e) => setNotes({ ...notes, diagnosis: e.target.value })} />}</Field>
                <Field label={t("Work done")}>{(fid) => <Textarea id={fid} value={notes.work_done} onChange={(e) => setNotes({ ...notes, work_done: e.target.value })} />}</Field>
                <div className="flex gap-2">
                  <Button variant="primary" loading={progress.isPending} onClick={() => progress.mutate(notes)}>
                    {t("Save")}
                  </Button>
                  <Button onClick={() => setNotes(null)}>{t("Cancel")}</Button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-xs font-semibold tracking-wide text-muted uppercase">{t("Diagnosis")}</p>
                <p className="mt-1 mb-4 whitespace-pre-line text-sm">{jc.diagnosis || "—"}</p>
                <p className="text-xs font-semibold tracking-wide text-muted uppercase">{t("Work done")}</p>
                <p className="mt-1 whitespace-pre-line text-sm">{jc.work_done || "—"}</p>
              </>
            )}
          </Card>
          <Card>
            <CardTitle>{t("Parts & labor")}</CardTitle>
            {lines.length === 0 ? <p className="text-sm text-muted">{t("No line yet.")}</p> : <DocLines lines={lines} vat={org.vat_registered} showPrices={can("job_cards.view")} />}
            {can("job_cards.view") && lines.length > 0 && (
              <p className="mt-3 text-end text-sm">
                {t("Estimated total:")} <Money value={jc.total} strong />
              </p>
            )}
          </Card>
        </div>
        <div className="min-w-0 space-y-5">
          <Card>
            <CardTitle>{t("Vehicle & customer")}</CardTitle>
            <DescriptionList
              className="sm:grid-cols-1"
              items={[
                [t("Vehicle"), <Link key="v" to="/vehicles/$id" params={{ id: vehicle.id }} className="text-brand hover:underline">{`${formatPlate(vehicle, lang)} · ${[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ")}`}</Link>],
                [t("VIN"), vehicle.vin],
                [t("Mileage in"), jc.mileage_in != null ? `${Number(jc.mileage_in).toLocaleString("en")} km` : null],
                [t("Customer"), can("customers.view") ? <Link key="c" to="/customers/$id" params={{ id: customer.id }} className="text-brand hover:underline">{customer.display_name}</Link> : customer.display_name],
                [t("Phone"), formatPhone(customer.phone)],
                [t("Received"), formatDateTime(jc.received_at, lang)],
                [t("Promised"), jc.promised_at ? formatDateTime(jc.promised_at, lang) : null],
                [t("Estimate"), jc.estimate_id && jc.estimate_number ? <Link key="e" to="/estimates/$id" params={{ id: jc.estimate_id }} className="text-brand hover:underline">{jc.estimate_number}</Link> : null],
              ]}
            />
            <div className="mt-4">
              {manage && !closed ? (
                <Field label={t("Mechanic")}>
                  {(fid) => (
                    <Select id={fid} value={jc.technician_id ?? ""} onChange={(e) => progress.mutate({ technician_id: e.target.value || null })}>
                      <option value="">{t("Not assigned")}</option>
                      {(ref.data?.technicians ?? []).filter((x) => x.active || x.id === jc.technician_id).map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : (
                <p className="text-sm">
                  <span className="text-muted">{t("Mechanic")}:</span> {jc.technician_name ?? t("Not assigned")}
                </p>
              )}
            </div>
          </Card>
          {can("invoices.view") && (
            <Card>
              <CardTitle
                action={
                  can("payments.record") && !closed && !jc.invoice_id ? (
                    <Button size="sm" onClick={() => setPay({ kind: "deposit", job_card_id: id, label: t("Job card {number}", { number: jc.number }), max: null, customer: { id: customer.id, name: customer.display_name, phone: customer.phone, whatsapp: customer.whatsapp, email: customer.email } })} icon={<Wallet className="size-4" />}>
                      {t("Record deposit")}
                    </Button>
                  ) : undefined
                }
              >
                {t("Deposits")}
              </CardTitle>
              {payments.length === 0 ? (
                <p className="text-sm text-muted">{t("No deposit. A deposit is deducted automatically from the final invoice.")}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="text-sm">
                        <Link to="/payments/$id" params={{ id: p.id }} className="font-medium text-brand hover:underline">
                          {p.number}
                        </Link>{" "}
                        · {p.method_name} {p.kind === "refund" && <Badge tone="refund">{t("Refund")}</Badge>} {p.voided_at && <Badge tone="muted">{t("Void")}</Badge>}
                      </span>
                      <Money value={p.kind === "refund" ? -p.amount : p.amount} className={p.voided_at ? "text-faint line-through" : ""} />
                    </li>
                  ))}
                </ul>
              )}
              {!jc.invoice_id && Number(jc.deposits) > 0 && can("refunds.record") && (
                <Button className="mt-3" size="sm" variant="ghost" onClick={() => setPay({ kind: "refund", job_card_id: id, label: t("Job card {number}", { number: jc.number }), max: Number(jc.deposits), suggested: Number(jc.deposits), customer: { id: customer.id, name: customer.display_name, phone: customer.phone, whatsapp: customer.whatsapp, email: customer.email } })}>
                  {t("Refund the deposit")}
                </Button>
              )}
            </Card>
          )}
          <ActivityCard entityIds={[id]} />
        </div>
      </div>
      {pay && <PaymentDialog open target={pay} onClose={() => setPay(null)} />}
      {cancelling && (
        <ReasonDialog
          open
          reasonRequired={false}
          title={t("Cancel this job card?")}
          warning={t("The job card stays in the history as cancelled. Deposits stay recorded: refund them if the customer does not come back.")}
          confirmLabel={t("Cancel job card")}
          onClose={() => setCancelling(false)}
          onConfirm={async () => {
            await rpc("update_job_card_progress", { p: { id, status: "cancelled" } });
            await qc.invalidateQueries();
          }}
        />
      )}
    </div>
  );
}
