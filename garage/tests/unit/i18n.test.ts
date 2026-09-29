import { test } from "node:test";
import assert from "node:assert/strict";
import { AR } from "../../src/lib/i18n-ar.ts";
import { collectKeys } from "./i18n-keys.ts";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("every interface string has an Arabic translation", () => {
  const { keys, where } = collectKeys();
  const missing = [...keys].filter((k) => !(k in AR));
  assert.ok(keys.size > 300, `only ${keys.size} strings found: the extraction is broken`);
  assert.deepEqual(
    missing.map((k) => `${where.get(k)}: ${k}`),
    [],
    `${missing.length} string(s) without Arabic translation`,
  );
});

test("Arabic translations keep the same {placeholders}", () => {
  const bad = Object.entries(AR).filter(([en, ar]) => placeholders(en).join() !== placeholders(ar).join());
  assert.deepEqual(bad, []);
});

test("no Arabic entry is left empty or untranslated English", () => {
  const bad = Object.entries(AR).filter(([en, ar]) => !ar.trim() || (ar === en && /[a-z]{4,}/.test(en) && !/^[A-Z0-9 \-/.]+$/.test(en)));
  assert.deepEqual(bad, []);
});
