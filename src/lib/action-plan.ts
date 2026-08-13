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
  | { kind: "proposal"; proposal: ActionProposal }
  | { kind: "no_action"; reason: string };

export function isProposalExpired(expiresAt: string, now = Date.now()): boolean {
  const deadline = new Date(expiresAt).getTime();
  return !Number.isFinite(deadline) || now > deadline;
}

export function revertibilityNotice(tool: string): string {
  return isRevertible(tool)
    ? "Tu pourras annuler cette action et revenir à l'état précédent."
    : "Cette action ne pourra pas être annulée automatiquement : il faudra revenir en arrière à la main dans ton compte.";
}
