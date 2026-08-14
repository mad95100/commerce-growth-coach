import { defineConfig, loadEnv } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

/**
 * Chaîne de construction d'EcomPilot AI.
 *
 * CE FICHIER REMPLACE l'enveloppe de configuration fournie par l'ancien
 * hébergeur, qui livrait l'intégralité du build derrière un seul `defineConfig`
 * et rendait le dépôt inconstructible hors de sa plateforme. Tout ce qu'elle
 * apportait et qui compte en production est reproduit ici explicitement, à
 * partir de la lecture de son code : mêmes greffons, même ordre, mêmes options.
 *
 * CE QUI N'A PAS ÉTÉ REPRIS, et pourquoi :
 *   - la détection de bac à sable, le pont de serveur de développement, le
 *     portail HMR et le proxy d'actifs `/__l5e/` : ils ne servaient qu'à
 *     l'aperçu dans l'éditeur ;
 *   - les journaliseurs d'erreurs SSR et de fonctions serveur : ils ne
 *     s'activaient qu'en `serve` et poussaient leurs messages dans le canal HMR
 *     de l'éditeur ;
 *   - les diagnostics de build : conditionnés au bac à sable ;
 *   - les devtools TanStack : outillage de développement, hors sujet ici.
 *
 * L'ORDRE DES GREFFONS EST SIGNIFIANT. `tanstackStart` doit précéder
 * `viteReact`, et `nitro` doit voir la sortie de `tanstackStart`. Il reproduit
 * celui de la configuration d'origine.
 */
export default defineConfig(({ mode, command }) => {
  // Les variables `VITE_*` sont injectées à la compilation, comme avant : le
  // client Supabase les lit via `import.meta.env`, qui n'existe pas à l'exécution.
  const clientEnv = loadEnv(mode, process.cwd(), "VITE_");
  const define: Record<string, string> = {};
  for (const [key, value] of Object.entries(clientEnv)) {
    define[`import.meta.env.${key}`] = JSON.stringify(value);
  }

  return {
    define,
    css: { transformer: "lightningcss" },
    resolve: {
      alias: { "@": `${process.cwd()}/src` },
      // Deux copies de React ou du cache TanStack dans un même bundle cassent
      // les hooks et le contexte, avec des symptômes qui n'évoquent en rien
      // leur cause.
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
    },
    server: { host: "::", port: 8080 },
    plugins: [
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      tanstackStart({
        // Empêche un module serveur d'être tiré dans le bundle client. En
        // `error`, la violation casse le build au lieu de livrer du code serveur
        // au navigateur — c'est la garantie qui protège les jetons et la clé de
        // service.
        importProtection: {
          behavior: "error",
          client: { files: ["**/server/**"], specifiers: ["server-only"] },
        },
        // Redirige l'entrée serveur vers `src/server.ts`, qui enveloppe le SSR
        // et porte le déclencheur planifié.
        server: { entry: "server" },
      }),
      // Nitro n'intervient qu'à la construction. `cloudflare-module` produit un
      // worker ES module dans `.output/`, déployable par wrangler.
      ...(command === "build"
        ? [
            nitro({
              preset: "cloudflare-module",
              // Branche le crochet `cloudflare:scheduled` : c'est ce qui permet
              // aux audits d'avancer sans navigateur ouvert.
              plugins: ["./src/nitro/scheduled.ts"],
              cloudflare: {
                nodeCompat: true,
                // La configuration de déploiement est versionnée dans
                // `wrangler.toml` : la laisser générer une seconde source de
                // vérité garantirait qu'elles divergent.
                deployConfig: false,
              },
            }),
          ]
        : []),
      viteReact(),
    ],
  };
});
