import { createRootRoute, Outlet, Link } from "@tanstack/react-router";
import { backendMissing } from "@/lib/supabase.ts";
import { t } from "@/lib/i18n.tsx";

export const Route = createRootRoute({
  component: Root,
  notFoundComponent: () => (
    <div className="flex min-h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-lg font-semibold">{t("Page not found")}</p>
      <Link to="/" className="text-brand underline">
        {t("Back to the dashboard")}
      </Link>
    </div>
  ),
});

function Root() {
  if (backendMissing) {
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-line bg-surface p-6 text-sm">
          <p className="text-base font-semibold">{t("BS Garage is not connected to its database yet.")}</p>
          <p className="mt-2 text-ink-2">
            {t("The administrator must set the project address and public key before building the application. See the deployment guide in the documentation.")}
          </p>
        </div>
      </div>
    );
  }
  return <Outlet />;
}
