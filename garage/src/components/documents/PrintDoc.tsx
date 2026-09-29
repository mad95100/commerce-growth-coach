/**
 * A4 document with the garage's branding, used for every document type:
 * Tax invoice / Invoice, Estimate, Credit note, Job card, Payment receipt,
 * Refund receipt, Inspection report, Purchase order. Rendered on screen and
 * printed as is (the browser's print dialog saves it as PDF).
 */
import clsx from "clsx";
import type { ReactNode } from "react";
import { Logo } from "@/components/layout/Logo.tsx";
import { formatDate } from "@/lib/dates.ts";
import { t, useLang } from "@/lib/i18n.tsx";
import { formatMoney, formatAmount } from "@/lib/money.ts";
import { formatPhone } from "@/lib/phone.ts";
import { emirateName, formatPlate } from "@/lib/plates.ts";
import type { DocLine } from "@/api/types.ts";

export interface GarageInfo {
  name?: string | null;
  legal_name?: string | null;
  trn?: string | null;
  trade_license_no?: string | null;
  address?: string | null;
  emirate?: string | null;
  city?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  logo_url?: string | null;
  vat_registered?: boolean | null;
}

export interface PartyInfo {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  emirate?: string | null;
  trn?: string | null;
}

export interface VehicleInfo {
  plate_emirate?: string | null;
  plate_code?: string | null;
  plate_number?: string | null;
  vin?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | string | null;
  color?: string | null;
}

export function DocSheet({ children, className }: { children: ReactNode; className?: string }) {
  return <article className={clsx("print-sheet mx-auto w-full max-w-[210mm] rounded-xl border border-line bg-white p-5 text-[13px] leading-relaxed text-ink shadow-sm sm:p-8", className)}>{children}</article>;
}

export function DocHeader({
  garage,
  title,
  titleAr,
  meta,
}: {
  garage: GarageInfo;
  title: string;
  titleAr: string;
  meta: Array<[string, ReactNode]>;
}) {
  const { lang } = useLang();
  return (
    <header className="flex flex-col gap-5 border-b-2 border-ink pb-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        {garage.logo_url ? <img src={garage.logo_url} alt="" className="size-14 rounded-lg object-contain" /> : <Logo className="size-12 shrink-0" />}
        <div className="min-w-0">
          <p className="text-lg font-bold tracking-tight uppercase">{garage.name}</p>
          {garage.legal_name && garage.legal_name !== garage.name && <p className="text-xs text-ink-2">{garage.legal_name}</p>}
          <p className="text-xs text-ink-2">{[garage.address, garage.city, garage.emirate ? emirateName(garage.emirate, lang) : null, t("United Arab Emirates")].filter(Boolean).join(", ")}</p>
          <p className="text-xs text-ink-2">{[formatPhone(garage.phone), garage.email, garage.website].filter(Boolean).join(" · ")}</p>
          {(garage.trn || garage.trade_license_no) && (
            <p className="mt-1 text-xs font-medium">
              {[garage.trn ? `TRN ${garage.trn}` : null, garage.trade_license_no ? `${t("Trade licence")} ${garage.trade_license_no}` : null].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      </div>
      <div className="shrink-0 sm:text-end">
        <p className="text-xl font-bold tracking-wide">{title}</p>
        {lang !== "ar" && (
          <p className="text-sm font-semibold text-ink-2" lang="ar" dir="rtl">
            {titleAr}
          </p>
        )}
        <dl className="mt-2 space-y-0.5 text-xs">
          {meta
            .filter(([, v]) => v !== null && v !== undefined && v !== "")
            .map(([k, v]) => (
              <div key={k} className="flex gap-3 sm:justify-end">
                <dt className="text-muted">{k}</dt>
                <dd className="font-semibold num">{v}</dd>
              </div>
            ))}
        </dl>
      </div>
    </header>
  );
}

export function DocParties({ customer, vehicle, extra }: { customer?: PartyInfo | null; vehicle?: VehicleInfo | null; extra?: Array<[string, ReactNode]> }) {
  const { lang } = useLang();
  return (
    <section className="grid gap-4 py-5 sm:grid-cols-2 avoid-break">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">{t("Bill to")}</p>
        <p className="mt-1 font-semibold">{customer?.name}</p>
        {customer?.address && <p className="text-xs text-ink-2">{[customer.address, customer.emirate ? emirateName(customer.emirate, lang) : null].filter(Boolean).join(", ")}</p>}
        <p className="text-xs text-ink-2">{[formatPhone(customer?.phone), customer?.email].filter(Boolean).join(" · ")}</p>
        {customer?.trn && <p className="text-xs font-medium">TRN {customer.trn}</p>}
      </div>
      {(vehicle || (extra && extra.length > 0)) && (
        <div className="min-w-0">
          {vehicle && (
            <>
              <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">{t("Vehicle")}</p>
              <p className="mt-1 font-semibold">{[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ")}</p>
              <p className="text-xs text-ink-2">{[formatPlate(vehicle, lang), vehicle.color].filter(Boolean).join(" · ")}</p>
              {vehicle.vin && <p className="text-xs text-ink-2">VIN {vehicle.vin}</p>}
            </>
          )}
          {extra && (
            <dl className="mt-1 space-y-0.5 text-xs">
              {extra
                .filter(([, v]) => v !== null && v !== undefined && v !== "")
                .map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="text-muted">{k}</dt>
                    <dd className="font-medium">{v}</dd>
                  </div>
                ))}
            </dl>
          )}
        </div>
      )}
    </section>
  );
}

export function DocLines({ lines, vat, showPrices = true }: { lines: DocLine[]; vat: boolean; showPrices?: boolean }) {
  const { lang } = useLang();
  const hasDisc = lines.some((l) => Number(l.discount_pct) > 0);
  return (
    <div className="-mx-5 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[520px] border-collapse text-[12px]">
        <thead>
          <tr className="border-y border-line-strong bg-canvas text-[11px] tracking-wide text-ink-2 uppercase">
            <th className="px-2 py-2 text-start font-semibold">#</th>
            <th className="px-2 py-2 text-start font-semibold">{t("Description")}</th>
            <th className="px-2 py-2 text-end font-semibold">{t("Qty")}</th>
            {showPrices && <th className="px-2 py-2 text-end font-semibold">{t("Unit price")}</th>}
            {showPrices && hasDisc && <th className="px-2 py-2 text-end font-semibold">{t("Disc.")}</th>}
            {showPrices && vat && <th className="px-2 py-2 text-end font-semibold">{t("VAT")}</th>}
            {showPrices && <th className="px-2 py-2 text-end font-semibold">{t("Amount")}</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.id} className="border-b border-line align-top avoid-break">
              <td className="px-2 py-2 text-muted num">{i + 1}</td>
              <td className="px-2 py-2">
                <p className="font-medium">{l.description}</p>
                {(() => {
                  const kind = l.kind === "labor" ? t("Labor") : l.kind === "service" ? t("Service") : l.kind === "part" ? t("Part") : null;
                  const sub = [kind !== l.description ? kind : null, l.part_number ? `${t("P/N")} ${l.part_number}` : null].filter(Boolean).join(" · ");
                  return sub ? <p className="text-[11px] text-muted">{sub}</p> : null;
                })()}
              </td>
              <td className="px-2 py-2 text-end num">
                {formatQty(l.quantity)}
                {l.kind === "labor" ? ` ${t("h")}` : ""}
              </td>
              {showPrices && <td className="px-2 py-2 text-end num">{formatAmount(l.unit_price, lang)}</td>}
              {showPrices && hasDisc && <td className="px-2 py-2 text-end num">{Number(l.discount_pct) ? `${Number(l.discount_pct)}%` : ""}</td>}
              {showPrices && vat && (
                <td className="px-2 py-2 text-end num">
                  <span className="block">{formatAmount(l.vat, lang)}</span>
                  <span className="text-[10px] text-muted">{Number(l.tax_rate)}%</span>
                </td>
              )}
              {showPrices && <td className="px-2 py-2 text-end font-medium num">{formatAmount(vat ? l.total : l.taxable, lang)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function formatQty(q: number | string) {
  const n = Number(q);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");
}

export function DocTotals({ rows }: { rows: Array<{ label: string; value: number; strong?: boolean; negative?: boolean; tone?: "ok" | "bad" | "refund" } | null | false> }) {
  const { lang } = useLang();
  return (
    <div className="flex justify-end pt-4 avoid-break">
      <dl className="w-full max-w-xs space-y-1 text-sm">
        {rows.filter(Boolean).map((r) => {
          const row = r as { label: string; value: number; strong?: boolean; negative?: boolean; tone?: "ok" | "bad" | "refund" };
          return (
            <div key={row.label} className={clsx("flex items-baseline justify-between gap-4", row.strong && "border-t border-ink pt-1.5 text-base font-bold")}>
              <dt className={row.strong ? "" : "text-ink-2"}>{row.label}</dt>
              <dd className={clsx("num", row.tone === "ok" && "text-ok", row.tone === "bad" && "text-bad", row.tone === "refund" && "text-refund")}>
                {row.negative && Number(row.value) !== 0 ? "−" : ""}
                {formatMoney(Math.abs(Number(row.value)), lang)}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

export function DocText({ title, text }: { title: string; text?: string | null }) {
  if (!text) return null;
  return (
    <section className="mt-5 avoid-break">
      <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">{title}</p>
      <p className="mt-1 whitespace-pre-line text-xs text-ink-2">{text}</p>
    </section>
  );
}

export function DocFooter({ note }: { note?: string | null }) {
  return (
    <footer className="mt-8 border-t border-line pt-3 text-center text-[11px] text-muted">
      {note ?? t("Thank you for your business.")}
    </footer>
  );
}

export function docDate(d: string | null | undefined, lang: string) {
  return d ? formatDate(d, lang) : "";
}
