// Le même type de client que le journal des actions : le redéclarer
// réintroduirait les `any` déjà assumés une fois ailleurs.
import type { Db } from "@/lib/actions.server";
import {
  QUOTA_COLUMN,
  effectiveTier,
  isCurrentPeriod,
  isQuotaExhausted,
  periodStart,
  quotaExhaustedMessage,
  remainingQuota,
  type PlanTier,
  type QuotaKey,
} from "@/lib/plans";

/**
 * Décompte des quotas.
 *
 * POURQUOI LE CLIENT SERVICE-ROLE. Les tables `usage` et `subscriptions` sont
 * exposées au navigateur via PostgREST. Compter avec le client de l'utilisateur
 * reviendrait à lui confier son propre compteur : il lui suffirait de le
 * remettre à zéro. Tout passe donc par `supabaseAdmin`, et la décision n'est
 * jamais prise côté client.
 *
 * POURQUOI UN COMPARE-AND-SWAP. PostgREST ne sait pas faire
 * `SET audits_used = audits_used + 1` : il faut lire puis écrire. Deux requêtes
 * simultanées liraient la même valeur et n'incrémenteraient qu'une fois — le
 * quota fuirait. L'écriture est donc conditionnée à la valeur lue
 * (`.eq(colonne, valeurLue)`) : si une autre requête est passée entre-temps,
 * zéro ligne revient et on relit. Sans procédure SQL, c'est la seule garantie
 * possible depuis l'application, et elle ne demande aucune migration.
 */

const MAX_CAS_ATTEMPTS = 4;

export type Entitlements = {
  tier: PlanTier;
  periodStart: string;
  used: Record<QuotaKey, number>;
  /** Solde restant par compteur. `null` = sans limite. */
  remaining: Record<QuotaKey, number | null>;
};

type UsageRow = {
  id: string;
  user_id: string;
  period_start: string;
  audits_used: number;
  fixes_used: number;
  coach_messages_used: number;
};

const ZERO_USAGE: Record<QuotaKey, number> = { audits: 0, fixes: 0, coach_messages: 0 };

function toUsed(row: Pick<UsageRow, "audits_used" | "fixes_used" | "coach_messages_used"> | null) {
  if (!row) return { ...ZERO_USAGE };
  return {
    audits: row.audits_used ?? 0,
    fixes: row.fixes_used ?? 0,
    coach_messages: row.coach_messages_used ?? 0,
  };
}

/** Plan réellement accordé à l'utilisateur. Sans abonnement exploitable : `free`. */
async function loadTier(admin: Db, userId: string): Promise<PlanTier> {
  const { data } = await admin
    .from("subscriptions")
    .select("tier, status")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return effectiveTier(data as { tier?: string | null; status?: string | null } | null);
}

/**
 * Ligne de consommation de la période en cours, créée ou remise à zéro au besoin.
 *
 * Une ligne dont la période est passée est réinitialisée en place plutôt que
 * dupliquée : l'historique de consommation n'est pas un besoin du produit, et
 * accumuler une ligne par mois et par utilisateur sans contrainte d'unicité
 * connue ouvrirait la porte aux doublons.
 */
async function loadOrResetUsage(admin: Db, userId: string): Promise<UsageRow | null> {
  const current = periodStart();

  const { data: existing } = await admin
    .from("usage")
    .select("*")
    .eq("user_id", userId)
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = existing as UsageRow | null;

  if (row && isCurrentPeriod(row.period_start)) return row;

  if (row) {
    // Période échue : on repart de zéro. La condition sur l'ancienne période
    // évite que deux requêtes concurrentes réinitialisent deux fois, ce qui
    // effacerait une consommation déjà enregistrée par l'autre.
    const { data: reset } = await admin
      .from("usage")
      .update({
        period_start: current,
        audits_used: 0,
        fixes_used: 0,
        coach_messages_used: 0,
      })
      .eq("id", row.id)
      .eq("period_start", row.period_start)
      .select()
      .maybeSingle();
    if (reset) return reset as UsageRow;
    // Une autre requête a réinitialisé avant nous : sa version fait foi.
    const { data: fresh } = await admin.from("usage").select("*").eq("id", row.id).maybeSingle();
    return (fresh as UsageRow | null) ?? null;
  }

  const { data: created } = await admin
    .from("usage")
    .insert({
      user_id: userId,
      period_start: current,
      audits_used: 0,
      fixes_used: 0,
      coach_messages_used: 0,
    })
    .select()
    .maybeSingle();
  if (created) return created as UsageRow;

  // Insertion perdue face à une requête concurrente : on relit la sienne.
  const { data: after } = await admin
    .from("usage")
    .select("*")
    .eq("user_id", userId)
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (after as UsageRow | null) ?? null;
}

/** Plan et consommation de l'utilisateur pour la période en cours. */
export async function loadEntitlements(admin: Db, userId: string): Promise<Entitlements> {
  const [tier, usage] = await Promise.all([
    loadTier(admin, userId),
    loadOrResetUsage(admin, userId),
  ]);
  const used = toUsed(usage);
  return {
    tier,
    periodStart: usage?.period_start?.slice(0, 10) ?? periodStart(),
    used,
    remaining: {
      audits: remainingQuota(tier, "audits", used.audits),
      fixes: remainingQuota(tier, "fixes", used.fixes),
      coach_messages: remainingQuota(tier, "coach_messages", used.coach_messages),
    },
  };
}

/** Levée quand une action est refusée faute de quota. */
export class QuotaExhaustedError extends Error {
  readonly quota: QuotaKey;
  readonly tier: PlanTier;

  constructor(tier: PlanTier, quota: QuotaKey) {
    super(quotaExhaustedMessage(tier, quota));
    this.name = "QuotaExhaustedError";
    this.quota = quota;
    this.tier = tier;
  }
}

/**
 * Réserve une unité de quota, ou refuse.
 *
 * Le décompte a lieu AVANT l'opération payante, jamais après : compter ensuite
 * laisserait un utilisateur au quota épuisé déclencher autant d'appels au
 * modèle qu'il le souhaite tant qu'aucun n'a fini.
 *
 * Un plan sans limite n'écrit rien : il n'y a rien à compter, et une écriture
 * inutile par appel serait un coût gratuit.
 */
export async function consumeQuota(admin: Db, userId: string, key: QuotaKey): Promise<void> {
  const tier = await loadTier(admin, userId);
  if (remainingQuota(tier, key, 0) === null) return;

  const column = QUOTA_COLUMN[key];

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const usage = await loadOrResetUsage(admin, userId);
    if (!usage) {
      throw new Error("Impossible de vérifier ton quota pour le moment. Réessaie dans un instant.");
    }

    const current = (usage[column] as number | null) ?? 0;
    if (isQuotaExhausted(tier, key, current)) throw new QuotaExhaustedError(tier, key);

    const { data: updated } = await admin
      .from("usage")
      .update({ [column]: current + 1 })
      .eq("id", usage.id)
      .eq("period_start", usage.period_start)
      // La condition sur la valeur lue est ce qui rend l'incrément sûr :
      // une requête concurrente l'aura modifiée et aucune ligne ne reviendra.
      .eq(column, current)
      .select("id")
      .maybeSingle();

    if (updated) return;
  }

  // Contention persistante : refuser vaut mieux que laisser passer sans compter.
  throw new Error(
    "Ton quota n'a pas pu être décompté à cause d'un accès simultané. Réessaie dans un instant.",
  );
}

/**
 * Rend une unité de quota réservée mais finalement inutilisée.
 *
 * Sert quand l'opération payante échoue avant d'avoir rien coûté. Le décompte
 * ne descend jamais sous zéro, et un échec de restitution n'est pas propagé :
 * l'utilisateur voit déjà l'erreur d'origine, une seconde n'aiderait pas.
 */
export async function refundQuota(admin: Db, userId: string, key: QuotaKey): Promise<void> {
  const column = QUOTA_COLUMN[key];
  try {
    const usage = await loadOrResetUsage(admin, userId);
    if (!usage) return;
    const current = (usage[column] as number | null) ?? 0;
    if (current <= 0) return;
    await admin
      .from("usage")
      .update({ [column]: current - 1 })
      .eq("id", usage.id)
      .eq("period_start", usage.period_start)
      .eq(column, current);
  } catch {
    /* la restitution est un confort, jamais une garantie */
  }
}
