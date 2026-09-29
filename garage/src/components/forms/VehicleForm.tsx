import { useState, type FormEvent } from "react";
import { useOrg } from "@/app/session.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { Alert, FormError } from "@/components/ui/feedback.tsx";
import { Field, Input, Select, Textarea } from "@/components/ui/form.tsx";
import { t } from "@/lib/i18n.tsx";
import { EMIRATES, plateKey, validatePlate } from "@/lib/plates.ts";
import { supabase } from "@/lib/supabase.ts";
import type { Vehicle } from "@/api/types.ts";

const MAKES = ["Toyota", "Nissan", "Lexus", "Mitsubishi", "Honda", "Hyundai", "Kia", "Ford", "Chevrolet", "GMC", "Mercedes-Benz", "BMW", "Audi", "Volkswagen", "Land Rover", "Range Rover", "Porsche", "Mazda", "Infiniti", "Jeep", "Dodge", "Cadillac", "Tesla", "Suzuki", "Renault", "Peugeot", "MG", "Chery", "Geely", "Jetour"];
const blank = (v: string) => (v.trim() === "" ? null : v.trim());

export function VehicleDialog({
  open,
  onClose,
  customerId,
  vehicle,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  customerId: string;
  vehicle?: Vehicle | null;
  onSaved: (v: Vehicle) => void;
}) {
  const org = useOrg();
  const [f, setF] = useState({
    plate_emirate: vehicle?.plate_emirate ?? org.emirate ?? "DXB",
    plate_code: vehicle?.plate_code ?? "",
    plate_number: vehicle?.plate_number ?? "",
    vin: vehicle?.vin ?? "",
    make: vehicle?.make ?? "",
    model: vehicle?.model ?? "",
    year: vehicle?.year ? String(vehicle.year) : "",
    trim: vehicle?.trim ?? "",
    engine: vehicle?.engine ?? "",
    fuel: vehicle?.fuel ?? "",
    transmission: vehicle?.transmission ?? "",
    mileage: vehicle?.mileage != null ? String(vehicle.mileage) : "",
    color: vehicle?.color ?? "",
    registration_date: vehicle?.registration_date ?? "",
    notes: vehicle?.notes ?? "",
  });
  const [error, setError] = useState<unknown>(null);
  const [invalid, setInvalid] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function checkDuplicate() {
    const key = plateKey(f.plate_code, f.plate_number);
    if (!f.plate_number.trim()) return setDuplicate(null);
    let q = supabase.from("vehicles").select("id, customer_id, customers(display_name)").eq("org_id", org.id).eq("plate_key", key).is("archived_at", null);
    if (f.plate_emirate) q = q.eq("plate_emirate", f.plate_emirate);
    if (vehicle) q = q.neq("id", vehicle.id);
    const { data } = await q.limit(1);
    const hit = data?.[0] as { customers: { display_name: string } | null } | undefined;
    setDuplicate(hit ? (hit.customers?.display_name ?? "") : null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const inv: Record<string, string> = {};
    if (f.plate_number.trim() || f.plate_code.trim()) {
      const p = validatePlate(f.plate_code, f.plate_number);
      if (!p.ok) {
        if (p.error === "code_format") inv.plate_code = t("Up to 3 letters or digits.");
        else inv.plate_number = p.error === "number_required" ? t("Enter the plate number.") : t("1 to 5 digits.");
      }
    }
    if (!f.plate_number.trim() && !f.vin.trim()) inv.plate_number = t("Enter a plate number or a VIN.");
    if (f.year && !/^\d{4}$/.test(f.year)) inv.year = t("Four digits, e.g. 2021.");
    if (f.mileage && !/^\d+$/.test(f.mileage.replace(/[\s,]/g, ""))) inv.mileage = t("Kilometres, digits only.");
    setInvalid(inv);
    if (Object.keys(inv).length) return;
    setBusy(true);
    setError(null);
    const row = {
      plate_emirate: blank(f.plate_emirate),
      plate_code: blank(f.plate_code.toUpperCase()),
      plate_number: blank(f.plate_number),
      vin: blank(f.vin.toUpperCase()),
      make: blank(f.make),
      model: blank(f.model),
      year: f.year ? Number(f.year) : null,
      trim: blank(f.trim),
      engine: blank(f.engine),
      fuel: blank(f.fuel),
      transmission: blank(f.transmission),
      mileage: f.mileage ? Number(f.mileage.replace(/[\s,]/g, "")) : null,
      color: blank(f.color),
      registration_date: blank(f.registration_date),
      notes: blank(f.notes),
    };
    const res = vehicle
      ? await supabase.from("vehicles").update(row).eq("id", vehicle.id).select().single()
      : await supabase.from("vehicles").insert({ ...row, org_id: org.id, customer_id: customerId }).select().single();
    setBusy(false);
    if (res.error) return setError(res.error);
    onSaved(res.data as Vehicle);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={vehicle ? t("Edit vehicle") : t("New vehicle")}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="primary" type="submit" form="vehicle-form" loading={busy}>
            {vehicle ? t("Save") : t("Add vehicle")}
          </Button>
        </>
      }
    >
      <form id="vehicle-form" onSubmit={submit} className="space-y-4" noValidate>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">{t("Number plate")}</legend>
          <div className="grid grid-cols-[1.4fr_0.8fr_1.2fr] gap-2">
            <Field label={t("Emirate")}>
              {(id) => (
                <Select id={id} value={f.plate_emirate} onChange={set("plate_emirate")} onBlur={checkDuplicate}>
                  {EMIRATES.map((e) => (
                    <option key={e.code} value={e.code}>
                      {t(e.en)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("Code")} error={invalid.plate_code}>
              {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!invalid.plate_code} value={f.plate_code} onChange={set("plate_code")} onBlur={checkDuplicate} maxLength={3} className="uppercase" autoFocus />}
            </Field>
            <Field label={t("Number")} error={invalid.plate_number}>
              {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!invalid.plate_number} inputMode="numeric" value={f.plate_number} onChange={set("plate_number")} onBlur={checkDuplicate} maxLength={5} />}
            </Field>
          </div>
          {duplicate !== null && (
            <Alert tone="warn" className="mt-2">
              {t("A vehicle with this plate is already registered (owner: {name}). Check before creating a duplicate.", { name: duplicate })}
            </Alert>
          )}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("Make")}>
            {(id) => (
              <>
                <Input id={id} list="makes" value={f.make} onChange={set("make")} />
                <datalist id="makes">{MAKES.map((m) => <option key={m} value={m} />)}</datalist>
              </>
            )}
          </Field>
          <Field label={t("Model")}>{(id) => <Input id={id} value={f.model} onChange={set("model")} />}</Field>
          <Field label={t("Year")} error={invalid.year}>{(id, d) => <Input id={id} aria-describedby={d} inputMode="numeric" maxLength={4} value={f.year} onChange={set("year")} />}</Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("VIN")}>{(id) => <Input id={id} value={f.vin} onChange={set("vin")} className="uppercase" maxLength={32} />}</Field>
          <Field label={t("Mileage (km)")} error={invalid.mileage}>{(id, d) => <Input id={id} aria-describedby={d} inputMode="numeric" value={f.mileage} onChange={set("mileage")} />}</Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("Trim")}>{(id) => <Input id={id} value={f.trim} onChange={set("trim")} />}</Field>
          <Field label={t("Engine")}>{(id) => <Input id={id} placeholder="4.0L V6" value={f.engine} onChange={set("engine")} />}</Field>
          <Field label={t("Color")}>{(id) => <Input id={id} value={f.color} onChange={set("color")} />}</Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("Fuel")}>
            {(id) => (
              <Select id={id} value={f.fuel} onChange={set("fuel")}>
                <option value="">—</option>
                <option value="petrol">{t("Petrol")}</option>
                <option value="diesel">{t("Diesel")}</option>
                <option value="hybrid">{t("Hybrid")}</option>
                <option value="electric">{t("Electric")}</option>
                <option value="lpg">{t("LPG")}</option>
                <option value="other">{t("Other")}</option>
              </Select>
            )}
          </Field>
          <Field label={t("Transmission")}>
            {(id) => (
              <Select id={id} value={f.transmission} onChange={set("transmission")}>
                <option value="">—</option>
                <option value="automatic">{t("Automatic")}</option>
                <option value="manual">{t("Manual")}</option>
                <option value="cvt">{t("CVT")}</option>
                <option value="other">{t("Other")}</option>
              </Select>
            )}
          </Field>
          <Field label={t("Registration date")}>{(id) => <Input id={id} type="date" value={f.registration_date} onChange={set("registration_date")} />}</Field>
        </div>
        <Field label={t("Notes")}>{(id) => <Textarea id={id} value={f.notes} onChange={set("notes")} />}</Field>
        <FormError error={error} />
      </form>
    </Dialog>
  );
}
