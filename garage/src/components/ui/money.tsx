import clsx from "clsx";
import { formatMoney } from "@/lib/money.ts";
import { useLang } from "@/lib/i18n.tsx";

export function Money({ value, className, strong }: { value: number | string | null | undefined; className?: string; strong?: boolean }) {
  const { lang } = useLang();
  return <span className={clsx("num whitespace-nowrap", strong && "font-semibold", className)}>{formatMoney(value ?? 0, lang)}</span>;
}
