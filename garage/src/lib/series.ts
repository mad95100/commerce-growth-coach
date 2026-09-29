import { addDays, weekday } from "./dates.ts";

export interface DayPoint {
  day: string;
  invoiced: number;
  collected: number;
}

/** Groups daily points into ISO weeks (Monday start). Pure, for charts. */
export function toWeeks(days: DayPoint[]): Array<{ week: string; invoiced: number; collected: number }> {
  const map = new Map<string, { week: string; invoiced: number; collected: number }>();
  for (const d of days) {
    const monday = addDays(d.day, 1 - weekday(d.day));
    const w = map.get(monday) ?? { week: monday, invoiced: 0, collected: 0 };
    w.invoiced = Math.round((w.invoiced + Number(d.invoiced)) * 100) / 100;
    w.collected = Math.round((w.collected + Number(d.collected)) * 100) / 100;
    map.set(monday, w);
  }
  return [...map.values()].sort((a, b) => a.week.localeCompare(b.week));
}
