import { Link, type LinkProps } from "@tanstack/react-router";
import clsx from "clsx";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md" | "lg";

export function buttonClass(variant: Variant = "secondary", size: Size = "md", extra?: string) {
  return clsx(
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors select-none whitespace-nowrap",
    "disabled:opacity-50 disabled:pointer-events-none",
    size === "sm" && "min-h-9 px-3 text-sm",
    size === "md" && "min-h-11 px-4 text-sm",
    size === "lg" && "min-h-12 px-5 text-base",
    variant === "primary" && "bg-brand text-white shadow-sm hover:bg-brand-hover",
    variant === "secondary" && "border border-line-strong bg-surface text-ink hover:bg-canvas",
    variant === "ghost" && "text-ink-2 hover:bg-canvas",
    variant === "danger" && "bg-bad text-white hover:opacity-90",
    variant === "success" && "bg-ok text-white hover:opacity-90",
    extra,
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  icon,
  className,
  children,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode }) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} disabled={loading || rest.disabled} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
  ...rest
}: LinkProps & { variant?: Variant; size?: Size; icon?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx("inline-flex size-11 items-center justify-center rounded-lg text-ink-2 hover:bg-canvas", className)}
      {...rest}
    >
      {children}
    </button>
  );
}
