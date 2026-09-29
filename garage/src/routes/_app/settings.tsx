import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSession } from "@/app/session.tsx";
import { BranchesPanel, MethodsPanel, NumberingPanel, TaxPanel, TechniciansPanel } from "@/components/settings/ListsPanel.tsx";
import { GaragePanel } from "@/components/settings/GaragePanel.tsx";
import { ImportPanel } from "@/components/settings/ImportPanel.tsx";
import { TeamPanel } from "@/components/settings/TeamPanel.tsx";
import { NotAllowed, PageHeader, Tabs } from "@/components/ui/layout.tsx";
import { t } from "@/lib/i18n.tsx";

type Tab = "garage" | "branches" | "vat" | "payments" | "numbering" | "team" | "mechanics" | "import";
const ALL: Tab[] = ["garage", "branches", "vat", "payments", "numbering", "team", "mechanics", "import"];

export const Route = createFileRoute("/_app/settings")({
  component: Settings,
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } => ({ tab: ALL.includes(s.tab as Tab) ? (s.tab as Tab) : undefined }),
});

function Settings() {
  const { can } = useSession();
  const requested = Route.useSearch().tab;
  const navigate = useNavigate({ from: Route.fullPath });
  const settings = can("settings.manage");
  const importer = can("customers.manage") || can("catalog.manage") || can("suppliers.manage");
  const tabs: Array<{ value: Tab; label: string }> = [
    ...(settings
      ? ([
          { value: "garage", label: t("Garage") },
          { value: "branches", label: t("Branches") },
          { value: "vat", label: t("VAT rates") },
          { value: "payments", label: t("Payment methods") },
          { value: "numbering", label: t("Numbering") },
        ] as const)
      : []),
    ...(can("users.manage") ? [{ value: "team" as Tab, label: t("Team") }] : []),
    ...(can("staff.manage") ? [{ value: "mechanics" as Tab, label: t("Mechanics") }] : []),
    ...(importer ? [{ value: "import" as Tab, label: t("Import") }] : []),
  ];
  if (tabs.length === 0) return <NotAllowed />;
  const tab = tabs.some((x) => x.value === requested) ? requested! : tabs[0].value;
  return (
    <div>
      <PageHeader title={t("Settings")} />
      <Tabs label={t("Settings sections")} value={tab} onChange={(v) => navigate({ search: { tab: v } })} tabs={tabs} />
      <div className="max-w-4xl">
        {tab === "garage" && <GaragePanel />}
        {tab === "branches" && <BranchesPanel />}
        {tab === "vat" && <TaxPanel />}
        {tab === "payments" && <MethodsPanel />}
        {tab === "numbering" && <NumberingPanel />}
        {tab === "team" && <TeamPanel />}
        {tab === "mechanics" && <TechniciansPanel />}
        {tab === "import" && <ImportPanel />}
      </div>
    </div>
  );
}
