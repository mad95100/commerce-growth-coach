import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Download, Printer } from "lucide-react";
import { useOrg, useSession } from "@/app/session.tsx";
import { BarList, monthLabel, RevenueChart, shortDay } from "@/components/charts/charts.tsx";
import { Button } from "@/components/ui/button.tsx";
import { ErrorState, Loading } from "@/components/ui/feedback.tsx";
import { Chips, Input } from "@/components/ui/form.tsx";
import { Card, CardTitle, NotAllowed, PageHeader, Stat, TableWrap, tableClass, td, th, trClass } from "@/components/ui/layout.tsx";
import { Money } from "@/components/ui/money.tsx";
import { toCsv } from "@/lib/csv.ts";
import { formatDate, periodRange, todayISO, type PeriodKey } from "@/lib/dates.ts";
import { downloadText } from "@/lib/download.ts";
import { t, tn, useLang } from "@/lib/i18n.tsx";
import { formatMoney } from "@/lib/money.ts";
import { LINE_KINDS } from "@/lib/status.ts";
import { rpc } from "@/lib/supabase.ts";

const PERIODS: PeriodKey[] = ["today", "week", "month", "quarter", "year", "custom"];

export const Route = createFileRoute("/_app/reports")({
  component: Reports,
  validateSearch: (s: Record<string, unknown>): { period?: PeriodKey; from?: string; to?: string } => ({
    period: PERIODS.includes(s.period as PeriodKey) ? (s.period as PeriodKey) : undefined,
    from: typeof s.from === "string" ? s.from : undefined,
    to: typeof s.to === "string" ? s.to : undefined,
  }),
});

interface Report {
  invoices: { count: number; total: number; net: number; vat: number; discounts: number; average: number };
  credit_notes: { count: number; total: number; net: number; vat: number };
  invoiced: number;
  net_sales: number;
  vat_due: number;
  collected: number;
  refunds: { count: number; total: number };
  by_kind: Record<string, number>;
  payments_by_method: Array<{ method: string; count: number; total: number }>;
  by_technician: Array<{ name: string; net: number; labor_net: number | null; invoices: number }>;
  by_service: Array<{ name: string; quantity: number; net: number; lines: number }>;
  by_customer: Array<{ id: string; name: string; invoices: number; total: number }>;
  daily: Array<{ day: string; invoiced: number; collected: number }>;
  monthly: Array<{ month: string; invoiced: number; collected: number }>;
}

function Reports() {
  const org = useOrg();
  const { can, branchId } = useSession();
  const { lang } = useLang();
  const navigate = useNavigate({ from: Route.fullPath });
  const s = Route.useSearch();
  const period = s.period ?? "month";
  const today = todayISO();
  const r = period === "custom" ? { from: s.from ?? periodRange("month", today).from, to: s.to ?? today } : periodRange(period, today);
  const q = useQuery({
    queryKey: ["report", org.id, branchId, r],
    enabled: can("reports.view") && r.from <= r.to,
    queryFn: () => rpc<Report>("report_summary", { p_org: org.id, p_from: r.from, p_to: r.to, p_branch: branchId }),
  });
  const out = useQuery({
    queryKey: ["outstanding-summary", org.id, branchId],
    enabled: can("reports.view") && can("invoices.view"),
    queryFn: () => rpc<{ total: number; count: number; overdue_total: number; overdue_count: number }>("outstanding_summary", { p_org: org.id, p_branch: branchId }),
  });
  if (!can("reports.view")) return <NotAllowed />;
  const d = q.data;
  const days = Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86_400_000) + 1;
  const series = d ? (days > 62 ? d.monthly.map((m) => ({ label: m.month, invoiced: Number(m.invoiced), collected: Number(m.collected) })) : d.daily.map((x) => ({ label: x.day, invoiced: Number(x.invoiced), collected: Number(x.collected) }))) : [];
  const stamp = `${r.from}_${r.to}`;

  function exportSummary() {
    if (!d) return;
    const rows: Array<[string, string | number]> = [
      ["Period from", r.from],
      ["Period to", r.to],
      ["Invoices issued", d.invoices.count],
      ["Invoiced incl. VAT (after credit notes)", d.invoiced],
      ["Net sales excl. VAT", d.net_sales],
      ["VAT on sales (after credit notes)", d.vat_due],
      ["Average invoice", d.invoices.average],
      ["Discounts given", d.invoices.discounts],
      ["Credit notes", d.credit_notes.count],
      ["Credit notes total", d.credit_notes.total],
      ["Collected (payments + deposits - refunds)", d.collected],
      ["Refunds", d.refunds.total],
      ...Object.entries(d.by_kind).map(([k, v]) => [`Net ${LINE_KINDS[k] ?? k}`, v] as [string, number]),
      ...d.payments_by_method.map((m) => [`Collected by ${m.method}`, m.total] as [string, number]),
    ];
    downloadText(`report-${stamp}.csv`, toCsv(rows, [{ header: "Measure", value: (x) => x[0] }, { header: "Value", value: (x) => x[1] }]));
  }

  return (
    <div>
      <PageHeader
        title={t("Reports")}
        subtitle={`${formatDate(r.from, lang)} – ${formatDate(r.to, lang)}`}
        actions={
          <>
            <Button onClick={exportSummary} disabled={!d} icon={<Download className="size-4" />}>
              {t("Export CSV")}
            </Button>
            <Button onClick={() => window.print()} disabled={!d} icon={<Printer className="size-4" />}>
              {t("Print / PDF")}
            </Button>
          </>
        }
      />
      <div className="no-print mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
        <Chips
          label={t("Period")}
          value={period}
          onChange={(v) => navigate({ search: (x) => ({ ...x, period: v }) })}
          options={[
            { value: "today", label: t("Today") },
            { value: "week", label: t("This week") },
            { value: "month", label: t("This month") },
            { value: "quarter", label: t("This quarter") },
            { value: "year", label: t("This year") },
            { value: "custom", label: t("Custom range") },
          ]}
        />
        {period === "custom" && (
          <div className="flex gap-2">
            <Input type="date" aria-label={t("From")} value={r.from} onChange={(e) => navigate({ search: (x) => ({ ...x, from: e.target.value }) })} />
            <Input type="date" aria-label={t("To")} value={r.to} onChange={(e) => navigate({ search: (x) => ({ ...x, to: e.target.value }) })} />
          </div>
        )}
      </div>
      {r.from > r.to && <p className="text-sm text-bad">{t("The start date is after the end date.")}</p>}
      {q.isPending && r.from <= r.to && <Loading />}
      {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {d && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={t("Invoiced")} value={formatMoney(d.invoiced, lang)} sub={t("{n} invoices · incl. VAT", { n: d.invoices.count })} />
            <Stat label={t("Net sales")} value={formatMoney(d.net_sales, lang)} sub={t("Excluding VAT")} />
            <Stat label={t("Collected")} value={formatMoney(d.collected, lang)} sub={t("Payments − refunds")} />
            <Stat label={t("Average invoice")} value={formatMoney(d.invoices.average, lang)} />
            <Stat label={t("VAT on sales")} value={formatMoney(d.vat_due, lang)} sub={t("After credit notes")} />
            <Stat label={t("Credit notes")} value={formatMoney(d.credit_notes.total, lang)} sub={tn(d.credit_notes.count, "{n} credit note", "{n} credit notes")} />
            <Stat label={t("Refunds")} value={formatMoney(d.refunds.total, lang)} sub={tn(d.refunds.count, "{n} refund", "{n} refunds")} />
            <Stat label={t("Outstanding now")} value={out.data ? formatMoney(out.data.total, lang) : "—"} tone={out.data && out.data.overdue_total > 0 ? "bad" : undefined} sub={out.data ? t("{n} overdue", { n: out.data.overdue_count }) : undefined} to="/outstanding" />
          </div>
          <Card>
            <CardTitle>{days > 62 ? t("Monthly revenue") : t("Daily revenue")}</CardTitle>
            <RevenueChart data={series} xFormat={(l) => (days > 62 ? monthLabel(l, lang) : shortDay(l, lang))} />
            <p className="mt-2 text-xs text-muted">{t("Invoiced: issued invoices minus credit notes, VAT included. Collected: payments and deposits received minus refunds.")}</p>
          </Card>
          <div className="grid gap-5 md:grid-cols-2">
            <Card>
              <CardTitle>{t("Parts vs labor")}</CardTitle>
              <BarList items={Object.entries(d.by_kind).filter(([, v]) => Number(v) !== 0).map(([k, v]) => ({ label: t(LINE_KINDS[k] ?? k), value: Number(v) })).sort((a, b) => b.value - a.value)} />
              <p className="mt-3 text-xs text-muted">{t("Net amounts, excluding VAT.")}</p>
            </Card>
            <Card>
              <CardTitle>{t("Payments by method")}</CardTitle>
              <BarList items={d.payments_by_method.map((m) => ({ label: t(m.method), value: Number(m.total), sub: tn(m.count, "{n} payment", "{n} payments") }))} />
            </Card>
          </div>
          <TableCard
            title={t("Revenue per mechanic")}
            file={`mechanics-${stamp}.csv`}
            head={[t("Mechanic"), t("Invoices"), t("Labor & services"), t("Total net")]}
            rows={d.by_technician.map((x) => [x.name === "Unassigned" ? t("Unassigned") : x.name, x.invoices, Number(x.labor_net ?? 0), Number(x.net)])}
            money={[2, 3]}
            note={t("Lines are credited to the mechanic set on the line, otherwise to the job card's mechanic.")}
          />
          <TableCard title={t("Revenue per service")} file={`services-${stamp}.csv`} head={[t("Service / labor"), t("Lines"), t("Quantity"), t("Net")]} rows={d.by_service.map((x) => [x.name, x.lines, Number(x.quantity), Number(x.net)])} money={[3]} />
          <TableCard title={t("Revenue per customer")} file={`customers-${stamp}.csv`} head={[t("Customer"), t("Invoices"), t("Total incl. VAT")]} rows={d.by_customer.map((x) => [x.name, x.invoices, Number(x.total)])} money={[2]} />
        </div>
      )}
    </div>
  );
}

function TableCard({ title, head, rows, money, file, note }: { title: string; head: string[]; rows: Array<Array<string | number>>; money: number[]; file: string; note?: string }) {
  return (
    <Card padded={false}>
      <div className="flex items-center justify-between gap-3 p-4 pb-0 sm:p-5 sm:pb-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Button size="sm" className="no-print" disabled={rows.length === 0} onClick={() => downloadText(file, toCsv(rows, head.map((h, i) => ({ header: h, value: (r: Array<string | number>) => r[i] }))))} icon={<Download className="size-3.5" />}>
          CSV
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="p-5 text-sm text-muted">{t("No data for this period.")}</p>
      ) : (
        <TableWrap className="mt-2">
          <table className={tableClass}>
            <thead>
              <tr>
                {head.map((h, i) => (
                  <th key={h} className={`${th} ${i > 0 ? "text-end" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, k) => (
                <tr key={k} className={trClass}>
                  {r.map((c, i) => (
                    <td key={i} className={`${td} ${i > 0 ? "text-end num" : ""}`}>
                      {money.includes(i) ? <Money value={Number(c)} /> : c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {note && <p className="px-5 pb-4 text-xs text-muted">{note}</p>}
    </Card>
  );
}
