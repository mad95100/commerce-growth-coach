import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { ScoreRing } from "@/components/ScoreRing";
import { updateFindingStatus, generateFix, applyFix } from "@/lib/audit.functions";
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
  timeframe: string;
  status: string;
  sort_order: number;
  applied_at: string | null;
  applied_result: unknown;
};

function AuditPage() {
  const { auditId } = Route.useParams();
  const qc = useQueryClient();
  const updateStatusFn = useServerFn(updateFindingStatus);
  const generateFixFn = useServerFn(generateFix);
  const applyFixFn = useServerFn(applyFix);
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  async function handleApplyFix(findingId: string) {
    setApplyingId(findingId);
    try {
      const res = await applyFixFn({ data: { findingId } });
      qc.invalidateQueries({ queryKey: ["findings", auditId] });
      if (res.action === "no_action") {
        toast.info(res.summary);
      } else {
        toast.success(res.detail ?? "Correction appliquée sur ta boutique !");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setApplyingId(null);
    }
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
        .select("*, stores(id, name)")
        .eq("id", auditId)
        .single();
      if (error) throw error;
      return data;
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

  async function toggleDone(id: string, current: string) {
    const next = current === "done" ? "todo" : "done";
    try {
      await updateStatusFn({ data: { findingId: id, status: next } });
      qc.invalidateQueries({ queryKey: ["findings", auditId] });
    } catch (err) {
      toast.error("Erreur");
    }
  }

  if (auditQ.isLoading) return <AppShell><div>Chargement...</div></AppShell>;
  if (!auditQ.data) return <AppShell><div>Audit introuvable</div></AppShell>;
  const audit = auditQ.data;
  const findings = findingsQ.data ?? [];

  const totalGainMin = findings.reduce((s, f) => s + (Number(f.estimated_gain_min) || 0), 0);
  const totalGainMax = findings.reduce((s, f) => s + (Number(f.estimated_gain_max) || 0), 0);
  const doneCount = findings.filter((f) => f.status === "done").length;

  return (
    <AppShell>
      <Link
        to="/stores/$storeId"
        params={{ storeId: (audit.stores as { id: string }).id }}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> Retour à la boutique
      </Link>

      {audit.status === "running" ? (
        <div className="card-elevated flex flex-col items-center rounded-2xl p-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <h1 className="mt-4 font-display text-xl">L'IA analyse ta boutique...</h1>
          <p className="mt-2 text-sm text-muted-foreground">Ça prend 30 à 90 secondes.</p>
        </div>
      ) : audit.status === "failed" ? (
        <div className="card-elevated rounded-2xl p-8">
          <h1 className="font-display text-xl font-bold text-destructive">Audit échoué</h1>
          <p className="mt-2 text-sm text-muted-foreground">{audit.error_message}</p>
        </div>
      ) : (
        <>
          {/* Hero */}
          <div className="card-elevated rounded-2xl p-8">
            <div className="flex flex-col items-center gap-6 md:flex-row md:text-left">
              <ScoreRing score={audit.score ?? 0} size={140} />
              <div className="flex-1">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Score global — {(audit.stores as { name: string }).name}
                </div>
                <h1 className="mt-1 font-display text-3xl font-bold">{audit.verdict}</h1>
                <p className="mt-3 text-muted-foreground">{audit.summary}</p>
                {totalGainMax > 0 && (
                  <div className="mt-4 inline-flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
                    <Zap className="h-4 w-4" />
                    Gain potentiel : <strong>{Math.round(totalGainMin)} – {Math.round(totalGainMax)} €/mois</strong>
                  </div>
                )}
              </div>
            </div>
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
                  onToggle={toggleDone}
                  onGenerateFix={handleGenerateFix}
                  onApplyFix={handleApplyFix}
                  fixing={fixingId === f.id}
                  applying={applyingId === f.id}
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
                      {tf === "today" && <><Clock className="h-4 w-4 text-destructive" /> À faire aujourd'hui</>}
                      {tf === "this_week" && <><Calendar className="h-4 w-4 text-warning" /> Cette semaine</>}
                      {tf === "this_month" && <><Calendar className="h-4 w-4 text-info" /> Ce mois-ci</>}
                    </div>
                    <div className="space-y-3">
                      {items.map((f) => (
                        <FindingCard
                          key={f.id}
                          finding={f}
                          onToggle={toggleDone}
                          onGenerateFix={handleGenerateFix}
                          onApplyFix={handleApplyFix}
                          fixing={fixingId === f.id}
                          applying={applyingId === f.id}
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
  onToggle,
  onGenerateFix,
  onApplyFix,
  fixing,
  applying,
  compact,
}: {
  finding: Finding;
  onToggle: (id: string, current: string) => void;
  onGenerateFix: (id: string) => void;
  onApplyFix: (id: string) => void;
  fixing?: boolean;
  applying?: boolean;
  compact?: boolean;
}) {
  const sevColor = {
    critical: "bg-destructive/15 text-destructive border-destructive/30",
    high: "bg-warning/15 text-warning border-warning/30",
    medium: "bg-info/15 text-info border-info/30",
    low: "bg-muted text-muted-foreground border-border",
  }[finding.severity] || "bg-muted";
  const steps = Array.isArray(finding.action_steps)
    ? (finding.action_steps as Array<{ text: string }>)
    : [];
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
            <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${sevColor}`}>
              {finding.severity === "critical" ? "Critique" : finding.severity === "high" ? "Important" : finding.severity === "medium" ? "Moyen" : "Mineur"}
            </span>
            <span className="text-xs text-muted-foreground uppercase">{finding.category}</span>
          </div>
          <h3 className={`mt-2 font-display text-lg font-bold ${done ? "line-through" : ""}`}>
            {finding.title}
          </h3>
          {!compact && finding.root_cause && (
            <div className="mt-3">
              <div className="text-xs uppercase text-muted-foreground">Pourquoi</div>
              <p className="mt-1 text-sm">{finding.root_cause}</p>
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
              <div className="text-xs uppercase text-muted-foreground">Ce que tu dois faire</div>
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
          {applied && (
            <div className="mt-4 rounded-lg border border-success/30 bg-success/10 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-success">
                <CheckCircle2 className="h-4 w-4" /> Corrigé automatiquement sur ta boutique
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
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {(finding.estimated_gain_max ?? 0) > 0 && (
              <div className="inline-flex items-center gap-2 rounded-lg bg-success/10 px-3 py-1.5 text-sm text-success">
                <Zap className="h-3 w-3" />
                +{Math.round(Number(finding.estimated_gain_min))} à {Math.round(Number(finding.estimated_gain_max))} €/mois
              </div>
            )}
            {!applied && (
              <Button
                size="sm"
                onClick={() => onApplyFix(finding.id)}
                disabled={applying}
                className="bg-gradient-primary text-primary-foreground"
              >
                {applying ? (
                  <><Loader2 className="mr-2 h-3 w-3 animate-spin" /> L'IA corrige ta boutique...</>
                ) : (
                  <><Sparkles className="mr-2 h-3 w-3" /> Corrige ça pour moi</>
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
                  <><Loader2 className="mr-2 h-3 w-3 animate-spin" /> L'IA écrit...</>
                ) : (
                  <><Wand2 className="mr-2 h-3 w-3" /> Générer le texte</>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
