import {
  CONFIRM_PCT,
  GUARD_REGRESSION_PCT,
  LEGACY_STATUS,
  MIN_COVERAGE,
  NOISE_PCT,
  ROLES_BY_CATEGORY,
  ROLES_BY_TOOL,
  VERDICTS,
  VERDICT_EMOJI,
  measureOutcome,
  rolesFor,
} from "../../src/lib/measure";
import { METRIC_DEFS, METRIC_WINDOW_DAYS, computeDeltas } from "../../src/lib/metrics";
import type { MetricDelta, StoreMetrics } from "../../src/lib/metrics";
import { defineSuite } from "../harness";

/**
 * Verdict d'une correction : a-t-elle produit son effet ?
 *
 * CE QUI EST EN JEU. Ce jugement décide si le marchand garde ou annule une
 * modification réelle de sa boutique ou de ses campagnes. Trois façons de se
 * tromper, toutes coûteuses :
 *
 * 1. **Conclure trop tôt.** Les indicateurs sont des cumuls sur 30 jours. À
 *    trois jours, 27 des 30 jours mesurés sont ANTÉRIEURS à la correction : un
 *    vrai +30 % n'apparaît que comme +3 %. L'ancien seuil déclarait « gains
 *    absents » sous +3 % — il condamnait donc les corrections qui marchaient.
 *
 * 2. **Regarder la mauvaise métrique.** Mettre en pause un ensemble de
 *    publicités améliore MÉCANIQUEMENT le ROAS en supprimant du volume. Jugée
 *    au ROAS seul, la pire décision passe pour un succès.
 *
 * 3. **Confondre « aucun impact » et « régression ».** Le premier dit que le
 *    diagnostic s'est trompé de cause, le second qu'il faut réparer. Les deux
 *    appellent des gestes opposés.
 *
 * Les trois sont exercées ici.
 */

const APPLIED = "2026-08-01T00:00:00.000Z";
const DAY = 86_400_000;
const at = (days: number) => new Date(APPLIED).getTime() + days * DAY;

/** Construit un écart brut, tel que `computeDeltas` le produit. */
function delta(key: string, change_pct: number | null): MetricDelta {
  const def = METRIC_DEFS.find((d) => d.key === key)!;
  return {
    key: def.key,
    label: def.label,
    channel: def.channel,
    format: def.format,
    currency: def.format === "currency" ? "EUR" : null,
    before: 100,
    after: change_pct == null ? null : 100 + change_pct,
    change_pct,
    higher_is_better: def.higher_is_better,
  };
}

export default defineSuite("Mesure — verdict d'une correction", (t) => {
  // --- Les cinq verdicts ----------------------------------------------------
  t.check("cinq verdicts, pas un de plus", VERDICTS.length, 5);
  t.check("l'amélioration confirmée est verte", VERDICT_EMOJI.confirme, "✅");
  t.check("l'impact insuffisant est orange", VERDICT_EMOJI.insuffisant, "⚠️");
  t.check("l'absence d'impact est une croix", VERDICT_EMOJI.nul, "❌");
  t.check("la régression est rouge", VERDICT_EMOJI.regression, "🔴");

  // L'énumération en base n'en compte que quatre : la correspondance doit
  // exister pour les cinq, sans quoi une écriture échouerait en production.
  for (const verdict of VERDICTS) {
    t.check(
      `${verdict} a une correspondance dans l'ancienne énumération`,
      ["measuring", "on_track", "underperforming", "regressed"].includes(LEGACY_STATUS[verdict]),
      true,
    );
  }
  t.check(
    "« aucun impact » n'est pas rapporté comme une régression",
    LEGACY_STATUS.nul,
    "underperforming",
  );

  // --- Quelles métriques pour quelle correction ----------------------------
  t.check(
    "l'outil l'emporte sur le domaine",
    rolesFor({ tool: "meta_pause_adset", category: "conversion" }),
    ROLES_BY_TOOL.meta_pause_adset,
  );
  t.check(
    "sans outil connu, le domaine décide",
    rolesFor({ tool: "outil_inconnu", category: "acquisition" }),
    ROLES_BY_CATEGORY.acquisition,
  );
  t.check("sans rien, on regarde le commerce", rolesFor({}).drivers, ["revenue_30d", "orders_30d"]);

  // LE piège de la publicité : couper du volume fait monter les ratios.
  t.check(
    "mettre en pause se juge au ROAS, avec le volume en garde",
    ROLES_BY_TOOL.meta_pause_adset,
    { drivers: ["meta_roas"], guards: ["meta_purchases", "revenue_30d"] },
  );
  t.check(
    "un code de réduction surveille le panier moyen",
    ROLES_BY_TOOL.create_discount_code.guards,
    ["aov"],
  );
  t.check(
    "une hausse de budget se juge au volume, pas à la dépense",
    ROLES_BY_TOOL.meta_update_budget,
    { drivers: ["meta_purchases", "meta_roas"], guards: ["meta_spend"] },
  );

  // Toute clé citée dans les rôles doit exister : une faute de frappe rendrait
  // la métrique invisible, et le verdict serait rendu sans elle, en silence.
  const known = new Set(METRIC_DEFS.map((d) => d.key));
  for (const [name, roles] of [
    ...Object.entries(ROLES_BY_TOOL),
    ...Object.entries(ROLES_BY_CATEGORY),
  ]) {
    t.check(
      `les métriques de « ${name} » existent toutes`,
      [...roles.drivers, ...roles.guards].filter((key) => !known.has(key)),
      [],
    );
  }
  for (const category of Object.keys(ROLES_BY_CATEGORY)) {
    t.check(
      `« ${category} » a au moins un moteur`,
      ROLES_BY_CATEGORY[category].drivers.length > 0,
      true,
    );
  }

  // --- 1. Ne jamais conclure trop tôt --------------------------------------
  const tooEarly = measureOutcome({
    deltas: [delta("revenue_30d", 3)],
    appliedAt: APPLIED,
    now: at(3),
    category: "conversion",
  });
  t.check("à trois jours, aucun verdict", tooEarly.verdict, "en_cours");
  t.check("et on dit quand il tombera", tooEarly.headline.includes("verdict dans"), true);
  t.check(
    "l'explication donne la raison de l'attente",
    tooEarly.explanation.includes(`cumuls sur ${METRIC_WINDOW_DAYS} jours`),
    true,
  );
  t.check("rien à annuler tant qu'on ne sait pas", tooEarly.rollback.recommended, false);

  const justEnough = measureOutcome({
    deltas: [delta("revenue_30d", 3)],
    appliedAt: APPLIED,
    now: at(METRIC_WINDOW_DAYS * MIN_COVERAGE),
    category: "conversion",
  });
  t.check("au seuil de couverture, le verdict est rendu", justEnough.verdict === "en_cours", false);

  // LA correction que l'ancien jugement condamnait : +3 % bruts à 7,5 jours,
  // c'est +12 % à fenêtre pleine — une réussite, pas un échec.
  t.check("un écart brut faible est ramené à fenêtre pleine", justEnough.drivers[0].effect_pct, 12);
  t.check("et devient une amélioration confirmée", justEnough.verdict, "confirme");

  // --- Aucune métrique exploitable -----------------------------------------
  const blind = measureOutcome({
    deltas: [delta("meta_roas", 40)],
    appliedAt: APPLIED,
    now: at(20),
    category: "conversion",
  });
  t.check("sans métrique du bon domaine, pas de verdict", blind.verdict, "en_cours");
  t.check(
    "et on dit qu'il manque le canal",
    blind.explanation.includes("canal concerné est bien connecté"),
    true,
  );

  const noDeltas = measureOutcome({ deltas: [], appliedAt: APPLIED, now: at(20) });
  t.check("aucune donnée du tout ne fait pas échouer", noDeltas.verdict, "en_cours");

  // --- 2. Les quatre verdicts sur des données claires ----------------------
  const full = { appliedAt: APPLIED, now: at(METRIC_WINDOW_DAYS), category: "conversion" };

  const confirmed = measureOutcome({ ...full, deltas: [delta("revenue_30d", 25)] });
  t.check("une hausse nette est confirmée", confirmed.verdict, "confirme");
  t.check("le titre porte le chiffre", confirmed.headline.includes("+25 %"), true);
  t.check("on invite à garder la correction", confirmed.explanation.includes("garde-la"), true);
  t.check("rien à annuler", confirmed.rollback.recommended, false);

  const flat = measureOutcome({ ...full, deltas: [delta("revenue_30d", 1)] });
  t.check("un écart dans le bruit vaut « aucun impact »", flat.verdict, "nul");
  t.check(
    "et on dit que le diagnostic s'est trompé",
    flat.explanation.includes("ce n'était pas le vrai blocage"),
    true,
  );
  t.check("sans recommander d'annuler", flat.rollback.recommended, false);
  t.check(
    "puisque la correction ne nuit pas",
    flat.rollback.reason.includes("la correction ne nuit pas"),
    true,
  );

  const weak = measureOutcome({ ...full, deltas: [delta("revenue_30d", 7)] });
  t.check("entre bruit et confirmation, l'impact est insuffisant", weak.verdict, "insuffisant");
  t.check("on laisse tourner", weak.explanation.includes("Laisse tourner"), true);

  const dropped = measureOutcome({ ...full, deltas: [delta("revenue_30d", -20)] });
  t.check("une baisse nette est une régression", dropped.verdict, "regression");
  t.check("le titre dit le recul", dropped.headline.includes("reculé"), true);
  t.check("et l'annulation est recommandée", dropped.rollback.recommended, true);

  // Les bornes exactes, pour que déplacer un seuil se voie.
  t.check(
    "juste sous le seuil de bruit : aucun impact",
    measureOutcome({ ...full, deltas: [delta("revenue_30d", NOISE_PCT - 0.1)] }).verdict,
    "nul",
  );
  t.check(
    "juste au seuil de bruit : insuffisant",
    measureOutcome({ ...full, deltas: [delta("revenue_30d", NOISE_PCT)] }).verdict,
    "insuffisant",
  );
  t.check(
    "juste sous le seuil de confirmation : insuffisant",
    measureOutcome({ ...full, deltas: [delta("revenue_30d", CONFIRM_PCT - 0.1)] }).verdict,
    "insuffisant",
  );
  t.check(
    "au seuil de confirmation : confirmé",
    measureOutcome({ ...full, deltas: [delta("revenue_30d", CONFIRM_PCT)] }).verdict,
    "confirme",
  );
  t.check(
    "au seuil de bruit négatif : régression",
    measureOutcome({ ...full, deltas: [delta("revenue_30d", -NOISE_PCT)] }).verdict,
    "regression",
  );

  // --- 3. Les garde-fous ----------------------------------------------------
  // LE cas qui justifie tout le module : le ROAS explose parce qu'on a coupé la
  // moitié du volume. Sans garde-fou, c'est un succès. Avec, c'est un dégât.
  const pausedAdset = measureOutcome({
    appliedAt: APPLIED,
    now: at(METRIC_WINDOW_DAYS),
    tool: "meta_pause_adset",
    revertible: true,
    deltas: [delta("meta_roas", 60), delta("meta_purchases", -45), delta("revenue_30d", -30)],
  });
  t.check(
    "un ROAS qui monte au prix du volume est une régression",
    pausedAdset.verdict,
    "regression",
  );
  t.check(
    "et le titre nomme ce qui s'est effondré",
    pausedAdset.headline.includes("Achats Meta"),
    true,
  );
  t.check(
    "l'explication dit que le problème a été déplacé",
    pausedAdset.explanation.includes("déplacement du problème"),
    true,
  );
  t.check("l'annulation est recommandée", pausedAdset.rollback.recommended, true);
  t.check("et elle est automatisable ici", pausedAdset.rollback.possible, true);

  // Le même cas, mais l'outil ne sait pas revenir en arrière : la
  // recommandation reste, la promesse d'un bouton disparaît.
  const manualRollback = measureOutcome({
    appliedAt: APPLIED,
    now: at(METRIC_WINDOW_DAYS),
    tool: "meta_pause_adset",
    revertible: false,
    deltas: [delta("meta_roas", 60), delta("meta_purchases", -45)],
  });
  t.check("une annulation impossible reste recommandée", manualRollback.rollback.recommended, true);
  t.check("mais elle est annoncée manuelle", manualRollback.rollback.possible, false);
  t.check("avec la marche à suivre", manualRollback.rollback.reason.includes("à la main"), true);

  // Une garde qui ne fait que frémir n'annule pas un succès, mais est signalée.
  const minorGuard = measureOutcome({
    appliedAt: APPLIED,
    now: at(METRIC_WINDOW_DAYS),
    tool: "create_discount_code",
    deltas: [delta("orders_30d", 30), delta("revenue_30d", 20), delta("aov", -7)],
  });
  t.check("une garde qui frémit ne renverse pas le verdict", minorGuard.verdict, "confirme");
  t.check(
    "elle est tout de même signalée",
    minorGuard.explanation.includes("À surveiller tout de même"),
    true,
  );
  t.check(
    "au-delà du seuil, elle renverse",
    measureOutcome({
      appliedAt: APPLIED,
      now: at(METRIC_WINDOW_DAYS),
      tool: "create_discount_code",
      deltas: [
        delta("orders_30d", 30),
        delta("revenue_30d", 20),
        delta("aov", -(GUARD_REGRESSION_PCT + 1)),
      ],
    }).verdict,
    "regression",
  );

  // --- Signaux contradictoires ---------------------------------------------
  const mixed = measureOutcome({
    appliedAt: APPLIED,
    now: at(METRIC_WINDOW_DAYS),
    category: "conversion",
    deltas: [delta("orders_30d", 25), delta("revenue_30d", -15)],
  });
  t.check("des moteurs qui se contredisent ne concluent pas", mixed.verdict, "insuffisant");
  t.check("et on le dit", mixed.headline.includes("Signaux contradictoires"), true);
  t.check("sans recommander d'annuler", mixed.rollback.recommended, false);

  // --- Métriques où la baisse est une bonne nouvelle -----------------------
  // La dépense qui baisse est un gain. Le signe doit être retourné, sans quoi
  // toute économie serait lue comme une régression.
  const cheaper = measureOutcome({
    appliedAt: APPLIED,
    now: at(METRIC_WINDOW_DAYS),
    tool: "google_update_budget",
    deltas: [delta("google_conversions", 15), delta("google_cost", -20)],
  });
  t.check("une dépense en baisse n'est pas une régression", cheaper.verdict, "confirme");
  t.check(
    "le gain de la garde est compté à l'endroit",
    cheaper.guards.find((g) => g.key === "google_cost")!.gain_pct,
    20,
  );

  const pricier = measureOutcome({
    appliedAt: APPLIED,
    now: at(METRIC_WINDOW_DAYS),
    tool: "google_update_budget",
    deltas: [delta("google_conversions", 15), delta("google_cost", 40)],
  });
  t.check("une dépense qui s'envole renverse le verdict", pricier.verdict, "regression");

  // --- Cohérence des sorties -----------------------------------------------
  t.check("les moteurs retenus portent leur rôle", confirmed.drivers[0].role, "driver");
  t.check("les gardes aussi", minorGuard.guards[0].role, "guard");
  t.check(
    "la couverture est bornée à 1",
    measureOutcome({ ...full, now: at(90), deltas: [delta("revenue_30d", 12)] }).coverage,
    1,
  );
  t.check(
    "l'ancien statut suit le verdict",
    [confirmed.legacyStatus, flat.legacyStatus, dropped.legacyStatus],
    ["on_track", "underperforming", "regressed"],
  );
  t.check(
    "une date d'application illisible ne fait pas échouer",
    measureOutcome({ deltas: [delta("revenue_30d", 12)], appliedAt: "pas une date" }).verdict,
    "en_cours",
  );

  // --- L'arithmétique des écarts, de bout en bout --------------------------
  const before: StoreMetrics = {
    captured_at: APPLIED,
    shopify: { currency: "EUR", revenue_30d: 1000, orders_30d: 20, aov: 50 },
    meta: null,
    google: null,
  };
  const after: StoreMetrics = {
    captured_at: APPLIED,
    shopify: { currency: "EUR", revenue_30d: 1300, orders_30d: 26, aov: 50 },
    meta: null,
    google: null,
  };
  const deltas = computeDeltas(before, after);
  t.check(
    "l'écart est calculé en pourcentage",
    deltas.find((d) => d.key === "revenue_30d")!.change_pct,
    30,
  );
  t.check(
    "une métrique absente des deux côtés est écartée",
    deltas.some((d) => d.channel === "meta"),
    false,
  );
  t.check(
    "la devise du canal accompagne les montants",
    deltas.find((d) => d.key === "revenue_30d")!.currency,
    "EUR",
  );

  const endToEnd = measureOutcome({
    deltas,
    appliedAt: APPLIED,
    now: at(METRIC_WINDOW_DAYS),
    category: "conversion",
  });
  t.check("et le verdict suit", endToEnd.verdict, "confirme");
  t.check(
    "sur la bonne métrique",
    endToEnd.drivers.some((d) => d.key === "orders_30d"),
    true,
  );
});
