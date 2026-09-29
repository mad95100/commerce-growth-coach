import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Download, Wallet } from "lucide-react";
import { useOrg, useSession } from "@/app/session.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge, EmptyState, ErrorState, Loading } from "@/components/ui/feedback.tsx";
import { Chips, Input } from "@/components/ui/form.tsx";
import { Card, NotAllowed, PageHeader, TableWrap, tableClass, td, th, trClass } from "@/components/ui/layout.tsx";
import { Money } from "@/components/ui/money.tsx";
import { toCsv } from "@/lib/csv.ts";
import { formatDateTime } from "@/lib/dates.ts";
import { downloadText } from "@/lib/download.ts";
import { t, useLang } from "@/lib/i18n.tsx";
import { supabase } from "@/lib/supabase.ts";
import type { PaymentRow } from "@/api/types.ts";

type Kind = "all" | "payment" | "deposit" | "refund" | "void";
export const Route = createFileRoute("/_app/payments/")({
  component: Payments,
  validateSearch: (s: Record<string, unknown>): { kind?: Kind; from?: string; to?: string } => ({
    kind: ["payment", "deposit", "refund", "void"].includes(s.kind as string) ? (s.kind as Kind) : undefined,
    from: typeof s.from === "string" ? s.from : undefined,
    to: typeof s.to === "string" ? s.to : undefined,
  }),
});

function Payments() {
  const org = useOrg();
  const { can, branchId } = useSession();
  const { lang } = useLang();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const kind = search.kind ?? "all";

  const build = () => {
    let q = supabase.from("v_payments").select("*").eq("org_id", org.id);
    if (branchId) q = q.eq("branch_id", branchId);
    if (kind === "void") q = q.not("voided_at", "is", null);
    else if (kind !== "all") q = q.eq("kind", kind).is("voided_at", null);
    if (search.from) q = q.gte("paid_at", `${search.from}T00:00:00+04:00`);
    if (search.to) q = q.lte("paid_at", `${search.to}T23:59:59+04:00`);
    return q.order("paid_at", { ascending: false });
  };
  const list = useInfiniteQuery({
    queryKey: ["payments", org.id, branchId, search],
    enabled: can("invoices.view"),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await build().range(pageParam, pageParam + 49);
      if (error) throw error;
      return data as PaymentRow[];
    },
    getNextPageParam: (last, all) => (last.length === 50 ? all.length * 50 : undefined),
  });
  if (!can("invoices.view")) return <NotAllowed />;
  const rows = list.data?.pages.flat() ?? [];

  async function exportCsv() {
    const { data, error } = await build().limit(5000);
    if (error) return;
    downloadText(
      `payments-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(data as PaymentRow[], [
        { header: "Receipt", value: (r) => r.number },
        { header: "Date", value: (r) => r.paid_at },
        { header: "Type", value: (r) => r.kind },
        { header: "Customer", value: (r) => r.customer_name },
        { header: "Invoice", value: (r) => r.invoice_number },
        { header: "Method", value: (r) => r.method_name },
        { header: "Reference", value: (r) => r.reference },
        { header: "Amount", value: (r) => (r.kind === "refund" ? -r.amount : r.amount) },
        { header: "Received by", value: (r) => r.received_by_name },
        { header: "Voided", value: (r) => (r.voided_at ? `yes: ${r.void_reason}` : "") },
      ]),
    );
  }

  return (
    <div>
      <PageHeader title={t("Payments")} subtitle={t("Every payment, deposit and refund, with its receipt.")} actions={<Button onClick={exportCsv} icon={<Download className="size-4" />}>{t("Export CSV")}</Button>} />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Chips
          label={t("Type")}
          value={kind}
          onChange={(v) => navigate({ search: (s) => ({ ...s, kind: v === "all" ? undefined : v }) })}
          options={[
            { value: "all", label: t("All") },
            { value: "payment", label: t("Payments") },
            { value: "deposit", label: t("Deposits") },
            { value: "refund", label: t("Refunds") },
            { value: "void", label: t("Voided") },
          ]}
        />
        <div className="flex gap-2">
          <Input type="date" aria-label={t("From")} value={search.from ?? ""} onChange={(e) => navigate({ search: (s) => ({ ...s, from: e.target.value || undefined }) })} />
          <Input type="date" aria-label={t("To")} value={search.to ?? ""} onChange={(e) => navigate({ search: (s) => ({ ...s, to: e.target.value || undefined }) })} />
        </div>
      </div>
      <Card padded={false}>
        {list.isPending && <Loading />}
        {list.isError && <ErrorState error={list.error} retry={() => list.refetch()} className="m-4" />}
        {list.isSuccess && rows.length === 0 && <EmptyState icon={<Wallet className="size-6" />} title={t("No payment for these filters")} />}
        {rows.length > 0 && (
          <TableWrap>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={th}>{t("Receipt")}</th>
                  <th className={th}>{t("Customer")}</th>
                  <th className={`${th} hidden md:table-cell`}>{t("For")}</th>
                  <th className={`${th} hidden sm:table-cell`}>{t("Method")}</th>
                  <th className={`${th} text-end`}>{t("Amount")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className={trClass}>
                    <td className={td}>
                      <Link to="/payments/$id" params={{ id: p.id }} className="font-medium text-brand hover:underline">
                        {p.number}
                      </Link>{" "}
                      {p.kind !== "payment" && <Badge tone={p.kind === "refund" ? "refund" : "info"}>{p.kind === "refund" ? t("Refund") : t("Deposit")}</Badge>}
                      {p.voided_at && <Badge tone="muted">{t("Void")}</Badge>}
                      <div className="text-xs text-muted">{formatDateTime(p.paid_at, lang)}</div>
                    </td>
                    <td className={`${td} max-w-44`}>
                      <span className="block truncate">{p.customer_name}</span>
                    </td>
                    <td className={`${td} hidden md:table-cell`}>
                      {p.invoice_id ? (
                        <Link to="/invoices/$id" params={{ id: p.invoice_id }} className="text-brand hover:underline">
                          {p.invoice_number ?? t("Draft invoice")}
                        </Link>
                      ) : p.job_card_id ? (
                        <Link to="/job-cards/$id" params={{ id: p.job_card_id }} className="text-brand hover:underline">
                          {p.job_card_number}
                        </Link>
                      ) : p.estimate_id ? (
                        <Link to="/estimates/$id" params={{ id: p.estimate_id }} className="text-brand hover:underline">
                          {p.estimate_number}
                        </Link>
                      ) : null}
                    </td>
                    <td className={`${td} hidden sm:table-cell`}>
                      {p.method_name}
                      {p.reference && <div className="text-xs text-muted">{p.reference}</div>}
                    </td>
                    <td className={`${td} text-end`}>
                      <Money value={p.kind === "refund" ? -p.amount : p.amount} className={p.voided_at ? "text-faint line-through" : ""} />
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
