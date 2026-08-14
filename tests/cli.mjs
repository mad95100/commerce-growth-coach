/**
 * Point d'entrée de la suite de tests.
 *
 * Les modules du projet utilisent l'alias `@/` que Node ne sait pas résoudre.
 * Plutôt que d'exiger une variable d'environnement au lancement — qu'on oublie,
 * et dont l'oubli se manifeste par une erreur obscure — l'alias est configuré
 * ici, une fois. `npm test` fonctionne donc à l'identique en local et en CI.
 */
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const jiti = createJiti(import.meta.url, {
  alias: { "@": `${root}src` },
  interopDefault: true,
});

await jiti.import("./run.ts");
