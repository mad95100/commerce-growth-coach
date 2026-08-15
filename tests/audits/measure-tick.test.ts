import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_STORES_PER_MEASURE_TICK,
  MAX_TRACKING_DAYS,
  MEASURE_INTERVAL_MS,
  isMeasurable,
  selectStoresToMeasure,
  type MeasurableOutcome,
} from "../../src/lib/measure-tick";
import { defineSuite } from "../harness";

/**
 * Re-mesure automatique des corrections.
 *
 * CE QUI EST EN JEU. Ce passage tourne toutes les minutes, sans personne devant
 * l'écran, et chaque boutique retenue interroge Shopify, Meta et Google. Trois
 * fautes seraient coûteuses et silencieuses :
 *
 * - mesurer en boucle une correction dont le verdict ne bougera plus, ce qui
 *   brûle du quota partenaire pour ne rien apprendre ;
 * - laisser une boutique qui porte beaucoup de suivis passer systématiquement
 *   devant les autres et les affamer ;
 * - se laisser piloter par une date corrompue — `fix_outcomes` reste modifiable
 *   depuis le navigateur.
 *
 * La règle est donc pure, et exercée exhaustivement ici : elle décide seule ce
 * que le passage périodique dépense.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

const NOW = new Date("2026-08-15T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const days = (n: number) => n * 86_400_000;
const hours = (n: number) => n * 3_600_000;

function row(overrides: Partial<MeasurableOutcome> = {}): MeasurableOutcome {
  return {
    id: "o1",
    store_id: "boutique-a",
    applied_at: ago(days(5)),
    checked_at: null,
    verdict: null,
    coverage: null,
    ...overrides,
  };
}

export default defineSuite("Mesure — passage périodique", (t) => {
  // --- Ce qui mérite une mesure --------------------------------------------
  t.check("un suivi jamais mesuré est prioritaire", isMeasurable(row(), NOW), true);
  t.check(
    "un suivi mesuré il y a longtemps est repris",
    isMeasurable(row({ checked_at: ago(MEASURE_INTERVAL_MS + 1000) }), NOW),
    true,
  );
  t.check(
    "un suivi mesuré à l'instant est laissé tranquille",
    isMeasurable(row({ checked_at: ago(hours(1)) }), NOW),
    false,
  );
  t.check(
    "exactement à l'intervalle, on remesure",
    isMeasurable(row({ checked_at: ago(MEASURE_INTERVAL_MS) }), NOW),
    true,
  );

  // --- Ce qui n'a plus rien à apprendre ------------------------------------
  // Fenêtre pleine et verdict tranché : continuer comparerait deux fenêtres
  // disjointes, et mesurerait la saison plutôt que le geste.
  for (const verdict of ["confirme", "nul", "regression"]) {
    t.check(
      `un verdict « ${verdict} » sur fenêtre pleine n'est plus mesuré`,
      isMeasurable(row({ verdict, coverage: 1, checked_at: ago(days(3)) }), NOW),
      false,
    );
  }
  t.check(
    "un verdict définitif sur fenêtre incomplète reste mesuré",
    isMeasurable(row({ verdict: "confirme", coverage: 0.6, checked_at: ago(days(3)) }), NOW),
    true,
  );
  t.check(
    "un impact insuffisant reste mesuré même à fenêtre pleine",
    isMeasurable(row({ verdict: "insuffisant", coverage: 1, checked_at: ago(days(3)) }), NOW),
    true,
  );
  t.check(
    "une mesure en cours reste mesurée",
    isMeasurable(row({ verdict: "en_cours", coverage: 1, checked_at: ago(days(3)) }), NOW),
    true,
  );

  // --- Ce qui est trop vieux ------------------------------------------------
  t.check(
    "un suivi trop ancien est abandonné",
    isMeasurable(row({ applied_at: ago(days(MAX_TRACKING_DAYS + 1)) }), NOW),
    false,
  );
  t.check(
    "juste sous la limite, il est encore suivi",
    isMeasurable(row({ applied_at: ago(days(MAX_TRACKING_DAYS - 1)) }), NOW),
    true,
  );

  // --- Entrées hostiles -----------------------------------------------------
  // `fix_outcomes` est modifiable depuis le navigateur : une date corrompue ne
  // doit ni faire échouer le passage, ni ouvrir la porte à des mesures en boucle.
  t.check(
    "une date d'application illisible écarte la ligne",
    isMeasurable(row({ applied_at: "pas une date" }), NOW),
    false,
  );
  t.check(
    "une correction datée du futur est écartée",
    isMeasurable(row({ applied_at: new Date(NOW.getTime() + days(2)).toISOString() }), NOW),
    false,
  );
  t.check(
    "une date de mesure illisible vaut jamais mesuré",
    isMeasurable(row({ checked_at: "n'importe quoi" }), NOW),
    true,
  );
  t.check(
    "une couverture aberrante ne fige pas le suivi",
    isMeasurable(row({ coverage: 99, verdict: "verdict inventé", checked_at: ago(days(2)) }), NOW),
    true,
  );

  // --- Sélection des boutiques ---------------------------------------------
  // Le plafond porte sur les BOUTIQUES : une mesure interroge les partenaires
  // une fois pour toute la boutique et sert ensuite tous ses suivis.
  const manyPerStore = selectStoresToMeasure(
    [
      row({ id: "1", store_id: "a" }),
      row({ id: "2", store_id: "a" }),
      row({ id: "3", store_id: "a" }),
    ],
    NOW,
  );
  t.check("plusieurs suivis d'une boutique ne comptent qu'une fois", manyPerStore, ["a"]);

  const capped = selectStoresToMeasure(
    ["a", "b", "c", "d"].map((store) => row({ id: store, store_id: store })),
    NOW,
  );
  t.check("le plafond par passage est tenu", capped.length, MAX_STORES_PER_MEASURE_TICK);

  // Sans cet ordre, une boutique très active passerait toujours devant.
  const fair = selectStoresToMeasure(
    [
      row({ id: "1", store_id: "recente", checked_at: ago(days(1)) }),
      row({ id: "2", store_id: "ancienne", checked_at: ago(days(10)) }),
      row({ id: "3", store_id: "jamais", checked_at: null }),
    ],
    NOW,
    3,
  );
  t.check("jamais mesurée d'abord, puis la plus ancienne", fair, ["jamais", "ancienne", "recente"]);

  // Une boutique est datée par son suivi le PLUS ancien : sinon, un suivi
  // fraîchement ajouté ferait passer toute la boutique pour à jour.
  t.check(
    "une boutique vaut par son suivi le plus ancien",
    selectStoresToMeasure(
      [
        row({ id: "1", store_id: "a", checked_at: ago(days(1)) }),
        row({ id: "2", store_id: "a", checked_at: ago(days(20)) }),
        row({ id: "3", store_id: "b", checked_at: ago(days(5)) }),
      ],
      NOW,
      1,
    ),
    ["a"],
  );

  t.check("aucun suivi ne donne aucune boutique", selectStoresToMeasure([], NOW), []);
  t.check(
    "des suivis tous à jour ne donnent aucune boutique",
    selectStoresToMeasure([row({ checked_at: ago(hours(2)) })], NOW),
    [],
  );
  t.check("un plafond nul ne sélectionne rien", selectStoresToMeasure([row()], NOW, 0), []);
  t.check(
    "une ligne sans boutique est ignorée",
    selectStoresToMeasure([row({ store_id: "" })], NOW),
    [],
  );

  // --- Le branchement sur l'horloge ----------------------------------------
  // La règle ne sert à rien si personne ne l'appelle : le cron doit vraiment
  // déclencher la re-mesure, et ne jamais laisser une mesure en échec empêcher
  // les audits d'avancer.
  const tick = read("src/lib/jobs-tick.server.ts");
  t.check("le passage périodique déclenche la re-mesure", tick.includes("runMeasureTick"), true);
  t.check(
    "la re-mesure est isolée des audits par un try",
    /async function measure\([\s\S]{0,200}try \{/.test(tick),
    true,
  );
  t.check(
    "la re-mesure a lieu même si la lecture des audits échoue",
    (tick.match(/await measure\(now\)/g) ?? []).length >= 2,
    true,
  );

  const server = read("src/lib/measure-tick.server.ts");
  t.check("le passage prévient le marchand", server.includes("notifications"), true);
  t.check(
    "il n'écrit rien chez les partenaires",
    /executePlannedAction|executeRevert/.test(server),
    false,
  );
  t.check(
    "une boutique en échec n'interrompt pas les suivantes",
    /for \(const storeId of storeIds\)[\s\S]{0,200}try \{/.test(server),
    true,
  );
});
