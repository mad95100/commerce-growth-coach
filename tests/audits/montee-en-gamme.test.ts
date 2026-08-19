import { readFileSync } from "node:fs";
import { defineSuite } from "../harness";
import {
  COUVERTURE_MINIMALE,
  categoriesNonInstruites,
  computeCategoryScores,
  computeGlobalScore,
  type Category,
} from "@/lib/scoring";
import { formatMoney } from "@/lib/currency";

/**
 * CE QUE LE RAPPORT N'A PAS LE DROIT D'AFFIRMER.
 *
 * Quatre promesses, chacune vérifiée sur le comportement réel plutôt que sur
 * une formulation. Elles ont un point commun : toutes portent sur un chiffre ou
 * un bouton qui donnerait au marchand une certitude que rien ne soutient.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const lire = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");
const RAPPORT = "src/routes/_authenticated/audits.$auditId.tsx";

const constat = (category: Category, severity = "high") => ({
  category,
  severity,
  confidence: "high",
  estimated_gain_min: 100,
  estimated_gain_max: 200,
  difficulty: 2,
  timeframe: "this_week" as const,
});

export default defineSuite("Montée en gamme — ce qu'un rapport n'affirme pas", (t) => {
  // =========================================================================
  // 1. AUCUN SCORE CALCULÉ SUR DES DONNÉES ABSENTES
  // =========================================================================
  /*
    LE DÉFAUT. Une catégorie sans constat recevait 78 — « prudent ». Deux
    situations opposées y tombaient ensemble : la catégorie avait été instruite
    et rien n'en était sorti, ou aucune donnée n'avait permis de la regarder.

    Conséquence mesurable : une boutique dont aucune source n'avait répondu
    obtenait 78 partout, donc un score global honorable, entièrement calculé sur
    du vide. C'est la fabrication d'un chiffre à partir d'une absence — que le
    reste du produit s'interdit partout ailleurs.
  */
  const rien = computeCategoryScores([], new Set<Category>());
  t.check("aucune catégorie instruite : aucune note", Object.keys(rien).length, 0);
  t.check("…et donc aucun score global", computeGlobalScore(rien), null);
  t.check("le score n'est pas remplacé par un zéro", computeGlobalScore(rien) === 0, false);

  // Instruire une seule catégorie mineure ne suffit pas : la moyenne parlerait
  // surtout de ce qu'on a réussi à regarder.
  const maigre = computeCategoryScores([constat("operations")], new Set<Category>(["operations"]));
  t.check("une seule catégorie mineure ne suffit pas", computeGlobalScore(maigre), null);

  // Couverture suffisante : la note redevient un nombre.
  const large = new Set<Category>([
    "offre",
    "produit",
    "conversion",
    "acquisition",
    "boutique",
    "rentabilite",
  ]);
  const couvert = computeCategoryScores([constat("conversion")], large);
  const note = computeGlobalScore(couvert);
  t.check("couverture suffisante : une note est rendue", typeof note === "number", true);
  t.check("…et elle reste dans les bornes", note !== null && note >= 0 && note <= 100, true);

  // La note ne se calcule QUE sur ce qui a été instruit : une catégorie absente
  // ne tire pas la moyenne vers le haut avec un 78 de complaisance.
  t.check(
    "les catégories non instruites sont nommées",
    categoriesNonInstruites(couvert).length > 0,
    true,
  );
  t.check("le seuil de couverture est franc", COUVERTURE_MINIMALE >= 0.5, true);

  // Sans relevé de ce qui a été instruit, le comportement d'avant est conservé :
  // un appelant qui ne sait pas ne doit pas voir la note disparaître.
  t.check(
    "sans relevé, toutes les catégories restent notées",
    Object.keys(computeCategoryScores([])).length >= 8,
    true,
  );

  // Le moteur passe bien le relevé — sinon tout ce qui précède ne servirait à
  // rien en production.
  const runner = lire("src/lib/audit-runner.server.ts");
  t.check(
    "le moteur note d'après ce qu'il a instruit",
    /computeCategoryScores\(parsed\.findings, categoriesInstruites\)/.test(runner),
    true,
  );
  t.check(
    "…et ce relevé vient des diagnostics réellement posables",
    /availability\.available\.map\(\(a\) => a\.diagnostic\.domain\)/.test(runner),
    true,
  );

  // =========================================================================
  // 2. AUCUNE DEVISE INVENTÉE
  // =========================================================================
  const sansDevise = formatMoney(1800, null);
  t.check("un montant sans devise ne prend pas d'unité", /€|\$|USD|EUR/.test(sansDevise), false);
  t.check("…et il annonce que la devise est inconnue", /devise/i.test(sansDevise), true);
  t.check("un montant avec devise la porte", /€/.test(formatMoney(1800, "EUR")), true);
  // Une valeur absente ne devient pas zéro.
  t.check("une valeur absente reste absente", formatMoney(null, "EUR"), "—");
  t.check("zéro reste zéro, et se distingue de l'absence", /0/.test(formatMoney(0, "EUR")), true);

  // =========================================================================
  // 3. AUCUN BOUTON NE PROMET UNE ACTION QUI N'EXISTE PAS
  // =========================================================================
  /*
    « Corriger à ma place » était proposé sur TOUS les constats, y compris ceux
    qu'aucun outil ne sait écrire. Deux choses étaient fausses : la promesse — le
    geste prépare une proposition que le marchand confirme ensuite — et le
    comportement, puisque le refus arrivait en notification passagère et laissait
    le bouton intact, invitant à recliquer. Chaque clic coûte un appel au modèle.
  */
  const rapport = lire(RAPPORT);
  t.check(
    "aucun bouton ne promet de corriger à la place du marchand",
    /> Corriger à ma place/.test(rapport),
    false,
  );
  t.check(
    "le bouton annonce ce qu'il fait réellement",
    /Préparer la correction/.test(rapport),
    true,
  );
  t.check("le bouton de copie dit ce qu'il copie", /Copier le texte proposé/.test(rapport), true);
  // Le refus est retenu par constat, et il retire le bouton.
  t.check(
    "le refus est mémorisé",
    /setRefus\(\(r\) => \(\{ \.\.\.r, \[findingId\]/.test(rapport),
    true,
  );
  t.check(
    "…et il retire le bouton au lieu de le laisser inviter un nouvel essai",
    /!applied && !proposal && !refus &&/.test(rapport),
    true,
  );
  t.check(
    "…en disant ce qui reste possible",
    /Pas de correction automatique ici/.test(rapport),
    true,
  );

  // =========================================================================
  // 4. UNE DONNÉE MANQUANTE N'EST PAS UNE FIN DE PHRASE
  // =========================================================================
  /*
    Les manques relevés pendant la collecte n'étaient montrés que sur un audit
    ÉCHOUÉ. Sur un audit abouti, le rapport restait muet sur ce qui n'avait pas
    pu être regardé — et le marchand pouvait croire le tour complet.
  */
  t.check(
    "les manques sont montrés aussi sur un audit abouti",
    /Ce que nous n'avons pas pu regarder/.test(rapport),
    true,
  );
  t.check(
    "ils passent par la traduction marchande",
    /explain\(g\.id, g\.label, g\.reason\)/.test(rapport),
    true,
  );
  // Les quatre questions, dans l'ordre où elles se posent.
  for (const [quoi, motif] of [
    ["ce qui manque", /\{e\.what\}/],
    ["pourquoi cela compte", /\{e\.why\}/],
    ["comment l'obtenir", /Pour l'obtenir/],
    ["ce que cela rouvrirait", /Ce que cela rouvrirait/],
  ] as const) {
    t.check(`le bloc dit ${quoi}`, motif.test(rapport), true);
  }

  // =========================================================================
  // 5. LA PREUVE N'A PAS DISPARU EN CHEMIN
  // =========================================================================
  // Toute cette montée en gamme ne vaut rien si elle a coûté la traçabilité.
  t.check("la preuve reste affichée", /Sur quoi nous nous appuyons/.test(rapport), true);
  t.check("les suppositions restent affichées", /Ce que nous supposons/.test(rapport), true);
  t.check(
    "le niveau de certitude reste affiché",
    /EPISTEMIC_LABELS\[epistemic\]/.test(rapport),
    true,
  );
});
