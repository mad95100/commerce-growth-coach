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
    "Configuration IA absente : renseigne AI_BASE_URL et AI_API_KEY dans les secrets du serveur.",
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
