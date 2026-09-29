import clsx from "clsx";
import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { t } from "@/lib/i18n.tsx";

/**
 * Modal dialog on the native <dialog> element: focus is trapped and Escape
 * closes it without extra code. Full-width sheet on phones.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="sheet m-0 mt-auto w-full sm:m-auto sm:w-fit"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="dialog-title"
    >
      {open && (
        <div
          className={clsx(
            "flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl",
            size === "sm" && "sm:w-[420px]",
            size === "md" && "sm:w-[560px]",
            size === "lg" && "sm:w-[760px]",
            size === "xl" && "sm:w-[960px]",
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
            <h2 id="dialog-title" className="min-w-0 truncate text-base font-semibold text-ink">
              {title}
            </h2>
            <button type="button" onClick={onClose} aria-label={t("Close")} className="inline-flex size-10 items-center justify-center rounded-lg text-muted hover:bg-canvas">
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
