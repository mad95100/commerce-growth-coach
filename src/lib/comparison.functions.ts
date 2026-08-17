import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { compareAudits, type AuditComparison, type AuditSnapshot } from "@/lib/audit-comparison";
import { AUDIT_AXES, type AuditAxis } from "@/lib/audit-rules";
import { z } from "zod";

/**
 * Charge deux audits d'une même boutique et les compare.
 *
 * POURQUOI CETTE FONCTION EXISTE ICI, ET PAS DANS LE COMPOSANT. Deux audits ne
 * se comparent que s'ils appartiennent à la MÊME boutique et que cette boutique
 * appartient à l'utilisateur. Faire cette vérification dans le navigateur
 * reviendrait à demander à l'appelant de prouver ses propres droits — ce qu'un
 * appelant malveillant ne fera pas.
 *
 * LE CONTRÔLE D'APPARTENANCE EST FAIT EN DEUX TEMPS, délibérément. On vérifie
 * d'abord que la boutique est bien celle de l'utilisateur, ENSUITE que les deux
 * audits appartiennent à cette boutique. Vérifier seulement le second point
 * laisserait comparer les audits de n'importe qui, à condition d'en connaître
 * les identifiants.
 */

/** Ligne d'audit, telle qu'elle revient de la base. */
type AuditRow = {
  id: string;
  created_at: string;
  score: number | null;
  store_id: string;
  status: string;
  root_causes: unknown;
  axis_scores: unknown;
};

/**
 * Relit les scores par axe stockés en `jsonb`.
 *
 * Tolérant par nécessité : les audits antérieurs à cette colonne n'en ont pas,
 * et un contenu inattendu ne doit pas faire échouer la page. Un axe inconnu est
 * ignoré plutôt que rejeté — la base peut contenir des noms qu'une version
 * ultérieure du moteur ne connaît plus.
 */
function readAxes(raw: unknown): AuditSnapshot["axes"] {
  if (!Array.isArray(raw)) return [];
  const connus = new Set<string>(AUDIT_AXES);
  return raw
    .filter(
      (a): a is { axis: string; score: number | null; measured: boolean } =>
        Boolean(a) &&
        typeof a === "object" &&
        typeof (a as { axis?: unknown }).axis === "string" &&
        connus.has((a as { axis: string }).axis) &&
        // UN AXE SANS NOTE RESTE UN AXE. Exiger un nombre le ferait disparaître
        // de la comparaison, donc du dénominateur qui décide si les scores sont
        // comparables — et la couverture paraîtrait meilleure qu'elle ne l'est.
        // C'est exactement la « dégradation imaginaire » que ce module existe
        // pour empêcher, prise par l'autre bout.
        (typeof (a as { score?: unknown }).score === "number" ||
          (a as { score?: unknown }).score === null),
    )
    .map((a) => ({
      axis: a.axis as AuditAxis,
      score: typeof a.score === "number" ? a.score : null,
      // ABSENCE = NON MESURÉ. Un axe dont on ignore s'il était mesuré ne doit
      // jamais être compté comme mesuré : ce serait exactement l'erreur qui
      // produit des dégradations imaginaires.
      measured: a.measured === true,
    }));
}

function readCauses(raw: unknown): AuditSnapshot["causes"] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (c): c is { id: string; title: string } =>
        Boolean(c) &&
        typeof c === "object" &&
        typeof (c as { id?: unknown }).id === "string" &&
        typeof (c as { title?: unknown }).title === "string",
    )
    .map((c) => ({ id: c.id, title: c.title }));
}

export type ComparisonResult = {
  /** `null` quand la comparaison n'est pas possible ; `reason` dit pourquoi. */
  comparison: AuditComparison | null;
  /** Motif d'impossibilité, en langage marchand. */
  reason: string | null;
};

export const compareTwoAudits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        storeId: z.string().uuid(),
        beforeId: z.string().uuid(),
        afterId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ComparisonResult> => {
    const { supabase, userId } = context;

    // 1. La boutique est-elle celle de l'utilisateur ?
    const { data: store } = await supabase
      .from("stores")
      .select("id, owner_id")
      .eq("id", data.storeId)
      .maybeSingle();
    if (!store || store.owner_id !== userId) {
      return {
        comparison: null,
        reason: "Cette boutique n'est pas accessible depuis votre compte.",
      };
    }

    // 2. Les deux audits appartiennent-ils à CETTE boutique ?
    const { data: rows } = await supabase
      .from("audits")
      .select("id, created_at, score, store_id, status, root_causes, axis_scores")
      .eq("store_id", data.storeId)
      .in("id", [data.beforeId, data.afterId]);

    const audits = (rows ?? []) as AuditRow[];
    const before = audits.find((a) => a.id === data.beforeId);
    const after = audits.find((a) => a.id === data.afterId);
    if (!before || !after) {
      return {
        comparison: null,
        reason: "L'un des deux audits est introuvable pour cette boutique.",
      };
    }
    if (before.id === after.id) {
      return { comparison: null, reason: "Ces deux audits n'en font qu'un." };
    }

    // 3. UN AUDIT INACHEVÉ NE SE COMPARE PAS. Il porte des résultats partiels
    // — parfois aucun — et les confronter à un audit complet produirait un
    // récit de dégradation massive alors que rien n'a bougé.
    const inacheve = [before, after].find((a) => a.status !== "completed");
    if (inacheve) {
      return {
        comparison: null,
        reason:
          "L'un des deux audits ne s'est pas terminé. Nous ne le comparons pas : ses résultats sont incomplets et la comparaison serait trompeuse.",
      };
    }

    const toSnapshot = (row: AuditRow): AuditSnapshot => ({
      id: row.id,
      createdAt: row.created_at,
      score: typeof row.score === "number" ? row.score : null,
      axes: readAxes(row.axis_scores),
      causes: readCauses(row.root_causes),
      findings: [],
    });

    // 4. Les constats, en une seule requête pour les deux audits.
    const { data: findingRows } = await supabase
      .from("audit_findings")
      .select("audit_id, finding_key, title, severity, priority_score")
      .in("audit_id", [before.id, after.id]);

    const parAudit = new Map<string, AuditSnapshot["findings"]>();
    for (const f of (findingRows ?? []) as Array<{
      audit_id: string;
      finding_key: string | null;
      title: string;
      severity: string;
      priority_score: number | null;
    }>) {
      // SANS CLÉ STABLE, PAS DE SUIVI. Un constat sans `finding_key` ne peut
      // pas être reconnu d'un audit à l'autre : le compter reviendrait à le
      // déclarer « nouveau » à chaque fois, puis « résolu » au suivant.
      if (!f.finding_key) continue;
      const liste = parAudit.get(f.audit_id) ?? [];
      liste.push({
        key: f.finding_key,
        title: f.title,
        severity: f.severity,
        impact: typeof f.priority_score === "number" ? f.priority_score : 0,
      });
      parAudit.set(f.audit_id, liste);
    }

    const avant = { ...toSnapshot(before), findings: parAudit.get(before.id) ?? [] };
    const apres = { ...toSnapshot(after), findings: parAudit.get(after.id) ?? [] };

    // L'ORDRE EST IMPOSÉ ICI, PAR LES DATES. La fonction de comparaison ne le
    // devine pas — c'est délibéré — mais l'appelant, lui, doit le garantir :
    // deux audits comparés à l'envers racontent exactement l'inverse.
    const [plusAncien, plusRecent] =
      avant.createdAt <= apres.createdAt ? [avant, apres] : [apres, avant];

    return { comparison: compareAudits(plusAncien, plusRecent), reason: null };
  });

/**
 * Les audits comparables d'une boutique, du plus récent au plus ancien.
 *
 * Ne rend que les audits TERMINÉS : proposer de comparer un audit interrompu
 * serait proposer une comparaison qu'on refusera ensuite.
 */
export const listComparableAudits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ storeId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: store } = await supabase
      .from("stores")
      .select("id, owner_id")
      .eq("id", data.storeId)
      .maybeSingle();
    if (!store || store.owner_id !== userId) return [];

    const { data: rows } = await supabase
      .from("audits")
      .select("id, created_at, score")
      .eq("store_id", data.storeId)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(20);

    return (rows ?? []) as Array<{ id: string; created_at: string; score: number | null }>;
  });
