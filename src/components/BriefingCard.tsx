import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle2, Compass, HelpCircle, Quote, Undo2, Wrench } from "lucide-react";
import type { Briefing } from "@/lib/briefing";

/**
 * Le briefing du directeur, en tête du centre de pilotage.
 *
 * CE QU'IL REMPLACE. Une liste de recommandations, même bien classée, ne
 * répond pas à « qu'est-ce que je fais maintenant ? ». Cet écran répond aux
 * neuf questions dans l'ordre où on se les pose : quel problème, ce qu'il
 * coûte, la preuve, ce qui est certain, la cause, ce qu'on sait, ce qu'on
 * ignore, le geste, et comment on vérifiera.
 *
 * LE BOUTON NE MENT PAS. « Corriger maintenant » n'apparaît que là où une
 * correction existe réellement, et il ouvre le rapport où l'aperçu avant/après
 * est présenté avant toute écriture. Partout ailleurs c'est « Guider la
 * correction », avec la procédure — jamais un bouton qui laisserait croire
 * qu'un geste a été fait alors que rien n'a été exécuté.
 */
export function BriefingCard({
  briefing,
  auditId,
  storeId,
}: {
  briefing: Briefing;
  auditId: string | null;
  storeId: string;
}) {
  const isAlert = briefing.action?.kind === "annuler";

  return (
    <div
      className={`rounded-2xl border p-6 ${
        isAlert ? "border-destructive/40 bg-destructive/5" : "border-primary/30 bg-primary/5"
      }`}
    >
      <div
        className={`flex items-center gap-2 text-xs uppercase tracking-wider ${
          isAlert ? "text-destructive" : "text-primary"
        }`}
      >
        <Compass className="h-4 w-4" />
        {isAlert ? "À réparer avant tout" : "Ce que nous ferions maintenant"}
      </div>

      {briefing.headline ? (
        <h2 className="mt-2 font-display text-2xl font-bold">{briefing.headline}</h2>
      ) : (
        <h2 className="mt-2 font-display text-xl font-bold">Rien qui bloque dans l'immédiat</h2>
      )}

      {/* Ce que ça coûte. Jamais un zéro par défaut : quand ce n'est pas
          chiffrable, la phrase le dit. */}
      <p className="mt-3 text-sm leading-relaxed">
        <span className="font-medium">Impact : </span>
        {briefing.impact}
      </p>

      {briefing.certainty.level && (
        <p className="mt-2 text-xs text-muted-foreground">
          <span
            className="rounded-md border border-border px-2 py-0.5"
            title={briefing.certainty.hint}
          >
            {briefing.certainty.label}
          </span>{" "}
          {briefing.certainty.hint}
        </p>
      )}

      {briefing.proof.length > 0 && (
        <div className="mt-4">
          <div className="text-xs uppercase text-muted-foreground">Preuve</div>
          <ul className="mt-1 space-y-1">
            {briefing.proof.map((p, i) => (
              <li key={i} className="flex items-start gap-1.5 text-sm text-muted-foreground">
                <Quote className="mt-1 h-3 w-3 shrink-0" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {briefing.rootCause && (
        <div className="mt-4">
          <div className="text-xs uppercase text-muted-foreground">Cause racine</div>
          <p className="mt-1 text-sm">{briefing.rootCause}</p>
        </div>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {briefing.known.length > 0 && (
          <div>
            <div className="text-xs uppercase text-muted-foreground">Ce que nous savons</div>
            <ul className="mt-1 space-y-1">
              {briefing.known.map((k, i) => (
                <li key={i} className="flex items-start gap-1.5 text-sm">
                  <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                  <span>{k}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* Ce qu'on ignore est affiché AUSSI GRAND que ce qu'on sait : c'est ce
            qui distingue un diagnostic d'une opinion assurée. */}
        {briefing.unknown.length > 0 && (
          <div>
            <div className="text-xs uppercase text-muted-foreground">
              Ce que nous ne savons pas encore
            </div>
            <ul className="mt-1 space-y-1">
              {briefing.unknown.map((u, i) => (
                <li key={i} className="flex items-start gap-1.5 text-sm text-muted-foreground">
                  <HelpCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{u}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {briefing.action && (
        <div className="mt-5 rounded-xl border border-border/60 bg-card/50 p-4">
          <p className="text-sm">
            <span className="font-medium">Pourquoi cette action : </span>
            {briefing.action.why}
          </p>
          {briefing.action.steps.length > 0 && (
            <ol className="mt-3 space-y-1.5">
              {briefing.action.steps.map((s, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="shrink-0 text-primary">{i + 1}.</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          )}
          {briefing.expected && (
            <p className="mt-3 text-sm">
              <span className="font-medium">Résultat attendu : </span>
              {briefing.expected}
            </p>
          )}
          {briefing.verification && (
            <p className="mt-2 text-sm text-muted-foreground">
              <span className="font-medium">Comment nous vérifierons : </span>
              {briefing.verification}
            </p>
          )}

          {/* Le bouton mène à l'aperçu. Il n'exécute rien par lui-même. */}
          {briefing.action.kind === "annuler" ? (
            <Link to="/tracking/$storeId" params={{ storeId }} className="mt-4 inline-block">
              <Button variant="outline">
                <Undo2 className="mr-2 h-4 w-4" /> {briefing.action.label}
              </Button>
            </Link>
          ) : auditId ? (
            <Link to="/audits/$auditId" params={{ auditId }} className="mt-4 inline-block">
              <Button className="bg-gradient-primary text-primary-foreground">
                {briefing.action.kind === "corriger" ? (
                  <Wrench className="mr-2 h-4 w-4" />
                ) : (
                  <Compass className="mr-2 h-4 w-4" />
                )}
                {briefing.action.label} <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          ) : null}
          {briefing.action.kind === "corriger" && (
            <p className="mt-2 text-xs text-muted-foreground">
              Vous verrez exactement ce qui sera modifié avant que quoi que ce soit ne parte sur
              votre boutique.
            </p>
          )}
        </div>
      )}

      {briefing.nextDecision && (
        <p className="mt-4 text-sm text-muted-foreground">
          <span className="font-medium">Ensuite : </span>
          {briefing.nextDecision}
        </p>
      )}
    </div>
  );
}
