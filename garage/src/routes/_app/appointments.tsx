import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import clsx from "clsx";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useOrg, useRefData, useSession } from "@/app/session.tsx";
import { SendButtons } from "@/components/actions/SendButtons.tsx";
import { PartyPicker, useCustomer } from "@/components/pickers/PartyPicker.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { EmptyState, ErrorState, FormError, Loading, StatusBadge } from "@/components/ui/feedback.tsx";
import { Chips, Field, Input, Select, Textarea } from "@/components/ui/form.tsx";
import { Card, NotAllowed, PageHeader } from "@/components/ui/layout.tsx";
import { addDays, dubaiParts, dubaiTimestamp, formatDate, formatTime, todayISO, weekday } from "@/lib/dates.ts";
import { t, useLang } from "@/lib/i18n.tsx";
import { appointmentMessage } from "@/lib/messages.ts";
import { formatPlate } from "@/lib/plates.ts";
import { APPOINTMENT_STATUS } from "@/lib/status.ts";
import { supabase } from "@/lib/supabase.ts";
import type { Appointment } from "@/api/types.ts";

type View = "day" | "week" | "month";
export const Route = createFileRoute("/_app/appointments")({
  component: Appointments,
  validateSearch: (s: Record<string, unknown>): { view?: View; date?: string } => ({
    view: ["day", "week", "month"].includes(s.view as string) ? (s.view as View) : undefined,
    date: typeof s.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : undefined,
  }),
});

type Row = Appointment & {
  customers: { display_name: string; phone: string | null; whatsapp: string | null; email: string | null } | null;
  vehicles: { plate_emirate: string | null; plate_code: string | null; plate_number: string | null; make: string | null; model: string | null } | null;
  technicians: { name: string } | null;
};

function range(view: View, date: string): { from: string; to: string } {
  if (view === "day") return { from: date, to: addDays(date, 1) };
  if (view === "week") {
    const from = addDays(date, 1 - weekday(date));
    return { from, to: addDays(from, 7) };
  }
  const first = `${date.slice(0, 8)}01`;
  const from = addDays(first, 1 - weekday(first));
  return { from, to: addDays(from, 42) };
}

function Appointments() {
  const org = useOrg();
  const { can, branchId } = useSession();
  const { lang } = useLang();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const view = search.view ?? "week";
  const date = search.date ?? todayISO();
  const [editing, setEditing] = useState<Row | { new: string } | null>(null);
  const r = range(view, date);

  const q = useQuery({
    queryKey: ["appointments", org.id, branchId, r],
    enabled: can("appointments.view"),
    queryFn: async () => {
      let x = supabase
        .from("appointments")
        .select("*, customers(display_name, phone, whatsapp, email), vehicles(plate_emirate, plate_code, plate_number, make, model), technicians(name)")
        .eq("org_id", org.id)
        .gte("starts_at", `${r.from}T00:00:00+04:00`)
        .lt("starts_at", `${r.to}T00:00:00+04:00`);
      if (branchId) x = x.eq("branch_id", branchId);
      const { data, error } = await x.order("starts_at");
      if (error) throw error;
      return data as Row[];
    },
  });
  const byDay = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const a of q.data ?? []) {
      const d = dubaiParts(a.starts_at).date;
      m.set(d, [...(m.get(d) ?? []), a]);
    }
    return m;
  }, [q.data]);

  if (!can("appointments.view")) return <NotAllowed />;
  const step = view === "day" ? 1 : view === "week" ? 7 : 0;
  const move = (dir: 1 | -1) => {
    if (view === "month") {
      const [y, m] = date.split("-").map(Number);
      const d = new Date(Date.UTC(y, m - 1 + dir, 1)).toISOString().slice(0, 10);
      navigate({ search: { view, date: d } });
    } else navigate({ search: { view, date: addDays(date, dir * step) } });
  };
  const title =
    view === "day"
      ? formatDate(date, lang)
      : view === "week"
        ? `${formatDate(r.from, lang)} – ${formatDate(addDays(r.to, -1), lang)}`
        : new Intl.DateTimeFormat(lang === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date.slice(0, 8)}15T00:00:00Z`));

  const card = (a: Row) => (
    <button key={a.id} type="button" onClick={() => setEditing(a)} className={clsx("block w-full min-w-0 rounded-lg border px-2.5 py-2 text-start text-sm hover:border-line-strong", a.status === "cancelled" || a.status === "no_show" ? "border-line bg-canvas opacity-70" : "border-line bg-surface")}>
      <span className="flex items-center justify-between gap-2">
        <span className="font-semibold num">{formatTime(a.starts_at, lang)}</span>
        <StatusBadge map={APPOINTMENT_STATUS} status={a.status} />
      </span>
      <span className="mt-0.5 block truncate font-medium">{a.customers?.display_name ?? a.contact_name}</span>
      <span className="block truncate text-xs text-muted">{[a.vehicles ? formatPlate(a.vehicles, lang) : null, a.reason].filter(Boolean).join(" · ")}</span>
      {a.technicians && <span className="block truncate text-xs text-muted">{a.technicians.name}</span>}
    </button>
  );

  const days = Array.from({ length: view === "day" ? 1 : view === "week" ? 7 : 42 }, (_, i) => addDays(r.from, i));
  const today = todayISO();

  return (
    <div>
      <PageHeader title={t("Appointments")} actions={can("appointments.manage") && <Button variant="primary" onClick={() => setEditing({ new: view === "day" ? date : today })} icon={<Plus className="size-4" />}>{t("New appointment")}</Button>} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button size="md" variant="ghost" aria-label={t("Previous")} onClick={() => move(-1)} icon={<ChevronLeft className="size-5 rtl:rotate-180" />} />
          <Button size="md" onClick={() => navigate({ search: { view, date: today } })}>
            {t("Today")}
          </Button>
          <Button size="md" variant="ghost" aria-label={t("Next")} onClick={() => move(1)} icon={<ChevronRight className="size-5 rtl:rotate-180" />} />
          <h2 className="ms-2 text-base font-semibold">{title}</h2>
        </div>
        <Chips label={t("View")} value={view} onChange={(v) => navigate({ search: { view: v, date } })} options={[{ value: "day", label: t("Day") }, { value: "week", label: t("Week") }, { value: "month", label: t("Month") }]} />
      </div>
      {q.isPending && <Loading />}
      {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {q.isSuccess && view === "day" && (
        <Card>
          {(byDay.get(date) ?? []).length === 0 ? (
            <EmptyState icon={<CalendarDays className="size-6" />} title={t("No appointment on this day")} />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{(byDay.get(date) ?? []).map(card)}</div>
          )}
        </Card>
      )}
      {q.isSuccess && view === "week" && (
        <div className="grid gap-3 md:grid-cols-7">
          {days.map((d) => (
            <div key={d} className={clsx("min-w-0 rounded-xl border p-2", d === today ? "border-brand bg-brand-soft/40" : "border-line bg-surface")}>
              <button type="button" onClick={() => navigate({ search: { view: "day", date: d } })} className="mb-2 block w-full text-start text-xs font-semibold text-ink-2 hover:text-brand">
                {new Intl.DateTimeFormat(lang === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`))}
              </button>
              <div className="space-y-2">{(byDay.get(d) ?? []).map(card)}</div>
              {can("appointments.manage") && (
                <button type="button" onClick={() => setEditing({ new: d })} aria-label={t("New appointment")} className="mt-2 flex min-h-9 w-full items-center justify-center rounded-lg text-xs text-muted hover:bg-canvas">
                  <Plus className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {q.isSuccess && view === "month" && (
        <div className="grid grid-cols-7 gap-1 text-xs">
          {days.slice(0, 7).map((d) => (
            <div key={`h${d}`} className="px-1 pb-1 font-semibold text-muted">
              {new Intl.DateTimeFormat(lang === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`))}
            </div>
          ))}
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            const other = d.slice(0, 7) !== date.slice(0, 7);
            return (
              <button key={d} type="button" onClick={() => navigate({ search: { view: "day", date: d } })} className={clsx("flex min-h-16 min-w-0 flex-col items-start rounded-lg border p-1.5 text-start sm:min-h-24", d === today ? "border-brand" : "border-line", other ? "bg-canvas text-faint" : "bg-surface")}>
                <span className="font-semibold num">{Number(d.slice(8))}</span>
                {list.slice(0, 2).map((a) => (
                  <span key={a.id} className="hidden w-full truncate text-[11px] text-ink-2 sm:block">
                    {formatTime(a.starts_at, lang)} {a.customers?.display_name ?? a.contact_name}
                  </span>
                ))}
                {list.length > 0 && <span className="mt-auto rounded bg-brand-soft px-1 text-[11px] font-medium text-brand-ink sm:hidden">{list.length}</span>}
                {list.length > 2 && <span className="hidden text-[11px] text-muted sm:block">+{list.length - 2}</span>}
              </button>
            );
          })}
        </div>
      )}
      {editing && <AppointmentDialog value={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AppointmentDialog({ value, onClose }: { value: Row | { new: string }; onClose: () => void }) {
  const org = useOrg();
  const ref = useRefData();
  const { can, branchId } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const existing = "id" in value ? value : null;
  const start = existing ? dubaiParts(existing.starts_at) : { date: (value as { new: string }).new, time: "09:00" };
  const [f, setF] = useState({
    customer_id: existing?.customer_id ?? null,
    vehicle_id: existing?.vehicle_id ?? null,
    contact_name: existing?.contact_name ?? "",
    phone: existing?.phone ?? "",
    reason: existing?.reason ?? "",
    date: start.date,
    time: start.time,
    duration: String(existing?.duration_minutes ?? 60),
    technician_id: existing?.technician_id ?? "",
    status: existing?.status ?? "confirmed",
    notes: existing?.notes ?? "",
  });
  const [walkIn, setWalkIn] = useState(!!existing && !existing.customer_id);
  const [invalid, setInvalid] = useState<string | null>(null);
  const customer = useCustomer(f.customer_id);
  const manage = can("appointments.manage");
  const save = useMutation({
    mutationFn: async () => {
      const row = {
        customer_id: walkIn ? null : f.customer_id,
        vehicle_id: walkIn ? null : f.vehicle_id,
        contact_name: walkIn ? f.contact_name.trim() : null,
        phone: walkIn ? f.phone.trim() || null : null,
        reason: f.reason.trim(),
        starts_at: dubaiTimestamp(f.date, f.time),
        duration_minutes: Number(f.duration) || 60,
        technician_id: f.technician_id || null,
        status: f.status,
        notes: f.notes.trim() || null,
      };
      const r = existing ? await supabase.from("appointments").update(row).eq("id", existing.id) : await supabase.from("appointments").insert({ ...row, org_id: org.id, branch_id: branchId ?? ref.data?.branches.find((b) => b.is_default)?.id });
      if (r.error) throw r.error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries();
      onClose();
    },
  });
  function submit() {
    if (!walkIn && !f.customer_id) return setInvalid(t("Choose a customer, or switch to walk-in."));
    if (walkIn && !f.contact_name.trim()) return setInvalid(t("Enter the name of the person."));
    if (!f.reason.trim()) return setInvalid(t("Enter the reason for the visit."));
    if (!f.date || !f.time) return setInvalid(t("Choose the date and time."));
    setInvalid(null);
    save.mutate();
  }
  const phone = walkIn ? f.phone : (customer.data?.whatsapp ?? customer.data?.phone);
  return (
    <Dialog
      open
      onClose={onClose}
      title={existing ? t("Appointment") : t("New appointment")}
      size="lg"
      footer={
        manage ? (
          <>
            <Button onClick={onClose}>{t("Cancel")}</Button>
            <Button variant="primary" loading={save.isPending} onClick={submit}>
              {t("Save")}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{t("Close")}</Button>
        )
      }
    >
      <fieldset disabled={!manage} className="space-y-4">
        <Chips label={t("Customer type")} value={walkIn ? "walkin" : "customer"} onChange={(v) => setWalkIn(v === "walkin")} options={[{ value: "customer", label: t("Existing customer") }, { value: "walkin", label: t("New / walk-in") }]} />
        {walkIn ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Name")} required>{(id) => <Input id={id} value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} />}</Field>
            <Field label={t("Phone")}>{(id) => <Input id={id} type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
          </div>
        ) : (
          <PartyPicker customerId={f.customer_id} vehicleId={f.vehicle_id} onChange={(c, v) => setF((x) => ({ ...x, customer_id: c, vehicle_id: v }))} />
        )}
        <Field label={t("Reason")} required>{(id) => <Input id={id} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder={t("e.g. Oil service, AC not cooling")} />}</Field>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label={t("Date")}>{(id) => <Input id={id} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
          <Field label={t("Time")}>{(id) => <Input id={id} type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />}</Field>
          <Field label={t("Duration")}>
            {(id) => (
              <Select id={id} value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value })}>
                {[15, 30, 45, 60, 90, 120, 180, 240, 480].map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} min` : `${m / 60} h`}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("Status")}>
            {(id) => (
              <Select id={id} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                {Object.entries(APPOINTMENT_STATUS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {t(v.label)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label={t("Mechanic")}>
          {(id) => (
            <Select id={id} value={f.technician_id} onChange={(e) => setF({ ...f, technician_id: e.target.value })}>
              <option value="">{t("Not assigned")}</option>
              {(ref.data?.technicians ?? []).filter((x) => x.active).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("Notes")}>{(id) => <Textarea id={id} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
      </fieldset>
      {invalid && <p className="mt-3 text-sm text-bad">{invalid}</p>}
      <div className="mt-3">
        <FormError error={save.error} />
      </div>
      {existing && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
          <SendButtons
            ctx={{
              purpose: "appointment_reminder",
              message: appointmentMessage({ garage: org.name, customer: existing.customers?.display_name ?? existing.contact_name, startsAt: existing.starts_at, reason: existing.reason, address: org.address }),
              phone,
              email: existing.customers?.email,
              refs: { customer_id: existing.customer_id, appointment_id: existing.id },
            }}
          />
          {can("job_cards.manage") && existing.customer_id && existing.vehicle_id && (
            <Button onClick={() => navigate({ to: "/job-cards/new", search: { customer: existing.customer_id!, vehicle: existing.vehicle_id! } })}>{t("Open a job card")}</Button>
          )}
        </div>
      )}
    </Dialog>
  );
}
