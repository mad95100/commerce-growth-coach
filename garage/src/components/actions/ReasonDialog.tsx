import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { Alert, FormError } from "@/components/ui/feedback.tsx";
import { Field, Textarea } from "@/components/ui/form.tsx";
import { t } from "@/lib/i18n.tsx";

/** Confirmation that requires a written reason (cancel invoice, void payment…). */
export function ReasonDialog({
  open,
  onClose,
  title,
  warning,
  confirmLabel,
  onConfirm,
  reasonRequired = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  warning: string;
  confirmLabel: string;
  onConfirm: (reason: string) => Promise<void>;
  reasonRequired?: boolean;
}) {
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (reasonRequired && !reason.trim()) return setInvalid(true);
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{t("Keep")}</Button>
          <Button variant="danger" type="submit" form="reason-form" loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id="reason-form" onSubmit={submit} className="space-y-4" noValidate>
        <Alert tone="warn">{warning}</Alert>
        {reasonRequired && (
          <Field label={t("Reason")} required error={invalid ? t("A reason is required.") : null}>
            {(id, d) => <Textarea id={id} aria-describedby={d} aria-invalid={invalid} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
        )}
        <FormError error={error} />
      </form>
    </Dialog>
  );
}
