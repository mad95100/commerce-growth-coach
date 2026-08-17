import { UNDETERMINED_CURRENCY_LABEL, formatMoney } from "@/lib/currency";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { getCockpit } from "@/lib/cockpit.functions";
import { Button } from "@/components/ui/button";
import { CockpitSkeleton } from "@/components/AppShell";
import { Progress } from "@/components/ui/progress";
import { ScoreRing } from "@/components/ScoreRing";
import { BriefingCard } from "@/components/BriefingCard";
import { FunnelView } from "@/components/FunnelView";
import { WORK_STATE_LABELS, type WorkState } from "@/lib/briefing";
import { explain } from "@/lib/plain-language";
import {
  CATEGORY_LABELS,
  CONFIDENCE_LABELS,
  DIFFICULTY_LABELS,
  formatMinutes,
  type Category,
  type Confidence,
} from "@/lib/scoring";
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  Compass,
  Gauge,
  GitBranch,
  HelpCircle,
  Target,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";

/**
 * Les trois degrés de certitude d'un signal croisé.
 *
 * Les mêmes que ceux du moteur : un croisement ne crée jamais une certitude que
 * les sources n'avaient pas. Un échantillon mince redescend en hypothèse, et
 * l'affichage doit le montrer plutôt que de tout présenter au même niveau.
 */
const CERTAINTY_LABELS: Record<string, string> = {
  fait: "Fait",
  deduction_forte: "Déduction forte",
  hypothese: "Hypothèse",
};

const CERTAINTY_STYLE: Record<string, string> = {
  fait: "bg-primary/15 text-primary",
  deduction_forte: "bg-info/15 text-info",
  hypothese: "bg-muted text-muted-foreground",
};

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/50 p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-xl font-bold">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function Cockpit({ storeId }: { storeId: string }) {
  const fetchCockpit = useServerFn(getCockpit);
  const q = useQuery({
    queryKey: ["cockpit", storeId],
    queryFn: () => fetchCockpit({ data: { storeId } }),
  });

  if (q.isLoading) {
    // Une ossature de la HAUTEUR du cockpit : la ligne de texte qu'elle
    // remplace faisait descendre toute la grille des boutiques à l'arrivée des
    // données, au moment précis où le marchand commençait à la lire.
    return <CockpitSkeleton />;
  }
  if (!q.data) return null;
  const c = q.data;

  const goalPct =
    c.revenueGoal && c.revenueGoal > 0 && c.revenue != null
      ? Math.min(100, Math.round((c.revenue / c.revenueGoal) * 100))
      : null;

  return (
    <section className="space-y-6">
      {c.unavailable.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>
            Certaines données ne sont pas disponibles actuellement ({c.unavailable.join(", ")}). Le
            reste de l'analyse continue avec ce qui est accessible.
          </span>
        </div>
      )}

      <div className="card-elevated rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Score e-commerce
            </div>
            {/* TROIS CAS, PAS DEUX. La phrase n'en distinguait que deux, et le
                troisième tombait du mauvais côté : `computePotential` somme des
                gains avec `?? 0`, si bien qu'un diagnostic dont AUCUN constat
                n'était chiffrable renvoie 0 — un nombre, pas une absence. Le
                marchand lisait donc « Potentiel identifié : 0 € à 0 € par
                mois » : le verdict le plus décourageant du produit, rendu sur
                des montants que nous n'avions pas su établir. Le rapport
                d'audit, lui, masque déjà son bloc de gain dans ce cas ; les
                deux écrans se contredisaient. */}
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              {c.potentialMin == null || c.potentialMax == null
                ? "Lancez un diagnostic pour connaître votre potentiel."
                : c.potentialMax === 0
                  ? "Aucun gain n'a pu être chiffré à ce stade : les constats du diagnostic n'étaient pas rattachables à un montant. Ce n'est pas un potentiel nul, c'est un potentiel non mesuré."
                  : `Potentiel identifié : ${formatMoney(c.potentialMin, c.currency)} à ${formatMoney(c.potentialMax, c.currency)} par mois.`}
            </p>
          </div>
          {c.score != null && <ScoreRing score={c.score} size={80} />}
        </div>

        {goalPct != null && (
          <div className="mt-5">
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Target className="h-3 w-3" /> Objectif {formatMoney(c.revenueGoal, c.currency)}
                /mois
              </span>
              <span>{goalPct} %</span>
            </div>
            <Progress value={goalPct} />
          </div>
        )}
      </div>

      {c.currency === null && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {UNDETERMINED_CURRENCY_LABEL} pour cette boutique. Les montants sont affichés sans unité
          tant que Shopify ne l'a pas renvoyée — aucune devise n'est supposée.
        </p>
      )}
      {c.adSpendCurrency !== null && c.currency !== null && c.adSpendCurrency !== c.currency && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Les dépenses publicitaires sont en {c.adSpendCurrency} alors que la boutique est en{" "}
          {c.currency}. Rentabilité et ROAS ne sont pas calculés : aucune conversion n'est
          disponible.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="CA 30 j" value={formatMoney(c.revenue, c.currency)} />
        <Kpi label="Commandes" value={c.orders != null ? String(c.orders) : "—"} />
        <Kpi label="Panier moyen" value={formatMoney(c.aov, c.currency)} />
        <Kpi label="Dépenses pub" value={formatMoney(c.adSpend, c.adSpendCurrency)} />
        <Kpi label="ROAS" value={c.roas != null ? `${c.roas.toFixed(2)}x` : "—"} />
        <Kpi
          label="Marge estimée"
          value={formatMoney(c.margin, c.currency)}
          hint="Après coût produit"
        />
        {/* L'INTITULÉ SUIT CE QUI A RÉELLEMENT ÉTÉ SOUSTRAIT. L'indication
            annonçait « Marge − pub − charges » même quand les charges fixes
            n'étaient pas renseignées : la formule affichée n'était alors pas
            celle du calcul, et le marchand lisait un bénéfice qui ignorait ses
            charges. */}
        <Kpi
          label="Bénéfice estimé"
          value={formatMoney(c.profit, c.currency)}
          hint={
            c.profitIncludesFixedCosts
              ? "Marge − pub − charges"
              : "Marge − pub (charges fixes non renseignées)"
          }
        />
        <Kpi
          label="Potentiel"
          value={c.potentialMax != null ? `+${formatMoney(c.potentialMax, c.currency)}` : "—"}
          hint="par mois"
        />
      </div>

      {/* La régression est portée par le briefing lui-même, qui bascule en mode
          alerte : deux encarts disant la même chose se feraient concurrence. */}

      {/* LE BRIEFING. Neuf questions dans l'ordre où on se les pose, assemblées
          depuis le moteur — rien n'est écrit en dur. C'est ce qu'on lit en
          arrivant, avant toute statistique. */}
      {c.briefing && (
        <BriefingCard
          briefing={c.briefing}
          auditId={c.priorities[0]?.audit_id ?? null}
          storeId={storeId}
        />
      )}

      {/* L'entonnoir mesuré. Les étapes non mesurées y apparaissent comme
          telles, jamais comme des barres à zéro. */}
      {c.funnel && <FunnelView funnel={c.funnel} />}

      {/* CE QUE LE CROISEMENT DES SOURCES ÉTABLIT.
          Le moteur croise Shopify, Meta, Google et l'origine réelle des
          commandes depuis plusieurs blocs — et le marchand n'en voyait rien.
          Or ce sont les seules conclusions qu'aucune source ne peut produire
          seule : un tableau de bord de régie ne dira jamais que la régie se
          compte trop d'achats. Chaque signal est affiché avec sa certitude ET
          ce qu'il ne permet PAS de conclure : sans cette seconde moitié, un
          signal d'orientation se lit comme un verdict. */}
      {c.crossSignals.length > 0 && (
        <div className="rounded-2xl border border-border/60 bg-card/50 p-6">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <GitBranch className="h-4 w-4" /> Ce que le croisement des sources établit
          </div>
          <ul className="mt-4 space-y-4">
            {c.crossSignals.map((signal) => (
              <li key={signal.id} className="border-l-2 border-border pl-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-medium leading-relaxed">{signal.statement}</p>
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 text-[11px] ${
                      CERTAINTY_STYLE[signal.certainty] ?? "bg-muted text-muted-foreground"
                    }`}
                  >
                    {CERTAINTY_LABELS[signal.certainty] ?? signal.certainty}
                  </span>
                </div>
                {signal.investigate.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {signal.investigate.map((lead) => (
                      <li key={lead} className="text-sm text-muted-foreground">
                        → {lead}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-xs text-yellow-500">{signal.doNotConclude}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* CE QUE JE N'AI PAS PU MESURER.
          Sans cette liste, un rapport se lit comme une couverture complète, et
          un sujet absent passe pour un sujet sain. Les mesures de vitesse
          ressentie, le rendu mobile réel et le tunnel de commande figurent ici
          en clair : ils ne sont pas mesurables depuis un serveur, et les
          approcher produirait exactement les chiffres inventés qu'on s'interdit.

          CE QUI S'AFFICHE N'EST PLUS LE TEXTE DU CODE. Les sources écrivent
          leur motif pour le moteur — « L'API Admin de Shopify n'expose pas le
          trafic : il vit dans l'API Analytics » — et ce motif arrivait tel quel
          sous les yeux du marchand. Il y lisait une panne dont il ne pouvait
          rien faire, et surtout : AUCUNE de ces lignes ne disait quoi faire.
          C'est le troisième élément qui change tout — sans lui, une donnée
          absente est une plainte ; avec lui, c'est une prochaine étape. */}
      {c.dataGaps.length > 0 && (
        <details className="rounded-2xl border border-border/60 bg-card/50 p-6">
          <summary className="cursor-pointer text-xs uppercase tracking-wider text-muted-foreground">
            <HelpCircle className="mr-2 inline h-4 w-4" />
            Ce que nous n'avons pas pu mesurer ({c.dataGaps.length})
          </summary>
          <ul className="mt-4 space-y-4">
            {c.dataGaps.map((gap) => {
              const e = explain(gap.id, gap.label);
              return (
                <li key={gap.id} className="border-l-2 border-border pl-4">
                  <p className="text-sm font-medium">{e.what}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{e.why}</p>
                  <p className="mt-2 text-sm">
                    <span className="font-medium">Ce qu'il faut faire :</span>{" "}
                    <span className="text-muted-foreground">{e.how}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Ce que cela ouvrira : {e.unlocks}
                  </p>
                </li>
              );
            })}
          </ul>
        </details>
      )}

      {/* Où en est chaque chantier. Remplace la liste indifférenciée : le
          marchand voit ce qui reste, ce qui attend, ce qui est acquis. */}
      {c.briefing && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {(Object.keys(WORK_STATE_LABELS) as WorkState[])
            .filter((state) => c.work[state] > 0)
            .map((state) => (
              <div key={state} className="rounded-xl border border-border/60 bg-card/50 p-3">
                <div className="font-display text-xl font-bold">{c.work[state]}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {WORK_STATE_LABELS[state]}
                </div>
              </div>
            ))}
        </div>
      )}

      {/* La réponse du directeur, avant la liste. C'est elle qu'on lit en
          arrivant : un seul geste, et pourquoi celui-là. */}
      {c.plan && !c.briefing && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-6">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-primary">
            <Compass className="h-4 w-4" /> Ce que nous ferions maintenant
          </div>
          <p className="mt-3 text-sm leading-relaxed">{c.plan.rationale}</p>

          {/* PROUVER : ce qui a marché, mesuré, pas supposé. */}
          {c.plan.proven.length > 0 && (
            <ul className="mt-4 space-y-1">
              {c.plan.proven.map((p) => (
                <li key={p.findingId} className="text-sm text-primary">
                  ✅ {p.title}
                  {p.headline && <span className="text-muted-foreground"> — {p.headline}</span>}
                </li>
              ))}
            </ul>
          )}
          {/* APPRENDRE : ce qui n'a rien donné. Y revenir serait du temps perdu. */}
          {c.plan.ineffective.length > 0 && (
            <ul className="mt-2 space-y-1">
              {c.plan.ineffective.map((p) => (
                <li key={p.findingId} className="text-sm text-muted-foreground">
                  ❌ {p.title} — sans effet mesurable, ce n'était pas le blocage.
                </li>
              ))}
            </ul>
          )}
          {c.plan.now && (
            <Link
              to="/audits/$auditId"
              params={{ auditId: c.plan.now.auditId ?? "" }}
              className="mt-4 inline-block"
            >
              <Button className="bg-gradient-primary text-primary-foreground">
                Commencer par « {c.plan.now.title} » <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          )}
        </div>
      )}

      <div>
        <h2 className="font-display text-xl font-bold">Vos priorités aujourd'hui</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Trois actions maximum, dans cet ordre. Une cause passe toujours avant ce qu'elle provoque
          — corriger un symptôme sans sa cause ne donne rien.
        </p>

        {c.priorities.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
            Aucune priorité en attente. Lancez un nouveau diagnostic pour trouver le prochain
            levier.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {c.priorities.map((p, i) => (
              <div key={p.id} className="card-elevated rounded-2xl p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="text-xs uppercase tracking-wider text-primary">
                      #{i + 1} — {CATEGORY_LABELS[p.category as Category] ?? p.category}
                    </div>
                    <h3 className="mt-1 font-display text-lg font-bold">{p.title}</h3>
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1 text-primary">
                        <TrendingUp className="h-3 w-3" />
                        Impact : +{formatMoney(p.impact_min, c.currency)} à +
                        {formatMoney(p.impact_max, c.currency)}/mois
                      </span>
                      <span className="flex items-center gap-1">
                        <Gauge className="h-3 w-3" />
                        {DIFFICULTY_LABELS[p.difficulty] ?? "Moyen"}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatMinutes(p.time_minutes)}
                      </span>
                      <span>
                        Confiance : {CONFIDENCE_LABELS[p.confidence as Confidence] ?? "Moyenne"}
                      </span>
                    </div>
                    {p.unlocks.length > 0 && (
                      <p className="mt-3 flex items-start gap-1.5 text-xs text-primary">
                        <GitBranch className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>
                          Fait tomber aussi : {p.unlocks.map((u) => `« ${u} »`).join(", ")}.
                        </span>
                      </p>
                    )}
                    {p.reason && <p className="mt-2 text-xs text-muted-foreground">{p.reason}</p>}
                    <p className="mt-2 text-xs text-muted-foreground">
                      Ensuite, regardez {p.measure}.
                    </p>
                  </div>
                </div>
                <Link
                  to="/audits/$auditId"
                  params={{ auditId: p.audit_id }}
                  className="mt-4 inline-block"
                >
                  <Button className="bg-gradient-primary text-primary-foreground">
                    Faire maintenant <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        )}

        {/* Ce qui attend, et ce qui l'attend. Le dire évite la question
            « pourquoi ce problème grave n'est-il pas dans la liste ? ». */}
        {c.plan && c.plan.blocked.length > 0 && (
          <div className="mt-4 rounded-xl border border-dashed border-border p-4">
            <div className="text-sm font-medium">
              {c.plan.blocked.length} problème{c.plan.blocked.length > 1 ? "s" : ""} en attente
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Rien à faire dessus pour l'instant : ils viennent de ce qui est au-dessus. Ils
              disparaissent peut-être tout seuls.
            </p>
            <ul className="mt-3 space-y-1.5">
              {c.plan.blocked.map((b) => (
                <li key={b.id} className="text-sm">
                  • {b.title}{" "}
                  <span className="text-muted-foreground">
                    — après {b.blockedBy.map((t) => `« ${t} »`).join(" et ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* CONSTATS TECHNIQUES. Ni cachés, ni proposés comme le geste à faire.
            Les taire ferait disparaître un défaut réel du rapport ; les mettre
            en tête ferait passer une lenteur de serveur devant une fuite
            chiffrée sur les commandes. Ils sont donc listés à part, avec ce qui
            manque pour trancher. */}
        {c.plan && c.plan.technical.length > 0 && (
          <div className="mt-4 rounded-xl border border-dashed border-border p-4">
            <div className="text-sm font-medium">
              {c.plan.technical.length} constat{c.plan.technical.length > 1 ? "s" : ""} technique
              {c.plan.technical.length > 1 ? "s" : ""}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Réels et vérifiés sur votre site. Ce qu'ils coûtent n'est pas mesuré : ils ne passent
              donc pas devant une perte chiffrée, et aucun montant ne leur est attribué.
            </p>
            <ul className="mt-3 space-y-1.5">
              {c.plan.technical.map((item) => (
                <li key={item.id} className="text-sm">
                  • {item.title}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
