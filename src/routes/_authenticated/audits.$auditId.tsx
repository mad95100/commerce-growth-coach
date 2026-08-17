import { formatMoney, normalizeCurrency } from "@/lib/currency";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState, ErrorState, PageSkeleton } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { ScoreRing } from "@/components/ScoreRing";
import { auditFailureText, canRetryNow } from "@/lib/audit-errors";
import { AuditNarrative } from "@/components/AuditNarrative";
import { readAudience, readCauses } from "@/lib/audit-narrative";
import { updateFindingStatus, generateFix, processAudit, getAuditJob } from "@/lib/audit.functions";
import {
  proposeFix,
  confirmAction,
  revertAction,
  listActionsForFindings,
} from "@/lib/actions.functions";
import { ActionPreview } from "@/components/ActionPreview";
import type { ActionProposal } from "@/lib/action-plan";
import {
  BAND_EMOJI,
  BAND_LABELS,
  EPISTEMIC_HINTS,
  EPISTEMIC_LABELS,
  toEpistemicLevel,
  toPriorityBand,
  type PriorityBand,
} from "@/lib/finding-graph";
import { toast } from "sonner";
import {
  AlertTriangle,
  Copy,
  CheckCircle2,
  Circle,
  Loader2,
  ArrowLeft,
  Clock,
  Zap,
  Calendar,
  Wand2,
  Sparkles,
  ExternalLink,
  Undo2,
  CornerDownRight,
  GitBranch,
  HelpCircle,
  History,
  Search,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/audits/$auditId")({
  head: () => ({ meta: [{ title: "Audit — EcomPilot AI" }] }),
  component: AuditPage,
});

type Finding = {
  id: string;
  category: string;
  severity: string;
  title: string;
  root_cause: string | null;
  impact_description: string | null;
  estimated_gain_min: number | null;
  estimated_gain_max: number | null;
  action_steps: unknown;
  auto_correction: unknown;
  /**
   * SUR QUOI LE CONSTAT REPOSE, ET CE QU'IL A FALLU SUPPOSER.
   *
   * Colonne non nulle, renseignée par le moteur pour CHAQUE constat
   * (`audit-runner.server.ts` : `based_on` et `assumptions` sont tous deux
   * exigés du modèle). Elle restait pourtant invisible : le marchand lisait un
   * titre, une gravité et un montant, sans jamais voir ce qui les fondait.
   */
  evidence: unknown;
  timeframe: string;
  status: string;
  sort_order: number;
  applied_at: string | null;
  applied_result: unknown;
  // Champs produits par `finding-graph.ts`. Nuls sur les audits antérieurs :
  // l'affichage doit s'en passer sans rien inventer.
  finding_key: string | null;
  caused_by: unknown;
  priority_band: string | null;
  priority_reason: string | null;
  epistemic_level: string | null;
  blocks_count: number | null;
  chain_depth: number | null;
  /** Ce que la mémoire de la boutique disait de cette piste au moment de l'audit. */
  history_action: string | null;
  history_note: string | null;
};

/**
 * LA PREUVE, LUE SANS RIEN INVENTER.
 *
 * `evidence` est une colonne JSON : sa forme est un contrat avec le moteur, pas
 * une garantie du typage. Les audits antérieurs à son introduction portent un
 * objet vide, et un audit repris d'une version future pourrait porter autre
 * chose. On lit donc ce qui est présent et lisible, et on ne rend rien sinon —
 * plutôt que d'afficher « undefined » sous le mot « Preuve », ce qui coûterait
 * plus de confiance que l'absence.
 */
function lirePreuve(brut: unknown): { basedOn: string | null; assumptions: string | null } | null {
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) return null;
  const o = brut as Record<string, unknown>;
  const texte = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const basedOn = texte(o.based_on);
  const assumptions = texte(o.assumptions);
  if (!basedOn && !assumptions) return null;
  return { basedOn, assumptions };
}

/** Habillage de chaque bande de priorité. Le rouge se mérite. */
const BAND_STYLE: Record<PriorityBand, string> = {
  critique: "bg-destructive/15 text-destructive border-destructive/30",
  important: "bg-warning/15 text-warning border-warning/30",
  opportunite: "bg-info/15 text-info border-info/30",
  optimisation: "bg-muted text-muted-foreground border-border",
};

function AuditPage() {
  const { auditId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const processFn = useServerFn(processAudit);
  const getJobFn = useServerFn(getAuditJob);
  const updateStatusFn = useServerFn(updateFindingStatus);
  const generateFixFn = useServerFn(generateFix);
  const proposeFixFn = useServerFn(proposeFix);
  const confirmActionFn = useServerFn(confirmAction);
  const revertActionFn = useServerFn(revertAction);
  const listActionsFn = useServerFn(listActionsForFindings);
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [proposingId, setProposingId] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Record<string, ActionProposal>>({});

  /** Annule une correction déjà appliquée. Écriture, donc mêmes garde-fous serveur. */
  async function handleRevert(findingId: string, actionId: string) {
    setRevertingId(findingId);
    try {
      const res = await revertActionFn({ data: { actionId } });
      qc.invalidateQueries({ queryKey: ["findings", auditId] });
      qc.invalidateQueries({ queryKey: ["actions", auditId] });
      toast.success(res.detail ?? "Correction annulée.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setRevertingId(null);
    }
  }

  /** Prépare la correction et affiche l'aperçu. N'écrit rien chez le partenaire. */
  async function handleProposeFix(findingId: string) {
    setProposingId(findingId);
    try {
      const res = await proposeFixFn({ data: { findingId } });
      if (res.kind === "no_action") {
        toast.info(res.reason);
        return;
      }
      setProposals((p) => ({ ...p, [findingId]: res.proposal }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setProposingId(null);
    }
  }

  /** Seul chemin qui écrit réellement, après confirmation explicite. */
  async function handleConfirmProposal(findingId: string, actionId: string) {
    setApplyingId(findingId);
    try {
      const res = await confirmActionFn({ data: { actionId } });
      setProposals((p) => {
        const next = { ...p };
        delete next[findingId];
        return next;
      });
      qc.invalidateQueries({ queryKey: ["findings", auditId] });
      toast.success(res.detail ?? "Correction appliquée sur votre compte !");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setApplyingId(null);
    }
  }

  function handleCancelProposal(findingId: string) {
    setProposals((p) => {
      const next = { ...p };
      delete next[findingId];
      return next;
    });
  }

  async function handleGenerateFix(findingId: string) {
    setFixingId(findingId);
    try {
      await generateFixFn({ data: { findingId } });
      qc.invalidateQueries({ queryKey: ["findings", auditId] });
      toast.success("Correction générée !");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setFixingId(null);
    }
  }

  const auditQ = useQuery({
    queryKey: ["audit", auditId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audits")
        .select("*, stores(id, name, currency)")
        .eq("id", auditId)
        .single();
      if (error) throw error;
      return data;
    },
    // Tant que l'audit tourne, la page se rafraîchit : l'analyse se termine
    // ailleurs, rien ne préviendra cet onglet autrement.
    refetchInterval: (q) =>
      (q.state.data as { status?: string } | undefined)?.status === "running" ? 3000 : false,
  });

  // Fait avancer le travail, et le reprend s'il a été interrompu.
  //
  // Chaque appel n'exécute qu'une tranche bornée : la réclamation étant
  // atomique, en déclencher plusieurs ne produit jamais deux analyses. C'est ce
  // qui rend la reprise sûre depuis n'importe quel onglet, y compris après un
  // rechargement de page.
  const jobQ = useQuery({
    queryKey: ["audit-job", auditId],
    queryFn: async () => {
      const job = await getJobFn({ data: { auditId } });
      if (job.resumable) {
        await processFn({ data: { auditId } });
        await qc.invalidateQueries({ queryKey: ["audit", auditId] });
        await qc.invalidateQueries({ queryKey: ["findings", auditId] });
        return await getJobFn({ data: { auditId } });
      }
      return job;
    },
    refetchInterval: (q) => {
      const state = (q.state.data as { state?: string } | undefined)?.state;
      return state === "completed" || state === "failed" ? false : 3000;
    },
  });

  const findingsQ = useQuery({
    queryKey: ["findings", auditId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_findings")
        .select("*")
        .eq("audit_id", auditId)
        .order("sort_order");
      if (error) throw error;
      return data as Finding[];
    },
  });

  const findingIds = (findingsQ.data ?? []).map((f) => f.id);
  const actionsQ = useQuery({
    queryKey: ["actions", auditId, findingIds.join(",")],
    enabled: findingIds.length > 0,
    queryFn: () => listActionsFn({ data: { findingIds } }),
  });

  /**
   * Dernière action encore appliquée par problème — c'est elle qui est annulable.
   *
   * Le critère est l'ISSUE constatée, pas le statut du journal : une écriture
   * réservée puis interrompue reste `applied` en base sans qu'on sache si elle
   * est partie. La proposer à l'annulation reviendrait à écrire à l'aveugle.
   */
  const appliedActionByFinding = new Map<string, { id: string; revertible: boolean }>();
  /** Écritures dont l'issue est inconnue : à signaler, jamais à rejouer seul. */
  const unknownActionByFinding = new Map<string, { targetLabel: string | null }>();
  for (const a of actionsQ.data ?? []) {
    if (!a.finding_id) continue;
    if (a.outcome === "appliquee" && !appliedActionByFinding.has(a.finding_id)) {
      appliedActionByFinding.set(a.finding_id, { id: a.id, revertible: a.revertible });
    }
    if (
      (a.outcome === "issue_inconnue" || a.outcome === "en_cours") &&
      !unknownActionByFinding.has(a.finding_id)
    ) {
      unknownActionByFinding.set(a.finding_id, { targetLabel: a.target_label });
    }
  }

  async function toggleDone(id: string, current: string) {
    const next = current === "done" ? "todo" : "done";
    try {
      await updateStatusFn({ data: { findingId: id, status: next } });
      qc.invalidateQueries({ queryKey: ["findings", auditId] });
    } catch (err) {
      toast.error("Erreur");
    }
  }

  if (auditQ.isLoading)
    return (
      <AppShell>
        <PageSkeleton />
      </AppShell>
    );
  {
    /* Même distinction que sur la page boutique : un rapport qu'on n'a pas pu
       LIRE n'est pas un rapport qui n'EXISTE pas. Annoncer le second à la place
       du premier fait croire au marchand qu'il a perdu son audit. */
  }
  if (auditQ.isError)
    return (
      <AppShell>
        <ErrorState
          title="Impossible de charger ce rapport"
          description="La lecture a échoué. Votre audit n'est pas perdu — il reste enregistré."
          onRetry={() => void auditQ.refetch()}
        />
      </AppShell>
    );
  if (!auditQ.data)
    return (
      <AppShell>
        <EmptyState
          title="Ce rapport est introuvable"
          description="L'audit a peut-être été supprimé avec sa boutique, ou le lien n'est plus valable."
          actionLabel="Revenir au tableau de bord"
          onAction={() => void navigate({ to: "/dashboard" })}
        />
      </AppShell>
    );
  const audit = auditQ.data;
  const findings = findingsQ.data ?? [];

  // Les gains sont estimés dans la devise de la boutique. Inconnue, elle est
  // annoncée comme telle plutôt que supposée.
  const storeCurrency = normalizeCurrency(
    (audit?.stores as { currency?: string | null } | undefined)?.currency,
  );
  /** Nul quand la jointure ne rend pas la boutique. Lu comme tel, jamais casté. */
  const storeName = (audit?.stores as { name?: string | null } | undefined)?.name?.trim() || null;

  const totalGainMin = findings.reduce((s, f) => s + (Number(f.estimated_gain_min) || 0), 0);
  const totalGainMax = findings.reduce((s, f) => s + (Number(f.estimated_gain_max) || 0), 0);
  const doneCount = findings.filter((f) => f.status === "done").length;

  // La base ne stocke que des clés dans `caused_by` ; les cartes ont besoin des
  // titres pour nommer les causes en clair.
  const titleByKey = new Map(
    findings.filter((f) => f.finding_key).map((f) => [f.finding_key as string, f.title]),
  );

  // Ce que l'audit n'a PAS pu établir. L'annoncer est un résultat, pas un aveu :
  // sur ces points la première action est d'aller chercher la donnée, et
  // sûrement pas de corriger à l'aveugle.
  const unverified = findings.filter((f) => f.epistemic_level === "donnee_manquante");

  return (
    <AppShell>
      {/*
        LE RETOUR SE FAIT SUR `audit.store_id`, PAS SUR LA JOINTURE.

        `stores(...)` est une ressource EMBARQUÉE : PostgREST la rend `null`
        dès que la ligne liée n'est pas visible — RLS, boutique supprimée entre
        le chargement du rapport et son affichage. Le cast n'était gardé par
        rien : la page entière tombait alors sur la frontière d'erreur, et le
        marchand perdait son rapport pour une donnée qu'il ne regardait même
        pas. `store_id` est porté par la ligne d'audit elle-même, toujours
        présent, et c'est déjà lui qu'utilisent les deux autres liens de cette
        page.
      */}
      <Link
        to="/stores/$storeId"
        params={{ storeId: audit.store_id }}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> Retour à la boutique
      </Link>

      {audit.status === "running" ? (
        <div className="card-elevated flex flex-col items-center rounded-2xl p-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <h1 className="mt-4 font-display text-xl">Nous analysons votre boutique...</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {jobQ.data?.label ?? "Ça prend 30 à 90 secondes."}
          </p>
          {jobQ.data?.lastError && jobQ.data.state === "queued" && (
            <p className="mt-3 max-w-md text-xs text-muted-foreground">
              Une première tentative n'a pas abouti. Nous réessayons automatiquement, sans que cela
              vous coûte un audit.
            </p>
          )}
        </div>
      ) : audit.status === "failed" ? (
        /*
          LE MESSAGE TECHNIQUE N'EST PLUS AFFICHÉ. Il disait, mot pour mot :
          « AI Gateway 404: models/gemini-2.5-pro is no longer available to new
          users. Please update your code to use a newer model. » Le marchand y
          lisait qu'on lui demandait de programmer, pour une panne qui venait de
          NOTRE configuration. Il reste en base et dans les journaux, où il sert
          à qui peut agir dessus.
        */
        <div className="card-elevated rounded-2xl p-8">
          <h1 className="font-display text-xl font-bold">Cet audit n'a pas abouti</h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {auditFailureText(audit.error_message)}
          </p>
          {canRetryNow(audit.error_message) ? (
            <Link to="/stores/$storeId" params={{ storeId: audit.store_id }}>
              <Button className="mt-6">Relancer un audit</Button>
            </Link>
          ) : (
            /* Proposer « Relancer » sur une panne qui exige une reconnexion
               enverrait le marchand échouer une seconde fois. */
            <Link to="/stores/$storeId" params={{ storeId: audit.store_id }}>
              <Button variant="outline" className="mt-6">
                Aller aux réglages de la boutique
              </Button>
            </Link>
          )}
        </div>
      ) : (
        <>
          {/* Hero */}
          <div className="card-elevated rounded-2xl p-8">
            <div className="flex flex-col items-center gap-6 md:flex-row md:text-left">
              <ScoreRing score={audit.score} size={140} />
              <div className="flex-1">
                {/* Le nom de la boutique est un ORNEMENT de ce titre : quand la
                    jointure ne le rend pas, on affiche « Score global » seul
                    plutôt que de faire tomber le rapport avec lui. */}
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  {storeName ? `Score global — ${storeName}` : "Score global"}
                </div>
                <h1 className="mt-1 font-display text-3xl font-bold">{audit.verdict}</h1>
                <p className="mt-3 text-muted-foreground">{audit.summary}</p>
                {/*
                  POURQUOI IL N'Y A PAS DE NOTE, DIT À CÔTÉ DE L'ANNEAU VIDE.
                  Une note absente sans explication se lit comme une panne, et
                  le marchand conclut que l'audit a raté. La phrase transforme
                  un manque en information : ce n'est pas nous qui n'avons pas
                  su, c'est la boutique qui n'a pas encore de quoi être notée.
                */}
                {audit.score === null && (
                  <p className="mt-3 rounded-lg bg-muted/40 p-3 text-sm leading-relaxed text-muted-foreground">
                    Trop peu de points ont pu être mesurés sur cette boutique pour qu'une note
                    d'ensemble veuille dire quelque chose. Une note calculée sur trois sujets sur
                    dix parlerait surtout de ce que nous avons réussi à regarder. Les constats
                    ci-dessous, eux, sont établis et restent valables.
                  </p>
                )}
                {totalGainMax > 0 && (
                  <div className="mt-4 inline-flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
                    <Zap className="h-4 w-4" />
                    Gain potentiel :{" "}
                    <strong>
                      {formatMoney(totalGainMin, storeCurrency)} –{" "}
                      {formatMoney(totalGainMax, storeCurrency)}/mois
                    </strong>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/*
            LE RAISONNEMENT AVANT LES CONSTATS. Le portrait du client donne son
            sens à tout ce qui suit — « il manque des avis » ne veut pas dire la
            même chose selon qu'on vend à douze euros ou à sept cents — et les
            causes disent quoi corriger. Les deux étaient calculés puis perdus :
            ils nourrissaient le texte de l'audit sans jamais être montrés.
          */}
          <div className="mt-8">
            <AuditNarrative
              audience={readAudience(audit.audience)}
              causes={readCauses(audit.root_causes)}
            />
          </div>

          {/* Progress */}
          {findings.length > 0 && (
            <div className="mt-6 flex items-center justify-between rounded-xl border border-border/50 bg-surface p-4">
              <div className="text-sm">
                <strong>{doneCount}</strong> / {findings.length} actions faites
              </div>
              <div className="h-2 flex-1 mx-4 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-gradient-primary transition-all"
                  style={{ width: `${(doneCount / findings.length) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Ce que l'audit ne sait pas encore */}
          {unverified.length > 0 && (
            <div className="mt-6 rounded-xl border border-dashed border-border bg-surface p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <HelpCircle className="h-4 w-4 text-muted-foreground" />
                Ce qu'il nous manque pour conclure
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Sur ces {unverified.length} point{unverified.length > 1 ? "s" : ""}, nous n'avons
                pas la donnée. Nous vous les signalons quand même, mais ne dépensez rien dessus
                avant de les avoir vérifiés.
              </p>
              <ul className="mt-3 space-y-1">
                {unverified.map((f) => (
                  <li key={f.id} className="text-sm">
                    • {f.title}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Tabs */}
          <Tabs defaultValue="problems" className="mt-8">
            <TabsList>
              <TabsTrigger value="problems">Problèmes ({findings.length})</TabsTrigger>
              <TabsTrigger value="plan">Plan d'action</TabsTrigger>
              <TabsTrigger value="corrections">Corrections auto</TabsTrigger>
            </TabsList>

            <TabsContent value="problems" className="mt-6 space-y-4">
              {findings.map((f) => (
                <FindingCard
                  key={f.id}
                  finding={f}
                  storeCurrency={storeCurrency}
                  titleByKey={titleByKey}
                  onToggle={toggleDone}
                  onGenerateFix={handleGenerateFix}
                  onProposeFix={handleProposeFix}
                  onConfirmProposal={handleConfirmProposal}
                  onCancelProposal={handleCancelProposal}
                  proposal={proposals[f.id]}
                  appliedAction={appliedActionByFinding.get(f.id)}
                  unknownAction={unknownActionByFinding.get(f.id)}
                  onRevert={handleRevert}
                  fixing={fixingId === f.id}
                  proposing={proposingId === f.id}
                  applying={applyingId === f.id}
                  reverting={revertingId === f.id}
                />
              ))}
            </TabsContent>

            <TabsContent value="plan" className="mt-6 space-y-6">
              {(["today", "this_week", "this_month"] as const).map((tf) => {
                const items = findings.filter((f) => f.timeframe === tf);
                if (items.length === 0) return null;
                return (
                  <div key={tf}>
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                      {tf === "today" && (
                        <>
                          <Clock className="h-4 w-4 text-destructive" /> À faire aujourd'hui
                        </>
                      )}
                      {tf === "this_week" && (
                        <>
                          <Calendar className="h-4 w-4 text-warning" /> Cette semaine
                        </>
                      )}
                      {tf === "this_month" && (
                        <>
                          <Calendar className="h-4 w-4 text-info" /> Ce mois-ci
                        </>
                      )}
                    </div>
                    <div className="space-y-3">
                      {items.map((f) => (
                        <FindingCard
                          storeCurrency={storeCurrency}
                          key={f.id}
                          finding={f}
                          titleByKey={titleByKey}
                          onToggle={toggleDone}
                          onGenerateFix={handleGenerateFix}
                          onProposeFix={handleProposeFix}
                          onConfirmProposal={handleConfirmProposal}
                          onCancelProposal={handleCancelProposal}
                          proposal={proposals[f.id]}
                          appliedAction={appliedActionByFinding.get(f.id)}
                          unknownAction={unknownActionByFinding.get(f.id)}
                          onRevert={handleRevert}
                          fixing={fixingId === f.id}
                          proposing={proposingId === f.id}
                          applying={applyingId === f.id}
                          reverting={revertingId === f.id}
                          compact
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </TabsContent>

            <TabsContent value="corrections" className="mt-6 space-y-4">
              {findings
                .filter((f) => f.auto_correction && typeof f.auto_correction === "object")
                .map((f) => {
                  const ac = f.auto_correction as { title: string; content: string };
                  return (
                    <div key={f.id} className="card-elevated rounded-2xl p-6">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-xs uppercase text-muted-foreground">{f.title}</div>
                          <h3 className="mt-1 font-display text-lg font-bold">{ac.title}</h3>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            navigator.clipboard.writeText(ac.content);
                            toast.success("Copié !");
                          }}
                        >
                          <Copy className="mr-2 h-3 w-3" /> Copier
                        </Button>
                      </div>
                      <pre className="mt-4 whitespace-pre-wrap rounded-lg bg-background/50 p-4 text-sm font-sans">
                        {ac.content}
                      </pre>
                    </div>
                  );
                })}
              {findings.filter((f) => f.auto_correction).length === 0 && (
                <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  Aucune correction automatique pour cet audit.
                </div>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </AppShell>
  );
}

function FindingCard({
  finding,
  storeCurrency,
  onToggle,
  onGenerateFix,
  onProposeFix,
  onConfirmProposal,
  onCancelProposal,
  onRevert,
  proposal,
  appliedAction,
  unknownAction,
  fixing,
  proposing,
  applying,
  reverting,
  compact,
  titleByKey,
}: {
  /** Devise de la boutique, pour chiffrer les gains estimés. `null` si inconnue. */
  storeCurrency: string | null;
  finding: Finding;
  /** Titres des autres problèmes de l'audit, pour nommer les causes en clair. */
  titleByKey?: Map<string, string>;
  onToggle: (id: string, current: string) => void;
  onGenerateFix: (id: string) => void;
  onProposeFix: (id: string) => void;
  onConfirmProposal: (findingId: string, actionId: string) => void;
  onCancelProposal: (findingId: string) => void;
  onRevert: (findingId: string, actionId: string) => void;
  proposal?: ActionProposal;
  appliedAction?: { id: string; revertible: boolean };
  /** Écriture dont l'issue n'est pas connue. Signalée, jamais rejouée seule. */
  unknownAction?: { targetLabel: string | null };
  fixing?: boolean;
  proposing?: boolean;
  applying?: boolean;
  reverting?: boolean;
  compact?: boolean;
}) {
  const sevColor =
    {
      critical: "bg-destructive/15 text-destructive border-destructive/30",
      high: "bg-warning/15 text-warning border-warning/30",
      medium: "bg-info/15 text-info border-info/30",
      low: "bg-muted text-muted-foreground border-border",
    }[finding.severity] || "bg-muted";

  // Bande, certitude et chaîne causale : absentes des audits antérieurs, auquel
  // cas on retombe sur l'ancien affichage par sévérité plutôt que d'inventer.
  const band = toPriorityBand(finding.priority_band);
  const epistemic = toEpistemicLevel(finding.epistemic_level);
  const blocks = finding.blocks_count ?? 0;
  const causeTitles = (Array.isArray(finding.caused_by) ? finding.caused_by : [])
    .map((key) => titleByKey?.get(String(key)))
    .filter((title): title is string => Boolean(title));

  const steps = Array.isArray(finding.action_steps)
    ? (finding.action_steps as Array<{ text: string }>)
    : [];
  const preuve = lirePreuve(finding.evidence);
  const done = finding.status === "done";
  const applied =
    finding.applied_at && finding.applied_result && typeof finding.applied_result === "object"
      ? (finding.applied_result as { summary: string; detail?: string; adminUrl?: string })
      : null;

  return (
    <div className={`card-elevated rounded-2xl p-6 ${done ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-4">
        <button
          onClick={() => onToggle(finding.id, finding.status)}
          className="mt-0.5 shrink-0"
          aria-label="Marquer comme fait"
        >
          {done ? (
            <CheckCircle2 className="h-6 w-6 text-success" />
          ) : (
            <Circle className="h-6 w-6 text-muted-foreground hover:text-primary" />
          )}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {band ? (
              <span
                className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${BAND_STYLE[band]}`}
                title={finding.priority_reason ?? undefined}
              >
                {BAND_EMOJI[band]} {BAND_LABELS[band]}
              </span>
            ) : (
              <span
                className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${sevColor}`}
              >
                {finding.severity === "critical"
                  ? "Critique"
                  : finding.severity === "high"
                    ? "Important"
                    : finding.severity === "medium"
                      ? "Moyen"
                      : "Mineur"}
              </span>
            )}
            {epistemic && (
              <span
                className="inline-flex rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground"
                title={EPISTEMIC_HINTS[epistemic]}
              >
                {EPISTEMIC_LABELS[epistemic]}
              </span>
            )}
            <span className="text-xs text-muted-foreground uppercase">{finding.category}</span>
          </div>
          <h3 className={`mt-2 font-display text-lg font-bold ${done ? "line-through" : ""}`}>
            {finding.title}
          </h3>

          {/* Place dans la chaîne causale. Corriger un symptôme sans sa cause ne
              produit rien : c'est dit ici, à l'endroit où la décision se prend. */}
          {causeTitles.length > 0 && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
              <CornerDownRight className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                Conséquence de {causeTitles.map((t) => `« ${t} »`).join(" et ")} — à corriger
                d'abord.
              </span>
            </p>
          )}
          {blocks > 0 && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-primary">
              <GitBranch className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                Cause racine : {blocks} autre{blocks > 1 ? "s" : ""} problème
                {blocks > 1 ? "s" : ""} de cette liste {blocks > 1 ? "en découlent" : "en découle"}.
              </span>
            </p>
          )}
          {/* Ce que la boutique a déjà tenté. Le dire évite la question « je
              l'ai déjà fait, pourquoi tu me le redemandes ? » — et quand la
              réponse est « justement, autrement », il faut qu'elle soit lue. */}
          {finding.history_note && (
            <p
              className={`mt-2 flex items-start gap-1.5 text-xs ${
                finding.history_action === "prioriser"
                  ? "text-destructive"
                  : "text-muted-foreground"
              }`}
            >
              <History className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{finding.history_note}</span>
            </p>
          )}
          {!compact && finding.priority_reason && (
            <div className="mt-3">
              <div className="text-xs uppercase text-muted-foreground">Pourquoi cette priorité</div>
              <p className="mt-1 text-sm text-muted-foreground">{finding.priority_reason}</p>
            </div>
          )}
          {!compact && finding.root_cause && (
            <div className="mt-3">
              <div className="text-xs uppercase text-muted-foreground">Pourquoi</div>
              <p className="mt-1 text-sm">{finding.root_cause}</p>
            </div>
          )}
          {/*
            LA PREUVE, ENTRE LE PROBLÈME ET SON IMPACT.

            CE QUI MANQUAIT. Le moteur exige `based_on` et `assumptions` pour
            chaque constat, les enregistre, et la page ne les affichait nulle
            part. Le marchand lisait donc « Critique · Les frais de livraison
            n'apparaissent qu'au paiement · +900 € à 1700 €/mois » sans une
            ligne sur ce qui fondait ce diagnostic ni ce montant. Il ne lui
            restait qu'à croire — ou à ne pas croire, ce qui est le cas le plus
            fréquent quand on demande d'agir sur sa propre boutique.

            LES SUPPOSITIONS SONT MONTRÉES AUSSI, ET AU MÊME ENDROIT. Les
            séparer laisserait la preuve paraître plus solide qu'elle ne l'est.
            C'est la même règle que partout ailleurs dans le produit : ce qui
            n'est pas mesuré est dit non mesuré.
          */}
          {!compact && preuve && (
            <div className="mt-3 rounded-lg border border-border/60 bg-background/40 p-3">
              <div className="flex items-center gap-1 text-xs uppercase text-muted-foreground">
                <Search className="h-3 w-3" /> Sur quoi nous nous appuyons
              </div>
              {preuve.basedOn && <p className="mt-1 text-sm">{preuve.basedOn}</p>}
              {preuve.assumptions && (
                <p className="mt-2 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Ce que nous supposons : </span>
                  {preuve.assumptions}
                </p>
              )}
            </div>
          )}
          {!compact && finding.impact_description && (
            <div className="mt-3">
              <div className="text-xs uppercase text-muted-foreground flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Impact
              </div>
              <p className="mt-1 text-sm">{finding.impact_description}</p>
            </div>
          )}
          {steps.length > 0 && (
            <div className="mt-4">
              <div className="text-xs uppercase text-muted-foreground">Ce que vous devez faire</div>
              <ol className="mt-2 space-y-1.5">
                {steps.map((s, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span className="shrink-0 text-primary">{i + 1}.</span>
                    <span>{s.text}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {/*
            Écriture interrompue avant que le partenaire ne réponde. On ne sait
            pas si elle est partie, donc on ne l'annonce ni comme faite ni comme
            échouée, et on ne propose surtout pas de la relancer : la rejouer
            créerait un second code promo ou une seconde hausse de budget.
          */}
          {!applied && unknownAction && (
            <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-warning">
                <HelpCircle className="h-4 w-4" /> Issue inconnue
              </div>
              <p className="mt-1 text-muted-foreground">
                L'application de cette correction
                {unknownAction.targetLabel ? ` sur ${unknownAction.targetLabel}` : ""} a été
                interrompue avant que le résultat nous revienne. Vérifiez dans votre compte avant de
                relancer : nous ne rejouons rien tout seuls, au risque de l'appliquer deux fois.
              </p>
            </div>
          )}
          {applied && (
            <div className="mt-4 rounded-lg border border-success/30 bg-success/10 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-success">
                <CheckCircle2 className="h-4 w-4" /> Corrigé automatiquement sur votre boutique
              </div>
              <p className="mt-1 text-muted-foreground">{applied.summary}</p>
              {applied.detail && <p className="mt-1">{applied.detail}</p>}
              {applied.adminUrl && (
                <a
                  href={applied.adminUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Voir dans Shopify <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {appliedAction &&
                (appliedAction.revertible ? (
                  <div className="mt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onRevert(finding.id, appliedAction.id)}
                      disabled={reverting}
                    >
                      {reverting ? (
                        <>
                          <Loader2 className="mr-2 h-3 w-3 animate-spin" /> Annulation...
                        </>
                      ) : (
                        <>
                          <Undo2 className="mr-2 h-3 w-3" /> Annuler cette correction
                        </>
                      )}
                    </Button>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Cette action n'est pas annulable automatiquement : revenez en arrière depuis
                    votre compte si besoin.
                  </p>
                ))}
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {(finding.estimated_gain_max ?? 0) > 0 && (
              <div className="inline-flex items-center gap-2 rounded-lg bg-success/10 px-3 py-1.5 text-sm text-success">
                <Zap className="h-3 w-3" />+
                {formatMoney(Number(finding.estimated_gain_min), storeCurrency)} à{" "}
                {formatMoney(Number(finding.estimated_gain_max), storeCurrency)}/mois
              </div>
            )}
            {!applied && !proposal && (
              <Button
                size="sm"
                onClick={() => onProposeFix(finding.id)}
                disabled={proposing}
                className="bg-gradient-primary text-primary-foreground"
              >
                {proposing ? (
                  <>
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" /> L'IA prépare la correction...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-3 w-3" /> Corriger à ma place
                  </>
                )}
              </Button>
            )}
            {finding.auto_correction && typeof finding.auto_correction === "object" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const ac = finding.auto_correction as { content: string };
                  navigator.clipboard.writeText(ac.content);
                  toast.success("Correction copiée !");
                }}
              >
                <Copy className="mr-2 h-3 w-3" /> Copier la correction
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onGenerateFix(finding.id)}
                disabled={fixing}
              >
                {fixing ? (
                  <>
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" /> L'IA écrit...
                  </>
                ) : (
                  <>
                    <Wand2 className="mr-2 h-3 w-3" /> Générer le texte
                  </>
                )}
              </Button>
            )}
          </div>
          {proposal && (
            <ActionPreview
              proposal={proposal}
              applying={Boolean(applying)}
              onConfirm={() => onConfirmProposal(finding.id, proposal.actionId)}
              onCancel={() => onCancelProposal(finding.id)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
