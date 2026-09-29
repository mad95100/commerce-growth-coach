import { useQuery } from "@tanstack/react-query";
import { useOrg, useSession } from "@/app/session.tsx";
import { ErrorState, Loading } from "@/components/ui/feedback.tsx";
import { Card, CardTitle } from "@/components/ui/layout.tsx";
import { auditLabel } from "@/lib/audit.ts";
import { formatDateTime } from "@/lib/dates.ts";
import { t, useLang } from "@/lib/i18n.tsx";
import { supabase } from "@/lib/supabase.ts";
import type { AuditRow } from "@/api/types.ts";

/** Who did what and when on one record (audit log excerpt). */
export function ActivityCard({ entityIds }: { entityIds: string[] }) {
  const org = useOrg();
  const { can } = useSession();
  const { lang } = useLang();
  const q = useQuery({
    queryKey: ["audit", "entity", entityIds],
    enabled: can("audit.view") && entityIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("audit_log").select("*").eq("org_id", org.id).in("entity_id", entityIds).order("created_at", { ascending: false }).limit(30);
      if (error) throw error;
      return data as AuditRow[];
    },
  });
  if (!can("audit.view")) return null;
  return (
    <Card>
      <CardTitle>{t("Activity")}</CardTitle>
      {q.isPending && <Loading />}
      {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && <p className="text-sm text-muted">{t("No activity recorded.")}</p>}
      {q.data && q.data.length > 0 && (
        <ol className="space-y-3">
          {q.data.map((a) => (
            <li key={a.id} className="text-sm">
              <p className="font-medium">{auditLabel(a.action)}</p>
              <p className="text-xs text-muted">
                {a.actor_name} · {formatDateTime(a.created_at, lang)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
