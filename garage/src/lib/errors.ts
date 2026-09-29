import { t } from "./i18n.tsx";

/**
 * Turns any error (database function, PostgREST, auth, network) into a
 * sentence a garage employee understands and can act on. Technical detail is
 * kept separately for the "details" disclosure, never in the main message.
 */
export interface FriendlyError {
  message: string;
  technical?: string;
}

const NOT_FOUND: Record<string, string> = {
  customer: "This customer was not found.",
  vehicle: "This vehicle was not found.",
  invoice: "This invoice was not found.",
  estimate: "This estimate was not found.",
  job_card: "This job card was not found.",
  part: "This part was not found in the catalog.",
  service: "This service was not found in the catalog.",
  technician: "This technician was not found.",
  payment_method: "This payment method is not available. Choose another one.",
  supplier: "This supplier was not found.",
  branch: "This branch was not found or is inactive.",
  tax_rate: "This VAT rate was not found.",
  line: "A line of the document was not found. Reload the page.",
  credit_note: "This credit note was not found.",
};

export function friendlyError(e: unknown): FriendlyError {
  const err = (e ?? {}) as { message?: string; details?: string; code?: string; error_code?: string; name?: string };
  const msg = String(err.message ?? e ?? "");
  const detail = err.details ?? "";
  const technical = [err.code, msg, detail].filter(Boolean).join(" · ");

  if (msg.startsWith("bsg.")) {
    const code = msg.slice(4);
    switch (code) {
      case "permission_denied":
        return { message: t("Your role does not allow this action. Ask the garage owner or a manager."), technical };
      case "not_authenticated":
        return { message: t("Your session has ended. Sign in again."), technical };
      case "not_found":
        return { message: t(NOT_FOUND[detail] ?? "This item no longer exists. Reload the page."), technical };
      case "invalid_state":
        return { message: t("This document has changed status in the meantime. Reload the page to see its current state."), technical };
      case "invoice_locked":
        return { message: t("An issued invoice cannot be changed. Use a credit note to correct it."), technical };
      case "invoice_empty":
        return { message: t("Add at least one line before issuing the invoice."), technical };
      case "invoice_has_payments":
        return { message: t("This invoice has payments. Void or refund them first, or correct it with a credit note."), technical };
      case "invoice_has_credit_notes":
        return { message: t("This invoice already has a credit note, so it cannot be cancelled. Use another credit note instead."), technical };
      case "amount_exceeds_balance":
        return { message: t("The amount is more than the balance due ({amount}).", { amount: `AED ${detail}` }), technical };
      case "refund_exceeds_credit":
        return { message: t("The refund is more than what is owed to the customer ({amount}).", { amount: `AED ${detail}` }), technical };
      case "credit_exceeds_invoice":
        return { message: t("The credit is more than what remains on the invoice ({amount}).", { amount: `AED ${detail}` }), technical };
      case "credit_exceeds_line":
        return { message: t("You cannot credit more than was invoiced on this line."), technical };
      case "receive_exceeds_ordered":
        return { message: t("You cannot receive more than was ordered."), technical };
      case "vehicle_not_customer":
        return { message: t("This vehicle belongs to another customer."), technical };
      case "vehicle_required":
        return { message: t("Choose a vehicle first: a job card is always for a vehicle."), technical };
      case "use_invoice_payment":
        return { message: t("This job already has an issued invoice. Record the payment on the invoice."), technical };
      case "sequence_cannot_go_back":
        return { message: t("Numbering can only move forward, to avoid reusing a number already issued."), technical };
      case "already_member":
        return { message: t("This person is already a member of the garage."), technical };
      case "cannot_change_self":
        return { message: t("You cannot change your own role or deactivate yourself."), technical };
      case "last_owner":
        return { message: t("The garage must keep at least one active owner."), technical };
      case "validation":
        return { message: validationMessage(detail), technical };
      default:
        return { message: t("The action was refused. Check the values and try again."), technical };
    }
  }

  if (err.code === "23505") {
    if (msg.includes("parts_org_sku")) return { message: t("A part with this SKU already exists."), technical };
    if (msg.includes("parts_org_barcode")) return { message: t("A part with this barcode already exists."), technical };
    return { message: t("This already exists."), technical };
  }
  if (err.code === "23514" || err.code === "22P02" || err.code === "22003") {
    return { message: t("Some values are not valid. Check the highlighted fields."), technical };
  }
  if (err.code === "23503") return { message: t("This is linked to other records and cannot be changed this way."), technical };
  if (err.code === "42501" || err.code === "PGRST301") {
    return { message: t("Your role does not allow this action. Ask the garage owner or a manager."), technical };
  }

  const authCode = err.error_code ?? err.code;
  if (authCode === "invalid_credentials" || msg === "Invalid login credentials") {
    return { message: t("Email or password is incorrect."), technical };
  }
  if (authCode === "user_already_exists" || msg.includes("already registered")) {
    return { message: t("An account already exists with this email. Sign in instead."), technical };
  }
  if (authCode === "weak_password" || msg.toLowerCase().includes("password should be")) {
    return { message: t("Choose a longer password (at least 8 characters)."), technical };
  }
  if (authCode === "email_not_confirmed") {
    return { message: t("Confirm your email address first: open the link we sent you."), technical };
  }
  if (err.name === "TypeError" && /fetch|network/i.test(msg)) {
    return { message: t("The server cannot be reached. Check the internet connection and try again."), technical };
  }
  return { message: t("Something unexpected went wrong. Try again; if it continues, contact your administrator."), technical };
}

function validationMessage(detail: string): string {
  if (detail.includes("quantity")) return t("Each line needs a quantity above zero (2 decimals at most).");
  if (detail.includes("unit_price")) return t("Each line needs a price of zero or more (2 decimals at most).");
  if (detail.includes("discount")) return t("A discount must be between 0 and 100%.");
  if (detail.includes("description")) return t("Each line needs a description.");
  if (detail === "amount") return t("Enter an amount above zero, with 2 decimals at most.");
  if (detail === "reason") return t("A reason is required.");
  if (detail === "vat_rate") return t("Enter the VAT rate that applies to your garage.");
  if (detail === "name") return t("A name is required.");
  if (detail === "email") return t("Enter a valid email address.");
  if (detail === "payment_requires_issue") return t("A payment can only be recorded on an issued invoice.");
  if (detail === "customer_locked_by_job_card") return t("This invoice comes from a job card: its customer and vehicle cannot change.");
  if (detail === "lines") return t("Add at least one line.");
  return t("Some values are not valid. Check the highlighted fields.");
}

export function errorText(e: unknown): string {
  return friendlyError(e).message;
}
