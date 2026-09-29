/** Labels and colour tones for every status shown in the app. */
export type Tone = "neutral" | "brand" | "ok" | "warn" | "bad" | "info" | "refund" | "muted";

export const INVOICE_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Sent", tone: "info" },
  unpaid: { label: "Unpaid", tone: "warn" },
  partially_paid: { label: "Partially paid", tone: "warn" },
  paid: { label: "Paid", tone: "ok" },
  overdue: { label: "Overdue", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "muted" },
  refund_due: { label: "Refund due", tone: "refund" },
};

export const ESTIMATE_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Sent", tone: "info" },
  pending: { label: "Pending", tone: "warn" },
  approved: { label: "Approved", tone: "ok" },
  rejected: { label: "Rejected", tone: "bad" },
  expired: { label: "Expired", tone: "muted" },
  converted: { label: "Converted", tone: "brand" },
};

export const JOB_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: "Open", tone: "neutral" },
  in_progress: { label: "In progress", tone: "info" },
  waiting_parts: { label: "Waiting parts", tone: "warn" },
  ready: { label: "Ready", tone: "ok" },
  delivered: { label: "Delivered", tone: "muted" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

export const APPOINTMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  requested: { label: "Requested", tone: "neutral" },
  confirmed: { label: "Confirmed", tone: "brand" },
  arrived: { label: "Arrived", tone: "info" },
  in_progress: { label: "In progress", tone: "info" },
  ready: { label: "Ready", tone: "ok" },
  completed: { label: "Completed", tone: "muted" },
  cancelled: { label: "Cancelled", tone: "muted" },
  no_show: { label: "No show", tone: "bad" },
};

export const PO_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  ordered: { label: "Ordered", tone: "info" },
  partially_received: { label: "Partially received", tone: "warn" },
  received: { label: "Received", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

export const INSPECTION_ITEM_STATUS: Record<string, { label: string; tone: Tone }> = {
  ok: { label: "OK", tone: "ok" },
  attention: { label: "Attention", tone: "warn" },
  urgent: { label: "Urgent", tone: "bad" },
};

export const ROLES: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  service_advisor: "Service Advisor",
  mechanic: "Mechanic",
  accountant: "Accountant",
};

export const LINE_KINDS: Record<string, string> = {
  part: "Part",
  labor: "Labor",
  service: "Service",
  other: "Other",
};

export const MOVEMENT_LABEL: Record<string, string> = {
  stock_in: "Stock in",
  stock_out: "Stock out",
  adjustment: "Adjustment",
  count: "Inventory count",
  sale: "Sold on invoice",
  sale_reversal: "Returned (cancel / credit note)",
  purchase_receipt: "Received from supplier",
};

