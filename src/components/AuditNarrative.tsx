import { Sparkles, Target, Layers } from "lucide-react";
import type { AudienceView, CauseView } from "@/lib/audit-narrative";

/**
 * CE QUI OUVRE LE RAPPORT : à qui vous vendez, et ce qui vous bloque.
 *
 * POURQUOI CE COMPOSANT EXISTE. Les deux raisonnements les plus distinctifs du
 * moteur — le portrait du client cible et le regroupement des symptômes en
 * causes racines — étaient calculés, transmis au modèle, puis perdus. Ils
 * influençaient le texte de l'audit sans jamais être montrés. Le marchand
 * lisait donc les conclusions sans voir le raisonnement qui les produit, ce qui
 * est exactement la différence entre un consultant et un générateur de conseils.
 *
 * L'ORDRE DE LECTURE EST DÉLIBÉRÉ. Le client cible d'abord, parce qu'il donne
 * le sens de tout le reste : « il manque des avis » ne veut pas dire la même
 * chose selon qu'on vend à douze euros ou à sept cents. Les causes ensuite,
 * parce qu'elles disent ce qu'il faut corriger. Les constats détaillés après,
 * pour qui veut vérifier.
 *
 * CE QUI N'EST JAMAIS AFFICHÉ SANS SA RÉSERVE. Le portrait est une HYPOTHÈSE :
 * son pourcentage de confiance est écrit à côté de son titre, pas caché dans
 * une infobulle. Un lecteur qui ne verrait pas ce chiffre lirait une déduction
 * comme un fait — et prendrait des décisions dessus.
 */

const TIER_LABELS: Record<string, string> = {
  entree: "entrée de gamme",
  milieu: "milieu de gamme",
  premium: "premium",
  luxe: "luxe",
};

export function AuditNarrative({
  audience,
  causes,
}: {
  audience: AudienceView | null;
  causes: CauseView[];
}) {
  if (!audience && causes.length === 0) return null;

  return (
    <div className="space-y-6">
      {audience && (
        <div className="card-elevated rounded-2xl p-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Target className="h-4 w-4" />
            </div>
            <h2 className="font-display text-lg font-bold">À qui votre boutique semble vendre</h2>
            {/*
              LE POURCENTAGE EST À CÔTÉ DU TITRE, pas dans une infobulle. Un
              lecteur qui ne le verrait pas lirait une déduction comme un fait.
            */}
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              hypothèse — {audience.confidence} % de confiance
            </span>
          </div>

          <p className="mt-4 leading-relaxed">{audience.segment}</p>

          <div className="mt-4 flex flex-wrap gap-4 text-sm text-muted-foreground">
            {audience.tier && (
              <span>
                Gamme :{" "}
                <span className="text-foreground">
                  {TIER_LABELS[audience.tier] ?? audience.tier}
                </span>
              </span>
            )}
            <span>
              Sensibilité au prix :{" "}
              <span className="text-foreground">{audience.priceSensitivity}</span>
            </span>
          </div>

          {audience.objections.length > 0 && (
            <div className="mt-5">
              <div className="text-sm font-medium">Ce qui retient probablement vos visiteurs</div>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {audience.objections.slice(0, 4).map((o) => (
                  <li key={o}>— {o}</li>
                ))}
              </ul>
            </div>
          )}

          {audience.signals.length > 0 && (
            <details className="mt-5">
              <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                Sur quoi repose cette hypothèse
              </summary>
              <ul className="mt-3 space-y-2 text-sm">
                {audience.signals.map((s) => (
                  <li key={s.evidence} className="text-muted-foreground">
                    {/*
                      « Constaté sur vos ventes » pèse plus que « lu sur votre
                      site » : ce que la boutique affiche dit ce qu'elle veut
                      vendre, ce qu'on lui achète dit qui elle sert.
                    */}
                    <span
                      className={`mr-2 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                        s.proven
                          ? "bg-emerald-500/10 text-emerald-600"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {s.proven ? "vos ventes" : "votre site"}
                    </span>
                    {s.evidence}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {audience.missing.length > 0 && (
            <p className="mt-4 rounded-lg bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
              Ce qui affinerait ce portrait : {audience.missing.join(" ")}
            </p>
          )}
        </div>
      )}

      {causes.length > 0 && (
        <div className="card-elevated rounded-2xl p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Layers className="h-4 w-4" />
            </div>
            <h2 className="font-display text-lg font-bold">Ce qui bloque, au fond</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Plusieurs points relevés plus bas viennent du même problème. Les corriger ensemble
            demande moins de travail que de les traiter un par un.
          </p>
          <ul className="mt-4 space-y-3">
            {causes.map((c) => (
              <li key={c.id} className="flex items-start gap-3">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span className="text-sm">{c.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
