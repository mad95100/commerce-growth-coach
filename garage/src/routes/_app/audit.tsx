import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { History } from "lucide-react";
import { useState } from "react";
import { useOrg, useSession } from "@/app/session.tsx";
import { Button } from "@/components/ui/button.tsx";
import { EmptyState, ErrorState, Loading } from "@/components/ui/feedback.tsx";
import { Input, Select } from "@/components/ui/form.tsx";
import { Card, NotAllowed, PageHeader, TableWrap, tableClass, td, th, trClass } from "@/components/ui/layout.tsx";
import { auditLabel } from "@/lib/audit.ts";
import { AUDIT_AREAS } from "@/lib/labels.ts";
import { formatDateTime } from "@/lib/dates.ts";
import { t, useLang } from "@/lib/i18n.tsx";
import { supabase } from "@/lib/supabase.ts";
import type { AuditRow } from "@/api/types.ts";

export const Route = createFileRoute("/_app/audit")({ component: Audit });


function details(d: Record<string, unknown>): string {
  return Object.entries(d)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => {
      if (v && typeof v === "object" && "from" in (v as object)) {
        const x = v as { from: unknown; to: unknown };
        return `${k}: ${JSON.stringify(x.from)} → ${JSON.stringify(x.to)}`;
      }
      return `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`;
    })
    .join(" · ");
}

function Audit() {
  const org = useOrg();
  const { can } = useSession();
  const { lang } = useLang();
  const [area, setArea] = useState("");
  const [day, setDay] = useState("");
  const q = useInfiniteQuery({
    queryKey: ["audit", org.id, area, day],
    enabled: can("audit.view"),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      let r = supabase.from("audit_log").select("*").eq("org_id", org.id);
      if (area === "settings") r = r.in("entity_type", ["settings", "organization", "tax_rate", "document_sequence", "invitation"]);
      else if (area) r = r.eq("entity_type", area);
      if (day) r = r.gte("created_at", `${day}T00:00:00+04:00`).lte("created_at", `${day}T23:59:59+04:00`);
      const { data, error } = await r.order("id", { ascending: false }).range(pageParam, pageParam + 99);
      if (error) throw error;
      return data as AuditRow[];
    },
    getNextPageParam: (last, all) => (last.length === 100 ? all.length * 100 : undefined),
  });
  if (!can("audit.view")) return <NotAllowed />;
  const rows = q.data?.pages.flat() ?? [];
  return (
    <div>
      <PageHeader title={t("Audit log")} subtitle={t("Who did what, and when. Entries cannot be edited or deleted.")} />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Select aria-label={t("Area")} value={area} onChange={(e) => setArea(e.target.value)} className="sm:max-w-56">
          {AUDIT_AREAS.map(([v, l]) => (
            <option key={v} value={v}>
              {t(l)}
            </option>
          ))}
        </Select>
        <Input type="date" aria-label={t("Day")} value={day} onChange={(e) => setDay(e.target.value)} className="sm:max-w-48" />
      </div>
      <Card padded={false}>
        {q.isPending && <Loading />}
        {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} className="m-4" />}
        {q.isSuccess && rows.length === 0 && <EmptyState icon={<History className="size-6" />} title={t("No activity for these filters")} />}
        {rows.length > 0 && (
          <TableWrap>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={th}>{t("When")}</th>
                  <th className={th}>{t("Who")}</th>
                  <th className={th}>{t("What")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className={trClass}>
                    <td className={`${td} whitespace-nowrap`}>{formatDateTime(a.created_at, lang)}</td>
                    <td className={`${td} whitespace-nowrap`}>{a.actor_name}</td>
                    <td className={td}>
                      <span className="font-medium">{auditLabel(a.action)}</span>
                      {a.summary && <span className="text-ink-2"> · {a.summary}</span>}
                      {Object.keys(a.details ?? {}).length > 0 && <p className="mt-0.5 max-w-2xl break-words text-xs text-muted">{details(a.details)}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {q.hasNextPage && (
          <div className="border-t border-line p-3 text-center">
            <Button onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>
              {t("Load more")}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
