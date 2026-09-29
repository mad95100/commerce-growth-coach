import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Building2, Download, Plus, Search, User, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useOrg, useSession } from "@/app/session.tsx";
import { CustomerDialog } from "@/components/forms/CustomerForm.tsx";
import { Button } from "@/components/ui/button.tsx";
import { EmptyState, ErrorState, Loading } from "@/components/ui/feedback.tsx";
import { Chips, Input } from "@/components/ui/form.tsx";
import { Card, NotAllowed, PageHeader, TableWrap, tableClass, td, th, trClass } from "@/components/ui/layout.tsx";
import { toCsv } from "@/lib/csv.ts";
import { downloadText } from "@/lib/download.ts";
import { t, useLang } from "@/lib/i18n.tsx";
import { formatPhone, phoneSearchKey } from "@/lib/phone.ts";
import { emirateName } from "@/lib/plates.ts";
import { supabase } from "@/lib/supabase.ts";
import type { Customer } from "@/api/types.ts";

export const Route = createFileRoute("/_app/customers/")({ component: Customers });

type Row = Customer & { vehicles: Array<{ count: number }> };

function Customers() {
  const org = useOrg();
  const { can } = useSession();
  const { lang } = useLang();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [dq, setDq] = useState("");
  const [type, setType] = useState<"all" | "individual" | "company" | "archived">("all");
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setDq(text.trim().replace(/[,()%*\\]/g, " ")), 250);
    return () => clearTimeout(id);
  }, [text]);

  const q = useQuery({
    queryKey: ["customers", org.id, dq, type],
    enabled: can("customers.view"),
    queryFn: async () => {
      let r = supabase.from("customers").select("*, vehicles(count)").eq("org_id", org.id);
      r = type === "archived" ? r.not("archived_at", "is", null) : r.is("archived_at", null);
      if (type === "individual" || type === "company") r = r.eq("type", type);
      if (dq) {
        const key = phoneSearchKey(dq);
        r = r.or([`display_name.ilike.%${dq}%`, `email.ilike.%${dq}%`, `company_name.ilike.%${dq}%`, `trn.ilike.%${dq}%`, key ? `phone_key.like.%${key}%` : null, key ? `whatsapp_key.like.%${key}%` : null].filter(Boolean).join(","));
      }
      const { data, error } = await r.order("display_name").limit(300);
      if (error) throw error;
      return data as Row[];
    },
  });

  if (!can("customers.view")) return <NotAllowed />;
  return (
    <div>
      <PageHeader
        title={t("Customers")}
        actions={
          <>
            <Button
              icon={<Download className="size-4" />}
              onClick={() =>
                downloadText(
                  "customers.csv",
                  toCsv(q.data ?? [], [
                    { header: "Type", value: (c) => c.type },
                    { header: "First name", value: (c) => c.first_name },
                    { header: "Last name", value: (c) => c.last_name },
                    { header: "Company name", value: (c) => c.company_name },
                    { header: "Phone", value: (c) => c.phone },
                    { header: "WhatsApp", value: (c) => c.whatsapp },
                    { header: "Email", value: (c) => c.email },
                    { header: "Address", value: (c) => c.address },
                    { header: "Emirate", value: (c) => c.emirate },
                    { header: "TRN", value: (c) => c.trn },
                    { header: "Trade licence", value: (c) => c.trade_license_no },
                    { header: "Notes", value: (c) => c.notes },
                  ]),
                )
              }
            >
              {t("Export CSV")}
            </Button>
            {can("customers.manage") && (
              <Button variant="primary" onClick={() => setCreating(true)} icon={<Plus className="size-4" />}>
                {t("New customer")}
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1 lg:max-w-md">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <Input aria-label={t("Search customers")} placeholder={t("Name, phone, WhatsApp, email, TRN…")} value={text} onChange={(e) => setText(e.target.value)} className="ps-9" />
        </div>
        <Chips
          label={t("Type")}
          value={type}
          onChange={setType}
          options={[
            { value: "all", label: t("All") },
            { value: "individual", label: t("Individuals") },
            { value: "company", label: t("Companies") },
            { value: "archived", label: t("Archived") },
          ]}
        />
      </div>
      <p className="mb-2 text-xs text-muted">{t("To find a customer by plate or VIN, use the search bar at the top.")}</p>
      <Card padded={false}>
        {q.isPending && <Loading />}
        {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} className="m-4" />}
        {q.isSuccess && q.data.length === 0 && (
          <EmptyState
            icon={<Users className="size-6" />}
            title={dq || type !== "all" ? t("No customer matches") : t("No customer yet")}
            text={!dq && type === "all" ? t("Customers are also created directly from a new invoice or estimate.") : undefined}
            action={!dq && type === "all" && can("customers.manage") && <Button variant="primary" onClick={() => setCreating(true)} icon={<Plus className="size-4" />}>{t("New customer")}</Button>}
          />
        )}
        {q.data && q.data.length > 0 && (
          <TableWrap>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={th}>{t("Customer")}</th>
                  <th className={th}>{t("Phone")}</th>
                  <th className={`${th} hidden md:table-cell`}>{t("Email")}</th>
                  <th className={`${th} hidden lg:table-cell`}>{t("Emirate")}</th>
                  <th className={`${th} text-end`}>{t("Vehicles")}</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((c) => (
                  <tr key={c.id} className={trClass}>
                    <td className={td}>
                      <Link to="/customers/$id" params={{ id: c.id }} className="flex items-center gap-2 font-medium text-brand hover:underline">
                        {c.type === "company" ? <Building2 className="size-4 text-muted" aria-hidden /> : <User className="size-4 text-muted" aria-hidden />}
                        <span className="truncate">{c.display_name}</span>
                      </Link>
                    </td>
                    <td className={`${td} whitespace-nowrap`}>{formatPhone(c.phone)}</td>
                    <td className={`${td} hidden max-w-56 truncate md:table-cell`}>{c.email}</td>
                    <td className={`${td} hidden lg:table-cell`}>{emirateName(c.emirate, lang)}</td>
                    <td className={`${td} text-end num`}>{c.vehicles?.[0]?.count ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      {creating && <CustomerDialog open onClose={() => setCreating(false)} onSaved={(c) => navigate({ to: "/customers/$id", params: { id: c.id } })} />}
    </div>
  );
}
