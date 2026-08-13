/**
 * Journal des actions automatiques (table `actions`).
 *
 * Toute écriture externe est précédée d'une ligne `proposed` et suivie d'une
 * transition `applied` ou `failed`. Aucune action ne part sans laisser de trace.
 *
 * Note de sécurité : `actions` est modifiable par le client via PostgREST
 * (policy `actions_owner_all … FOR ALL`). Rien de ce qui est lu ici n'est donc
 * digne de confiance — c'est `executePlannedAction` qui re-valide intégralement
 * les arguments et vérifie la fraîcheur de l'état avant d'écrire quoi que ce soit.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionChannel, PreviewLine } from "@/lib/action-plan";

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
  created_at: string;
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
  return (data as ProposalRow | null) ?? null;
}

/**
 * Réserve la proposition avant d'écrire chez le partenaire.
 *
 * La transition est conditionnée à `status = 'proposed'` : une seconde
 * confirmation (double-clic, second onglet, rejeu réseau) ne renvoie aucune ligne
 * et n'exécute donc rien. C'est le verrou d'idempotence.
 */
export async function claimProposal(supabase: Db, actionId: string): Promise<ProposalRow | null> {
  const { data, error } = await supabase
    .from("actions")
    .update({ status: "applied", applied_at: new Date().toISOString(), error_message: null })
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
    .update({ status: "failed", applied_at: null, error_message: message.slice(0, 2000) })
    .eq("id", actionId);
}

/** L'écriture a réussi : on consigne le résultat réellement obtenu. */
export async function finalizeApplied(
  supabase: Db,
  actionId: string,
  afterValue: Record<string, unknown>,
): Promise<void> {
  await supabase.from("actions").update({ after_value: afterValue }).eq("id", actionId);
}
