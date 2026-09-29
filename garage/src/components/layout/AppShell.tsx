import { Link, useRouterState } from "@tanstack/react-router";
import clsx from "clsx";
import { ChevronDown, FileText, Home, LogOut, Menu, Plus, Search, Wrench, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useRefData, useSession } from "@/app/session.tsx";
import { GlobalSearch } from "@/components/search/GlobalSearch.tsx";
import { buttonClass } from "@/components/ui/button.tsx";
import { t, useLang } from "@/lib/i18n.tsx";
import { ROLES } from "@/lib/status.ts";
import { Logo } from "./Logo.tsx";
import { NAV, allowed } from "./nav.ts";

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { can } = useSession();
  return (
    <nav aria-label={t("Main")} className="space-y-5">
      {NAV.map((g) => {
        const items = g.items.filter((i) => allowed(i.perm, can));
        if (items.length === 0) return null;
        return (
          <div key={g.group}>
            <p className="mb-1 px-3 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">{t(g.group)}</p>
            <ul className="space-y-0.5">
              {items.map((i) => (
                <li key={i.to}>
                  <Link
                    to={i.to}
                    onClick={onNavigate}
                    activeOptions={{ exact: i.to === "/" }}
                    className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm text-side-ink hover:bg-side-2 hover:text-white data-[status=active]:bg-side-2 data-[status=active]:font-medium data-[status=active]:text-white"
                  >
                    <i.icon className="size-4 shrink-0 opacity-80" />
                    <span className="truncate">{t(i.label)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function OrgBlock() {
  const { org, role, displayName, memberships, switchOrg, signOut } = useSession();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((x) => !x)} aria-expanded={open} className="flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-start hover:bg-side-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-side-2 text-sm font-semibold text-white">{displayName.slice(0, 1).toUpperCase()}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-white">{displayName}</span>
          <span className="block truncate text-xs text-slate-400">
            {role ? t(ROLES[role]) : ""} · {org?.name}
          </span>
        </span>
        <ChevronDown className="size-4 text-slate-400" aria-hidden />
      </button>
      {open && (
        <div className="absolute inset-x-0 bottom-full z-20 mb-2 rounded-lg border border-line bg-surface p-1 text-sm text-ink shadow-lg">
          {memberships.length > 1 &&
            memberships.map((m) => (
              <button key={m.org_id} type="button" onClick={() => { switchOrg(m.org_id); setOpen(false); }} className={clsx("flex min-h-10 w-full items-center rounded-md px-3 text-start hover:bg-canvas", m.org_id === org?.id && "font-semibold")}>
                {m.organizations.name}
              </button>
            ))}
          <button type="button" onClick={() => signOut()} className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-start text-bad hover:bg-bad-soft">
            <LogOut className="size-4" aria-hidden /> {t("Sign out")}
          </button>
        </div>
      )}
    </div>
  );
}

function BranchSelect() {
  const ref = useRefData();
  const { branchId, setBranchId } = useSession();
  const branches = (ref.data?.branches ?? []).filter((b) => b.active);
  if (branches.length < 2) return null;
  return (
    <select
      aria-label={t("Branch")}
      value={branchId ?? ""}
      onChange={(e) => setBranchId(e.target.value || null)}
      className="min-h-10 max-w-44 rounded-lg border border-line-strong bg-surface px-2 text-sm"
    >
      <option value="">{t("All branches")}</option>
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </select>
  );
}

function LangToggle({ dark }: { dark?: boolean }) {
  const { lang, setLang } = useLang();
  return (
    <button
      type="button"
      onClick={() => setLang(lang === "ar" ? "en" : "ar")}
      className={clsx("inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg px-2 text-sm font-medium", dark ? "text-side-ink hover:bg-side-2" : "border border-line-strong bg-surface hover:bg-canvas")}
      aria-label={lang === "ar" ? "English" : "العربية"}
      lang={lang === "ar" ? "en" : "ar"}
    >
      {lang === "ar" ? "EN" : "ع"}
    </button>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { can } = useSession();
  const [searchOpen, setSearchOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => setDrawer(false), [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const canInvoice = can("invoices.create");

  return (
    <div className="flex min-h-full">
      {/* Sidebar (desktop) */}
      <aside className="no-print sticky top-0 hidden h-dvh w-64 shrink-0 flex-col bg-side lg:flex">
        <div className="flex items-center gap-3 px-5 py-5">
          <Logo />
          <div className="min-w-0">
            <p className="text-[15px] font-bold tracking-tight text-white">BS GARAGE</p>
            <p className="text-xs text-slate-400">{t("Billing & workshop")}</p>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <NavLinks />
        </div>
        <div className="border-t border-white/10 p-3">
          <div className="mb-2 flex justify-end">
            <LangToggle dark />
          </div>
          <OrgBlock />
        </div>
      </aside>

      {/* Drawer (mobile / tablet) */}
      {drawer && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label={t("Close menu")} className="absolute inset-0 bg-ink/50" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col bg-side">
            <div className="flex items-center justify-between px-4 py-4">
              <div className="flex items-center gap-2">
                <Logo className="size-8" />
                <span className="font-bold text-white">BS GARAGE</span>
              </div>
              <button type="button" onClick={() => setDrawer(false)} aria-label={t("Close menu")} className="inline-flex size-10 items-center justify-center rounded-lg text-side-ink hover:bg-side-2">
                <X className="size-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
              <NavLinks onNavigate={() => setDrawer(false)} />
            </div>
            <div className="border-t border-white/10 p-3">
              <div className="mb-2 flex justify-end">
                <LangToggle dark />
              </div>
              <OrgBlock />
            </div>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="no-print sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-surface/95 px-3 py-2 backdrop-blur sm:px-6">
          <button type="button" onClick={() => setDrawer(true)} aria-label={t("Open menu")} className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-canvas lg:hidden">
            <Menu className="size-5" />
          </button>
          <Link to="/" className="flex items-center gap-2 lg:hidden" aria-label="BS Garage">
            <Logo className="size-8" />
          </Link>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line-strong bg-canvas px-3 text-start text-sm text-muted hover:border-faint sm:max-w-md"
          >
            <Search className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{t("Search customers, plates, invoices, parts…")}</span>
            <kbd className="ms-auto hidden rounded border border-line-strong bg-surface px-1.5 text-[11px] sm:inline">Ctrl K</kbd>
          </button>
          <div className="ms-auto flex items-center gap-2">
            <BranchSelect />
            {canInvoice && (
              // Wrapped: the button's own display class would override "hidden".
              <span className="hidden sm:block">
                <Link to="/invoices/new" className={buttonClass("primary", "md")}>
                  <Plus className="size-4" aria-hidden />
                  {t("New Invoice")}
                </Link>
              </span>
            )}
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] min-w-0 flex-1 px-4 py-5 pb-28 sm:px-6 lg:pb-10">{children}</main>

        {/* Bottom bar (phones) */}
        <nav aria-label={t("Quick actions")} className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden">
          <Link to="/" activeOptions={{ exact: true }} className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-muted data-[status=active]:text-brand">
            <Home className="size-5" aria-hidden />
            {t("Home")}
          </Link>
          {can("invoices.view") ? (
            <Link to="/invoices" className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-muted data-[status=active]:text-brand">
              <FileText className="size-5" aria-hidden />
              {t("Invoices")}
            </Link>
          ) : (
            <span />
          )}
          {canInvoice ? (
            <Link to="/invoices/new" className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-brand">
              <span className="flex size-8 items-center justify-center rounded-full bg-brand text-white">
                <Plus className="size-5" aria-hidden />
              </span>
              {t("Invoice")}
            </Link>
          ) : (
            <span />
          )}
          <Link to="/job-cards" className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-muted data-[status=active]:text-brand">
            <Wrench className="size-5" aria-hidden />
            {t("Job cards")}
          </Link>
        </nav>
      </div>
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
