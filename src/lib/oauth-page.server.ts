/**
 * LES PAGES DE RETOUR OAUTH, ÉCRITES UNE SEULE FOIS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER EXISTE : TROIS COPIES QUI ONT DIVERGÉ.
 *
 * Les trois retours OAuth — Shopify, Meta, Google — rendaient chacun leur
 * propre page, avec leur propre `htmlResponse`. Celui de Shopify a été corrigé
 * plusieurs fois : échappement du HTML, lien de sortie sur chaque page,
 * redirection par `<meta refresh>` plutôt que par script. Les deux autres n'ont
 * rien reçu, et personne ne pouvait s'en apercevoir : trois fichiers, trois
 * fonctions du même nom, aucun lien entre elles.
 *
 * Ce qu'ils portaient encore :
 *
 * 1. UNE INJECTION HTML, JOIGNABLE SANS COMPTE. Le paramètre `error` de
 *    l'adresse était recopié tel quel dans la page :
 *
 *        htmlResponse(`Autorisation refusée : ${oauthError}`, 400)
 *
 *    Une adresse fabriquée — /api/public/oauth/meta/callback?error=<script…> —
 *    faisait donc exécuter du code SUR L'ORIGINE DE L'APPLICATION, celle où la
 *    session Supabase est rangée dans le stockage local. Vérifié au navigateur
 *    sur les deux retours : le script s'exécutait. Aucune authentification
 *    n'était nécessaire ; il suffisait de faire cliquer sur un lien.
 *
 *    Les réponses des fournisseurs et les messages d'erreur internes passaient
 *    par le même chemin.
 *
 * 2. UNE PAGE SANS SORTIE. Aucune des pages d'erreur de Meta ni de Google ne
 *    proposait de lien : le marchand y restait, sans rien à faire.
 *
 * 3. UNE REDIRECTION QUI POUVAIT NE PAS PARTIR. Le succès redirigeait par
 *    `<script>setTimeout(…)</script>`. Bloqué — politique de sécurité,
 *    extension — la page reste affichée sans que rien ne bouge, et sans lien.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA RÈGLE, TENUE PAR LA SIGNATURE. `page()` n'accepte que du HTML construit
 * ici. Tout texte venant d'ailleurs — l'adresse, un fournisseur, une erreur
 * interne — entre par `errorBody` ou `successBody`, qui l'échappent. Il n'y a
 * plus d'endroit où concaténer sans y penser.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Corps d'erreur : un titre, une cause lisible, et toujours un chemin de sortie. */
export function errorBody(title: string, detail: string): string {
  return (
    `<h1 class="err">${escapeHtml(title)}</h1>` +
    `<p>${escapeHtml(detail)}</p>` +
    `<p><a href="/dashboard">Revenir à l'application</a></p>`
  );
}

/**
 * Corps de succès. Le lien n'est pas décoratif : c'est le seul chemin qui reste
 * si la redirection automatique ne part pas.
 */
export function successBody(title: string, detail: string, storeId: string): string {
  return (
    `<h1>${escapeHtml(title)}</h1>` +
    `<p>${escapeHtml(detail)}</p>` +
    `<p><a href="/stores/${encodeURIComponent(storeId)}">Continuer maintenant</a></p>`
  );
}

/**
 * Réponse HTML d'un retour OAuth.
 *
 * La redirection passe par un `<meta http-equiv="refresh">`, et non par un
 * script : si le script ne s'exécute pas — politique de sécurité, extension —
 * l'utilisateur reste bloqué sur une page qui semble vide.
 */
export function page(title: string, body: string, status = 200, redirectTo?: string) {
  const refresh = redirectTo
    ? `<meta http-equiv="refresh" content="2;url=${escapeHtml(redirectTo)}">`
    : "";
  return new Response(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8">${refresh}` +
      `<title>${escapeHtml(title)}</title>` +
      `<style>body{font-family:system-ui,sans-serif;max-width:520px;margin:80px auto;padding:24px;background:#0B0F1E;color:#f8fafc;border-radius:16px}` +
      `h1{color:#22c55e}h1.err{color:#f97316}a{color:#06b6d4}</style></head><body>${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
