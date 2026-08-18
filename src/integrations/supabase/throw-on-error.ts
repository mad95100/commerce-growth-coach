/**
 * LEVER UNE ERREUR SUPABASE SANS PERDRE SON STATUT.
 *
 * CE QUE FAISAIT `if (error) throw error`, ÉCRIT À QUINZE ENDROITS. Vérifié au
 * navigateur, sur une réponse 403 réelle :
 *
 *     const r = await supabase.from("stores").select("*");
 *     Object.keys(r.error)  →  ["message"]
 *     r.status              →  403
 *
 * Le statut HTTP vit sur la RÉPONSE, jamais sur l'objet d'erreur. Le relever
 * puis jeter l'erreur seule perdait donc la seule information qui dit si
 * redemander peut servir à quelque chose.
 *
 * CE QUE CELA COÛTAIT. La politique de nouvel essai ne pouvait rien distinguer :
 * un 403 — une politique d'accès qui ne changera pas d'une seconde à l'autre —
 * était rejoué exactement comme une coupure réseau. Le marchand attendait devant
 * une ossature pendant que le navigateur redemandait trois fois la permission
 * qu'on venait de lui refuser.
 *
 * Cette fonction attache le statut à l'erreur avant de la lever. Rien d'autre ne
 * change : le message, les détails et le code PostgREST restent intacts, et un
 * appelant qui ne lit que `message` continue de fonctionner.
 */

/** Erreur Supabase enrichie du statut de la réponse qui l'a produite. */
export type ErreurAvecStatut = Error & {
  status?: number;
  code?: string;
  details?: string | null;
  hint?: string | null;
};

/**
 * Forme minimale d'une réponse PostgREST : de quoi lire l'erreur, le statut et
 * les données, sans dépendre des types génériques du client — qui changent avec
 * chaque requête.
 */
type ReponseSupabase<T> = {
  data: T;
  error: { message: string; code?: string; details?: string | null; hint?: string | null } | null;
  status?: number;
};

/**
 * Rend les données de la réponse, ou lève une erreur qui porte son statut.
 *
 * POURQUOI ELLE REND LES DONNÉES plutôt que de se contenter de lever. Une
 * fonction qui ne fait que lever n'apprend rien au compilateur : `data` reste
 * `T | null` après l'appel, et chaque appelant devait ajouter un `!` ou un test
 * mort. En rendant `T`, le resserrement se fait une seule fois, ici, à l'endroit
 * où il est justifié — la réponse ne peut pas porter à la fois une absence
 * d'erreur et une absence de données.
 */
export function donneesOuLeve<T>(reponse: ReponseSupabase<T>): NonNullable<T> {
  const { error, status } = reponse;
  if (!error) return reponse.data as NonNullable<T>;

  // On construit une VRAIE `Error` : l'objet rendu par PostgREST n'en est pas
  // une, si bien que `err instanceof Error` était faux partout où l'interface
  // teste ce cas avant d'afficher un message — et le marchand recevait
  // « Erreur » à la place de la phrase écrite pour lui.
  const levee = new Error(error.message) as ErreurAvecStatut;
  if (typeof status === "number") levee.status = status;
  if (error.code) levee.code = error.code;
  if (error.details !== undefined) levee.details = error.details;
  if (error.hint !== undefined) levee.hint = error.hint;
  throw levee;
}
