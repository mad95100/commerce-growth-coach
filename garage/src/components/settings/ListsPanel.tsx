import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Star } from "lucide-react";
import { useState } from "react";
import { useOrg, useRefData } from "@/app/session.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge, ErrorState, FormError, Loading } from "@/components/ui/feedback.tsx";
import { Input, Select } from "@/components/ui/form.tsx";
import { Card, CardTitle } from "@/components/ui/layout.tsx";
import { t } from "@/lib/i18n.tsx";
import { rpc, supabase } from "@/lib/supabase.ts";

function useRun() {
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => PromiseLike<{ error: unknown }> | Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      const r = (await fn()) as { error?: unknown } | undefined;
      if (r && r.error) throw r.error;
      await qc.invalidateQueries();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return { run, error, busy };
}

export function BranchesPanel() {
  const org = useOrg();
  const ref = useRefData();
  const { run, error, busy } = useRun();
  const [name, setName] = useState("");
  const [addr, setAddr] = useState("");
  if (ref.isPending) return <Loading />;
  if (ref.isError) return <ErrorState error={ref.error} retry={() => ref.refetch()} />;
  return (
    <Card>
      <CardTitle>{t("Branches")}</CardTitle>
      <p className="mb-4 text-sm text-muted">{t("Each branch has its own stock and documents. Customers, vehicles and the catalog are shared.")}</p>
      <ul className="divide-y divide-line">
        {ref.data.branches.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="font-medium">
                {b.name} {b.is_default && <Badge tone="brand">{t("Default")}</Badge>} {!b.active && <Badge tone="muted">{t("Inactive")}</Badge>}
              </p>
              {b.address && <p className="text-xs text-muted">{b.address}</p>}
            </div>
            <div className="flex gap-2">
              {!b.is_default && b.active && (
                <Button size="sm" onClick={() => run(() => rpc("set_default_branch", { p_org: org.id, p_id: b.id }))} icon={<Star className="size-3.5" />}>
                  {t("Make default")}
                </Button>
              )}
              {!b.is_default && (
                <Button size="sm" variant="ghost" onClick={() => run(() => supabase.from("branches").update({ active: !b.active }).eq("id", b.id))}>
                  {b.active ? t("Deactivate") : t("Activate")}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1.5fr_auto]">
        <Input aria-label={t("Branch name")} placeholder={t("Branch name, e.g. BS Garage Al Quoz")} value={name} onChange={(e) => setName(e.target.value)} />
        <Input aria-label={t("Address")} placeholder={t("Address")} value={addr} onChange={(e) => setAddr(e.target.value)} />
        <Button loading={busy} disabled={!name.trim()} onClick={() => run(async () => { const r = await supabase.from("branches").insert({ org_id: org.id, name: name.trim(), address: addr.trim() || null }); if (!r.error) { setName(""); setAddr(""); } return r; })} icon={<Plus className="size-4" />}>
          {t("Add branch")}
        </Button>
      </div>
      <div className="mt-3">
        <FormError error={error} />
      </div>
    </Card>
  );
}

export function TaxPanel() {
  const org = useOrg();
  const ref = useRefData();
  const { run, error, busy } = useRun();
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  if (ref.isPending) return <Loading />;
  if (ref.isError) return <ErrorState error={ref.error} retry={() => ref.refetch()} />;
  const valid = (v: string) => /^\d{1,3}(\.\d{1,2})?$/.test(v.trim()) && Number(v) <= 100;
  return (
    <Card>
      <CardTitle>{t("VAT rates")}</CardTitle>
      <p className="mb-4 text-sm text-muted">{t("Changing a rate affects new documents only. Issued invoices keep the rate they were issued with.")}</p>
      {!org.vat_registered && <p className="mb-3 text-sm text-warn">{t("The garage is set as not registered for VAT: no VAT is charged whatever the rates.")}</p>}
      <ul className="divide-y divide-line">
        {ref.data.taxRates.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="flex items-center gap-2">
              <span className="font-medium">{r.name}</span>
              {r.is_default && <Badge tone="brand">{t("Default")}</Badge>}
              {!r.active && <Badge tone="muted">{t("Inactive")}</Badge>}
            </div>
            <div className="flex items-center gap-2">
              <Input aria-label={t("Rate for {name}", { name: r.name })} className="w-24 text-end num" inputMode="decimal" value={edits[r.id] ?? String(Number(r.rate))} onChange={(e) => setEdits({ ...edits, [r.id]: e.target.value })} />
              <span className="text-sm">%</span>
              {edits[r.id] !== undefined && edits[r.id] !== String(Number(r.rate)) && (
                <Button size="sm" variant="primary" disabled={!valid(edits[r.id])} onClick={() => run(() => supabase.from("tax_rates").update({ rate: Number(edits[r.id]) }).eq("id", r.id))}>
                  {t("Save")}
                </Button>
              )}
              {!r.is_default && r.active && (
                <Button size="sm" onClick={() => run(() => rpc("set_default_tax_rate", { p_org: org.id, p_id: r.id }))}>
                  {t("Make default")}
                </Button>
              )}
              {!r.is_default && (
                <Button size="sm" variant="ghost" onClick={() => run(() => supabase.from("tax_rates").update({ active: !r.active }).eq("id", r.id))}>
                  {r.active ? t("Deactivate") : t("Activate")}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_120px_auto]">
        <Input aria-label={t("Rate name")} placeholder={t("Name, e.g. Exempt")} value={name} onChange={(e) => setName(e.target.value)} />
        <Input aria-label={t("Rate (%)")} placeholder="%" inputMode="decimal" className="text-end" value={rate} onChange={(e) => setRate(e.target.value)} />
        <Button loading={busy} disabled={!name.trim() || !valid(rate)} onClick={() => run(async () => { const r = await supabase.from("tax_rates").insert({ org_id: org.id, name: name.trim(), rate: Number(rate) }); if (!r.error) { setName(""); setRate(""); } return r; })} icon={<Plus className="size-4" />}>
          {t("Add rate")}
        </Button>
      </div>
      <div className="mt-3">
        <FormError error={error} />
      </div>
    </Card>
  );
}

export function MethodsPanel() {
  const org = useOrg();
  const ref = useRefData();
  const { run, error, busy } = useRun();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("other");
  if (ref.isPending) return <Loading />;
  if (ref.isError) return <ErrorState error={ref.error} retry={() => ref.refetch()} />;
  return (
    <Card>
      <CardTitle>{t("Payment methods")}</CardTitle>
      <ul className="divide-y divide-line">
        {ref.data.methods.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3 py-3">
            <span className="font-medium">
              {m.name} {!m.active && <Badge tone="muted">{t("Inactive")}</Badge>}
            </span>
            <Button size="sm" variant="ghost" onClick={() => run(() => supabase.from("payment_methods").update({ active: !m.active }).eq("id", m.id))}>
              {m.active ? t("Deactivate") : t("Activate")}
            </Button>
          </li>
        ))}
      </ul>
      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_180px_auto]">
        <Input aria-label={t("Method name")} placeholder={t("e.g. Tabby, Apple Pay, Company account")} value={name} onChange={(e) => setName(e.target.value)} />
        <Select aria-label={t("Kind")} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="cash">{t("Cash")}</option>
          <option value="card">{t("Card")}</option>
          <option value="bank_transfer">{t("Bank Transfer")}</option>
          <option value="online">{t("Online Payment")}</option>
          <option value="cheque">{t("Cheque")}</option>
          <option value="other">{t("Other")}</option>
        </Select>
        <Button loading={busy} disabled={!name.trim()} onClick={() => run(async () => { const r = await supabase.from("payment_methods").insert({ org_id: org.id, name: name.trim(), kind, sort_order: 50 }); if (!r.error) setName(""); return r; })} icon={<Plus className="size-4" />}>
          {t("Add method")}
        </Button>
      </div>
      <div className="mt-3">
        <FormError error={error} />
      </div>
    </Card>
  );
}

const DOC_LABEL: Record<string, string> = {
  invoice: "Invoices",
  estimate: "Estimates",
  job_card: "Job cards",
  receipt: "Payment receipts",
  refund: "Refund receipts",
  credit_note: "Credit notes",
  purchase_order: "Purchase orders",
};

export function NumberingPanel() {
  const org = useOrg();
  const { run, error, busy } = useRun();
  const [edits, setEdits] = useState<Record<string, { prefix: string; next: string }>>({});
  const q = useQuery({
    queryKey: ["sequences", org.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("document_sequences").select("*").eq("org_id", org.id);
      if (error) throw error;
      return data as Array<{ doc_type: string; prefix: string; next_number: number; padding: number }>;
    },
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  return (
    <Card>
      <CardTitle>{t("Document numbering")}</CardTitle>
      <p className="mb-4 text-sm text-muted">{t("Invoice numbers are sequential with no gaps. The next number can only move forward, for example to continue from your previous system.")}</p>
      <ul className="divide-y divide-line">
        {q.data.map((s) => {
          const e = edits[s.doc_type] ?? { prefix: s.prefix, next: String(s.next_number) };
          const changed = e.prefix !== s.prefix || e.next !== String(s.next_number);
          return (
            <li key={s.doc_type} className="grid items-center gap-2 py-3 sm:grid-cols-[1fr_110px_130px_auto]">
              <span className="font-medium">
                {t(DOC_LABEL[s.doc_type] ?? s.doc_type)}
                <span className="ms-2 text-xs text-muted">{t("Next: {n}", { n: `${e.prefix}${String(e.next).padStart(s.padding, "0")}` })}</span>
              </span>
              <Input aria-label={t("Prefix")} value={e.prefix} maxLength={12} onChange={(ev) => setEdits({ ...edits, [s.doc_type]: { ...e, prefix: ev.target.value } })} />
              <Input aria-label={t("Next number")} inputMode="numeric" value={e.next} onChange={(ev) => setEdits({ ...edits, [s.doc_type]: { ...e, next: ev.target.value.replace(/\D/g, "") } })} />
              <Button size="sm" variant="primary" disabled={!changed || !e.next} loading={busy} onClick={() => run(() => rpc("update_document_sequence", { p_org: org.id, p_doc_type: s.doc_type, p_prefix: e.prefix, p_next_number: Number(e.next) }))}>
                {t("Save")}
              </Button>
            </li>
          );
        })}
      </ul>
      <div className="mt-3">
        <FormError error={error} />
      </div>
    </Card>
  );
}

export function TechniciansPanel() {
  const org = useOrg();
  const ref = useRefData();
  const { run, error, busy } = useRun();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const members = useQuery({
    queryKey: ["members", org.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("memberships").select("user_id, display_name, email, role").eq("org_id", org.id).eq("active", true);
      if (error) throw error;
      return data as Array<{ user_id: string; display_name: string | null; email: string | null; role: string }>;
    },
  });
  if (ref.isPending) return <Loading />;
  if (ref.isError) return <ErrorState error={ref.error} retry={() => ref.refetch()} />;
  return (
    <Card>
      <CardTitle>{t("Mechanics")}</CardTitle>
      <p className="mb-4 text-sm text-muted">{t("Mechanics are assigned to job cards and labor lines. Link a mechanic to a user account so they see their own job cards.")}</p>
      <ul className="divide-y divide-line">
        {ref.data.technicians.map((x) => (
          <li key={x.id} className="grid items-center gap-2 py-3 sm:grid-cols-[1fr_220px_auto]">
            <span className="font-medium">
              {x.name} {!x.active && <Badge tone="muted">{t("Inactive")}</Badge>}
              {x.phone && <span className="block text-xs text-muted">{x.phone}</span>}
            </span>
            <Select aria-label={t("User account of {name}", { name: x.name })} value={x.user_id ?? ""} onChange={(e) => run(() => supabase.from("technicians").update({ user_id: e.target.value || null }).eq("id", x.id))}>
              <option value="">{t("No user account")}</option>
              {(members.data ?? []).map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name || m.email}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="ghost" onClick={() => run(() => supabase.from("technicians").update({ active: !x.active }).eq("id", x.id))}>
              {x.active ? t("Deactivate") : t("Activate")}
            </Button>
          </li>
        ))}
      </ul>
      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Input aria-label={t("Mechanic name")} placeholder={t("Mechanic name")} value={name} onChange={(e) => setName(e.target.value)} />
        <Input aria-label={t("Phone")} placeholder={t("Phone")} value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Button loading={busy} disabled={!name.trim()} onClick={() => run(async () => { const r = await supabase.from("technicians").insert({ org_id: org.id, name: name.trim(), phone: phone.trim() || null }); if (!r.error) { setName(""); setPhone(""); } return r; })} icon={<Plus className="size-4" />}>
          {t("Add mechanic")}
        </Button>
      </div>
      <div className="mt-3">
        <FormError error={error} />
      </div>
    </Card>
  );
}
