/**
 * Garde-fous serveur des écritures automatiques (Shopify / Meta Ads / Google Ads).
 *
 * Principe : le prompt système n'est PAS une barrière. Toute limite qui protège
 * l'argent de l'utilisateur est appliquée ici, en dur, côté serveur.
 *
 * Deux règles de conception, volontairement strictes :
 *  1. Aucun clamp silencieux d'une valeur dangereuse. Une valeur hors plage est
 *     REFUSÉE avec une explication, jamais ramenée en douce dans les bornes.
 *  2. Donnée manquante = refus. On ne coupe pas une campagne « au cas où », et on
 *     ne modifie pas un budget dont on ignore la valeur actuelle.
 *
 * Module pur : aucune I/O, aucun accès base, aucun appel réseau.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Bornes (arbitrées avec le porteur du produit)
// ---------------------------------------------------------------------------

/** Budget quotidien minimum, tous canaux publicitaires. */
export const BUDGET_FLOOR_EUR = 5;
/** Plafond absolu d'une AUGMENTATION de budget quotidien. */
export const BUDGET_ABSOLUTE_CAP_EUR = 100;
/** Une augmentation ne peut jamais dépasser ce multiple du budget actuel. */
export const BUDGET_MAX_MULTIPLIER = 2;
/** Dépense minimale sur 30 jours en dessous de laquelle une mise en pause est refusée. */
export const PAUSE_MIN_SPEND_EUR = 50;

export const DISCOUNT_MIN_PERCENT = 5;
export const DISCOUNT_MAX_PERCENT = 25;
export const DISCOUNT_MIN_DAYS = 3;
export const DISCOUNT_MAX_DAYS = 30;

export const RSA_MIN_HEADLINES = 3;
export const RSA_MAX_HEADLINES = 15;
export const RSA_MIN_DESCRIPTIONS = 2;
export const RSA_MAX_DESCRIPTIONS = 4;
export const RSA_HEADLINE_MAX_CHARS = 30;
export const RSA_DESCRIPTION_MAX_CHARS = 90;

export const MAX_NEGATIVE_KEYWORDS = 20;

// ---------------------------------------------------------------------------
// Résultat d'un garde-fou
// ---------------------------------------------------------------------------

export type GuardResult<T> = { ok: true; value: T } | { ok: false; reason: string };

function allow<T>(value: T): GuardResult<T> {
  return { ok: true, value };
}

function refuse<T>(reason: string): GuardResult<T> {
  return { ok: false, reason };
}

/** Déballe un garde-fou, ou lève une erreur porteuse du motif de refus. */
export function unwrapGuard<T>(result: GuardResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(result.reason);
}

// ---------------------------------------------------------------------------
// Schémas d'arguments, un par outil exposé à l'IA
// ---------------------------------------------------------------------------

/**
 * Les modèles renvoient parfois un nombre encodé en chaîne. On tolère l'encodage,
 * jamais la valeur : une chaîne vide ou non numérique est rejetée.
 */
const numberish = z
  .union([z.number(), z.string()])
  .transform((raw) => {
    if (typeof raw === "number") return raw;
    const trimmed = raw.trim();
    return trimmed === "" ? Number.NaN : Number(trimmed);
  })
  .refine((value) => Number.isFinite(value), { message: "nombre attendu" });

const positiveId = numberish.refine((value) => Number.isInteger(value) && value > 0, {
  message: "identifiant numérique positif attendu",
});

const ref = z.string().trim().min(1, "référence vide");
const text = (max?: number) => {
  const base = z.string().trim().min(1, "texte vide");
  return max ? base.max(max, `texte trop long (max ${max} caractères)`) : base;
};

/** Le résumé est cosmétique : son absence ne justifie pas de refuser une action sûre. */
const summary = z.string().trim().min(1).optional();

const TOOL_SCHEMAS = {
  update_product: z.object({
    product_id: positiveId,
    title: text(255),
    body_html: text(),
    summary,
  }),
  create_discount_code: z.object({
    title: text(255),
    code: z.string().trim().min(3, "code promo trop court").max(64, "code promo trop long"),
    percentage: numberish,
    days: numberish,
    summary,
  }),
  meta_update_budget: z.object({
    adset_id: ref,
    daily_budget_eur: numberish,
    summary,
  }),
  meta_pause_adset: z.object({
    adset_id: ref,
    summary,
  }),
  meta_update_targeting: z.object({
    adset_id: ref,
    age_min: numberish.optional(),
    age_max: numberish.optional(),
    genders: z.array(numberish).optional(),
    countries: z.array(z.string().trim().min(2).max(2)).optional(),
    summary,
  }),
  meta_update_creative: z.object({
    ad_id: ref,
    primary_text: text(),
    headline: text(255),
    description: text(255).optional(),
    summary,
  }),
  google_update_budget: z.object({
    budget_resource_name: ref,
    daily_budget_eur: numberish,
    summary,
  }),
  google_pause_campaign: z.object({
    campaign_resource_name: ref,
    summary,
  }),
  google_add_negative_keywords: z.object({
    campaign_resource_name: ref,
    keywords: z
      .array(z.string().trim().min(1))
      .min(1, "aucun mot-clé fourni")
      .max(MAX_NEGATIVE_KEYWORDS, `trop de mots-clés d'un coup (max ${MAX_NEGATIVE_KEYWORDS})`),
    summary,
  }),
  google_update_rsa: z.object({
    ad_group_ad_resource_name: ref,
    headlines: z
      .array(text(RSA_HEADLINE_MAX_CHARS))
      .min(RSA_MIN_HEADLINES, `au moins ${RSA_MIN_HEADLINES} titres attendus`)
      .max(RSA_MAX_HEADLINES, `au plus ${RSA_MAX_HEADLINES} titres`),
    descriptions: z
      .array(text(RSA_DESCRIPTION_MAX_CHARS))
      .min(RSA_MIN_DESCRIPTIONS, `au moins ${RSA_MIN_DESCRIPTIONS} descriptions attendues`)
      .max(RSA_MAX_DESCRIPTIONS, `au plus ${RSA_MAX_DESCRIPTIONS} descriptions`),
    summary,
  }),
  no_action: z.object({
    reason: text(),
  }),
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;
export type ToolArgs<N extends ToolName> = z.infer<(typeof TOOL_SCHEMAS)[N]>;

export function isKnownTool(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(TOOL_SCHEMAS, name);
}

/** Valide les arguments bruts renvoyés par le modèle pour un outil donné. */
export function parseToolArgs<N extends ToolName>(name: N, raw: unknown): GuardResult<ToolArgs<N>> {
  const parsed = TOOL_SCHEMAS[name].safeParse(raw);
  if (parsed.success) return allow(parsed.data as ToolArgs<N>);
  const detail = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "(racine)"} : ${issue.message}`)
    .join(" ; ");
  return refuse(
    `L'IA a proposé une action mal formée (${name}) : ${detail}. Rien n'a été modifié — relance la correction.`,
  );
}

// ---------------------------------------------------------------------------
// Garde-fous métier
// ---------------------------------------------------------------------------

function eur(value: number): string {
  return `${Math.round(value * 100) / 100} €`;
}

/**
 * Budget quotidien publicitaire.
 *
 * Le plafond ne s'applique qu'aux HAUSSES : une baisse en dessous du budget actuel
 * est toujours autorisée, même si ce budget dépasse déjà le plafond absolu — sinon
 * on empêcherait de réduire une campagne qui brûle du budget.
 */
export function guardDailyBudget(input: {
  targetLabel: string;
  requestedEur: number;
  currentDailyBudgetEur: number | null | undefined;
}): GuardResult<number> {
  const { targetLabel, requestedEur, currentDailyBudgetEur } = input;

  if (!Number.isFinite(requestedEur)) {
    return refuse(`Budget proposé illisible pour ${targetLabel}. Rien n'a été modifié.`);
  }

  if (
    currentDailyBudgetEur == null ||
    !Number.isFinite(currentDailyBudgetEur) ||
    currentDailyBudgetEur <= 0
  ) {
    return refuse(
      `Je ne connais pas le budget quotidien actuel de ${targetLabel} : je ne modifie pas un budget à l'aveugle. Rien n'a été modifié.`,
    );
  }

  if (requestedEur < BUDGET_FLOOR_EUR) {
    return refuse(
      `Budget proposé trop bas pour ${targetLabel} (${eur(requestedEur)}/jour, minimum ${eur(
        BUDGET_FLOOR_EUR,
      )}). Rien n'a été modifié.`,
    );
  }

  const increaseCap = Math.min(
    currentDailyBudgetEur * BUDGET_MAX_MULTIPLIER,
    BUDGET_ABSOLUTE_CAP_EUR,
  );
  const cap = Math.max(currentDailyBudgetEur, increaseCap);

  if (requestedEur > cap) {
    return refuse(
      `Hausse de budget refusée sur ${targetLabel} : ${eur(requestedEur)}/jour demandés alors que le budget actuel est de ${eur(
        currentDailyBudgetEur,
      )}/jour. Le maximum autorisé est ${eur(cap)}/jour (×${BUDGET_MAX_MULTIPLIER} du budget actuel, plafonné à ${eur(
        BUDGET_ABSOLUTE_CAP_EUR,
      )}). Rien n'a été modifié.`,
    );
  }

  return allow(requestedEur);
}

/**
 * Mise en pause d'un ensemble de publicités Meta.
 *
 * Inférence assumée : dans `fetchMetaSnapshot`, `spend` n'est renseigné que si une
 * ligne d'insights existe pour cet adset. Donc si la dépense est connue, l'absence
 * de `roas` signifie « aucun achat attribué », soit un ROAS de 0 — et non une
 * donnée manquante. Si la dépense elle-même est inconnue, on refuse.
 */
export function guardMetaPause(input: {
  targetLabel: string;
  spend: number | null | undefined;
  roas: number | null | undefined;
}): GuardResult<{ spend: number; roas: number }> {
  const { targetLabel, spend, roas } = input;

  if (spend == null || !Number.isFinite(spend)) {
    return refuse(
      `Je n'ai pas les chiffres de dépense de ${targetLabel} : je ne mets pas un ensemble de publicités en pause sans preuve qu'il perd de l'argent. Rien n'a été modifié.`,
    );
  }

  if (spend < PAUSE_MIN_SPEND_EUR) {
    return refuse(
      `${targetLabel} n'a dépensé que ${eur(spend)} sur 30 jours : c'est trop peu pour conclure. Il faut au moins ${eur(
        PAUSE_MIN_SPEND_EUR,
      )} de dépense avant de couper. Rien n'a été modifié.`,
    );
  }

  const effectiveRoas = roas != null && Number.isFinite(roas) ? roas : 0;

  if (effectiveRoas >= 1) {
    return refuse(
      `${targetLabel} rapporte plus qu'il ne coûte (ROAS ${effectiveRoas.toFixed(
        2,
      )}) : je ne le coupe pas. Rien n'a été modifié.`,
    );
  }

  return allow({ spend, roas: effectiveRoas });
}

/** Mise en pause d'une campagne Google Ads : coût significatif ET aucune conversion. */
export function guardGooglePause(input: {
  targetLabel: string;
  cost30d: number | null | undefined;
  conversions30d: number | null | undefined;
}): GuardResult<{ cost: number; conversions: number }> {
  const { targetLabel, cost30d, conversions30d } = input;

  if (cost30d == null || !Number.isFinite(cost30d)) {
    return refuse(
      `Je n'ai pas le coût de ${targetLabel} sur 30 jours : je ne mets pas une campagne en pause sans preuve. Rien n'a été modifié.`,
    );
  }

  if (conversions30d == null || !Number.isFinite(conversions30d)) {
    return refuse(
      `Je n'ai pas le nombre de conversions de ${targetLabel} : impossible de dire si elle est rentable. Rien n'a été modifié.`,
    );
  }

  if (cost30d < PAUSE_MIN_SPEND_EUR) {
    return refuse(
      `${targetLabel} n'a coûté que ${eur(cost30d)} sur 30 jours : c'est trop peu pour conclure. Il faut au moins ${eur(
        PAUSE_MIN_SPEND_EUR,
      )} avant de couper. Rien n'a été modifié.`,
    );
  }

  if (conversions30d !== 0) {
    return refuse(
      `${targetLabel} a généré ${conversions30d} conversion(s) sur 30 jours : je ne coupe pas une campagne qui convertit. Rien n'a été modifié.`,
    );
  }

  return allow({ cost: cost30d, conversions: conversions30d });
}

/** Code promo : remise et durée dans des bornes commercialement raisonnables. */
export function guardDiscount(input: {
  percentage: number;
  days: number;
}): GuardResult<{ percentage: number; days: number }> {
  const { percentage, days } = input;

  if (percentage < DISCOUNT_MIN_PERCENT || percentage > DISCOUNT_MAX_PERCENT) {
    return refuse(
      `Remise refusée : ${percentage} % demandés, alors que la fourchette autorisée est ${DISCOUNT_MIN_PERCENT}-${DISCOUNT_MAX_PERCENT} %. Aucun code promo n'a été créé.`,
    );
  }

  if (!Number.isInteger(days) || days < DISCOUNT_MIN_DAYS || days > DISCOUNT_MAX_DAYS) {
    return refuse(
      `Durée de promotion refusée : ${days} jour(s) demandés, alors que la fourchette autorisée est ${DISCOUNT_MIN_DAYS}-${DISCOUNT_MAX_DAYS} jours. Aucun code promo n'a été créé.`,
    );
  }

  return allow({ percentage, days });
}

/** Cible désignée par l'IA introuvable dans l'état réel du canal : on n'écrit pas à l'aveugle. */
export function guardTargetExists<T>(target: T | null | undefined, label: string): GuardResult<T> {
  if (target == null) {
    return refuse(
      `${label} est introuvable dans ton compte : l'IA a visé une cible qui n'existe plus. Rien n'a été modifié — relance la correction.`,
    );
  }
  return allow(target);
}
