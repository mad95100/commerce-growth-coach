/**
 * Plans et quotas.
 *
 * Module pur, sans entrées-sorties : il définit ce qu'un plan autorise, et rien
 * d'autre. La lecture en base et le décompte vivent dans `billing.server.ts`,
 * pour que ces règles restent vérifiables isolément.
 *
 * LE MODÈLE VIENT DU SCHÉMA, PAS D'UNE INVENTION. La base définit déjà
 * `plan_tier: "free" | "pro"` et une table `usage` comptant exactement trois
 * choses : `audits_used`, `fixes_used`, `coach_messages_used`. Ni l'une ni
 * l'autre n'était lue par le code : le modèle existait, l'application non.
 *
 * AUCUNE MIGRATION. Ces tables et cet enum existent déjà ; rien n'est ajouté
 * au schéma.
 */

/** Les deux niveaux définis par l'enum `plan_tier` en base. */
export type PlanTier = "free" | "pro";

/** Les trois compteurs de la table `usage`. */
export type QuotaKey = "audits" | "fixes" | "coach_messages";

/** Colonne de `usage` correspondant à chaque compteur. */
export const QUOTA_COLUMN = {
  audits: "audits_used",
  fixes: "fixes_used",
  coach_messages: "coach_messages_used",
} as const satisfies Record<QuotaKey, string>;

/** Nom lisible d'un compteur, pour les messages destinés à l'utilisateur. */
export const QUOTA_LABELS: Record<QuotaKey, string> = {
  audits: "audits",
  fixes: "corrections",
  coach_messages: "messages au coach",
};

export const PLAN_LABELS: Record<PlanTier, string> = {
  free: "Gratuit",
  pro: "Pro",
};

/**
 * PRIX DU PLAN PAYANT.
 *
 * EN CENTIMES, ET C'EST LA SEULE FORME ADMISE. Un prix en nombre à virgule
 * (`24.99`) se compare et s'additionne faux : `0.1 + 0.2 !== 0.3` en virgule
 * flottante, et c'est exactement le genre de défaut qui produit un écart d'un
 * centime entre ce que l'écran annonce et ce qui est prélevé. Stripe attend
 * d'ailleurs des centimes entiers — la conversion se fait à l'affichage, dans
 * ce sens uniquement.
 *
 * LA DEVISE EST PORTÉE ICI, PAS SUPPOSÉE. Le reste du produit refuse
 * catégoriquement une devise par défaut (`currency.ts`) ; un prix nu, sans sa
 * devise, serait la seule exception — et elle serait sur l'écran qui demande
 * de l'argent.
 *
 * CE FICHIER NE FAIT PAS AUTORITÉ SUR CE QUI EST PRÉLEVÉ. Le montant réellement
 * facturé est celui du tarif Stripe (`STRIPE_PRICE_ID`) : c'est lui que le
 * marchand voit sur la page de paiement et sur son relevé. Ces deux valeurs
 * DOIVENT coïncider, et rien ici ne peut le garantir — Stripe est la source de
 * vérité, ceci n'est que l'affichage. En cas de changement de prix, les deux
 * bougent ensemble, comme `APP_URL` et les URL de redirection OAuth.
 */
export const PLAN_PRICE = {
  /** Montant mensuel, en centimes. 2499 = 24,99. */
  amountCents: 2499,
  currency: "EUR",
} as const;

/** Le prix mensuel tel qu'il s'écrit sur un écran français. */
export function formattedPlanPrice(): string {
  const units = PLAN_PRICE.amountCents / 100;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: PLAN_PRICE.currency,
    minimumFractionDigits: 2,
  }).format(units);
}

/**
 * Limites mensuelles par plan. `null` signifie « sans limite ».
 *
 * CES NOMBRES SONT DES ARBITRAGES PRODUIT, pas des contraintes techniques. Ils
 * sont regroupés ici pour qu'un changement de politique tarifaire tienne en une
 * ligne, sans toucher au mécanisme. Ce sont des valeurs de départ raisonnables,
 * à ajuster : le plan gratuit doit laisser goûter le produit sans absorber le
 * coût des appels au modèle, qui sont facturés à l'usage.
 */
export const PLAN_LIMITS: Record<PlanTier, Record<QuotaKey, number | null>> = {
  free: {
    audits: 3,
    fixes: 5,
    coach_messages: 20,
  },
  pro: {
    audits: null,
    fixes: null,
    coach_messages: null,
  },
};

/**
 * Statuts d'abonnement qui donnent réellement droit au plan.
 *
 * Un abonnement `canceled` ou `past_due` porte encore `tier = "pro"` en base :
 * s'y fier accorderait le plan payant à quelqu'un qui ne paie plus.
 */
const ENTITLING_STATUSES = new Set(["active", "trialing"]);

/** Plan réellement accordé par une ligne d'abonnement, ou `free` à défaut. */
export function effectiveTier(
  subscription: { tier?: string | null; status?: string | null } | null | undefined,
): PlanTier {
  if (!subscription) return "free";
  if (!subscription.status || !ENTITLING_STATUSES.has(subscription.status)) return "free";
  return subscription.tier === "pro" ? "pro" : "free";
}

/**
 * PHASE DE TEST : LES COMPTEURS NE BLOQUENT PLUS.
 *
 * POURQUOI CE DRAPEAU EXISTE, ET POURQUOI IL EST ISOLÉ ICI. Le produit n'a ni
 * paiement ni offre payante ; le plafond de trois diagnostics par mois arrêtait
 * donc les essais du propriétaire sans qu'aucun encaissement ne soit possible en
 * face. Le désactiver en supprimant les plafonds aurait effacé l'architecture
 * qui les porte — et il faudrait la réécrire au moment de la facturation.
 *
 * Un seul interrupteur, un seul endroit. Le repasser à `false` rétablit
 * exactement le comportement d'avant : les plafonds sont intacts juste
 * au-dessus, les compteurs continuent d'être incrémentés, et l'affichage
 * continue de dire ce qui a été consommé. Seul le REFUS est suspendu.
 */
export const QUOTAS_SUSPENDUS_POUR_TEST = true;

/**
 * Limite mensuelle d'un compteur pour un plan. `null` = sans limite.
 *
 * Pendant la phase de test, rend `null` pour tous les compteurs : la
 * consommation reste comptée et affichée, elle ne refuse plus rien.
 */
export function quotaLimit(tier: PlanTier, key: QuotaKey): number | null {
  if (QUOTAS_SUSPENDUS_POUR_TEST) return null;
  return PLAN_LIMITS[tier][key];
}

/** Solde restant. `null` = sans limite. Jamais négatif. */
export function remainingQuota(tier: PlanTier, key: QuotaKey, used: number): number | null {
  const limit = quotaLimit(tier, key);
  if (limit === null) return null;
  return Math.max(0, limit - Math.max(0, used));
}

/** `true` si le compteur est épuisé pour ce plan. */
export function isQuotaExhausted(tier: PlanTier, key: QuotaKey, used: number): boolean {
  const limit = quotaLimit(tier, key);
  if (limit === null) return false;
  return Math.max(0, used) >= limit;
}

/**
 * Début de la période de décompte contenant `now` : le 1er du mois, en UTC.
 *
 * UTC et non l'heure locale : le serveur, la base et l'utilisateur peuvent être
 * dans trois fuseaux différents, et une période qui se réinitialise deux fois
 * ou pas du tout selon le fuseau serait un défaut de facturation.
 *
 * Renvoie une date au format `YYYY-MM-DD`, celui de la colonne.
 */
export function periodStart(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

/** `true` si la période stockée est celle en cours. Une valeur illisible vaut « périmée ». */
export function isCurrentPeriod(storedPeriodStart: string | null | undefined, now?: Date): boolean {
  if (!storedPeriodStart) return false;
  // La colonne peut revenir en `YYYY-MM-DD` ou en horodatage complet.
  return storedPeriodStart.slice(0, 10) === periodStart(now);
}

/** Message adressé à l'utilisateur quand un quota est épuisé. */
export function quotaExhaustedMessage(tier: PlanTier, key: QuotaKey): string {
  const limit = quotaLimit(tier, key);
  const what = QUOTA_LABELS[key];
  return (
    `Vous avez utilisé vos ${limit} ${what} du mois inclus dans le plan ${PLAN_LABELS[tier]}. ` +
    `Le compteur repart le 1er du mois prochain, ou passe au plan ${PLAN_LABELS.pro} pour ne plus en avoir.`
  );
}
