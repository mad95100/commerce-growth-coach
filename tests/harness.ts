/**
 * Harnais de test minimal.
 *
 * POURQUOI PAS VITEST. Le projet n'a aucun cadre de test installé, et en
 * ajouter un ferait entrer une dizaine de paquets pour exécuter des fonctions
 * pures. Ces contrôles n'ont besoin ni de DOM, ni de simulation de modules, ni
 * de couverture : ils appellent du code et comparent des valeurs. Un harnais de
 * cinquante lignes suffit, se lit d'un coup d'œil, et ne peut pas casser à la
 * prochaine montée de version.
 *
 * Si un jour des tests de composants React sont nécessaires, Vitest deviendra
 * justifié — pas avant.
 */

export type Suite = {
  /** Domaine fonctionnel, affiché dans le rapport. */
  name: string;
  run: (t: Harness) => void | Promise<void>;
};

export type Harness = {
  /** Compare une valeur obtenue à une valeur attendue, par égalité structurelle. */
  check: (label: string, got: unknown, expected: unknown) => void;
  /** Vérifie qu'un appel lève. Le type d'erreur attendu est facultatif. */
  throws: (label: string, fn: () => unknown, type?: unknown) => void;
  /** Même chose pour un appel asynchrone. */
  throwsAsync: (label: string, fn: () => Promise<unknown>, type?: unknown) => Promise<void>;
};

export type SuiteResult = {
  name: string;
  passed: number;
  failures: string[];
};

/** Déclare une suite. Le fichier de test en exporte une par défaut. */
export function defineSuite(name: string, run: Suite["run"]): Suite {
  return { name, run };
}

/**
 * Exécute une suite et renvoie son résultat.
 *
 * Une exception non rattrapée pendant la suite est comptée comme un échec plutôt
 * que de faire tomber le lot entier : un domaine cassé ne doit pas masquer
 * l'état des autres.
 */
export async function runSuite(suite: Suite): Promise<SuiteResult> {
  let passed = 0;
  const failures: string[] = [];

  const harness: Harness = {
    check(label, got, expected) {
      const g = JSON.stringify(got);
      const e = JSON.stringify(expected);
      if (g === e) passed++;
      else failures.push(`${label}\n      attendu : ${e}\n      obtenu  : ${g}`);
    },
    throws(label, fn, type) {
      try {
        fn();
        failures.push(`${label} — aucune erreur levée`);
      } catch (err) {
        if (type && !(err instanceof (type as new () => Error))) {
          failures.push(`${label} — erreur d'un autre type : ${(err as Error).name}`);
        } else passed++;
      }
    },
    async throwsAsync(label, fn, type) {
      try {
        await fn();
        failures.push(`${label} — aucune erreur levée`);
      } catch (err) {
        if (type && !(err instanceof (type as new () => Error))) {
          failures.push(`${label} — erreur d'un autre type : ${(err as Error).name}`);
        } else passed++;
      }
    },
  };

  try {
    await suite.run(harness);
  } catch (err) {
    failures.push(`suite interrompue : ${err instanceof Error ? err.message : String(err)}`);
  }

  return { name: suite.name, passed, failures };
}
