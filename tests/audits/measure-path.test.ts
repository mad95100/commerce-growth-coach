import { readFileSync } from "node:fs";
import { join } from "node:path";
import { METRIC_WINDOW_DAYS } from "../../src/lib/metrics";
import { verdictBasis } from "../../src/lib/measure";
import {
  MAX_STORES_PER_MEASURE_TICK,
  MAX_TRACKING_DAYS,
  MEASURE_INTERVAL_MS,
  hasSomethingToLearn,
  isMeasurable,
  lastAttempt,
  selectStoresToMeasure,
  type MeasurableOutcome,
} from "../../src/lib/measure-tick";
import { defineSuite } from "../../tests/harness";

/**
 * MESURER : le chemin réel, pas la règle de verdict.
 *
 * `audits/measure.test.ts` vérifie COMMENT un verdict est calculé. Cette suite
 * vérifie qu'il l'est : que la mesure part, qu'elle atteint les boutiques dans
 * un ordre équitable, qu'elle s'arrête quand il n'y a plus rien à apprendre, et
 * qu'elle n'attribue jamais un résultat à une écriture dont on ignore le sort.
 *
 * Trois défauts sont couverts ici, tous trouvés en relisant le chemin complet :
 * une boutique déconnectée gelait la file, un verdict définitif était recalculé
 * indéfiniment sur une fenêtre qui ne recouvrait plus la correction, et une
 * écriture jamais confirmée pouvait passer pour la correction en vigueur.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export default defineSuite("Mesure — chemin réel et équité de la file", (t) => {
  const now = new Date("2026-08-16T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  const row = (over: Partial<MeasurableOutcome>): MeasurableOutcome => ({
    id: "o1",
    store_id: "s1",
    applied_at: ago(5 * DAY),
    checked_at: null,
    attempted_at: null,
    verdict: null,
    coverage: 0.2,
    ...over,
  });

  // =========================================================================
  // 1. DÉFAUT : une boutique déconnectée gelait la file de mesure
  // =========================================================================
  // La cadence se réglait sur `checked_at`, écrit uniquement après une mesure
  // RÉUSSIE. Une boutique sans canal connecté échouait donc à chaque passage
  // sans jamais faire avancer sa date, et occupait l'un des deux créneaux pour
  // toujours.

  t.check("sans aucune date, la ligne n'a jamais été approchée", lastAttempt(row({})), null);
  t.check(
    "une tentative seule fait foi",
    lastAttempt(row({ attempted_at: ago(HOUR) })),
    now.getTime() - HOUR,
  );
  t.check(
    "une mesure seule fait foi",
    lastAttempt(row({ checked_at: ago(2 * HOUR) })),
    now.getTime() - 2 * HOUR,
  );
  t.check(
    "quand les deux existent, la plus récente l'emporte",
    lastAttempt(row({ checked_at: ago(30 * HOUR), attempted_at: ago(HOUR) })),
    now.getTime() - HOUR,
  );
  t.check(
    "y compris quand c'est la mesure qui est la plus récente",
    lastAttempt(row({ checked_at: ago(HOUR), attempted_at: ago(30 * HOUR) })),
    now.getTime() - HOUR,
  );
  t.check(
    "une date illisible n'est pas prise pour une date",
    lastAttempt(row({ checked_at: "hier matin", attempted_at: ago(HOUR) })),
    now.getTime() - HOUR,
  );

  // Le cas qui gelait la file : une boutique tentée il y a une heure, jamais
  // mesurée avec succès, ne doit pas repasser tout de suite.
  t.check(
    "une boutique tentée sans succès attend son tour comme les autres",
    isMeasurable(row({ checked_at: null, attempted_at: ago(HOUR) }), now),
    false,
  );
  t.check(
    "et redevient éligible une fois la cadence écoulée",
    isMeasurable(row({ checked_at: null, attempted_at: ago(MEASURE_INTERVAL_MS + HOUR) }), now),
    true,
  );

  // La file elle-même : deux boutiques en échec ne doivent plus monopoliser les
  // deux créneaux face à une boutique jamais approchée.
  const queue: MeasurableOutcome[] = [
    row({ id: "a", store_id: "en-panne-1", checked_at: null, attempted_at: ago(13 * HOUR) }),
    row({ id: "b", store_id: "en-panne-2", checked_at: null, attempted_at: ago(14 * HOUR) }),
    row({ id: "c", store_id: "jamais-vue", checked_at: null, attempted_at: null }),
  ];
  t.check(
    "une boutique jamais approchée passe devant celles déjà tentées",
    selectStoresToMeasure(queue, now, 1),
    ["jamais-vue"],
  );
  t.check("puis vient la plus anciennement tentée", selectStoresToMeasure(queue, now, 2), [
    "jamais-vue",
    "en-panne-2",
  ]);
  t.check(
    "le plafond par passage est respecté",
    selectStoresToMeasure(queue, now, MAX_STORES_PER_MEASURE_TICK).length <=
      MAX_STORES_PER_MEASURE_TICK,
    true,
  );
  t.check(
    "une boutique n'occupe qu'un créneau, quel que soit son nombre de suivis",
    selectStoresToMeasure(
      [
        row({ id: "x1", store_id: "grosse", attempted_at: null }),
        row({ id: "x2", store_id: "grosse", attempted_at: null }),
        row({ id: "x3", store_id: "grosse", attempted_at: null }),
        row({ id: "y1", store_id: "petite", attempted_at: ago(20 * HOUR) }),
      ],
      now,
      2,
    ),
    ["grosse", "petite"],
  );

  // =========================================================================
  // 2. DÉFAUT : un verdict définitif était recalculé indéfiniment
  // =========================================================================
  // La sélection écartait bien ces lignes, mais la mesure, une fois sur place,
  // repassait sur TOUS les suivis de la boutique. Des semaines après la
  // correction, la fenêtre de trente jours ne la recouvre plus : la comparaison
  // mesure la saison, et le verdict révisé écrase la mémoire de la boutique.

  const settled = row({ coverage: 1, verdict: "confirme" });
  t.check(
    "un verdict confirmé sur fenêtre pleine est clos",
    hasSomethingToLearn(settled, now),
    false,
  );
  t.check(
    "un verdict nul aussi",
    hasSomethingToLearn(row({ coverage: 1, verdict: "nul" }), now),
    false,
  );
  t.check(
    "une régression aussi : elle est établie",
    hasSomethingToLearn(row({ coverage: 1, verdict: "regression" }), now),
    false,
  );
  t.check(
    "mais un verdict insuffisant reste ouvert : il peut encore se trancher",
    hasSomethingToLearn(row({ coverage: 1, verdict: "insuffisant" }), now),
    true,
  );
  t.check(
    "et une mesure en cours l'est toujours",
    hasSomethingToLearn(row({ coverage: 0.4, verdict: "en_cours" }), now),
    true,
  );
  t.check(
    "un verdict tranché sur fenêtre incomplète reste ouvert",
    hasSomethingToLearn(row({ coverage: 0.5, verdict: "confirme" }), now),
    true,
  );
  t.check(
    "passé la durée de suivi, la ligne appartient à l'histoire",
    hasSomethingToLearn(row({ applied_at: ago((MAX_TRACKING_DAYS + 1) * DAY) }), now),
    false,
  );
  t.check(
    "une correction datée dans le futur n'est pas mesurable",
    hasSomethingToLearn(row({ applied_at: new Date(now.getTime() + DAY).toISOString() }), now),
    false,
  );
  t.check(
    "une date d'application illisible non plus",
    hasSomethingToLearn(row({ applied_at: "bientôt" }), now),
    false,
  );

  // Les deux questions sont bien distinctes : ce qui est clos n'est jamais
  // mesurable, mais ce qui est ouvert peut simplement devoir attendre son tour.
  t.check("ce qui est clos n'est jamais mesurable", isMeasurable(settled, now), false);
  const tooSoon = row({ attempted_at: ago(HOUR) });
  t.check("ce qui est ouvert peut devoir attendre", hasSomethingToLearn(tooSoon, now), true);
  t.check("et n'est alors pas mesuré maintenant", isMeasurable(tooSoon, now), false);

  // Et la mesure applique bien ce tri, avant d'appeler les partenaires.
  const tracking = read("src/lib/tracking.server.ts");
  t.check(
    "la mesure écarte les suivis clos",
    tracking.includes("hasSomethingToLearn(row, now)"),
    true,
  );
  t.check(
    "et le fait avant d'interroger les partenaires",
    tracking.indexOf("hasSomethingToLearn(row, now)") <
      tracking.indexOf("captureStoreMetrics(creds)"),
    true,
  );
  t.check("elle dit combien de suivis elle a laissés de côté", tracking.includes("skipped"), true);
  t.check(
    "une boutique entièrement close n'appelle aucun partenaire",
    /measurable\.length === 0[\s\S]{0,120}return/.test(tracking),
    true,
  );

  // =========================================================================
  // 3. DÉFAUT : une écriture au sort inconnu pouvait passer pour la correction
  // =========================================================================
  // L'outil employé détermine quelles métriques comptent. Le lire sur une action
  // réservée puis interrompue attribuerait un verdict à un geste qui n'a
  // peut-être jamais eu lieu — et, sans date d'application, une telle ligne se
  // trie en tête et devient « la correction en vigueur ».

  t.check(
    "seules les actions réellement abouties nomment l'outil",
    tracking.includes('.not("applied_at", "is", null)'),
    true,
  );
  t.check(
    "et la plus récente fait foi",
    tracking.includes('.order("applied_at", { ascending: false })'),
    true,
  );

  // =========================================================================
  // 4. Ce que la mesure écrit, et ce qu'elle ne fait pas
  // =========================================================================
  t.check(
    "un passage porte un seul instant de mesure",
    tracking.includes("checked_at: measuredAt"),
    true,
  );
  t.check("il date aussi la tentative", tracking.includes("attempted_at: measuredAt"), true);
  t.check(
    "l'instantané « avant » manquant est signalé, pas avalé",
    /catch \(err\)[\s\S]{0,400}console\.error\("\[mesure\] instantané/.test(tracking),
    true,
  );
  t.check(
    "la mesure n'écrit rien chez les partenaires",
    /updateProduct|metaUpdateBudget|googleUpdateBudget|metaPauseAdSet|googlePauseCampaign/.test(
      tracking,
    ),
    false,
  );
  t.check(
    "et n'annule aucune correction d'elle-même",
    /executeRevert|executePlannedAction/.test(tracking),
    false,
  );
  t.check(
    "seule une régression déclenche une alerte",
    tracking.includes('outcome.verdict === "regression" ? outcome.headline : null'),
    true,
  );
  t.check("et seulement à son apparition", tracking.includes('row.verdict !== "regression"'), true);

  // =========================================================================
  // 5. VERDICT : jamais annoncé sans ce sur quoi il repose
  // =========================================================================
  // Le moteur calculait depuis toujours la durée écoulée et la couverture de la
  // fenêtre. L'écran de suivi n'affichait que le verdict : « impact confirmé »
  // posé sur cinq jours de recul se lisait exactement comme un verdict établi.

  t.check(
    "sans durée ni couverture, on n'invente aucune certitude",
    verdictBasis({ days: null, coverage: null }),
    null,
  );
  t.check(
    "une couverture illisible non plus",
    verdictBasis({ days: 10, coverage: Number.NaN }),
    null,
  );

  const early = verdictBasis({ days: 3, coverage: 0.1 });
  t.check("un verdict précoce est daté", early?.days, 3);
  t.check("sa couverture est chiffrée", early?.coveragePct, 10);
  t.check("la fenêtre de référence est nommée", early?.windowDays, METRIC_WINDOW_DAYS);
  t.check(
    "et le résumé porte les deux chiffres",
    early?.summary.includes("3 jours de recul") && early?.summary.includes("10 %"),
    true,
  );
  t.check(
    "sous le seuil de couverture, la conclusion est explicitement interdite",
    early?.caveat?.includes("Trop tôt pour conclure"),
    true,
  );
  t.check("et une échéance est donnée", /Revenez dans \d+ jour/.test(early?.caveat ?? ""), true);

  const partial = verdictBasis({ days: 15, coverage: 0.5 });
  t.check(
    "à mi-fenêtre, la nuance porte sur ce qui reste antérieur",
    partial?.caveat?.includes("50 % restants"),
    true,
  );
  t.check(
    "et rappelle que l'écart est ramené à fenêtre pleine",
    partial?.caveat?.includes("ramené à fenêtre pleine"),
    true,
  );

  const full = verdictBasis({ days: 32, coverage: 1 });
  t.check("fenêtre pleine : plus rien à nuancer", full?.caveat, null);
  t.check("mais la période reste affichée", full?.summary.includes("100 %"), true);

  const overflow = verdictBasis({ days: 40, coverage: 1.4 });
  t.check("une couverture aberrante est ramenée à 100 %", overflow?.coveragePct, 100);
  const negative = verdictBasis({ days: -3, coverage: -0.2 });
  t.check("une couverture négative est ramenée à 0 %", negative?.coveragePct, 0);
  t.check("et une durée négative à zéro jour", negative?.days, 0);
  t.check(
    "un jour s'écrit au singulier",
    verdictBasis({ days: 1, coverage: 0.03 })?.summary.includes("1 jour de recul"),
    true,
  );

  const page = read("src/routes/_authenticated/tracking.$storeId.tsx");
  t.check("l'écran de suivi affiche cette base", page.includes("verdictBasis("), true);
  t.check("y compris la réserve quand il y en a une", page.includes("basis.caveat"), true);
  t.check(
    "il distingue les métriques décisives des autres",
    page.includes("decisive.get(d.key)") && page.includes("garde-fou"),
    true,
  );
  t.check(
    "et le gain attendu porte sa devise",
    page.includes("formatMoney(o.expected_gain_min, gainCurrency)"),
    true,
  );
  t.check(
    "la devise vient de la boutique, pas d'une supposition",
    read("src/lib/tracking.functions.ts").includes("stores(currency)"),
    true,
  );

  // =========================================================================
  // 6. La migration reste additive et rejouable
  // =========================================================================
  const migration = read("supabase/migrations/20260816220000_measure_attempts.sql")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  t.check(
    "la colonne est ajoutée sans écraser",
    migration.includes("ADD COLUMN IF NOT EXISTS"),
    true,
  );
  t.check("l'index est rejouable", migration.includes("CREATE INDEX IF NOT EXISTS"), true);
  t.check("aucune donnée n'est supprimée", /DROP|DELETE|TRUNCATE/.test(migration), false);
  t.check(
    "les lignes existantes restent prioritaires, leur tentative étant nulle",
    migration.includes("NULLS FIRST"),
    true,
  );
});
