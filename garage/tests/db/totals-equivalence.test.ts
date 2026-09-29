/**
 * The totals algorithm exists in TypeScript (preview while typing) and in SQL
 * (authoritative). They must agree to the fil on every document. This test
 * generates thousands of random documents — awkward quantities, prices,
 * discounts, mixed VAT rates — and compares both implementations.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startDb, type Db } from "./helpers.ts";
import { computeTotals, type DiscountType, type LineInput } from "../../src/lib/totals.ts";

let db: Db;
before(async () => {
  db = await startDb();
});
after(async () => db?.close());

// Deterministic generator so a failure can be replayed.
function rng(seed: number) {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

function randomDoc(r: () => number) {
  const n = Math.floor(r() * 8);
  const two = (max: number) => Math.round(r() * max * 100) / 100;
  const lines: LineInput[] = Array.from({ length: n }, () => ({
    quantity: Math.max(0.01, r() < 0.5 ? Math.ceil(r() * 10) : two(12)),
    unitPrice: r() < 0.1 ? 0 : r() < 0.5 ? two(50) : two(5000),
    discountPct: r() < 0.6 ? 0 : two(100),
    taxRate: r() < 0.7 ? 5 : r() < 0.5 ? 0 : two(20),
  }));
  const kinds: DiscountType[] = [null, "percent", "amount"];
  const type = kinds[Math.floor(r() * 3)];
  const value = type === "percent" ? two(100) : type === "amount" ? two(r() < 0.2 ? 100000 : 300) : 0;
  const vatRegistered = r() > 0.1;
  return { lines, type, value, vatRegistered };
}

test("TypeScript and SQL totals agree on 3000 random documents", async () => {
  const r = rng(20260929);
  const docs = Array.from({ length: 3000 }, () => randomDoc(r));
  const payload = docs.map((d) => ({
    lines: d.lines.map((l) => ({ quantity: l.quantity, unit_price: l.unitPrice, discount_pct: l.discountPct, tax_rate: l.taxRate })),
    type: d.type,
    value: d.value,
    vat: d.vatRegistered,
  }));
  const res = await db.admin.query(
    `select private.calc_totals(d -> 'lines', d ->> 'type', (d ->> 'value')::numeric, (d ->> 'vat')::boolean) as t
     from jsonb_array_elements($1::jsonb) with ordinality as x(d, i) order by i`,
    [JSON.stringify(payload)],
  );
  let checked = 0;
  docs.forEach((d, i) => {
    const sql = res.rows[i].t;
    const ts = computeTotals(d.lines, d.type, d.value, { vatRegistered: d.vatRegistered });
    const ctx = `doc #${i}: ${JSON.stringify(payload[i])}`;
    assert.equal(Number(sql.subtotal), ts.subtotal, `subtotal ${ctx}`);
    assert.equal(Number(sql.doc_discount), ts.docDiscount, `discount ${ctx}`);
    assert.equal(Number(sql.vat_total), ts.vatTotal, `vat ${ctx}`);
    assert.equal(Number(sql.total), ts.total, `total ${ctx}`);
    sql.lines.forEach((l: Record<string, number>, k: number) => {
      const t = ts.lines[k];
      assert.deepEqual(
        [l.gross, l.discount, l.net, l.doc_discount, l.taxable, l.vat, l.total].map(Number),
        [t.gross, t.discount, t.net, t.docDiscount, t.taxable, t.vat, t.total],
        `line ${k} ${ctx}`,
      );
    });
    assert.deepEqual(
      sql.vat_breakdown.map((g: Record<string, number>) => [Number(g.rate), Number(g.taxable), Number(g.vat)]),
      ts.vatBreakdown.map((g) => [g.rate, g.taxable, g.vat]),
      `breakdown ${ctx}`,
    );
    checked++;
  });
  assert.equal(checked, 3000);
});
