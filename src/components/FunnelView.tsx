import { AlertCircle, HelpCircle } from "lucide-react";
import type { Funnel } from "@/lib/funnel";

/**
 * L'entonnoir, tel qu'il a été mesuré.
 *
 * TROIS RÈGLES QUE CET AFFICHAGE NE DOIT PAS TRAHIR, parce qu'elles sont la
 * raison d'être du moteur :
 *
 * 1. **Une marche non mesurée s'affiche comme non mesurée**, pas comme une
 *    barre à zéro. Une barre vide se lit comme « il n'y a personne » ; un trou
 *    nommé se lit comme « je ne sais pas ». Ce sont deux informations opposées.
 *
 * 2. **Une fuite ne s'affiche qu'entre deux marches réellement mesurées.**
 *    L'entonnoir saute visiblement par-dessus les trous plutôt que de les
 *    combler par une ligne continue qui suggérerait un parcours connu.
 *
 * 3. **Un montant non chiffrable n'est pas remplacé par un tiret.** Il est dit.
 *
 * La largeur des barres est logarithmique : entre 100 000 impressions et 60
 * commandes, une échelle linéaire réduirait toutes les marches basses à un
 * trait invisible, c'est-à-dire à rien.
 */
export function FunnelView({ funnel, className }: { funnel: Funnel; className?: string }) {
  const measured = funnel.steps.filter((s) => s.value !== null && s.value > 0);
  if (measured.length < 2) {
    return (
      <div className={`rounded-xl border border-dashed border-border p-6 ${className ?? ""}`}>
        <div className="flex items-center gap-2 text-sm font-medium">
          <HelpCircle className="h-4 w-4 text-muted-foreground" />
          Parcours client non reconstituable
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Il faut au moins deux étapes mesurées pour suivre où les visiteurs s'arrêtent. Connectez
          davantage de sources pour que nous puissions vous dire où cela bloque.
        </p>
      </div>
    );
  }

  const max = Math.max(...measured.map((s) => s.value!));
  const width = (value: number) => {
    // Échelle logarithmique : sinon les dernières marches disparaissent.
    const ratio = Math.log10(value + 1) / Math.log10(max + 1);
    return `${Math.max(6, Math.round(ratio * 100))}%`;
  };

  const leakInto = new Map(funnel.leaks.map((l) => [l.to, l]));

  return (
    <div className={`card-elevated rounded-2xl p-6 ${className ?? ""}`}>
      <h2 className="font-display text-lg font-bold">Où passent vos visiteurs</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Sur les 30 derniers jours. Chaque chiffre vient d'une source réelle — survole pour la voir.
      </p>

      <div className="mt-5 space-y-3">
        {funnel.steps.map((step) => {
          const leak = leakInto.get(step.stage);
          if (step.value === null) {
            return (
              <div
                key={step.stage}
                className="rounded-lg border border-dashed border-border/70 p-3"
              >
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <HelpCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    <strong>{step.label}</strong> — non mesuré
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Je n'ai pas cette donnée. Je n'ai donc pas cherché de fuite autour de cette étape
                  : je ne veux pas t'attribuer une perte dont je ne sais rien.
                </p>
              </div>
            );
          }

          return (
            <div key={step.stage}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{step.label}</span>
                <span className="font-display text-lg font-bold" title={step.evidence ?? undefined}>
                  {Math.round(step.value).toLocaleString("fr-FR")}
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full transition-all ${leak ? "bg-destructive/70" : "bg-gradient-primary"}`}
                  style={{ width: width(step.value) }}
                />
              </div>
              {leak && (
                <p className="mt-1.5 flex items-start gap-1.5 text-xs text-destructive">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    {leak.rate} % seulement passent cette étape, contre {leak.reference} %
                    habituellement — il en manque {leak.missing}.
                    {leak.costPerMonth !== null
                      ? ` Soit environ ${leak.costPerMonth}${leak.currency ? ` ${leak.currency}` : ""} par mois.`
                      : " Cette perte ne peut pas être chiffrée sans votre panier moyen."}
                  </span>
                </p>
              )}
            </div>
          );
        })}
      </div>

      {funnel.leaks.length === 0 && funnel.unknown.length > 0 && (
        <p className="mt-4 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          Aucune des étapes mesurées ne décroche. Cela ne veut pas dire que tout va bien : si une
          fuite existe, elle est sur une étape que je ne mesure pas encore.
        </p>
      )}
    </div>
  );
}
