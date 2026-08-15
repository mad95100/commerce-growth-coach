import { createFileRoute } from "@tanstack/react-router";

/**
 * Déclencheur HTTP des travaux en attente.
 *
 * POURQUOI IL EXISTE EN PLUS DU CRON. Le cron Cloudflare est le déclencheur
 * normal, mais il ne couvre pas tout : on veut pouvoir relancer un passage à la
 * main après un incident, le déclencher depuis un ordonnanceur externe si l'on
 * change un jour d'hébergeur, et surtout l'exercer en test de bout en bout. Un
 * `scheduled()` ne s'appelle pas depuis un navigateur ni depuis `curl`.
 *
 * SÉCURITÉ. Le préfixe `internal` décrit une intention, pas une protection : un
 * worker n'a pas de réseau privé, l'URL est donc joignable par n'importe qui.
 * La route est protégée par un secret partagé comparé en temps constant, et
 * refuse de fonctionner si ce secret n'est pas configuré. Sans cela, un tiers
 * pourrait faire tourner la file d'audits à volonté, et donc facturer des
 * appels au modèle sur le compte du projet.
 */
export const Route = createFileRoute("/api/internal/jobs/tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.JOBS_TICK_SECRET;
        if (!expected) {
          // Pas de secret, pas de service. Le contraire — accepter tout le monde
          // quand la configuration manque — est exactement la faille qu'on
          // retrouve dans tous les incidents de ce genre.
          return json({ error: "JOBS_TICK_SECRET non configuré côté serveur." }, 503);
        }

        const presented =
          request.headers.get("x-jobs-secret") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";

        if (!timingSafeEqual(presented, expected)) {
          return json({ error: "Non autorisé." }, 401);
        }

        try {
          const { runJobsTick } = await import("@/lib/jobs-tick.server");
          const result = await runJobsTick();
          return json({ ok: true, ...result }, 200);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[jobs] passage HTTP interrompu :", err);
          return json({ ok: false, error: message }, 500);
        }
      },
    },
  },
});

/**
 * Comparaison à durée constante.
 *
 * `a === b` sort au premier caractère différent : le temps de réponse fuit
 * alors la longueur du préfixe correct, ce qui permet de deviner le secret
 * caractère par caractère. On compare donc toujours toute la chaîne.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
