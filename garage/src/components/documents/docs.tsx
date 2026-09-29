import { useOrg } from "@/app/session.tsx";
import { formatDateTime } from "@/lib/dates.ts";
import { t, useLang } from "@/lib/i18n.tsx";
import { formatMoney } from "@/lib/money.ts";
import type { CreditNoteBundle, EstimateBundle, InvoiceBundle, JobCardBundle, PaymentBundle } from "@/api/documents.ts";
import type { Customer, Org } from "@/api/types.ts";
import { DocFooter, DocHeader, DocLines, DocParties, DocSheet, DocText, DocTotals, docDate, type GarageInfo, type PartyInfo, type VehicleInfo } from "./PrintDoc.tsx";

function partyFrom(c: Customer | null | undefined): PartyInfo | null {
  if (!c) return null;
  return { name: c.display_name, phone: c.phone, email: c.email, address: c.address, emirate: c.emirate, trn: c.trn };
}
function garageFrom(org: Org): GarageInfo {
  return org;
}

export function InvoiceDoc({ b }: { b: InvoiceBundle }) {
  const org = useOrg();
  const { lang } = useLang();
  const inv = b.inv;
  const garage = (inv.org_snapshot as GarageInfo | null) ?? garageFrom(org);
  const vat = inv.status === "draft" ? org.vat_registered : !!inv.vat_registered;
  const customer = (inv.customer_snapshot as PartyInfo | null) ?? partyFrom(b.customer);
  const vehicle = (inv.vehicle_snapshot as VehicleInfo | null) ?? (b.vehicle as VehicleInfo | null);
  const title = inv.status === "draft" ? t("DRAFT INVOICE") : vat ? t("TAX INVOICE") : t("INVOICE");
  const titleAr = vat ? "فاتورة ضريبية" : "فاتورة";
  const methods = [...new Set(b.payments.filter((p) => !p.voided_at && p.kind !== "refund").map((p) => t(p.method_name)))].join(", ");
  return (
    <DocSheet>
      {inv.status === "cancelled" && <p className="mb-3 rounded border-2 border-bad px-3 py-1 text-center text-sm font-bold tracking-widest text-bad uppercase">{t("Cancelled")} — {inv.cancel_reason}</p>}
      <DocHeader
        garage={garage}
        title={title}
        titleAr={titleAr}
        meta={[
          [t("Invoice No."), inv.number ?? t("Not issued")],
          [t("Invoice date"), docDate(inv.issue_date, lang)],
          [t("Due date"), inv.due_date && inv.due_date !== inv.issue_date ? docDate(inv.due_date, lang) : inv.issue_date ? t("On receipt") : ""],
          [t("Job card"), inv.job_card_number ?? ""],
        ]}
      />
      <DocParties customer={customer} vehicle={vehicle} extra={[[t("Mileage"), inv.mileage != null ? `${Number(inv.mileage).toLocaleString("en")} km` : ""]]} />
      <DocText title={t("Description")} text={inv.description} />
      <div className="mt-3">
        <DocLines lines={b.lines} vat={vat} />
      </div>
      <DocTotals
        rows={[
          { label: t("Subtotal"), value: inv.subtotal },
          Number(inv.doc_discount) > 0 && { label: t("Discount"), value: inv.doc_discount, negative: true },
          vat && { label: t("VAT"), value: inv.vat_total },
          { label: t("Total"), value: inv.total, strong: true },
          Number(inv.credited) > 0 && { label: t("Credit notes"), value: inv.credited, negative: true },
          inv.status !== "draft" && { label: t("Paid"), value: Number(inv.paid) - Number(inv.refunded), negative: true },
          inv.status === "draft" && Number(inv.paid) > 0 && { label: t("Deposit received"), value: inv.paid, negative: true },
          inv.status !== "cancelled" && {
            label: Number(inv.balance) < 0 ? t("Refund due") : t("Balance due"),
            value: inv.balance,
            strong: true,
            tone: Number(inv.balance) < 0 ? ("refund" as const) : Number(inv.balance) === 0 ? ("ok" as const) : undefined,
          },
        ]}
      />
      {methods && <p className="mt-2 text-end text-xs text-muted">{t("Payment method: {m}", { m: methods })}</p>}
      <DocText title={t("Notes")} text={inv.notes} />
      <DocText title={t("Terms & conditions")} text={inv.terms} />
      <DocFooter note={org.receipt_footer} />
    </DocSheet>
  );
}

export function EstimateDoc({ b }: { b: EstimateBundle }) {
  const org = useOrg();
  const { lang } = useLang();
  const e = b.est;
  return (
    <DocSheet>
      <DocHeader
        garage={garageFrom(org)}
        title={t("ESTIMATE")}
        titleAr="عرض سعر"
        meta={[
          [t("Estimate No."), e.number],
          [t("Date"), docDate(e.issue_date, lang)],
          [t("Valid until"), docDate(e.valid_until, lang)],
        ]}
      />
      <DocParties customer={partyFrom(b.customer)} vehicle={b.vehicle as VehicleInfo | null} extra={[[t("Mileage"), e.mileage != null ? `${Number(e.mileage).toLocaleString("en")} km` : ""]]} />
      <DocText title={t("Work requested")} text={e.description} />
      <div className="mt-3">
        <DocLines lines={b.lines} vat={org.vat_registered} />
      </div>
      <DocTotals
        rows={[
          { label: t("Subtotal"), value: e.subtotal },
          Number(e.doc_discount) > 0 && { label: t("Discount"), value: e.doc_discount, negative: true },
          org.vat_registered && { label: t("VAT"), value: e.vat_total },
          { label: t("Total"), value: e.total, strong: true },
          Number(e.deposits) > 0 && { label: t("Deposit received"), value: e.deposits, negative: true },
          Number(e.deposits) > 0 && { label: t("Remaining"), value: Number(e.total) - Number(e.deposits), strong: true },
        ]}
      />
      <DocText title={t("Notes")} text={e.notes} />
      <DocText title={t("Terms & conditions")} text={e.terms} />
      <section className="mt-8 grid grid-cols-2 gap-8 text-xs text-muted avoid-break">
        <div className="border-t border-line-strong pt-2">{t("Customer approval (name, signature, date)")}</div>
        <div className="border-t border-line-strong pt-2">{t("For {garage}", { garage: org.name })}</div>
      </section>
      <DocFooter note={t("This estimate is not an invoice.")} />
    </DocSheet>
  );
}

export function JobCardDoc({ b, showPrices }: { b: JobCardBundle; showPrices: boolean }) {
  const org = useOrg();
  const { lang } = useLang();
  const j = b.jc;
  return (
    <DocSheet>
      <DocHeader
        garage={garageFrom(org)}
        title={t("JOB CARD")}
        titleAr="بطاقة عمل"
        meta={[
          [t("Job card No."), j.number],
          [t("Received"), formatDateTime(j.received_at, lang)],
          [t("Promised"), j.promised_at ? formatDateTime(j.promised_at, lang) : ""],
          [t("Estimate"), j.estimate_number ?? ""],
        ]}
      />
      <DocParties customer={partyFrom(b.customer)} vehicle={b.vehicle as VehicleInfo} extra={[[t("Mileage in"), j.mileage_in != null ? `${Number(j.mileage_in).toLocaleString("en")} km` : ""], [t("Mechanic"), j.technician_name ?? t("Not assigned")]]} />
      <DocText title={t("Customer complaint")} text={j.complaint} />
      <DocText title={t("Diagnosis")} text={j.diagnosis} />
      <DocText title={t("Work done")} text={j.work_done} />
      <div className="mt-4">
        <DocLines lines={b.lines} vat={org.vat_registered} showPrices={showPrices} />
      </div>
      {showPrices && (
        <DocTotals
          rows={[
            { label: t("Subtotal"), value: j.subtotal },
            Number(j.doc_discount) > 0 && { label: t("Discount"), value: j.doc_discount, negative: true },
            org.vat_registered && { label: t("VAT"), value: j.vat_total },
            { label: t("Estimated total"), value: j.total, strong: true },
            Number(j.deposits) > 0 && { label: t("Deposit received"), value: j.deposits, negative: true },
          ]}
        />
      )}
      <section className="mt-10 grid grid-cols-2 gap-8 text-xs text-muted avoid-break">
        <div className="border-t border-line-strong pt-2">{t("Customer signature (vehicle drop-off)")}</div>
        <div className="border-t border-line-strong pt-2">{t("Customer signature (vehicle collected)")}</div>
      </section>
      <DocFooter note={t("Job card — not an invoice.")} />
    </DocSheet>
  );
}

export function ReceiptDoc({ b }: { b: PaymentBundle }) {
  const org = useOrg();
  const { lang } = useLang();
  const p = b.payment;
  const refund = p.kind === "refund";
  const garage = (b.invoice?.org_snapshot as GarageInfo | null) ?? garageFrom(org);
  return (
    <DocSheet className="max-w-[148mm]">
      {p.voided_at && <p className="mb-3 rounded border-2 border-bad px-3 py-1 text-center text-sm font-bold tracking-widest text-bad uppercase">{t("Void")} — {p.void_reason}</p>}
      <DocHeader
        garage={garage}
        title={refund ? t("REFUND RECEIPT") : t("PAYMENT RECEIPT")}
        titleAr={refund ? "إيصال استرداد" : "إيصال دفع"}
        meta={[
          [t("Receipt No."), p.number],
          [t("Date"), formatDateTime(p.paid_at, lang)],
        ]}
      />
      <DocParties customer={partyFrom(b.customer)} vehicle={b.vehicle as VehicleInfo | null} />
      <section className="rounded-xl border border-line bg-canvas p-4">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-2">{refund ? t("Amount refunded") : p.kind === "deposit" ? t("Deposit received") : t("Amount received")}</dt>
            <dd className="text-xl font-bold num">{formatMoney(p.amount, lang)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-2">{t("Payment method")}</dt>
            <dd className="font-medium">{t(p.method_name)}</dd>
          </div>
          {p.reference && (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-2">{t("Reference")}</dt>
              <dd className="font-medium">{p.reference}</dd>
            </div>
          )}
          {(p.invoice_number || p.job_card_number || p.estimate_number) && (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-2">{t("For")}</dt>
              <dd className="font-medium">{[p.invoice_number && `${t("Invoice")} ${p.invoice_number}`, !p.invoice_number && p.job_card_number && `${t("Job card")} ${p.job_card_number}`, !p.invoice_number && !p.job_card_number && p.estimate_number && `${t("Estimate")} ${p.estimate_number}`].filter(Boolean).join(" · ")}</dd>
            </div>
          )}
          {b.invoice && b.invoice.status === "issued" && (
            <>
              <div className="flex justify-between gap-3 border-t border-line pt-2">
                <dt className="text-ink-2">{t("Invoice total")}</dt>
                <dd className="num">{formatMoney(Number(b.invoice.total) - Number(b.invoice.credited), lang)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="font-semibold">{t("Remaining balance")}</dt>
                <dd className="font-bold num">{formatMoney(Math.max(0, Number(b.invoice.balance)), lang)}</dd>
              </div>
            </>
          )}
          <p className="pt-1 text-xs text-muted">{t("Received by {name}", { name: p.received_by_name ?? "" })}</p>
        </dl>
      </section>
      {p.notes && <DocText title={t("Notes")} text={p.notes} />}
      <DocFooter note={org.receipt_footer} />
    </DocSheet>
  );
}

export function CreditNoteDoc({ b }: { b: CreditNoteBundle }) {
  const org = useOrg();
  const { lang } = useLang();
  const cn = b.cn;
  const vat = !!b.invoice.vat_registered;
  return (
    <DocSheet>
      <DocHeader
        garage={(b.invoice.org_snapshot as GarageInfo | null) ?? garageFrom(org)}
        title={vat ? t("TAX CREDIT NOTE") : t("CREDIT NOTE")}
        titleAr={vat ? "إشعار دائن ضريبي" : "إشعار دائن"}
        meta={[
          [t("Credit note No."), cn.number],
          [t("Date"), docDate(cn.issue_date, lang)],
          [t("Original invoice"), `${b.invoice.number} · ${docDate(b.invoice.issue_date, lang)}`],
        ]}
      />
      <DocParties customer={(cn.customer_snapshot as PartyInfo | null) ?? { name: cn.customer_name }} vehicle={b.invoice.vehicle_snapshot as VehicleInfo | null} />
      <DocText title={t("Reason")} text={cn.reason} />
      <div className="mt-3">
        <DocLines lines={b.lines} vat={vat} />
      </div>
      <DocTotals
        rows={[
          { label: t("Amount excl. VAT"), value: cn.subtotal },
          vat && { label: t("VAT"), value: cn.vat_total },
          { label: t("Total credited"), value: cn.total, strong: true },
        ]}
      />
      {cn.restock && <p className="mt-2 text-xs text-muted">{t("Returned parts were put back into stock.")}</p>}
      <DocFooter note={org.receipt_footer} />
    </DocSheet>
  );
}
