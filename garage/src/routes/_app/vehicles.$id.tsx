import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import clsx from "clsx";
import { ClipboardCheck, Pencil, Plus, ReceiptText, Wrench } from "lucide-react";
import { useState } from "react";
import { useOrg, useSession } from "@/app/session.tsx";
import { VehicleDialog } from "@/components/forms/VehicleForm.tsx";
import { Button, ButtonLink } from "@/components/ui/button.tsx";
import { EmptyState, ErrorState, FormError, Loading, StatusBadge } from "@/components/ui/feedback.tsx";
import { Card, CardTitle, DescriptionList, NotAllowed, PageHeader } from "@/components/ui/layout.tsx";
import { Money } from "@/components/ui/money.tsx";
import { formatDate } from "@/lib/dates.ts";
import { t, tn, useLang } from "@/lib/i18n.tsx";
import { FUEL, TRANSMISSION } from "@/lib/labels.ts";
import { formatPlate } from "@/lib/plates.ts";
import { ESTIMATE_STATUS, INVOICE_STATUS, JOB_STATUS } from "@/lib/status.ts";
import { rpc, supabase } from "@/lib/supabase.ts";
import type { Customer, Vehicle } from "@/api/types.ts";

export const Route = createFileRoute("/_app/vehicles/$id")({ component: VehiclePage });

interface HistoryItem {
  type: "invoice" | "job_card" | "estimate" | "inspection";
  id: string;
  number: string | null;
  status: string;
  date: string;
  total: number | null;
  mileage: number | null;
  description: string | null;
  technician: string | null;
  notes: string | null;
  invoice_id: string | null;
  lines: Array<{ kind: string; description: string; quantity: number; part_number: string | null; total: number }> | null;
}

function VehiclePage() {
  const { id } = Route.useParams();
  const org = useOrg();
  const { can } = useSession();
  const { lang } = useLang();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [edit, setEdit] = useState(false);
  const [kinds, setKinds] = useState<"work" | "all">("work");
  const q = useQuery({
    queryKey: ["vehicle", id],
    queryFn: async () => {
      const v = await supabase.from("vehicles").select("*").eq("id", id).maybeSingle();
      if (v.error) throw v.error;
      if (!v.data) throw { message: "bsg.not_found", details: "vehicle" };
      const [c, h] = await Promise.all([supabase.from("customers").select("*").eq("id", v.data.customer_id).maybeSingle(), rpc<HistoryItem[]>("vehicle_history", { p_vehicle: id })]);
      if (c.error) throw c.error;
      return { vehicle: v.data as Vehicle, customer: c.data as Customer, history: h };
    },
  });
  const inspect = useMutation({
    mutationFn: () => rpc<string>("create_inspection", { p: { org_id: org.id, vehicle_id: id } }),
    onSuccess: async (insId) => {
      await qc.invalidateQueries();
      navigate({ to: "/inspections/$id", params: { id: insId } });
    },
  });

  if (!can("customers.view")) return <NotAllowed />;
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const { vehicle: v, customer: c, history } = q.data;
  // "Work done" view: invoices, inspections, and job cards not invoiced yet
  // (an invoiced job card is already shown through its invoice).
  const shown = kinds === "all" ? history : history.filter((h) => h.type === "invoice" || h.type === "inspection" || (h.type === "job_card" && !h.invoice_id && h.status !== "cancelled"));
  const lastMileage = Math.max(v.mileage ?? 0, ...history.map((h) => Number(h.mileage ?? 0)));

  return (
    <div>
      <PageHeader
        back={{ to: "/vehicles", label: t("Vehicles") }}
        title={<span className="font-mono tracking-wide">{formatPlate(v, lang) || v.vin}</span>}
        subtitle={
          <>
            {[v.make, v.model, v.year, v.trim].filter(Boolean).join(" ")} ·{" "}
            <Link to="/customers/$id" params={{ id: c.id }} className="text-brand hover:underline">
              {c.display_name}
            </Link>
          </>
        }
        actions={
          <>
            {can("invoices.create") && (
              <ButtonLink to="/invoices/new" search={{ customer: c.id, vehicle: id }} variant="primary" icon={<Plus className="size-4" />}>
                {t("New Invoice")}
              </ButtonLink>
            )}
            {can("estimates.manage") && (
              <ButtonLink to="/estimates/new" search={{ customer: c.id, vehicle: id }} icon={<ReceiptText className="size-4" />}>
                {t("Estimate")}
              </ButtonLink>
            )}
            {can("job_cards.manage") && (
              <ButtonLink to="/job-cards/new" search={{ customer: c.id, vehicle: id }} icon={<Wrench className="size-4" />}>
                {t("Job card")}
              </ButtonLink>
            )}
            {can("inspections.manage") && (
              <Button loading={inspect.isPending} onClick={() => inspect.mutate()} icon={<ClipboardCheck className="size-4" />}>
                {t("Inspection")}
              </Button>
            )}
          </>
        }
      />
      {inspect.isError && <FormError error={inspect.error} />}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">{t("Service history")}</h2>
            <div className="flex gap-1 rounded-lg border border-line-strong bg-surface p-1 text-sm">
              {(["work", "all"] as const).map((k) => (
                <button key={k} type="button" onClick={() => setKinds(k)} aria-pressed={kinds === k} className={clsx("min-h-9 rounded-md px-3", kinds === k ? "bg-brand-soft font-medium text-brand-ink" : "text-muted")}>
                  {k === "work" ? t("Work done") : t("Everything")}
                </button>
              ))}
            </div>
          </div>
          {shown.length === 0 ? (
            <Card>
              <EmptyState icon={<Wrench className="size-6" />} title={t("No history yet for this vehicle")} text={t("Invoices, job cards, estimates and inspections of this vehicle appear here automatically.")} />
            </Card>
          ) : (
            <ol className="relative space-y-4 border-s-2 border-line ps-5">
              {shown.map((h) => {
                const to = h.type === "invoice" ? "/invoices/$id" : h.type === "job_card" ? "/job-cards/$id" : h.type === "estimate" ? "/estimates/$id" : "/inspections/$id";
                const label = h.type === "invoice" ? t("Invoice") : h.type === "job_card" ? t("Job card") : h.type === "estimate" ? t("Estimate") : t("Inspection");
                const map = h.type === "invoice" ? INVOICE_STATUS : h.type === "job_card" ? JOB_STATUS : ESTIMATE_STATUS;
                return (
                  <li key={`${h.type}${h.id}`} className="relative">
                    <span className={clsx("absolute -start-[27px] top-4 size-3 rounded-full border-2 border-surface", h.type === "invoice" ? "bg-brand" : "bg-faint")} aria-hidden />
                    <Card>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">{formatDate(h.date, lang)}</p>
                          <p className="text-xs text-muted">
                            <Link to={to} params={{ id: h.id }} className="font-medium text-brand hover:underline">
                              {label} {h.number}
                            </Link>
                            {h.mileage != null && ` · ${Number(h.mileage).toLocaleString("en")} km`}
                            {h.technician && ` · ${h.technician}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {h.type !== "inspection" && <StatusBadge map={map} status={h.status} />}
                          {h.total != null && (can("invoices.view") || h.type !== "invoice") && <Money value={h.total} strong />}
                        </div>
                      </div>
                      {h.description && <p className="mt-2 text-sm text-ink-2">{h.description}</p>}
                      {h.lines && h.lines.length > 0 && (
                        <ul className="mt-2 space-y-0.5 text-sm">
                          {h.lines.map((l, i) => (
                            <li key={i} className="flex justify-between gap-3">
                              <span className="min-w-0 truncate">
                                <span className="text-muted">{l.kind === "part" ? "▪" : "◦"}</span> {l.description}
                                {l.part_number && <span className="text-xs text-muted"> · {l.part_number}</span>}
                                {Number(l.quantity) !== 1 && <span className="text-xs text-muted"> × {Number(l.quantity)}</span>}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {h.notes && h.type === "job_card" && <p className="mt-2 text-xs text-muted">{t("Diagnosis")}: {h.notes}</p>}
                    </Card>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        <div className="min-w-0 space-y-5">
          <Card>
            <CardTitle action={can("customers.manage") && <Button size="sm" onClick={() => setEdit(true)} icon={<Pencil className="size-4" />}>{t("Edit")}</Button>}>{t("Vehicle")}</CardTitle>
            <DescriptionList
              className="sm:grid-cols-1"
              items={[
                [t("Plate"), formatPlate(v, lang)],
                [t("VIN"), v.vin],
                [t("Make / model"), [v.make, v.model].filter(Boolean).join(" ")],
                [t("Year"), v.year],
                [t("Trim"), v.trim],
                [t("Engine"), v.engine],
                [t("Fuel"), v.fuel ? t(FUEL[v.fuel] ?? v.fuel) : null],
                [t("Transmission"), v.transmission ? t(TRANSMISSION[v.transmission] ?? v.transmission) : null],
                [t("Color"), v.color],
                [t("Last known mileage"), lastMileage ? `${lastMileage.toLocaleString("en")} km` : null],
                [t("Registration date"), v.registration_date ? formatDate(v.registration_date, lang) : null],
                [t("Notes"), v.notes],
              ]}
            />
          </Card>
          {can("invoices.view") && (
            <Card>
              <CardTitle>{t("Spent on this vehicle")}</CardTitle>
              <p className="text-2xl font-semibold num">
                <Money value={history.filter((h) => h.type === "invoice").reduce((s, h) => s + Number(h.total ?? 0), 0)} />
              </p>
              <p className="text-xs text-muted">{tn(history.filter((h) => h.type === "invoice").length, "{n} invoice", "{n} invoices")}</p>
            </Card>
          )}
          <Card>
            <CardTitle>{t("Photos")}</CardTitle>
            <p className="text-sm text-muted">{t("Photo storage is not set up yet. It is planned with the storage module.")}</p>
          </Card>
        </div>
      </div>
      {edit && <VehicleDialog open customerId={c.id} vehicle={v} onClose={() => setEdit(false)} onSaved={async () => { setEdit(false); await qc.invalidateQueries(); }} />}
    </div>
  );
}
