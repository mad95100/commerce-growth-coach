import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_DIFFICULTY,
  MAX_GAIN,
  sanitizeAuditPayload,
  sanitizeFinding,
} from "../../src/lib/audit-sanitize";
import { FROM_ZERO_PCT, computeDeltas, percentChange } from "../../src/lib/metrics";
import type { StoreMetrics } from "../../src/lib/metrics";
import { measureOutcome } from "../../src/lib/measure";
import { analyseFindings, EPISTEMIC_LABELS } from "../../src/lib/finding-graph";
import { buildNextMovePlan } from "../../src/lib/next-move";
import { defineSuite } from "../harness";

/**
 * Robustesse du moteur, et boutiques réelles.
 *
 * CE QUI EST EN JEU. Tout ce qui précède suppose que le modèle répond bien et
 * que la boutique a des données. Aucune des deux hypothèses ne tient en
 * production. Un modèle renvoie « pricing » là où l'énumération attend
 * « offre », un gain « 1 500 € » là où on attend un nombre, parfois pas de
 * liste du tout. Une vraie boutique, elle, a souvent zéro vente, zéro
 * publicité, ou trois commandes sur trente jours.
 *
 * LA RÈGLE : échouer proprement, jamais afficher une conclusion inventée. Un
 * champ absent devient une valeur neutre annoncée comme telle — jamais une
 * valeur flatteuse, jamais un chiffre sorti de nulle part.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

const APPLIED = "2026-07-01T00:00:00.000Z";
const AFTER_30D = new Date(APPLIED).getTime() + 30 * 86_400_000;

function shopify(revenue: number | null, orders: number | null, aov: number | null): StoreMetrics {
  return {
    captured_at: APPLIED,
    shopify: { currency: "EUR", revenue_30d: revenue, orders_30d: orders, aov },
    meta: null,
    google: null,
  };
}

export default defineSuite("Moteur — robustesse et boutiques réelles", (t) => {
  // =========================================================================
  // 1. CE QUE LE MODÈLE RENVOIE VRAIMENT
  // =========================================================================
  // Le défaut corrigé : `category` est une énumération PostgreSQL. Une seule
  // valeur inattendue faisait échouer l'insertion ENTIÈRE — un audit déjà payé,
  // dont les problèmes valides étaient perdus avec l'invalide.
  const wrongEnum = sanitizeFinding({ title: "Prix trop élevé", category: "pricing" });
  t.check("un domaine inconnu ne perd pas le problème", wrongEnum?.title, "Prix trop élevé");
  t.check("il est reclassé sur une valeur acceptée", wrongEnum?.category, "operations");
  t.check(
    "une sévérité inventée est ramenée à moyenne",
    sanitizeFinding({ title: "T", severity: "urgentissime" })?.severity,
    "medium",
  );
  t.check(
    "un délai inventé est ramené à cette semaine",
    sanitizeFinding({ title: "T", timeframe: "demain" })?.timeframe,
    "this_week",
  );
  t.check(
    "les valeurs valides passent intactes",
    sanitizeFinding({ title: "T", category: "conversion", severity: "critical" })?.category,
    "conversion",
  );
  t.check(
    "la casse ne fait pas échouer",
    sanitizeFinding({ title: "T", category: "CONVERSION" })?.category,
    "conversion",
  );

  // Les nombres, tels qu'un modèle les écrit réellement.
  t.check(
    "un montant écrit en toutes lettres est lu",
    sanitizeFinding({ title: "T", estimated_gain_min: "1 500 €" })?.estimated_gain_min,
    1500,
  );
  t.check(
    "une virgule décimale est lue",
    sanitizeFinding({ title: "T", estimated_gain_min: "12,5" })?.estimated_gain_min,
    12.5,
  );
  t.check(
    "un gain négatif est ramené à zéro",
    sanitizeFinding({ title: "T", estimated_gain_min: -400 })?.estimated_gain_min,
    0,
  );
  t.check(
    "un gain démesuré est plafonné",
    sanitizeFinding({ title: "T", estimated_gain_min: 1e15 })?.estimated_gain_min,
    MAX_GAIN,
  );
  t.check(
    "une fourchette inversée est remise à l'endroit",
    [
      sanitizeFinding({ title: "T", estimated_gain_min: 900, estimated_gain_max: 100 })
        ?.estimated_gain_min,
      sanitizeFinding({ title: "T", estimated_gain_min: 900, estimated_gain_max: 100 })
        ?.estimated_gain_max,
    ],
    [100, 900],
  );
  // Zéro serait une AFFIRMATION — « ce problème ne rapporte rien » — alors
  // qu'on ne sait pas. `null` dit qu'on ne sait pas.
  t.check(
    "un montant absent reste inconnu, pas zéro",
    sanitizeFinding({ title: "T" })?.estimated_gain_min,
    null,
  );
  t.check(
    "un montant illisible reste inconnu",
    sanitizeFinding({ title: "T", estimated_gain_min: "beaucoup" })?.estimated_gain_min,
    null,
  );
  t.check(
    "une difficulté hors bornes est ramenée",
    sanitizeFinding({ title: "T", difficulty: 12 })?.difficulty,
    MAX_DIFFICULTY,
  );
  t.check(
    "une difficulté nulle aussi",
    sanitizeFinding({ title: "T", difficulty: 0 })?.difficulty,
    1,
  );

  // Les listes et objets imbriqués.
  t.check(
    "des étapes en texte simple sont acceptées",
    sanitizeFinding({ title: "T", action_steps: ["Une", "Deux"] })?.action_steps,
    [{ text: "Une" }, { text: "Deux" }],
  );
  t.check(
    "des étapes malformées sont écartées sans tout perdre",
    sanitizeFinding({ title: "T", action_steps: [{ text: "Bonne" }, null, 42, { autre: 1 }] })
      ?.action_steps,
    [{ text: "Bonne" }],
  );
  t.check(
    "des étapes qui ne sont pas une liste ne font pas échouer",
    sanitizeFinding({ title: "T", action_steps: "à faire" })?.action_steps,
    [],
  );
  t.check(
    "une correction sans contenu est écartée",
    sanitizeFinding({ title: "T", auto_correction: { title: "Titre" } })?.auto_correction,
    null,
  );
  t.check(
    "une correction complète est gardée",
    sanitizeFinding({ title: "T", auto_correction: { title: "A", content: "B" } })?.auto_correction,
    { title: "A", content: "B" },
  );

  // Sans titre, il n'y a pas de problème à montrer — et lui en inventer un
  // serait exactement ce que ce module existe pour empêcher.
  t.check("un problème sans titre est écarté", sanitizeFinding({ category: "offre" }), null);
  t.check("un titre vide aussi", sanitizeFinding({ title: "   " }), null);
  t.check("une entrée qui n'est pas un objet aussi", sanitizeFinding("un problème"), null);
  t.check("null aussi", sanitizeFinding(null), null);

  // LA règle anti-invention : un champ de preuve absent reste VIDE, ce que
  // `finding-graph` lira comme « donnée manquante ».
  const noEvidence = sanitizeFinding({ title: "T", confidence: "high" })!;
  t.check("une preuve absente reste vide", noEvidence.evidence.based_on, "");
  t.check(
    "et le classement épistémique en tire la conséquence",
    analyseFindings([{ ...noEvidence, key: "t" }]).findings[0].epistemic,
    "donnee_manquante",
  );
  t.check(
    "affichée telle quelle au marchand",
    EPISTEMIC_LABELS[analyseFindings([{ ...noEvidence, key: "t" }]).findings[0].epistemic],
    "Donnée manquante",
  );

  // --- La réponse entière ---------------------------------------------------
  const broken = sanitizeAuditPayload({ verdict: "OK", summary: "S" });
  t.check("une réponse sans liste de problèmes ne fait pas échouer", broken.findings, []);
  t.check("l'anomalie est notée", broken.repairs.length > 0, true);
  t.check(
    "un audit vide le dit honnêtement",
    sanitizeAuditPayload({}).summary.includes("Aucun problème n'a pu être établi"),
    true,
  );
  t.check("une réponse nulle ne fait pas échouer", sanitizeAuditPayload(null).findings, []);
  t.check("un tableau à la place d'un objet non plus", sanitizeAuditPayload([1, 2]).findings, []);

  const mixed = sanitizeAuditPayload({
    verdict: "Verdict",
    summary: "Résumé",
    findings: [
      { title: "Valide", category: "conversion" },
      null,
      { category: "offre" },
      { title: "Autre", category: "n'importe quoi" },
    ],
  });
  t.check(
    "les problèmes valides survivent aux invalides",
    mixed.findings.map((f) => f.title),
    ["Valide", "Autre"],
  );
  t.check("et chaque écart est tracé", mixed.repairs.length >= 2, true);

  // Le nettoyage doit être branché, sinon il ne protège rien.
  const runner = read("src/lib/audit-runner.server.ts");
  t.check("l'audit nettoie la réponse du modèle", runner.includes("sanitizeAuditPayload"), true);
  t.check(
    "un JSON illisible produit un message clair, pas une exception brute",
    runner.includes("Réponse IA illisible"),
    true,
  );

  // =========================================================================
  // 2. BOUTIQUES RÉELLES
  // =========================================================================

  // --- Boutique nouvellement créée : la toute première vente ---------------
  // LE défaut corrigé : la division par zéro renvoyait `null`, ce qui effaçait
  // l'événement que le produit existe pour provoquer.
  t.check("de zéro à quelque chose est une amélioration", percentChange(0, 5), FROM_ZERO_PCT);
  t.check("de zéro à zéro ne dit rien", percentChange(0, 0), null);
  t.check("de zéro vers le négatif est une dégradation", percentChange(0, -3), -FROM_ZERO_PCT);
  t.check("une valeur absente ne dit rien", percentChange(null, 5), null);
  t.check("un calcul ordinaire est inchangé", percentChange(100, 130), 30);

  const firstSale = measureOutcome({
    deltas: computeDeltas(shopify(0, 0, null), shopify(240, 3, 80)),
    appliedAt: APPLIED,
    now: AFTER_30D,
    category: "conversion",
  });
  t.check("la première vente est reconnue comme un succès", firstSale.verdict, "confirme");
  t.check(
    "et portée au crédit de la correction",
    firstSale.headline.includes("Commandes 30 jours") || firstSale.headline.includes("CA 30 jours"),
    true,
  );

  // --- Boutique sans aucune vente, avant comme après -----------------------
  const stillNothing = measureOutcome({
    deltas: computeDeltas(shopify(0, 0, null), shopify(0, 0, null)),
    appliedAt: APPLIED,
    now: AFTER_30D,
    category: "conversion",
  });
  t.check("sans vente des deux côtés, aucun verdict n'est rendu", stillNothing.verdict, "en_cours");
  t.check(
    "et on dit qu'il manque de quoi mesurer",
    stillNothing.explanation.includes("canal concerné est bien connecté"),
    true,
  );

  // --- Beaucoup de trafic, aucune vente ------------------------------------
  // Rien ne doit être conclu du chiffre d'affaires : il n'y en a pas.
  const trafficNoSales = analyseFindings([
    {
      key: "confiance",
      title: "Aucun signal de confiance",
      category: "conversion",
      severity: "critical",
      timeframe: "today",
      difficulty: 2,
      confidence: "high",
      evidence: {
        based_on: "1 240 sessions et 0 commande sur 30 jours (Shopify)",
        assumptions: "",
      },
    },
    {
      key: "prix",
      title: "Prix probablement trop élevé",
      category: "offre",
      severity: "high",
      timeframe: "this_week",
      difficulty: 3,
      confidence: "medium",
      evidence: { based_on: "", assumptions: "Aucune donnée de comparaison marché" },
      caused_by: ["confiance"],
    },
  ]);
  t.check(
    "un fait mesuré est annoncé comme un fait",
    trafficNoSales.findings.find((f) => f.key === "confiance")!.epistemic,
    "fait",
  );
  t.check(
    "une intuition sans base est annoncée comme donnée manquante",
    trafficNoSales.findings.find((f) => f.key === "prix")!.epistemic,
    "donnee_manquante",
  );
  t.check(
    "et ne peut pas être présentée comme urgente",
    trafficNoSales.findings.find((f) => f.key === "prix")!.band,
    "opportunite",
  );
  t.check("le fait mesuré, lui, passe en critique", trafficNoSales.findings[0].band, "critique");

  // --- Trafic faible : le bruit ne doit pas devenir une conclusion ---------
  // 180 → 190 € sur DEUX commandes fait +5,6 %, assez pour franchir le seuil de
  // bruit et décrocher un verdict. Ces dix euros sont une commande un peu plus
  // chère, pas l'effet d'une correction : le pourcentage est une illusion
  // d'optique produite par un dénominateur minuscule.
  const tinyTraffic = measureOutcome({
    deltas: computeDeltas(shopify(180, 2, 90), shopify(190, 2, 95)),
    appliedAt: APPLIED,
    now: AFTER_30D,
    category: "conversion",
  });
  t.check("deux commandes ne permettent aucun verdict", tinyTraffic.verdict, "en_cours");
  t.check(
    "et on dit franchement qu'on ne sait pas",
    tinyTraffic.explanation.includes("Je préfère te dire que je ne sais pas"),
    true,
  );
  t.check(
    "le plancher de volume est nommé",
    tinyTraffic.headline.includes("Trop peu de commandes"),
    true,
  );
  // Le plancher ne doit PAS écraser le passage par zéro : une première vente
  // est un changement d'état, pas une variation.
  t.check(
    "une première vente échappe au plancher de volume",
    measureOutcome({
      deltas: computeDeltas(shopify(0, 0, null), shopify(240, 3, 80)),
      appliedAt: APPLIED,
      now: AFTER_30D,
      category: "conversion",
    }).verdict,
    "confirme",
  );
  // Au-dessus du plancher, le jugement reprend normalement.
  t.check(
    "au-dessus du plancher, le verdict est rendu",
    measureOutcome({
      deltas: computeDeltas(shopify(1800, 20, 90), shopify(1900, 21, 90)),
      appliedAt: APPLIED,
      now: AFTER_30D,
      category: "conversion",
    }).verdict,
    "insuffisant",
  );

  // --- Beaucoup de ventes, panier moyen faible -----------------------------
  const lowAov = measureOutcome({
    deltas: computeDeltas(shopify(4000, 200, 20), shopify(5200, 200, 26)),
    appliedAt: APPLIED,
    now: AFTER_30D,
    category: "offre",
  });
  t.check("une hausse du panier moyen est confirmée", lowAov.verdict, "confirme");
  t.check(
    "sans que le CA serve de garde contre elle",
    lowAov.guards.every((g) => g.gain_pct > 0),
    true,
  );

  // --- Publicité au mauvais ROAS -------------------------------------------
  // Couper le budget fait mécaniquement monter le ROAS. Sans garde-fou, la
  // pire décision passerait pour un succès.
  const adsCut: StoreMetrics = {
    captured_at: APPLIED,
    shopify: { currency: "EUR", revenue_30d: 9000, orders_30d: 100, aov: 90 },
    meta: { currency: "EUR", spend: 4000, purchases: 100, roas: 2.2, ctr: 1.1 },
    google: null,
  };
  const adsAfter: StoreMetrics = {
    captured_at: APPLIED,
    shopify: { currency: "EUR", revenue_30d: 4000, orders_30d: 45, aov: 89 },
    meta: { currency: "EUR", spend: 900, purchases: 44, roas: 4.4, ctr: 1.2 },
    google: null,
  };
  const cut = measureOutcome({
    deltas: computeDeltas(adsCut, adsAfter),
    appliedAt: APPLIED,
    now: AFTER_30D,
    tool: "meta_pause_adset",
    revertible: true,
  });
  t.check("un ROAS doublé au prix du volume est une régression", cut.verdict, "regression");
  t.check("et l'annulation est recommandée", cut.rollback.recommended, true);
  t.check("elle est possible ici", cut.rollback.possible, true);

  // --- Boutique sans données publicitaires ---------------------------------
  const noAds = measureOutcome({
    deltas: computeDeltas(shopify(3000, 40, 75), shopify(3300, 44, 75)),
    appliedAt: APPLIED,
    now: AFTER_30D,
    category: "acquisition",
  });
  t.check("sans canal publicitaire, aucun verdict d'acquisition", noAds.verdict, "en_cours");
  t.check(
    "et on oriente vers la connexion du canal",
    noAds.explanation.includes("canal concerné est bien connecté"),
    true,
  );

  // --- Données contradictoires ---------------------------------------------
  // Le ROAS monte, les achats s'effondrent, et le chiffre d'affaires ne bouge
  // pas : rien ne permet de trancher, et surtout pas d'inventer une conclusion.
  const before: StoreMetrics = {
    captured_at: APPLIED,
    shopify: { currency: "EUR", revenue_30d: 9000, orders_30d: 100, aov: 90 },
    meta: { currency: "EUR", spend: 3000, purchases: 80, roas: 3, ctr: 1 },
    google: null,
  };
  const after: StoreMetrics = {
    captured_at: APPLIED,
    shopify: { currency: "EUR", revenue_30d: 9100, orders_30d: 101, aov: 90 },
    meta: { currency: "EUR", spend: 2900, purchases: 55, roas: 4.5, ctr: 1 },
    google: null,
  };
  const contradictory = measureOutcome({
    deltas: computeDeltas(before, after),
    appliedAt: APPLIED,
    now: AFTER_30D,
    category: "acquisition",
  });
  t.check("des signaux opposés ne concluent pas", contradictory.verdict, "insuffisant");
  t.check("et le disent", contradictory.headline.includes("Signaux contradictoires"), true);
  t.check("sans recommander d'annuler", contradictory.rollback.recommended, false);

  // --- Fenêtre de mesure insuffisante --------------------------------------
  const tooEarly = measureOutcome({
    deltas: computeDeltas(shopify(1000, 10, 100), shopify(1400, 14, 100)),
    appliedAt: APPLIED,
    now: new Date(APPLIED).getTime() + 2 * 86_400_000,
    category: "conversion",
  });
  t.check("deux jours ne suffisent pas à conclure", tooEarly.verdict, "en_cours");
  t.check("et on annonce quand ce sera possible", tooEarly.headline.includes("verdict dans"), true);

  // --- Boutique internationale : devises différentes -----------------------
  // Un montant en dollars et un montant en euros ne se comparent pas. Chaque
  // écart doit porter SA devise, jamais celle de la boutique par défaut.
  const international: StoreMetrics = {
    captured_at: APPLIED,
    shopify: { currency: "USD", revenue_30d: 8000, orders_30d: 80, aov: 100 },
    meta: { currency: "EUR", spend: 2000, purchases: 60, roas: 3, ctr: 1 },
    google: null,
  };
  const deltas = computeDeltas(international, international);
  t.check(
    "le CA porte la devise de la boutique",
    deltas.find((d) => d.key === "revenue_30d")!.currency,
    "USD",
  );
  t.check(
    "la dépense publicitaire porte celle du compte",
    deltas.find((d) => d.key === "meta_spend")!.currency,
    "EUR",
  );
  t.check(
    "les deux ne sont jamais confondues",
    deltas.find((d) => d.key === "revenue_30d")!.currency !==
      deltas.find((d) => d.key === "meta_spend")!.currency,
    true,
  );

  // --- Boutique nouvelle : aucun historique, aucune donnée -----------------
  const brandNew = analyseFindings([]);
  t.check("aucun problème ne fait pas échouer l'analyse", brandNew.findings, []);
  const emptyPlan = buildNextMovePlan([]);
  t.check("et le plan reste honnête", emptyPlan.now, null);
  t.check(
    "en invitant à lancer un diagnostic",
    emptyPlan.rationale.includes("Relance un diagnostic"),
    true,
  );

  // =========================================================================
  // 3. CE QUE LE MOTEUR REFUSE DE FAIRE
  // =========================================================================
  // Aucun de ces chemins ne doit pouvoir produire une conclusion inventée.
  const invented = analyseFindings([
    {
      key: "devine",
      title: "Le marché est saturé",
      category: "acquisition",
      severity: "critical",
      timeframe: "today",
      difficulty: 1,
      confidence: "high",
      estimated_gain_min: 50_000,
      estimated_gain_max: 90_000,
      evidence: { based_on: "aucune", assumptions: "" },
    },
  ]);
  t.check(
    "une affirmation sans preuve, même chiffrée, reste une donnée manquante",
    invented.findings[0].epistemic,
    "donnee_manquante",
  );
  t.check("et ne peut jamais être critique", invented.findings[0].band, "opportunite");
  t.check("elle est listée comme non vérifiable", invented.missing_data, ["devine"]);
  t.check(
    "la justification dit précisément pourquoi",
    invented.findings[0].justification.includes("La donnée qui permettrait de conclure manque"),
    true,
  );

  // --- Les corrections apportées au moteur sont branchées ------------------
  const reaudit = read("src/lib/reaudit.server.ts");
  // Le contrôle porte sur les lignes de CODE : les commentaires du module
  // citent délibérément `measured_at` pour expliquer pourquoi on ne s'en sert
  // plus, et les compter ferait échouer le test sur sa propre explication.
  const reauditCode = reaudit
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  t.check("la relance s'appuie sur la date de règlement", reauditCode.includes("settled_at"), true);
  t.check("et jamais sur la dernière mesure", reauditCode.includes("measured_at"), false);
  t.check(
    "le lancement est réclamé avant d'être exécuté",
    reaudit.indexOf("reaudit_launched_at") < reaudit.indexOf("await launchAudit"),
    true,
  );
  t.check(
    "une réclamation perdue fait renoncer",
    /claimed\.length === 0\) return "attendre"/.test(reaudit),
    true,
  );
  t.check(
    "les boutiques sont examinées à tour de rôle",
    reaudit.includes("reaudit_checked_at"),
    true,
  );

  const tracking = read("src/lib/tracking.server.ts");
  t.check(
    "la date de règlement n'est écrite qu'une fois",
    tracking.includes("settledNow ? measuredAt : settledBefore"),
    true,
  );
  t.check(
    "les dates connues sont relues pour ne pas être effacées",
    tracking.includes("settledBySignature"),
    true,
  );
});
