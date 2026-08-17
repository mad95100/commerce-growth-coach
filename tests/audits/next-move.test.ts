import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MEASURE_BY_CATEGORY,
  buildNextMovePlan,
  isTechnicalConstat,
  type PlannableFinding,
} from "../../src/lib/next-move";
import { defineSuite } from "../harness";

/**
 * Le prochain geste, et pourquoi celui-là.
 *
 * CE QUI EST EN JEU. Le centre de pilotage proposait les trois problèmes au
 * plus haut score, sans regarder la chaîne causale. Il pouvait donc mettre en
 * tête un symptôme dont la cause était encore en place — le marchand corrige,
 * ne voit aucun effet, et perd confiance dans l'outil. Ces contrôles portent
 * sur la seule règle qui l'empêche : rien n'est proposé tant que ce qui le
 * cause n'est pas corrigé.
 *
 * Deuxième enjeu, moins visible : `audit_findings` est modifiable depuis le
 * navigateur. `caused_by` peut donc contenir n'importe quoi, y compris de quoi
 * bloquer tous les problèmes à la fois. Un écran de pilotage vide serait la
 * pire des réponses.
 */

function make(overrides: Partial<PlannableFinding> = {}): PlannableFinding {
  return {
    id: "id-a",
    title: "Problème A",
    category: "conversion",
    status: "todo",
    finding_key: "a",
    caused_by: [],
    priority_score: 100,
    priority_band: "important",
    priority_reason: "Sévérité élevée. Établi sur tes données réelles.",
    epistemic_level: "fait",
    estimated_gain_min: 200,
    estimated_gain_max: 400,
    time_minutes: 30,
    blocks_count: 0,
    auto_correction: null,
    sort_order: 0,
    audit_id: "audit-1",
    ...overrides,
  };
}

export default defineSuite("Audits — le prochain geste", (t) => {
  // --- Rien à faire ---------------------------------------------------------
  const empty = buildNextMovePlan([]);
  t.check("sans problème, aucun geste", empty.now, null);
  t.check("et rien derrière", [empty.then.length, empty.blocked.length], [0, 0]);
  t.check(
    "la réponse invite à relancer un diagnostic",
    empty.rationale.includes("Relancez un diagnostic"),
    true,
  );

  const allDone = buildNextMovePlan([
    make({ id: "1", status: "done" }),
    make({ id: "2", finding_key: "b", status: "done" }),
  ]);
  t.check("tout corrigé équivaut à rien à faire", allDone.now, null);

  // --- Le cas nominal -------------------------------------------------------
  const simple = buildNextMovePlan([
    make({ id: "1", title: "Petit", priority_score: 20, finding_key: "petit" }),
    make({ id: "2", title: "Gros", priority_score: 900, finding_key: "gros" }),
    make({ id: "3", title: "Moyen", priority_score: 300, finding_key: "moyen" }),
  ]);
  t.check("le plus urgent passe en premier", simple.now?.title, "Gros");
  t.check(
    "les deux suivants sont proposés",
    simple.then.map((m) => m.title),
    ["Moyen", "Petit"],
  );
  t.check("pas plus de deux", simple.then.length, 2);
  t.check("rien n'est bloqué", simple.blocked.length, 0);
  t.check("l'audit d'origine est transmis", simple.now?.auditId, "audit-1");
  t.check(
    "la réponse nomme le geste",
    simple.rationale.startsWith("Si cette boutique était la mienne, je commencerais par « Gros »."),
    true,
  );

  // Quatre problèmes, trois affichés : au-delà, ce n'est plus un plan.
  const many = buildNextMovePlan(
    [1, 2, 3, 4, 5].map((n) =>
      make({ id: `${n}`, finding_key: `k${n}`, title: `P${n}`, priority_score: 100 - n }),
    ),
  );
  t.check("trois gestes au plus", 1 + many.then.length, 3);

  // --- LA règle : jamais un symptôme avant sa cause ------------------------
  // Le symptôme a un score bien supérieur. Le proposer d'abord serait le
  // comportement d'avant, et il ne produirait rien.
  const chained = buildNextMovePlan([
    make({ id: "cause", title: "Frais de port cachés", finding_key: "frais", priority_score: 50 }),
    make({
      id: "symptome",
      title: "Panier abandonné",
      finding_key: "panier",
      caused_by: ["frais"],
      priority_score: 900,
    }),
  ]);
  t.check(
    "la cause est proposée malgré son score inférieur",
    chained.now?.title,
    "Frais de port cachés",
  );
  t.check("le symptôme n'est pas dans les gestes suivants", chained.then.length, 0);
  t.check(
    "il est annoncé comme en attente",
    chained.blocked.map((b) => b.title),
    ["Panier abandonné"],
  );
  t.check("et on dit ce qui le retient", chained.blocked[0].blockedBy, ["Frais de port cachés"]);
  t.check(
    "la réponse annonce ce que la correction fait tomber",
    chained.rationale.includes("fait tomber « Panier abandonné » du même coup"),
    true,
  );

  // --- Le plan se recompose à mesure qu'on avance --------------------------
  const afterFix = buildNextMovePlan([
    make({
      id: "cause",
      title: "Frais de port cachés",
      finding_key: "frais",
      priority_score: 50,
      status: "done",
    }),
    make({
      id: "symptome",
      title: "Panier abandonné",
      finding_key: "panier",
      caused_by: ["frais"],
      priority_score: 900,
    }),
  ]);
  t.check("une cause corrigée ne bloque plus", afterFix.now?.title, "Panier abandonné");
  t.check("et plus rien n'est en attente", afterFix.blocked.length, 0);
  t.check("le symptôme débloqué n'annonce plus de conséquence", afterFix.now?.unlocks, []);

  // --- Chaîne à trois maillons ---------------------------------------------
  const deep = buildNextMovePlan([
    make({ id: "1", title: "Racine", finding_key: "r", priority_score: 10 }),
    make({ id: "2", title: "Milieu", finding_key: "m", caused_by: ["r"], priority_score: 500 }),
    make({ id: "3", title: "Bout", finding_key: "b", caused_by: ["m"], priority_score: 800 }),
  ]);
  t.check("seule la racine est exécutable", deep.now?.title, "Racine");
  t.check("les deux autres attendent", deep.blocked.length, 2);
  // Les problèmes en attente sont eux aussi classés par urgence : « Bout »,
  // plus lourd, s'affiche avant « Milieu ». Chacun n'annonce que ce qui le
  // retient DIRECTEMENT — remonter toute la chaîne noierait l'information.
  t.check(
    "chacun sait ce qu'il attend",
    deep.blocked.map((b) => [b.title, ...b.blockedBy]),
    [
      ["Bout", "Milieu"],
      ["Milieu", "Racine"],
    ],
  );
  t.check("la racine n'annonce que sa conséquence directe", deep.now?.unlocks, ["Milieu"]);

  // --- Plusieurs causes pour un même problème ------------------------------
  const multi = buildNextMovePlan([
    make({ id: "1", title: "Cause A", finding_key: "ca", priority_score: 100 }),
    make({ id: "2", title: "Cause B", finding_key: "cb", priority_score: 90 }),
    make({
      id: "3",
      title: "Effet",
      finding_key: "e",
      caused_by: ["ca", "cb"],
      priority_score: 999,
    }),
  ]);
  t.check(
    "les deux causes passent d'abord",
    [multi.now?.title, multi.then[0]?.title],
    ["Cause A", "Cause B"],
  );
  t.check("l'effet attend les deux", multi.blocked[0].blockedBy, ["Cause A", "Cause B"]);

  // --- Ce que l'audit ne sait pas ------------------------------------------
  const unsure = buildNextMovePlan([
    make({ id: "1", title: "Sûr", finding_key: "s", priority_score: 500 }),
    make({
      id: "2",
      title: "Pas sûr",
      finding_key: "p",
      priority_score: 400,
      epistemic_level: "donnee_manquante",
    }),
  ]);
  t.check(
    "les conclusions non établies sont listées à part",
    unsure.unknowns.map((u) => u.title),
    ["Pas sûr"],
  );
  t.check(
    "la réserve est dite dans la réponse",
    unsure.rationale.includes("je n'ai pas la donnée pour trancher"),
    true,
  );
  t.check(
    "une conclusion établie n'est pas mise en réserve",
    buildNextMovePlan([make()]).unknowns.length,
    0,
  );

  // --- La mesure fait partie de la réponse ---------------------------------
  // Annoncer quoi regarder sans dire sur quelle fenêtre invite à conclure trop
  // tôt, et à défaire une correction qui marchait.
  t.check(
    "la mesure dépend du domaine",
    buildNextMovePlan([make({ category: "acquisition" })]).now?.measure,
    MEASURE_BY_CATEGORY.acquisition,
  );
  t.check(
    "un domaine inconnu garde une mesure par défaut",
    buildNextMovePlan([make({ category: "cosmos" })]).now?.measure.includes("7 jours"),
    true,
  );
  for (const [domaine, mesure] of Object.entries(MEASURE_BY_CATEGORY)) {
    t.check(`la mesure de « ${domaine} » annonce sa fenêtre`, /\d+\s+jours/.test(mesure), true);
  }
  t.check(
    "la réponse dit quoi regarder ensuite",
    buildNextMovePlan([make()]).rationale.includes("c'est ça qui dira si ça a marché"),
    true,
  );
  t.check(
    "la réponse annonce le temps à y passer",
    buildNextMovePlan([make({ time_minutes: 90 })]).rationale.includes("Compte 1.5 h."),
    true,
  );

  // --- Données d'audits antérieurs, sans chaîne causale --------------------
  const legacy = buildNextMovePlan([
    make({
      id: "1",
      title: "Ancien A",
      finding_key: null,
      caused_by: null,
      priority_band: null,
      priority_reason: null,
      epistemic_level: null,
      priority_score: 10,
    }),
    make({
      id: "2",
      title: "Ancien B",
      finding_key: null,
      caused_by: null,
      priority_band: null,
      priority_reason: null,
      epistemic_level: null,
      priority_score: 20,
    }),
  ]);
  t.check("sans chaîne, tout reste exécutable", legacy.blocked.length, 0);
  t.check("l'ordre de priorité s'applique seul", legacy.now?.title, "Ancien B");
  t.check("aucune bande n'est inventée", legacy.now?.band, null);
  t.check("aucune justification n'est inventée", legacy.now?.reason, null);
  t.check(
    "la réponse tient sans justification",
    legacy.rationale.startsWith("Si cette boutique était la mienne"),
    true,
  );

  // --- Entrées hostiles : la table est modifiable depuis le navigateur -----
  const cyclic = buildNextMovePlan([
    make({ id: "1", title: "A", finding_key: "a", caused_by: ["b"], priority_score: 10 }),
    make({ id: "2", title: "B", finding_key: "b", caused_by: ["a"], priority_score: 20 }),
  ]);
  t.check("une boucle ne vide pas l'écran", Boolean(cyclic.now), true);
  t.check("le plus urgent est alors proposé", cyclic.now?.title, "B");

  const selfBlocking = buildNextMovePlan([
    make({ id: "1", title: "Seul", finding_key: "x", caused_by: ["x"] }),
  ]);
  t.check("un problème ne se bloque pas lui-même", selfBlocking.now?.title, "Seul");
  t.check("et n'apparaît pas en attente", selfBlocking.blocked.length, 0);

  const ghost = buildNextMovePlan([
    make({ id: "1", title: "Orphelin", finding_key: "o", caused_by: ["disparu"] }),
  ]);
  t.check("un renvoi vers un problème absent ne bloque pas", ghost.now?.title, "Orphelin");

  const junk = buildNextMovePlan([
    make({ id: "1", title: "Bruit", finding_key: "j", caused_by: { pas: "un tableau" } }),
    make({
      id: "2",
      title: "Autre",
      finding_key: "k",
      caused_by: [null, 42, ""],
      priority_score: 1,
    }),
  ]);
  t.check("un caused_by qui n'est pas un tableau est ignoré", junk.blocked.length, 0);
  t.check("les entrées non textuelles sont ignorées", junk.now?.title, "Bruit");

  const noKeys = buildNextMovePlan([
    make({ id: "1", title: "Sans clé", finding_key: null, caused_by: ["a"] }),
  ]);
  t.check("un problème sans clé reste exécutable", noKeys.now?.title, "Sans clé");

  // --- Champs manquants -----------------------------------------------------
  const bare = buildNextMovePlan([
    {
      id: "1",
      title: "Minimal",
      category: "boutique",
      status: "todo",
    },
  ]);
  t.check("une ligne minimale suffit", bare.now?.title, "Minimal");
  t.check(
    "les montants absents restent nuls",
    [bare.now?.gainMin, bare.now?.gainMax],
    [null, null],
  );
  t.check("aucune correction automatique n'est supposée", bare.now?.hasAutoFix, false);
  t.check("sans durée, la réponse ne parle pas de temps", bare.rationale.includes("Compte"), false);

  t.check(
    "une correction automatique disponible est signalée",
    buildNextMovePlan([make({ auto_correction: { title: "t", content: "c" } })]).now?.hasAutoFix,
    true,
  );

  // --- CORRIGER → MESURER → PROUVER → APPRENDRE ---------------------------
  // Ce que les corrections déjà appliquées ont produit change le plan. Une
  // régression prime sur tout : réparer un dégât passe avant tout gain
  // potentiel, quel que soit le score du problème suivant.
  const withRegression = buildNextMovePlan(
    [make({ id: "1", title: "Le prochain levier", finding_key: "l", priority_score: 900 })],
    [
      {
        findingId: "ancien",
        title: "Budget Meta doublé",
        verdict: "regression",
        headline: "Achats Meta s'est dégradé de -22 % depuis la correction.",
        rollbackRecommended: true,
        rollbackPossible: true,
        actionId: "action-1",
      },
    ],
  );
  t.check("une régression remonte en alerte", withRegression.alert?.title, "Budget Meta doublé");
  t.check("l'annulation automatique est signalée", withRegression.alert?.automatic, true);
  t.check("avec l'action à annuler", withRegression.alert?.actionId, "action-1");
  t.check(
    "la réponse commence par le dégât",
    withRegression.rationale.startsWith(
      "Avant tout : « Budget Meta doublé » a dégradé la situation.",
    ),
    true,
  );
  t.check(
    "elle annonce qu'un bouton suffit",
    withRegression.rationale.includes("un bouton suffit"),
    true,
  );
  // La prochaine action reste proposée : on répare, PUIS on avance.
  t.check("le geste suivant n'est pas annulé", withRegression.now?.title, "Le prochain levier");
  t.check(
    "il est présenté comme la suite",
    withRegression.rationale.includes("Ensuite, je reprendrais par « Le prochain levier »."),
    true,
  );

  const manualRollback = buildNextMovePlan(
    [make({ id: "1", title: "Suite", finding_key: "s" })],
    [
      {
        findingId: "ancien",
        title: "Ciblage modifié",
        verdict: "regression",
        headline: null,
        rollbackRecommended: true,
        rollbackPossible: false,
      },
    ],
  );
  t.check(
    "une annulation manuelle est annoncée comme telle",
    manualRollback.alert?.automatic,
    false,
  );
  t.check(
    "et la marche à suivre est donnée",
    manualRollback.rationale.includes("Revenez en arrière à la main"),
    true,
  );

  // Une régression dont l'annulation n'est PAS recommandée par la mesure ne
  // remonte pas en alerte : c'est `measure.ts` qui décide, pas cet écran.
  const notRecommended = buildNextMovePlan(
    [make({ id: "1", finding_key: "a" })],
    [
      {
        findingId: "x",
        title: "Autre",
        verdict: "regression",
        headline: null,
        rollbackRecommended: false,
        rollbackPossible: true,
      },
    ],
  );
  t.check("sans recommandation, pas d'alerte", notRecommended.alert, null);

  // PROUVER et APPRENDRE : ce qui marche est confirmé, ce qui n'a rien donné
  // est écarté — reproposer la même correction serait absurde.
  const learned = buildNextMovePlan(
    [make({ id: "1", title: "Suite", finding_key: "s" })],
    [
      { findingId: "a", title: "Frais de port affichés", verdict: "confirme", headline: "+18 %" },
      { findingId: "b", title: "Bandeau de réassurance", verdict: "nul", headline: null },
      { findingId: "c", title: "Encore en mesure", verdict: "en_cours", headline: null },
    ],
  );
  t.check(
    "les corrections prouvées sont listées",
    learned.proven.map((p) => p.title),
    ["Frais de port affichés"],
  );
  t.check(
    "les corrections sans effet aussi",
    learned.ineffective.map((p) => p.title),
    ["Bandeau de réassurance"],
  );
  t.check(
    "une mesure en cours n'est ni l'un ni l'autre",
    learned.proven.length + learned.ineffective.length,
    2,
  );
  t.check(
    "ce qui marche est dit",
    learned.rationale.includes("« Frais de port affichés » a bien produit son effet"),
    true,
  );
  t.check(
    "ce qui n'a rien donné est écarté explicitement",
    learned.rationale.includes("inutile d'y revenir"),
    true,
  );

  // Même sans problème restant, l'apprentissage est restitué.
  const doneAndLearned = buildNextMovePlan(
    [make({ id: "1", status: "done" })],
    [{ findingId: "a", title: "Prix revu", verdict: "confirme", headline: null }],
  );
  t.check("tout corrigé n'efface pas ce qu'on a appris", doneAndLearned.proven.length, 1);
  t.check(
    "et la réponse le dit avant d'inviter à relancer",
    doneAndLearned.rationale.indexOf("Prix revu") <
      doneAndLearned.rationale.indexOf("Relancez un diagnostic"),
    true,
  );

  // Sans mesure, le plan est exactement celui d'avant.
  const noOutcomes = buildNextMovePlan([make({ id: "1", finding_key: "a" })]);
  t.check("sans mesure, aucune alerte", noOutcomes.alert, null);
  t.check("aucun apprentissage", [noOutcomes.proven.length, noOutcomes.ineffective.length], [0, 0]);
  t.check(
    "et la réponse garde sa forme d'origine",
    noOutcomes.rationale.startsWith("Si cette boutique était la mienne"),
    true,
  );

  // --- Stabilité ------------------------------------------------------------
  const sample = [
    make({ id: "1", finding_key: "a", priority_score: 100 }),
    make({ id: "2", finding_key: "b", caused_by: ["a"], priority_score: 500 }),
    make({ id: "3", finding_key: "c", priority_score: 100, sort_order: 1 }),
  ];
  t.check(
    "deux appels sur les mêmes données donnent le même plan",
    JSON.stringify(buildNextMovePlan(sample)),
    JSON.stringify(buildNextMovePlan(sample)),
  );
  t.check("à score égal, l'ordre décidé à l'audit tranche", buildNextMovePlan(sample).now?.id, "1");

  // =========================================================================
  // UN CONSTAT TECHNIQUE NE PASSE PAS DEVANT UNE PERTE MESURÉE
  // =========================================================================
  // Le moteur prive déjà un constat purement technique de tout montant et lui
  // interdit la bande « critique ». Cela ne suffisait pas ici : le classement
  // se fait d'abord sur le score, où la sévérité pèse. Une lenteur de serveur
  // annoncée « high » pouvait être proposée comme LE geste à faire maintenant,
  // devant une fuite chiffrée sur les commandes réelles.

  const constatTechnique = make({
    id: "id-tech",
    finding_key: "site-lent",
    title: "Le site met 2,4 secondes à répondre",
    // Le score reste élevé : c'est précisément le cas dangereux. La sévérité
    // pèse dans le score, et rien dans le score ne sait que la preuve est
    // uniquement technique.
    priority_score: 900,
    estimated_gain_min: null,
    estimated_gain_max: null,
    evidence: { based_on: "storefront.response_ms : 2 400 ms", assumptions: null },
  });
  const perteMesuree = make({
    id: "id-fuite",
    finding_key: "frais-caches",
    title: "Les frais de port apparaissent au paiement",
    priority_score: 120,
    estimated_gain_min: 2000,
    estimated_gain_max: 6000,
    evidence: { based_on: "shopify.cart_abandonment_rate : 78 %", assumptions: null },
  });

  const arbitre = buildNextMovePlan([constatTechnique, perteMesuree]);
  t.check(
    "malgré un score supérieur, le constat technique ne devient pas le geste",
    arbitre.now?.id,
    "id-fuite",
  );
  t.check(
    "il n'est pas caché pour autant",
    arbitre.technical.map((item) => item.id),
    ["id-tech"],
  );
  t.check(
    "et la réponse du directeur dit pourquoi il ne passe pas devant",
    arbitre.rationale.includes("rien ne mesure encore ce qu'il coûte"),
    true,
  );
  t.check(
    "il reste dans la suite du plan, pas écarté du travail",
    arbitre.then.some((move) => move.id === "id-tech"),
    true,
  );

  // LA CONTREPARTIE, qui rend la règle juste. Sur une boutique où rien n'est
  // chiffrable, le constat technique est le meilleur geste disponible : le
  // proposer est alors la bonne réponse, pas un pis-aller.
  const rienDeChiffre = buildNextMovePlan([
    constatTechnique,
    make({
      id: "id-flou",
      finding_key: "autre",
      title: "Autre piste sans montant",
      priority_score: 10,
      estimated_gain_min: null,
      estimated_gain_max: null,
      evidence: { based_on: "shopify.orders_30d : 3 commandes", assumptions: null },
    }),
  ]);
  t.check(
    "sans aucune perte chiffrée, le constat technique reprend la tête",
    rienDeChiffre.now?.id,
    "id-tech",
  );
  t.check(
    "et rien ne prétend alors qu'il a été relégué",
    rienDeChiffre.rationale.includes("ne passe pas devant"),
    false,
  );

  // La preuve croisée lève la restriction : c'est exactement le lien que la
  // règle exige, et il est alors lisible dans la preuve elle-même.
  const constatCroise = make({
    ...constatTechnique,
    id: "id-tech-croise",
    finding_key: "site-lent-mesure",
    evidence: {
      based_on: "storefront.response_ms : 2 400 ms et cross.lenteur_et_trafic_perdu",
      assumptions: null,
    },
  });
  const croise = buildNextMovePlan([constatCroise, perteMesuree]);
  t.check(
    "un constat croisé avec une mesure reprend sa place au score",
    croise.now?.id,
    "id-tech-croise",
  );
  t.check("et ne figure pas parmi les constats techniques", croise.technical.length, 0);

  // Entrées hostiles : `evidence` est une colonne `jsonb` ouverte. Se tromper
  // en croyant à un constat technique effacerait un vrai problème du plan ; se
  // tromper dans l'autre sens ne fait que laisser une conclusion à sa place.
  for (const [label, evidence] of [
    ["absente", undefined],
    ["nulle", null],
    ["une chaîne", "storefront.response_ms"],
    ["un tableau", ["storefront.response_ms"]],
    ["un nombre", 42],
    ["sans based_on", { assumptions: "rien" }],
    ["based_on vide", { based_on: "" }],
    ["based_on non textuel", { based_on: { a: 1 } }],
  ] as Array<[string, unknown]>) {
    t.check(
      `une preuve ${label} ne relègue personne`,
      isTechnicalConstat(make({ evidence })),
      false,
    );
  }
  t.check(
    "une preuve technique bien formée est bien reconnue",
    isTechnicalConstat(constatTechnique),
    true,
  );

  // COHÉRENCE DE BOUT EN BOUT. La règle ne sert à rien si la colonne qui la
  // porte n'est pas lue. Elle ne l'était pas — et le briefing y prenait déjà
  // silencieusement une preuve toujours vide.
  const cockpitCode = readFileSync(
    join(new URL("../../", import.meta.url).pathname, "src/lib/cockpit.functions.ts"),
    "utf8",
  );
  t.check(
    "le cockpit charge bien la preuve des problèmes",
    /\.select\(\s*(\/\/[^\n]*\n\s*)*"[^"]*\bevidence\b/.test(cockpitCode),
    true,
  );
  t.check(
    "et il la donne au plan",
    cockpitCode.includes("buildNextMovePlan(rows, outcomes)"),
    true,
  );

  // LE GARDE-FOU SYSTÉMATIQUE, et c'est lui qui compte le plus.
  //
  // Trois colonnes manquaient au `select` : `evidence`, `history_action` et
  // `history_note`. Aucune n'a jamais rien cassé — le code lit `undefined`,
  // retombe sur un défaut et se tait. Conséquences réelles : la preuve affichée
  // au marchand était vide en permanence, et TOUTE la mémoire des corrections
  // déjà tentées n'atteignait jamais le plan, si bien qu'une piste écartée
  // pouvait être reproposée indéfiniment.
  //
  // Vérifier ces trois-là ne suffirait pas : la prochaine colonne ajoutée au
  // type retomberait dans le même silence. Le contrôle confronte donc TOUT ce
  // que `PlannableFinding` déclare à ce que la requête charge réellement.
  const nextMoveCode = readFileSync(
    join(new URL("../../", import.meta.url).pathname, "src/lib/next-move.ts"),
    "utf8",
  );
  const typeBlock = nextMoveCode.slice(
    nextMoveCode.indexOf("export type PlannableFinding"),
    nextMoveCode.indexOf("export type PlannedMove"),
  );
  const consumed = [...typeBlock.matchAll(/^ {2}([a-z_]+)\??:/gm)].map((m) => m[1]);
  t.check("le type consommé par le plan est bien lu", consumed.length > 10, true);

  const findingsSelect = cockpitCode.slice(cockpitCode.indexOf("audit_findings"));
  const selectClause = findingsSelect.slice(0, findingsSelect.indexOf(".eq("));
  const notLoaded = consumed.filter((field) => !new RegExp(`\\b${field}\\b`).test(selectClause));
  t.check("chaque champ dont le plan dépend est réellement chargé", notLoaded, []);
});
