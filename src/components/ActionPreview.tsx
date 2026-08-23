import { Button } from "@/components/ui/button";
import { CHANNEL_LABELS, revertibilityNotice, type ActionProposal } from "@/lib/action-plan";
import { AlertTriangle, ArrowRight, Loader2, ShieldCheck } from "lucide-react";

/**
 * Aperçu d'une action proposée par l'IA, avant toute écriture.
 *
 * Rendu en ligne plutôt qu'en modale : pas de portail, donc aucun risque de
 * superposition, et l'aperçu reste lisible à côté du problème qu'il corrige.
 */
export function ActionPreview({
  proposal,
  applying,
  onConfirm,
  onCancel,
}: {
  proposal: ActionProposal;
  applying: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          {CHANNEL_LABELS[proposal.channel]}
        </span>
        <span className="font-display text-sm font-bold">{proposal.title}</span>
      </div>

      <div className="mt-1 text-xs text-muted-foreground">{proposal.targetLabel}</div>

      {proposal.reason && <p className="mt-3 text-sm">{proposal.reason}</p>}

      <div className="mt-4 space-y-3">
        {proposal.lines.map((line, i) => (
          <div key={`${line.label}-${i}`}>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {line.label}
            </div>
            {line.before == null ? (
              <div className="mt-1 text-sm">{line.after}</div>
            ) : (
              <div className="mt-1 flex flex-col gap-1 text-sm sm:flex-row sm:items-start sm:gap-2">
                <span className="min-w-0 flex-1 rounded-md bg-background/60 px-2 py-1 text-muted-foreground line-through">
                  {line.before}
                </span>
                <ArrowRight className="mt-1 hidden h-3 w-3 shrink-0 text-muted-foreground sm:block" />
                <span className="min-w-0 flex-1 rounded-md bg-background/60 px-2 py-1">
                  {line.after}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div
        className={`mt-4 flex items-start gap-2 rounded-lg p-2 text-xs ${
          proposal.revertible ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
        }`}
      >
        {proposal.revertible ? (
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        ) : (
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        )}
        <span>{revertibilityNotice(proposal.tool)}</span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={onConfirm}
          disabled={applying}
          className="bg-gradient-primary text-primary-foreground"
        >
          {applying ? (
            <>
              <Loader2 className="mr-2 h-3 w-3 animate-spin" /> Application...
            </>
          ) : (
            "Appliquer sur mon compte"
          )}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={applying}>
          Ne pas appliquer
        </Button>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Rien n'a encore été modifié. La correction ne part que si vous cliquez sur « Appliquer sur
        mon compte ».
      </p>
    </div>
  );
}
