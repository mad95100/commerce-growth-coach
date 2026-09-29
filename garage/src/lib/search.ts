import { parsePlateQuery, type PlateQuery } from "./plates.ts";
import { phoneSearchKey } from "./phone.ts";

/**
 * Turns what the user typed in the global search into the parameters of the
 * `global_search` database function. All the interpretation happens here, in
 * one tested place; the SQL only matches.
 */
export interface SearchParams {
  text: string; // trimmed, for name / email / VIN / SKU / numbers
  phoneKey: string | null;
  plate: PlateQuery | null;
}

export function parseSearch(q: string): SearchParams | null {
  const text = q.trim().replace(/\s+/g, " ");
  if (text.length < 2) return null;
  const looksLikeEmail = text.includes("@");
  return {
    text,
    phoneKey: looksLikeEmail ? null : phoneSearchKey(text),
    plate: looksLikeEmail ? null : parsePlateQuery(text),
  };
}

/** Escapes a value for a PostgREST `ilike` filter. */
export function ilikePattern(s: string): string {
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/[,()]/g, " ")}%`;
}
