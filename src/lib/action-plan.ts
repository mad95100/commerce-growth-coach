/**
 * Contrat partagé serveur ↔ client d'une action automatique proposée.
 *
 * Module pur : types, libellés et règles de réversibilité. Aucune I/O, aucun
 * secret. Il est importé aussi bien par les server functions que par l'UI.
 */

export type ActionChannel = "shopify" | "meta_ads" | "google_ads";

export const CHANNEL_LABELS: Record<ActionChannel, string> = {
  shopify: "Shopify",
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
};

/** Durée de validité d'une proposition. Au-delà, l'état amont a pu bouger. */
export const PROPOSAL_TTL_MINUTES = 30;

/**
 * Réversibilité ANNONCÉE dans l'aperçu, avant l'écriture.
 *
 * C'est une estimation volontairement prudente : on ne promet `true` que si
 * l'information nécessaire à l'annulation est connue d'avance et fiable. La
 * réversibilité RÉELLE est constatée après l'appel API et réécrite dans
 * `actions.revertible` — mieux vaut sous-promettre ici et confirmer ensuite.
 *
 * - `google_add_negative_keywords` reste `false` ici : l'annulation dépend des
 *   `resourceName` renvoyés par la réponse de création, inconnus avant l'appel.
 *   Elle passe à `true` après coup si ces références ont bien été obtenues.
 * - `meta_update_targeting` : `before_value` ne contient qu'un résumé textuel du
 *   ciblage, pas l'objet complet — l'état exact n'est pas rétablissable.
 * - `meta_update_creative` : l'ancienne création est tracée, mais rien ne garantit
 *   qu'une création détachée reste rattachable.
 * - `google_update_rsa` : la mutabilité d'une annonce servie n'est pas démontrée.
 */
export const REVERTIBLE_BY_TOOL: Record<string, boolean> = {
  update_product: true,
  create_discount_code: true,
  meta_update_budget: true,
  meta_pause_adset: true,
  google_update_budget: true,
  google_pause_campaign: true,
  google_add_negative_keywords: false,
  meta_update_targeting: false,
  meta_update_creative: false,
  google_update_rsa: false,
};

export function isRevertible(tool: string): boolean {
  return REVERTIBLE_BY_TOOL[tool] === true;
}

/** Une ligne d'aperçu « avant → après ». `before` à null = rien n'existait avant. */
export type PreviewLine = {
  label: string;
  before: string | null;
  after: string;
};

/** Ce que le serveur renvoie au client après une proposition. Aucun secret. */
export type ActionProposal = {
  actionId: string;
  tool: string;
  channel: ActionChannel;
  /** Titre court de l'action, ex. « Réécrire la fiche produit ». */
  title: string;
  /** Cible nommée, ex. « Ensemble de publicités "Retargeting FR" ». */
  targetLabel: string;
  /** Justification donnée par l'IA. */
  reason: string;
  revertible: boolean;
  lines: PreviewLine[];
  expiresAt: string;
};

/** Réponse d'une proposition : soit une action à confirmer, soit rien à faire. */
export type ProposeOutcome =
  { kind: "proposal"; proposal: ActionProposal } | { kind: "no_action"; reason: string };

/**
 * Sérialisation déterministe : clés d'objet triées, ordre des tableaux préservé.
 *
 * `before_value` transite par une colonne `jsonb`, qui ne conserve pas l'ordre
 * d'insertion des clés. Comparer deux états avec `JSON.stringify` produisait donc
 * de faux « l'état a changé » — constaté sur `meta_update_creative`, dont les clés
 * `primary_text` / `headline` ressortent inversées de la base.
 *
 * Les mêmes conventions que `JSON.stringify` sont conservées pour rester fidèle au
 * transport JSON : une propriété `undefined` est omise, un `undefined` dans un
 * tableau devient `null`.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    // L'ordre d'un tableau est porteur de sens (titres RSA, mots-clés) : jamais trié.
    return `[${value.map((item) => (item === undefined ? "null" : stableStringify(item))).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(",")}}`;
}

/**
 * Deux états d'une cible sont-ils identiques ?
 *
 * Indépendant de l'ordre des clés, mais strictement sensible aux valeurs : une
 * vraie modification de l'état amont reste détectée et refusée.
 */
export function sameActionState(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

export function isProposalExpired(expiresAt: string, now = Date.now()): boolean {
  const deadline = new Date(expiresAt).getTime();
  return !Number.isFinite(deadline) || now > deadline;
}

export function revertibilityNotice(tool: string): string {
  return isRevertible(tool)
    ? "Tu pourras annuler cette action et revenir à l'état précédent."
    : "Cette action ne pourra pas être annulée automatiquement : il faudra revenir en arrière à la main dans ton compte.";
}

/**
 * Clés monétaires héritées, renommées quand les devises sont devenues explicites.
 *
 * `daily_budget_eur` supposait l'euro alors qu'aucune conversion n'avait jamais
 * lieu : la valeur était déjà dans la devise du compte publicitaire. La clé
 * s'appelle désormais `daily_budget`.
 *
 * Les lignes `actions` écrites avant ce changement portent encore l'ancienne
 * clé. Elles doivent rester annulables et leur état rester comparable : sans
 * cette normalisation, la vérification de fraîcheur comparerait
 * `{daily_budget_eur: 20}` à `{daily_budget: 20}` et refuserait à tort.
 *
 * On lit les deux formes, on n'écrit plus que la nouvelle.
 */
const LEGACY_MONEY_KEYS: Record<string, string> = {
  daily_budget_eur: "daily_budget",
};

export function normalizeLegacyStateKeys<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(normalizeLegacyStateKeys) as unknown as T;

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const renamed = LEGACY_MONEY_KEYS[key];
    // Une clé déjà présente sous son nom actuel n'est jamais écrasée par
    // l'ancienne : la valeur récente fait foi.
    if (renamed && renamed in (value as Record<string, unknown>)) continue;
    out[renamed ?? key] = normalizeLegacyStateKeys(nested);
  }
  return out as T;
}
