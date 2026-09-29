/**
 * The user's full journey, against real SQL:
 * customer → vehicle → estimate (parts + labor + VAT + discount) → deposit →
 * approval → job card → repair → invoice → payment(s) → receipt → balance →
 * stock → vehicle history → dashboard → reports, then credit note, refund,
 * cancellation, fast invoice, search.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { rejects, startDb, type Db } from "./helpers.ts";
import { computeTotals } from "../../src/lib/totals.ts";

let db: Db;
let owner: string;
let mechanicUser: string;
const s: Record<string, string> = {}; // ids shared between steps

before(async () => {
  db = await startDb();
  owner = await db.createUser("owner@bsgarage.test");
  mechanicUser = await db.createUser("ravi@bsgarage.test");
});
after(async () => db?.close());

test("onboarding creates the garage with branch, VAT, methods and numbering", async () => {
  s.org = await db.rpc<string>(owner, "create_organization", {
    p: { name: "BS Garage", trn: "100000000000003", vat_registered: true, vat_rate: 5, emirate: "DXB", owner_name: "Owner" },
  });
  const [org] = await db.as<{ name: string }>(owner, "select name from organizations where id = $1", [s.org]);
  assert.equal(org.name, "BS Garage");
  const rates = await db.as<{ rate: number; is_default: boolean }>(owner, "select rate, is_default from tax_rates where org_id = $1 order by rate desc", [s.org]);
  assert.deepEqual(rates, [{ rate: 5, is_default: true }, { rate: 0, is_default: false }]);
  const methods = await db.as(owner, "select name from payment_methods where org_id = $1", [s.org]);
  assert.equal(methods.length, 5);
  const [m] = await db.as<{ role: string }>(owner, "select role from memberships where org_id = $1", [s.org]);
  assert.equal(m.role, "owner");
  const [pm] = await db.as<{ id: string }>(owner, "select id from payment_methods where org_id = $1 and kind = 'cash'", [s.org]);
  s.cash = pm.id;
  const [card] = await db.as<{ id: string }>(owner, "select id from payment_methods where org_id = $1 and kind = 'card'", [s.org]);
  s.card = card.id;
});

test("VAT rate is required when the garage is VAT-registered", async () => {
  await rejects(db.rpc(owner, "create_organization", { p: { name: "X", vat_registered: true } }), "bsg.validation");
});

test("customer with two vehicles, parts, services, technician", async () => {
  const [c] = await db.as<{ id: string; display_name: string; phone_key: string }>(owner,
    `insert into customers(org_id, type, first_name, last_name, phone, whatsapp, email, emirate)
     values ($1, 'individual', 'Ahmed', 'Al Mansoori', '050 123 4567', '+971501234567', 'ahmed@example.com', 'DXB')
     returning id, display_name, phone_key`, [s.org]);
  assert.equal(c.display_name, "Ahmed Al Mansoori");
  assert.equal(c.phone_key, "501234567");
  s.customer = c.id;
  const [v1] = await db.as<{ id: string; plate_key: string }>(owner,
    `insert into vehicles(org_id, customer_id, plate_emirate, plate_code, plate_number, vin, make, model, year, mileage)
     values ($1, $2, 'DXB', 'A', '12345', 'JTMHV05J604012345', 'Toyota', 'Land Cruiser', 2021, 45000)
     returning id, plate_key`, [s.org, s.customer]);
  assert.equal(v1.plate_key, "A12345");
  s.vehicle = v1.id;
  const [v2] = await db.as<{ id: string }>(owner,
    `insert into vehicles(org_id, customer_id, plate_emirate, plate_code, plate_number, make, model, year)
     values ($1, $2, 'DXB', 'B', '777', 'Nissan', 'Patrol', 2019) returning id`, [s.org, s.customer]);
  s.vehicle2 = v2.id;

  const [sup] = await db.as<{ id: string }>(owner,
    "insert into suppliers(org_id, name, phone) values ($1, 'Al Quoz Auto Parts', '04 123 4567') returning id", [s.org]);
  s.supplier = sup.id;
  const [p] = await db.as<{ id: string }>(owner,
    `insert into parts(org_id, sku, part_number, oem_ref, name, brand, category, purchase_price, selling_price, min_stock, supplier_id)
     values ($1, 'BP-001', '04465-60320', '04465-60320', 'Front brake pads', 'Toyota', 'Brakes', 80, 120, 4, $2)
     returning id`, [s.org, s.supplier]);
  s.part = p.id;
  const bal = await db.rpc<number>(owner, "adjust_stock", { p: { org_id: s.org, part_id: s.part, kind: "stock_in", quantity: 10, note: "Opening stock" } });
  assert.equal(bal, 10);
  const [svc] = await db.as<{ id: string }>(owner,
    "insert into services(org_id, name, category, pricing, price) values ($1, 'Oil Change', 'Maintenance', 'fixed', 150) returning id", [s.org]);
  s.service = svc.id;
  const [t] = await db.as<{ id: string }>(owner,
    "insert into technicians(org_id, name, user_id) values ($1, 'Ravi', $2) returning id", [s.org, mechanicUser]);
  s.tech = t.id;
});

const estimateLines = () => [
  { kind: "part", part_id: s.part, quantity: 4, unit_price: 120 },
  { kind: "labor", description: "Brake service labor", quantity: 1.5, unit_price: 200, technician_id: s.tech },
  { kind: "service", service_id: s.service, quantity: 1, unit_price: 150, discount_pct: 10 },
];

test("estimate with parts, labor, service, discount: SQL totals = TypeScript preview", async () => {
  s.estimate = await db.rpc<string>(owner, "save_estimate", {
    p: { org_id: s.org, customer_id: s.customer, vehicle_id: s.vehicle, mileage: 45200,
      description: "Brake noise, oil due", discount_type: "percent", discount_value: 5, lines: estimateLines() },
  });
  const [e] = await db.as<{ number: string; subtotal: number; doc_discount: number; vat_total: number; total: number; status: string }>(
    owner, "select number, subtotal, doc_discount, vat_total, total, status from estimates where id = $1", [s.estimate]);
  const ts = computeTotals(
    [
      { quantity: 4, unitPrice: 120, discountPct: 0, taxRate: 5 },
      { quantity: 1.5, unitPrice: 200, discountPct: 0, taxRate: 5 },
      { quantity: 1, unitPrice: 150, discountPct: 10, taxRate: 5 },
    ],
    "percent",
    5,
  );
  assert.equal(e.number, "EST-00001");
  assert.equal(e.status, "draft");
  assert.equal(e.subtotal, ts.subtotal); // 480 + 300 + 135 = 915
  assert.equal(e.subtotal, 915);
  assert.equal(e.doc_discount, ts.docDiscount);
  assert.equal(e.vat_total, ts.vatTotal);
  assert.equal(e.total, ts.total);
  const lines = await db.as<{ description: string; tax_rate: number }>(owner,
    "select description, tax_rate from doc_lines where estimate_id = $1 order by position", [s.estimate]);
  assert.deepEqual(lines.map((l) => l.description), ["Front brake pads", "Brake service labor", "Oil Change"]);
  assert.ok(lines.every((l) => l.tax_rate === 5));
});

test("a vehicle of another customer is refused on a document", async () => {
  const [other] = await db.as<{ id: string }>(owner,
    "insert into customers(org_id, first_name) values ($1, 'Other') returning id", [s.org]);
  await rejects(db.rpc(owner, "save_estimate", {
    p: { org_id: s.org, customer_id: other.id, vehicle_id: s.vehicle, lines: [] },
  }), "bsg.vehicle_not_customer");
});

test("deposit before the repair, on the estimate", async () => {
  s.deposit = await db.rpc<string>(owner, "record_payment", {
    p: { org_id: s.org, estimate_id: s.estimate, amount: 300, method_id: s.cash, reference: "DEP" },
  });
  const [d] = await db.as<{ kind: string; number: string }>(owner, "select kind, number from payments where id = $1", [s.deposit]);
  assert.equal(d.kind, "deposit");
  assert.equal(d.number, "RCT-00001");
  const [e] = await db.as<{ deposits: number }>(owner, "select deposits from v_estimates where id = $1", [s.estimate]);
  assert.equal(e.deposits, 300);
});

test("send, then approve and convert to a job card in one step", async () => {
  await db.rpc(owner, "set_estimate_status", { p_id: s.estimate, p_status: "sent" });
  s.jobCard = await db.rpc<string>(owner, "convert_estimate_to_job_card", { p_id: s.estimate, p: { technician_id: s.tech } });
  const [jc] = await db.as<{ number: string; total: number; mileage_in: number; complaint: string }>(owner,
    "select number, total, mileage_in, complaint from job_cards where id = $1", [s.jobCard]);
  const [e] = await db.as<{ status: string; total: number; job_card_id: string }>(owner,
    "select status, total, job_card_id from estimates where id = $1", [s.estimate]);
  assert.equal(jc.number, "JC-00001");
  assert.equal(jc.total, e.total);
  assert.equal(jc.mileage_in, 45200);
  assert.equal(jc.complaint, "Brake noise, oil due");
  assert.equal(e.status, "converted");
  const [dep] = await db.as<{ job_card_id: string }>(owner, "select job_card_id from payments where id = $1", [s.deposit]);
  assert.equal(dep.job_card_id, s.jobCard, "deposit follows the work to the job card");
  await rejects(db.rpc(owner, "convert_estimate_to_job_card", { p_id: s.estimate }), "bsg.invalid_state");
});

test("the mechanic works on their job card but cannot touch amounts or invoices", async () => {
  await db.admin.query(
    "insert into memberships(org_id, user_id, role, display_name, email) values ($1, $2, 'mechanic', 'Ravi', 'ravi@bsgarage.test')",
    [s.org, mechanicUser]);
  const visible = await db.as(mechanicUser, "select id from job_cards");
  assert.equal(visible.length, 1);
  await db.rpc(mechanicUser, "update_job_card_progress", { p: { id: s.jobCard, status: "in_progress", diagnosis: "Pads worn to 2mm" } });
  await db.rpc(mechanicUser, "update_job_card_progress", { p: { id: s.jobCard, status: "ready", work_done: "Replaced front pads, oil change" } });
  const [jc] = await db.as<{ status: string; completed_at: string | null; work_done: string }>(owner,
    "select status, completed_at, work_done from job_cards where id = $1", [s.jobCard]);
  assert.equal(jc.status, "ready");
  assert.ok(jc.completed_at);
  await rejects(db.rpc(mechanicUser, "save_job_card", {
    p: { org_id: s.org, id: s.jobCard, customer_id: s.customer, vehicle_id: s.vehicle, lines: [] },
  }), "bsg.permission_denied");
  await rejects(db.rpc(mechanicUser, "create_invoice_from_job_card", { p_id: s.jobCard }), "bsg.permission_denied");
  await rejects(db.rpc(mechanicUser, "update_job_card_progress", { p: { id: s.jobCard, status: "cancelled" } }), "bsg.invalid_state");
  assert.equal((await db.as(mechanicUser, "select id from invoices")).length, 0);
  assert.equal((await db.as(mechanicUser, "select id from payments")).length, 0);
  await rejects(db.as(mechanicUser, "update doc_lines set unit_price = 0"), "permission denied");
  const d = await db.rpc<Record<string, unknown>>(mechanicUser, "dashboard_summary", { p_org: s.org });
  assert.equal(d.workshop, 1);
  assert.equal(d.today_report, undefined, "no financial figures for a mechanic");
  assert.equal(d.unpaid_count, undefined);
});

test("job card → invoice: lines and deposit carry over; issuing numbers, freezes and moves stock", async () => {
  s.invoice = await db.rpc<string>(owner, "create_invoice_from_job_card", { p_id: s.jobCard });
  const [draft] = await db.as<{ status: string; number: string | null; paid: number; total: number; display_status: string }>(owner,
    "select status, number, paid, total, display_status from v_invoices where id = $1", [s.invoice]);
  assert.equal(draft.status, "draft");
  assert.equal(draft.number, null, "a draft has no number");
  assert.equal(draft.paid, 300, "the deposit is taken into account automatically");
  s.total = String(draft.total);

  const number = await db.rpc<string>(owner, "issue_invoice", { p_id: s.invoice });
  assert.equal(number, "INV-00001");
  const [inv] = await db.as<{ customer_snapshot: { name: string; phone: string }; vehicle_snapshot: { plate_number: string }; org_snapshot: { trn: string }; due_date: string; issue_date: string; balance: number }>(
    owner, "select customer_snapshot, vehicle_snapshot, org_snapshot, due_date::text, issue_date::text, balance from v_invoices where id = $1", [s.invoice]);
  assert.equal(inv.customer_snapshot.name, "Ahmed Al Mansoori");
  assert.equal(inv.vehicle_snapshot.plate_number, "12345");
  assert.equal(inv.org_snapshot.trn, "100000000000003");
  assert.equal(inv.due_date, inv.issue_date);
  assert.equal(inv.balance, Number(s.total) - 300);

  const [stock] = await db.as<{ quantity: number }>(owner, "select quantity from stock_levels where part_id = $1", [s.part]);
  assert.equal(stock.quantity, 6, "4 pads left the shelf when the invoice was issued");
  const [mv] = await db.as<{ kind: string; reference_number: string }>(owner,
    "select kind, reference_number from stock_movements where part_id = $1 order by created_at desc limit 1", [s.part]);
  assert.deepEqual(mv, { kind: "sale", reference_number: "INV-00001" });
  const [veh] = await db.as<{ mileage: number }>(owner, "select mileage from vehicles where id = $1", [s.vehicle]);
  assert.equal(veh.mileage, 45200);
});

test("an issued invoice cannot be changed, even by the owner, even directly", async () => {
  await rejects(db.rpc(owner, "save_invoice", {
    p: { org_id: s.org, id: s.invoice, customer_id: s.customer, vehicle_id: s.vehicle, lines: [] },
  }), "bsg.invoice_locked");
  await rejects(db.as(owner, "update invoices set total = 1 where id = $1", [s.invoice]), "permission denied");
  await rejects(db.admin.query("update invoices set total = 1 where id = $1", [s.invoice]), "bsg.invoice_locked");
  await rejects(db.admin.query("update doc_lines set unit_price = 1 where invoice_id = $1", [s.invoice]), "bsg.invoice_locked");
});

test("partial payment, overpayment refused, then paid in full; receipts are numbered", async () => {
  const [before] = await db.as<{ balance: number }>(owner, "select balance from v_invoices where id = $1", [s.invoice]);
  const p1 = await db.rpc<string>(owner, "record_payment", {
    p: { org_id: s.org, invoice_id: s.invoice, amount: 500, method_id: s.card, reference: "AUTH-1234" },
  });
  const [mid] = await db.as<{ balance: number; display_status: string }>(owner, "select balance, display_status from v_invoices where id = $1", [s.invoice]);
  assert.equal(mid.balance, Math.round((before.balance - 500) * 100) / 100);
  assert.equal(mid.display_status, "partially_paid");
  await rejects(db.rpc(owner, "record_payment", {
    p: { org_id: s.org, invoice_id: s.invoice, amount: mid.balance + 0.01, method_id: s.cash },
  }), "bsg.amount_exceeds_balance");
  const p2 = await db.rpc<string>(owner, "record_payment", {
    p: { org_id: s.org, invoice_id: s.invoice, amount: mid.balance, method_id: s.cash },
  });
  const [done] = await db.as<{ balance: number; display_status: string; paid: number }>(owner,
    "select balance, display_status, paid from v_invoices where id = $1", [s.invoice]);
  assert.equal(done.balance, 0);
  assert.equal(done.display_status, "paid");
  const receipts = await db.as<{ number: string; received_by_name: string }>(owner,
    "select number, received_by_name from payments where id = any($1) order by number", [[p1, p2]]);
  assert.deepEqual(receipts.map((r) => r.number), ["RCT-00002", "RCT-00003"]);
  assert.equal(receipts[0].received_by_name, "Owner");
  s.payment = p2;
});

test("vehicle history shows estimate, job card and invoice with lines", async () => {
  const h = await db.rpc<Array<{ type: string; number: string; lines: unknown[] }>>(owner, "vehicle_history", { p_vehicle: s.vehicle });
  assert.deepEqual(h.map((x) => x.type).sort(), ["estimate", "invoice", "job_card"]);
  assert.ok(h.every((x) => Array.isArray(x.lines) && x.lines.length === 3));
  const second = await db.rpc<unknown[]>(owner, "vehicle_history", { p_vehicle: s.vehicle2 });
  assert.equal(second.length, 0);
});

test("dashboard and reports reflect the invoice and payments", async () => {
  const d = await db.rpc<{
    invoices_today: number; today_report: { invoiced: number; collected: number; by_kind: Record<string, number> };
    outstanding: { total: number }; low_stock: number; workshop: number;
  }>(owner, "dashboard_summary", { p_org: s.org });
  assert.equal(d.invoices_today, 1);
  assert.equal(d.today_report.invoiced, Number(s.total));
  assert.equal(d.today_report.collected, Number(s.total), "deposit + 2 payments collected today");
  assert.equal(d.outstanding.total, 0);
  assert.equal(d.low_stock, 0, "6 pads left, minimum 4");
  const [today] = await db.as<{ d: string }>(owner, "select private_today_public($1)::text as d", [s.org]);
  const r = await db.rpc<{ invoices: { count: number; average: number }; by_kind: Record<string, number>; payments_by_method: Array<{ method: string; total: number }>; by_technician: Array<{ name: string }>; monthly: unknown[] }>(
    owner, "report_summary", { p_org: s.org, p_from: today.d, p_to: today.d });
  assert.equal(r.invoices.count, 1);
  assert.equal(r.invoices.average, Number(s.total));
  assert.ok(r.by_kind.part > 0 && r.by_kind.labor > 0 && r.by_kind.service > 0);
  const byMethod = Object.fromEntries(r.payments_by_method.map((m) => [m.method, m.total]));
  assert.equal(byMethod.Card, 500);
  assert.equal(r.by_technician[0].name, "Ravi");
});

test("credit note on one brake pad with restock, then refund of the overpayment", async () => {
  const [line] = await db.as<{ id: string; total: number }>(owner,
    "select id, total from doc_lines where invoice_id = $1 and kind = 'part'", [s.invoice]);
  s.creditNote = await db.rpc<string>(owner, "create_credit_note", {
    p: { invoice_id: s.invoice, mode: "lines", reason: "One pad returned unused", restock: true,
      lines: [{ line_id: line.id, quantity: 1 }] },
  });
  const [cn] = await db.as<{ number: string; total: number }>(owner, "select number, total from credit_notes where id = $1", [s.creditNote]);
  assert.equal(cn.number, "CN-00001");
  assert.ok(Math.abs(cn.total - line.total / 4) <= 0.01);
  const [inv] = await db.as<{ balance: number; display_status: string; credited: number }>(owner,
    "select balance, display_status, credited from v_invoices where id = $1", [s.invoice]);
  assert.equal(inv.balance, -cn.total);
  assert.equal(inv.display_status, "refund_due");
  const [stock] = await db.as<{ quantity: number }>(owner, "select quantity from stock_levels where part_id = $1", [s.part]);
  assert.equal(stock.quantity, 7);

  await rejects(db.rpc(owner, "record_refund", {
    p: { org_id: s.org, invoice_id: s.invoice, amount: cn.total + 1, method_id: s.cash },
  }), "bsg.refund_exceeds_credit");
  const refund = await db.rpc<string>(owner, "record_refund", {
    p: { org_id: s.org, invoice_id: s.invoice, amount: cn.total, method_id: s.cash, credit_note_id: s.creditNote },
  });
  const [rf] = await db.as<{ number: string }>(owner, "select number from payments where id = $1", [refund]);
  assert.equal(rf.number, "RFD-00001");
  const [after] = await db.as<{ balance: number; display_status: string }>(owner,
    "select balance, display_status from v_invoices where id = $1", [s.invoice]);
  assert.equal(after.balance, 0);
  assert.equal(after.display_status, "paid");
});

test("credits can never exceed the invoice, nor a line's quantity", async () => {
  const [line] = await db.as<{ id: string }>(owner, "select id from doc_lines where invoice_id = $1 and kind = 'part'", [s.invoice]);
  await rejects(db.rpc(owner, "create_credit_note", {
    p: { invoice_id: s.invoice, mode: "lines", reason: "x", lines: [{ line_id: line.id, quantity: 4 }] },
  }), "bsg.credit_exceeds_line");
  await rejects(db.rpc(owner, "create_credit_note", {
    p: { invoice_id: s.invoice, mode: "amount", reason: "goodwill", amount: 999999 },
  }), "bsg.credit_exceeds_invoice");
  await rejects(db.rpc(owner, "create_credit_note", {
    p: { invoice_id: s.invoice, mode: "amount", reason: " ", amount: 10 },
  }), "bsg.validation");
});

test("goodwill credit by amount splits net and VAT", async () => {
  const id = await db.rpc<string>(owner, "create_credit_note", {
    p: { invoice_id: s.invoice, mode: "amount", reason: "Goodwill for the delay", amount: 105 },
  });
  const [cn] = await db.as<{ subtotal: number; vat_total: number; total: number }>(owner,
    "select subtotal, vat_total, total from credit_notes where id = $1", [id]);
  assert.deepEqual(cn, { subtotal: 100, vat_total: 5, total: 105 });
});

test("the '+ New Invoice' fast path: save, issue and take payment in one call", async () => {
  const r = await db.rpc<{ invoice_id: string; number: string; payment_id: string }>(owner, "save_invoice", {
    p: { org_id: s.org, customer_id: s.customer, vehicle_id: s.vehicle2, mileage: 88000, issue: true,
      lines: [{ kind: "service", service_id: s.service, quantity: 1, unit_price: 150 }],
      payment: { amount: 100, method_id: s.cash } },
  });
  assert.equal(r.number, "INV-00002");
  assert.ok(r.payment_id);
  const [inv] = await db.as<{ total: number; balance: number; display_status: string }>(owner,
    "select total, balance, display_status from v_invoices where id = $1", [r.invoice_id]);
  assert.equal(inv.total, 157.5);
  assert.equal(inv.balance, 57.5);
  assert.equal(inv.display_status, "partially_paid");
  s.invoice2 = r.invoice_id;
  const customerInvoices = await db.as(owner, "select id from invoices where customer_id = $1 and status = 'issued'", [s.customer]);
  assert.equal(customerInvoices.length, 2, "several invoices for the same customer");
});

test("a failed issue does not burn an invoice number (gapless)", async () => {
  const { invoice_id } = await db.rpc<{ invoice_id: string }>(owner, "save_invoice", {
    p: { org_id: s.org, customer_id: s.customer, lines: [] },
  });
  await rejects(db.rpc(owner, "issue_invoice", { p_id: invoice_id }), "bsg.invoice_empty");
  await db.rpc(owner, "delete_invoice_draft", { p_id: invoice_id });
  const r = await db.rpc<{ number: string; invoice_id: string }>(owner, "save_invoice", {
    p: { org_id: s.org, customer_id: s.customer, vehicle_id: s.vehicle, issue: true,
      lines: [{ kind: "part", part_id: s.part, quantity: 2, unit_price: 120 }] },
  });
  assert.equal(r.number, "INV-00003");
  s.invoice3 = r.invoice_id;
});

test("cancelling: refused with a payment, accepted when unpaid; stock returns; number never reused", async () => {
  await rejects(db.rpc(owner, "cancel_invoice", { p_id: s.invoice2, p_reason: "Mistake" }), "bsg.invoice_has_payments");
  await rejects(db.rpc(owner, "cancel_invoice", { p_id: s.invoice3, p_reason: "  " }), "bsg.validation");
  const [before] = await db.as<{ quantity: number }>(owner, "select quantity from stock_levels where part_id = $1", [s.part]);
  await db.rpc(owner, "cancel_invoice", { p_id: s.invoice3, p_reason: "Customer changed their mind" });
  const [inv] = await db.as<{ display_status: string; number: string; balance: number }>(owner,
    "select display_status, number, balance from v_invoices where id = $1", [s.invoice3]);
  assert.equal(inv.display_status, "cancelled");
  assert.equal(inv.number, "INV-00003");
  const [afterStock] = await db.as<{ quantity: number }>(owner, "select quantity from stock_levels where part_id = $1", [s.part]);
  assert.equal(afterStock.quantity, before.quantity + 2);
  await rejects(db.rpc(owner, "record_payment", {
    p: { org_id: s.org, invoice_id: s.invoice3, amount: 1, method_id: s.cash },
  }), "bsg.invalid_state");
  const r = await db.rpc<{ number: string }>(owner, "save_invoice", {
    p: { org_id: s.org, customer_id: s.customer, issue: true, lines: [{ kind: "other", description: "Car wash", quantity: 1, unit_price: 30 }] },
  });
  assert.equal(r.number, "INV-00004");
});

test("voiding a payment keeps the receipt, reopens the balance and is audited", async () => {
  await rejects(db.rpc(owner, "void_payment", { p_id: s.payment, p_reason: "" }), "bsg.validation");
  await db.rpc(owner, "void_payment", { p_id: s.payment, p_reason: "Card payment reversed by bank" });
  const [p] = await db.as<{ voided_at: string; void_reason: string }>(owner, "select voided_at, void_reason from payments where id = $1", [s.payment]);
  assert.ok(p.voided_at);
  const [inv] = await db.as<{ balance: number }>(owner, "select balance from v_invoices where id = $1", [s.invoice]);
  assert.ok(inv.balance > 0);
  await rejects(db.rpc(owner, "void_payment", { p_id: s.payment, p_reason: "again" }), "bsg.invalid_state");
});

test("cancel with a job-card deposit: the deposit goes back to the job card for re-invoicing", async () => {
  const jc = await db.rpc<string>(owner, "save_job_card", {
    p: { org_id: s.org, customer_id: s.customer, vehicle_id: s.vehicle2, complaint: "AC not cooling",
      lines: [{ kind: "labor", description: "AC diagnosis", quantity: 1, unit_price: 200 }] },
  });
  await db.rpc(owner, "record_payment", { p: { org_id: s.org, job_card_id: jc, amount: 50, method_id: s.cash } });
  const inv = await db.rpc<string>(owner, "create_invoice_from_job_card", { p_id: jc });
  await db.rpc(owner, "issue_invoice", { p_id: inv });
  await rejects(db.rpc(owner, "record_payment", { p: { org_id: s.org, job_card_id: jc, amount: 10, method_id: s.cash } }), "bsg.use_invoice_payment");
  await db.rpc(owner, "cancel_invoice", { p_id: inv, p_reason: "Wrong labor rate" });
  const [j] = await db.as<{ invoice_id: string | null; deposits: number }>(owner, "select invoice_id, deposits from v_job_cards where id = $1", [jc]);
  assert.equal(j.invoice_id, null);
  assert.equal(j.deposits, 50);
  const inv2 = await db.rpc<string>(owner, "create_invoice_from_job_card", { p_id: jc });
  const [d] = await db.as<{ paid: number }>(owner, "select paid from v_invoices where id = $1", [inv2]);
  assert.equal(d.paid, 50);
  // refund of an unapplied deposit when the job is abandoned
  await db.rpc(owner, "delete_invoice_draft", { p_id: inv2 });
  await rejects(db.rpc(owner, "record_refund", { p: { org_id: s.org, job_card_id: jc, amount: 60, method_id: s.cash } }), "bsg.refund_exceeds_credit");
  await db.rpc(owner, "record_refund", { p: { org_id: s.org, job_card_id: jc, amount: 50, method_id: s.cash } });
  const [j2] = await db.as<{ deposits: number }>(owner, "select deposits from v_job_cards where id = $1", [jc]);
  assert.equal(j2.deposits, 0);
});

test("estimate straight to invoice (no job card) links its deposit", async () => {
  const est = await db.rpc<string>(owner, "save_estimate", {
    p: { org_id: s.org, customer_id: s.customer, vehicle_id: s.vehicle, lines: [{ kind: "other", description: "Wheel alignment", quantity: 1, unit_price: 120 }] },
  });
  await db.rpc(owner, "record_payment", { p: { org_id: s.org, estimate_id: est, amount: 20, method_id: s.cash } });
  const inv = await db.rpc<string>(owner, "create_invoice_from_estimate", { p_id: est });
  const [i] = await db.as<{ paid: number; estimate_id: string }>(owner, "select paid, estimate_id from v_invoices where id = $1", [inv]);
  assert.equal(i.paid, 20);
  assert.equal(i.estimate_id, est);
});

test("global search: phone, plate, SKU", async () => {
  const byPhone = await db.rpc<{ customers: Array<{ display_name: string }>; vehicles: unknown[]; invoices: unknown[] }>(owner, "global_search", {
    p_org: s.org, p_text: "0501234567", p_phone_key: "501234567",
  });
  assert.equal(byPhone.customers[0].display_name, "Ahmed Al Mansoori");
  assert.equal(byPhone.vehicles.length, 2);
  assert.ok(byPhone.invoices.length >= 3);
  const byPlate = await db.rpc<{ vehicles: Array<{ make: string; customer_name: string }>; invoices: unknown[] }>(owner, "global_search", {
    p_org: s.org, p_text: "Dubai A 12345", p_plate_key: "A12345", p_plate_number: "12345", p_emirate: "DXB",
  });
  assert.equal(byPlate.vehicles[0].make, "Toyota");
  assert.equal(byPlate.vehicles[0].customer_name, "Ahmed Al Mansoori");
  assert.ok(byPlate.invoices.length >= 1);
  const bySku = await db.rpc<{ parts: Array<{ name: string; stock: number; supplier_name: string }>; suppliers: Array<{ name: string }> }>(owner, "global_search", {
    p_org: s.org, p_text: "BP-001",
  });
  assert.equal(bySku.parts[0].name, "Front brake pads");
  assert.equal(bySku.parts[0].supplier_name, "Al Quoz Auto Parts");
  assert.equal(bySku.suppliers[0].name, "Al Quoz Auto Parts");
  const mech = await db.rpc<{ invoices: unknown[]; customers: unknown[] }>(mechanicUser, "global_search", {
    p_org: s.org, p_text: "0501234567", p_phone_key: "501234567",
  });
  assert.equal(mech.invoices.length, 0, "search respects the role");
  assert.equal(mech.customers.length, 1);
});

test("purchase order: order, receive partially then fully; stock and cost update", async () => {
  const po = await db.rpc<string>(owner, "save_purchase_order", {
    p: { org_id: s.org, supplier_id: s.supplier, lines: [{ part_id: s.part, quantity: 10, unit_cost: 75 }] },
  });
  await rejects(db.rpc(owner, "receive_purchase_order", { p: { id: po, lines: [] } }), "bsg.invalid_state");
  await db.rpc(owner, "set_purchase_order_status", { p_id: po, p_status: "ordered" });
  const [line] = await db.as<{ id: string }>(owner, "select id from purchase_order_lines where purchase_order_id = $1", [po]);
  const [before] = await db.as<{ quantity: number }>(owner, "select quantity from stock_levels where part_id = $1", [s.part]);
  await db.rpc(owner, "receive_purchase_order", { p: { id: po, lines: [{ line_id: line.id, quantity: 4 }] } });
  let [p] = await db.as<{ status: string; number: string }>(owner, "select status, number from purchase_orders where id = $1", [po]);
  assert.equal(p.status, "partially_received");
  assert.equal(p.number, "PO-00001");
  await rejects(db.rpc(owner, "receive_purchase_order", { p: { id: po, lines: [{ line_id: line.id, quantity: 7 }] } }), "bsg.receive_exceeds_ordered");
  await db.rpc(owner, "receive_purchase_order", { p: { id: po, lines: [{ line_id: line.id, quantity: 6 }] } });
  [p] = await db.as<{ status: string; number: string }>(owner, "select status, number from purchase_orders where id = $1", [po]);
  assert.equal(p.status, "received");
  const [after] = await db.as<{ quantity: number }>(owner, "select quantity from stock_levels where part_id = $1", [s.part]);
  assert.equal(after.quantity, before.quantity + 10);
  const [part] = await db.as<{ purchase_price: number }>(owner, "select purchase_price from parts where id = $1", [s.part]);
  assert.equal(part.purchase_price, 75);
  const [sp] = await db.as<{ price: number }>(owner, "select price from supplier_parts where part_id = $1", [s.part]);
  assert.equal(sp.price, 75);
});

test("stock count sets the quantity and records the difference; low stock alert", async () => {
  await db.rpc(owner, "adjust_stock", { p: { org_id: s.org, part_id: s.part, kind: "count", quantity: 3, note: "Monthly count" } });
  const [lv] = await db.as<{ quantity: number; is_low: boolean }>(owner, "select quantity, is_low from v_stock where part_id = $1", [s.part]);
  assert.deepEqual(lv, { quantity: 3, is_low: true });
  const [mv] = await db.as<{ kind: string; balance_after: number }>(owner,
    "select kind, balance_after from stock_movements where part_id = $1 order by created_at desc limit 1", [s.part]);
  assert.deepEqual(mv, { kind: "count", balance_after: 3 });
});

test("inspection with the 11 checks", async () => {
  const id = await db.rpc<string>(owner, "create_inspection", { p: { org_id: s.org, vehicle_id: s.vehicle, job_card_id: s.jobCard, technician_id: s.tech } });
  const items = await db.as<{ item_key: string }>(owner, "select item_key from inspection_items where inspection_id = $1 order by position", [id]);
  assert.equal(items.length, 11);
  await db.as(mechanicUser, "update inspection_items set status = 'urgent', comment = 'Tread 2mm' where inspection_id = $1 and item_key = 'tires'", [id]);
  const [it] = await db.as<{ status: string }>(owner, "select status from inspection_items where inspection_id = $1 and item_key = 'tires'", [id]);
  assert.equal(it.status, "urgent");
});

test("appointments: a vehicle must belong to the appointment's customer", async () => {
  await rejects(db.as(owner,
    "insert into appointments(org_id, branch_id, customer_id, vehicle_id, reason, starts_at) select $1, id, $2, $3, 'Service', now() from branches where org_id = $1",
    [s.org, s.customer, "00000000-0000-0000-0000-000000000000"]), "bsg.vehicle_not_customer");
  const [a] = await db.as<{ status: string }>(owner,
    "insert into appointments(org_id, branch_id, customer_id, vehicle_id, reason, starts_at) select $1, id, $2, $3, 'Oil service', now() + interval '1 day' from branches where org_id = $1 returning status",
    [s.org, s.customer, s.vehicle]);
  assert.equal(a.status, "requested");
});

test("sending an invoice by WhatsApp link marks it sent and is logged", async () => {
  await db.rpc(owner, "log_outbound_message", {
    p: { org_id: s.org, channel: "whatsapp", purpose: "invoice_reminder", invoice_id: s.invoice2, recipient: "971501234567", body: "Reminder" },
  });
  const [i] = await db.as<{ sent_at: string }>(owner, "select sent_at from invoices where id = $1", [s.invoice2]);
  assert.ok(i.sent_at);
  const [m] = await db.as<{ delivery: string; status: string }>(owner, "select delivery, status from outbound_messages where invoice_id = $1", [s.invoice2]);
  assert.deepEqual(m, { delivery: "manual_link", status: "opened" });
});

test("audit log records who did what and when", async () => {
  await db.as(owner, "update parts set selling_price = 130 where id = $1", [s.part]);
  const rows = await db.as<{ action: string; actor_name: string }>(owner, "select action, actor_name from audit_log where org_id = $1", [s.org]);
  const actions = new Set(rows.map((r) => r.action));
  for (const a of ["invoice.created", "invoice.issued", "invoice.cancelled", "payment.recorded", "payment.voided",
    "deposit.recorded", "refund.recorded", "credit_note.created", "estimate.updated", "estimate.converted",
    "part.created", "part.price_changed", "stock.stock_in", "stock.count", "customer.created", "job_card.status_changed"]) {
    if (a === "estimate.updated") continue; // not exercised above
    assert.ok(actions.has(a), `audit has ${a}`);
  }
  assert.ok(rows.every((r) => r.actor_name));
  const [pc] = await db.as<{ details: { selling_price: { from: number; to: number } } }>(owner,
    "select details from audit_log where action = 'part.price_changed' order by id desc limit 1");
  assert.deepEqual(pc.details.selling_price, { from: 120, to: 130 });
  await rejects(db.as(owner, "delete from audit_log"), "permission denied");
  await rejects(db.as(owner, "insert into audit_log(org_id, action, entity_type, summary) values ($1, 'x', 'x', 'x')", [s.org]), "permission denied");
});
