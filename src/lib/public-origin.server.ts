/**
 * Origine publique de l'application, utilisée pour construire les `redirect_uri`
 * OAuth — et uniquement pour cela.
 *
 * HISTORIQUE DU BUG. Cette origine a d'abord été déduite de
 * `new URL(getRequest().url).origin` : derrière un proxy, cette URL porte
 * l'origine INTERNE du conteneur, jamais l'URL publique. La deuxième version
 * la déduisait des en-têtes `X-Forwarded-*`. C'était plus juste, mais toujours
 * variable : l'origine dépendait de l'adresse par laquelle l'utilisateur
 * naviguait — aperçu, éditeur, domaine publié. Shopify répondait alors
 * « The redirect_uri is not whitelisted ».
 *
 * POURQUOI ELLE EST FIGÉE MAINTENANT. Un `redirect_uri` OAuth doit être
 * identique au caractère près à une URL déclarée chez le partenaire, et
 * identique entre la demande d'autorisation et l'échange du code. Une valeur
 * déduite de la requête ne peut pas offrir cette garantie. On la fixe donc.
 *
 * CE N'EST PAS UN SECRET : c'est l'adresse publique du site. Elle est versionnée
 * plutôt que rangée dans les secrets du projet, pour qu'elle reste vérifiable
 * en relisant le code et qu'un déploiement ne puisse pas la perdre.
 *
 * EN CAS DE CHANGEMENT DE DOMAINE : renseigner `APP_URL` ET les URL de
 * redirection déclarées chez Shopify, Meta et Google. Les deux doivent bouger
 * ensemble, sinon l'autorisation est refusée.
 */

/**
 * Domaine historique, servi par l'ancien hébergeur.
 *
 * C'est un REPLI TRANSITOIRE, atteint uniquement si `APP_URL` n'est pas
 * renseignée. Il existe pour que le code fusionné dans `main` continue de
 * servir la production actuelle pendant la bascule. La nouvelle infrastructure
 * renseigne `APP_URL` (voir `wrangler.toml`), ce qui le rend inatteignable —
 * c'est vérifié par `tests/infra/no-lovable.test.ts`.
 *
 * À SUPPRIMER à la bascule, avec `LEGACY_BASE_URL` dans `ai-gateway.server.ts`.
 */
const LEGACY_ORIGIN = "https://commerce-growth-coach.lovable.app";

function sanitizeOrigin(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Origine publique de l'application.
 *
 * `APP_URL` reste prioritaire : elle permet de basculer sur un domaine
 * personnalisé sans toucher au code. En son absence, l'origine canonique
 * s'applique. La requête n'est jamais consultée — c'est délibéré, voir plus haut.
 */
export function publicOrigin(): string {
  const configured = process.env.APP_URL ? sanitizeOrigin(process.env.APP_URL) : null;
  return configured ?? LEGACY_ORIGIN;
}

/** URL de callback OAuth d'un fournisseur, identique à l'autorisation et à l'échange. */
export function oauthCallbackUrl(provider: "shopify" | "meta" | "google"): string {
  return `${publicOrigin()}/api/public/oauth/${provider}/callback`;
}
