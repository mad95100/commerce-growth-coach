/**
 * Translation core (no React). UI strings are written in English inside t();
 * the Arabic dictionary maps them. See i18n.tsx for the provider and RTL.
 */
import { AR } from "./i18n-ar.ts";

export type Lang = "en" | "ar";
export const STORAGE_KEY = "bsg-lang";

function initialLang(): Lang {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === "ar" ? "ar" : "en";
  } catch {
    return "en";
  }
}

let current: Lang = initialLang();

export function lang(): Lang {
  return current;
}

export function setCurrentLang(l: Lang) {
  current = l;
}

export function t(key: string, vars?: Record<string, string | number>): string {
  let s = current === "ar" ? (AR[key] ?? key) : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Count-aware text: tn(1, "{n} invoice", "{n} invoices") → "1 invoice". */
export function tn(n: number, one: string, other: string, vars?: Record<string, string | number>): string {
  return t(n === 1 ? one : other, { n, ...vars });
}
