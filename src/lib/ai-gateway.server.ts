/**
 * Accès au fournisseur de modèles.
 *
 * POURQUOI CE MODULE EXISTE. L'URL du fournisseur et sa clé étaient recopiées
 * dans trois fichiers, avec la passerelle Lovable écrite en dur. Changer de
 * fournisseur demandait donc trois modifications de code coordonnées, et
 * l'application ne pouvait pas tourner ailleurs que chez Lovable.
 *
 * Le protocole visé est celui d'OpenAI (`POST /chat/completions`, avec
 * `messages`, `tools` et `tool_choice`). Il est parlé tel quel par OpenAI,
 * Google via son point d'entrée compatible, OpenRouter, Groq, Together, et par
 * la passerelle Lovable elle-même. Le fournisseur devient donc une valeur de
 * configuration, plus une décision inscrite dans le code.
 *
 * CONFIGURATION
 *   AI_BASE_URL     racine de l'API, sans barre finale ni `/chat/completions`
 *                   (ex. https://api.openai.com/v1)
 *   AI_API_KEY      SECRET — jeton porteur envoyé en `Authorization`
 *   AI_AUDIT_MODEL  facultatif, remplace le modèle d'audit
 *   AI_FIX_MODEL    facultatif, remplace le modèle des corrections
 */

import { AUDIT_MODEL } from "@/lib/audit-prompt";

/**
 * Repli transitoire vers la passerelle Lovable.
 *
 * C'EST LE SEUL POINT DU CODE QUI CONNAÎT ENCORE LOVABLE À L'EXÉCUTION, et il
 * n'est atteint que si `AI_BASE_URL` n'est pas renseignée. Il existe pour une
 * seule raison : tant que le déploiement Lovable sert la production, le code
 * fusionné dans `main` doit continuer d'y fonctionner. La nouvelle
 * infrastructure renseigne `AI_BASE_URL` (voir `wrangler.toml`), ce qui rend ce
 * repli inatteignable — c'est vérifié par `tests/infra/no-lovable.test.ts`.
 *
 * À SUPPRIMER au moment de la bascule, avec `LEGACY_ORIGIN` dans
 * `public-origin.server.ts`. Ce sont les deux dernières traces à retirer.
 */
const LEGACY_BASE_URL = "https://ai.gateway.lovable.dev/v1";
const LEGACY_KEY_VAR = "LOVABLE_API_KEY";

const DEFAULT_FIX_MODEL = "google/gemini-2.5-flash";

export type AiRole = "audit" | "fix";

/**
 * Modèle à employer pour un rôle donné.
 *
 * Les valeurs par défaut sont exactement celles qui étaient codées en dur :
 * sans configuration, le comportement ne change pas d'un caractère.
 */
export function aiModel(role: AiRole): string {
  const override = role === "audit" ? process.env.AI_AUDIT_MODEL : process.env.AI_FIX_MODEL;
  if (override?.trim()) return override.trim();
  return role === "audit" ? AUDIT_MODEL : DEFAULT_FIX_MODEL;
}

export type AiEndpoint = { url: string; apiKey: string; legacy: boolean };

/**
 * Résout le point d'entrée du fournisseur.
 *
 * Exportée pour être vérifiable : c'est la règle qui décide si l'exécution
 * dépend encore de Lovable, et une règle pareille ne doit pas être seulement
 * lisible, elle doit être testable.
 */
export function resolveAiEndpoint(env: NodeJS.ProcessEnv = process.env): AiEndpoint {
  const base = env.AI_BASE_URL?.trim().replace(/\/+$/, "");
  const key = env.AI_API_KEY?.trim();

  if (base) {
    if (!key) {
      throw new Error(
        "Configuration IA incomplète : AI_BASE_URL est renseignée mais AI_API_KEY manque côté serveur.",
      );
    }
    return { url: `${base}/chat/completions`, apiKey: key, legacy: false };
  }

  const legacyKey = env[LEGACY_KEY_VAR]?.trim();
  if (legacyKey) {
    return { url: `${LEGACY_BASE_URL}/chat/completions`, apiKey: legacyKey, legacy: true };
  }

  throw new Error(
    "Configuration IA absente : renseignez AI_BASE_URL et AI_API_KEY dans les secrets du serveur.",
  );
}

/**
 * Appelle le fournisseur et rend la réponse brute.
 *
 * La réponse n'est délibérément pas interprétée ici : chaque appelant a sa
 * propre façon de lire le résultat — extraction d'un appel d'outil, repli sur
 * du JSON en texte brut, messages d'erreur métier — et centraliser cela
 * mélangerait des responsabilités qui n'ont rien à voir.
 */
export async function aiChatCompletion(body: Record<string, unknown>): Promise<Response> {
  const endpoint = resolveAiEndpoint();
  return fetch(endpoint.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${endpoint.apiKey}`,
    },
    body: JSON.stringify(body),
  });
}

/**
 * Modèle de secours pour un rôle donné, ou `null`.
 *
 * Renseigné par configuration, jamais deviné : ce fichier ne peut pas savoir
 * quels modèles le compte du jour a le droit d'appeler, et un nom inventé
 * transformerait une panne de quota en panne de modèle introuvable — un échec
 * pour un autre, sans rien régler.
 */
export function aiFallbackModel(role: AiRole): string | null {
  const brut =
    role === "audit" ? process.env.AI_AUDIT_FALLBACK_MODEL : process.env.AI_FIX_FALLBACK_MODEL;
  const nom = brut?.trim();
  if (!nom) return null;
  // Un secours identique au principal ne secourt rien : il rejouerait le même
  // appel, sur le même quota, pour le même refus.
  return nom === aiModel(role) ? null : nom;
}

/**
 * L'ÉCHEC MÉRITE-T-IL D'ÊTRE RETENTÉ SUR UN AUTRE MODÈLE ?
 *
 * C'est la question qui décide de tout, et elle se tranche sur le STATUT, pas
 * sur l'envie que l'audit aboutisse.
 *
 * OUI pour ce qui tient au modèle demandé ou à sa disponibilité du moment :
 *
 *   · 429 — quota épuisé ou débit limité. Les quotas de l'offre gratuite Google
 *     sont comptés PAR MODÈLE (`GenerateRequestsPerDayPerProjectPerModel`) :
 *     un second modèle a donc son propre compteur, et c'est précisément ce qui
 *     rend le secours utile plutôt que cosmétique.
 *   · 404 — le modèle a disparu du catalogue. Google retire régulièrement
 *     l'accès de ses anciennes versions ; c'est déjà arrivé en production.
 *   · 5xx — panne côté fournisseur, souvent limitée à un modèle.
 *
 * NON pour tout le reste, et chaque refus a sa raison :
 *
 *   · 401/403 — c'est la CLÉ qui est refusée. Aucun modèle n'y changera rien,
 *     et réessayer ne ferait que doubler les traces d'échec d'authentification.
 *   · 400/413/422 — c'est NOTRE demande qui est mal formée ou trop grosse. Un
 *     autre modèle la refusera pareil, avec en prime le risque qu'un modèle
 *     plus permissif l'accepte à moitié et rende un diagnostic dégradé sans que
 *     personne ne le sache.
 *   · 2xx — il n'y a rien à secourir.
 */
export function meriteUnSecours(statut: number): boolean {
  if (statut === 429 || statut === 404) return true;
  return statut >= 500;
}

/**
 * Appelle le modèle du rôle, et reprend sur le modèle de secours si l'échec
 * peut se réparer ainsi.
 *
 * POURQUOI CETTE POLITIQUE VIT ICI, ET PAS DANS LE MOTEUR D'AUDIT. Elle y était
 * écrite en ligne, au milieu de sept cents lignes qui construisent un prompt :
 * impossible de l'exécuter sans monter une boutique, une base et une collecte
 * complète. Une règle de reprise qu'on ne peut pas éprouver directement n'est
 * éprouvée par personne — et c'est celle qui ne sert QUE les jours de panne.
 *
 * `corpsPour` reçoit le nom du modèle et rend la demande complète. Les deux
 * appels passent donc par la MÊME fonction : ni le prompt, ni le schéma de
 * sortie, ni l'appel d'outil forcé ne peuvent diverger entre le principal et le
 * secours. C'est ce qui rend le repli acceptable — un secours qui relâcherait
 * le schéma « pour faire passer » la réponse produirait un diagnostic d'une
 * autre nature, que rien ne distinguerait du premier.
 *
 * En cas de double échec, les DEUX statuts sont dans le message : ne garder que
 * le second ferait croire à une panne isolée du secours, alors que c'est la
 * chaîne entière qui n'a pas abouti, et le premier statut est celui qui
 * explique pourquoi on en est arrivé là.
 */
export async function aiChatCompletionAvecSecours(
  role: AiRole,
  corpsPour: (modele: string) => Record<string, unknown>,
  appeler: (corps: Record<string, unknown>) => Promise<Response> = aiChatCompletion,
): Promise<Response> {
  const principal = aiModel(role);
  const premiere = await appeler(corpsPour(principal));
  if (premiere.ok) return premiere;

  const statut = premiere.status;
  const texte = await premiere.text();
  const secours = aiFallbackModel(role);

  if (!secours || !meriteUnSecours(statut)) {
    throw new Error(`AI Gateway ${statut}: ${texte}`);
  }

  console.error(
    `[ia] ${principal} a refusé (${statut}) — reprise sur ${secours}. Réponse : ${texte}`,
  );
  const seconde = await appeler(corpsPour(secours));
  if (seconde.ok) return seconde;

  const texte2 = await seconde.text();
  throw new Error(
    `AI Gateway ${statut}: ${texte} — secours ${secours} : AI Gateway ${seconde.status}: ${texte2}`,
  );
}
