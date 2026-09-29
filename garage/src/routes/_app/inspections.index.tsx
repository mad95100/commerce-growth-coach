import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ClipboardCheck } from "lucide-react";
import { useOrg, useSession } from "@/app/session.tsx";
import { Badge, EmptyState, ErrorState, Loading } from "@/components/ui/feedback.tsx";
import { Card, NotAllowed, PageHeader, TableWrap, tableClass, td, th, trClass } from "@/components/ui/layout.tsx";
import { formatDateTime } from "@/lib/dates.ts";
import { t, useLang } from "@/lib/i18n.tsx";
import { formatPlate } from "@/lib/plates.ts";
import { supabase } from "@/lib/supabase.ts";
import type { Inspection } from "@/api/documents2.ts";

export const Route = createFileRoute("/_app/inspections/")({ component: Inspections });

type Row = Inspection & {
  vehicles: { plate_emirate: string | null; plate_code: string | null; plate_number: string | null; make: string | null; model: string | null } | null;
  customers: { display_name: string } | null;
  inspection_items: Array<{ status: string | null }>;
};

function Inspections() {
  const org = useOrg();
  const { can, branchId } = useSession();
  const { lang } = useLang();
  const q = useQuery({
    queryKey: ["inspections", org.id, branchId],
    enabled: can("inspections.view"),
    queryFn: async () => {
      let r = supabase.from("inspections").select("*, vehicles(plate_emirate, plate_code, plate_number, make, model), customers(display_name), inspection_items(status)").eq("org_id", org.id);
      if (branchId) r = r.eq("branch_id", branchId);
      const { data, error } = await r.order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data as Row[];
    },
  });
  if (!can("inspections.view")) return <NotAllowed />;
  return (
    <div>
      <PageHeader title={t("Inspections")} subtitle={t("Start an inspection from a vehicle or a job card.")} />
      <Card padded={false}>
        {q.isPending && <Loading />}
        {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} className="m-4" />}
        {q.isSuccess && q.data.length === 0 && <EmptyState icon={<ClipboardCheck className="size-6" />} title={t("No inspection yet")} text={t("Open a vehicle or a job card and choose “Inspection”.")} />}
        {q.data && q.data.length > 0 && (
          <TableWrap>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={th}>{t("Date")}</th>
                  <th className={th}>{t("Vehicle")}</th>
                  <th className={`${th} hidden md:table-cell`}>{t("Customer")}</th>
                  <th className={th}>{t("Result")}</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((i) => {
                  const urgent = i.inspection_items.filter((x) => x.status === "urgent").length;
                  const attention = i.inspection_items.filter((x) => x.status === "attention").length;
                  return (
                    <tr key={i.id} className={trClass}>
                      <td className={td}>
                        <Link to="/inspections/$id" params={{ id: i.id }} className="font-medium text-brand hover:underline">
                          {formatDateTime(i.created_at, lang)}
                        </Link>
                      </td>
                      <td className={td}>
                        {i.vehicles ? formatPlate(i.vehicles, lang) : ""}
                        <div className="text-xs text-muted">{[i.vehicles?.make, i.vehicles?.model].filter(Boolean).join(" ")}</div>
                      </td>
                      <td className={`${td} hidden md:table-cell`}>{i.customers?.display_name}</td>
                      <td className={td}>
                        <span className="flex flex-wrap gap-1">
                          {i.status === "draft" && <Badge>{t("In progress")}</Badge>}
                          {urgent > 0 && <Badge tone="bad">{t("{n} urgent", { n: urgent })}</Badge>}
                          {attention > 0 && <Badge tone="warn">{t("{n} to watch", { n: attention })}</Badge>}
                          {i.status === "completed" && !urgent && !attention && <Badge tone="ok">{t("All OK")}</Badge>}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
