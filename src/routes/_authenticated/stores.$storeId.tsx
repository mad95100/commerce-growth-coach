import { formatMoney } from "@/lib/currency";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  AppShell,
  EmptyState,
  ErrorState,
  ListSkeleton,
  PageSkeleton,
} from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { ScoreRing } from "@/components/ScoreRing";
import { ConnectionsPanel } from "@/components/ConnectionsPanel";
import { AuditComparison } from "@/components/AuditComparison";
import { StoreEconomicsFields } from "@/components/StoreEconomicsFields";
import {
  parseStoreEconomics,
  storeEconomicsToForm,
  type StoreSituation,
} from "@/lib/store-profile";
import { runAudit } from "@/lib/audit.functions";
import { deleteStore } from "@/lib/stores.functions";
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
      toast.info("Audit lancé, nous analysons votre boutique.");
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
        <PageSkeleton />
      </AppShell>
    );
  /*
    L'ÉCHEC ET L'INTROUVABLE NE SE RESSEMBLENT PAS.

    La page affichait « Boutique introuvable » dans les DEUX cas : requête en
    erreur et boutique réellement absente. Un marchand dont la connexion
    hoquette lisait donc que sa boutique n'existait pas — la phrase la plus
    inquiétante possible, et la seule qui ne lui laissait rien à faire. L'échec
    se réessaie ; l'absence renvoie à la liste.
  */
  if (storeQ.isError)
    return (
      <AppShell>
        <ErrorState
          title="Impossible de charger cette boutique"
          description="La lecture a échoué. Rien n'est perdu : votre boutique et vos audits sont intacts."
          onRetry={() => void storeQ.refetch()}
        />
      </AppShell>
    );
  if (!storeQ.data)
    return (
      <AppShell>
        <EmptyState
          title="Cette boutique n'existe plus"
          description="Elle a peut-être été supprimée, ou le lien que vous avez ouvert n'est plus valable."
          actionLabel="Voir mes boutiques"
          onAction={() => navigate({ to: "/dashboard" })}
        />
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

      <div className="mt-8 space-y-8">
        <ConnectionsPanel storeId={store.id} storeUrl={store.url} storeCurrency={store.currency} />

        {/* L'ÉVOLUTION, à côté des connexions. C'est la question que le
            marchand se pose en revenant : « est-ce que ce que j'ai fait a
            servi ? ». La placer après le dernier audit et avant les réglages
            la met sur son chemin naturel. */}
        <AuditComparison storeId={store.id} />
      </div>

      <div className="mt-8 card-elevated flex flex-wrap items-center justify-between gap-4 rounded-2xl p-6">
        <div>
          <h2 className="font-display text-lg font-bold">Suivi des gains (avant / après)</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Vérifiez si les corrections appliquées ont vraiment fait monter la conversion, le CTR et
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
              Nous analysons votre boutique et en sortons un plan d'action en 2 minutes.
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
          <ListSkeleton rows={2} label="Chargement de l'historique de vos audits" />
        ) : !auditsQ.data || auditsQ.data.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Aucun audit pour l'instant. Lancez le premier ci-dessus.
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
                {/*
                  LA VIGNETTE SUIT LE STATUT, PAS LA NOTE. Elle se décidait sur
                  `score != null`, si bien qu'un audit RÉUSSI mais non notable
                  — trop peu d'axes mesurés pour qu'une note veuille dire
                  quelque chose — tombait dans la branche d'échec : croix rouge
                  et « Audit échoué ». Le marchand voyait un échec là où
                  l'analyse avait abouti, et ses constats l'attendaient.
                */}
                {a.status === "completed" ? (
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
                    {a.verdict ||
                      (a.status === "running"
                        ? "En cours..."
                        : a.status === "completed"
                          ? "Analyse terminée"
                          : "Cet audit n'a pas abouti")}
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
        )}
      </div>

      <DangerZone storeId={store.id} storeName={store.name} />
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

/**
 * SUPPRIMER LA BOUTIQUE. La seule action irréversible du produit.
 *
 * POURQUOI ELLE MANQUAIT, ET CE QUE CELA COÛTAIT. Rien ne permettait de retirer
 * une boutique : ajoutée par erreur ou devenue inutile, elle restait
 * indéfiniment, occupait la liste, comptait dans les quotas et continuait
 * d'être reprise par le traitement périodique. Le seul recours était de nous
 * écrire.
 *
 * POURQUOI RETAPER LE NOM. La suppression emporte tout l'historique — audits,
 * constats, mesures, connexions — par cascade en base. Une confirmation à un
 * clic serait déclenchée par accident un jour ou l'autre, et il n'y aurait rien
 * à restaurer. Retaper le nom ne protège pas d'un attaquant, qui le connaît :
 * cela protège du geste distrait, qui est le risque réel.
 */
function DangerZone({ storeId, storeName }: { storeId: string; storeName: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const remove = useServerFn(deleteStore);
  const [open, setOpen] = useState(false);
  const [saisie, setSaisie] = useState("");
  const [busy, setBusy] = useState(false);

  const correspond = saisie.trim().toLowerCase() === storeName.trim().toLowerCase();

  async function handleDelete() {
    setBusy(true);
    try {
      const res = await remove({ data: { storeId, confirmation: saisie } });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      // Les listes en cache contiennent encore la boutique effacée : les vider
      // évite qu'elle réapparaisse une seconde sur le tableau de bord.
      await queryClient.invalidateQueries();
      toast.success("Boutique supprimée.");
      navigate({ to: "/dashboard" });
    } catch {
      toast.error("La suppression n'a pas abouti. Réessayez dans un instant.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 rounded-2xl border border-destructive/30 p-6">
      <h2 className="font-display text-lg font-bold">Supprimer cette boutique</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Tout l'historique de cette boutique sera effacé : audits, recommandations, mesures et
        connexions. Cette action est définitive et nous ne pourrons rien restaurer.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        La suppression retire notre accès à vos données. Pour retirer aussi l'application depuis
        votre administration Shopify, faites-le de votre côté : nous ne pouvons pas la désinstaller
        à votre place.
      </p>

      {!open ? (
        <Button variant="outline" className="mt-4" onClick={() => setOpen(true)}>
          Supprimer la boutique
        </Button>
      ) : (
        <div className="mt-4 space-y-3">
          <label htmlFor="confirm-suppression" className="block text-sm">
            Pour confirmer, saisissez le nom de la boutique : <strong>{storeName}</strong>
          </label>
          <input
            id="confirm-suppression"
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            placeholder={storeName}
            autoComplete="off"
            className="w-full max-w-sm rounded-lg border border-border/50 bg-background px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              disabled={!correspond || busy}
              onClick={() => void handleDelete()}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Supprimer définitivement
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setSaisie("");
              }}
            >
              Annuler
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

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
      <h2 className="font-display text-lg font-bold">Votre modèle économique</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Ces informations servent à chiffrer votre marge, votre bénéfice et à orienter l'audit.
        Laissez vide ce que vous ne connaissez pas encore.
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
