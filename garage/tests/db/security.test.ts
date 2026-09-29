/**
 * Multi-tenant isolation, anonymous access, and the role permission matrix,
 * against real row-level security. "No data can ever mix between garages."
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { rejects, startDb, type Db } from "./helpers.ts";

let db: Db;
const u: Record<string, string> = {};
const a: Record<string, string> = {}; // garage A ids
const b: Record<string, string> = {}; // garage B ids

async function member(org: string, role: string, email: string) {
  const id = await db.createUser(email);
  await db.admin.query("insert into memberships(org_id, user_id, role, email) values ($1, $2, $3, $4)", [org, id, role, email]);
  return id;
}

before(async () => {
  db = await startDb();
  u.ownerA = await db.createUser("owner-a@garage.test");
  u.ownerB = await db.createUser("owner-b@garage.test");
  a.org = await db.rpc<string>(u.ownerA, "create_organization", { p: { name: "Garage A", vat_rate: 5 } });
  b.org = await db.rpc<string>(u.ownerB, "create_organization", { p: { name: "Garage B", vat_rate: 5 } });
  for (const [ids, owner] of [[a, u.ownerA], [b, u.ownerB]] as const) {
    const [c] = await db.as<{ id: string }>(owner, "insert into customers(org_id, first_name, phone) values ($1, 'Cust', '0501111111') returning id", [ids.org]);
    ids.customer = c.id;
    const [v] = await db.as<{ id: string }>(owner, "insert into vehicles(org_id, customer_id, plate_emirate, plate_code, plate_number) values ($1, $2, 'DXB', 'A', '1') returning id", [ids.org, c.id]);
    ids.vehicle = v.id;
    const [m] = await db.as<{ id: string }>(owner, "select id from payment_methods where org_id = $1 and kind = 'cash'", [ids.org]);
    ids.cash = m.id;
    const [p] = await db.as<{ id: string }>(owner, "insert into parts(org_id, sku, name, selling_price) values ($1, 'P-1', 'Filter', 50) returning id", [ids.org]);
    ids.part = p.id;
    const r = await db.rpc<{ invoice_id: string }>(owner, "save_invoice", {
      p: { org_id: ids.org, customer_id: c.id, vehicle_id: v.id, issue: true, lines: [{ kind: "part", part_id: p.id, quantity: 1, unit_price: 50 }] },
    });
    ids.invoice = r.invoice_id;
  }
  u.admin = await member(a.org, "admin", "admin@garage.test");
  u.manager = await member(a.org, "manager", "manager@garage.test");
  u.advisor = await member(a.org, "service_advisor", "advisor@garage.test");
  u.mechanic = await member(a.org, "mechanic", "mechanic@garage.test");
  u.accountant = await member(a.org, "accountant", "accountant@garage.test");
  u.stranger = await db.createUser("stranger@garage.test");
});
after(async () => db?.close());

const tenantTables = [
  "organizations", "branches", "memberships", "tax_rates", "payment_methods", "document_sequences", "customers",
  "vehicles", "parts", "stock_levels", "stock_movements", "invoices", "doc_lines", "payments", "estimates",
  "job_cards", "credit_notes", "audit_log", "v_invoices", "v_stock", "suppliers", "services", "appointments",
  "inspections", "outbound_messages", "purchase_orders",
];

test("garage B's owner sees nothing of garage A, in any table or view", async () => {
  for (const t of tenantTables) {
    const col = t === "organizations" ? "id" : "org_id";
    const rows = await db.as(u.ownerB, `select 1 from ${t} where ${col} = $1`, [a.org]);
    assert.equal(rows.length, 0, `${t} leaks garage A to garage B`);
  }
});

test("a signed-in user with no garage sees nothing at all", async () => {
  for (const t of tenantTables) {
    const rows = await db.as(u.stranger, `select 1 from ${t}`);
    assert.equal(rows.length, 0, `${t} visible to a stranger`);
  }
});

test("anonymous visitors can read nothing and call nothing", async () => {
  for (const t of ["customers", "invoices", "payments", "organizations", "role_permissions", "v_invoices"]) {
    await rejects(db.as(null, `select 1 from ${t}`), "permission denied");
  }
  await rejects(db.as(null, "select public.create_organization('{}'::jsonb)"), "permission denied");
  await rejects(db.as(null, "select public.global_search($1, 'x')", [a.org]), "permission denied");
});

test("nobody calls internal helpers directly", async () => {
  await rejects(db.as(u.ownerA, "select private.next_number($1, 'invoice')", [a.org]), "permission denied");
  await rejects(db.as(u.ownerA, "select private.move_stock($1, null, $2, 100, 'stock_in')", [a.org, a.part]), "permission denied");
  await rejects(db.as(u.ownerA, "select private.issue_invoice($1)", [a.invoice]), "permission denied");
});

test("garage B cannot write into garage A, nor reference garage A's rows", async () => {
  await rejects(db.as(u.ownerB, "insert into customers(org_id, first_name) values ($1, 'Intruder')", [a.org]), "row-level security");
  await rejects(db.rpc(u.ownerB, "save_invoice", { p: { org_id: a.org, customer_id: a.customer, lines: [] } }), "bsg.permission_denied");
  // B's own garage, but A's customer id: refused
  await rejects(db.rpc(u.ownerB, "save_invoice", { p: { org_id: b.org, customer_id: a.customer, lines: [] } }), "bsg.not_found");
  // B's own garage, A's part on a line
  await rejects(db.rpc(u.ownerB, "save_invoice", {
    p: { org_id: b.org, customer_id: b.customer, lines: [{ kind: "part", part_id: a.part, quantity: 1, unit_price: 1 }] },
  }), "bsg.not_found");
  // A vehicle of garage B cannot be attached to garage A's customer (composite key)
  await rejects(db.as(u.ownerB, "insert into vehicles(org_id, customer_id, plate_number) values ($1, $2, '9')", [b.org, a.customer]), "foreign key");
  await rejects(db.rpc(u.ownerB, "record_payment", { p: { org_id: b.org, invoice_id: a.invoice, amount: 1, method_id: b.cash } }), "bsg.not_found");
  await rejects(db.rpc(u.ownerB, "record_payment", { p: { org_id: a.org, invoice_id: a.invoice, amount: 1, method_id: a.cash } }), "bsg.permission_denied");
  await rejects(db.rpc(u.ownerB, "cancel_invoice", { p_id: a.invoice, p_reason: "x" }), "bsg.permission_denied");
  await rejects(db.rpc(u.ownerB, "void_payment", { p_id: "00000000-0000-0000-0000-000000000000", p_reason: "x" }), "bsg.not_found");
  await rejects(db.rpc(u.ownerB, "issue_invoice", { p_id: a.invoice }), "bsg.permission_denied");
  await rejects(db.rpc(u.ownerB, "adjust_stock", { p: { org_id: a.org, part_id: a.part, kind: "stock_in", quantity: 5 } }), "bsg.permission_denied");
  await rejects(db.rpc(u.ownerB, "adjust_stock", { p: { org_id: b.org, part_id: a.part, kind: "stock_in", quantity: 5 } }), "bsg.not_found");
  const upd = await db.as(u.ownerB, "update customers set first_name = 'Hacked' where id = $1 returning id", [a.customer]);
  assert.equal(upd.length, 0);
  const search = await db.rpc<{ customers: unknown[] }>(u.ownerB, "global_search", { p_org: a.org, p_text: "Cust" });
  assert.equal(search.customers.length, 0);
  await rejects(db.rpc(u.ownerB, "report_summary", { p_org: a.org, p_from: "2020-01-01", p_to: "2030-01-01" }), "bsg.permission_denied");
  await rejects(db.rpc(u.ownerB, "dashboard_summary", { p_org: a.org }), "bsg.permission_denied");
  const hist = await db.rpc<unknown[]>(u.ownerB, "vehicle_history", { p_vehicle: a.vehicle });
  assert.equal(hist.length, 0);
});

test("numbering is per garage: each starts at INV-00001", async () => {
  const rows = await db.admin.query("select number from invoices order by number");
  assert.deepEqual(rows.rows.map((r) => r.number), ["INV-00001", "INV-00001"]);
});

test("identity columns cannot be rewritten", async () => {
  await rejects(db.as(u.ownerA, "update customers set org_id = $1 where id = $2", [b.org, a.customer]), "permission denied");
  await rejects(db.as(u.ownerA, "update organizations set created_by = $1 where id = $2", [u.ownerB, a.org]), "permission denied");
  await rejects(db.as(u.ownerA, "insert into memberships(org_id, user_id, role) values ($1, $2, 'owner')", [a.org, u.stranger]), "permission denied");
  await rejects(db.as(u.ownerA, "update document_sequences set next_number = 1"), "permission denied");
});

// -----------------------------------------------------------------------------
// Role matrix: what each role can and cannot do, checked against the database.
// -----------------------------------------------------------------------------
async function can(p: Promise<unknown>): Promise<boolean> {
  try {
    await p;
    return true;
  } catch (e) {
    const m = (e as Error).message;
    if (m.includes("permission_denied") || m.includes("permission denied") || m.includes("row-level security")) return false;
    throw e;
  }
}

test("role matrix enforced by the database", async () => {
  const draft = (user: string) => db.rpc(user, "save_invoice", { p: { org_id: a.org, customer_id: a.customer, lines: [] } });
  const pay = (user: string) => db.rpc(user, "record_payment", { p: { org_id: a.org, invoice_id: a.invoice, amount: 1, method_id: a.cash } });
  const price = (user: string) => db.as(user, "update parts set selling_price = selling_price + 1 where id = $1 returning id", [a.part]).then((r) => {
    if (r.length === 0) throw new Error("permission denied (0 rows)");
  });
  const newCustomer = (user: string) => db.as(user, "insert into customers(org_id, first_name) values ($1, 'X')", [a.org]);
  const stock = (user: string) => db.rpc(user, "adjust_stock", { p: { org_id: a.org, part_id: a.part, kind: "stock_in", quantity: 1 } });
  const settings = (user: string) => db.as(user, "update organizations set phone = '04' where id = $1 returning id", [a.org]).then((r) => {
    if (r.length === 0) throw new Error("permission denied (0 rows)");
  });
  const invite = (user: string, email: string) => db.rpc(user, "invite_member", { p_org: a.org, p_email: email, p_role: "mechanic" });
  const report = (user: string) => db.rpc(user, "report_summary", { p_org: a.org, p_from: "2020-01-01", p_to: "2030-01-01" });
  const readInvoices = (user: string) => db.as(user, "select id from invoices").then((r) => {
    if (r.length === 0) throw new Error("permission denied (0 rows)");
  });
  const audit = (user: string) => db.as(user, "select id from audit_log").then((r) => {
    if (r.length === 0) throw new Error("permission denied (0 rows)");
  });

  const expected: Record<string, Record<string, boolean>> = {
    //            draft  pay    price  cust   stock  settings invite report readInv audit
    admin:      { draft: true, pay: true, price: true, cust: true, stock: true, settings: true, invite: true, report: true, readInv: true, audit: true },
    manager:    { draft: true, pay: true, price: true, cust: true, stock: true, settings: false, invite: false, report: true, readInv: true, audit: true },
    advisor:    { draft: true, pay: true, price: false, cust: true, stock: false, settings: false, invite: false, report: false, readInv: true, audit: false },
    mechanic:   { draft: false, pay: false, price: false, cust: false, stock: false, settings: false, invite: false, report: false, readInv: false, audit: false },
    accountant: { draft: false, pay: true, price: false, cust: false, stock: false, settings: false, invite: false, report: true, readInv: true, audit: true },
  };
  let n = 0;
  for (const [role, exp] of Object.entries(expected)) {
    const user = u[role];
    const got = {
      draft: await can(draft(user)),
      pay: await can(pay(user)),
      price: await can(price(user)),
      cust: await can(newCustomer(user)),
      stock: await can(stock(user)),
      settings: await can(settings(user)),
      invite: await can(invite(user, `new-${role}-${n++}@garage.test`)),
      report: await can(report(user)),
      readInv: await can(readInvoices(user)),
      audit: await can(audit(user)),
    };
    assert.deepEqual(got, exp, `role ${role}`);
  }
});

test("only managers and above cancel invoices, void payments; accountants issue credit notes", async () => {
  const r = await db.rpc<{ invoice_id: string }>(u.advisor, "save_invoice", {
    p: { org_id: a.org, customer_id: a.customer, issue: true, lines: [{ kind: "other", description: "Wash", quantity: 1, unit_price: 20 }] },
  });
  await rejects(db.rpc(u.advisor, "cancel_invoice", { p_id: r.invoice_id, p_reason: "x" }), "bsg.permission_denied");
  await rejects(db.rpc(u.accountant, "cancel_invoice", { p_id: r.invoice_id, p_reason: "x" }), "bsg.permission_denied");
  const pid = await db.rpc<string>(u.advisor, "record_payment", { p: { org_id: a.org, invoice_id: r.invoice_id, amount: 5, method_id: a.cash } });
  await rejects(db.rpc(u.advisor, "void_payment", { p_id: pid, p_reason: "x" }), "bsg.permission_denied");
  await db.rpc(u.accountant, "void_payment", { p_id: pid, p_reason: "Entered twice" });
  await rejects(db.rpc(u.advisor, "create_credit_note", { p: { invoice_id: r.invoice_id, mode: "amount", amount: 1, reason: "x" } }), "bsg.permission_denied");
  await db.rpc(u.accountant, "create_credit_note", { p: { invoice_id: r.invoice_id, mode: "amount", amount: 1, reason: "Rounding goodwill" } });
  await rejects(db.rpc(u.manager, "cancel_invoice", { p_id: r.invoice_id, p_reason: "x" }), "bsg.invoice_has_credit_notes");
});

test("team management: invitations, owner protection, no self-demotion", async () => {
  const email = "newhire@garage.test";
  await db.rpc(u.admin, "invite_member", { p_org: a.org, p_email: email, p_role: "service_advisor", p_name: "New Hire" });
  await rejects(db.rpc(u.admin, "invite_member", { p_org: a.org, p_email: "boss@garage.test", p_role: "owner" }), "bsg.permission_denied");
  const hire = await db.createUser(email);
  const joined = await db.rpc<number>(hire, "accept_invitations", {});
  assert.equal(joined, 1);
  const [m] = await db.as<{ role: string; display_name: string }>(hire, "select role, display_name from memberships where org_id = $1 and user_id = $2", [a.org, hire]);
  assert.deepEqual(m, { role: "service_advisor", display_name: "New Hire" });
  assert.equal(await db.rpc<number>(hire, "accept_invitations", {}), 0, "an invitation is used once");
  await rejects(db.rpc(u.admin, "update_member", { p_org: a.org, p_user: u.ownerA, p_role: "mechanic", p_active: true }), "bsg.permission_denied");
  await rejects(db.rpc(u.ownerA, "update_member", { p_org: a.org, p_user: u.ownerA, p_role: "admin", p_active: true }), "bsg.cannot_change_self");
  await db.rpc(u.admin, "update_member", { p_org: a.org, p_user: hire, p_role: "mechanic", p_active: false });
  const rows = await db.as(hire, "select id from customers");
  assert.equal(rows.length, 0, "a deactivated member loses access immediately");
});
