import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Car, Check, Pencil, Phone, Plus, Search, User } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useOrg, useSession } from "@/app/session.tsx";
import { CustomerDialog } from "@/components/forms/CustomerForm.tsx";
import { VehicleDialog } from "@/components/forms/VehicleForm.tsx";
import { Button } from "@/components/ui/button.tsx";
import { ErrorState, Spinner } from "@/components/ui/feedback.tsx";
import { t, useLang } from "@/lib/i18n.tsx";
import { formatPhone } from "@/lib/phone.ts";
import { formatPlate } from "@/lib/plates.ts";
import { parseSearch } from "@/lib/search.ts";
import { rpc, supabase } from "@/lib/supabase.ts";
import type { Customer, Vehicle } from "@/api/types.ts";

interface SearchHit {
  customers: Array<{ id: string; display_name: string; phone: string | null; vehicles: number }>;
  vehicles: Array<{ id: string; customer_id: string; customer_name: string; plate_emirate: string; plate_code: string; plate_number: string; make: string; model: string; year: number }>;
}

function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const id = setTimeout(() => setD(v), ms);
    return () => clearTimeout(id);
  }, [v, ms]);
  return d;
}

export function useCustomer(id: string | null) {
  return useQuery({
    queryKey: ["customer", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("*").eq("id", id!).single();
      if (error) throw error;
      return data as Customer;
    },
  });
}

export function useCustomerVehicles(customerId: string | null) {
  return useQuery({
    queryKey: ["vehicles", "of", customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase.from("vehicles").select("*").eq("customer_id", customerId!).is("archived_at", null).order("created_at");
      if (error) throw error;
      return data as Vehicle[];
    },
  });
}

/**
 * Step 1 and 2 of every document: who is the customer, which vehicle.
 * One search box finds a customer by name / phone / email or a vehicle by
 * plate / VIN; picking a vehicle picks its owner too. New customers and
 * vehicles are created inline, without leaving the document.
 */
export function PartyPicker({
  customerId,
  vehicleId,
  onChange,
  locked,
  vehicleRequired,
}: {
  customerId: string | null;
  vehicleId: string | null;
  onChange: (customerId: string | null, vehicleId: string | null) => void;
  locked?: boolean;
  vehicleRequired?: boolean;
}) {
  const org = useOrg();
  const { can } = useSession();
  const { lang } = useLang();
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const params = useMemo(() => parseSearch(dq), [dq]);
  const [newCustomer, setNewCustomer] = useState(false);
  const [vehicleDialog, setVehicleDialog] = useState<Vehicle | "new" | null>(null);
  const [editCustomer, setEditCustomer] = useState(false);

  const customer = useCustomer(customerId);
  const vehicles = useCustomerVehicles(customerId);

  const results = useQuery({
    queryKey: ["party-search", org.id, params],
    enabled: !!params && !customerId,
    queryFn: () =>
      rpc<SearchHit>("global_search", {
        p_org: org.id,
        p_text: params!.text,
        p_phone_key: params!.phoneKey,
        p_plate_key: params!.plate?.key ?? null,
        p_plate_number: params!.plate?.number ?? null,
        p_emirate: params!.plate?.emirate ?? null,
      }),
  });

  // Pre-select the only vehicle of a newly chosen customer (once: the user may
  // then deselect it for a counter sale).
  const autoFor = useRef<string | null>(customerId);
  useEffect(() => {
    if (customerId && autoFor.current !== customerId && !vehicleId && vehicles.data?.length === 1 && !locked) {
      autoFor.current = customerId;
      onChange(customerId, vehicles.data[0].id);
    }
  }, [customerId, vehicleId, vehicles.data, locked, onChange]);

  if (customerId) {
    const c = customer.data;
    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3 rounded-xl border border-line bg-canvas/60 p-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
              <User className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              {customer.isPending ? <Spinner /> : customer.isError ? <ErrorState error={customer.error} /> : (
                <>
                  <p className="truncate font-semibold">{c?.display_name}</p>
                  <p className="truncate text-sm text-muted">
                    {[formatPhone(c?.phone), c?.email, c?.trn ? `TRN ${c.trn}` : null].filter(Boolean).join(" · ") || t("No contact details")}
                  </p>
                </>
              )}
            </div>
          </div>
          {!locked && (
            <div className="flex shrink-0 gap-1">
              {can("customers.manage") && c && (
                <Button size="sm" variant="ghost" onClick={() => setEditCustomer(true)} icon={<Pencil className="size-4" />}>
                  <span className="sr-only sm:not-sr-only">{t("Edit")}</span>
                </Button>
              )}
              <Button size="sm" onClick={() => onChange(null, null)}>
                {t("Change")}
              </Button>
            </div>
          )}
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-ink-2">
            {t("Vehicle")}
            {vehicleRequired && <span className="text-bad"> *</span>}
          </p>
          {vehicles.isPending && <Spinner />}
          {vehicles.isError && <ErrorState error={vehicles.error} retry={() => vehicles.refetch()} />}
          {vehicles.data && (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {vehicles.data.map((v) => {
                const selected = v.id === vehicleId;
                return (
                  <button
                    key={v.id}
                    type="button"
                    disabled={locked}
                    aria-pressed={selected}
                    onClick={() => onChange(customerId, selected && !vehicleRequired ? null : v.id)}
                    className={clsx(
                      "flex min-h-14 items-center gap-3 rounded-xl border p-3 text-start transition-colors",
                      selected ? "border-brand bg-brand-soft ring-1 ring-brand" : "border-line-strong bg-surface hover:bg-canvas",
                      locked && !selected && "hidden",
                    )}
                  >
                    <Car className={clsx("size-5 shrink-0", selected ? "text-brand" : "text-muted")} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{formatPlate(v, lang) || v.vin}</span>
                      <span className="block truncate text-xs text-muted">{[v.make, v.model, v.year].filter(Boolean).join(" ") || t("Vehicle")}</span>
                    </span>
                    {selected && <Check className="size-4 text-brand" aria-hidden />}
                  </button>
                );
              })}
              {!locked && can("customers.manage") && (
                <button type="button" onClick={() => setVehicleDialog("new")} className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong p-3 text-sm font-medium text-brand hover:bg-brand-soft">
                  <Plus className="size-4" aria-hidden /> {t("Add vehicle")}
                </button>
              )}
            </div>
          )}
          {vehicles.data && vehicles.data.length === 0 && !can("customers.manage") && <p className="text-sm text-muted">{t("This customer has no vehicle.")}</p>}
        </div>

        {vehicleDialog && (
          <VehicleDialog
            open
            customerId={customerId}
            vehicle={vehicleDialog === "new" ? null : vehicleDialog}
            onClose={() => setVehicleDialog(null)}
            onSaved={async (v) => {
              setVehicleDialog(null);
              await vehicles.refetch();
              onChange(customerId, v.id);
            }}
          />
        )}
        {editCustomer && c && (
          <CustomerDialog
            open
            customer={c}
            onClose={() => setEditCustomer(false)}
            onSaved={async () => {
              setEditCustomer(false);
              await customer.refetch();
            }}
          />
        )}
      </div>
    );
  }

  const r = results.data;
  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-faint" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("Search customer: name, phone, plate, VIN…")}
            aria-label={t("Search customer")}
            autoFocus
            className="block min-h-12 w-full rounded-xl border border-line-strong bg-surface ps-11 pe-3 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
        </div>
        {can("customers.manage") && (
          <Button size="lg" onClick={() => setNewCustomer(true)} icon={<Plus className="size-4" />}>
            {t("New customer")}
          </Button>
        )}
      </div>
      <div className="mt-2">
        {params && results.isPending && (
          <div className="py-4">
            <Spinner />
          </div>
        )}
        {results.isError && <ErrorState error={results.error} retry={() => results.refetch()} />}
        {r && r.customers.length === 0 && r.vehicles.length === 0 && (
          <p className="py-4 text-sm text-muted">
            {t("No customer found.")}{" "}
            {can("customers.manage") && (
              <button type="button" className="font-medium text-brand hover:underline" onClick={() => setNewCustomer(true)}>
                {t("Create “{name}”", { name: q.trim() })}
              </button>
            )}
          </p>
        )}
        {r && (r.customers.length > 0 || r.vehicles.length > 0) && (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {r.vehicles.map((v) => (
              <li key={`v${v.id}`}>
                <button type="button" onClick={() => onChange(v.customer_id, v.id)} className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-start hover:bg-canvas">
                  <Car className="size-5 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{formatPlate(v, lang)} · {[v.make, v.model, v.year].filter(Boolean).join(" ")}</span>
                    <span className="block truncate text-xs text-muted">{v.customer_name}</span>
                  </span>
                </button>
              </li>
            ))}
            {r.customers.map((c) => (
              <li key={`c${c.id}`}>
                <button type="button" onClick={() => onChange(c.id, null)} className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-start hover:bg-canvas">
                  <User className="size-5 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{c.display_name}</span>
                    <span className="flex items-center gap-2 truncate text-xs text-muted">
                      {c.phone && (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="size-3" aria-hidden /> {formatPhone(c.phone)}
                        </span>
                      )}
                      <span>{t("{n} vehicles", { n: c.vehicles })}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {newCustomer && (
        <CustomerDialog
          open
          initialName={q.trim()}
          onClose={() => setNewCustomer(false)}
          onSaved={(c) => {
            setNewCustomer(false);
            onChange(c.id, null);
            if (can("customers.manage")) setVehicleDialog("new");
          }}
        />
      )}
    </div>
  );
}
