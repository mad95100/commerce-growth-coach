import clsx from "clsx";
import { AlertTriangle, Inbox, Loader2, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { friendlyError } from "@/lib/errors.ts";
import { t } from "@/lib/i18n.tsx";
import type { Tone } from "@/lib/status.ts";

const toneClass: Record<Tone, string> = {
  neutral: "bg-canvas text-ink-2 border-line-strong",
  brand: "bg-brand-soft text-brand-ink border-brand/30",
  ok: "bg-ok-soft text-ok border-ok/25",
  warn: "bg-warn-soft text-warn border-warn/25",
  bad: "bg-bad-soft text-bad border-bad/25",
  info: "bg-info-soft text-info border-info/25",
  refund: "bg-refund-soft text-refund border-refund/25",
  muted: "bg-canvas text-muted border-line line-through decoration-muted/40",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold whitespace-nowrap", toneClass[tone], className)}>
      {children}
    </span>
  );
}

export function StatusBadge({ map, status }: { map: Record<string, { label: string; tone: Tone }>; status: string | null | undefined }) {
  const s = status ? map[status] : undefined;
  if (!s) return <Badge>{status ?? "—"}</Badge>;
  return <Badge tone={s.tone}>{t(s.label)}</Badge>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("size-5 animate-spin text-muted", className)} aria-hidden />;
}

/** Loading state. Distinct from "empty" and from "error". */
export function Loading({ label, className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={clsx("flex items-center justify-center gap-2 py-12 text-sm text-muted", className)}>
      <Spinner />
      {label ?? t("Loading…")}
    </div>
  );
}

/** A read that FAILED. Never shown as an empty list. */
export function ErrorState({ error, retry, className }: { error: unknown; retry?: () => void; className?: string }) {
  const f = friendlyError(error);
  return (
    <div role="alert" className={clsx("flex flex-col items-center gap-3 rounded-xl border border-bad/25 bg-bad-soft px-4 py-8 text-center", className)}>
      <AlertTriangle className="size-6 text-bad" aria-hidden />
      <div>
        <p className="font-medium text-ink">{t("This could not be loaded.")}</p>
        <p className="mt-1 text-sm text-ink-2">{f.message}</p>
      </div>
      {retry && (
        <button type="button" onClick={retry} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-canvas">
          <RefreshCw className="size-4" aria-hidden />
          {t("Try again")}
        </button>
      )}
      {f.technical && (
        <details className="max-w-full text-xs text-muted">
          <summary className="cursor-pointer">{t("Technical details")}</summary>
          <code className="mt-1 block break-all">{f.technical}</code>
        </details>
      )}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  text,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex flex-col items-center gap-2 px-4 py-12 text-center", className)}>
      <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-canvas text-faint">{icon ?? <Inbox className="size-6" aria-hidden />}</div>
      <p className="font-medium text-ink">{title}</p>
      {text && <p className="max-w-md text-sm text-muted">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "warn", title, children, className }: { tone?: Tone; title?: string; children?: ReactNode; className?: string }) {
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={clsx("rounded-lg border px-4 py-3 text-sm", toneClass[tone], "no-underline [text-decoration:none]", className)}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={clsx(title && "mt-0.5", "text-ink-2")}>{children}</div>}
    </div>
  );
}

/** Inline error under a form or dialog, from a thrown mutation error. */
export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  const f = friendlyError(error);
  return (
    <div role="alert" className="rounded-lg border border-bad/25 bg-bad-soft px-3 py-2 text-sm text-bad">
      {f.message}
    </div>
  );
}
