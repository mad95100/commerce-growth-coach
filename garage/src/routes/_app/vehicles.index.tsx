import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Car, Download, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useOrg, useSession } from "@/app/session.tsx";
import { Button } from "@/components/ui/button.tsx";
import { EmptyState, ErrorState, Loading } from "@/components/ui/feedback.tsx";
import { Input } from "@/components/ui/form.tsx";
import { Card, NotAllowed, PageHeader, TableWrap, tableClass, td, th, trClass } from "@/components/ui/layout.tsx";
import { toCsv } from "@/lib/csv.ts";
import { downloadText } from "@/lib/download.ts";
import { t, useLang } from "@/lib/i18n.tsx";
import { formatPlate, parsePlateQuery } from "@/lib/plates.ts";
import { supabase } from "@/lib/supabase.ts";
import type { Vehicle } from "@/api/types.ts";

export const Route = createFileRoute("/_app/vehicles/")({ component: Vehicles });

type Row = Vehicle & { customers: { display_name: string; phone: string | null } | null };

function Vehicles() {
  const org = useOrg();
  const { can } = useSession();
  const { lang } = useLang();
  const [text, setText] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDq(text.trim().replace(/[,()%*\\]/g, " ")), 250);
    return () => clearTimeout(id);
  }, [text]);
  const q = useQuery({
    queryKey: ["vehicles", org.id, dq],
    enabled: can("customers.view"),
    queryFn: async () => {
      let r = supabase.from("vehicles").select("*, customers(display_name, phone)").eq("org_id", org.id).is("archived_at", null);
      if (dq) {
        const plate = parsePlateQuery(dq);
        const parts = [`vin.ilike.%${dq}%`, `make.ilike.%${dq}%`, `model.ilike.%${dq}%`];
        if (plate) parts.push(`plate_key.like.%${plate.key}%`);
        if (plate?.number) parts.push(`plate_number.eq.${plate.number}`);
        r = r.or(parts.join(","));
        if (plate?.emirate) r = r.eq("plate_emirate", plate.emirate);
      }
      const { data, error } = await r.order("updated_at", { ascending: false }).limit(300);
      if (error) throw error;
      return data as Row[];
    },
  });
  if (!can("customers.view")) return <NotAllowed />;
  return (
    <div>
      <PageHeader
        title={t("Vehicles")}
        actions={
          <Button
            icon={<Download className="size-4" />}
            onClick={() =>
              downloadText(
                "vehicles.csv",
                toCsv(q.data ?? [], [
                  { header: "Owner", value: (v) => v.customers?.display_name },
                  { header: "Owner phone", value: (v) => v.customers?.phone },
                  { header: "Plate emirate", value: (v) => v.plate_emirate },
                  { header: "Plate code", value: (v) => v.plate_code },
                  { header: "Plate number", value: (v) => v.plate_number },
                  { header: "VIN", value: (v) => v.vin },
                  { header: "Make", value: (v) => v.make },
                  { header: "Model", value: (v) => v.model },
                  { header: "Year", value: (v) => v.year },
                  { header: "Mileage", value: (v) => v.mileage },
                  { header: "Color", value: (v) => v.color },
                ]),
              )
            }
          >
            {t("Export CSV")}
          </Button>
        }
      />
      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
        <Input aria-label={t("Search vehicles")} placeholder={t("Plate (Dubai A 12345), VIN, make, model…")} value={text} onChange={(e) => setText(e.target.value)} className="ps-9" />
      </div>
      <Card padded={false}>
        {q.isPending && <Loading />}
        {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} className="m-4" />}
        {q.isSuccess && q.data.length === 0 && <EmptyState icon={<Car className="size-6" />} title={dq ? t("No vehicle matches") : t("No vehicle yet")} text={!dq ? t("Vehicles are added from a customer's profile or while creating a document.") : undefined} />}
        {q.data && q.data.length > 0 && (
          <TableWrap>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={th}>{t("Plate")}</th>
                  <th className={th}>{t("Vehicle")}</th>
                  <th className={`${th} hidden md:table-cell`}>{t("Owner")}</th>
                  <th className={`${th} hidden lg:table-cell`}>{t("VIN")}</th>
                  <th className={`${th} hidden text-end sm:table-cell`}>{t("Mileage")}</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((v) => (
                  <tr key={v.id} className={trClass}>
                    <td className={td}>
                      <Link to="/vehicles/$id" params={{ id: v.id }} className="font-semibold text-brand hover:underline">
                        {formatPlate(v, lang) || "—"}
                      </Link>
                    </td>
                    <td className={td}>{[v.make, v.model, v.year].filter(Boolean).join(" ")}</td>
                    <td className={`${td} hidden md:table-cell`}>
                      <Link to="/customers/$id" params={{ id: v.customer_id }} className="hover:underline">
                        {v.customers?.display_name}
                      </Link>
                    </td>
                    <td className={`${td} hidden font-mono text-xs lg:table-cell`}>{v.vin}</td>
                    <td className={`${td} hidden text-end num sm:table-cell`}>{v.mileage != null ? `${v.mileage.toLocaleString("en")} km` : ""}</td>
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
