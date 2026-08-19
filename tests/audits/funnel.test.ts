import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FUNNEL_STAGES,
  RECOVERABLE_SHARE_MIN,
  REFERENCE_RATES,
  anchorGainsOnLeak,
  buildFunnel,
  funnelToPromptBlock,
} from "../../src/lib/funnel";
import type { Observation } from "../../src/lib/observations";
import { defineSuite } from "../harness";

/**
 * L'entonnoir : où le volume disparaît, et ce que ça coûte.
 *
 * CE QUI EST EN JEU. Le croisement sait dire « la fuite est après le clic ».
 * Il ne dit pas à QUELLE MARCHE ni combien elle coûte — et c'est exactement la
 * promesse du produit : « voici le problème qui te coûte probablement le
 * plus ». Sans montant, deux problèmes ne sont pas comparables : un abandon de
 * panier à 80 % et un taux de clic à 0,4 % se discutent indéfiniment. Chiffrés,
 * ils se classent.
 *
 * DEUX RÈGLES PORTENT TOUT :
 *
 * 1. **Aucune marche n'est interpolée.** Une marche non mesurée est un TROU
 *    nommé, et la fuite n'est jamais cherchée au travers. Enjamber un trou
 *    imputerait la perte à une étape dont on ne sait rien — c'est ainsi qu'on
 *    accuse la publicité d'un problème de checkout.
 *
 * 2. **Les références sont des ordres de grandeur, pas des lois.** Elles
 *    viennent de l'usage, pas des données du marchand. Le montant qu'elles
 *    produisent est un ordre de grandeur, et le prompt l'impose comme tel.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

function obs(id: string, value: number, currency?: string): Observation {
  return {
    id,
    source: id.startsWith("meta") ? "meta" : "shopify",
    domain: "conversion",
    label: id,
    value,
    unit: currency ? "currency" : "count",
    currency: currency ?? null,
    periodDays: 30,
    evidence: `${value} relevé (${id.startsWith("meta") ? "Meta" : "Shopify"})`,
    sample: value,
  };
}

export default defineSuite("Moteur — entonnoir et localisation de la fuite", (t) => {
  t.check("cinq marches", FUNNEL_STAGES.length, 5);
  for (const key of Object.keys(REFERENCE_RATES)) {
    t.check(`la référence « ${key} » est justifiée`, REFERENCE_RATES[key].note.length > 20, true);
    t.check(`et bornée`, REFERENCE_RATES[key].rate > 0 && REFERENCE_RATES[key].rate <= 100, true);
  }

  // --- Un entonnoir complet -------------------------------------------------
  // 100 000 impressions → 2 000 clics (2 %) → 300 paniers (15 %) → 60
  // commandes (20 %) → 57 conservées (95 %).
  const complete = buildFunnel([
    obs("meta.impressions_30d", 100000),
    obs("meta.clicks_30d", 2000),
    obs("shopify.orders_30d", 60),
    obs("shopify.abandoned_checkouts_30d", 240),
    obs("shopify.refund_rate_30d", 5),
    obs("shopify.aov", 80, "EUR"),
  ]);

  t.check("les cinq marches sont mesurées", complete.unknown, []);
  t.check(
    "les paniers ouverts sont reconstitués",
    complete.steps.find((s) => s.stage === "paniers")!.value,
    300,
  );
  t.check(
    "et la reconstitution est expliquée",
    complete.steps.find((s) => s.stage === "paniers")!.evidence!.includes("reconstitués"),
    true,
  );
  t.check(
    "les commandes conservées sont déduites du taux de remboursement",
    complete.steps.find((s) => s.stage === "commandes_conservees")!.value,
    57,
  );

  // Le passage paniers → commandes est à 20 %, contre 30 % attendus : c'est la
  // seule marche qui décroche, et elle se chiffre.
  t.check("la fuite est localisée", complete.worst?.from, "paniers");
  t.check("et sa marche d'arrivée nommée", complete.worst?.to, "commandes");
  t.check("le taux constaté est calculé", complete.worst?.rate, 20);
  t.check("il manque 30 commandes", complete.worst?.missing, 30);
  t.check("la fuite est chiffrée en argent", complete.worst?.costPerMonth, 2400);
  t.check("dans la devise de la boutique", complete.worst?.currency, "EUR");
  t.check("et les preuves des deux marches sont citées", complete.worst!.evidence.length, 2);

  // --- Le classement se fait sur l'argent ----------------------------------
  // Deux fuites : le CTR décroche un peu, l'abandon panier beaucoup. C'est la
  // seconde qui coûte, et c'est elle qui doit passer devant.
  const twoLeaks = buildFunnel([
    obs("meta.impressions_30d", 100000),
    obs("meta.clicks_30d", 500),
    obs("shopify.orders_30d", 20),
    obs("shopify.abandoned_checkouts_30d", 280),
    obs("shopify.aov", 100, "EUR"),
  ]);
  t.check("plusieurs fuites sont détectées", twoLeaks.leaks.length >= 2, true);
  t.check("la plus chère passe devant", twoLeaks.worst?.to, "commandes");
  t.check(
    "une fuite chiffrée passe devant une fuite non chiffrable",
    twoLeaks.leaks[0].costPerMonth !== null,
    true,
  );
  t.check(
    "une marche d'impressions n'a pas de prix",
    twoLeaks.leaks.find((l) => l.to === "clics")!.costPerMonth,
    null,
  );

  // --- LA RÈGLE : ne jamais enjamber un trou -------------------------------
  // Sans Meta, les deux premières marches manquent. La fuite ne doit être
  // cherchée qu'entre paniers et commandes — jamais entre impressions et
  // paniers, qui n'ont aucune marche commune observée.
  const shopifyOnly = buildFunnel([
    obs("shopify.orders_30d", 20),
    obs("shopify.abandoned_checkouts_30d", 280),
    obs("shopify.aov", 100, "EUR"),
  ]);
  // Les marches Meta manquent, et les commandes conservées aussi : sans taux de
  // remboursement, cette marche ne se déduit pas — elle ne s'invente pas non plus.
  t.check("les marches non mesurées sont toutes déclarées", shopifyOnly.unknown, [
    "impressions",
    "clics",
    "commandes_conservees",
  ]);
  t.check(
    "aucune fuite n'est imputée à une marche inconnue",
    shopifyOnly.leaks.every((l) => l.from !== "clics" && l.from !== "impressions"),
    true,
  );
  t.check("la fuite mesurable reste trouvée", shopifyOnly.worst?.from, "paniers");
  // 300 paniers, 20 commandes : 6,67 % au lieu de 30 % attendus, soit 70
  // commandes manquantes à 100 EUR pièce.
  t.check("et chiffrée", shopifyOnly.worst?.costPerMonth, 7000);

  // Sans paniers abandonnés, la marche « paniers » disparaît — et la fuite
  // n'est PAS reportée sur clics → commandes, qui ne sont pas consécutives.
  const noCarts = buildFunnel([
    obs("meta.impressions_30d", 100000),
    obs("meta.clicks_30d", 2000),
    obs("shopify.orders_30d", 20),
    obs("shopify.aov", 100, "EUR"),
  ]);
  t.check("sans paniers, la marche est inconnue", noCarts.unknown.includes("paniers"), true);
  t.check(
    "et aucune fuite ne saute par-dessus",
    noCarts.leaks.some((l) => l.from === "clics" && l.to === "commandes"),
    false,
  );

  // --- Rien à signaler ------------------------------------------------------
  const healthy = buildFunnel([
    obs("meta.impressions_30d", 100000),
    obs("meta.clicks_30d", 3000),
    obs("shopify.orders_30d", 120),
    obs("shopify.abandoned_checkouts_30d", 180),
    obs("shopify.aov", 80, "EUR"),
  ]);
  t.check("un entonnoir sain ne produit aucune fuite", healthy.leaks.length, 0);
  t.check("et aucune pire fuite", healthy.worst, null);
  // Ne pas conclure que tout va bien : la fuite peut être sur une marche non
  // mesurée. C'est précisément ce que le bloc doit dire.
  t.check(
    "et le prompt refuse d'en conclure que tout va bien",
    funnelToPromptBlock(healthy).includes(
      "la fuite, s'il y en a une, est sur une marche non mesurée",
    ),
    true,
  );

  // --- Sans panier moyen, aucune somme n'est inventée ----------------------
  const noAov = buildFunnel([
    obs("shopify.orders_30d", 20),
    obs("shopify.abandoned_checkouts_30d", 280),
  ]);
  t.check("la fuite est trouvée sans panier moyen", noAov.worst?.from, "paniers");
  t.check("mais son coût reste inconnu", noAov.worst?.costPerMonth, null);
  t.check("plutôt que zéro", noAov.worst?.costPerMonth === 0, false);
  t.check(
    "et le prompt le dit",
    funnelToPromptBlock(noAov).includes("n'est pas chiffrable sans le panier moyen"),
    true,
  );

  // --- Entonnoir trop pauvre pour être reconstitué -------------------------
  const tooLittle = buildFunnel([obs("shopify.orders_30d", 20)]);
  t.check("une seule marche ne fait pas un entonnoir", tooLittle.leaks, []);
  t.check(
    "et le prompt interdit d'en raisonner un",
    funnelToPromptBlock(tooLittle).includes("Ne raisonne pas en entonnoir"),
    true,
  );
  t.check("aucune observation ne fait pas échouer", buildFunnel([]).steps.length, 5);
  t.check("toutes les marches sont alors inconnues", buildFunnel([]).unknown.length, 5);

  // --- Boutique sans aucune vente ------------------------------------------
  // Zéro commande et des paniers abandonnés : la fuite est réelle, totale, et
  // ne doit pas faire diviser par zéro.
  const noSales = buildFunnel([
    obs("shopify.orders_30d", 0),
    obs("shopify.abandoned_checkouts_30d", 40),
    obs("shopify.aov", 0, "EUR"),
  ]);
  t.check("une boutique sans vente produit un entonnoir", noSales.worst?.from, "paniers");
  t.check("le taux de passage est nul", noSales.worst?.rate, 0);
  t.check("et rien ne part en infini", Number.isFinite(noSales.worst!.missing), true);

  // --- Ce qui part dans le prompt ------------------------------------------
  const block = funnelToPromptBlock(complete);
  t.check("les marches sont listées dans l'ordre", block.includes("ENTONNOIR MESURÉ"), true);
  t.check("la fuite la plus chère est désignée", block.includes("LA FUITE LA PLUS COÛTEUSE"), true);
  t.check("avec son montant", block.includes("2400"), true);
  // Le garde-fou qui empêche de transformer un ordre de grandeur en promesse.
  t.check(
    "les références sont annoncées comme des ordres de grandeur",
    block.includes("ORDRES DE GRANDEUR issus de l'usage"),
    true,
  );
  t.check("et plafonnent la confiance", block.includes('confiance "medium" au plus'), true);
  const partial = funnelToPromptBlock(shopifyOnly);
  t.check(
    "une marche non mesurée interdit de la combler",
    partial.includes("n'invente pas cette marche"),
    true,
  );
  t.check(
    "et l'absence de recherche autour d'elle est dite",
    partial.includes("La fuite n'a PAS été cherchée autour d'elles"),
    true,
  );

  // --- L'ancrage du classement sur la mesure ------------------------------
  // Sans lui, le classement reposerait sur le montant DEVINÉ par le modèle : un
  // problème réel chiffré à 2 400 EUR passerait derrière une piste à laquelle
  // il aurait spontanément attribué 12 000 EUR.
  const guessed = [
    { category: "conversion", estimated_gain_min: 200, estimated_gain_max: 12000 },
    { category: "retention", estimated_gain_min: 500, estimated_gain_max: 900 },
  ];
  const anchored = anchorGainsOnLeak(guessed, complete.worst);
  t.check("un seul problème est concerné", anchored.anchored, 1);
  t.check(
    "le problème du domaine qui fuit est ramené à la mesure",
    [anchored.findings[0].estimated_gain_min, anchored.findings[0].estimated_gain_max],
    [Math.round(2400 * RECOVERABLE_SHARE_MIN), 2400],
  );
  t.check(
    "un problème d'un autre domaine n'est pas touché",
    [anchored.findings[1].estimated_gain_min, anchored.findings[1].estimated_gain_max],
    [500, 900],
  );
  // On ne promet jamais la totalité de la fuite : une correction parfaite
  // n'existe pas. Mieux vaut annoncer moins et le tenir.
  t.check(
    "la fourchette basse reste prudente",
    anchored.findings[0].estimated_gain_min! < 2400,
    true,
  );
  t.check(
    "sans fuite chiffrée, rien n'est ancré",
    anchorGainsOnLeak(guessed, noAov.worst).anchored,
    0,
  );
  t.check(
    "et les estimations d'origine sont conservées",
    anchorGainsOnLeak(guessed, null).findings,
    guessed,
  );
  t.check(
    "une fuite d'acquisition n'ancre pas un problème de conversion",
    anchorGainsOnLeak(
      [{ category: "conversion", estimated_gain_min: 100, estimated_gain_max: 200 }],
      twoLeaks.leaks.find((l) => l.to === "clics") ?? null,
    ).anchored,
    0,
  );

  // --- Le branchement -------------------------------------------------------
  const runner = read("src/lib/audit-runner.server.ts");
  t.check("l'audit construit l'entonnoir", runner.includes("buildFunnel"), true);
  t.check("et l'injecte dans la demande", runner.includes("funnelToPromptBlock"), true);
  t.check(
    "à partir de toutes les sources, pas d'une seule",
    runner.includes("buildFunnel(allObservations(reports))"),
    true,
  );
  t.check(
    "et ancre le classement sur la fuite mesurée",
    runner.includes("anchorGainsOnLeak"),
    true,
  );
  t.check(
    "l'ancrage a lieu AVANT le calcul des priorités",
    // Comparé aux APPELS, pas aux imports : `computeCategoryScores` apparaît
    // en tête de fichier, bien avant tout code exécuté.
    //
    // ET SANS LA PARENTHÈSE FERMANTE. L'appel prend désormais un second
    // argument — les catégories réellement instruites. Une ancre qui figeait la
    // signature rendait -1, et la comparaison « avant » devenait fausse alors
    // que l'ordre n'avait pas bougé d'une ligne.
    runner.indexOf("anchorGainsOnLeak(parsed.findings") <
      runner.indexOf("computeCategoryScores(parsed.findings"),
    true,
  );
  const funnelModule = read("src/lib/funnel.ts");
  t.check("l'entonnoir ne dépend d'aucun connecteur", /connectors\//.test(funnelModule), false);
});
