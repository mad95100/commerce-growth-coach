import { test } from "node:test";
import assert from "node:assert/strict";
import { allocate, computeTotals, invoiceBalance } from "../../src/lib/totals.ts";

test("the user's example: parts + labor with 5% VAT", () => {
  const t = computeTotals([
    { quantity: 4, unitPrice: 120, discountPct: 0, taxRate: 5 }, // brake pads
    { quantity: 1.5, unitPrice: 200, discountPct: 0, taxRate: 5 }, // labor hours
  ]);
  assert.equal(t.subtotal, 780);
  assert.equal(t.vatTotal, 39);
  assert.equal(t.total, 819);
  assert.deepEqual(
    t.lines.map((l) => l.total),
    [504, 315],
  );
});

test("line discount then document percent discount before VAT", () => {
  const t = computeTotals(
    [
      { quantity: 1, unitPrice: 1000, discountPct: 10, taxRate: 5 },
      { quantity: 2, unitPrice: 250, discountPct: 0, taxRate: 5 },
    ],
    "percent",
    10,
  );
  // 900 + 500 = 1400; 10% = 140; taxable 1260; VAT 63; total 1323
  assert.equal(t.lineDiscounts, 100);
  assert.equal(t.subtotal, 1400);
  assert.equal(t.docDiscount, 140);
  assert.equal(t.taxable, 1260);
  assert.equal(t.vatTotal, 63);
  assert.equal(t.total, 1323);
});

test("amount discount is capped at the subtotal", () => {
  const t = computeTotals([{ quantity: 1, unitPrice: 50, discountPct: 0, taxRate: 5 }], "amount", 80);
  assert.equal(t.docDiscount, 50);
  assert.equal(t.total, 0);
});

test("allocated discounts and VAT always add up exactly", () => {
  const t = computeTotals(
    [
      { quantity: 3, unitPrice: 33.33, discountPct: 0, taxRate: 5 },
      { quantity: 1, unitPrice: 0.01, discountPct: 0, taxRate: 5 },
      { quantity: 7, unitPrice: 14.29, discountPct: 3.5, taxRate: 0 },
    ],
    "amount",
    10.01,
  );
  const sum = (k: "docDiscount" | "vat" | "total") =>
    Math.round(t.lines.reduce((s, l) => s + l[k] * 100, 0));
  assert.equal(sum("docDiscount"), Math.round(t.docDiscount * 100));
  assert.equal(sum("vat"), Math.round(t.vatTotal * 100));
  assert.equal(sum("total"), Math.round(t.total * 100));
});

test("VAT is computed once per rate, not per line", () => {
  // Three lines of 0.10 at 5%: per-line rounding would give 0.03, per-rate gives 0.02.
  const t = computeTotals(
    Array.from({ length: 3 }, () => ({ quantity: 1, unitPrice: 0.1, discountPct: 0, taxRate: 5 })),
  );
  assert.equal(t.vatTotal, 0.02);
  assert.equal(t.vatBreakdown.length, 1);
});

test("mixed rates produce one VAT group each", () => {
  const t = computeTotals([
    { quantity: 1, unitPrice: 100, discountPct: 0, taxRate: 5 },
    { quantity: 1, unitPrice: 100, discountPct: 0, taxRate: 0 },
  ]);
  assert.deepEqual(t.vatBreakdown, [
    { rate: 5, taxable: 100, vat: 5 },
    { rate: 0, taxable: 100, vat: 0 },
  ]);
});

test("a garage not registered for VAT charges no VAT", () => {
  const t = computeTotals([{ quantity: 1, unitPrice: 100, discountPct: 0, taxRate: 5 }], null, 0, {
    vatRegistered: false,
  });
  assert.equal(t.vatTotal, 0);
  assert.equal(t.total, 100);
});

test("half-up rounding on fractional fils", () => {
  // 1.5 h × 0.33 = 0.495 → 0.50
  const t = computeTotals([{ quantity: 1.5, unitPrice: 0.33, discountPct: 0, taxRate: 0 }]);
  assert.equal(t.lines[0].gross, 0.5);
});

test("floating point never leaks: 0.1 + 0.2 style inputs", () => {
  const t = computeTotals([
    { quantity: 1, unitPrice: 0.1, discountPct: 0, taxRate: 0 },
    { quantity: 1, unitPrice: 0.2, discountPct: 0, taxRate: 0 },
  ]);
  assert.equal(t.total, 0.3);
});

test("empty document totals are zero", () => {
  const t = computeTotals([], "percent", 10);
  assert.equal(t.total, 0);
  assert.equal(t.vatBreakdown.length, 0);
});

test("allocate: ties go to the earlier line, sum is exact", () => {
  assert.deepEqual(allocate(1n, [1n, 1n]), [1n, 0n]);
  assert.deepEqual(allocate(10n, [1n, 1n, 1n]), [4n, 3n, 3n]);
  assert.deepEqual(allocate(0n, [5n, 5n]), [0n, 0n]);
  assert.deepEqual(allocate(5n, [0n, 0n]), [0n, 0n]);
});

test("balance: the user's example and a refund due", () => {
  assert.equal(invoiceBalance({ total: 2500, credited: 0, paid: 1000, refunded: 0 }), 1500);
  assert.equal(invoiceBalance({ total: 2500, credited: 500, paid: 2500, refunded: 0 }), -500);
  assert.equal(invoiceBalance({ total: 2500, credited: 500, paid: 2500, refunded: 500 }), 0);
});
