/**
 * UAE number plates.
 *
 * A plate is stored as three parts: emirate, code and number. Formats differ
 * by emirate and change over time (Dubai letters A–Z then AA…, Abu Dhabi
 * numeric codes, Sharjah colours…), so validation stays permissive: a code of
 * up to 3 letters/digits and a number of 1 to 5 digits. What matters for the
 * garage is that "Dubai A 12345", "A12345" and "a-12345" find the same car.
 */

export interface Emirate {
  code: EmirateCode;
  en: string;
  ar: string;
  aliases: string[];
}

export type EmirateCode = "DXB" | "AUH" | "SHJ" | "AJM" | "UAQ" | "RAK" | "FUJ";

export const EMIRATES: Emirate[] = [
  { code: "DXB", en: "Dubai", ar: "دبي", aliases: ["dubai", "dxb", "dubay", "دبي"] },
  {
    code: "AUH",
    en: "Abu Dhabi",
    ar: "أبوظبي",
    aliases: ["abu dhabi", "abudhabi", "auh", "ad", "أبوظبي", "ابوظبي"],
  },
  { code: "SHJ", en: "Sharjah", ar: "الشارقة", aliases: ["sharjah", "shj", "الشارقة"] },
  { code: "AJM", en: "Ajman", ar: "عجمان", aliases: ["ajman", "ajm", "عجمان"] },
  {
    code: "UAQ",
    en: "Umm Al Quwain",
    ar: "أم القيوين",
    aliases: ["umm al quwain", "umm al qaiwain", "uaq", "أم القيوين"],
  },
  {
    code: "RAK",
    en: "Ras Al Khaimah",
    ar: "رأس الخيمة",
    aliases: ["ras al khaimah", "rak", "رأس الخيمة"],
  },
  { code: "FUJ", en: "Fujairah", ar: "الفجيرة", aliases: ["fujairah", "fuj", "الفجيرة"] },
];

export function emirateName(code: string | null | undefined, locale = "en"): string {
  const e = EMIRATES.find((x) => x.code === code);
  if (!e) return code ?? "";
  return locale === "ar" ? e.ar : e.en;
}

/** Search key: upper-case letters and digits only. "a-123 45" → "A12345". */
export function plateKey(code: string | null | undefined, number: string | null | undefined): string {
  return `${code ?? ""}${number ?? ""}`.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export interface PlateCheck {
  ok: boolean;
  error?: "number_required" | "number_format" | "code_format";
}

export function validatePlate(code: string, number: string): PlateCheck {
  const n = number.trim();
  const c = code.trim();
  if (n === "") return { ok: false, error: "number_required" };
  if (!/^\d{1,5}$/.test(n)) return { ok: false, error: "number_format" };
  if (c !== "" && !/^[A-Za-z0-9]{1,3}$/.test(c)) return { ok: false, error: "code_format" };
  return { ok: true };
}

/** "Dubai A 12345" (or "دبي A 12345"). */
export function formatPlate(
  p: { plate_emirate?: string | null; plate_code?: string | null; plate_number?: string | null },
  locale = "en",
): string {
  const parts = [
    p.plate_emirate ? emirateName(p.plate_emirate, locale) : "",
    (p.plate_code ?? "").toUpperCase(),
    p.plate_number ?? "",
  ].filter((x) => x !== "");
  return parts.join(" ");
}

export interface PlateQuery {
  emirate: EmirateCode | null;
  key: string; // code+number as typed, normalised
  number: string | null; // trailing digits, to match when the code was omitted
}

/**
 * Reads a search like "Dubai A 12345", "DXB-A-12345", "A12345" or "12345".
 * Returns null when the text cannot be a plate (no digits).
 */
export function parsePlateQuery(q: string): PlateQuery | null {
  let text = ` ${q.toLowerCase().trim()} `;
  let emirate: EmirateCode | null = null;
  // Longest aliases first so "abu dhabi" wins over "ad".
  const aliases = EMIRATES.flatMap((e) => e.aliases.map((a) => ({ a, code: e.code }))).sort(
    (x, y) => y.a.length - x.a.length,
  );
  for (const { a, code } of aliases) {
    const re = new RegExp(`(^|[\\s\\-_/,.])${a.replace(/\s/g, "\\s*")}(?=$|[\\s\\-_/,.])`, "u");
    if (re.test(text)) {
      emirate = code;
      text = text.replace(re, " ");
      break;
    }
  }
  const key = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/\d/.test(key) || key.length > 8) return null;
  const m = key.match(/(\d{1,5})$/);
  return { emirate, key, number: m ? m[1] : null };
}
