import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPlate, parsePlateQuery, plateKey, validatePlate } from "../../src/lib/plates.ts";
import { formatPhone, phoneSearchKey, toInternational, whatsappUrl } from "../../src/lib/phone.ts";
import { parseSearch } from "../../src/lib/search.ts";

test("plate key ignores case and separators", () => {
  assert.equal(plateKey("a", "12345"), "A12345");
  assert.equal(plateKey(" aa-", "1 23"), "AA123");
  assert.equal(plateKey(null, "777"), "777");
});

test("plate validation stays permissive across emirates", () => {
  assert.ok(validatePlate("A", "12345").ok);
  assert.ok(validatePlate("12", "4567").ok); // Abu Dhabi numeric code
  assert.ok(validatePlate("", "1").ok);
  assert.equal(validatePlate("A", "").error, "number_required");
  assert.equal(validatePlate("A", "123456").error, "number_format");
  assert.equal(validatePlate("ABCD", "1").error, "code_format");
});

test("the user's search example: 'Dubai A 12345'", () => {
  assert.deepEqual(parsePlateQuery("Dubai A 12345"), { emirate: "DXB", key: "A12345", number: "12345" });
  assert.deepEqual(parsePlateQuery("DXB-A-12345"), { emirate: "DXB", key: "A12345", number: "12345" });
  assert.deepEqual(parsePlateQuery("a12345"), { emirate: null, key: "A12345", number: "12345" });
  assert.deepEqual(parsePlateQuery("Abu Dhabi 5 777"), { emirate: "AUH", key: "5777", number: "5777" });
  assert.deepEqual(parsePlateQuery("دبي A 12345"), { emirate: "DXB", key: "A12345", number: "12345" });
});

test("text without digits is not a plate", () => {
  assert.equal(parsePlateQuery("Ahmed"), null);
  assert.equal(parsePlateQuery("brake pads"), null);
});

test("formatPlate", () => {
  assert.equal(formatPlate({ plate_emirate: "DXB", plate_code: "a", plate_number: "12345" }), "Dubai A 12345");
  assert.equal(formatPlate({ plate_emirate: "DXB", plate_code: "A", plate_number: "1" }, "ar"), "دبي A 1");
});

test("UAE phone formats all reach the same number", () => {
  for (const p of ["050 123 4567", "+971 50 123 4567", "00971501234567", "971-50-1234567", "501234567"]) {
    assert.equal(toInternational(p), "971501234567", p);
    assert.equal(phoneSearchKey(p), "501234567", p);
  }
  assert.equal(formatPhone("0501234567"), "+971 50 123 4567");
  assert.equal(phoneSearchKey("12345"), null);
});

test("WhatsApp link uses international digits and encodes the text", () => {
  assert.equal(whatsappUrl("0501234567", "Hello & bye"), "https://wa.me/971501234567?text=Hello%20%26%20bye");
  assert.equal(whatsappUrl("", "x"), null);
});

test("the user's search examples are all understood", () => {
  const phone = parseSearch("0501234567")!;
  assert.equal(phone.phoneKey, "501234567");
  const plate = parseSearch("Dubai A 12345")!;
  assert.equal(plate.plate?.key, "A12345");
  const sku = parseSearch("BP-001")!;
  assert.equal(sku.text, "BP-001");
  assert.equal(parseSearch("a"), null);
  assert.equal(parseSearch("ahmed@example.com")!.phoneKey, null);
});
