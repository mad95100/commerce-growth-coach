import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus, ReceiptText, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useOrg, useSession } from "@/app/session.tsx";
import { ButtonLink } from "@/components/ui/button.tsx";
import { EmptyState, ErrorState, Loading, StatusBadge } from "@/components/ui/feedback.tsx";
import { Chips, Input } from "@/components/ui/form.tsx";
import { Card, NotAllowed, PageHeader, TableWrap, tableClass, td, th, trClass } from "@/components/ui/layout.tsx";
import { Money } from "@/components/ui/money.tsx";
import { formatDate } from "@/lib/dates.ts";
import { t, useLang } from "@/lib/i18n.tsx";
import { formatPlate } from "@/lib/plates.ts";
import { ESTIMATE_STATUS } from "@/lib/status.ts";
import { supabase } from "@/lib/supabase.ts";
import type { EstimateRow } from "@/api/types.ts";

const FILTERS = ["all", "waiting", "approved", "converted", "rejected", "expired"] as const;
type Filter = (typeof FILTERS)[number];

export const Route = createFileRoute("/_app/estimates/")({
  component: Estimates,
  validateSearch: (s: Record<string, unknown>): { status?: Filter } => ({ status: FILTERS.includes(s.status as Filter) ? (s.status as Filter) : undefined }),
});

function Estimates() {
  const org = useOrg();
  const { can, branchId } = useSession();
  const { lang } = useLang();
  const navigate = useNavigate({ from: Route.fullPath });
  const status = Route.useSearch().status ?? "all";
  const [text, setText] = useState("");
  const q = useQuery({
    queryKey: ["estimates", org.id, branchId],
    enabled: can("estimates.view"),
    queryFn: async () => {
      let r = supabase.from("v_estimates").select("*").eq("org_id", org.id);
      if (branchId) r = r.eq("branch_id", branchId);
      const { data, error } = await r.order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data as EstimateRow[];
    },
  });
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: q.data?.length ?? 0 };
    for (const e of q.data ?? []) {
      const k = ["draft", "sent", "pending"].includes(e.display_status) ? "waiting" : e.display_status;
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [q.data]);
  const rows = useMemo(() => {
    const s = text.trim().toLowerCase();
    return (q.data ?? []).filter((e) => {
      const k = ["draft", "sent", "pending"].includes(e.display_status) ? "waiting" : e.display_status;
      if (status !== "all" && k !== status) return false;
      if (!s) return true;
      return [e.number, e.customer_name, e.plate_number, e.make, e.model].some((x) => (x ?? "").toLowerCase().includes(s));
    });
  }, [q.data, status, text]);

  if (!can("estimates.view")) return <NotAllowed />;
  return (
    <div>
      <PageHeader title={t("Estimates")} actions={can("estimates.manage") && <ButtonLink to="/estimates/new" variant="primary" icon={<Plus className="size-4" />}>{t("New Estimate")}</ButtonLink>} />
      <div className="mb-4 space-y-3">
        <Chips
          label={t("Status")}
          value={status}
          onChange={(v) => navigate({ search: { status: v === "all" ? undefined : v } })}
          options={FILTERS.map((f) => ({ value: f, label: f === "all" ? t("All") : f === "waiting" ? t("Waiting for answer") : t(ESTIMATE_STATUS[f].label), count: q.isSuccess ? (counts[f] ?? 0) : undefined }))}
        />
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <Input aria-label={t("Search estimates")} placeholder={t("Number, customer, plate…")} value={text} onChange={(e) => setText(e.target.value)} className="ps-9" />
        </div>
      </div>
      <Card padded={false}>
        {q.isPending && <Loading />}
        {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} className="m-4" />}
        {q.isSuccess && rows.length === 0 && (
          <EmptyState
            icon={<ReceiptText className="size-6" />}
            title={q.data.length === 0 ? t("No estimate yet") : t("No estimate matches these filters")}
            text={q.data.length === 0 ? t("Quote the work before starting it. An approved estimate becomes a job card, then an invoice, without typing anything twice.") : undefined}
            action={q.data.length === 0 && can("estimates.manage") && <ButtonLink to="/estimates/new" variant="primary" icon={<Plus className="size-4" />}>{t("New Estimate")}</ButtonLink>}
          />
        )}
        {rows.length > 0 && (
          <TableWrap>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={th}>{t("Estimate")}</th>
                  <th className={th}>{t("Customer")}</th>
                  <th className={`${th} hidden md:table-cell`}>{t("Vehicle")}</th>
                  <th className={`${th} hidden lg:table-cell`}>{t("Valid until")}</th>
                  <th className={`${th} text-end`}>{t("Total")}</th>
                  <th className={th}>{t("Status")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className={trClass}>
                    <td className={td}>
                      <Link to="/estimates/$id" params={{ id: e.id }} className="font-medium text-brand hover:underline">
                        {e.number}
                      </Link>
                      <div className="text-xs text-muted">{formatDate(e.issue_date, lang)}</div>
                    </td>
                    <td className={`${td} max-w-44`}>
                      <span className="block truncate">{e.customer_name}</span>
                    </td>
                    <td className={`${td} hidden md:table-cell`}>
                      {formatPlate(e, lang)}
                      <div className="text-xs text-muted">{[e.make, e.model].filter(Boolean).join(" ")}</div>
                    </td>
                    <td className={`${td} hidden lg:table-cell`}>{formatDate(e.valid_until, lang)}</td>
                    <td className={`${td} text-end`}>
                      <Money value={e.total} />
                    </td>
                    <td className={td}>
                      <StatusBadge map={ESTIMATE_STATUS} status={e.display_status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
