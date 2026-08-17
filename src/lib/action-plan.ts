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

// ---------------------------------------------------------------------------
// Issue réelle d'une écriture — distincte de l'intention de l'écrire
// ---------------------------------------------------------------------------

/**
 * Où en est l'appel partenaire.
 *
 * Le verrou d'idempotence bascule la ligne en `applied` AVANT d'appeler Shopify,
 * Meta ou Google : c'est la seule façon d'empêcher deux exécutions simultanées.
 * Mais entre ce basculement et la réponse du partenaire, l'issue est inconnue —
 * et un worker peut mourir exactement là.
 */
export type ActionRunState = "reserve" | "ecrit" | "echoue";

/**
 * Au-delà de ce délai, une écriture encore « réservée » n'est plus en vol : le
 * processus qui la portait a disparu. Généreux à dessein — une collecte d'état
 * suivie d'un appel d'écriture peut être lente, et déclarer trop tôt une issue
 * inconnue serait une fausse alerte.
 */
export const EXECUTION_UNKNOWN_AFTER_MINUTES = 5;

export type ExecutionOutcome =
  /** En attente de confirmation. Rien n'est parti. */
  | "proposee"
  /** Verrou posé, appel partenaire en vol. */
  | "en_cours"
  /** Réservée depuis trop longtemps : on ignore si l'écriture a abouti. */
  | "issue_inconnue"
  /** Le partenaire a répondu, le résultat est consigné. */
  | "appliquee"
  | "echouee"
  | "annulee";

/**
 * Issue d'une action, telle qu'on a le droit de l'annoncer.
 *
 * `run_state` à `null` désigne une ligne écrite avant l'introduction de la
 * colonne : l'ancien code ne connaissait que `applied` après retour du
 * partenaire, donc ces lignes sont bien appliquées.
 */
export function executionOutcome(
  row: {
    status: "proposed" | "applied" | "failed" | "reverted";
    run_state?: ActionRunState | string | null;
    updated_at?: string | null;
  },
  now = Date.now(),
): ExecutionOutcome {
  if (row.status === "proposed") return "proposee";
  if (row.status === "failed") return "echouee";
  if (row.status === "reverted") return "annulee";

  if (row.run_state === "echoue") return "echouee";
  if (row.run_state !== "reserve") return "appliquee";

  const since = row.updated_at ? new Date(row.updated_at).getTime() : Number.NaN;
  // Horodatage illisible : on ne suppose pas que l'appel est encore en vol.
  if (!Number.isFinite(since)) return "issue_inconnue";
  return now - since < EXECUTION_UNKNOWN_AFTER_MINUTES * 60_000 ? "en_cours" : "issue_inconnue";
}

/** Ce qu'on dit au marchand, sans jamais présenter une issue inconnue comme un succès. */
export function executionNotice(outcome: ExecutionOutcome, targetLabel: string | null): string {
  const cible = targetLabel ? ` sur ${targetLabel}` : "";
  switch (outcome) {
    case "proposee":
      return "Proposée, pas encore appliquée. Rien n'a été modifié.";
    case "en_cours":
      return `Application en cours${cible}. Attendez la fin avant de relancer.`;
    case "issue_inconnue":
      return `Je ne sais pas si cette correction${cible} est partie : l'exécution a été interrompue avant que le résultat nous revienne. Vérifiez dans votre compte avant de relancer — nous ne rejouons rien tout seuls, au risque de l'appliquer deux fois.`;
    case "appliquee":
      return "Appliquée sur votre compte.";
    case "echouee":
      return "Échec : rien n'a été modifié.";
    case "annulee":
      return "Annulée, l'état précédent a été rétabli.";
  }
}

/** Une issue inconnue ne se rejoue pas, et ne s'annule pas non plus. */
export function isSettledExecution(outcome: ExecutionOutcome): boolean {
  return outcome !== "en_cours" && outcome !== "issue_inconnue";
}

// ---------------------------------------------------------------------------
// Décisions de confirmation et d'annulation
// ---------------------------------------------------------------------------

export type ActionDecision = { ok: true } | { ok: false; reason: string };

/**
 * Peut-on exécuter cette proposition ?
 *
 * `alreadyAppliedOnFinding` est la barrière qui manquait. La vérification de
 * fraîcheur compare l'état amont à celui montré dans l'aperçu, ce qui suffit
 * pour tout ce qui ÉCRASE un état existant : une seconde confirmation trouve un
 * état modifié et refuse. Mais une action ADDITIVE n'écrase rien —
 * `create_discount_code` a un état antérieur nul, `google_add_negative_keywords`
 * un état vide — donc la comparaison passe toujours. Deux propositions faites
 * sur le même problème, dans deux onglets, créaient deux codes promo.
 */
export function canConfirmProposal(input: {
  status: "proposed" | "applied" | "failed" | "reverted";
  hasFindingId: boolean;
  expiresAt?: string | null;
  alreadyAppliedOnFinding: boolean;
  now?: number;
}): ActionDecision {
  if (input.status !== "proposed") {
    return {
      ok: false,
      reason:
        input.status === "applied"
          ? "Cette correction a déjà été appliquée."
          : "Cette proposition n'est plus applicable. Relancez la correction.",
    };
  }
  if (!input.hasFindingId) {
    return { ok: false, reason: "Proposition incomplète : problème d'origine inconnu." };
  }
  if (input.expiresAt && isProposalExpired(input.expiresAt, input.now ?? Date.now())) {
    return {
      ok: false,
      reason: `Cette proposition a plus de ${PROPOSAL_TTL_MINUTES} minutes : l'état de votre compte a pu changer. Relancez la correction.`,
    };
  }
  if (input.alreadyAppliedOnFinding) {
    return {
      ok: false,
      reason:
        "Une correction a déjà été appliquée sur ce problème. Je n'en applique pas une seconde par-dessus : annulez la première si vous voulez repartir de l'état d'origine.",
    };
  }
  return { ok: true };
}

/** Peut-on annuler cette action ? Une issue inconnue n'est jamais annulable. */
export function canRevertAction(input: {
  status: "proposed" | "applied" | "failed" | "reverted";
  run_state?: ActionRunState | string | null;
  updated_at?: string | null;
  hasFindingId: boolean;
  now?: number;
}): ActionDecision {
  if (input.status !== "applied") {
    return {
      ok: false,
      reason:
        input.status === "reverted"
          ? "Cette correction a déjà été annulée."
          : "Cette action n'a pas été appliquée : il n'y a rien à annuler.",
    };
  }
  const outcome = executionOutcome(input, input.now ?? Date.now());
  if (outcome !== "appliquee") {
    return { ok: false, reason: executionNotice(outcome, null) };
  }
  if (!input.hasFindingId) {
    return { ok: false, reason: "Action incomplète : problème d'origine inconnu." };
  }
  return { ok: true };
}

export function revertibilityNotice(tool: string): string {
  return isRevertible(tool)
    ? "Vous pourrez annuler cette action et revenir à l'état précédent."
    : "Cette action ne pourra pas être annulée automatiquement : il faudra revenir en arrière à la main dans votre compte.";
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
