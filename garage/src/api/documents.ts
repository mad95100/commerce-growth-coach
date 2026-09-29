import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase.ts";
import type { CreditNoteRow, Customer, DocLine, EstimateRow, InvoiceRow, JobCardRow, OutboundMessage, PaymentRow, Vehicle } from "./types.ts";

async function one<T>(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  if (!data) throw { message: "bsg.not_found" };
  return data as T;
}
async function many<T>(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const { data, error } = await p;
  if (error) throw error;
  return (data ?? []) as T[];
}

export async function fetchInvoice(id: string) {
  const [inv, lines, payments, creditNotes, messages] = await Promise.all([
    one<InvoiceRow>(supabase.from("v_invoices").select("*").eq("id", id).maybeSingle()),
    many<DocLine>(supabase.from("doc_lines").select("*").eq("invoice_id", id).order("position")),
    many<PaymentRow>(supabase.from("v_payments").select("*").eq("invoice_id", id).order("paid_at")),
    many<CreditNoteRow>(supabase.from("v_credit_notes").select("*").eq("invoice_id", id).order("created_at")),
    many<OutboundMessage>(supabase.from("outbound_messages").select("*").eq("invoice_id", id).order("created_at", { ascending: false })),
  ]);
  let customer: Customer | null = null;
  let vehicle: Vehicle | null = null;
  if (inv.status === "draft") {
    customer = await one<Customer>(supabase.from("customers").select("*").eq("id", inv.customer_id).maybeSingle());
    if (inv.vehicle_id) vehicle = await one<Vehicle>(supabase.from("vehicles").select("*").eq("id", inv.vehicle_id).maybeSingle());
  }
  return { inv, lines, payments, creditNotes, messages, customer, vehicle };
}
export type InvoiceBundle = Awaited<ReturnType<typeof fetchInvoice>>;

export function useInvoice(id: string) {
  return useQuery({ queryKey: ["invoice", id], queryFn: () => fetchInvoice(id) });
}

export async function fetchEstimate(id: string) {
  const [est, lines, payments] = await Promise.all([
    one<EstimateRow>(supabase.from("v_estimates").select("*").eq("id", id).maybeSingle()),
    many<DocLine>(supabase.from("doc_lines").select("*").eq("estimate_id", id).order("position")),
    many<PaymentRow>(supabase.from("v_payments").select("*").eq("estimate_id", id).order("paid_at")),
  ]);
  const customer = await one<Customer>(supabase.from("customers").select("*").eq("id", est.customer_id).maybeSingle());
  const vehicle = est.vehicle_id ? await one<Vehicle>(supabase.from("vehicles").select("*").eq("id", est.vehicle_id).maybeSingle()) : null;
  return { est, lines, payments, customer, vehicle };
}
export type EstimateBundle = Awaited<ReturnType<typeof fetchEstimate>>;

export async function fetchJobCard(id: string) {
  const [jc, lines, payments] = await Promise.all([
    one<JobCardRow>(supabase.from("v_job_cards").select("*").eq("id", id).maybeSingle()),
    many<DocLine>(supabase.from("doc_lines").select("*").eq("job_card_id", id).order("position")),
    // Payments are only readable by roles that see invoices; a mechanic gets none.
    many<PaymentRow>(supabase.from("v_payments").select("*").eq("job_card_id", id).order("paid_at")),
  ]);
  const customer = await one<Customer>(supabase.from("customers").select("*").eq("id", jc.customer_id).maybeSingle());
  const vehicle = await one<Vehicle>(supabase.from("vehicles").select("*").eq("id", jc.vehicle_id).maybeSingle());
  return { jc, lines, payments, customer, vehicle };
}
export type JobCardBundle = Awaited<ReturnType<typeof fetchJobCard>>;

export async function fetchPayment(id: string) {
  const payment = await one<PaymentRow>(supabase.from("v_payments").select("*").eq("id", id).maybeSingle());
  const invoice = payment.invoice_id ? await one<InvoiceRow>(supabase.from("v_invoices").select("*").eq("id", payment.invoice_id).maybeSingle()) : null;
  const customer = await one<Customer>(supabase.from("customers").select("*").eq("id", payment.customer_id).maybeSingle());
  let vehicle: Vehicle | null = null;
  const vehicleId = invoice?.vehicle_id ?? null;
  if (vehicleId) vehicle = await one<Vehicle>(supabase.from("vehicles").select("*").eq("id", vehicleId).maybeSingle());
  else if (payment.job_card_id) {
    const jc = await one<JobCardRow>(supabase.from("v_job_cards").select("*").eq("id", payment.job_card_id).maybeSingle());
    vehicle = await one<Vehicle>(supabase.from("vehicles").select("*").eq("id", jc.vehicle_id).maybeSingle());
  }
  return { payment, invoice, customer, vehicle };
}
export type PaymentBundle = Awaited<ReturnType<typeof fetchPayment>>;

export async function fetchCreditNote(id: string) {
  const cn = await one<CreditNoteRow>(supabase.from("v_credit_notes").select("*").eq("id", id).maybeSingle());
  const [lines, invoice] = await Promise.all([
    many<DocLine>(supabase.from("doc_lines").select("*").eq("credit_note_id", id).order("position")),
    one<InvoiceRow>(supabase.from("v_invoices").select("*").eq("id", cn.invoice_id).maybeSingle()),
  ]);
  return { cn, lines, invoice };
}
export type CreditNoteBundle = Awaited<ReturnType<typeof fetchCreditNote>>;
