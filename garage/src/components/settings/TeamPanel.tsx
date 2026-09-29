import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { useState } from "react";
import { useOrg, useSession } from "@/app/session.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Alert, Badge, ErrorState, FormError, Loading } from "@/components/ui/feedback.tsx";
import { Field, Input, Select } from "@/components/ui/form.tsx";
import { Card, CardTitle } from "@/components/ui/layout.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { formatDate } from "@/lib/dates.ts";
import { t, useLang } from "@/lib/i18n.tsx";
import { ROLES } from "@/lib/status.ts";
import { rpc, supabase } from "@/lib/supabase.ts";
import type { Membership } from "@/api/types.ts";

const ROLE_HELP: Record<string, string> = {
  owner: "Everything, including team and settings.",
  admin: "Everything, including team and settings.",
  manager: "All billing and workshop work, reports, cancellations. No settings, no team.",
  service_advisor: "Customers, estimates, job cards, invoices and payments. Cannot cancel or refund.",
  mechanic: "Their own job cards and inspections. No prices, no invoices.",
  accountant: "Invoices, payments, refunds, credit notes, reports and audit log. Does not create invoices.",
};

export function TeamPanel() {
  const org = useOrg();
  const { user, role: myRole } = useSession();
  const { lang } = useLang();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ email: "", name: "", role: "service_advisor" });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["team", org.id],
    queryFn: async () => {
      const [m, i] = await Promise.all([
        supabase.from("memberships").select("*").eq("org_id", org.id).order("created_at"),
        supabase.from("invitations").select("*").eq("org_id", org.id).is("accepted_at", null).is("revoked_at", null).order("created_at", { ascending: false }),
      ]);
      if (m.error) throw m.error;
      if (i.error) throw i.error;
      return { members: m.data as Membership[], invites: i.data as Array<{ id: string; email: string; role: string; display_name: string | null; created_at: string }> };
    },
  });
  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["team", org.id] });
      if (done) toast(done);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const roles = Object.keys(ROLES).filter((r) => r !== "owner" || myRole === "owner");
  return (
    <div className="space-y-5">
      <Card>
        <CardTitle>{t("Invite a team member")}</CardTitle>
        <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr_1fr_auto] sm:items-end">
          <Field label={t("Email")}>{(id) => <Input id={id} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
          <Field label={t("Name")}>{(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label={t("Role")}>
            {(id) => (
              <Select id={id} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {t(ROLES[r])}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button variant="primary" loading={busy} disabled={!f.email.trim()} onClick={() => run(async () => { await rpc("invite_member", { p_org: org.id, p_email: f.email, p_role: f.role, p_name: f.name }); setF({ email: "", name: "", role: f.role }); }, t("Invitation recorded."))} icon={<UserPlus className="size-4" />}>
            {t("Invite")}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted">{t(ROLE_HELP[f.role])}</p>
        <Alert tone="info" className="mt-3">
          {t("No email is sent automatically. Tell the person to create an account (or sign in) at this address with this email: they join the garage as soon as they sign in.")}
        </Alert>
        <div className="mt-3">
          <FormError error={error} />
        </div>
      </Card>
      {q.data.invites.length > 0 && (
        <Card>
          <CardTitle>{t("Pending invitations")}</CardTitle>
          <ul className="divide-y divide-line">
            {q.data.invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span>
                  <span className="font-medium">{i.display_name || i.email}</span> <Badge>{t(ROLES[i.role])}</Badge>
                  <span className="block text-xs text-muted">
                    {i.email} · {formatDate(i.created_at.slice(0, 10), lang)}
                  </span>
                </span>
                <Button size="sm" variant="ghost" className="text-bad" onClick={() => run(() => rpc("revoke_invitation", { p_id: i.id }))}>
                  {t("Revoke")}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card>
        <CardTitle>{t("Team")}</CardTitle>
        <ul className="divide-y divide-line">
          {q.data.members.map((m) => {
            const self = m.user_id === user?.id;
            const locked = self || (m.role === "owner" && myRole !== "owner");
            return (
              <li key={m.user_id} className="grid items-center gap-2 py-3 sm:grid-cols-[1fr_200px_auto]">
                <span className="min-w-0">
                  <span className="font-medium">{m.display_name || m.email}</span> {self && <Badge tone="brand">{t("You")}</Badge>} {!m.active && <Badge tone="muted">{t("Inactive")}</Badge>}
                  <span className="block truncate text-xs text-muted">{m.email}</span>
                </span>
                <Select aria-label={t("Role of {name}", { name: m.display_name || m.email || "" })} disabled={locked} value={m.role} onChange={(e) => run(() => rpc("update_member", { p_org: org.id, p_user: m.user_id, p_role: e.target.value, p_active: m.active }), t("Role updated."))}>
                  {Object.keys(ROLES).filter((r) => r !== "owner" || myRole === "owner" || m.role === "owner").map((r) => (
                    <option key={r} value={r}>
                      {t(ROLES[r])}
                    </option>
                  ))}
                </Select>
                <Button size="sm" variant="ghost" disabled={locked} onClick={() => run(() => rpc("update_member", { p_org: org.id, p_user: m.user_id, p_role: m.role, p_active: !m.active }))}>
                  {m.active ? t("Deactivate") : t("Activate")}
                </Button>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
