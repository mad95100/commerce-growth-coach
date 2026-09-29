/**
 * Charts. Two measures in the same unit (AED) share ONE axis. Series colours
 * are the first two slots of the validated reference palette (blue, orange);
 * text always uses ink tokens, never the series colour. Every chart has a
 * legend (2 series), a hover tooltip, and a table view for accessibility.
 */
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { formatMoney, formatMoneyCompact } from "@/lib/money.ts";
import { t, useLang } from "@/lib/i18n.tsx";
import { formatDate } from "@/lib/dates.ts";

export const SERIES_1 = "#2a78d6";
export const SERIES_2 = "#eb6834";

export interface RevenuePoint {
  label: string; // x-axis key (date or month)
  invoiced: number;
  collected: number;
}

export function RevenueChart({ data, xFormat }: { data: RevenuePoint[]; xFormat: (label: string) => string }) {
  const { lang } = useLang();
  const [table, setTable] = useState(false);
  const rtl = lang === "ar";
  if (data.length === 0) return <p className="py-10 text-center text-sm text-muted">{t("No data for this period.")}</p>;
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button type="button" className="min-h-9 rounded-md px-2 text-xs font-medium text-brand hover:bg-brand-soft" onClick={() => setTable((x) => !x)}>
          {table ? t("Show chart") : t("Show table")}
        </button>
      </div>
      {table ? (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th className="py-1 text-start font-medium">{t("Period")}</th>
                <th className="py-1 text-end font-medium">{t("Invoiced")}</th>
                <th className="py-1 text-end font-medium">{t("Collected")}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.label} className="border-t border-line">
                  <td className="py-1.5">{xFormat(d.label)}</td>
                  <td className="py-1.5 text-end num">{formatMoney(d.invoiced, lang)}</td>
                  <td className="py-1.5 text-end num">{formatMoney(d.collected, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-64" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rtl ? [...data].reverse() : data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }} barCategoryGap="25%">
              <CartesianGrid vertical={false} stroke="#e3e6eb" />
              <XAxis dataKey="label" tickFormatter={xFormat} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#cfd4dc" }} minTickGap={16} />
              <YAxis orientation={rtl ? "right" : "left"} tickFormatter={(v) => formatMoneyCompact(Number(v), lang).replace("AED ", "")} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} width={44} />
              <Tooltip
                cursor={{ fill: "rgb(15 23 42 / 0.04)" }}
                formatter={(v, name) => [formatMoney(Number(v), lang), name === "invoiced" ? t("Invoiced") : t("Collected")]}
                labelFormatter={(l) => xFormat(String(l))}
                contentStyle={{ borderRadius: 8, borderColor: "#e3e6eb", fontSize: 12 }}
              />
              <Legend formatter={(v) => <span style={{ color: "#334155", fontSize: 12 }}>{v === "invoiced" ? t("Invoiced") : t("Collected")}</span>} iconType="circle" iconSize={8} />
              <Bar isAnimationActive={false} dataKey="invoiced" fill={SERIES_1} radius={[4, 4, 0, 0]} maxBarSize={28} stroke="#ffffff" strokeWidth={1} />
              <Line isAnimationActive={false} dataKey="collected" stroke={SERIES_2} strokeWidth={2} dot={data.length <= 14 ? { r: 4, fill: SERIES_2, stroke: "#fff", strokeWidth: 2 } : false} activeDot={{ r: 5 }} type="monotone" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/** A labelled horizontal bar list: one series, value printed in ink. */
export function BarList({ items, empty, format }: { items: Array<{ label: string; value: number; sub?: string }>; empty?: string; format?: (v: number) => string }) {
  const { lang } = useLang();
  const fmt = format ?? ((v: number) => formatMoney(v, lang));
  const max = Math.max(0, ...items.map((i) => Math.abs(i.value)));
  if (items.length === 0) return <p className="py-6 text-center text-sm text-muted">{empty ?? t("No data for this period.")}</p>;
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.label} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-ink-2">{i.label}</span>
            <span className="shrink-0 font-medium num text-ink">{fmt(i.value)}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-canvas" title={`${i.label}: ${fmt(i.value)}`}>
            <div className="h-2 rounded-full" style={{ width: `${max ? Math.max(2, (Math.abs(i.value) / max) * 100) : 0}%`, background: SERIES_1 }} />
          </div>
          {i.sub && <p className="mt-0.5 text-xs text-muted">{i.sub}</p>}
        </li>
      ))}
    </ul>
  );
}

export function shortDay(iso: string, lang: string) {
  return formatDate(iso, lang).replace(/ \d{4}$/, "");
}

export function monthLabel(ym: string, lang: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export { BarChart };
