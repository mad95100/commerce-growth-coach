import { createFileRoute, Navigate, Outlet, useRouterState } from "@tanstack/react-router";
import { useSession } from "@/app/session.tsx";
import { AppShell } from "@/components/layout/AppShell.tsx";
import { ErrorState, Loading } from "@/components/ui/feedback.tsx";
import { t } from "@/lib/i18n.tsx";

export const Route = createFileRoute("/_app")({ component: AppLayout });

function AppLayout() {
  const s = useSession();
  const href = useRouterState({ select: (r) => r.location.href });
  if (s.status === "loading") return <Loading className="min-h-full" label={t("Opening your garage…")} />;
  if (s.status === "signed_out") return <Navigate to="/login" search={{ redirect: href }} />;
  if (s.status === "no_org") return <Navigate to="/onboarding" />;
  if (s.status === "error")
    return (
      <div className="p-6">
        <ErrorState error={s.error} retry={() => s.reload()} />
      </div>
    );
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
