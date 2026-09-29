import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FileMinus } from "lucide-react";
import { useOrg, useSession } from "@/app/session.tsx";
import { EmptyState, ErrorState, Loading } from "@/components/ui/feedback.tsx";
import { Card, NotAllowed, PageHeader, TableWrap, tableClass, td, th, trClass } from "@/components/ui/layout.tsx";
import { Money } from "@/components/ui/money.tsx";
import { formatDate } from "@/lib/dates.ts";
import { t, useLang } from "@/lib/i18n.tsx";
import { supabase } from "@/lib/supabase.ts";
import type { CreditNoteRow } from "@/api/types.ts";

export const Route = createFileRoute("/_app/credit-notes/")({ component: CreditNotes });

function CreditNotes() {
  const org = useOrg();
  const { can, branchId } = useSession();
  const { lang } = useLang();
  const q = useQuery({
    queryKey: ["credit-notes", org.id, branchId],
    enabled: can("invoices.view"),
    queryFn: async () => {
      let r = supabase.from("v_credit_notes").select("*").eq("org_id", org.id);
      if (branchId) r = r.eq("branch_id", branchId);
      const { data, error } = await r.order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data as CreditNoteRow[];
    },
  });
  if (!can("invoices.view")) return <NotAllowed />;
  return (
    <div>
      <PageHeader title={t("Credit notes")} subtitle={t("Corrections of issued invoices. Create one from the invoice.")} />
      <Card padded={false}>
        {q.isPending && <Loading />}
        {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} className="m-4" />}
        {q.data && q.data.length === 0 && <EmptyState icon={<FileMinus className="size-6" />} title={t("No credit note")} text={t("To correct an issued invoice, open it and choose “Credit note”.")} />}
        {q.data && q.data.length > 0 && (
          <TableWrap>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={th}>{t("Credit note")}</th>
                  <th className={th}>{t("Invoice")}</th>
                  <th className={`${th} hidden md:table-cell`}>{t("Customer")}</th>
                  <th className={`${th} hidden lg:table-cell`}>{t("Reason")}</th>
                  <th className={`${th} text-end`}>{t("Amount")}</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((c) => (
                  <tr key={c.id} className={trClass}>
                    <td className={td}>
                      <Link to="/credit-notes/$id" params={{ id: c.id }} className="font-medium text-brand hover:underline">
                        {c.number}
                      </Link>
                      <div className="text-xs text-muted">{formatDate(c.issue_date, lang)}</div>
                    </td>
                    <td className={td}>
                      <Link to="/invoices/$id" params={{ id: c.invoice_id }} className="text-brand hover:underline">
                        {c.invoice_number}
                      </Link>
                    </td>
                    <td className={`${td} hidden md:table-cell`}>{c.customer_name}</td>
                    <td className={`${td} hidden max-w-64 truncate lg:table-cell`}>{c.reason}</td>
                    <td className={`${td} text-end`}>
                      <Money value={c.total} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
