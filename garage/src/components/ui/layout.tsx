import { Link } from "@tanstack/react-router";
import clsx from "clsx";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n.tsx";

export function Card({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <section className={clsx("min-w-0 rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgb(15_23_42/0.04)]", padded && "p-4 sm:p-5", className)}>{children}</section>;
}

export function CardTitle({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={clsx("mb-3 flex min-w-0 items-center justify-between gap-3", className)}>
      <h2 className="min-w-0 truncate text-sm font-semibold text-ink">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
  badge,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string; params?: Record<string, string> };
  badge?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link to={back.to} params={back.params} className="mb-1 inline-flex min-h-9 items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
            {back.label}
          </Link>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="min-w-0 break-words text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
          {badge}
        </div>
        {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
  to,
  search,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "ok" | "warn" | "bad";
  to?: string;
  search?: Record<string, unknown>;
}) {
  const body = (
    <>
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className={clsx("mt-1 text-lg font-semibold whitespace-nowrap num tracking-tight sm:text-xl", tone === "ok" && "text-ok", tone === "warn" && "text-warn", tone === "bad" && "text-bad")}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </>
  );
  const cls = "block min-w-0 rounded-xl border border-line bg-surface p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04)]";
  return to ? (
    <Link to={to} search={search} className={clsx(cls, "hover:border-line-strong")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: Array<{ value: T; label: string; count?: number }>;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="-mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-line px-1">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          type="button"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={clsx(
            "-mb-px inline-flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm font-medium",
            value === tab.value ? "border-brand text-brand-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {tab.label}
          {tab.count !== undefined && <span className="rounded-full bg-canvas px-1.5 text-xs text-muted num">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function DescriptionList({ items, className }: { items: Array<[string, ReactNode]>; className?: string }) {
  return (
    <dl className={clsx("grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2", className)}>
      {items
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="mt-0.5 break-words text-sm text-ink">{v}</dd>
          </div>
        ))}
    </dl>
  );
}

/** Horizontal-scroll wrapper so wide tables never make the PAGE scroll. */
export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("-mx-4 overflow-x-auto sm:mx-0", className)}>{children}</div>;
}

export const th = "px-3 py-2.5 text-start text-xs font-medium tracking-wide text-muted uppercase whitespace-nowrap";
export const td = "px-3 py-3 text-sm text-ink align-top";
export const tableClass = "w-full min-w-full border-collapse";
export const trClass = "border-t border-line hover:bg-canvas/60";

export function Muted({ children }: { children: ReactNode }) {
  return <span className="text-muted">{children}</span>;
}

export function Dash() {
  return <span className="text-faint">—</span>;
}

export function NotAllowed() {
  return (
    <Card>
      <p className="py-8 text-center text-sm text-muted">{t("Your role does not give access to this page.")}</p>
    </Card>
  );
}
