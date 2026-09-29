import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Archive, Car, FileText, MessageCircle, Pencil, Phone, Plus, ReceiptText, Wrench } from "lucide-react";
import { useState } from "react";
import { useSession } from "@/app/session.tsx";
import { CustomerDialog } from "@/components/forms/CustomerForm.tsx";
import { VehicleDialog } from "@/components/forms/VehicleForm.tsx";
import { Button, ButtonLink } from "@/components/ui/button.tsx";
import { Alert, Badge, EmptyState, ErrorState, Loading, StatusBadge } from "@/components/ui/feedback.tsx";
import { Card, CardTitle, DescriptionList, NotAllowed, PageHeader, Stat, TableWrap, Tabs, tableClass, td, th, trClass } from "@/components/ui/layout.tsx";
import { Money } from "@/components/ui/money.tsx";
import { formatDate, formatDateTime } from "@/lib/dates.ts";
import { t, tn, useLang } from "@/lib/i18n.tsx";
import { formatMoney } from "@/lib/money.ts";
import { formatPhone, whatsappUrl } from "@/lib/phone.ts";
import { emirateName, formatPlate } from "@/lib/plates.ts";
import { ESTIMATE_STATUS, INVOICE_STATUS, JOB_STATUS } from "@/lib/status.ts";
import { supabase } from "@/lib/supabase.ts";
import type { Customer, EstimateRow, InvoiceRow, JobCardRow, PaymentRow, Vehicle } from "@/api/types.ts";

export const Route = createFileRoute("/_app/customers/$id")({ component: CustomerPage });

type Tab = "vehicles" | "invoices" | "estimates" | "jobs" | "payments" | "details";

function CustomerPage() {
  const { id } = Route.useParams();
  const { can } = useSession();
  const { lang } = useLang();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("vehicles");
  const [edit, setEdit] = useState(false);
  const [vehicleDialog, setVehicleDialog] = useState(false);

  const q = useQuery({
    queryKey: ["customer-profile", id],
    queryFn: async () => {
      const inv = can("invoices.view");
      const [c, v, i, e, j, p] = await Promise.all([
        supabase.from("customers").select("*").eq("id", id).maybeSingle(),
        supabase.from("vehicles").select("*").eq("customer_id", id).order("created_at"),
        inv ? supabase.from("v_invoices").select("*").eq("customer_id", id).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
        can("estimates.view") ? supabase.from("v_estimates").select("*").eq("customer_id", id).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
        supabase.from("v_job_cards").select("*").eq("customer_id", id).order("created_at", { ascending: false }),
        inv ? supabase.from("v_payments").select("*").eq("customer_id", id).order("paid_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
      ]);
      for (const r of [c, v, i, e, j, p]) if (r.error) throw r.error;
      if (!c.data) throw { message: "bsg.not_found", details: "customer" };
      return {
        customer: c.data as Customer,
        vehicles: v.data as Vehicle[],
        invoices: i.data as InvoiceRow[],
        estimates: e.data as EstimateRow[],
        jobs: j.data as JobCardRow[],
        payments: p.data as PaymentRow[],
      };
    },
  });

  if (!can("customers.view")) return <NotAllowed />;
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const { customer: c, vehicles, invoices, estimates, jobs, payments } = q.data;
  const issued = invoices.filter((i) => i.status === "issued");
  const totalSpent = issued.reduce((s, i) => s + Number(i.total) - Number(i.credited), 0);
  const outstanding = issued.reduce((s, i) => s + Math.max(0, Number(i.balance)), 0);
  const wa = whatsappUrl(c.whatsapp ?? c.phone, "");
  const activeVehicles = vehicles.filter((v) => !v.archived_at);

  async function archive() {
    await supabase.from("customers").update({ archived_at: c.archived_at ? null : new Date().toISOString() }).eq("id", id);
    await qc.invalidateQueries();
  }

  return (
    <div>
      <PageHeader
        back={{ to: "/customers", label: t("Customers") }}
        title={c.display_name}
        badge={
          <>
            <Badge>{c.type === "company" ? t("Company") : t("Individual")}</Badge>
            {c.archived_at && <Badge tone="muted">{t("Archived")}</Badge>}
          </>
        }
        subtitle={[formatPhone(c.phone), c.email].filter(Boolean).join(" · ")}
        actions={
          <>
            {can("invoices.create") && (
              <ButtonLink to="/invoices/new" search={{ customer: id, vehicle: activeVehicles.length === 1 ? activeVehicles[0].id : undefined }} variant="primary" icon={<Plus className="size-4" />}>
                {t("New Invoice")}
              </ButtonLink>
            )}
            {can("estimates.manage") && (
              <ButtonLink to="/estimates/new" search={{ customer: id, vehicle: activeVehicles.length === 1 ? activeVehicles[0].id : undefined }} icon={<ReceiptText className="size-4" />}>
                {t("Estimate")}
              </ButtonLink>
            )}
            {can("job_cards.manage") && (
              <ButtonLink to="/job-cards/new" search={{ customer: id, vehicle: activeVehicles.length === 1 ? activeVehicles[0].id : undefined }} icon={<Wrench className="size-4" />}>
                {t("Job card")}
              </ButtonLink>
            )}
          </>
        }
      />
      <div className="mb-5 flex flex-wrap gap-2">
        {c.phone && (
          <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium hover:bg-canvas">
            <Phone className="size-4" aria-hidden /> {t("Call")}
          </a>
        )}
        {wa && (
          <a href={wa} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium hover:bg-canvas">
            <MessageCircle className="size-4 text-[#128c4a]" aria-hidden /> WhatsApp
          </a>
        )}
        {can("customers.manage") && (
          <>
            <Button onClick={() => setEdit(true)} icon={<Pencil className="size-4" />}>
              {t("Edit")}
            </Button>
            <Button variant="ghost" onClick={archive} icon={<Archive className="size-4" />}>
              {c.archived_at ? t("Restore") : t("Archive")}
            </Button>
          </>
        )}
      </div>
      {can("invoices.view") && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t("Total spent")} value={formatMoney(totalSpent, lang)} sub={tn(issued.length, "{n} invoice", "{n} invoices")} />
          <Stat label={t("Outstanding balance")} value={formatMoney(outstanding, lang)} tone={outstanding > 0 ? "bad" : undefined} />
          <Stat label={t("Vehicles")} value={activeVehicles.length} />
          <Stat label={t("Last visit")} value={jobs[0] ? formatDate(jobs[0].received_at.slice(0, 10), lang) : invoices[0]?.issue_date ? formatDate(invoices[0].issue_date, lang) : "—"} />
        </div>
      )}
      {c.notes && <Alert tone="neutral" className="mb-5" title={t("Notes")}>{c.notes}</Alert>}

      <Tabs
        label={t("Customer sections")}
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "vehicles", label: t("Vehicles"), count: activeVehicles.length },
          ...(can("invoices.view") ? [{ value: "invoices" as Tab, label: t("Invoices"), count: invoices.length }] : []),
          ...(can("estimates.view") ? [{ value: "estimates" as Tab, label: t("Estimates"), count: estimates.length }] : []),
          { value: "jobs", label: t("Job cards"), count: jobs.length },
          ...(can("invoices.view") ? [{ value: "payments" as Tab, label: t("Payments"), count: payments.length }] : []),
          { value: "details", label: t("Details") },
        ]}
      />

      {tab === "vehicles" && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {vehicles.map((v) => (
            <Link key={v.id} to="/vehicles/$id" params={{ id: v.id }} className="flex min-w-0 items-center gap-3 rounded-xl border border-line bg-surface p-4 hover:border-line-strong">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-canvas">
                <Car className="size-5 text-muted" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-semibold">{formatPlate(v, lang) || v.vin}</span>
                <span className="block truncate text-sm text-muted">{[v.make, v.model, v.year].filter(Boolean).join(" ")}</span>
                {v.archived_at && <Badge tone="muted">{t("Archived")}</Badge>}
              </span>
            </Link>
          ))}
          {can("customers.manage") && (
            <button type="button" onClick={() => setVehicleDialog(true)} className="flex min-h-20 items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong text-sm font-medium text-brand hover:bg-brand-soft">
              <Plus className="size-4" aria-hidden /> {t("Add vehicle")}
            </button>
          )}
          {vehicles.length === 0 && !can("customers.manage") && <p className="text-sm text-muted">{t("No vehicle.")}</p>}
        </div>
      )}

      {tab === "invoices" && (
        <Card padded={false}>
          {invoices.length === 0 ? (
            <EmptyState icon={<FileText className="size-6" />} title={t("No invoice for this customer")} />
          ) : (
            <TableWrap>
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={th}>{t("Invoice")}</th>
                    <th className={`${th} hidden sm:table-cell`}>{t("Vehicle")}</th>
                    <th className={`${th} text-end`}>{t("Total")}</th>
                    <th className={`${th} text-end`}>{t("Balance")}</th>
                    <th className={th}>{t("Status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id} className={trClass}>
                      <td className={td}>
                        <Link to="/invoices/$id" params={{ id: i.id }} className="font-medium text-brand hover:underline">
                          {i.number ?? t("Draft")}
                        </Link>
                        <div className="text-xs text-muted">{formatDate(i.issue_date ?? i.created_at.slice(0, 10), lang)}</div>
                      </td>
                      <td className={`${td} hidden sm:table-cell`}>{formatPlate(i, lang)}</td>
                      <td className={`${td} text-end`}>
                        <Money value={i.total} />
                      </td>
                      <td className={`${td} text-end`}>{i.status === "cancelled" ? "—" : <Money value={i.balance} />}</td>
                      <td className={td}>
                        <StatusBadge map={INVOICE_STATUS} status={i.display_status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      )}

      {tab === "estimates" && (
        <Card padded={false}>
          {estimates.length === 0 ? (
            <EmptyState title={t("No estimate for this customer")} />
          ) : (
            <ul className="divide-y divide-line">
              {estimates.map((e) => (
                <li key={e.id}>
                  <Link to="/estimates/$id" params={{ id: e.id }} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 hover:bg-canvas">
                    <span className="min-w-0">
                      <span className="block font-medium text-brand">{e.number}</span>
                      <span className="block truncate text-xs text-muted">
                        {formatDate(e.issue_date, lang)} · {formatPlate(e, lang)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Money value={e.total} />
                      <StatusBadge map={ESTIMATE_STATUS} status={e.display_status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "jobs" && (
        <Card padded={false}>
          {jobs.length === 0 ? (
            <EmptyState title={t("No job card for this customer")} />
          ) : (
            <ul className="divide-y divide-line">
              {jobs.map((j) => (
                <li key={j.id}>
                  <Link to="/job-cards/$id" params={{ id: j.id }} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 hover:bg-canvas">
                    <span className="min-w-0">
                      <span className="block font-medium text-brand">{j.number}</span>
                      <span className="block truncate text-xs text-muted">
                        {formatDateTime(j.received_at, lang)} · {formatPlate(j, lang)} · {j.complaint}
                      </span>
                    </span>
                    <StatusBadge map={JOB_STATUS} status={j.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "payments" && (
        <Card padded={false}>
          {payments.length === 0 ? (
            <EmptyState title={t("No payment from this customer")} />
          ) : (
            <ul className="divide-y divide-line">
              {payments.map((p) => (
                <li key={p.id}>
                  <Link to="/payments/$id" params={{ id: p.id }} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 hover:bg-canvas">
                    <span className="min-w-0">
                      <span className="block font-medium text-brand">
                        {p.number} {p.kind !== "payment" && <Badge tone={p.kind === "refund" ? "refund" : "info"}>{p.kind === "refund" ? t("Refund") : t("Deposit")}</Badge>} {p.voided_at && <Badge tone="muted">{t("Void")}</Badge>}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {formatDateTime(p.paid_at, lang)} · {t(p.method_name)} {p.invoice_number && `· ${p.invoice_number}`}
                      </span>
                    </span>
                    <Money value={p.kind === "refund" ? -p.amount : p.amount} className={p.voided_at ? "text-faint line-through" : ""} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "details" && (
        <Card>
          <CardTitle>{t("Customer profile")}</CardTitle>
          <DescriptionList
            items={[
              [t("Type"), c.type === "company" ? t("Company") : t("Individual")],
              [t("Company name"), c.company_name],
              [t("First name"), c.first_name],
              [t("Last name"), c.last_name],
              [t("Phone"), formatPhone(c.phone)],
              [t("WhatsApp"), formatPhone(c.whatsapp)],
              [t("Email"), c.email],
              [t("Address"), c.address],
              [t("Emirate"), emirateName(c.emirate, lang)],
              [t("TRN"), c.trn],
              [t("Trade licence number"), c.trade_license_no],
              [t("Customer since"), formatDate(c.created_at.slice(0, 10), lang)],
            ]}
          />
        </Card>
      )}

      {edit && <CustomerDialog open customer={c} onClose={() => setEdit(false)} onSaved={async () => { setEdit(false); await qc.invalidateQueries(); }} />}
      {vehicleDialog && <VehicleDialog open customerId={id} onClose={() => setVehicleDialog(false)} onSaved={async () => { setVehicleDialog(false); await qc.invalidateQueries(); }} />}
    </div>
  );
}
