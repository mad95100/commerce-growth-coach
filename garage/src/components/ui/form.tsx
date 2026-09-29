import clsx from "clsx";
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export const inputClass =
  "block w-full min-h-11 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-faint " +
  "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-canvas disabled:text-muted " +
  "aria-[invalid=true]:border-bad";

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: (id: string, describedBy?: string) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = hint || error ? `${id}-hint` : undefined;
  return (
    <div className={clsx("min-w-0", className)}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink-2">
        {label}
        {required && <span className="text-bad ms-0.5" aria-hidden>*</span>}
      </label>
      {children(id, hintId)}
      {(error || hint) && (
        <p id={hintId} className={clsx("mt-1 text-xs", error ? "text-bad" : "text-muted")}>
          {error || hint}
        </p>
      )}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(inputClass, className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(inputClass, "pe-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(inputClass, "min-h-20 py-2", className)} {...rest} />;
}

export function Checkbox({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={clsx("inline-flex min-h-11 items-center gap-2 text-sm text-ink-2", className)}>
      <input type="checkbox" className="size-4 rounded border-line-strong accent-brand" {...rest} />
      {label}
    </label>
  );
}

/** Segmented choice (status filters, payment methods, periods). */
export function Chips<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: ReactNode; count?: number }>;
  label: string;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={label} className={clsx("flex flex-wrap gap-1.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "inline-flex items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors",
            size === "md" ? "min-h-10" : "min-h-8",
            value === o.value
              ? "border-brand bg-brand-soft text-brand-ink"
              : "border-line-strong bg-surface text-ink-2 hover:bg-canvas",
          )}
        >
          {o.label}
          {o.count !== undefined && (
            <span className={clsx("rounded-full px-1.5 text-xs num", value === o.value ? "bg-brand text-white" : "bg-canvas text-muted")}>
              {o.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
