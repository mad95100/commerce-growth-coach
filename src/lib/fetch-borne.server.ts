/**
 * Un `fetch` qui ne peut pas attendre indéfiniment.
 *
 * LE DÉFAUT QUE CE MODULE RÈGLE, ET CE QU'IL COÛTAIT. Le scan de la vitrine
 * était le SEUL appel borné du moteur (5 s par page, 15 s de budget total).
 * Shopify, Meta, Google et le fournisseur d'analyse partaient sans aucun
 * délai : un partenaire qui accepte la connexion puis ne répond jamais
 * suspendait l'audit entier, sans erreur, sans trace, sans fin.
 *
 * CE QUE LE MARCHAND VOYAIT ALORS. « Analyse en cours… », indéfiniment. Le
 * travail est réclamé sous un bail de cinq minutes : tant qu'il court, personne
 * d'autre ne peut reprendre l'audit — ni l'onglet ouvert, ni le passage
 * planifié. Une tentative morte reste donc AFFICHÉE COMME VIVANTE jusqu'à
 * l'expiration du bail, et cela trois fois de suite avant que l'échec soit
 * enfin déclaré.
 *
 * Le plus coûteux n'est pas l'attente : c'est que `audit-errors.ts` sait déjà
 * nommer ce cas — `delai_depasse`, « relancez maintenant, ce n'est ni vous ni
 * une panne » — et que cette branche était INATTEIGNABLE, faute de quoi que ce
 * soit qui produise un dépassement. Le produit avait la bonne réponse et aucun
 * moyen de l'atteindre.
 *
 * POURQUOI UN MODULE PLUTÔT QU'UN `signal` À CHAQUE APPEL. Les connecteurs
 * reçoivent leur `fetcher` en paramètre — c'est ce qui les rend exerçables sans
 * réseau. Le délai se pose donc sur la VALEUR PAR DÉFAUT de ce paramètre : les
 * tests continuent d'injecter le leur, et aucun appel réel ne peut oublier la
 * borne.
 */

/**
 * Délai accordé à un appel de partenaire.
 *
 * Assez large pour une API lente sous charge, assez court pour qu'une tentative
 * complète tienne sous le bail de cinq minutes — sans quoi la reprise
 * automatique arriverait après que le marchand a renoncé.
 */
export const PARTENAIRE_TIMEOUT_MS = 15_000;

/**
 * `true` si l'échec est un dépassement de délai, et non autre chose.
 *
 * `AbortSignal.timeout` lève une `TimeoutError` ; une annulation explicite lève
 * une `AbortError`. Les deux se reconnaissent au NOM et non à la classe :
 * `DOMException` n'est pas la même entre le navigateur, Node et le worker, et un
 * `instanceof` y rendrait `false` sur l'une des trois plateformes — c'est-à-dire
 * exactement là où le cas se produirait.
 */
export function estUnDelaiDepasse(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const nom = (err as { name?: unknown }).name;
  return nom === "TimeoutError" || nom === "AbortError";
}

/**
 * `fetch`, borné dans le temps.
 *
 * Un `signal` déjà fourni par l'appelant est RESPECTÉ : l'écraser retirerait
 * silencieusement une annulation que quelqu'un avait demandée, et le scan de la
 * vitrine — qui pose déjà les siens — perdrait son budget global.
 */
export function fetchBorne(url: string, init?: RequestInit): Promise<Response> {
  if (init?.signal) return fetch(url, init);
  return fetch(url, { ...init, signal: AbortSignal.timeout(PARTENAIRE_TIMEOUT_MS) });
}
