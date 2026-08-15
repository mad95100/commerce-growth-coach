import { definePlugin } from "nitro";

/**
 * Déclencheur planifié Cloudflare.
 *
 * Le préréglage `cloudflare-module` de Nitro exporte déjà un gestionnaire
 * `scheduled()` sur le worker : à chaque déclenchement du cron il appelle le
 * crochet `cloudflare:scheduled`, enveloppé dans `waitUntil`. Il ne manquait
 * donc que quelqu'un pour écouter — c'est ce fichier.
 *
 * La cadence est déclarée dans `wrangler.toml`, section `[triggers]`.
 *
 * POURQUOI SI PEU DE CODE ICI. Tout le travail est dans `runJobsTick`, qui ne
 * connaît ni Cloudflare ni Nitro. Ce fichier n'est qu'un branchement : le même
 * traitement est atteignable par HTTP (`/api/internal/jobs/tick`), ce qui le
 * rend testable et permet de changer d'hébergeur sans toucher à la logique.
 */
export default definePlugin((nitro) => {
  nitro.hooks.hook("cloudflare:scheduled", async () => {
    try {
      const { runJobsTick } = await import("@/lib/jobs-tick.server");
      const result = await runJobsTick();
      if (result.processed > 0) {
        console.log(
          `[cron] ${result.processed} audit(s) traité(s) — ${result.completed} terminé(s), ${result.failed} en échec`,
        );
      }
    } catch (err) {
      // Une exception non rattrapée dans `waitUntil` disparaît sans laisser de
      // trace : on la consigne nous-mêmes.
      console.error("[cron] passage des travaux interrompu :", err);
    }
  });
});
