/**
 * Label maps shown in the interface (English source text, translated with
 * t() where displayed). Kept in one plain module so the translation-coverage
 * test can check every one of them.
 */

export const DOC_LABEL: Record<string, string> = {
  invoice: "Invoices",
  estimate: "Estimates",
  job_card: "Job cards",
  receipt: "Payment receipts",
  refund: "Refund receipts",
  credit_note: "Credit notes",
  purchase_order: "Purchase orders",
};

export const ROLE_HELP: Record<string, string> = {
  owner: "Everything, including team and settings.",
  admin: "Everything, including team and settings.",
  manager: "All billing and workshop work, reports, cancellations. No settings, no team.",
  service_advisor: "Customers, estimates, job cards, invoices and payments. Cannot cancel or refund.",
  mechanic: "Their own job cards and inspections. No prices, no invoices.",
  accountant: "Invoices, payments, refunds, credit notes, reports and audit log. Does not create invoices.",
};

export const AUDIT_AREAS: Array<[string, string]> = [
  ["", "Everything"],
  ["invoice", "Invoices"],
  ["payment", "Payments"],
  ["credit_note", "Credit notes"],
  ["estimate", "Estimates"],
  ["job_card", "Job cards"],
  ["part", "Parts & stock"],
  ["service", "Services"],
  ["customer", "Customers"],
  ["vehicle", "Vehicles"],
  ["purchase_order", "Purchase orders"],
  ["membership", "Team"],
  ["settings", "Settings"],
];

export const SUGGESTED_SERVICES = ["Oil Change", "Brake Service", "AC Service", "Engine Repair", "Transmission", "Suspension", "Diagnostics", "Tyres", "Battery", "Electrical", "Detailing"];

/** Inspection checks, as stored in the database (create_inspection). */
export const INSPECTION_ITEMS = ["Tires", "Brakes", "Battery", "Oil", "Coolant", "Suspension", "Lights", "AC", "Engine", "Transmission", "Body"];

export const FUEL: Record<string, string> = { petrol: "Petrol", diesel: "Diesel", hybrid: "Hybrid", electric: "Electric", lpg: "LPG", other: "Other" };
export const TRANSMISSION: Record<string, string> = { automatic: "Automatic", manual: "Manual", cvt: "CVT", other: "Other" };

export const IMPORT_KINDS: Record<string, string> = { customers: "Customers", vehicles: "Vehicles", parts: "Parts & stock", suppliers: "Suppliers" };

export const PAYMENT_KIND: Record<string, string> = { cash: "Cash", card: "Card", bank_transfer: "Bank Transfer", online: "Online Payment", cheque: "Cheque", other: "Other" };
