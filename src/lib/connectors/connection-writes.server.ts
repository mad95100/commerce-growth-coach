import type { Db } from "@/lib/actions.server";

/**
 * Écritures sur `data_connections`, réservées au serveur.
 *
 * POURQUOI CE MODULE. La table porte les jetons partenaires : le rôle
 * `authenticated` n'y a plus aucun droit d'écriture, et ne peut plus lire les
 * colonnes de jetons. Les écritures passent donc par le rôle de service, qui
 * contourne RLS.
 *
 * CONSÉQUENCE À NE PAS OUBLIER. Contourner RLS, c'est perdre la garantie que la
 * base refusait d'elle-même la boutique d'autrui. Chaque fonction ci-dessous
 * commence donc par vérifier l'appartenance avec le client de l'utilisateur —
 * qui, lui, reste soumis à RLS. Sans cette vérification, `storeId` venant de la
 * requête suffirait à agir sur la connexion de n'importe qui.
 */

/**
 * Vérifie que la boutique appartient bien à l'appelant.
 *
 * La lecture se fait avec le client de l'utilisateur : c'est RLS qui tranche,
 * pas notre code. Une boutique qui n'est pas la sienne ne remonte simplement pas.
 */
async function assertOwnsStore(userSupabase: Db, storeId: string): Promise<void> {
  const { data } = await userSupabase.from("stores").select("id").eq("id", storeId).maybeSingle();
  if (!data) throw new Error("Boutique introuvable");
}

/** Note la boutique visée avant de partir chez le partenaire. */
export async function upsertPendingConnection(
  userSupabase: Db,
  storeId: string,
  provider: "shopify" | "meta_ads" | "google_ads" | "ga4",
  accountId: string,
  accountLabel?: string,
): Promise<void> {
  await assertOwnsStore(userSupabase, storeId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("data_connections").upsert(
    {
      store_id: storeId,
      provider,
      status: "pending",
      account_id: accountId,
      account_label: accountLabel ?? accountId,
    },
    { onConflict: "store_id,provider" },
  );
}

/** Supprime la connexion d'un fournisseur pour une boutique. */
export async function deleteConnection(
  userSupabase: Db,
  storeId: string,
  provider: "shopify" | "meta_ads" | "google_ads" | "ga4",
): Promise<void> {
  await assertOwnsStore(userSupabase, storeId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("data_connections")
    .delete()
    .eq("store_id", storeId)
    .eq("provider", provider);
  if (error) throw error;
}

/**
 * Met à jour une connexion identifiée par son id.
 *
 * L'id ne prouve rien à lui seul : il est confronté à la boutique dont
 * l'appartenance vient d'être vérifiée, pour qu'un identifiant deviné ne
 * permette pas d'agir sur la connexion d'un autre compte.
 */
export async function updateConnectionById(
  userSupabase: Db,
  storeId: string,
  connectionId: string,
  // Forme restreinte volontairement : seuls le compte visé et son libellé sont
  // modifiables par ce chemin. Un sac de clés ouvert permettrait d'écrire
  // `access_token_ciphertext` depuis une fonction qui n'a pas à le faire.
  patch: { account_id?: string | null; account_label?: string | null },
): Promise<void> {
  await assertOwnsStore(userSupabase, storeId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("data_connections")
    .update(patch)
    .eq("id", connectionId)
    .eq("store_id", storeId);
  if (error) throw error;
}
