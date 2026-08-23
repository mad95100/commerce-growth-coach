import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getEntitlements } from "@/lib/actions.functions";
import {
  PLAN_LABELS,
  QUOTA_LABELS,
  QUOTAS_SUSPENDUS_POUR_TEST,
  quotaLimit,
  type QuotaKey,
} from "@/lib/plans";
import { ErrorState, PlanSkeleton } from "@/components/AppShell";

const SHOWN: QuotaKey[] = ["audits", "fixes"];

/**
 * Plan en cours et consommation du mois.
 *
 * N'affiche que les compteurs adossés à une fonctionnalité existante : le coach
 * a sa colonne en base mais aucun écran, montrer un solde pour quelque chose
 * d'inatteignable ne renseignerait personne.
 *
 * Affichage seul. La décision d'autoriser ou de refuser est prise côté serveur
 * au moment d'agir : ce qui est montré ici ne fait qu'informer.
 */
export function PlanUsageCard() {
  const fetchEntitlements = useServerFn(getEntitlements);
  const q = useQuery({
    queryKey: ["entitlements"],
    queryFn: () => fetchEntitlements({ data: undefined }),
  });

  if (q.isLoading) {
    // La carte s'insérait AU-DESSUS du formulaire des paramètres : la ligne de
    // texte laissait tout le formulaire remonter, puis redescendre à l'arrivée
    // du plan. L'ossature occupe la hauteur définitive.
    return <PlanSkeleton />;
  }
  // L'ÉCHEC SE DIT. La carte se contentait de disparaître : `return null` sur
  // une lecture ratée laissait un blanc à l'endroit exact où le marchand vient
  // vérifier ce qu'il lui reste. Rien ne distinguait « la lecture a échoué » de
  // « vous n'avez pas de plan » — et la seconde lecture est la plus naturelle
  // quand on ne voit rien. C'est la règle déjà tenue par tous les écrans
  // distants du produit ; cette carte y échappait parce qu'elle n'en est pas un.
  if (q.isError || !q.data) {
    return (
      <ErrorState
        title="Impossible d'afficher votre plan"
        description="Le solde de vos audits et de vos corrections n'a pas pu être lu. Vos compteurs ne sont pas touchés : c'est l'affichage qui a échoué, pas votre plan."
        onRetry={() => void q.refetch()}
      />
    );
  }
  const e = q.data;

  /*
    « PÉRIODE : INVALID DATE ».

    Cette ligne SUPPOSE que `periodStart` est une date nue — « 2026-08-01 » — et
    lui accole `T00:00:00Z`. C'est vrai aujourd'hui : la colonne `period_start`
    est de type `date`, et `billing.server.ts` tronque en plus à dix caractères.
    Deux précautions, aux deux bouts, et rien entre les deux qui les relie.

    Qu'un seul des deux côtés change — colonne passée en `timestamptz`, `slice`
    retiré lors d'un remaniement — et la concaténation donne
    « 2026-08-01T00:00:00ZT00:00:00Z » : une date invalide, que
    `toLocaleDateString` rend littéralement « Invalid Date ». Sur l'écran qui
    annonce au marchand ce qu'il a consommé et ce qui lui reste.

    C'est la même règle que partout ailleurs dans ce produit : une valeur qu'on
    ne sait pas lire ne s'affiche pas telle quelle. Ici, la période disparaît —
    les compteurs, eux, restent lisibles et sont le vrai sujet de la carte.
  */
  const periodDate = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(e.periodStart) ? `${e.periodStart}T00:00:00Z` : e.periodStart,
  );
  const periodLabel = Number.isNaN(periodDate.getTime())
    ? null
    : periodDate.toLocaleDateString("fr-FR", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });

  return (
    <div className="rounded-2xl border border-border/60 bg-card/50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold">Votre abonnement — {PLAN_LABELS[e.tier]}</h2>
        {periodLabel && (
          <span className="text-xs text-muted-foreground">Période en cours : {periodLabel}</span>
        )}
      </div>
      {/* CE QUE LA CARTE RÉPOND, ET DANS CET ORDRE : ce qui est inclus, ce qui
          a été consommé, ce qu'il reste. Sans cette ligne, le marchand lisait
          des compteurs sans savoir de quoi ils comptaient la consommation. */}
      <p className="mt-1 text-sm text-muted-foreground">
        Ce que votre abonnement inclut ce mois-ci, et ce que vous en avez utilisé.
      </p>

      <div className="mt-4 space-y-3">
        {SHOWN.map((key) => {
          const used = e.used[key];
          const left = e.remaining[key];
          // LA LIMITE SE LIT, ELLE NE SE DÉDUIT PAS. La carte affichait
          // `used + left`. Or `remainingQuota` ne descend jamais sous zéro : dès
          // qu'un compteur dépasse son plafond — deux onglets qui lancent un
          // audit en même temps suffisent — le reste vaut 0 et la somme vaut la
          // consommation elle-même. Le marchand lisait alors « 4 / 4 utilisés »
          // sur un plan qui en inclut 3, c'est-à-dire son propre dépassement
          // présenté comme son allocation. Et l'écran suivant, celui du refus,
          // lui disait « vos 3 audits du mois » : deux chiffres différents pour
          // le même plan, à deux clics d'écart.
          //
          // `quotaLimit` est la source dont sort déjà `remaining`, côté serveur.
          // La lire ici plutôt que de la reconstituer supprime la possibilité
          // même du désaccord.
          const limit = quotaLimit(e.tier, key);
          const unlimited = limit === null;
          const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;

          return (
            <div key={key}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="capitalize text-muted-foreground">{QUOTA_LABELS[key]}</span>
                <span className={!unlimited && left === 0 ? "text-destructive" : ""}>
                  {unlimited ? `${used} utilisés · sans limite` : `${used} / ${limit} utilisés`}
                </span>
              </div>
              {!unlimited && (
                <div className="h-1.5 overflow-hidden rounded-full bg-border/60">
                  <div
                    className={`h-full rounded-full ${left === 0 ? "bg-destructive" : "bg-gradient-primary"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* CE QUE LA PHRASE PROMET DOIT ÊTRE CE QUI SE PASSE. La note annonçait un
          refus au-delà des quantités incluses. Or les plafonds sont suspendus
          pendant la phase d'essai : le compteur affiche « sans limite » deux
          lignes plus haut, et la note en dessous annonçait l'inverse. Les deux
          régimes ont donc chacun leur phrase. */}
      {e.tier === "free" && (
        <p className="mt-4 text-xs text-muted-foreground">
          {QUOTAS_SUSPENDUS_POUR_TEST
            ? "Vos compteurs repartent à zéro le 1er de chaque mois. Pendant la phase d'essai, rien n'est plafonné ni facturé : ces chiffres vous disent seulement ce que vous avez utilisé."
            : "Vos compteurs repartent à zéro le 1er de chaque mois. Rien n'est facturé sur ce plan : au-delà des quantités incluses, les lancements sont refusés, jamais prélevés."}
        </p>
      )}
    </div>
  );
}
