import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HISTORY_ACTIONS,
  applyHistory,
  attemptSignature,
  compareToHistory,
  explainAttempt,
  guidanceFor,
  historyToPromptBlock,
  type Attempt,
} from "../../src/lib/attempt-history";
import { defineSuite } from "../harness";

/**
 * Mémoire des corrections : ne pas reproposer ce qui a déjà échoué.
 *
 * CE QUI EST EN JEU. Un diagnostic qui ne se souvient pas n'est pas un
 * diagnostic, c'est un générateur de suggestions. Le marchand qui se voit
 * reproposer, un mois plus tard, la correction qu'il a déjà faite sans résultat
 * en conclut — à raison — que l'outil ne le suit pas. C'est la faute qui fait
 * perdre confiance en premier, et elle ne se voit dans aucun test unitaire des
 * autres modules.
 *
 * CE QUE CES CONTRÔLES PROTÈGENT :
 *
 * - qu'une correction sans effet ne soit jamais reproposée telle quelle ;
 * - qu'une correction qui a MARCHÉ ne repasse pas pour un problème ouvert ;
 * - qu'une régression remonte en tête plutôt que de se fondre dans la liste ;
 * - qu'un résultat non tranché produise « il manque des données » et non une
 *   conclusion ;
 * - que le filtre ne rende jamais un rapport vide.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

const LAST_MONTH = "2026-07-10T09:00:00.000Z";

function attempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    key: "frais-caches",
    title: "Frais de port cachés",
    category: "conversion",
    tool: null,
    verdict: "nul",
    headline: null,
    appliedAt: LAST_MONTH,
    rollbackRecommended: false,
    rollbackPossible: false,
    ...overrides,
  };
}

export default defineSuite("Audits — mémoire des corrections", (t) => {
  t.check("quatre décisions possibles", HISTORY_ACTIONS.length, 4);

  // --- L'identité d'un problème --------------------------------------------
  // Deux audits reformulent volontiers le même problème. Comparer des titres
  // ferait passer le même blocage pour une découverte.
  t.check("la clé fait l'identité", attemptSignature({ key: "Frais-Cachés" }), "frais-caches");
  t.check(
    "à défaut, le titre normalisé",
    attemptSignature({ title: "Frais de port cachés" }),
    "frais-de-port-caches",
  );
  t.check("la clé l'emporte sur le titre", attemptSignature({ key: "abc", title: "Autre" }), "abc");
  t.check("sans rien, aucune identité", attemptSignature({}), "");

  // --- 1. Correction réussie ------------------------------------------------
  const succeeded = guidanceFor(
    { key: "frais-caches", title: "Frais de port cachés", category: "conversion" },
    [attempt({ verdict: "confirme", headline: "CA 30 jours : +18 %." })],
  );
  t.check("une correction prouvée est écartée du rapport", succeeded.action, "ecarter");
  t.check("elle est reconnue comme identique", succeeded.similarity, "identique");
  t.check("et présentée comme un acquis", succeeded.reason.includes("C'est un acquis"), true);
  t.check(
    "on invite à chercher ailleurs",
    succeeded.reason.includes("le blocage est ailleurs"),
    true,
  );

  // --- 2. Correction échouée ------------------------------------------------
  const failed = guidanceFor(
    { key: "frais-caches", title: "Frais de port cachés", category: "conversion" },
    [attempt({ verdict: "nul" })],
  );
  t.check("une correction sans effet est écartée", failed.action, "ecarter");
  t.check(
    "et on dit que le diagnostic s'était trompé",
    failed.reason.includes("Ce n'était pas le blocage"),
    true,
  );

  // --- 3. Régression --------------------------------------------------------
  const regressed = guidanceFor(
    { key: "budget-meta", title: "Budget Meta trop bas", category: "acquisition" },
    [
      attempt({
        key: "budget-meta",
        title: "Budget Meta trop bas",
        category: "acquisition",
        tool: "meta_update_budget",
        verdict: "regression",
        rollbackRecommended: true,
        rollbackPossible: true,
        headline: "Achats Meta : -22 %.",
      }),
    ],
  );
  t.check("une régression est priorisée, pas écartée", regressed.action, "prioriser");
  t.check(
    "l'annulation automatisable est annoncée",
    regressed.reason.includes("automatisable"),
    true,
  );
  t.check(
    "une annulation manuelle est annoncée comme telle",
    guidanceFor({ key: "k", title: "T", category: "acquisition" }, [
      attempt({ key: "k", verdict: "regression", rollbackPossible: false }),
    ]).reason.includes("à la main"),
    true,
  );

  // --- 4. Résultat inconclusif ---------------------------------------------
  // Le point qui compte : on ne conclut pas, on dit qu'il manque des données.
  for (const verdict of ["insuffisant", "en_cours", null]) {
    const unresolved = guidanceFor(
      { key: "frais-caches", title: "Frais de port cachés", category: "conversion" },
      [attempt({ verdict })],
    );
    t.check(`un verdict « ${verdict} » n'écarte pas la piste`, unresolved.action, "reformuler");
    t.check(
      `un verdict « ${verdict} » demande des données`,
      unresolved.reason.includes("Il manque des données"),
      true,
    );
    t.check(
      `un verdict « ${verdict} » interdit de conclure`,
      unresolved.reason.includes("ne conclus pas"),
      true,
    );
  }

  // --- 5. Même correction déjà tentée --------------------------------------
  const sameProblem = compareToHistory(
    { key: "frais-caches", title: "Reformulé autrement", category: "boutique" },
    [attempt()],
  );
  t.check("la même clé vaut identité, même titre changé", sameProblem.similarity, "identique");
  t.check("et même domaine changé", sameProblem.match?.title, "Frais de port cachés");

  const sameTitle = compareToHistory({ title: "Frais de port cachés" }, [
    attempt({ key: null, title: "Frais de port cachés" }),
  ]);
  t.check("sans clé, le titre suffit à reconnaître", sameTitle.similarity, "identique");

  // --- 6. Correction similaire mais différente ------------------------------
  // Même domaine, même méthode, autre problème : à ne pas bloquer, mais à
  // faire justifier. C'est la nuance qui évite de refaire la même erreur
  // ailleurs sans s'en apercevoir.
  const similar = guidanceFor(
    { key: "autre-probleme", title: "Bandeau de réassurance absent", category: "conversion" },
    [attempt({ verdict: "nul" })],
  );
  t.check("une piste voisine n'est pas écartée", similar.action, "reformuler");
  t.check("elle est reconnue comme similaire", similar.similarity, "similaire");
  t.check(
    "on exige de dire en quoi elle diffère",
    similar.reason.includes("Explique en quoi celle-ci est différente"),
    true,
  );
  t.check(
    "une piste voisine d'une réussite passe sans réserve",
    guidanceFor({ key: "autre", title: "Autre", category: "conversion" }, [
      attempt({ verdict: "confirme" }),
    ]).action,
    "proposer",
  );
  t.check(
    "un domaine différent n'est pas une ressemblance",
    compareToHistory({ key: "autre", title: "Autre", category: "acquisition" }, [attempt()])
      .similarity,
    "nouveau",
  );
  t.check(
    "un outil différent n'est pas une ressemblance",
    compareToHistory(
      { key: "autre", title: "Autre", category: "conversion", tool: "update_product" },
      [attempt({ tool: null })],
    ).similarity,
    "nouveau",
  );

  // --- Piste neuve ----------------------------------------------------------
  const fresh = guidanceFor({ key: "neuf", title: "Neuf", category: "retention" }, [attempt()]);
  t.check("une piste jamais tentée passe", fresh.action, "proposer");
  t.check("sans correspondance", fresh.match, null);
  t.check(
    "sans historique du tout, tout passe",
    guidanceFor({ key: "x", title: "X", category: "offre" }, []).action,
    "proposer",
  );

  // --- 7. Plusieurs corrections successives ---------------------------------
  const history: Attempt[] = [
    attempt({ key: "frais-caches", title: "Frais de port cachés", verdict: "confirme" }),
    attempt({ key: "reassurance", title: "Réassurance absente", verdict: "nul" }),
    attempt({
      key: "budget-meta",
      title: "Budget Meta",
      category: "acquisition",
      tool: "meta_update_budget",
      verdict: "regression",
      rollbackPossible: true,
    }),
    attempt({
      key: "relance-panier",
      title: "Relance panier",
      category: "retention",
      verdict: "en_cours",
    }),
  ];

  const proposals = [
    { key: "frais-caches", title: "Frais de port cachés", category: "conversion" },
    { key: "reassurance", title: "Réassurance absente", category: "conversion" },
    { key: "budget-meta", title: "Budget Meta", category: "acquisition" },
    { key: "relance-panier", title: "Relance panier", category: "retention" },
    { key: "checkout-lent", title: "Checkout lent", category: "operations" },
  ];

  const reviewed = applyHistory(proposals, history);
  t.check(
    "les deux pistes déjà tranchées sont retirées",
    reviewed.dropped.map((d) => d.finding.key),
    ["frais-caches", "reassurance"],
  );
  t.check(
    "les trois autres restent",
    reviewed.kept.map((k) => k.finding.key),
    ["budget-meta", "relance-panier", "checkout-lent"],
  );
  t.check(
    "la régression est priorisée",
    reviewed.kept.find((k) => k.finding.key === "budget-meta")!.guidance.action,
    "prioriser",
  );
  t.check(
    "l'inconclusif est à reformuler",
    reviewed.kept.find((k) => k.finding.key === "relance-panier")!.guidance.action,
    "reformuler",
  );
  t.check(
    "la piste neuve passe telle quelle",
    reviewed.kept.find((k) => k.finding.key === "checkout-lent")!.guidance.action,
    "proposer",
  );

  // Un rapport vide ne rend service à personne : si la mémoire a tout écarté,
  // mieux vaut tout garder avec l'explication qu'une page blanche.
  const allKnown = applyHistory(
    [{ key: "frais-caches", title: "Frais de port cachés", category: "conversion" }],
    [attempt({ verdict: "nul" })],
  );
  t.check("la mémoire ne vide jamais le rapport", allKnown.kept.length, 1);
  t.check("et n'écarte alors rien", allKnown.dropped.length, 0);
  t.check("sans historique, rien n'est écarté", applyHistory(proposals, []).dropped.length, 0);
  t.check("aucune proposition ne fait rien planter", applyHistory([], history).kept.length, 0);

  // --- Ce qu'on injecte dans la demande d'audit ----------------------------
  const empty = historyToPromptBlock([]);
  t.check("sans historique, on le dit au modèle", empty.includes("aucune correction"), true);

  const block = historyToPromptBlock(history);
  t.check("le bloc annonce le nombre de corrections", block.includes("(4)"), true);
  t.check(
    "une correction sans effet interdit la répétition",
    block.includes("NE REPROPOSE PAS"),
    true,
  );
  t.check("une réussite devient un acquis", block.includes("C'est un acquis"), true);
  t.check("une régression est marquée urgente", block.includes("URGENT"), true);
  t.check(
    "un verdict non tranché interdit de conclure",
    block.includes("Ne conclus rien dessus"),
    true,
  );
  t.check("chaque correction est datée", (block.match(/le \d+ \w+ 2026/g) ?? []).length, 4);
  t.check(
    "la règle absolue est rappelée",
    block.includes("RÈGLE ABSOLUE SUR CET HISTORIQUE"),
    true,
  );

  // --- L'explication en cinq temps -----------------------------------------
  // Sans le cinquième point — en quoi c'est différent — les quatre premiers ne
  // sont qu'un historique.
  const story = explainAttempt(similar, {
    key: "autre-probleme",
    title: "Bandeau de réassurance absent",
    category: "conversion",
    rootCause: "Les visiteurs n'ont aucun signal de confiance avant de payer.",
  });
  t.check("ce qui a été tenté est nommé", story.tried.includes("Frais de port cachés"), true);
  t.check("avec sa date", story.tried.includes("10 juillet 2026"), true);
  t.check("le pourquoi vient de la cause racine", story.why.includes("signal de confiance"), true);
  t.check("le résultat est dit", story.result.includes("Ça n'a rien changé"), true);
  t.check("la suite est nommée", story.next.includes("mais autrement"), true);
  t.check(
    "la différence est expliquée",
    story.difference.includes("Même domaine et même méthode"),
    true,
  );

  const untried = explainAttempt(fresh, { key: "neuf", title: "Neuf", category: "retention" });
  t.check("une piste neuve le dit", untried.tried.includes("Rien n'a encore été tenté"), true);
  t.check("et n'invente aucune mesure", untried.result.includes("Aucune mesure disponible"), true);
  t.check("sa différence est qu'elle est neuve", untried.difference.includes("Piste neuve"), true);

  const undoStory = explainAttempt(regressed, { key: "budget-meta", title: "Budget Meta" });
  t.check("annuler n'est pas une nouvelle tentative", undoStory.next.includes("Annuler"), true);
  t.check(
    "et c'est dit explicitement",
    undoStory.difference.includes("le retour à l'état d'avant"),
    true,
  );

  // --- Les deux barrières ---------------------------------------------------
  // La consigne de prompt réduit les répétitions ; seule la mécanique les
  // empêche. Les deux doivent être branchées.
  const runner = read("src/lib/audit-runner.server.ts");
  t.check("l'audit charge la mémoire de la boutique", runner.includes("fix_attempts"), true);
  t.check("il l'injecte dans la demande", runner.includes("historyToPromptBlock"), true);
  t.check("et la fait trancher après le modèle", runner.includes("applyHistory"), true);
  t.check(
    "la mémoire est chargée avant l'appel au modèle",
    runner.indexOf("historyToPromptBlock") < runner.indexOf("aiChatCompletion({"),
    true,
  );
  t.check(
    "une mémoire illisible n'empêche pas l'audit",
    /catch \(err\) \{[\s\S]{0,120}mémoire des corrections illisible/.test(runner),
    true,
  );
  t.check("la décision est conservée sur le problème", runner.includes("history_action"), true);

  const tracking = read("src/lib/tracking.server.ts");
  t.check("chaque mesure alimente la mémoire", tracking.includes("fix_attempts"), true);
  t.check(
    "la mémoire est indexée par boutique et signature",
    tracking.includes('onConflict: "store_id,signature"'),
    true,
  );
  t.check(
    "une écriture de mémoire ratée ne perd pas le verdict",
    tracking.includes("mémoire non écrite"),
    true,
  );

  const plan = read("src/lib/next-move.ts");
  t.check("le plan tient compte de la mémoire", plan.includes("history_action"), true);
  t.check("une régression passe devant le score", plan.includes("prioriser: 0"), true);
  t.check("et l'explication remonte au marchand", plan.includes("historyNote"), true);

  // La mémoire ne doit pas être réécrivable depuis le navigateur : elle décide
  // de ce que l'audit s'interdit de proposer.
  const migration = read("supabase/migrations/20260815180000_fix_attempts.sql");
  t.check(
    "la mémoire n'est pas modifiable par le navigateur",
    /REVOKE ALL ON public\.fix_attempts FROM authenticated/.test(migration),
    true,
  );
  t.check(
    "elle reste lisible par son propriétaire",
    /GRANT SELECT ON public\.fix_attempts TO authenticated/.test(migration),
    true,
  );
  t.check(
    "la table est protégée par RLS",
    /ALTER TABLE public\.fix_attempts ENABLE ROW LEVEL SECURITY/.test(migration),
    true,
  );
  t.check(
    "la migration est rejouable",
    migration.includes("CREATE TABLE IF NOT EXISTS") &&
      migration.includes("DROP POLICY IF EXISTS") &&
      migration.includes("ADD COLUMN IF NOT EXISTS"),
    true,
  );
  for (const forbidden of ["DROP TABLE", "TRUNCATE", "DELETE FROM"]) {
    t.check(
      `la migration ne contient pas « ${forbidden} »`,
      new RegExp(forbidden, "i").test(migration),
      false,
    );
  }
});
