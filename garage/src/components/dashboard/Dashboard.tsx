import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlarmClock, CalendarDays, Car, ClipboardList, FileText, PackageX, Plus, ReceiptText, Wrench } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useOrg, useSession } from "@/app/session.tsx";
import { BarList, monthLabel, RevenueChart, shortDay } from "@/components/charts/charts.tsx";
import { ButtonLink } from "@/components/ui/button.tsx";
import { EmptyState, ErrorState, Loading, StatusBadge } from "@/components/ui/feedback.tsx";
import { Chips } from "@/components/ui/form.tsx";
import { Card, CardTitle, PageHeader, Stat, TableWrap, tableClass, td, th, trClass } from "@/components/ui/layout.tsx";
import { Money } from "@/components/ui/money.tsx";
import { formatDate } from "@/lib/dates.ts";
import { t, useLang } from "@/lib/i18n.tsx";
import { formatMoney } from "@/lib/money.ts";
import { formatPlate } from "@/lib/plates.ts";
import { toWeeks } from "@/lib/series.ts";
import { INVOICE_STATUS, JOB_STATUS, LINE_KINDS } from "@/lib/status.ts";
import { rpc, supabase } from "@/lib/supabase.ts";
import type { InvoiceRow, JobCardRow } from "@/api/types.ts";

interface Report {
  invoiced: number;
  collected: number;
  net_sales: number;
  invoices: { count: number; average: number; total: number };
  by_kind: Record<string, number>;
  payments_by_method: Array<{ method: string; total: number; count: number }>;
}
interface Summary {
  today: string;
  workshop: number;
  ready_for_pickup: number;
  delayed: number;
  appointments_today: number;
  estimates_waiting: number;
  estimates_approved: number;
  low_stock: number;
  invoices_today?: number;
  invoices_month?: number;
  drafts?: number;
  unpaid_count?: number;
  overdue_count?: number;
  paid_count_month?: number;
  today_report?: Report;
  month_report?: Report;
  last30?: Array<{ day: string; invoiced: number; collected: number }>;
  last12m?: Array<{ month: string; invoiced: number; collected: number }>;
  outstanding?: { total: number; count: number; overdue_total: number; overdue_count: number; aging: Record<string, number> };
}

export function Dashboard() {
  const org = useOrg();
  const { can, branchId, displayName } = useSession();
  const { lang } = useLang();
  const [range, setRange] = useState<"day" | "week" | "month">("day");

  const q = useQuery({
    queryKey: ["dashboard", org.id, branchId],
    queryFn: () => rpc<Summary>("dashboard_summary", { p_org: org.id, p_branch: branchId }),
    refetchInterval: 60_000,
  });
  const recent = useQuery({
    queryKey: ["invoices", "recent", org.id, branchId],
    enabled: can("invoices.view"),
    queryFn: async () => {
      let r = supabase.from("v_invoices").select("*").eq("org_id", org.id).neq("status", "draft").order("issued_at", { ascending: false }).limit(8);
      if (branchId) r = r.eq("branch_id", branchId);
      const { data, error } = await r;
      if (error) throw error;
      return data as InvoiceRow[];
    },
  });
  const myJobs = useQuery({
    queryKey: ["job-cards", "mine", org.id],
    enabled: !can("job_cards.view") && can("job_cards.progress"),
    queryFn: async () => {
      const { data, error } = await supabase.from("v_job_cards").select("*").eq("org_id", org.id).in("status", ["open", "in_progress", "waiting_parts", "ready"]).order("received_at");
      if (error) throw error;
      return data as JobCardRow[];
    },
  });

  const series = useMemo(() => {
    const s = q.data;
    if (!s?.last30) return [];
    if (range === "day") return s.last30.map((d) => ({ label: d.day, invoiced: Number(d.invoiced), collected: Number(d.collected) }));
    if (range === "week") return toWeeks(s.last30).map((w) => ({ label: w.week, invoiced: w.invoiced, collected: w.collected }));
    return (s.last12m ?? []).map((m) => ({ label: m.month, invoiced: Number(m.invoiced), collected: Number(m.collected) }));
  }, [q.data, range]);

  const fin = can("finance.view");
  const s = q.data;

  const attention: Array<{ n: number; text: string; to: string; search?: Record<string, string>; icon: ReactNode; tone: "bad" | "warn" | "info" }> = s
    ? [
        { n: s.overdue_count ?? 0, text: t("overdue invoices"), to: "/outstanding", search: { filter: "overdue" } as Record<string, string>, icon: <AlarmClock className="size-4" />, tone: "bad" as const },
        { n: s.estimates_waiting, text: t("estimates waiting for an answer"), to: "/estimates", search: { status: "waiting" } as Record<string, string>, icon: <ReceiptText className="size-4" />, tone: "warn" as const },
        { n: s.estimates_approved, text: t("approved estimates to start"), to: "/estimates", search: { status: "approved" } as Record<string, string>, icon: <ReceiptText className="size-4" />, tone: "info" as const },
        { n: s.low_stock, text: t("parts at or below minimum stock"), to: "/stock", search: { filter: "low" } as Record<string, string>, icon: <PackageX className="size-4" />, tone: "warn" as const },
        { n: s.delayed, text: t("vehicles past their promised time"), to: "/job-cards", search: { filter: "delayed" } as Record<string, string>, icon: <Car className="size-4" />, tone: "bad" as const },
        { n: s.ready_for_pickup, text: t("vehicles ready for pickup"), to: "/job-cards", search: { filter: "ready" } as Record<string, string>, icon: <Car className="size-4" />, tone: "info" as const },
        { n: s.drafts ?? 0, text: t("draft invoices not issued"), to: "/invoices", search: { status: "draft" } as Record<string, string>, icon: <FileText className="size-4" />, tone: "info" as const },
      ].filter((a) => a.n > 0 && (a.to !== "/stock" || can("stock.view")) && (a.to !== "/estimates" || can("estimates.view")))
    : [];

  return (
    <div>
      <PageHeader
        title={org.name}
        subtitle={s ? `${formatDate(s.today, lang)} · ${t("Welcome, {name}", { name: displayName })}` : undefined}
        actions={
          <>
            {can("invoices.create") && (
              <ButtonLink to="/invoices/new" variant="primary" icon={<Plus className="size-4" />}>
                {t("New Invoice")}
              </ButtonLink>
            )}
            {can("estimates.manage") && (
              <ButtonLink to="/estimates/new" icon={<Plus className="size-4" />}>
                {t("New Estimate")}
              </ButtonLink>
            )}
            {can("job_cards.manage") && (
              <ButtonLink to="/job-cards/new" icon={<Wrench className="size-4" />}>
                {t("New Job Card")}
              </ButtonLink>
            )}
          </>
        }
      />
      {q.isPending && <Loading />}
      {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {s && (
        <div className="space-y-5">
          {fin && s.today_report && s.month_report && s.outstanding ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
              <Stat label={t("Today's revenue")} value={formatMoney(s.today_report.invoiced, lang)} sub={t("Collected {amount}", { amount: formatMoney(s.today_report.collected, lang) })} to="/reports" search={{ period: "today" }} />
              <Stat label={t("This month")} value={formatMoney(s.month_report.invoiced, lang)} sub={t("Collected {amount}", { amount: formatMoney(s.month_report.collected, lang) })} to="/reports" search={{ period: "month" }} />
              <Stat label={t("Outstanding")} value={formatMoney(s.outstanding.total, lang)} tone={s.outstanding.overdue_total > 0 ? "bad" : undefined} sub={t("{n} unpaid · {m} overdue", { n: s.outstanding.count, m: s.outstanding.overdue_count })} to="/outstanding" />
              <Stat label={t("Invoices today")} value={s.invoices_today ?? 0} sub={t("{n} this month", { n: s.invoices_month ?? 0 })} to="/invoices" />
              <Stat label={t("Average invoice")} value={formatMoney(s.month_report.invoices.average, lang)} sub={t("This month")} />
              <Stat label={t("Pending estimates")} value={s.estimates_waiting} sub={t("{n} vehicles in workshop", { n: s.workshop })} to="/estimates" search={{ status: "waiting" }} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label={t("Vehicles in workshop")} value={s.workshop} to="/job-cards" />
              <Stat label={t("Ready for pickup")} value={s.ready_for_pickup} to="/job-cards" search={{ filter: "ready" }} />
              <Stat label={t("Delayed")} value={s.delayed} tone={s.delayed ? "bad" : undefined} to="/job-cards" search={{ filter: "delayed" }} />
              <Stat label={t("Appointments today")} value={s.appointments_today} to="/appointments" />
            </div>
          )}

          <div className="grid gap-5 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              {fin && s.month_report ? (
                <>
                  <CardTitle
                    action={
                      <Chips
                        size="sm"
                        label={t("Chart period")}
                        value={range}
                        onChange={setRange}
                        options={[
                          { value: "day", label: t("30 days") },
                          { value: "week", label: t("Weeks") },
                          { value: "month", label: t("12 months") },
                        ]}
                      />
                    }
                  >
                    {t("Revenue")}
                  </CardTitle>
                  <RevenueChart data={series} xFormat={(l) => (range === "month" ? monthLabel(l, lang) : shortDay(l, lang))} />
                  <p className="mt-2 text-xs text-muted">{t("Invoiced: issued invoices minus credit notes, VAT included. Collected: payments and deposits received minus refunds.")}</p>
                </>
              ) : (
                <>
                  <CardTitle>{t("My job cards")}</CardTitle>
                  {myJobs.isPending && can("job_cards.progress") && !can("job_cards.view") ? <Loading /> : null}
                  {myJobs.isError && <ErrorState error={myJobs.error} retry={() => myJobs.refetch()} />}
                  {myJobs.data && myJobs.data.length === 0 && <EmptyState title={t("No job card assigned to you right now.")} />}
                  {myJobs.data && myJobs.data.length > 0 && (
                    <ul className="divide-y divide-line">
                      {myJobs.data.map((j) => (
                        <li key={j.id}>
                          <Link to="/job-cards/$id" params={{ id: j.id }} className="flex min-h-14 items-center justify-between gap-3 py-2 hover:bg-canvas">
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium">{[j.make, j.model].filter(Boolean).join(" ")} · {formatPlate(j, lang)}</span>
                              <span className="block truncate text-xs text-muted">{j.number} · {j.complaint}</span>
                            </span>
                            <StatusBadge map={JOB_STATUS} status={j.status} />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  {can("job_cards.view") && <p className="text-sm text-muted">{t("Open the job cards page to see the workshop.")}</p>}
                </>
              )}
            </Card>

            <Card>
              <CardTitle>{t("Needs attention")}</CardTitle>
              {attention.length === 0 ? (
                <EmptyState icon={<ClipboardList className="size-6" />} title={t("Nothing needs attention right now.")} className="py-6" />
              ) : (
                <ul className="space-y-1">
                  {attention.map((a) => (
                    <li key={a.text}>
                      <Link to={a.to} search={a.search} className="flex min-h-12 items-center gap-3 rounded-lg px-2 hover:bg-canvas">
                        <span className={a.tone === "bad" ? "text-bad" : a.tone === "warn" ? "text-warn" : "text-info"}>{a.icon}</span>
                        <span className="text-sm">
                          <span className="font-semibold num">{a.n}</span> {a.text}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {s.appointments_today > 0 && (
                <Link to="/appointments" className="mt-3 flex min-h-11 items-center gap-2 rounded-lg bg-canvas px-3 text-sm">
                  <CalendarDays className="size-4 text-brand" /> {t("{n} appointments today", { n: s.appointments_today })}
                </Link>
              )}
            </Card>
          </div>

          {fin && s.month_report && s.outstanding && (
            <div className="grid gap-5 md:grid-cols-3">
              <Card>
                <CardTitle>{t("Parts vs labor — this month")}</CardTitle>
                <BarList
                  items={Object.entries(s.month_report.by_kind)
                    .filter(([, v]) => Number(v) !== 0)
                    .map(([k, v]) => ({ label: t(LINE_KINDS[k] ?? k), value: Number(v) }))
                    .sort((a, b) => b.value - a.value)}
                />
                <p className="mt-3 text-xs text-muted">{t("Net amounts, excluding VAT.")}</p>
              </Card>
              <Card>
                <CardTitle>{t("Payments — this month")}</CardTitle>
                <BarList items={s.month_report.payments_by_method.map((m) => ({ label: m.method, value: Number(m.total), sub: t("{n} payments", { n: m.count }) }))} />
              </Card>
              <Card>
                <CardTitle>{t("Unpaid by age")}</CardTitle>
                <BarList
                  empty={t("No unpaid invoice.")}
                  items={
                    s.outstanding.total > 0
                      ? [
                          { label: t("Not yet due"), value: Number(s.outstanding.aging.current) },
                          { label: t("1–30 days late"), value: Number(s.outstanding.aging.d1_30) },
                          { label: t("31–60 days late"), value: Number(s.outstanding.aging.d31_60) },
                          { label: t("61–90 days late"), value: Number(s.outstanding.aging.d61_90) },
                          { label: t("Over 90 days late"), value: Number(s.outstanding.aging.d90_plus) },
                        ]
                      : []
                  }
                />
              </Card>
            </div>
          )}

          {can("invoices.view") && (
            <Card padded={false}>
              <div className="p-4 pb-0 sm:p-5 sm:pb-0">
                <CardTitle action={<Link to="/invoices" className="text-sm font-medium text-brand hover:underline">{t("All invoices")}</Link>}>{t("Recent invoices")}</CardTitle>
              </div>
              {recent.isPending && <Loading />}
              {recent.isError && <ErrorState error={recent.error} retry={() => recent.refetch()} className="m-4" />}
              {recent.data && recent.data.length === 0 && (
                <EmptyState
                  title={t("No invoice yet")}
                  text={t("Your issued invoices will appear here.")}
                  action={can("invoices.create") && <ButtonLink to="/invoices/new" variant="primary" icon={<Plus className="size-4" />}>{t("New Invoice")}</ButtonLink>}
                />
              )}
              {recent.data && recent.data.length > 0 && (
                <TableWrap>
                  <table className={tableClass}>
                    <thead>
                      <tr>
                        <th className={th}>{t("Invoice")}</th>
                        <th className={th}>{t("Customer")}</th>
                        <th className={`${th} hidden md:table-cell`}>{t("Vehicle")}</th>
                        <th className={`${th} text-end`}>{t("Amount")}</th>
                        <th className={th}>{t("Status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recent.data.map((i) => (
                        <tr key={i.id} className={trClass}>
                          <td className={td}>
                            <Link to="/invoices/$id" params={{ id: i.id }} className="font-medium text-brand hover:underline">
                              {i.number}
                            </Link>
                            <div className="text-xs text-muted">{formatDate(i.issue_date, lang)}</div>
                          </td>
                          <td className={`${td} max-w-48 truncate`}>{i.customer_name}</td>
                          <td className={`${td} hidden md:table-cell`}>{formatPlate(i, lang)}</td>
                          <td className={`${td} text-end`}>
                            <Money value={i.total} />
                          </td>
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
        </div>
      )}
    </div>
  );
}
