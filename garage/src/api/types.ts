/** Row shapes returned by the database (tables and read views). */

export interface Org {
  id: string;
  name: string;
  legal_name: string | null;
  trn: string | null;
  trade_license_no: string | null;
  vat_registered: boolean;
  address: string | null;
  emirate: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logo_url: string | null;
  currency: string;
  timezone: string;
  default_payment_terms_days: number;
  estimate_validity_days: number;
  default_labor_rate: number;
  large_amount_threshold: number;
  invoice_terms: string | null;
  estimate_terms: string | null;
  receipt_footer: string | null;
}

export interface Membership {
  org_id: string;
  user_id: string;
  role: string;
  display_name: string | null;
  email: string | null;
  active: boolean;
  created_at?: string;
}

export interface Branch {
  id: string;
  org_id: string;
  name: string;
  address: string | null;
  phone: string | null;
  is_default: boolean;
  active: boolean;
}

export interface TaxRate {
  id: string;
  name: string;
  rate: number;
  is_default: boolean;
  active: boolean;
}

export interface PaymentMethod {
  id: string;
  name: string;
  kind: string;
  active: boolean;
  sort_order: number;
}

export interface Technician {
  id: string;
  name: string;
  phone: string | null;
  user_id: string | null;
  active: boolean;
}

export interface Customer {
  id: string;
  org_id: string;
  type: "individual" | "company";
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  display_name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  emirate: string | null;
  trn: string | null;
  trade_license_no: string | null;
  notes: string | null;
  created_at: string;
  archived_at: string | null;
}

export interface Vehicle {
  id: string;
  org_id: string;
  customer_id: string;
  plate_emirate: string | null;
  plate_code: string | null;
  plate_number: string | null;
  vin: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  trim: string | null;
  engine: string | null;
  fuel: string | null;
  transmission: string | null;
  mileage: number | null;
  color: string | null;
  registration_date: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface Part {
  id: string;
  sku: string;
  part_number: string | null;
  oem_ref: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  description: string | null;
  unit: string;
  purchase_price: number;
  selling_price: number;
  tax_rate_id: string | null;
  min_stock: number;
  location: string | null;
  barcode: string | null;
  supplier_id: string | null;
  track_stock: boolean;
  active: boolean;
}

export interface Service {
  id: string;
  code: string | null;
  name: string;
  category: string | null;
  description: string | null;
  pricing: "fixed" | "hourly";
  price: number;
  labor_rate: number | null;
  duration_hours: number | null;
  tax_rate_id: string | null;
  active: boolean;
}

export interface StockRow {
  part_id: string;
  branch_id: string;
  branch_name: string;
  sku: string;
  part_number: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  location: string | null;
  unit: string;
  min_stock: number;
  quantity: number;
  is_low: boolean;
  selling_price: number;
  purchase_price: number;
  active: boolean;
  track_stock: boolean;
}

export interface StockMovement {
  id: string;
  part_id: string;
  branch_id: string;
  quantity: number;
  balance_after: number;
  kind: string;
  unit_cost: number | null;
  reference_type: string | null;
  reference_id: string | null;
  reference_number: string | null;
  note: string | null;
  created_by_name: string | null;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  trn: string | null;
  payment_terms: string | null;
  notes: string | null;
  active: boolean;
}

export interface DocLine {
  id: string;
  position: number;
  kind: "part" | "labor" | "service" | "other";
  part_id: string | null;
  service_id: string | null;
  technician_id: string | null;
  source_line_id: string | null;
  description: string;
  part_number: string | null;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  tax_rate_id: string | null;
  tax_rate: number;
  gross: number;
  discount_amount: number;
  net: number;
  doc_discount: number;
  taxable: number;
  vat: number;
  total: number;
}

interface VehicleCols {
  plate_emirate: string | null;
  plate_code: string | null;
  plate_number: string | null;
  make: string | null;
  model: string | null;
  vehicle_year: number | null;
}

interface DocTotals {
  discount_type: "percent" | "amount" | null;
  discount_value: number;
  subtotal: number;
  doc_discount: number;
  vat_total: number;
  total: number;
}

export interface InvoiceRow extends VehicleCols, DocTotals {
  id: string;
  org_id: string;
  branch_id: string;
  number: string | null;
  status: "draft" | "issued" | "cancelled";
  display_status: string;
  customer_id: string;
  vehicle_id: string | null;
  job_card_id: string | null;
  job_card_number: string | null;
  estimate_id: string | null;
  issue_date: string | null;
  due_date: string | null;
  mileage: number | null;
  description: string | null;
  notes: string | null;
  terms: string | null;
  vat_registered: boolean | null;
  customer_snapshot: Record<string, string | null> | null;
  vehicle_snapshot: Record<string, string | number | null> | null;
  org_snapshot: Record<string, string | boolean | null> | null;
  sent_at: string | null;
  issued_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_whatsapp: string | null;
  customer_email: string | null;
  vin: string | null;
  credited: number;
  paid: number;
  refunded: number;
  balance: number;
  days_overdue: number;
}

export interface EstimateRow extends VehicleCols, DocTotals {
  id: string;
  org_id: string;
  branch_id: string;
  number: string;
  status: string;
  display_status: string;
  customer_id: string;
  vehicle_id: string | null;
  issue_date: string;
  valid_until: string | null;
  mileage: number | null;
  description: string | null;
  notes: string | null;
  terms: string | null;
  sent_at: string | null;
  decided_at: string | null;
  job_card_id: string | null;
  invoice_id: string | null;
  created_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_whatsapp: string | null;
  customer_email: string | null;
  deposits: number;
}

export interface JobCardRow extends VehicleCols, DocTotals {
  id: string;
  org_id: string;
  branch_id: string;
  number: string;
  status: string;
  estimate_id: string | null;
  estimate_number: string | null;
  customer_id: string;
  vehicle_id: string;
  technician_id: string | null;
  technician_name: string | null;
  mileage_in: number | null;
  complaint: string | null;
  diagnosis: string | null;
  work_done: string | null;
  internal_notes: string | null;
  received_at: string;
  promised_at: string | null;
  completed_at: string | null;
  delivered_at: string | null;
  invoice_id: string | null;
  created_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_whatsapp: string | null;
  vin: string | null;
  is_delayed: boolean;
  deposits: number;
}

export interface PaymentRow {
  id: string;
  branch_id: string;
  number: string;
  kind: "payment" | "deposit" | "refund";
  customer_id: string;
  invoice_id: string | null;
  estimate_id: string | null;
  job_card_id: string | null;
  credit_note_id: string | null;
  amount: number;
  method_id: string | null;
  method_name: string;
  reference: string | null;
  paid_at: string;
  notes: string | null;
  received_by_name: string | null;
  voided_at: string | null;
  voided_by_name: string | null;
  void_reason: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_whatsapp: string | null;
  customer_email: string | null;
  invoice_number: string | null;
  estimate_number: string | null;
  job_card_number: string | null;
  credit_note_number: string | null;
}

export interface CreditNoteRow {
  id: string;
  number: string;
  invoice_id: string;
  invoice_number: string | null;
  customer_id: string;
  customer_name: string | null;
  issue_date: string;
  reason: string;
  mode: "lines" | "amount";
  restock: boolean;
  subtotal: number;
  vat_total: number;
  total: number;
  customer_snapshot: Record<string, string | null> | null;
  created_at: string;
}

export interface AuditRow {
  id: number;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface Appointment {
  id: string;
  branch_id: string;
  customer_id: string | null;
  vehicle_id: string | null;
  contact_name: string | null;
  phone: string | null;
  reason: string;
  starts_at: string;
  duration_minutes: number;
  technician_id: string | null;
  status: string;
  notes: string | null;
  job_card_id: string | null;
}

export interface OutboundMessage {
  id: string;
  channel: string;
  purpose: string;
  recipient: string | null;
  created_by_name: string | null;
  created_at: string;
  invoice_id: string | null;
}
