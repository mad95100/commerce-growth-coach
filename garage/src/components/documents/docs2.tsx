import clsx from "clsx";
import { useOrg } from "@/app/session.tsx";
import { formatDateTime } from "@/lib/dates.ts";
import { t, useLang } from "@/lib/i18n.tsx";
import { formatAmount } from "@/lib/money.ts";
import { formatPhone } from "@/lib/phone.ts";
import { INSPECTION_ITEM_STATUS } from "@/lib/status.ts";
import type { InspectionBundle, PurchaseOrderBundle } from "@/api/documents2.ts";
import { DocFooter, DocHeader, DocParties, DocSheet, DocText, DocTotals, docDate, formatQty, type VehicleInfo } from "./PrintDoc.tsx";

export function PurchaseOrderDoc({ b }: { b: PurchaseOrderBundle }) {
  const org = useOrg();
  const { lang } = useLang();
  const { po, lines, supplier } = b;
  return (
    <DocSheet>
      <DocHeader garage={org} title={t("PURCHASE ORDER")} titleAr="أمر شراء" meta={[[t("PO No."), po.number], [t("Date"), docDate(po.order_date, lang)], [t("Expected"), docDate(po.expected_date, lang)]]} />
      <section className="py-5">
        <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">{t("Supplier")}</p>
        <p className="mt-1 font-semibold">{supplier.name}</p>
        <p className="text-xs text-ink-2">{[supplier.contact_name, formatPhone(supplier.phone), supplier.email].filter(Boolean).join(" · ")}</p>
        {supplier.address && <p className="text-xs text-ink-2">{supplier.address}</p>}
        {supplier.trn && <p className="text-xs font-medium">TRN {supplier.trn}</p>}
      </section>
      <div className="-mx-5 overflow-x-auto sm:mx-0">
        <table className="w-full min-w-[480px] border-collapse text-[12px]">
          <thead>
            <tr className="border-y border-line-strong bg-canvas text-[11px] tracking-wide text-ink-2 uppercase">
              <th className="px-2 py-2 text-start">#</th>
              <th className="px-2 py-2 text-start">{t("Description")}</th>
              <th className="px-2 py-2 text-end">{t("Qty")}</th>
              <th className="px-2 py-2 text-end">{t("Unit cost")}</th>
              {org.vat_registered && <th className="px-2 py-2 text-end">{t("VAT")}</th>}
              <th className="px-2 py-2 text-end">{t("Amount")}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id} className="border-b border-line">
                <td className="px-2 py-2 text-muted">{i + 1}</td>
                <td className="px-2 py-2">{l.description}</td>
                <td className="px-2 py-2 text-end num">{formatQty(l.quantity)}</td>
                <td className="px-2 py-2 text-end num">{formatAmount(l.unit_cost, lang)}</td>
                {org.vat_registered && <td className="px-2 py-2 text-end num">{formatAmount(l.vat, lang)}</td>}
                <td className="px-2 py-2 text-end num">{formatAmount(org.vat_registered ? l.total : l.net, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <DocTotals rows={[{ label: t("Subtotal"), value: po.subtotal }, org.vat_registered && { label: t("VAT"), value: po.vat_total }, { label: t("Total"), value: po.total, strong: true }]} />
      <DocText title={t("Notes")} text={po.notes} />
      <DocFooter note={t("Please quote the PO number on your delivery note and invoice.")} />
    </DocSheet>
  );
}

export function InspectionDoc({ b }: { b: InspectionBundle }) {
  const org = useOrg();
  const { lang } = useLang();
  const { ins, items } = b;
  return (
    <DocSheet>
      <DocHeader garage={org} title={t("INSPECTION REPORT")} titleAr="تقرير فحص" meta={[[t("Date"), formatDateTime(ins.completed_at ?? ins.created_at, lang)], [t("Job card"), b.jobCardNumber ?? ""], [t("Inspected by"), b.technician ?? ""]]} />
      <DocParties customer={{ name: b.customer.display_name, phone: b.customer.phone, email: b.customer.email }} vehicle={b.vehicle as VehicleInfo} extra={[[t("Mileage"), ins.mileage != null ? `${Number(ins.mileage).toLocaleString("en")} km` : ""]]} />
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-y border-line-strong bg-canvas text-[11px] tracking-wide text-ink-2 uppercase">
            <th className="px-2 py-2 text-start">{t("Check")}</th>
            <th className="px-2 py-2 text-start">{t("Result")}</th>
            <th className="px-2 py-2 text-start">{t("Comment")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="border-b border-line avoid-break">
              <td className="px-2 py-2 font-medium">{t(i.label)}</td>
              <td className="px-2 py-2">
                <span className={clsx("font-semibold", i.status === "ok" && "text-ok", i.status === "attention" && "text-warn", i.status === "urgent" && "text-bad")}>
                  {i.status ? t(INSPECTION_ITEM_STATUS[i.status].label) : t("Not checked")}
                </span>
              </td>
              <td className="px-2 py-2 text-ink-2">{i.comment}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <DocText title={t("Summary")} text={ins.summary} />
      <DocText title={t("Recommendations")} text={ins.recommendations} />
      <DocFooter note={t("This report describes the condition observed on the date of inspection.")} />
    </DocSheet>
  );
}
