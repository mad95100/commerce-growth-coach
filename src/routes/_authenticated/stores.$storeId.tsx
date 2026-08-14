import { formatMoney } from "@/lib/currency";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { ScoreRing } from "@/components/ScoreRing";
import { ConnectionsPanel } from "@/components/ConnectionsPanel";
import { StoreEconomicsFields } from "@/components/StoreEconomicsFields";
import {
  parseStoreEconomics,
  storeEconomicsToForm,
  type StoreSituation,
} from "@/lib/store-profile";
import { runAudit } from "@/lib/audit.functions";
import { toast } from "sonner";
import { useState } from "react";
import {
  Sparkles,
  Loader2,
  ExternalLink,
  ArrowRight,
  Clock,
  CheckCircle2,
  XCircle,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/stores/$storeId")({
  head: () => ({ meta: [{ title: "Boutique — EcomPilot AI" }] }),
  component: StorePage,
});

function StorePage() {
  const { storeId } = Route.useParams();
  const navigate = useNavigate();
  const runAuditFn = useServerFn(runAudit);
  const [launching, setLaunching] = useState(false);

  const storeQ = useQuery({
    queryKey: ["store", storeId],
    queryFn: async () => {
      const { data, error } = await supabase.from("stores").select("*").eq("id", storeId).single();
      if (error) throw error;
      return data;
    },
  });

  const auditsQ = useQuery({
    queryKey: ["audits", storeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audits")
        .select("*")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  async function handleAudit() {
    setLaunching(true);
    try {
      // La demande ne fait plus que créer l'audit : elle rend la main tout de
      // suite, et l'analyse se poursuit sur la page de l'audit. On y navigue
      // sans attendre, au lieu de bloquer sur une requête qui pouvait expirer.
      const res = await runAuditFn({ data: { storeId } });
      toast.info("Audit lancé, l'IA analyse ta boutique.");
      navigate({ to: "/audits/$auditId", params: { auditId: res.auditId } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur audit");
    } finally {
      setLaunching(false);
    }
  }

  if (storeQ.isLoading)
    return (
      <AppShell>
        <div>Chargement...</div>
      </AppShell>
    );
  if (!storeQ.data)
    return (
      <AppShell>
        <div>Boutique introuvable</div>
      </AppShell>
    );
  const store = storeQ.data;

  return (
    <AppShell>
      <div className="mb-8">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          {store.niche || "Boutique"}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl font-bold">{store.name}</h1>
          {store.url && (
            <a
              href={store.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
            >
              <ExternalLink className="h-3 w-3" /> Voir la boutique
            </a>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Stat label="CA mensuel" value={formatMoney(store.monthly_revenue, store.currency)} />
        <Stat label="Budget pub" value={formatMoney(store.monthly_ad_budget, store.currency)} />
        <Stat label="Objectif" value={store.goal || "—"} />
      </div>

      <div className="mt-8">
        <StoreEconomicsCard key={store.id} store={store} />
      </div>

      <div className="mt-8">
        <ConnectionsPanel storeId={store.id} storeUrl={store.url} />
      </div>

      <div className="mt-8 card-elevated flex flex-wrap items-center justify-between gap-4 rounded-2xl p-6">
        <div>
          <h2 className="font-display text-lg font-bold">Suivi des gains (avant / après)</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Vérifie si les corrections appliquées ont vraiment fait monter la conversion, le CTR et
            le ROAS.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/tracking/$storeId" params={{ storeId: store.id }}>
            Voir le suivi <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>

      <div className="mt-8 card-elevated rounded-2xl p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold">Lancer un nouvel audit</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              L'IA analyse ta boutique et te sort un plan d'action en 2 min.
            </p>
          </div>
          <Button
            onClick={handleAudit}
            disabled={launching}
            className="bg-gradient-primary text-primary-foreground glow-primary"
            size="lg"
          >
            {launching ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyse en cours...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" /> Lancer l'audit
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="mb-4 font-display text-xl font-bold">Historique</h2>
        {auditsQ.isLoading ? (
          <div className="text-sm text-muted-foreground">...</div>
        ) : !auditsQ.data || auditsQ.data.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Aucun audit pour l'instant. Lance le premier ci-dessus.
          </div>
        ) : (
          <div className="space-y-3">
            {auditsQ.data.map((a) => (
              <Link
                key={a.id}
                to="/audits/$auditId"
                params={{ auditId: a.id }}
                className="card-elevated flex items-center gap-4 rounded-xl p-4 transition-colors hover:border-primary/40"
              >
                {a.status === "completed" && a.score != null ? (
                  <ScoreRing score={a.score} size={56} />
                ) : a.status === "running" ? (
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
                    <XCircle className="h-5 w-5 text-destructive" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs uppercase text-muted-foreground flex items-center gap-1">
                    {a.status === "completed" && <CheckCircle2 className="h-3 w-3 text-success" />}
                    {a.status === "running" && <Clock className="h-3 w-3" />}
                    {new Date(a.created_at).toLocaleString("fr-FR")}
                  </div>
                  <div className="mt-0.5 truncate font-medium">
                    {a.verdict || (a.status === "running" ? "En cours..." : "Audit échoué")}
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

type EconomicsStore = {
  /** Devise de la boutique, code ISO 4217, ou `null` si Shopify ne l'a pas encore renvoyée. */
  currency: string | null;
  id: string;
  situation: StoreSituation | null;
  revenue_goal: number | null;
  avg_product_cost_ratio: number | null;
  fixed_costs_monthly: number | null;
};

/** Édition du profil économique d'une boutique déjà créée. */
function StoreEconomicsCard({ store }: { store: EconomicsStore }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(() => storeEconomicsToForm(store));
  const [saving, setSaving] = useState(false);

  async function save() {
    const parsed = parseStoreEconomics(form);
    if (!parsed.ok) {
      toast.error(parsed.message);
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("stores").update(parsed.payload).eq("id", store.id);
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["store", store.id] });
      await qc.invalidateQueries({ queryKey: ["cockpit", store.id] });
      toast.success("Modèle économique enregistré.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card-elevated rounded-2xl p-6">
      <h2 className="font-display text-lg font-bold">Ton modèle économique</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Ces informations servent à chiffrer ta marge, ton bénéfice et à orienter l'audit. Laisse
        vide ce que tu ne connais pas encore.
      </p>

      <div className="mt-5">
        <StoreEconomicsFields
          currency={store.currency}
          idPrefix={`store-${store.id}`}
          value={form}
          onChange={setForm}
          disabled={saving}
        />
      </div>

      <Button
        onClick={save}
        disabled={saving}
        className="mt-6 bg-gradient-primary text-primary-foreground"
      >
        {saving ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enregistrement...
          </>
        ) : (
          "Enregistrer"
        )}
      </Button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-elevated rounded-xl p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-lg font-bold truncate">{value}</div>
    </div>
  );
}
