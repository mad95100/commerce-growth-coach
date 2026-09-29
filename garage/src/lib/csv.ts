/**
 * CSV import and export. Excel opens and saves CSV; a UTF-8 byte order mark
 * makes it read Arabic text correctly.
 */

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

function escapeCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Neutralise spreadsheet formulas (CSV injection): =, +, -, @ at the start.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => escapeCell(c.header)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => escapeCell(c.value(r))).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/**
 * Parses CSV text (RFC 4180 quotes, CRLF or LF). Detects `;` as separator when
 * the header has more semicolons than commas (European Excel exports).
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Normalises a header for matching: "First Name" ≈ "first_name" ≈ "firstname". */
export function headerKey(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface ImportField {
  key: string;
  label: string;
  required?: boolean;
  aliases?: string[];
}

/** Maps CSV headers to fields. Returns the column index per field key (or -1). */
export function mapHeaders(headers: string[], fields: ImportField[]): Record<string, number> {
  const keys = headers.map(headerKey);
  const out: Record<string, number> = {};
  for (const f of fields) {
    const candidates = [f.key, f.label, ...(f.aliases ?? [])].map(headerKey);
    out[f.key] = keys.findIndex((k) => candidates.includes(k));
  }
  return out;
}
