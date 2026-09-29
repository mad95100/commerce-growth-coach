import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import clsx from "clsx";
import { Clock, Plus, Search, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { useOrg, useSession } from "@/app/session.tsx";
import { ButtonLink } from "@/components/ui/button.tsx";
import { Badge, EmptyState, ErrorState, Loading, StatusBadge } from "@/components/ui/feedback.tsx";
import { Chips, Input } from "@/components/ui/form.tsx";
import { NotAllowed, PageHeader } from "@/components/ui/layout.tsx";
import { formatDateTime } from "@/lib/dates.ts";
import { t, useLang } from "@/lib/i18n.tsx";
import { formatPlate } from "@/lib/plates.ts";
import { JOB_STATUS } from "@/lib/status.ts";
import { supabase } from "@/lib/supabase.ts";
import type { JobCardRow } from "@/api/types.ts";

const FILTERS = ["active", "open", "in_progress", "waiting_parts", "ready", "delayed", "delivered", "cancelled", "all"] as const;
type Filter = (typeof FILTERS)[number];

export const Route = createFileRoute("/_app/job-cards/")({
  component: JobCards,
  validateSearch: (s: Record<string, unknown>): { filter?: Filter } => ({ filter: FILTERS.includes(s.filter as Filter) ? (s.filter as Filter) : undefined }),
});

const ACTIVE = ["open", "in_progress", "waiting_parts", "ready"];

function JobCards() {
  const org = useOrg();
  const { can, branchId } = useSession();
  const { lang } = useLang();
  const navigate = useNavigate({ from: Route.fullPath });
  const filter = Route.useSearch().filter ?? "active";
  const [text, setText] = useState("");
  const allowed = can("job_cards.view") || can("job_cards.progress");
  const q = useQuery({
    queryKey: ["job-cards", org.id, branchId],
    enabled: allowed,
    queryFn: async () => {
      let r = supabase.from("v_job_cards").select("*").eq("org_id", org.id);
      if (branchId) r = r.eq("branch_id", branchId);
      const { data, error } = await r.order("received_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data as JobCardRow[];
    },
  });
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: q.data?.length ?? 0, active: 0, delayed: 0 };
    for (const j of q.data ?? []) {
      c[j.status] = (c[j.status] ?? 0) + 1;
      if (ACTIVE.includes(j.status)) c.active++;
      if (j.is_delayed) c.delayed++;
    }
    return c;
  }, [q.data]);
  const rows = useMemo(() => {
    const s = text.trim().toLowerCase();
    return (q.data ?? []).filter((j) => {
      if (filter === "active" && !ACTIVE.includes(j.status)) return false;
      if (filter === "delayed" && !j.is_delayed) return false;
      if (!["active", "delayed", "all"].includes(filter) && j.status !== filter) return false;
      if (!s) return true;
      return [j.number, j.customer_name, j.plate_number, j.make, j.model, j.technician_name, j.vin].some((x) => (x ?? "").toLowerCase().includes(s));
    });
  }, [q.data, filter, text]);

  if (!allowed) return <NotAllowed />;
  return (
    <div>
      <PageHeader
        title={t("Job cards")}
        subtitle={!can("job_cards.view") ? t("The job cards assigned to you.") : t("Vehicles in the workshop and their progress.")}
        actions={can("job_cards.manage") && <ButtonLink to="/job-cards/new" variant="primary" icon={<Plus className="size-4" />}>{t("New Job Card")}</ButtonLink>}
      />
      <div className="mb-4 space-y-3">
        <Chips
          label={t("Status")}
          value={filter}
          onChange={(v) => navigate({ search: { filter: v === "active" ? undefined : v } })}
          options={FILTERS.map((f) => ({
            value: f,
            label: f === "active" ? t("In the workshop") : f === "delayed" ? t("Delayed") : f === "all" ? t("All") : t(JOB_STATUS[f].label),
            count: q.isSuccess ? (counts[f] ?? 0) : undefined,
          }))}
        />
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <Input aria-label={t("Search job cards")} placeholder={t("Number, customer, plate, mechanic…")} value={text} onChange={(e) => setText(e.target.value)} className="ps-9" />
        </div>
      </div>
      {q.isPending && <Loading />}
      {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {q.isSuccess && rows.length === 0 && (
        <div className="rounded-xl border border-line bg-surface">
          <EmptyState
            icon={<Wrench className="size-6" />}
            title={q.data.length === 0 ? t("No job card yet") : t("No job card matches these filters")}
            text={q.data.length === 0 ? t("Open a job card when a vehicle enters the workshop, or convert an approved estimate.") : undefined}
          />
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {rows.map((j) => (
          <Link key={j.id} to="/job-cards/$id" params={{ id: j.id }} className={clsx("block min-w-0 rounded-xl border bg-surface p-4 hover:border-line-strong", j.is_delayed ? "border-bad/40" : "border-line")}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold">{formatPlate(j, lang) || j.vin}</p>
                <p className="truncate text-sm text-ink-2">{[j.make, j.model, j.vehicle_year].filter(Boolean).join(" ")}</p>
              </div>
              <StatusBadge map={JOB_STATUS} status={j.status} />
            </div>
            <p className="mt-2 line-clamp-2 text-sm text-muted">{j.complaint ?? t("No complaint recorded.")}</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              <span className="font-medium text-ink-2">{j.number}</span>
              <span className="truncate">{j.customer_name}</span>
              <span>{j.technician_name ?? t("Not assigned")}</span>
              {j.promised_at && (
                <span className={clsx("inline-flex items-center gap-1", j.is_delayed && "font-semibold text-bad")}>
                  <Clock className="size-3" aria-hidden />
                  {formatDateTime(j.promised_at, lang)}
                </span>
              )}
              {j.invoice_id && <Badge tone="brand">{t("Invoiced")}</Badge>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
