import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Download, FileText, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useOrg, useSession } from "@/app/session.tsx";
import { Button, ButtonLink } from "@/components/ui/button.tsx";
import { EmptyState, ErrorState, Loading, StatusBadge } from "@/components/ui/feedback.tsx";
import { Chips, Input } from "@/components/ui/form.tsx";
import { Card, NotAllowed, PageHeader, TableWrap, tableClass, td, th, trClass } from "@/components/ui/layout.tsx";
import { Money } from "@/components/ui/money.tsx";
import { toCsv } from "@/lib/csv.ts";
import { formatDate } from "@/lib/dates.ts";
import { downloadText } from "@/lib/download.ts";
import { t, useLang } from "@/lib/i18n.tsx";
import { formatPlate } from "@/lib/plates.ts";
import { INVOICE_STATUS } from "@/lib/status.ts";
import { supabase } from "@/lib/supabase.ts";
import type { InvoiceRow } from "@/api/types.ts";

const FILTERS = ["all", "draft", "unpaid", "partially_paid", "overdue", "paid", "sent", "refund_due", "cancelled"] as const;
type Filter = (typeof FILTERS)[number];

export const Route = createFileRoute("/_app/invoices/")({
  component: Invoices,
  validateSearch: (s: Record<string, unknown>): { status?: Filter; q?: string; from?: string; to?: string } => ({
    status: FILTERS.includes(s.status as Filter) ? (s.status as Filter) : undefined,
    q: typeof s.q === "string" ? s.q : undefined,
    from: typeof s.from === "string" ? s.from : undefined,
    to: typeof s.to === "string" ? s.to : undefined,
  }),
});

const PAGE = 50;

function applyFilters<Q extends { eq: (c: string, v: unknown) => Q; in: (c: string, v: unknown[]) => Q; or: (f: string) => Q; gte: (c: string, v: unknown) => Q; lte: (c: string, v: unknown) => Q }>(
  q: Q,
  f: { status?: Filter; q?: string; from?: string; to?: string; branch: string | null },
): Q {
  let r = q;
  if (f.branch) r = r.eq("branch_id", f.branch);
  if (f.status === "unpaid") r = r.in("display_status", ["unpaid", "sent"]);
  else if (f.status && f.status !== "all") r = r.eq("display_status", f.status);
  const text = (f.q ?? "").replace(/[,()%*\\]/g, " ").trim();
  if (text) r = r.or(`number.ilike.%${text}%,customer_name.ilike.%${text}%,plate_number.ilike.%${text}%`);
  if (f.from) r = r.gte("issue_date", f.from);
  if (f.to) r = r.lte("issue_date", f.to);
  return r;
}

function Invoices() {
  const org = useOrg();
  const { can, branchId } = useSession();
  const { lang } = useLang();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [text, setText] = useState(search.q ?? "");
  const status = search.status ?? "all";

  useEffect(() => {
    const id = setTimeout(() => {
      if ((search.q ?? "") !== text) navigate({ search: (s) => ({ ...s, q: text || undefined }), replace: true });
    }, 300);
    return () => clearTimeout(id);
  }, [text, search.q, navigate]);

  const filters = { ...search, branch: branchId };
  const list = useInfiniteQuery({
    queryKey: ["invoices", "list", org.id, filters],
    enabled: can("invoices.view"),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const q = applyFilters(supabase.from("v_invoices").select("*").eq("org_id", org.id), filters)
        .order("created_at", { ascending: false })
        .range(pageParam, pageParam + PAGE - 1);
      const { data, error } = await q;
      if (error) throw error;
      return data as InvoiceRow[];
    },
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
  });
  const counts = useQuery({
    queryKey: ["invoices", "counts", org.id, branchId],
    enabled: can("invoices.view"),
    queryFn: async () => {
      let q = supabase.from("v_invoices").select("display_status").eq("org_id", org.id);
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q;
      if (error) throw error;
      const c: Record<string, number> = { all: data.length };
      for (const r of data) c[r.display_status] = (c[r.display_status] ?? 0) + 1;
      c.unpaid = (c.unpaid ?? 0) + (c.sent ?? 0);
      return c;
    },
  });

  if (!can("invoices.view")) return <NotAllowed />;
  const rows = list.data?.pages.flat() ?? [];

  async function exportCsv() {
    const { data, error } = await applyFilters(supabase.from("v_invoices").select("*").eq("org_id", org.id), filters).order("issue_date", { ascending: false }).limit(5000);
    if (error) return;
    const csv = toCsv(data as InvoiceRow[], [
      { header: "Invoice", value: (r) => r.number ?? "Draft" },
      { header: "Date", value: (r) => r.issue_date },
      { header: "Due date", value: (r) => r.due_date },
      { header: "Status", value: (r) => INVOICE_STATUS[r.display_status]?.label ?? r.display_status },
      { header: "Customer", value: (r) => r.customer_name },
      { header: "Vehicle", value: (r) => formatPlate(r) },
      { header: "Subtotal", value: (r) => r.subtotal },
      { header: "Discount", value: (r) => r.doc_discount },
      { header: "VAT", value: (r) => r.vat_total },
      { header: "Total", value: (r) => r.total },
      { header: "Credited", value: (r) => r.credited },
      { header: "Paid", value: (r) => Number(r.paid) - Number(r.refunded) },
      { header: "Balance", value: (r) => r.balance },
    ]);
    downloadText(`invoices-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  return (
    <div>
      <PageHeader
        title={t("Invoices")}
        actions={
          <>
            <Button onClick={exportCsv} icon={<Download className="size-4" />}>
              {t("Export CSV")}
            </Button>
            {can("invoices.create") && (
              <ButtonLink to="/invoices/new" variant="primary" icon={<Plus className="size-4" />}>
                {t("New Invoice")}
              </ButtonLink>
            )}
          </>
        }
      />
      <div className="mb-4 space-y-3">
        <Chips
          label={t("Status")}
          value={status}
          onChange={(v) => navigate({ search: (s) => ({ ...s, status: v === "all" ? undefined : v }) })}
          options={FILTERS.map((f) => ({ value: f, label: f === "all" ? t("All") : t(INVOICE_STATUS[f].label), count: counts.data?.[f] ?? (counts.isSuccess ? 0 : undefined) }))}
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
            <Input aria-label={t("Search invoices")} placeholder={t("Invoice number, customer, plate…")} value={text} onChange={(e) => setText(e.target.value)} className="ps-9" />
          </div>
          <div className="flex gap-2">
            <Input type="date" aria-label={t("From")} value={search.from ?? ""} onChange={(e) => navigate({ search: (s) => ({ ...s, from: e.target.value || undefined }) })} />
            <Input type="date" aria-label={t("To")} value={search.to ?? ""} onChange={(e) => navigate({ search: (s) => ({ ...s, to: e.target.value || undefined }) })} />
          </div>
        </div>
      </div>
      <Card padded={false}>
        {list.isPending && <Loading />}
        {list.isError && <ErrorState error={list.error} retry={() => list.refetch()} className="m-4" />}
        {list.isSuccess && rows.length === 0 && (
          <EmptyState
            icon={<FileText className="size-6" />}
            title={status === "all" && !search.q ? t("No invoice yet") : t("No invoice matches these filters")}
            action={can("invoices.create") && status === "all" && !search.q && <ButtonLink to="/invoices/new" variant="primary" icon={<Plus className="size-4" />}>{t("New Invoice")}</ButtonLink>}
          />
        )}
        {rows.length > 0 && (
          <TableWrap>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={th}>{t("Invoice")}</th>
                  <th className={th}>{t("Customer")}</th>
                  <th className={`${th} hidden lg:table-cell`}>{t("Vehicle")}</th>
                  <th className={`${th} text-end`}>{t("Total")}</th>
                  <th className={`${th} hidden text-end md:table-cell`}>{t("Paid")}</th>
                  <th className={`${th} text-end`}>{t("Balance")}</th>
                  <th className={th}>{t("Status")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} className={trClass}>
                    <td className={td}>
                      <Link to="/invoices/$id" params={{ id: i.id }} className="font-medium text-brand hover:underline">
                        {i.number ?? t("Draft")}
                      </Link>
                      <div className="text-xs text-muted">{formatDate(i.issue_date ?? i.created_at.slice(0, 10), lang)}</div>
                    </td>
                    <td className={`${td} max-w-44`}>
                      <span className="block truncate">{i.customer_name}</span>
                    </td>
                    <td className={`${td} hidden lg:table-cell`}>
                      <span className="block truncate">{formatPlate(i, lang)}</span>
                      <span className="block truncate text-xs text-muted">{[i.make, i.model].filter(Boolean).join(" ")}</span>
                    </td>
                    <td className={`${td} text-end`}>
                      <Money value={i.total} />
                    </td>
                    <td className={`${td} hidden text-end md:table-cell`}>
                      <Money value={Number(i.paid) - Number(i.refunded)} />
                    </td>
                    <td className={`${td} text-end`}>{i.status === "cancelled" ? "—" : <Money value={i.balance} strong={Number(i.balance) > 0} />}</td>
                    <td className={td}>
                      <StatusBadge map={INVOICE_STATUS} status={i.display_status} />
                      {i.days_overdue > 0 && <div className="mt-0.5 text-xs text-bad">{t("{n} days late", { n: i.days_overdue })}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {list.hasNextPage && (
          <div className="border-t border-line p-3 text-center">
            <Button onClick={() => list.fetchNextPage()} loading={list.isFetchingNextPage}>
              {t("Load more")}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
