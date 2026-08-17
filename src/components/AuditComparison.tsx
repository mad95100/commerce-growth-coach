import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  MinusCircle,
  PlusCircle,
  TrendingUp,
} from "lucide-react";
import { compareTwoAudits, listComparableAudits } from "@/lib/comparison.functions";
import { ErrorState } from "@/components/AppShell";

/**
 * CE QUI A CHANGÉ DEPUIS LE DERNIER AUDIT.
 *
 * CE QUE CET ÉCRAN MET EN AVANT, ET DANS QUEL ORDRE. La phrase d'ouverture
 * d'abord, les problèmes de fond ensuite, les points détaillés après, et le
 * score en dernier. C'est l'inverse de l'ordre habituel, et c'est délibéré : une
 * cause disparue correspond à un travail que le marchand se rappelle avoir
 * fait, tandis que « 61 → 68 » ne correspond à rien qu'il puisse relier à ses
 * soirées.
 *
 * CE QU'IL NE MONTRE JAMAIS. Un écart de score que le moteur a refusé de
 * calculer. Quand la couverture des données a changé entre les deux passages,
 * la réserve s'affiche à la place du chiffre — parce qu'un chiffre reste en
 * mémoire là où une réserve s'oublie.
 */
export function AuditComparison({ storeId }: { storeId: string }) {
  const listFn = useServerFn(listComparableAudits);
  const compareFn = useServerFn(compareTwoAudits);
  const [beforeId, setBeforeId] = useState<string | null>(null);
  const [afterId, setAfterId] = useState<string | null>(null);

  const auditsQ = useQuery({
    queryKey: ["comparable-audits", storeId],
    queryFn: () => listFn({ data: { storeId } }),
  });

  const audits = auditsQ.data ?? [];
  // Par défaut : les deux plus récents. C'est la comparaison que le marchand
  // veut voir en arrivant, et la seule qu'il sait interpréter sans réfléchir.
  const defaultAfter = audits[0]?.id ?? null;
  const defaultBefore = audits[1]?.id ?? null;
  const a = afterId ?? defaultAfter;
  const b = beforeId ?? defaultBefore;

  const comparisonQ = useQuery({
    queryKey: ["audit-comparison", storeId, b, a],
    queryFn: () => compareFn({ data: { storeId, beforeId: b!, afterId: a! } }),
    enabled: Boolean(a && b),
  });

  if (auditsQ.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Chargement de l'historique…
      </div>
    );
  }
  if (auditsQ.isError) {
    return <ErrorState onRetry={() => void auditsQ.refetch()} />;
  }

  // UN SEUL AUDIT N'EST PAS UNE ERREUR. C'est l'état normal d'une boutique qui
  // vient d'arriver, et le dire ainsi évite de faire croire à un défaut.
  if (audits.length < 2) {
    return (
      <div className="card-elevated rounded-2xl p-6">
        <h3 className="font-display text-lg font-bold">Évolution</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {audits.length === 0
            ? "Aucun audit terminé pour l'instant. Lancez-en un pour commencer à suivre votre progression."
            : "Il faut deux audits pour mesurer une progression. Le prochain vous montrera ce qui a changé."}
        </p>
      </div>
    );
  }

  const res = comparisonQ.data;
  const c = res?.comparison ?? null;

  return (
    <div className="card-elevated rounded-2xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-lg font-bold">Ce qui a changé</h3>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            aria-label="Audit de départ"
            className="rounded-lg border border-border/50 bg-background px-2 py-1"
            value={b ?? ""}
            onChange={(e) => setBeforeId(e.target.value)}
          >
            {audits.map((x) => (
              <option key={x.id} value={x.id}>
                {new Date(x.created_at).toLocaleDateString("fr-FR")}
              </option>
            ))}
          </select>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <select
            aria-label="Audit d'arrivée"
            className="rounded-lg border border-border/50 bg-background px-2 py-1"
            value={a ?? ""}
            onChange={(e) => setAfterId(e.target.value)}
          >
            {audits.map((x) => (
              <option key={x.id} value={x.id}>
                {new Date(x.created_at).toLocaleDateString("fr-FR")}
              </option>
            ))}
          </select>
        </div>
      </div>

      {comparisonQ.isLoading ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Comparaison en cours…
        </div>
      ) : comparisonQ.isError ? (
        <div className="mt-6">
          <ErrorState onRetry={() => void comparisonQ.refetch()} />
        </div>
      ) : !c ? (
        <p className="mt-6 text-sm text-muted-foreground">
          {res?.reason ?? "Cette comparaison n'est pas disponible."}
        </p>
      ) : (
        <div className="mt-6 space-y-6">
          <p className="font-display text-xl leading-snug">{c.headline}</p>

          {/* LES PROBLÈMES DE FOND D'ABORD. C'est le niveau auquel le marchand
              a travaillé, et donc celui où il reconnaît son propre effort. */}
          {c.causesResolved.length > 0 && (
            <Bloc
              icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
              titre="Ce qui ne pose plus problème"
              items={c.causesResolved.map((x) => x.title)}
            />
          )}
          {c.causesPersisting.length > 0 && (
            <Bloc
              icon={<MinusCircle className="h-4 w-4 text-amber-500" />}
              titre="Ce qui bloque encore"
              items={c.causesPersisting.map((x) => x.title)}
            />
          )}
          {c.causesAppeared.length > 0 && (
            <Bloc
              icon={<PlusCircle className="h-4 w-4 text-destructive" />}
              titre="Nouveau problème de fond"
              items={c.causesAppeared.map((x) => x.title)}
            />
          )}

          {(c.resolved.length > 0 || c.appeared.length > 0 || c.worsened.length > 0) && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Compteur label="Réglés" valeur={c.resolved.length} teinte="bien" />
              <Compteur label="Aggravés" valeur={c.worsened.length} teinte="mal" />
              <Compteur label="Nouveaux" valeur={c.appeared.length} teinte="neutre" />
            </div>
          )}

          {/* LE SCORE EN DERNIER, et seulement s'il veut dire quelque chose.
              Quand la couverture a changé, la réserve remplace le chiffre : un
              chiffre reste en mémoire là où une réserve s'oublie. */}
          {c.scoreDelta !== null ? (
            <div className="flex items-center gap-2 text-sm">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Note d'ensemble :</span>
              <span className="font-medium">
                {c.before.score} → {c.after.score}
              </span>
              <span
                className={
                  c.scoreDelta > 0
                    ? "text-emerald-500"
                    : c.scoreDelta < 0
                      ? "text-destructive"
                      : "text-muted-foreground"
                }
              >
                ({c.scoreDelta > 0 ? "+" : ""}
                {c.scoreDelta})
              </span>
            </div>
          ) : c.scoreCaveat ? (
            <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
              {c.scoreCaveat}
            </p>
          ) : null}

          {/* Les points perdus de vue sont dits explicitement : sans cela, le
              marchand croirait à une régression que nous avons refusé de
              calculer. */}
          {c.axes
            .filter((x) => !x.comparable && x.before !== null && x.after === null)
            .map((x) => (
              <p key={x.axis} className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{x.label} :</span> {x.reason}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}

function Bloc({ icon, titre, items }: { icon: React.ReactNode; titre: string; items: string[] }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {titre}
      </div>
      <ul className="mt-2 space-y-1 pl-6 text-sm text-muted-foreground">
        {items.map((x) => (
          <li key={x} className="list-disc">
            {x}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Compteur({
  label,
  valeur,
  teinte,
}: {
  label: string;
  valeur: number;
  teinte: "bien" | "mal" | "neutre";
}) {
  const couleur =
    teinte === "bien"
      ? "text-emerald-500"
      : teinte === "mal"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="rounded-xl border border-border/50 p-4">
      <div className={`font-display text-2xl font-bold ${couleur}`}>{valeur}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
