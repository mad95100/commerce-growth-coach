/**
 * Money helpers. Amounts travel as AED numbers with at most 2 decimals (the
 * database type is numeric(14,2)); every calculation happens in integer fils.
 */

export const CURRENCY = "AED";

/** AED number → integer fils. Safe for any value stored as numeric(14,2). */
export function toFils(aed: number | string | null | undefined): number {
  if (aed === null || aed === undefined || aed === "") return 0;
  const n = typeof aed === "number" ? aed : Number(aed);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function fromFils(fils: number | bigint): number {
  return Number(fils) / 100;
}

/**
 * Parses what a person types in an amount field: "1,250.5", "1250", " 99.90 ".
 * Returns fils, or null when the text is not a valid non-negative amount with at
 * most two decimals. Never guesses: "12.345" is rejected, not rounded.
 */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[\s,]/g, "").replace(/^AED/i, "");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  const fils = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return Number.isSafeInteger(fils) ? fils : null;
}

/** Parses a decimal quantity (e.g. hours "1.5") with at most 2 decimals. */
export function parseQuantity(input: string): number | null {
  const cleaned = input.replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return n > 0 ? n : null;
}

const formatters = new Map<string, Intl.NumberFormat>();
function numberFormat(locale: string): Intl.NumberFormat {
  const key = locale;
  let f = formatters.get(key);
  if (!f) {
    // Latin digits in both languages: usual on UAE business documents.
    f = new Intl.NumberFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-AE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    formatters.set(key, f);
  }
  return f;
}

/** "AED 1,250.00". Negative amounts keep the sign before the currency. */
export function formatMoney(aed: number | string | null | undefined, locale = "en"): string {
  const fils = toFils(aed);
  const abs = numberFormat(locale).format(Math.abs(fils) / 100);
  return `${fils < 0 ? "−" : ""}${CURRENCY} ${abs}`;
}

/** Plain number with 2 decimals, no currency (tables with a currency header). */
export function formatAmount(aed: number | string | null | undefined, locale = "en"): string {
  const fils = toFils(aed);
  return `${fils < 0 ? "−" : ""}${numberFormat(locale).format(Math.abs(fils) / 100)}`;
}

/** Compact dashboard figure: AED 127.5K. Only for charts axes, never documents. */
export function formatMoneyCompact(aed: number, locale = "en"): string {
  const f = new Intl.NumberFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-AE", {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  return `${CURRENCY} ${f.format(aed)}`;
}
