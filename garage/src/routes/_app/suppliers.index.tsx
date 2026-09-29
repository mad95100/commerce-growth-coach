import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus, Search, Truck } from "lucide-react";
import { useState } from "react";
import { useOrg, useSession } from "@/app/session.tsx";
import { SupplierDialog } from "@/components/catalog/SupplierDialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge, EmptyState, ErrorState, Loading } from "@/components/ui/feedback.tsx";
import { Input } from "@/components/ui/form.tsx";
import { Card, NotAllowed, PageHeader, TableWrap, tableClass, td, th, trClass } from "@/components/ui/layout.tsx";
import { t } from "@/lib/i18n.tsx";
import { formatPhone } from "@/lib/phone.ts";
import { supabase } from "@/lib/supabase.ts";
import type { Supplier } from "@/api/types.ts";

export const Route = createFileRoute("/_app/suppliers/")({ component: Suppliers });

function Suppliers() {
  const org = useOrg();
  const { can } = useSession();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: ["suppliers", org.id],
    enabled: can("suppliers.view"),
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("*").eq("org_id", org.id).order("name");
      if (error) throw error;
      return data as Supplier[];
    },
  });
  if (!can("suppliers.view")) return <NotAllowed />;
  const s = text.trim().toLowerCase();
  const rows = (q.data ?? []).filter((x) => !s || [x.name, x.contact_name, x.phone, x.email].some((v) => (v ?? "").toLowerCase().includes(s)));
  return (
    <div>
      <PageHeader title={t("Suppliers")} actions={can("suppliers.manage") && <Button variant="primary" onClick={() => setCreating(true)} icon={<Plus className="size-4" />}>{t("New supplier")}</Button>} />
      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
        <Input aria-label={t("Search suppliers")} placeholder={t("Company, contact, phone…")} value={text} onChange={(e) => setText(e.target.value)} className="ps-9" />
      </div>
      <Card padded={false}>
        {q.isPending && <Loading />}
        {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} className="m-4" />}
        {q.isSuccess && rows.length === 0 && <EmptyState icon={<Truck className="size-6" />} title={s ? t("No supplier matches") : t("No supplier yet")} action={!s && can("suppliers.manage") && <Button variant="primary" onClick={() => setCreating(true)} icon={<Plus className="size-4" />}>{t("New supplier")}</Button>} />}
        {rows.length > 0 && (
          <TableWrap>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={th}>{t("Company")}</th>
                  <th className={`${th} hidden md:table-cell`}>{t("Contact")}</th>
                  <th className={th}>{t("Phone")}</th>
                  <th className={`${th} hidden lg:table-cell`}>{t("Payment terms")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.id} className={trClass}>
                    <td className={td}>
                      <Link to="/suppliers/$id" params={{ id: x.id }} className="font-medium text-brand hover:underline">
                        {x.name}
                      </Link>{" "}
                      {!x.active && <Badge tone="muted">{t("Inactive")}</Badge>}
                    </td>
                    <td className={`${td} hidden md:table-cell`}>{x.contact_name}</td>
                    <td className={`${td} whitespace-nowrap`}>{formatPhone(x.phone)}</td>
                    <td className={`${td} hidden lg:table-cell`}>{x.payment_terms}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      {creating && <SupplierDialog supplier={null} onClose={() => setCreating(false)} onSaved={(x) => navigate({ to: "/suppliers/$id", params: { id: x.id } })} />}
    </div>
  );
}
