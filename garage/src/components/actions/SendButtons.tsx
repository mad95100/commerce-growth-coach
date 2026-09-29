import { useQueryClient } from "@tanstack/react-query";
import { Mail, MessageCircle, Printer } from "lucide-react";
import { useOrg } from "@/app/session.tsx";
import { Button } from "@/components/ui/button.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { t } from "@/lib/i18n.tsx";
import { mailtoUrl, whatsappUrl } from "@/lib/phone.ts";
import { rpc } from "@/lib/supabase.ts";

export interface SendContext {
  purpose: "invoice" | "invoice_reminder" | "estimate" | "receipt" | "credit_note" | "job_card" | "vehicle_ready" | "appointment_reminder" | "inspection";
  message: { subject: string; body: string };
  phone?: string | null; // WhatsApp number (falls back to phone)
  email?: string | null;
  refs: Partial<Record<"customer_id" | "invoice_id" | "estimate_id" | "job_card_id" | "payment_id" | "credit_note_id" | "inspection_id" | "appointment_id", string | null>>;
  printHref?: string;
}

/**
 * "Send" means: open WhatsApp or the email app with the message prepared,
 * for the employee to send. It is logged as opened, never as delivered.
 */
export function SendButtons({ ctx, size = "md" }: { ctx: SendContext; size?: "sm" | "md" }) {
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const wa = whatsappUrl(ctx.phone, ctx.message.body);
  const mail = mailtoUrl(ctx.email, ctx.message.subject, ctx.message.body);

  async function log(channel: "whatsapp" | "email", recipient: string) {
    try {
      await rpc("log_outbound_message", { p: { org_id: org.id, channel, purpose: ctx.purpose, recipient, body: ctx.message.body, ...ctx.refs } });
      await qc.invalidateQueries();
    } catch {
      toast(t("The message opened, but it could not be recorded in the history."), "bad");
    }
  }

  return (
    <>
      {ctx.printHref && (
        <a href={ctx.printHref} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium hover:bg-canvas">
          <Printer className="size-4" aria-hidden /> {t("Print / PDF")}
        </a>
      )}
      <Button
        size={size}
        disabled={!wa}
        title={wa ? t("Opens WhatsApp with the message ready to send") : t("No phone number for this customer")}
        onClick={() => {
          window.open(wa!, "_blank", "noopener");
          log("whatsapp", ctx.phone ?? "");
        }}
        icon={<MessageCircle className="size-4 text-[#128c4a]" />}
      >
        {t("WhatsApp")}
      </Button>
      <Button
        size={size}
        disabled={!mail}
        title={mail ? t("Opens your email app with the message ready to send") : t("No email address for this customer")}
        onClick={() => {
          window.location.href = mail!;
          log("email", ctx.email ?? "");
        }}
        icon={<Mail className="size-4" />}
      >
        {t("Email")}
      </Button>
    </>
  );
}
