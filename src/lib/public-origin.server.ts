/**
 * Origine publique de l'application, telle que le navigateur la voit.
 *
 * Pourquoi ce module : les `redirect_uri` OAuth étaient construits avec
 * `new URL(getRequest().url).origin`. Derrière un proxy (Lovable Cloud, Cloudflare),
 * cette URL porte l'origine INTERNE — souvent `http://localhost:3000` ou un hôte de
 * conteneur — et non l'URL publique. Le `redirect_uri` envoyé au partenaire ne
 * correspond alors à aucune URL de redirection autorisée : Shopify refuse
 * l'autorisation, et l'utilisateur atterrit sur une page d'erreur ou vide.
 *
 * Ordre de résolution, du plus fiable au plus faible :
 *  1. `APP_URL` — valeur explicite, à privilégier en production ;
 *  2. en-têtes `X-Forwarded-Proto` / `X-Forwarded-Host` posés par le proxy ;
 *  3. en-tête `Host` de la requête ;
 *  4. origine de `request.url`, en dernier recours.
 */

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

/** Premier en-tête d'une liste `X-Forwarded-*` (le proxy peut en chaîner plusieurs). */
function firstForwarded(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(",")[0]?.trim();
  return first || null;
}

export function publicOrigin(request: Request | undefined): string {
  const configured = process.env.APP_URL ? sanitizeOrigin(process.env.APP_URL) : null;
  if (configured) return configured;

  if (!request) {
    throw new Error(
      "Impossible de déterminer l'URL publique de l'application. Configure APP_URL dans les secrets.",
    );
  }

  const headers = request.headers;
  const forwardedHost = firstForwarded(headers?.get("x-forwarded-host") ?? null);
  if (forwardedHost) {
    const proto = firstForwarded(headers?.get("x-forwarded-proto") ?? null) ?? "https";
    const fromForwarded = sanitizeOrigin(`${proto}://${forwardedHost}`);
    if (fromForwarded) return fromForwarded;
  }

  const host = headers?.get("host");
  if (host) {
    // En local on reste en http ; partout ailleurs le public passe par https.
    const proto = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? "http" : "https";
    const fromHost = sanitizeOrigin(`${proto}://${host}`);
    if (fromHost) return fromHost;
  }

  const fromRequest = sanitizeOrigin(new URL(request.url).origin);
  if (fromRequest) return fromRequest;

  throw new Error(
    "Impossible de déterminer l'URL publique de l'application. Configure APP_URL dans les secrets.",
  );
}

/** URL de callback OAuth d'un fournisseur, identique à l'autorisation et à l'échange. */
export function oauthCallbackUrl(
  request: Request | undefined,
  provider: "shopify" | "meta" | "google",
): string {
  return `${publicOrigin(request)}/api/public/oauth/${provider}/callback`;
}
