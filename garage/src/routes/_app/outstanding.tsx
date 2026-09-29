import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlarmClock, CreditCard, Download } from "lucide-react";
import { useMemo, useState } from "react";
import { useOrg, useSession } from "@/app/session.tsx";
import { PaymentDialog, type PaymentTarget } from "@/components/actions/PaymentDialog.tsx";
import { SendButtons } from "@/components/actions/SendButtons.tsx";
import { Button } from "@/components/ui/button.tsx";
import { EmptyState, ErrorState, Loading, StatusBadge } from "@/components/ui/feedback.tsx";
import { Chips } from "@/components/ui/form.tsx";
import { Card, NotAllowed, PageHeader, Stat, TableWrap, tableClass, td, th, trClass } from "@/components/ui/layout.tsx";
import { Money } from "@/components/ui/money.tsx";
import { toCsv } from "@/lib/csv.ts";
import { formatDate, formatDateTime, periodRange, todayISO } from "@/lib/dates.ts";
import { downloadText } from "@/lib/download.ts";
import { t, tn, useLang } from "@/lib/i18n.tsx";
import { reminderMessage } from "@/lib/messages.ts";
import { formatMoney } from "@/lib/money.ts";
import { formatPlate } from "@/lib/plates.ts";
import { INVOICE_STATUS } from "@/lib/status.ts";
import { supabase } from "@/lib/supabase.ts";
import type { InvoiceRow, OutboundMessage } from "@/api/types.ts";

const FILTERS = ["all", "today", "week", "month", "overdue", "large"] as const;
type Filter = (typeof FILTERS)[number];

export const Route = createFileRoute("/_app/outstanding")({
  component: Outstanding,
  validateSearch: (s: Record<string, unknown>): { filter?: Filter } => ({ filter: FILTERS.includes(s.filter as Filter) ? (s.filter as Filter) : undefined }),
});

function Outstanding() {
  const org = useOrg();
  const { can, branchId } = useSession();
  const { lang } = useLang();
  const navigate = useNavigate({ from: Route.fullPath });
  const filter = Route.useSearch().filter ?? "all";
  const [payTarget, setPayTarget] = useState<PaymentTarget | null>(null);

  const q = useQuery({
    queryKey: ["outstanding", org.id, branchId],
    enabled: can("invoices.view"),
    queryFn: async () => {
      let r = supabase.from("v_invoices").select("*").eq("org_id", org.id).eq("status", "issued").gt("balance", 0);
      if (branchId) r = r.eq("branch_id", branchId);
      const { data, error } = await r.order("due_date", { ascending: true });
      if (error) throw error;
      const rows = data as InvoiceRow[];
      const ids = rows.map((x) => x.id);
      let reminders: OutboundMessage[] = [];
      if (ids.length) {
        const m = await supabase.from("outbound_messages").select("*").eq("org_id", org.id).in("invoice_id", ids).order("created_at", { ascending: false });
        if (m.error) throw m.error;
        reminders = m.data as OutboundMessage[];
      }
      return { rows, reminders };
    },
  });

  const today = todayISO();
  const rows = useMemo(() => {
    const all = q.data?.rows ?? [];
    const inRange = (key: "today" | "week" | "month") => {
      const p = periodRange(key, today);
      return (i: InvoiceRow) => !!i.issue_date && i.issue_date >= p.from && i.issue_date <= p.to;
    };
    switch (filter) {
      case "today":
        return all.filter(inRange("today"));
      case "week":
        return all.filter(inRange("week"));
      case "month":
        return all.filter(inRange("month"));
      case "overdue":
        return all.filter((i) => i.days_overdue > 0).sort((a, b) => b.days_overdue - a.days_overdue);
      case "large":
        return all.filter((i) => Number(i.balance) >= Number(org.large_amount_threshold)).sort((a, b) => Number(b.balance) - Number(a.balance));
      default:
        return all;
    }
  }, [q.data, filter, today, org.large_amount_threshold]);

  if (!can("invoices.view")) return <NotAllowed />;
  const all = q.data?.rows ?? [];
  const sum = (xs: InvoiceRow[]) => xs.reduce((s, i) => s + Number(i.balance), 0);
  const overdue = all.filter((i) => i.days_overdue > 0);
  const lastReminder = (id: string) => q.data?.reminders.find((m) => m.invoice_id === id);

  return (
    <div>
      <PageHeader
        title={t("Outstanding invoices")}
        subtitle={t("Issued invoices with a balance still to be paid.")}
        actions={
          <Button
            icon={<Download className="size-4" />}
            onClick={() =>
              downloadText(
                `outstanding-${today}.csv`,
                toCsv(rows, [
                  { header: "Invoice", value: (r) => r.number },
                  { header: "Date", value: (r) => r.issue_date },
                  { header: "Due", value: (r) => r.due_date },
                  { header: "Customer", value: (r) => r.customer_name },
                  { header: "Phone", value: (r) => r.customer_phone },
                  { header: "Vehicle", value: (r) => formatPlate(r) },
                  { header: "Total", value: (r) => Number(r.total) - Number(r.credited) },
                  { header: "Paid", value: (r) => Number(r.paid) - Number(r.refunded) },
                  { header: "Balance", value: (r) => r.balance },
                  { header: "Days overdue", value: (r) => r.days_overdue },
                ]),
              )
            }
          >
            {t("Export CSV")}
          </Button>
        }
      />
      {q.data && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t("Total outstanding")} value={formatMoney(sum(all), lang)} sub={tn(all.length, "{n} invoice", "{n} invoices")} />
          <Stat label={t("Overdue")} value={formatMoney(sum(overdue), lang)} tone={overdue.length ? "bad" : undefined} sub={tn(overdue.length, "{n} invoice", "{n} invoices")} />
          <Stat label={t("Not yet due")} value={formatMoney(sum(all) - sum(overdue), lang)} />
          <Stat label={t("Large amounts")} value={all.filter((i) => Number(i.balance) >= Number(org.large_amount_threshold)).length} sub={t("Balance ≥ {amount}", { amount: formatMoney(org.large_amount_threshold, lang) })} />
        </div>
      )}
      <Chips
        className="mb-4"
        label={t("Filter")}
        value={filter}
        onChange={(v) => navigate({ search: { filter: v === "all" ? undefined : v } })}
        options={[
          { value: "all", label: t("All") },
          { value: "today", label: t("Issued today") },
          { value: "week", label: t("This week") },
          { value: "month", label: t("This month") },
          { value: "overdue", label: t("Overdue") },
          { value: "large", label: t("Large amounts") },
        ]}
      />
      <Card padded={false}>
        {q.isPending && <Loading />}
        {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} className="m-4" />}
        {q.isSuccess && rows.length === 0 && (
          <EmptyState icon={<AlarmClock className="size-6" />} title={all.length === 0 ? t("Nothing outstanding. Every issued invoice is paid.") : t("No outstanding invoice matches this filter.")} />
        )}
        {rows.length > 0 && (
          <TableWrap>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={th}>{t("Invoice")}</th>
                  <th className={th}>{t("Customer")}</th>
                  <th className={`${th} hidden xl:table-cell`}>{t("Vehicle")}</th>
                  <th className={`${th} hidden text-end lg:table-cell`}>{t("Total")}</th>
                  <th className={`${th} hidden text-end lg:table-cell`}>{t("Paid")}</th>
                  <th className={`${th} text-end`}>{t("Balance")}</th>
                  <th className={th}>{t("Days overdue")}</th>
                  <th className={th}>{t("Follow-up")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => {
                  const last = lastReminder(i.id);
                  const msg = reminderMessage({ garage: org.name, customer: i.customer_name, number: i.number ?? "", date: i.issue_date, balance: Number(i.balance), daysOverdue: i.days_overdue, phone: org.phone });
                  return (
                    <tr key={i.id} className={trClass}>
                      <td className={td}>
                        <Link to="/invoices/$id" params={{ id: i.id }} className="font-medium text-brand hover:underline">
                          {i.number}
                        </Link>
                        <div className="text-xs text-muted">{formatDate(i.issue_date, lang)}</div>
                      </td>
                      <td className={`${td} max-w-44`}>
                        <span className="block truncate">{i.customer_name}</span>
                        <span className="block truncate text-xs text-muted">{i.customer_phone}</span>
                      </td>
                      <td className={`${td} hidden xl:table-cell`}>{formatPlate(i, lang)}</td>
                      <td className={`${td} hidden text-end lg:table-cell`}>
                        <Money value={Number(i.total) - Number(i.credited)} />
                      </td>
                      <td className={`${td} hidden text-end lg:table-cell`}>
                        <Money value={Number(i.paid) - Number(i.refunded)} />
                      </td>
                      <td className={`${td} text-end`}>
                        <Money value={i.balance} strong />
                      </td>
                      <td className={td}>{i.days_overdue > 0 ? <span className="font-semibold text-bad num">{i.days_overdue}</span> : <StatusBadge map={INVOICE_STATUS} status={i.display_status} />}</td>
                      <td className={td}>
                        <div className="flex flex-wrap gap-1.5">
                          {can("payments.record") && (
                            <Button size="sm" variant="success" icon={<CreditCard className="size-3.5" />} onClick={() => setPayTarget({ kind: "payment", invoice_id: i.id, label: t("Invoice {number}", { number: i.number ?? "" }), max: Number(i.balance), suggested: Number(i.balance), customer: { id: i.customer_id, name: i.customer_name, phone: i.customer_phone, whatsapp: i.customer_whatsapp, email: i.customer_email } })}>
                              {t("Pay")}
                            </Button>
                          )}
                          <SendButtons size="sm" ctx={{ purpose: "invoice_reminder", message: msg, phone: i.customer_whatsapp ?? i.customer_phone, email: i.customer_email, refs: { customer_id: i.customer_id, invoice_id: i.id } }} />
                        </div>
                        {last && <p className="mt-1 text-xs text-muted">{t("Last sent {when}", { when: formatDateTime(last.created_at, lang) })}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      <p className="mt-3 text-xs text-muted">{t("Reminders open WhatsApp or your email app with a prepared message. Automatic sending (WhatsApp Business, SMS) is not connected yet.")}</p>
      {payTarget && <PaymentDialog open target={payTarget} onClose={() => setPayTarget(null)} />}
    </div>
  );
}
