import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMoney, parseAmount, parseQuantity, toFils } from "../../src/lib/money.ts";

test("parseAmount accepts what people type", () => {
  assert.equal(parseAmount("1,250.5"), 125050);
  assert.equal(parseAmount(" 99.90 "), 9990);
  assert.equal(parseAmount("AED 10"), 1000);
  assert.equal(parseAmount("0"), 0);
});

test("parseAmount rejects instead of guessing", () => {
  assert.equal(parseAmount("12.345"), null);
  assert.equal(parseAmount("-5"), null);
  assert.equal(parseAmount("abc"), null);
  assert.equal(parseAmount(""), null);
});

test("parseQuantity allows hours with decimals, rejects zero", () => {
  assert.equal(parseQuantity("1.5"), 1.5);
  assert.equal(parseQuantity("1,5"), 1.5);
  assert.equal(parseQuantity("0"), null);
});

test("toFils is exact for 2-decimal values", () => {
  assert.equal(toFils(1.15), 115);
  assert.equal(toFils("2500.10"), 250010);
  assert.equal(toFils(null), 0);
});

test("formatMoney shows AED with 2 decimals and Latin digits in Arabic", () => {
  assert.equal(formatMoney(2500), "AED 2,500.00");
  assert.equal(formatMoney(-500), "−AED 500.00");
  assert.match(formatMoney(1234.5, "ar"), /^AED 1[,٬]234[.٫]50$/);
});
