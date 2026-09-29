/**
 * Dates. The garage works on Dubai time (UTC+4, no daylight saving). Business
 * dates (invoice date, due date, report periods) are plain `YYYY-MM-DD`
 * strings: never a Date at midnight UTC, which shifts by a day depending on
 * the device's time zone.
 */

export const GARAGE_TZ = "Asia/Dubai";

/** Today's date in the garage's time zone, as YYYY-MM-DD. */
export function todayISO(now: Date = new Date(), tz = GARAGE_TZ): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts; // en-CA formats as YYYY-MM-DD
}

function parse(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { y, m, d };
}

function fmt(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const { y, m, d } = parse(iso);
  return fmt(y, m, d + days);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  const a = parse(from);
  const c = parse(to);
  return Math.round((Date.UTC(c.y, c.m - 1, c.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

/** ISO weekday, Monday = 1 … Sunday = 7. */
export function weekday(iso: string): number {
  const { y, m, d } = parse(iso);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

export type PeriodKey = "today" | "week" | "month" | "quarter" | "year" | "custom";

export interface Period {
  from: string;
  to: string;
}

/**
 * Report periods, all ending today (inclusive). A week starts on Monday, the
 * usual working week in the UAE since 2022.
 */
export function periodRange(key: Exclude<PeriodKey, "custom">, today: string): Period {
  const { y, m } = parse(today);
  switch (key) {
    case "today":
      return { from: today, to: today };
    case "week":
      return { from: addDays(today, 1 - weekday(today)), to: today };
    case "month":
      return { from: fmt(y, m, 1), to: today };
    case "quarter":
      return { from: fmt(y, Math.floor((m - 1) / 3) * 3 + 1, 1), to: today };
    case "year":
      return { from: fmt(y, 1, 1), to: today };
  }
}

export function formatDate(iso: string | null | undefined, locale = "en"): string {
  if (!iso) return "";
  const { y, m, d } = parse(iso);
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatDateTime(ts: string | null | undefined, locale = "en"): string {
  if (!ts) return "";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: GARAGE_TZ,
  }).format(new Date(ts));
}

export function formatTime(ts: string | null | undefined, locale = "en"): string {
  if (!ts) return "";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: GARAGE_TZ,
  }).format(new Date(ts));
}

/** Local Dubai date+time from a timestamp, as parts for inputs. */
export function dubaiParts(ts: string | Date): { date: string; time: string } {
  const d = typeof ts === "string" ? new Date(ts) : ts;
  const date = todayISO(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: GARAGE_TZ,
  }).format(d);
  return { date, time };
}

/** Dubai local date + "HH:MM" → ISO timestamp with +04:00 offset. */
export function dubaiTimestamp(date: string, time: string): string {
  return `${date}T${time.length === 5 ? `${time}:00` : time}+04:00`;
}
