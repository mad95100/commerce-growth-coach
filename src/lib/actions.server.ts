import { normalizeLegacyStateKeys } from "@/lib/action-plan";
/**
 * Journal des actions automatiques (table `actions`).
 *
 * Toute écriture externe est précédée d'une ligne `proposed` et suivie d'une
 * transition `applied` ou `failed`. Aucune action ne part sans laisser de trace.
 *
 * DEUX AXES, ET IL FAUT LES DISTINGUER. `status` est l'état du journal :
 * proposée, appliquée, échouée, annulée. `run_state` est l'issue de l'appel
 * partenaire lui-même. Le verrou d'idempotence bascule `status` en `applied`
 * AVANT d'appeler Shopify, Meta ou Google — sans quoi deux confirmations
 * simultanées écriraient deux fois. Pendant cet appel, l'issue est inconnue, et
 * c'est `run_state = 'reserve'` qui le dit. Une ligne qui reste dans cet état
 * n'a jamais le droit d'être présentée comme appliquée.
 *
 * Note de sécurité : depuis le durcissement RLS, `actions` n'est plus
 * modifiable depuis un navigateur — ses écritures passent par le rôle de
 * service. La re-validation intégrale faite par `executePlannedAction` avant
 * chaque écriture reste en place en défense en profondeur.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionChannel, ActionRunState, PreviewLine } from "@/lib/action-plan";

// Le client est fourni par la server function appelante. On ne le type pas plus
// finement ici, comme dans `tracking.server.ts` : la sécurité ne repose pas sur ce
// typage mais sur la RLS et sur la re-validation faite avant chaque écriture.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = SupabaseClient<any, any, any>;

export type ProposalRow = {
  id: string;
  store_id: string;
  finding_id: string | null;
  channel: ActionChannel;
  tool_name: string;
  title: string;
  reason: string | null;
  target_ref: string | null;
  target_label: string | null;
  before_value: Record<string, unknown> | null;
  after_value: Record<string, unknown> | null;
  payload: {
    raw_args?: unknown;
    lines?: PreviewLine[];
    baseline?: unknown;
    expected_gain_min?: number | null;
    expected_gain_max?: number | null;
    expires_at?: string;
  };
  revertible: boolean;
  status: "proposed" | "applied" | "failed" | "reverted";
  /** Issue de l'appel partenaire. `null` sur les lignes antérieures à la colonne. */
  run_state: ActionRunState | null;
  created_at: string;
  /** Maintenu par trigger : sur une ligne réservée, c'est l'instant de la réservation. */
  updated_at: string;
};

export async function insertProposal(
  supabase: Db,
  input: {
    storeId: string;
    findingId: string;
    channel: ActionChannel;
    toolName: string;
    title: string;
    reason: string;
    targetRef: string;
    targetLabel: string;
    beforeValue: Record<string, unknown> | null;
    afterValue: Record<string, unknown>;
    revertible: boolean;
    payload: ProposalRow["payload"];
  },
): Promise<ProposalRow> {
  const { data, error } = await supabase
    .from("actions")
    .insert({
      store_id: input.storeId,
      finding_id: input.findingId,
      channel: input.channel,
      actor: "ai",
      status: "proposed",
      tool_name: input.toolName,
      title: input.title,
      reason: input.reason,
      target_ref: input.targetRef,
      target_label: input.targetLabel,
      before_value: input.beforeValue,
      after_value: input.afterValue,
      revertible: input.revertible,
      payload: input.payload,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `Impossible d'enregistrer la proposition : ${error?.message ?? "erreur inconnue"}`,
    );
  }
  return data as ProposalRow;
}

export async function loadProposal(supabase: Db, actionId: string): Promise<ProposalRow | null> {
  const { data, error } = await supabase
    .from("actions")
    .select("*")
    .eq("id", actionId)
    .maybeSingle();
  if (error) throw error;
  const row = (data as ProposalRow | null) ?? null;
  if (!row) return null;
  // Point d'entrée unique des états stockés : les clés héritées y sont
  // ramenées à leur nom actuel, une fois, pour tous les consommateurs.
  return {
    ...row,
    before_value: normalizeLegacyStateKeys(row.before_value),
    after_value: normalizeLegacyStateKeys(row.after_value),
  };
}

/**
 * Une correction est-elle DÉJÀ appliquée sur ce problème ?
 *
 * La vérification de fraîcheur suffit à empêcher une double écriture sur tout ce
 * qui ÉCRASE un état : la seconde confirmation trouve un état différent de
 * l'aperçu et refuse. Elle ne protège rien sur les actions ADDITIVES — créer un
 * code promo, ajouter des mots-clés à exclure — dont l'état antérieur est vide
 * par nature. Deux propositions ouvertes sur le même problème créaient alors
 * deux codes promo, sans qu'aucun garde-fou ne s'en aperçoive.
 */
export async function hasAppliedActionOnFinding(
  supabase: Db,
  findingId: string,
  exceptActionId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("actions")
    .select("id")
    .eq("finding_id", findingId)
    .eq("status", "applied")
    .neq("id", exceptActionId)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Réserve la proposition avant d'écrire chez le partenaire.
 *
 * La transition est conditionnée à `status = 'proposed'` : une seconde
 * confirmation (double-clic, second onglet, rejeu réseau) ne renvoie aucune ligne
 * et n'exécute donc rien. C'est le verrou d'idempotence.
 *
 * `applied_at` n'est PAS renseigné ici. Il l'était, et c'était le défaut : une
 * ligne réservée puis interrompue portait une date d'application pour une
 * écriture dont personne ne connaissait le sort. La date n'est posée qu'au
 * retour du partenaire, par `finalizeApplied`.
 */
export async function claimProposal(supabase: Db, actionId: string): Promise<ProposalRow | null> {
  const { data, error } = await supabase
    .from("actions")
    .update({ status: "applied", run_state: "reserve", applied_at: null, error_message: null })
    .eq("id", actionId)
    .eq("status", "proposed")
    .select();
  if (error) throw error;
  const rows = (data ?? []) as ProposalRow[];
  return rows[0] ?? null;
}

/** L'écriture externe a échoué : la ligne repasse en `failed`, jamais en `proposed`. */
export async function markFailed(supabase: Db, actionId: string, message: string): Promise<void> {
  await supabase
    .from("actions")
    .update({
      status: "failed",
      run_state: "echoue",
      applied_at: null,
      error_message: message.slice(0, 2000),
    })
    .eq("id", actionId);
}

/**
 * L'écriture a réussi : on consigne le résultat réellement obtenu.
 *
 * `revertible` est réécrit ici avec la réversibilité CONSTATÉE après l'appel API,
 * et non celle estimée à la proposition : une action n'est annonçée annulable que
 * si l'information nécessaire a effectivement été obtenue.
 */
export async function finalizeApplied(
  supabase: Db,
  actionId: string,
  afterValue: Record<string, unknown>,
  revertible: boolean,
): Promise<void> {
  await supabase
    .from("actions")
    .update({
      after_value: afterValue,
      revertible,
      // Seul endroit qui pose ces deux marques : le partenaire a répondu.
      run_state: "ecrit",
      applied_at: new Date().toISOString(),
    })
    .eq("id", actionId);
}

/**
 * Réserve l'annulation avant d'écrire chez le partenaire.
 *
 * Transition gardée `applied` → `reverted` : une seconde annulation ne renvoie
 * aucune ligne et n'exécute rien. Le filtre `revertible` n'est qu'une première
 * barrière — la colonne étant modifiable par le client, c'est `executeRevert` qui
 * refuse réellement les outils sans procédure d'annulation.
 */
export async function claimRevert(supabase: Db, actionId: string): Promise<ProposalRow | null> {
  const { data, error } = await supabase
    .from("actions")
    .update({ status: "reverted", reverted_at: new Date().toISOString(), error_message: null })
    .eq("id", actionId)
    .eq("status", "applied")
    .eq("revertible", true)
    // Une écriture encore en vol ne s'annule pas : on ignore ce qu'il y aurait à
    // défaire. Les lignes antérieures à la colonne portent `null` et restent
    // annulables — d'où le `or` plutôt qu'un simple `neq`, qui les exclurait
    // toutes (en SQL, `null <> 'reserve'` ne vaut pas vrai).
    .or("run_state.is.null,run_state.neq.reserve")
    .select();
  if (error) throw error;
  const rows = (data ?? []) as ProposalRow[];
  return rows[0] ?? null;
}

/**
 * L'annulation a échoué : la ligne retrouve son état réel — toujours appliquée —
 * avec le motif. Un échec n'est jamais présenté comme une annulation réussie.
 */
export async function restoreAfterFailedRevert(
  supabase: Db,
  actionId: string,
  message: string,
): Promise<void> {
  await supabase
    .from("actions")
    .update({ status: "applied", reverted_at: null, error_message: message.slice(0, 2000) })
    .eq("id", actionId);
}
