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
import { formatMoney } from "@/lib/currency";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Bornes (arbitrées avec le porteur du produit)
// ---------------------------------------------------------------------------

/**
 * DEVISE DES SEUILS CI-DESSOUS.
 *
 * Ces bornes s'appliquent aux montants tels que la plateforme publicitaire les
 * renvoie, donc DANS LA DEVISE DU COMPTE PUBLICITAIRE. Elles portaient le
 * suffixe `_EUR`, ce qui laissait croire à une conversion inexistante : aucune
 * conversion n'a jamais eu lieu, la comparaison se faisait déjà sur le nombre
 * brut, quelle que soit la devise du compte.
 *
 * Le suffixe est donc retiré et la devise remontée jusqu'aux messages, pour que
 * l'utilisateur lise « minimum 5 USD » et non un montant sans unité. Convertir
 * ces seuils demanderait un taux de change, dont le produit ne dispose pas.
 */

/** Budget quotidien minimum, tous canaux publicitaires, dans la devise du compte. */
export const BUDGET_FLOOR = 5;
/** Plafond absolu d'une AUGMENTATION de budget quotidien, dans la devise du compte. */
export const BUDGET_ABSOLUTE_CAP = 100;
/** Une augmentation ne peut jamais dépasser ce multiple du budget actuel. Sans unité. */
export const BUDGET_MAX_MULTIPLIER = 2;
/** Dépense minimale sur 30 jours sous laquelle une pause est refusée, dans la devise du compte. */
export const PAUSE_MIN_SPEND = 50;

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
    daily_budget: numberish,
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
    daily_budget: numberish,
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

/**
 * Formate un montant dans la devise du compte concerné.
 *
 * Devise inconnue : le montant est affiché suivi de la mention explicite, pour
 * qu'aucun message ne laisse croire à une devise qui n'a pas été constatée.
 */
function amount(value: number, currency: string | null): string {
  return formatMoney(value, currency);
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
  /** Devise du compte publicitaire, code ISO 4217, ou `null` si indéterminée. */
  currency: string | null;
  requested: number;
  currentDailyBudget: number | null | undefined;
}): GuardResult<number> {
  const { targetLabel, requested, currentDailyBudget, currency } = input;

  if (!Number.isFinite(requested)) {
    return refuse(`Budget proposé illisible pour ${targetLabel}. Rien n'a été modifié.`);
  }

  if (
    currentDailyBudget == null ||
    !Number.isFinite(currentDailyBudget) ||
    currentDailyBudget <= 0
  ) {
    return refuse(
      `Je ne connais pas le budget quotidien actuel de ${targetLabel} : je ne modifie pas un budget à l'aveugle. Rien n'a été modifié.`,
    );
  }

  if (requested < BUDGET_FLOOR) {
    return refuse(
      `Budget proposé trop bas pour ${targetLabel} (${amount(requested, currency)}/jour, minimum ${amount(BUDGET_FLOOR, currency)}). Rien n'a été modifié.`,
    );
  }

  const increaseCap = Math.min(currentDailyBudget * BUDGET_MAX_MULTIPLIER, BUDGET_ABSOLUTE_CAP);
  const cap = Math.max(currentDailyBudget, increaseCap);

  if (requested > cap) {
    return refuse(
      `Hausse de budget refusée sur ${targetLabel} : ${amount(requested, currency)}/jour demandés alors que le budget actuel est de ${amount(currentDailyBudget, currency)}/jour. Le maximum autorisé est ${amount(cap, currency)}/jour (×${BUDGET_MAX_MULTIPLIER} du budget actuel, plafonné à ${amount(BUDGET_ABSOLUTE_CAP, currency)}). Rien n'a été modifié.`,
    );
  }

  return allow(requested);
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
  /** Devise du compte publicitaire, code ISO 4217, ou `null` si indéterminée. */
  currency: string | null;
  spend: number | null | undefined;
  roas: number | null | undefined;
}): GuardResult<{ spend: number; roas: number }> {
  const { targetLabel, spend, roas, currency } = input;

  if (spend == null || !Number.isFinite(spend)) {
    return refuse(
      `Je n'ai pas les chiffres de dépense de ${targetLabel} : je ne mets pas un ensemble de publicités en pause sans preuve qu'il perd de l'argent. Rien n'a été modifié.`,
    );
  }

  if (spend < PAUSE_MIN_SPEND) {
    return refuse(
      `${targetLabel} n'a dépensé que ${amount(spend, currency)} sur 30 jours : c'est trop peu pour conclure. Il faut au moins ${amount(PAUSE_MIN_SPEND, currency)} de dépense avant de couper. Rien n'a été modifié.`,
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
  /** Devise du compte publicitaire, code ISO 4217, ou `null` si indéterminée. */
  currency: string | null;
  cost30d: number | null | undefined;
  conversions30d: number | null | undefined;
}): GuardResult<{ cost: number; conversions: number }> {
  const { targetLabel, cost30d, conversions30d, currency } = input;

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

  if (cost30d < PAUSE_MIN_SPEND) {
    return refuse(
      `${targetLabel} n'a coûté que ${amount(cost30d, currency)} sur 30 jours : c'est trop peu pour conclure. Il faut au moins ${amount(PAUSE_MIN_SPEND, currency)} avant de couper. Rien n'a été modifié.`,
    );
  }

  if (conversions30d !== 0) {
    return refuse(
      `${targetLabel} a généré ${conversions30d} conversion(s) sur 30 jours : je ne coupe pas une campagne qui convertit. Rien n'a été modifié.`,
    );
  }

  return allow({ cost: cost30d, conversions: conversions30d });
}

/**
 * Budget quotidien RÉTABLI par une annulation.
 *
 * Le défaut corrigé ici : `guardDailyBudget` refuse toute hausse au-delà de
 * `BUDGET_ABSOLUTE_CAP`. Or une annulation qui rétablit un budget que le
 * marchand avait lui-même fixé au-dessus de ce plafond est vue comme une hausse
 * interdite. Concrètement, une campagne à 120/jour ramenée à 60 par EcomPilot ne
 * pouvait plus jamais remonter à 120 — alors que l'aperçu avait promis « tu
 * pourras annuler cette action et revenir à l'état précédent ».
 *
 * Rétablir un état qu'on a soi-même écrasé n'est pas une hausse de budget :
 * c'est rendre au marchand ce qui était à lui. Le plancher produit ne s'y
 * applique pas non plus — si son budget valait 3 avant notre écriture, le
 * remettre à 3 restaure SON choix.
 *
 * Ne subsiste qu'un garde-fou d'aberration : la valeur doit être un nombre fini
 * strictement positif, et rester sous une borne haute au-delà de laquelle on
 * refuse plutôt que d'écrire un montant manifestement corrompu.
 */
export const BUDGET_RESTORE_SANITY_CAP = 10_000;

export function guardRestoreBudget(input: {
  targetLabel: string;
  currency: string | null;
  previousDailyBudget: number;
}): GuardResult<number> {
  const { targetLabel, previousDailyBudget, currency } = input;

  if (!Number.isFinite(previousDailyBudget) || previousDailyBudget <= 0) {
    return refuse(
      `Le budget précédent de ${targetLabel} n'a pas été enregistré : je ne peux pas le rétablir à l'aveugle. Rien n'a été modifié.`,
    );
  }

  if (previousDailyBudget > BUDGET_RESTORE_SANITY_CAP) {
    return refuse(
      `Le budget à rétablir sur ${targetLabel} (${amount(previousDailyBudget, currency)}/jour) est aberrant : je refuse de l'écrire. Rétablissez-le à la main dans votre compte. Rien n'a été modifié.`,
    );
  }

  return allow(previousDailyBudget);
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

// ---------------------------------------------------------------------------
// Annulation — validation de ce qui est relu depuis la table `actions`
// ---------------------------------------------------------------------------

/**
 * `before_value` et `after_value` relus depuis la table `actions` sont validés
 * par schéma avant d'être réécrits chez le partenaire.
 *
 * Depuis le durcissement RLS, `actions` n'est plus modifiable depuis un
 * navigateur : ces colonnes sont nos propres écritures, pas des entrées
 * utilisateur. La validation reste, en défense en profondeur — une annulation
 * de budget rejoue une ÉCRITURE réelle, et une valeur corrompue en base ne doit
 * pas devenir un montant écrit sur un compte publicitaire.
 *
 * Les statuts sont restreints aux seules valeurs qu'on s'autorise à écrire : un
 * ensemble archivé ou une campagne supprimée ne sont pas rétablis par nos soins.
 */
const REVERT_SCHEMAS = {
  update_product: z.object({
    /**
     * `body_html` accepte le vide, et c'est essentiel : la correction Shopify la
     * plus fréquente réécrit une fiche QUI N'AVAIT PAS DE DESCRIPTION. Avec un
     * schéma exigeant un texte non vide, l'état antérieur — vide — était jugé
     * invalide et l'annulation refusée. L'aperçu promettait une réversibilité
     * que le produit ne savait pas tenir, précisément sur son cas nominal.
     *
     * Le titre, lui, reste obligatoire : Shopify refuse un produit sans titre,
     * et aucune fiche n'a jamais eu un titre vide avant notre écriture.
     */
    before: z.object({
      title: text(255),
      body_html: z.union([z.string(), z.null(), z.undefined()]).transform((value) => value ?? ""),
    }),
  }),
  create_discount_code: z.object({
    after: z.object({ price_rule_id: positiveId }),
  }),
  meta_update_budget: z.object({
    before: z.object({ daily_budget: numberish }),
  }),
  meta_pause_adset: z.object({
    before: z.object({ status: z.enum(["ACTIVE", "PAUSED"]) }),
  }),
  google_update_budget: z.object({
    before: z.object({ daily_budget: numberish }),
  }),
  google_pause_campaign: z.object({
    before: z.object({ status: z.enum(["ENABLED", "PAUSED"]) }),
  }),
  google_add_negative_keywords: z.object({
    after: z.object({
      criteria_resource_names: z.array(z.string().trim().min(1)).min(1),
    }),
  }),
} as const;

export type RevertableTool = keyof typeof REVERT_SCHEMAS;
export type RevertPayload<N extends RevertableTool> = z.infer<(typeof REVERT_SCHEMAS)[N]>;

export function isRevertableTool(name: string): name is RevertableTool {
  return Object.prototype.hasOwnProperty.call(REVERT_SCHEMAS, name);
}

/** Valide les valeurs `before_value` / `after_value` nécessaires à une annulation. */
export function parseRevertPayload<N extends RevertableTool>(
  name: N,
  payload: { before: unknown; after: unknown },
): GuardResult<RevertPayload<N>> {
  const parsed = REVERT_SCHEMAS[name].safeParse(payload);
  if (parsed.success) return allow(parsed.data as RevertPayload<N>);
  const detail = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "(racine)"} : ${issue.message}`)
    .join(" ; ");
  return refuse(
    `Les informations nécessaires à l'annulation sont incomplètes ou invalides (${name}) : ${detail}. Rien n'a été modifié.`,
  );
}

/** Cible désignée par l'IA introuvable dans l'état réel du canal : on n'écrit pas à l'aveugle. */
export function guardTargetExists<T>(target: T | null | undefined, label: string): GuardResult<T> {
  if (target == null) {
    return refuse(
      `${label} est introuvable dans votre compte : l'IA a visé une cible qui n'existe plus. Rien n'a été modifié — relancez la correction.`,
    );
  }
  return allow(target);
}
