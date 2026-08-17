import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EXECUTION_UNKNOWN_AFTER_MINUTES,
  PROPOSAL_TTL_MINUTES,
  canConfirmProposal,
  canRevertAction,
  executionNotice,
  executionOutcome,
  isSettledExecution,
} from "../../src/lib/action-plan";
import {
  BUDGET_ABSOLUTE_CAP,
  BUDGET_RESTORE_SANITY_CAP,
  guardDailyBudget,
  guardRestoreBudget,
  parseRevertPayload,
} from "../../src/lib/action-guards";
import { defineSuite } from "../../tests/harness";

/**
 * CORRIGER MAINTENANT, du bouton jusqu'au compte du marchand.
 *
 * CE QUI EST EN JEU. Ce chemin est le seul qui écrit chez Shopify, Meta et
 * Google. Une erreur y coûte de l'argent réel, immédiatement : un code promo
 * créé deux fois, un budget doublé, une campagne coupée sans retour possible.
 * Les cinq défauts vérifiés ici ont tous été trouvés en relisant le chemin
 * complet — aucun n'était visible depuis un écran.
 *
 * CE QUE CES CONTRÔLES NE PROUVENT PAS. Qu'une correction s'applique
 * réellement en production. Ils portent sur les DÉCISIONS prises avant et après
 * l'appel partenaire, qui sont pures et donc vérifiables ici. L'appel lui-même
 * ne se vérifie que sur un vrai compte.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/** Retire les commentaires : une assertion doit porter sur du code, pas sur sa doc. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

const MINUTE = 60_000;

export default defineSuite("Actions — exécution, issue et réversibilité", (t) => {
  // =========================================================================
  // 1. DÉFAUT : une écriture interrompue restait affichée comme appliquée
  // =========================================================================
  // Le verrou d'idempotence doit basculer la ligne AVANT l'appel partenaire.
  // Entre ce basculement et la réponse, l'issue est inconnue — et c'est
  // exactement là qu'un worker peut être évincé.

  const now = Date.UTC(2026, 7, 16, 12, 0, 0);
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

  t.check(
    "une écriture en vol depuis 10 s n'est pas dite appliquée",
    executionOutcome({ status: "applied", run_state: "reserve", updated_at: iso(10_000) }, now),
    "en_cours",
  );
  t.check(
    "au-delà du délai, l'issue est déclarée inconnue",
    executionOutcome(
      {
        status: "applied",
        run_state: "reserve",
        updated_at: iso((EXECUTION_UNKNOWN_AFTER_MINUTES + 1) * MINUTE),
      },
      now,
    ),
    "issue_inconnue",
  );
  t.check(
    "et jamais échouée : rien ne prouve que l'écriture n'est pas partie",
    executionOutcome(
      { status: "applied", run_state: "reserve", updated_at: iso(60 * MINUTE) },
      now,
    ) === "echouee",
    false,
  );
  t.check(
    "une écriture dont le partenaire a répondu est appliquée",
    executionOutcome({ status: "applied", run_state: "ecrit", updated_at: iso(MINUTE) }, now),
    "appliquee",
  );
  t.check(
    "une ligne antérieure à la colonne reste appliquée",
    executionOutcome({ status: "applied", run_state: null, updated_at: iso(90 * 86_400_000) }, now),
    "appliquee",
  );
  t.check(
    "un horodatage illisible ne vaut pas « encore en vol »",
    executionOutcome({ status: "applied", run_state: "reserve", updated_at: "pas une date" }, now),
    "issue_inconnue",
  );
  t.check(
    "un horodatage absent non plus",
    executionOutcome({ status: "applied", run_state: "reserve", updated_at: null }, now),
    "issue_inconnue",
  );
  t.check(
    "une proposition non confirmée n'a rien exécuté",
    executionOutcome({ status: "proposed", run_state: null, updated_at: iso(MINUTE) }, now),
    "proposee",
  );
  t.check(
    "un échec reste un échec",
    executionOutcome({ status: "failed", run_state: "echoue", updated_at: iso(MINUTE) }, now),
    "echouee",
  );
  t.check(
    "une annulation prime sur l'issue de l'application",
    executionOutcome({ status: "reverted", run_state: "ecrit", updated_at: iso(MINUTE) }, now),
    "annulee",
  );

  // Ce que le marchand lit. Une issue inconnue doit dire trois choses :
  // qu'on ne sait pas, qu'il faut vérifier, et qu'on ne rejouera pas seul.
  const notice = executionNotice("issue_inconnue", "la campagne « Hiver »");
  t.check("l'issue inconnue s'annonce comme telle", notice.includes("Nous ne savons pas"), true);
  t.check("elle nomme la cible", notice.includes("la campagne « Hiver »"), true);
  t.check("elle renvoie à une vérification chez le partenaire", /[Vv]érifie/.test(notice), true);
  t.check(
    "et elle promet de ne rien rejouer seule",
    notice.includes("nous ne rejouons rien"),
    true,
  );
  t.check(
    "aucune formulation d'issue ne prétend un succès à tort",
    (["en_cours", "issue_inconnue"] as const).some((o) =>
      executionNotice(o, null).includes("Appliquée"),
    ),
    false,
  );

  t.check("une écriture en vol n'est pas réglée", isSettledExecution("en_cours"), false);
  t.check("une issue inconnue non plus", isSettledExecution("issue_inconnue"), false);
  t.check("une application l'est", isSettledExecution("appliquee"), true);
  t.check("un échec aussi", isSettledExecution("echouee"), true);

  // Le code, et pas seulement la décision : la réservation ne doit plus poser
  // la date d'application, sans quoi la distinction ne servirait à rien.
  const journal = codeOnly(read("src/lib/actions.server.ts"));
  const claim = journal.slice(journal.indexOf("export async function claimProposal"));
  const claimBody = claim.slice(0, claim.indexOf("export async function markFailed"));
  t.check(
    "la réservation marque l'écriture en vol",
    claimBody.includes('run_state: "reserve"'),
    true,
  );
  t.check("et ne pose aucune date d'application", claimBody.includes("applied_at: null"), true);
  t.check(
    "elle reste conditionnée à l'état « proposé »",
    claimBody.includes('.eq("status", "proposed")'),
    true,
  );
  const finalize = journal.slice(journal.indexOf("export async function finalizeApplied"));
  t.check(
    "seule la finalisation date l'application",
    finalize.includes("applied_at: new Date()"),
    true,
  );
  t.check("et marque l'écriture consignée", finalize.includes('run_state: "ecrit"'), true);

  // =========================================================================
  // 2. DÉFAUT : deux propositions sur un même problème, deux écritures
  // =========================================================================
  // La vérification de fraîcheur protège tout ce qui ÉCRASE un état. Elle ne
  // protège RIEN sur les actions additives, dont l'état antérieur est vide par
  // nature : `create_discount_code` (null) et `google_add_negative_keywords` ({}).

  const base = {
    status: "proposed" as const,
    hasFindingId: true,
    expiresAt: new Date(now + 10 * MINUTE).toISOString(),
    alreadyAppliedOnFinding: false,
    now,
  };

  t.check("une proposition fraîche et seule est confirmable", canConfirmProposal(base).ok, true);

  const duplicate = canConfirmProposal({ ...base, alreadyAppliedOnFinding: true });
  t.check("une seconde correction sur le même problème est refusée", duplicate.ok, false);
  t.check(
    "et le refus dit comment repartir proprement",
    !duplicate.ok && duplicate.reason.includes("annulez la première"),
    true,
  );

  const expired = canConfirmProposal({
    ...base,
    expiresAt: new Date(now - MINUTE).toISOString(),
  });
  t.check("une proposition périmée est refusée", expired.ok, false);
  t.check(
    "et le refus rappelle la durée de validité",
    !expired.ok && expired.reason.includes(String(PROPOSAL_TTL_MINUTES)),
    true,
  );

  t.check(
    "une proposition déjà appliquée n'est pas rejouable",
    canConfirmProposal({ ...base, status: "applied" }).ok,
    false,
  );
  t.check(
    "une proposition échouée non plus",
    canConfirmProposal({ ...base, status: "failed" }).ok,
    false,
  );
  t.check(
    "une proposition sans problème d'origine est refusée",
    canConfirmProposal({ ...base, hasFindingId: false }).ok,
    false,
  );
  // L'ordre des refus compte : le doublon est vérifié même sans date d'expiration.
  t.check(
    "une proposition sans expiration reste soumise à la barrière du doublon",
    canConfirmProposal({ ...base, expiresAt: null, alreadyAppliedOnFinding: true }).ok,
    false,
  );

  const journalDuplicate = journal.slice(journal.indexOf("hasAppliedActionOnFinding"));
  t.check(
    "la barrière interroge bien les actions appliquées du problème",
    journalDuplicate.includes('.eq("status", "applied")'),
    true,
  );
  t.check(
    "en excluant la proposition en cours de confirmation",
    journalDuplicate.includes('.neq("id", exceptActionId)'),
    true,
  );
  const confirmCode = codeOnly(read("src/lib/actions.functions.ts"));
  t.check(
    "et la confirmation l'appelle avant d'écrire",
    confirmCode.indexOf("hasAppliedActionOnFinding(") <
      confirmCode.indexOf("executePlannedAction("),
    true,
  );

  // =========================================================================
  // 3. DÉFAUT : une correction facturée, jamais appliquée, jamais remboursée
  // =========================================================================
  // L'unité est décomptée à la proposition, avant l'appel au modèle. Si
  // l'exécution confirmée échoue — état amont modifié, cible disparue,
  // partenaire en erreur — rien n'a été livré.

  t.check("l'échec d'exécution rembourse l'unité", confirmCode.includes("refundQuota"), true);
  const failureBlock = confirmCode.slice(confirmCode.indexOf("await markFailed(journal as never"));
  t.check(
    "le remboursement suit immédiatement le marquage de l'échec",
    failureBlock.slice(0, 600).includes("refundQuota"),
    true,
  );
  t.check(
    "un remboursement raté ne masque pas la cause de l'échec",
    failureBlock.slice(0, 800).includes(".catch("),
    true,
  );
  t.check(
    "et l'erreur d'origine est toujours propagée",
    failureBlock.slice(0, 900).includes("throw err"),
    true,
  );

  // =========================================================================
  // 4. DÉFAUT : une baisse de budget partant d'un montant élevé était définitive
  // =========================================================================
  // `guardDailyBudget` plafonne les hausses. Rétablir un budget que le marchand
  // avait fixé au-dessus de ce plafond était donc lu comme une hausse interdite,
  // alors que l'aperçu avait promis un retour à l'état précédent.

  const highBudget = BUDGET_ABSOLUTE_CAP + 20;
  const asIncrease = guardDailyBudget({
    targetLabel: "« Hiver »",
    currency: "EUR",
    requested: highBudget,
    currentDailyBudget: 60,
  });
  t.check(
    "porter un budget au-delà du plafond reste refusé sur une correction",
    asIncrease.ok,
    false,
  );

  const asRestore = guardRestoreBudget({
    targetLabel: "« Hiver »",
    currency: "EUR",
    previousDailyBudget: highBudget,
  });
  t.check(
    "mais le rétablir après notre propre baisse est autorisé",
    asRestore.ok && asRestore.value,
    highBudget,
  );

  const belowFloor = guardRestoreBudget({
    targetLabel: "« Hiver »",
    currency: "EUR",
    previousDailyBudget: 3,
  });
  t.check(
    "un budget antérieur sous notre plancher est rétabli tel quel",
    belowFloor.ok && belowFloor.value,
    3,
  );

  for (const [label, value] of [
    ["zéro", 0],
    ["négatif", -10],
    ["non fini", Number.NaN],
  ] as Array<[string, number]>) {
    t.check(
      `un budget antérieur ${label} n'est pas écrit à l'aveugle`,
      guardRestoreBudget({ targetLabel: "« Hiver »", currency: "EUR", previousDailyBudget: value })
        .ok,
      false,
    );
  }
  t.check(
    "un montant aberrant est refusé plutôt qu'écrit",
    guardRestoreBudget({
      targetLabel: "« Hiver »",
      currency: "EUR",
      previousDailyBudget: BUDGET_RESTORE_SANITY_CAP + 1,
    }).ok,
    false,
  );

  const revertCode = codeOnly(read("src/lib/revert.server.ts"));
  t.check(
    "l'annulation n'utilise plus le plafond des hausses",
    revertCode.includes("guardDailyBudget"),
    false,
  );
  t.check(
    "elle passe par le garde-fou de rétablissement",
    (revertCode.match(/guardRestoreBudget\(/g) ?? []).length,
    2,
  );

  // =========================================================================
  // 5. DÉFAUT : la correction Shopify la plus fréquente n'était pas annulable
  // =========================================================================
  // Réécrire une fiche SANS description est le cas nominal. L'état antérieur
  // est alors vide — et le schéma d'annulation exigeait un texte non vide, donc
  // refusait de rétablir précisément ce cas-là.

  const emptyBefore = parseRevertPayload("update_product", {
    before: { title: "Bougie parfumée", body_html: "" },
    after: {},
  });
  t.check("une fiche sans description reste annulable", emptyBefore.ok, true);

  const nullBefore = parseRevertPayload("update_product", {
    before: { title: "Bougie parfumée", body_html: null },
    after: {},
  });
  t.check("une description absente est lue comme vide", nullBefore.ok, true);
  t.check(
    "et rétablie comme une chaîne vide, pas comme un null",
    nullBefore.ok && nullBefore.value.before.body_html,
    "",
  );

  const missingBefore = parseRevertPayload("update_product", {
    before: { title: "Bougie parfumée" },
    after: {},
  });
  t.check("une clé absente est traitée de même", missingBefore.ok, true);

  t.check(
    "un titre vide reste refusé : Shopify n'accepte pas un produit sans titre",
    parseRevertPayload("update_product", { before: { title: "", body_html: "x" }, after: {} }).ok,
    false,
  );

  const restored = parseRevertPayload("update_product", {
    before: { title: "Bougie parfumée", body_html: "<p>Texte d'origine</p>" },
    after: {},
  });
  t.check(
    "une description réelle est rétablie à l'identique",
    restored.ok && restored.value.before.body_html,
    "<p>Texte d'origine</p>",
  );

  // =========================================================================
  // 6. L'annulation d'une écriture dont l'issue est inconnue
  // =========================================================================
  // Annuler ce qui n'est peut-être jamais parti, c'est écrire à l'aveugle.

  const revertBase = {
    status: "applied" as const,
    run_state: "ecrit" as const,
    updated_at: iso(MINUTE),
    hasFindingId: true,
    now,
  };
  t.check("une écriture consignée est annulable", canRevertAction(revertBase).ok, true);
  t.check(
    "une écriture en vol ne l'est pas",
    canRevertAction({ ...revertBase, run_state: "reserve" }).ok,
    false,
  );
  t.check(
    "une issue inconnue non plus",
    canRevertAction({
      ...revertBase,
      run_state: "reserve",
      updated_at: iso((EXECUTION_UNKNOWN_AFTER_MINUTES + 1) * MINUTE),
    }).ok,
    false,
  );
  t.check(
    "une action jamais appliquée n'a rien à annuler",
    canRevertAction({ ...revertBase, status: "proposed" }).ok,
    false,
  );
  const twice = canRevertAction({ ...revertBase, status: "reverted" });
  t.check("une annulation ne se rejoue pas", twice.ok, false);
  t.check("et le dit clairement", !twice.ok && twice.reason.includes("déjà été annulée"), true);
  t.check(
    "une ligne antérieure à la colonne reste annulable",
    canRevertAction({ ...revertBase, run_state: null }).ok,
    true,
  );

  // La même règle est posée en base, pour le cas où deux onglets courent.
  const claimRevert = journal.slice(journal.indexOf("export async function claimRevert"));
  t.check(
    "la réservation d'annulation exclut les écritures en vol",
    claimRevert.includes("run_state.is.null,run_state.neq.reserve"),
    true,
  );
  t.check(
    "elle reste conditionnée à l'état appliqué",
    claimRevert.includes('.eq("status", "applied")'),
    true,
  );

  // =========================================================================
  // 7. L'interface n'annonce jamais un résultat qu'elle ne connaît pas
  // =========================================================================
  const page = codeOnly(read("src/routes/_authenticated/audits.$auditId.tsx"));
  t.check(
    "l'écran classe les actions par issue constatée, pas par statut",
    page.includes('a.outcome === "appliquee"'),
    true,
  );
  t.check(
    "et il affiche explicitement les issues inconnues",
    page.includes("unknownActionByFinding"),
    true,
  );
  t.check(
    "le bouton d'annulation ne s'ouvre que sur une action réellement appliquée",
    page.includes("appliedActionByFinding.set"),
    true,
  );

  // =========================================================================
  // 8. La migration reste additive et rejouable
  // =========================================================================
  const migrationSource = read("supabase/migrations/20260816200000_action_execution.sql");
  // Les commentaires SQL expliquent pourquoi `ALTER TYPE` est proscrit ici : une
  // assertion naïve trouverait la mention et conclurait l'inverse du code.
  const migration = migrationSource
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  t.check(
    "la colonne est ajoutée sans écraser",
    migration.includes("ADD COLUMN IF NOT EXISTS"),
    true,
  );
  t.check("la contrainte n'est posée qu'une fois", migration.includes("pg_constraint"), true);
  t.check("l'index est rejouable", migration.includes("CREATE INDEX IF NOT EXISTS"), true);
  t.check(
    "aucune valeur d'énumération n'est ajoutée : impossible sous db push",
    /ALTER TYPE/.test(migration),
    false,
  );
  t.check(
    "les trois états d'exécution sont contraints en base",
    ["'reserve'", "'ecrit'", "'echoue'"].every((state) => migration.includes(state)),
    true,
  );
  t.check("aucune donnée n'est supprimée", /DROP|DELETE|TRUNCATE/.test(migration), false);
});
