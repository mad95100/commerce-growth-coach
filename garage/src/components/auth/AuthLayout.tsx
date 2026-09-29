import type { ReactNode } from "react";
import { Logo } from "@/components/layout/Logo.tsx";
import { t, useLang } from "@/lib/i18n.tsx";

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const { lang, setLang } = useLang();
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo className="size-10" />
            <div>
              <p className="text-lg font-bold tracking-tight">BS GARAGE</p>
              <p className="text-xs text-muted">{t("Billing & workshop")}</p>
            </div>
          </div>
          <button type="button" onClick={() => setLang(lang === "ar" ? "en" : "ar")} className="min-h-10 rounded-lg border border-line-strong bg-surface px-3 text-sm">
            {lang === "ar" ? "English" : "العربية"}
          </button>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
