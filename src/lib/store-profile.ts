/**
 * Profil économique d'une boutique — source unique de vérité pour la saisie des
 * champs consommés par l'audit (`audit.functions.ts`) et le cockpit (`cockpit.functions.ts`).
 *
 * Contrat critique : `avg_product_cost_ratio` est stocké en RATIO (0 → 1), alors que
 * l'utilisateur raisonne en POURCENTAGE (0 → 100). La conversion vit ici, et nulle part
 * ailleurs : `cockpit.functions.ts` calcule `revenue * (1 - ratio)`, une valeur de 40
 * au lieu de 0.4 produirait une marge de -39 × le chiffre d'affaires.
 */
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

export type StoreSituation = Database["public"]["Enums"]["store_situation"];
export type ExperienceLevel = Database["public"]["Enums"]["experience_level"];

type Choice<T extends string> = {
  value: T;
  label: string;
  description: string;
};

/**
 * Typé en `Record<StoreSituation, …>` volontairement : si l'enum SQL évolue, la
 * compilation casse ici au lieu de laisser une option silencieusement absente de l'UI.
 */
const SITUATION_META: Record<StoreSituation, Omit<Choice<StoreSituation>, "value">> = {
  no_sales: {
    label: "Je n'ai pas encore de vente",
    description: "Ma boutique est en ligne, mais rien ne se vend.",
  },
  few_sales: {
    label: "J'ai quelques ventes",
    description: "Ça démarre, mais c'est irrégulier et ça ne décolle pas.",
  },
  plateau: {
    label: "Mon chiffre d'affaires stagne",
    description: "Je vends régulièrement, mais je plafonne depuis un moment.",
  },
  not_profitable: {
    label: "Je vends, mais je ne gagne pas d'argent",
    description: "Le chiffre d'affaires rentre, la rentabilité non.",
  },
};

const EXPERIENCE_META: Record<ExperienceLevel, Omit<Choice<ExperienceLevel>, "value">> = {
  debutant: {
    label: "Débutant",
    description: "Je découvre l'e-commerce. Explique-moi tout simplement.",
  },
  intermediaire: {
    label: "Intermédiaire",
    description: "Je connais les bases : ROAS, panier moyen, coût d'acquisition.",
  },
  avance: {
    label: "Avancé",
    description: "Je suis à l'aise avec les chiffres et les outils publicitaires.",
  },
};

const SITUATION_VALUES = ["no_sales", "few_sales", "plateau", "not_profitable"] as const;
const EXPERIENCE_VALUES = ["debutant", "intermediaire", "avance"] as const;

export const SITUATION_CHOICES: ReadonlyArray<Choice<StoreSituation>> = SITUATION_VALUES.map(
  (value) => ({ value, ...SITUATION_META[value] }),
);

export const EXPERIENCE_CHOICES: ReadonlyArray<Choice<ExperienceLevel>> = EXPERIENCE_VALUES.map(
  (value) => ({ value, ...EXPERIENCE_META[value] }),
);

export const DEFAULT_EXPERIENCE_LEVEL: ExperienceLevel = "debutant";

/** Pourcentage saisi par l'utilisateur (0-100) → ratio stocké en base (0-1). */
export function percentToRatio(percent: number): number {
  return percent / 100;
}

/** Ratio stocké en base (0-1) → pourcentage affiché à l'utilisateur (0-100). */
export function ratioToPercent(ratio: number): number {
  return Math.round(ratio * 100);
}

/** État du formulaire : tout en chaînes, une chaîne vide signifie « non renseigné ». */
export type StoreEconomicsForm = {
  situation: StoreSituation | "";
  revenueGoal: string;
  costPercent: string;
  fixedCostsMonthly: string;
};

/** Charge utile prête pour Supabase : `null` partout où l'utilisateur n'a rien saisi. */
export type StoreEconomicsPayload = {
  situation: StoreSituation | null;
  revenue_goal: number | null;
  avg_product_cost_ratio: number | null;
  fixed_costs_monthly: number | null;
};

export const EMPTY_STORE_ECONOMICS: StoreEconomicsForm = {
  situation: "",
  revenueGoal: "",
  costPercent: "",
  fixedCostsMonthly: "",
};

const optionalAmount = (label: string) =>
  z
    .string()
    .trim()
    .transform((raw) => (raw === "" ? null : Number(raw)))
    .refine((value) => value === null || (Number.isFinite(value) && value >= 0), {
      message: `${label} : indique un montant positif, ou laisse le champ vide.`,
    });

const optionalPercent = z
  .string()
  .trim()
  .transform((raw) => (raw === "" ? null : Number(raw)))
  .refine((value) => value === null || (Number.isFinite(value) && value >= 0 && value <= 100), {
    message: "Coût produit moyen : indique un pourcentage entre 0 et 100, ou laisse le champ vide.",
  });

const optionalSituation = z
  .union([z.enum(SITUATION_VALUES), z.literal("")])
  .transform((value) => (value === "" ? null : value));

export const storeEconomicsSchema = z
  .object({
    situation: optionalSituation,
    revenueGoal: optionalAmount("Objectif de chiffre d'affaires"),
    costPercent: optionalPercent,
    fixedCostsMonthly: optionalAmount("Charges fixes"),
  })
  .transform((form): StoreEconomicsPayload => ({
    situation: form.situation,
    revenue_goal: form.revenueGoal,
    avg_product_cost_ratio: form.costPercent === null ? null : percentToRatio(form.costPercent),
    fixed_costs_monthly: form.fixedCostsMonthly,
  }));

/** Valide le formulaire et renvoie la charge utile Supabase, ou le premier message d'erreur. */
export function parseStoreEconomics(
  form: StoreEconomicsForm,
): { ok: true; payload: StoreEconomicsPayload } | { ok: false; message: string } {
  const result = storeEconomicsSchema.safeParse(form);
  if (result.success) return { ok: true, payload: result.data };
  const message = result.error.issues[0]?.message ?? "Certaines valeurs saisies sont invalides.";
  return { ok: false, message };
}

/** Ligne `stores` (partielle) → état de formulaire, pour l'écran d'édition. */
export function storeEconomicsToForm(store: {
  situation: StoreSituation | null;
  revenue_goal: number | null;
  avg_product_cost_ratio: number | null;
  fixed_costs_monthly: number | null;
}): StoreEconomicsForm {
  return {
    situation: store.situation ?? "",
    revenueGoal: store.revenue_goal != null ? String(store.revenue_goal) : "",
    costPercent:
      store.avg_product_cost_ratio != null
        ? String(ratioToPercent(store.avg_product_cost_ratio))
        : "",
    fixedCostsMonthly: store.fixed_costs_monthly != null ? String(store.fixed_costs_monthly) : "",
  };
}
