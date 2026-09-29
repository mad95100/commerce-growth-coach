import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, daysBetween, periodRange, todayISO, dubaiTimestamp } from "../../src/lib/dates.ts";
import { mapHeaders, parseCsv, toCsv } from "../../src/lib/csv.ts";

test("today is taken in Dubai time, not UTC", () => {
  // 22:30 UTC on 28 Sep = 02:30 on 29 Sep in Dubai.
  assert.equal(todayISO(new Date("2026-09-28T22:30:00Z")), "2026-09-29");
});

test("date arithmetic crosses months and years", () => {
  assert.equal(addDays("2026-12-30", 3), "2027-01-02");
  assert.equal(daysBetween("2026-09-01", "2026-09-29"), 28);
  assert.equal(daysBetween("2026-09-29", "2026-09-01"), -28);
});

test("report periods", () => {
  const today = "2026-09-29"; // a Tuesday
  assert.deepEqual(periodRange("today", today), { from: today, to: today });
  assert.deepEqual(periodRange("week", today), { from: "2026-09-28", to: today });
  assert.deepEqual(periodRange("month", today), { from: "2026-09-01", to: today });
  assert.deepEqual(periodRange("quarter", today), { from: "2026-07-01", to: today });
  assert.deepEqual(periodRange("year", today), { from: "2026-01-01", to: today });
});

test("Dubai timestamp carries the +04:00 offset", () => {
  assert.equal(dubaiTimestamp("2026-09-29", "09:30"), "2026-09-29T09:30:00+04:00");
});

test("CSV round trip with quotes, commas, newlines and Arabic", () => {
  const rows = [{ a: 'He said "hi", ok', b: "سطر\nجديد" }];
  const csv = toCsv(rows, [
    { header: "A", value: (r) => r.a },
    { header: "B", value: (r) => r.b },
  ]);
  assert.ok(csv.startsWith("﻿"));
  assert.deepEqual(parseCsv(csv), [
    ["A", "B"],
    ['He said "hi", ok', "سطر\nجديد"],
  ]);
});

test("CSV export neutralises formulas", () => {
  const csv = toCsv([{ a: "=HYPERLINK(1)" }, { a: "-12.5" }], [{ header: "A", value: (r) => r.a }]);
  assert.ok(csv.includes("'=HYPERLINK(1)"));
  assert.ok(csv.includes("\r\n-12.5\r\n"));
});

test("CSV with semicolons (European Excel) is detected", () => {
  assert.deepEqual(parseCsv("Name;Phone\r\nAli;050\r\n"), [
    ["Name", "Phone"],
    ["Ali", "050"],
  ]);
});

test("headers are matched loosely", () => {
  const m = mapHeaders(["First Name", "MOBILE", "e-mail"], [
    { key: "first_name", label: "First name" },
    { key: "phone", label: "Phone", aliases: ["mobile"] },
    { key: "email", label: "Email" },
    { key: "notes", label: "Notes" },
  ]);
  assert.deepEqual(m, { first_name: 0, phone: 1, email: 2, notes: -1 });
});
