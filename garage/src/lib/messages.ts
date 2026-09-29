/**
 * Texts sent to customers by WhatsApp or email. The app opens WhatsApp (or
 * the email app) with the text prepared; the employee reviews and presses
 * send. Nothing is sent by the server, and the app never claims it was.
 * No link to the document is included: documents are not public.
 */
import { t, lang } from "./i18n.tsx";
import { formatMoney } from "./money.ts";
import { formatDate, formatDateTime } from "./dates.ts";
import { formatPlate } from "./plates.ts";

interface VehicleLike {
  plate_emirate?: string | null;
  plate_code?: string | null;
  plate_number?: string | null;
  make?: string | null;
  model?: string | null;
}

function vehicleLabel(v: VehicleLike | null | undefined): string {
  if (!v) return "";
  const name = [v.make, v.model].filter(Boolean).join(" ");
  const plate = formatPlate(v, lang());
  return [name, plate ? `(${plate})` : ""].filter(Boolean).join(" ");
}

function greeting(name: string | null | undefined): string {
  return name ? t("Dear {name},", { name }) : t("Hello,");
}

export function invoiceMessage(p: {
  garage: string;
  customer: string | null;
  number: string;
  date: string | null;
  total: number;
  balance: number;
  vehicle?: VehicleLike | null;
}): { subject: string; body: string } {
  const l = lang();
  const lines = [
    greeting(p.customer),
    "",
    t("Please find the details of your invoice {number} from {garage}.", { number: p.number, garage: p.garage }),
    p.vehicle ? t("Vehicle: {vehicle}", { vehicle: vehicleLabel(p.vehicle) }) : "",
    t("Date: {date}", { date: formatDate(p.date, l) }),
    t("Total: {amount}", { amount: formatMoney(p.total, l) }),
    p.balance > 0 ? t("Balance due: {amount}", { amount: formatMoney(p.balance, l) }) : t("This invoice is fully paid. Thank you."),
    "",
    t("Thank you for choosing {garage}.", { garage: p.garage }),
  ];
  return { subject: t("Invoice {number} — {garage}", { number: p.number, garage: p.garage }), body: lines.filter((x, i, a) => x !== "" || a[i - 1] !== "").join("\n") };
}

export function reminderMessage(p: {
  garage: string;
  customer: string | null;
  number: string;
  date: string | null;
  balance: number;
  daysOverdue: number;
  phone?: string | null;
}): { subject: string; body: string } {
  const l = lang();
  const lines = [
    greeting(p.customer),
    "",
    t("This is a friendly reminder that invoice {number} dated {date} has a balance due of {amount}.", {
      number: p.number,
      date: formatDate(p.date, l),
      amount: formatMoney(p.balance, l),
    }),
    p.daysOverdue > 0 ? t("It is {days} days past its due date.", { days: p.daysOverdue }) : "",
    t("You can pay at the garage by cash or card, or by bank transfer."),
    p.phone ? t("For any question, call us on {phone}.", { phone: p.phone }) : "",
    "",
    t("Thank you, {garage}", { garage: p.garage }),
  ];
  return {
    subject: t("Payment reminder — invoice {number}", { number: p.number }),
    body: lines.filter((x, i, a) => x !== "" || a[i - 1] !== "").join("\n"),
  };
}

export function receiptMessage(p: {
  garage: string;
  customer: string | null;
  receipt: string;
  invoice: string | null;
  amount: number;
  method: string;
  balance: number | null;
  refund?: boolean;
}): { subject: string; body: string } {
  const l = lang();
  const lines = [
    greeting(p.customer),
    "",
    p.refund
      ? t("We confirm a refund of {amount} ({method}), reference {receipt}.", { amount: formatMoney(p.amount, l), method: p.method, receipt: p.receipt })
      : t("We confirm receipt of {amount} ({method}), receipt {receipt}.", { amount: formatMoney(p.amount, l), method: p.method, receipt: p.receipt }),
    p.invoice ? t("Invoice: {number}", { number: p.invoice }) : "",
    p.balance !== null ? t("Remaining balance: {amount}", { amount: formatMoney(Math.max(p.balance, 0), l) }) : "",
    "",
    t("Thank you, {garage}", { garage: p.garage }),
  ];
  return { subject: t("Receipt {number} — {garage}", { number: p.receipt, garage: p.garage }), body: lines.filter(Boolean).join("\n") };
}

export function estimateMessage(p: {
  garage: string;
  customer: string | null;
  number: string;
  total: number;
  validUntil: string | null;
  vehicle?: VehicleLike | null;
}): { subject: string; body: string } {
  const l = lang();
  const lines = [
    greeting(p.customer),
    "",
    t("Here is our estimate {number} for your vehicle {vehicle}.", { number: p.number, vehicle: vehicleLabel(p.vehicle) }),
    t("Total: {amount}", { amount: formatMoney(p.total, l) }),
    p.validUntil ? t("Valid until {date}.", { date: formatDate(p.validUntil, l) }) : "",
    t("Reply to this message to approve the work, or call us with any question."),
    "",
    t("Thank you, {garage}", { garage: p.garage }),
  ];
  return { subject: t("Estimate {number} — {garage}", { number: p.number, garage: p.garage }), body: lines.filter(Boolean).join("\n") };
}

export function vehicleReadyMessage(p: { garage: string; customer: string | null; vehicle?: VehicleLike | null; balance?: number | null }): {
  subject: string;
  body: string;
} {
  const l = lang();
  const lines = [
    greeting(p.customer),
    "",
    t("Your vehicle {vehicle} is ready for collection.", { vehicle: vehicleLabel(p.vehicle) }),
    p.balance && p.balance > 0 ? t("Amount to pay at collection: {amount}", { amount: formatMoney(p.balance, l) }) : "",
    "",
    t("Thank you, {garage}", { garage: p.garage }),
  ];
  return { subject: t("Your vehicle is ready — {garage}", { garage: p.garage }), body: lines.filter(Boolean).join("\n") };
}

export function appointmentMessage(p: { garage: string; customer: string | null; startsAt: string; reason: string; address?: string | null }): {
  subject: string;
  body: string;
} {
  const l = lang();
  const lines = [
    greeting(p.customer),
    "",
    t("This is a reminder of your appointment at {garage} on {when} for: {reason}.", {
      garage: p.garage,
      when: formatDateTime(p.startsAt, l),
      reason: p.reason,
    }),
    p.address ? t("Address: {address}", { address: p.address }) : "",
    t("Reply to this message if you need to change the time."),
  ];
  return { subject: t("Appointment reminder — {garage}", { garage: p.garage }), body: lines.filter(Boolean).join("\n") };
}

export function inspectionMessage(p: {
  garage: string;
  customer: string | null;
  vehicle?: VehicleLike | null;
  urgent: string[];
  attention: string[];
  recommendations?: string | null;
}): { subject: string; body: string } {
  const lines = [
    greeting(p.customer),
    "",
    t("We have inspected your vehicle {vehicle}.", { vehicle: vehicleLabel(p.vehicle) }),
    p.urgent.length ? t("Needs urgent attention: {items}", { items: p.urgent.join(", ") }) : "",
    p.attention.length ? t("To watch: {items}", { items: p.attention.join(", ") }) : "",
    !p.urgent.length && !p.attention.length ? t("Everything we checked is in good condition.") : "",
    p.recommendations ? t("Our recommendations: {text}", { text: p.recommendations }) : "",
    "",
    t("Thank you, {garage}", { garage: p.garage }),
  ];
  return { subject: t("Inspection report — {garage}", { garage: p.garage }), body: lines.filter(Boolean).join("\n") };
}
