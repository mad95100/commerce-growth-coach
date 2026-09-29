/** Collects every string the interface translates (used by the i18n test). */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as status from "../../src/lib/status.ts";
import * as labels from "../../src/lib/labels.ts";
import { AUDIT_LABELS } from "../../src/lib/audit.ts";
import { NOT_FOUND } from "../../src/lib/errors.ts";
import { EMIRATES } from "../../src/lib/plates.ts";
import { NAV } from "../../src/components/layout/nav.ts";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(f) && !f.endsWith(".gen.ts") && !f.startsWith("i18n-ar") ? [p] : [];
  });
}

function values(x: unknown): string[] {
  if (typeof x === "string") return [x];
  if (Array.isArray(x)) return x.flatMap(values);
  if (x && typeof x === "object") return Object.values(x).flatMap(values);
  return [];
}

export function collectKeys(): { keys: Set<string>; where: Map<string, string> } {
  const keys = new Set<string>();
  const where = new Map<string, string>();
  const re = /\bt\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g;
  const plural = /\btn\([^,]+,\s*"((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)"/g;
  for (const f of files(SRC)) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(plural)) {
      for (const k of [m[1], m[2]]) {
        keys.add(k);
        if (!where.has(k)) where.set(k, f.slice(SRC.length + 1));
      }
    }
    for (const m of src.matchAll(re)) {
      const k = (m[1] ?? m[2]).replace(/\\(["'\\])/g, "$1");
      keys.add(k);
      if (!where.has(k)) where.set(k, f.slice(SRC.length + 1));
    }
  }
  const add = (list: string[], from: string) => list.forEach((k) => (keys.add(k), where.has(k) || where.set(k, from)));
  for (const m of [status.INVOICE_STATUS, status.ESTIMATE_STATUS, status.JOB_STATUS, status.APPOINTMENT_STATUS, status.PO_STATUS, status.INSPECTION_ITEM_STATUS]) {
    add(Object.values(m).map((v) => v.label), "lib/status.ts");
  }
  add(values([status.ROLES, status.LINE_KINDS, status.MOVEMENT_LABEL]), "lib/status.ts");
  add(values(AUDIT_LABELS), "lib/audit.ts");
  add(values(NOT_FOUND), "lib/errors.ts");
  add(EMIRATES.map((e) => e.en), "lib/plates.ts");
  add(
    values([labels.DOC_LABEL, labels.ROLE_HELP, labels.SUGGESTED_SERVICES, labels.INSPECTION_ITEMS, labels.FUEL, labels.TRANSMISSION, labels.IMPORT_KINDS, labels.PAYMENT_KIND]).concat(labels.AUDIT_AREAS.map((a) => a[1])),
    "lib/labels.ts",
  );
  add(NAV.flatMap((g) => [g.group, ...g.items.map((i) => i.label)]), "components/layout/nav.ts");
  return { keys, where };
}
