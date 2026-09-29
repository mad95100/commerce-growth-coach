import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import clsx from "clsx";
import { CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useOrg, useSession } from "@/app/session.tsx";
import { SendButtons } from "@/components/actions/SendButtons.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge, ErrorState, FormError, Loading } from "@/components/ui/feedback.tsx";
import { Field, Textarea } from "@/components/ui/form.tsx";
import { Card, CardTitle, NotAllowed, PageHeader } from "@/components/ui/layout.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { fetchInspection, type InspectionItem } from "@/api/documents2.ts";
import { formatDateTime } from "@/lib/dates.ts";
import { t, useLang } from "@/lib/i18n.tsx";
import { inspectionMessage } from "@/lib/messages.ts";
import { formatPlate } from "@/lib/plates.ts";
import { INSPECTION_ITEM_STATUS } from "@/lib/status.ts";
import { supabase } from "@/lib/supabase.ts";

export const Route = createFileRoute("/_app/inspections/$id")({ component: InspectionPage });

const STATUSES = ["ok", "attention", "urgent"] as const;

function InspectionPage() {
  const { id } = Route.useParams();
  const org = useOrg();
  const { can } = useSession();
  const { lang } = useLang();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["inspection", id], queryFn: () => fetchInspection(id) });
  const [text, setText] = useState({ summary: "", recommendations: "" });
  const [comments, setComments] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.data) setText({ summary: q.data.ins.summary ?? "", recommendations: q.data.ins.recommendations ?? "" });
  }, [q.data]);

  const setItem = useMutation({
    mutationFn: async (p: { item: InspectionItem; patch: Partial<InspectionItem> }) => {
      const { error } = await supabase.from("inspection_items").update(p.patch).eq("id", p.item.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inspection", id] }),
  });
  const saveIns = useMutation({
    mutationFn: async (complete: boolean) => {
      const { error } = await supabase
        .from("inspections")
        .update({ summary: text.summary.trim() || null, recommendations: text.recommendations.trim() || null, ...(complete ? { status: "completed", completed_at: new Date().toISOString() } : {}) })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: async (_d, complete) => {
      await qc.invalidateQueries();
      toast(complete ? t("Inspection completed.") : t("Saved."));
    },
  });

  if (!can("inspections.view")) return <NotAllowed />;
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const { ins, items, vehicle, customer } = q.data;
  const manage = can("inspections.manage");
  const urgent = items.filter((i) => i.status === "urgent").map((i) => t(i.label));
  const attention = items.filter((i) => i.status === "attention").map((i) => t(i.label));
  const unchecked = items.filter((i) => !i.status).length;

  return (
    <div>
      <PageHeader
        back={{ to: "/inspections", label: t("Inspections") }}
        title={t("Inspection — {plate}", { plate: formatPlate(vehicle, lang) })}
        badge={ins.status === "completed" ? <Badge tone="ok">{t("Completed")}</Badge> : <Badge>{t("In progress")}</Badge>}
        subtitle={
          <>
            {[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ")} · {customer.display_name} · {formatDateTime(ins.created_at, lang)}
            {q.data.jobCardNumber && ins.job_card_id && (
              <>
                {" · "}
                <Link to="/job-cards/$id" params={{ id: ins.job_card_id }} className="text-brand hover:underline">
                  {q.data.jobCardNumber}
                </Link>
              </>
            )}
          </>
        }
        actions={
          <>
            <SendButtons ctx={{ purpose: "inspection", message: inspectionMessage({ garage: org.name, customer: customer.display_name, vehicle, urgent, attention, recommendations: ins.recommendations }), phone: customer.whatsapp ?? customer.phone, email: customer.email, refs: { customer_id: customer.id, inspection_id: id }, printHref: `/print/inspection/${id}` }} />
          </>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardTitle>{t("Checks")}</CardTitle>
          <ul className="divide-y divide-line">
            {items.map((i) => (
              <li key={i.id} className="py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="font-medium">{t(i.label)}</p>
                  <div role="radiogroup" aria-label={t(i.label)} className="flex gap-1.5">
                    {STATUSES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={i.status === s}
                        disabled={!manage}
                        onClick={() => setItem.mutate({ item: i, patch: { status: i.status === s ? null : s } })}
                        className={clsx(
                          "min-h-11 min-w-24 rounded-lg border px-3 text-sm font-medium",
                          i.status === s
                            ? s === "ok"
                              ? "border-ok bg-ok text-white"
                              : s === "attention"
                                ? "border-warn bg-warn text-white"
                                : "border-bad bg-bad text-white"
                            : "border-line-strong bg-surface text-ink-2 hover:bg-canvas",
                        )}
                      >
                        {t(INSPECTION_ITEM_STATUS[s].label)}
                      </button>
                    ))}
                  </div>
                </div>
                {(i.status === "attention" || i.status === "urgent" || i.comment) && (
                  <input
                    aria-label={t("Comment on {item}", { item: t(i.label) })}
                    disabled={!manage}
                    placeholder={t("Comment (what was found, measurement…)")}
                    className="mt-2 block min-h-10 w-full rounded-lg border border-line-strong px-3 text-sm"
                    value={comments[i.id] ?? i.comment ?? ""}
                    onChange={(e) => setComments({ ...comments, [i.id]: e.target.value })}
                    onBlur={() => comments[i.id] !== undefined && comments[i.id] !== (i.comment ?? "") && setItem.mutate({ item: i, patch: { comment: comments[i.id].trim() || null } })}
                  />
                )}
              </li>
            ))}
          </ul>
          <FormError error={setItem.error} />
        </Card>
        <div className="space-y-5">
          <Card>
            <CardTitle>{t("Summary")}</CardTitle>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {urgent.length > 0 && <Badge tone="bad">{t("{n} urgent", { n: urgent.length })}</Badge>}
              {attention.length > 0 && <Badge tone="warn">{t("{n} to watch", { n: attention.length })}</Badge>}
              {unchecked > 0 && <Badge>{t("{n} not checked", { n: unchecked })}</Badge>}
            </div>
            <div className="space-y-3">
              <Field label={t("Summary")}>{(fid) => <Textarea id={fid} disabled={!manage} value={text.summary} onChange={(e) => setText({ ...text, summary: e.target.value })} />}</Field>
              <Field label={t("Recommendations")}>{(fid) => <Textarea id={fid} disabled={!manage} value={text.recommendations} onChange={(e) => setText({ ...text, recommendations: e.target.value })} />}</Field>
            </div>
            <FormError error={saveIns.error} />
            {manage && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button loading={saveIns.isPending && saveIns.variables === false} onClick={() => saveIns.mutate(false)}>
                  {t("Save")}
                </Button>
                {ins.status === "draft" && (
                  <Button variant="primary" loading={saveIns.isPending && saveIns.variables === true} onClick={() => saveIns.mutate(true)} icon={<CheckCircle2 className="size-4" />}>
                    {t("Complete inspection")}
                  </Button>
                )}
              </div>
            )}
          </Card>
          <Card>
            <CardTitle>{t("Photos")}</CardTitle>
            <p className="text-sm text-muted">{t("Photo storage is not set up yet. It is planned with the storage module.")}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
