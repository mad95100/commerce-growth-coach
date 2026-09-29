import { useQueryClient } from "@tanstack/react-query";
import { Download, Upload } from "lucide-react";
import { useState } from "react";
import { useOrg, useSession } from "@/app/session.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Alert, FormError } from "@/components/ui/feedback.tsx";
import { Chips } from "@/components/ui/form.tsx";
import { Card, CardTitle, TableWrap } from "@/components/ui/layout.tsx";
import { mapHeaders, parseCsv, toCsv, type ImportField } from "@/lib/csv.ts";
import { downloadText } from "@/lib/download.ts";
import { t } from "@/lib/i18n.tsx";
import { EMIRATES, validatePlate } from "@/lib/plates.ts";
import { phoneSearchKey } from "@/lib/phone.ts";
import { rpc, supabase } from "@/lib/supabase.ts";

type Kind = "customers" | "vehicles" | "parts" | "suppliers";

const FIELDS: Record<Kind, ImportField[]> = {
  customers: [
    { key: "type", label: "Type", aliases: ["customer type"] },
    { key: "first_name", label: "First name", aliases: ["firstname", "name"] },
    { key: "last_name", label: "Last name", aliases: ["lastname", "surname"] },
    { key: "company_name", label: "Company name", aliases: ["company"] },
    { key: "phone", label: "Phone", aliases: ["mobile", "telephone"] },
    { key: "whatsapp", label: "WhatsApp" },
    { key: "email", label: "Email", aliases: ["e-mail"] },
    { key: "address", label: "Address" },
    { key: "emirate", label: "Emirate" },
    { key: "trn", label: "TRN" },
    { key: "trade_license_no", label: "Trade licence", aliases: ["trade license", "trade license number", "trade licence number"] },
    { key: "notes", label: "Notes" },
  ],
  vehicles: [
    { key: "customer_phone", label: "Owner phone", required: true, aliases: ["customer phone", "phone"] },
    { key: "plate_emirate", label: "Plate emirate", aliases: ["emirate"] },
    { key: "plate_code", label: "Plate code", aliases: ["code"] },
    { key: "plate_number", label: "Plate number", aliases: ["plate", "number"] },
    { key: "vin", label: "VIN", aliases: ["chassis"] },
    { key: "make", label: "Make", aliases: ["brand"] },
    { key: "model", label: "Model" },
    { key: "year", label: "Year" },
    { key: "mileage", label: "Mileage", aliases: ["km", "odometer"] },
    { key: "color", label: "Color", aliases: ["colour"] },
  ],
  parts: [
    { key: "sku", label: "SKU", required: true },
    { key: "name", label: "Name", required: true, aliases: ["description", "part name"] },
    { key: "part_number", label: "Part number", aliases: ["pn", "part no"] },
    { key: "oem_ref", label: "OEM reference", aliases: ["oem"] },
    { key: "brand", label: "Brand" },
    { key: "category", label: "Category" },
    { key: "purchase_price", label: "Purchase price", aliases: ["cost", "cost price"] },
    { key: "selling_price", label: "Selling price", aliases: ["price", "sale price"] },
    { key: "min_stock", label: "Minimum stock", aliases: ["min", "minimum"] },
    { key: "location", label: "Location", aliases: ["shelf", "bin"] },
    { key: "barcode", label: "Barcode", aliases: ["ean"] },
    { key: "stock", label: "Stock", aliases: ["quantity", "qty", "on hand"] },
  ],
  suppliers: [
    { key: "name", label: "Company", required: true, aliases: ["name", "supplier"] },
    { key: "contact_name", label: "Contact", aliases: ["contact name"] },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email" },
    { key: "address", label: "Address" },
    { key: "trn", label: "TRN" },
    { key: "payment_terms", label: "Payment terms", aliases: ["terms"] },
  ],
};

interface Parsed {
  rows: Array<Record<string, string>>;
  errors: Array<{ line: number; message: string }>;
}

function emirateCode(v: string): string | null {
  const s = v.trim().toLowerCase();
  if (!s) return null;
  const e = EMIRATES.find((x) => x.code.toLowerCase() === s || x.aliases.includes(s) || x.en.toLowerCase() === s);
  return e ? e.code : "?";
}
const amount = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.replace(/,/g, "").trim());

function validate(kind: Kind, r: Record<string, string>): string | null {
  if (kind === "customers") {
    if (!r.first_name && !r.last_name && !r.company_name) return t("A name or company name is required.");
    if (r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) return t("Invalid email.");
    if (r.emirate && emirateCode(r.emirate) === "?") return t("Unknown emirate.");
  }
  if (kind === "vehicles") {
    if (!phoneSearchKey(r.customer_phone ?? "")) return t("Owner phone missing or too short.");
    if (!r.plate_number && !r.vin) return t("A plate number or a VIN is required.");
    if (r.plate_number && !validatePlate(r.plate_code ?? "", r.plate_number).ok) return t("Invalid plate.");
    if (r.plate_emirate && emirateCode(r.plate_emirate) === "?") return t("Unknown emirate.");
    if (r.year && !/^\d{4}$/.test(r.year)) return t("Invalid year.");
    if (r.mileage && !/^\d+$/.test(r.mileage.replace(/[\s,]/g, ""))) return t("Invalid mileage.");
  }
  if (kind === "parts") {
    if (!r.sku || !r.name) return t("SKU and name are required.");
    for (const k of ["purchase_price", "selling_price", "min_stock", "stock"]) if (r[k] && !amount(r[k])) return t("Invalid number in {col}.", { col: k });
  }
  if (kind === "suppliers" && !r.name) return t("Company name is required.");
  return null;
}

export function ImportPanel() {
  const org = useOrg();
  const { can, branchId } = useSession();
  const qc = useQueryClient();
  const kinds = (["customers", "vehicles", "parts", "suppliers"] as Kind[]).filter((k) => (k === "parts" ? can("catalog.manage") : k === "suppliers" ? can("suppliers.manage") : can("customers.manage")));
  const [kind, setKind] = useState<Kind>(kinds[0] ?? "customers");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<{ ok: number; failed: Array<{ line: number; message: string }> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function onFile(file: File) {
    setResult(null);
    setError(null);
    setFileName(file.name);
    if (/\.xlsx?$/i.test(file.name)) {
      setParsed({ rows: [], errors: [{ line: 0, message: t("Excel files must first be saved as CSV (File → Save as → CSV UTF-8).") }] });
      return;
    }
    const table = parseCsv(await file.text());
    if (table.length < 2) return setParsed({ rows: [], errors: [{ line: 0, message: t("The file has no data rows.") }] });
    const map = mapHeaders(table[0], FIELDS[kind]);
    const missing = FIELDS[kind].filter((f) => f.required && map[f.key] < 0);
    if (missing.length) return setParsed({ rows: [], errors: [{ line: 1, message: t("Missing column(s): {cols}", { cols: missing.map((m) => m.label).join(", ") }) }] });
    const rows: Array<Record<string, string>> = [];
    const errors: Parsed["errors"] = [];
    table.slice(1).forEach((cells, i) => {
      const r: Record<string, string> = { _line: String(i + 2) };
      for (const f of FIELDS[kind]) r[f.key] = map[f.key] >= 0 ? (cells[map[f.key]] ?? "").trim() : "";
      const bad = validate(kind, r);
      if (bad) errors.push({ line: i + 2, message: bad });
      else rows.push(r);
    });
    setParsed({ rows, errors });
  }

  async function doImport() {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    const failed: Array<{ line: number; message: string }> = [];
    let ok = 0;
    const n = (v: string) => (v ? v : null);
    try {
      if (kind === "customers") {
        const rows = parsed.rows.map((r) => ({
          org_id: org.id,
          type: /company|business|corp/i.test(r.type) || (!!r.company_name && !r.first_name && !r.last_name) ? "company" : "individual",
          first_name: n(r.first_name), last_name: n(r.last_name), company_name: n(r.company_name), phone: n(r.phone), whatsapp: n(r.whatsapp || r.phone),
          email: n(r.email), address: n(r.address), emirate: r.emirate ? emirateCode(r.emirate) : null, trn: n(r.trn), trade_license_no: n(r.trade_license_no), notes: n(r.notes),
        }));
        for (let i = 0; i < rows.length; i += 200) {
          const { error } = await supabase.from("customers").insert(rows.slice(i, i + 200));
          if (error) parsed.rows.slice(i, i + 200).forEach((r) => failed.push({ line: Number(r._line), message: error.message }));
          else ok += rows.slice(i, i + 200).length;
        }
      } else if (kind === "suppliers") {
        const rows = parsed.rows.map((r) => ({ org_id: org.id, name: r.name, contact_name: n(r.contact_name), phone: n(r.phone), email: n(r.email), address: n(r.address), trn: n(r.trn), payment_terms: n(r.payment_terms) }));
        const { error } = await supabase.from("suppliers").insert(rows);
        if (error) parsed.rows.forEach((r) => failed.push({ line: Number(r._line), message: error.message }));
        else ok = rows.length;
      } else if (kind === "vehicles") {
        const { data: customers, error: e1 } = await supabase.from("customers").select("id, phone_key, whatsapp_key").eq("org_id", org.id).is("archived_at", null);
        if (e1) throw e1;
        for (const r of parsed.rows) {
          const key = phoneSearchKey(r.customer_phone)!;
          const owners = (customers ?? []).filter((c) => c.phone_key === key || c.whatsapp_key === key);
          if (owners.length !== 1) {
            failed.push({ line: Number(r._line), message: owners.length === 0 ? t("No customer with this phone. Import customers first.") : t("Several customers share this phone.") });
            continue;
          }
          const { error } = await supabase.from("vehicles").insert({
            org_id: org.id, customer_id: owners[0].id, plate_emirate: r.plate_emirate ? emirateCode(r.plate_emirate) : org.emirate, plate_code: n(r.plate_code.toUpperCase()), plate_number: n(r.plate_number),
            vin: n(r.vin.toUpperCase()), make: n(r.make), model: n(r.model), year: r.year ? Number(r.year) : null, mileage: r.mileage ? Number(r.mileage.replace(/[\s,]/g, "")) : null, color: n(r.color),
          });
          if (error) failed.push({ line: Number(r._line), message: error.message });
          else ok++;
        }
      } else {
        for (const r of parsed.rows) {
          const { data, error } = await supabase
            .from("parts")
            .insert({
              org_id: org.id, sku: r.sku.toUpperCase(), name: r.name, part_number: n(r.part_number), oem_ref: n(r.oem_ref), brand: n(r.brand), category: n(r.category),
              purchase_price: r.purchase_price ? Number(r.purchase_price.replace(/,/g, "")) : 0, selling_price: r.selling_price ? Number(r.selling_price.replace(/,/g, "")) : 0,
              min_stock: r.min_stock ? Number(r.min_stock) : 0, location: n(r.location), barcode: n(r.barcode),
            })
            .select("id")
            .single();
          if (error) {
            failed.push({ line: Number(r._line), message: error.code === "23505" ? t("A part with this SKU already exists.") : error.message });
            continue;
          }
          if (r.stock && Number(r.stock) > 0) await rpc("adjust_stock", { p: { org_id: org.id, branch_id: branchId, part_id: data.id, kind: "count", quantity: Number(r.stock), note: "Import" } });
          ok++;
        }
      }
      await qc.invalidateQueries();
      setResult({ ok, failed });
      setParsed(null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (kinds.length === 0) return null;
  return (
    <Card>
      <CardTitle>{t("Import from CSV")}</CardTitle>
      <p className="mb-4 text-sm text-muted">{t("Bring your existing data from a spreadsheet. In Excel: File → Save as → CSV UTF-8. Columns are recognised by their header.")}</p>
      <Chips label={t("What to import")} value={kind} onChange={(k) => { setKind(k); setParsed(null); setResult(null); }} options={kinds.map((k) => ({ value: k, label: t(k === "customers" ? "Customers" : k === "vehicles" ? "Vehicles" : k === "parts" ? "Parts & stock" : "Suppliers") }))} />
      <p className="mt-3 text-xs text-muted">
        {t("Columns:")} {FIELDS[kind].map((f) => `${f.label}${f.required ? "*" : ""}`).join(", ")}
        {kind === "vehicles" && ` — ${t("each vehicle is attached to the customer with that phone number.")}`}
        {kind === "parts" && ` — ${t("“Stock” sets the quantity on the shelf of the current branch.")}`}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => downloadText(`template-${kind}.csv`, toCsv([], FIELDS[kind].map((f) => ({ header: f.label, value: () => "" }))))} icon={<Download className="size-4" />}>
          {t("Download template")}
        </Button>
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium hover:bg-canvas">
          <Upload className="size-4" aria-hidden />
          {t("Choose a CSV file")}
          <input type="file" accept=".csv,text/csv,.xlsx,.xls" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
        {fileName && <span className="self-center text-sm text-muted">{fileName}</span>}
      </div>
      {parsed && (
        <div className="mt-4 space-y-3">
          {parsed.errors.length > 0 && (
            <Alert tone="warn" title={t("{n} row(s) will be skipped", { n: parsed.errors.length })}>
              <ul className="max-h-40 list-disc overflow-auto ps-4">
                {parsed.errors.slice(0, 50).map((e) => (
                  <li key={`${e.line}${e.message}`}>{e.line ? t("Line {n}: {msg}", { n: e.line, msg: e.message }) : e.message}</li>
                ))}
              </ul>
            </Alert>
          )}
          {parsed.rows.length > 0 && (
            <>
              <p className="text-sm font-medium">{t("{n} row(s) ready to import. Preview:", { n: parsed.rows.length })}</p>
              <TableWrap>
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      {FIELDS[kind].map((f) => (
                        <th key={f.key} className="border-b border-line px-2 py-1 text-start text-muted">
                          {f.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 5).map((r) => (
                      <tr key={r._line}>
                        {FIELDS[kind].map((f) => (
                          <td key={f.key} className="border-b border-line px-2 py-1 whitespace-nowrap">
                            {r[f.key]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              <Button variant="primary" loading={busy} onClick={doImport}>
                {t("Import {n} row(s)", { n: parsed.rows.length })}
              </Button>
            </>
          )}
        </div>
      )}
      {result && (
        <Alert tone={result.failed.length ? "warn" : "ok"} className="mt-4" title={t("{n} row(s) imported.", { n: result.ok })}>
          {result.failed.length > 0 && (
            <ul className="max-h-40 list-disc overflow-auto ps-4">
              {result.failed.slice(0, 50).map((e) => (
                <li key={`${e.line}${e.message}`}>{t("Line {n}: {msg}", { n: e.line, msg: e.message })}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}
      <div className="mt-3">
        <FormError error={error} />
      </div>
    </Card>
  );
}
