import { supabase } from "@/lib/supabase.ts";
import type { Customer, Supplier, Vehicle } from "./types.ts";

export interface PurchaseOrder {
  id: string;
  branch_id: string;
  number: string;
  supplier_id: string;
  status: string;
  order_date: string | null;
  expected_date: string | null;
  notes: string | null;
  subtotal: number;
  vat_total: number;
  total: number;
  created_at: string;
}
export interface PurchaseOrderLine {
  id: string;
  position: number;
  part_id: string | null;
  description: string;
  quantity: number;
  unit_cost: number;
  tax_rate: number;
  received_quantity: number;
  net: number;
  vat: number;
  total: number;
}
export interface Inspection {
  id: string;
  branch_id: string;
  vehicle_id: string;
  customer_id: string;
  job_card_id: string | null;
  technician_id: string | null;
  mileage: number | null;
  status: "draft" | "completed";
  summary: string | null;
  recommendations: string | null;
  created_at: string;
  completed_at: string | null;
}
export interface InspectionItem {
  id: string;
  item_key: string;
  label: string;
  position: number;
  status: "ok" | "attention" | "urgent" | null;
  comment: string | null;
}

async function one<T>(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  if (!data) throw { message: "bsg.not_found" };
  return data as T;
}

export async function fetchPurchaseOrder(id: string) {
  const po = await one<PurchaseOrder>(supabase.from("purchase_orders").select("*").eq("id", id).maybeSingle());
  const [lines, supplier] = await Promise.all([
    supabase.from("purchase_order_lines").select("*").eq("purchase_order_id", id).order("position").then((r) => {
      if (r.error) throw r.error;
      return r.data as PurchaseOrderLine[];
    }),
    one<Supplier>(supabase.from("suppliers").select("*").eq("id", po.supplier_id).maybeSingle()),
  ]);
  return { po, lines, supplier };
}
export type PurchaseOrderBundle = Awaited<ReturnType<typeof fetchPurchaseOrder>>;

export async function fetchInspection(id: string) {
  const ins = await one<Inspection>(supabase.from("inspections").select("*").eq("id", id).maybeSingle());
  const [items, vehicle, customer, tech, jc] = await Promise.all([
    supabase.from("inspection_items").select("*").eq("inspection_id", id).order("position").then((r) => {
      if (r.error) throw r.error;
      return r.data as InspectionItem[];
    }),
    one<Vehicle>(supabase.from("vehicles").select("*").eq("id", ins.vehicle_id).maybeSingle()),
    one<Customer>(supabase.from("customers").select("*").eq("id", ins.customer_id).maybeSingle()),
    ins.technician_id ? supabase.from("technicians").select("name").eq("id", ins.technician_id).maybeSingle().then((r) => (r.data?.name as string) ?? null) : Promise.resolve(null),
    ins.job_card_id ? supabase.from("job_cards").select("number").eq("id", ins.job_card_id).maybeSingle().then((r) => (r.data?.number as string) ?? null) : Promise.resolve(null),
  ]);
  return { ins, items, vehicle, customer, technician: tech, jobCardNumber: jc };
}
export type InspectionBundle = Awaited<ReturnType<typeof fetchInspection>>;
