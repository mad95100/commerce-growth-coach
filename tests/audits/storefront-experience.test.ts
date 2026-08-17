import { readFileSync } from "node:fs";
import { defineSuite } from "../harness";
import {
  FIRST_BLOCK_CHARS,
  OUT_OF_REACH,
  experienceFindings,
  experienceToPromptBlock,
  extractExperience,
} from "@/lib/storefront-experience";
import { deduceAudience, type AudienceHypothesis, type AudienceInput } from "@/lib/audience";
import { runRules, scoreAxes, type RuleContext } from "@/lib/audit-rules";
import type { Observation } from "@/lib/observations";

/**
 * L'EXPÉRIENCE DU SITE PUBLIC, ÉPROUVÉE SUR DES PAGES RÉALISTES.
 *
 * POURQUOI DES FIXTURES ET NON UNE VRAIE BOUTIQUE. Une vraie page valide qu'on
 * sait lire CETTE page ; une fixture valide qu'on sait lire une CLASSE de pages,
 * y compris celles qu'on n'a pas sous la main — la page vide, la page surchargée,
 * la page malformée. Les deux sont nécessaires, et seule la seconde est
 * reproductible.
 *
 * CE QUI EST VÉRIFIÉ EN PRIORITÉ n'est pas ce que le module affirme, mais ce
 * qu'il refuse d'affirmer. Le HTML ne dit pas ce qui est VU : ni la taille
 * finale d'un texte, ni les couleurs après cascade, ni ce qui tombe au-dessus de
 * la ligne de flottaison. Un module qui prétendrait le contraire produirait des
 * conseils qui paraissent experts et se trompent.
 */

// --- Fixtures ---------------------------------------------------------------

/** Une page d'accueil correcte : promesse, action, réassurance, navigation. */
const PAGE_SAINE = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width">
<style>:root{--a:#1a1a1a;--b:#ffffff}body{font-family:Inter,sans-serif}h1{font-family:Inter,sans-serif}</style>
</head><body>
<nav><a href="/collections/all">Snowboards</a><a href="/collections/wax">Entretien</a><a href="/pages/livraison">Livraison</a></nav>
<section class="hero">
  <h1>Snowboards fabriqués à la main pour riders exigeants</h1>
  <p>Chaque planche est pressée dans notre atelier des Alpes, testée sur neige avant expédition, et garantie à vie contre le délaminage. Livraison en 48 heures, retours acceptés sous 30 jours sans justification.</p>
  <a href="/collections/all" class="btn">Voir les snowboards</a>
</section>
<section><p>Retours sous 30 jours · Paiement sécurisé · Garantie à vie</p></section>
<section><h2>Ce qu'en disent les riders</h2><p>Plus de 400 avis vérifiés, note moyenne de 4,8 sur 5.</p></section>
<footer><a href="mailto:bonjour@exemple.com">Nous contacter</a></footer>
</body></html>`;

/** Le cas le plus courant : un thème par défaut jamais rempli. */
const PAGE_MUETTE = `<!doctype html><html><head>
<style>body{font-family:Helvetica}</style></head><body>
<div class="slideshow"><img src="/banner.jpg"></div>
<div class="featured"><img src="/p1.jpg"><img src="/p2.jpg"></div>
</body></html>`;

/** Une page bavarde et incohérente : trop de tout, rien de hiérarchisé. */
const PAGE_SURCHARGEE = `<!doctype html><html><head><style>
body{font-family:Arial}h1{font-family:Georgia}h2{font-family:Verdana}
.a{font-family:Courier}.b{font-family:Impact}.c{font-family:Tahoma}
.c1{color:#111111}.c2{color:#222222}.c3{color:#333333}.c4{color:#444444}
.c5{color:#555555}.c6{color:#666666}.c7{color:#777777}.c8{color:#888888}
.c9{color:#999999}.c10{color:#aaaaaa}.c11{color:#bbbbbb}.c12{color:#cccccc}
.c13{color:#dddddd}.c14{color:#eeeeee}.c15{color:#ff0000}.c16{color:#00ff00}
.c17{color:#0000ff}.c18{color:#ff00ff}.c19{color:#00ffff}.c20{color:#ffff00}
.c21{color:#123456}.c22{color:#654321}</style></head><body>
<nav>${Array.from({ length: 15 }, (_, i) => `<a href="/c${i}">Rubrique ${i}</a>`).join("")}</nav>
<h1>Bienvenue</h1>
<p>Notre boutique vous propose une large sélection de produits soigneusement choisis pour répondre à toutes vos envies et à tous vos besoins au quotidien, avec le sérieux qui nous caractérise depuis toujours.</p>
<a href="/collections/all">Acheter</a>
</body></html>`;

/** Un document cassé : balises non fermées, script géant, encodage douteux. */
const PAGE_CASSEE = `<html><body><div><p>Bonjour<script>${"x".repeat(5000)}</script>
<h1>Boutique</h1><div><span>&nbsp;&amp;&#233;`;

// --- Aides ------------------------------------------------------------------

const VIDE: AudienceInput = {
  medianPrice: null,
  priceMin: null,
  priceMax: null,
  currency: null,
  productCount: null,
  texts: [],
  descriptionsMissingShare: null,
  aov: null,
  orders: null,
  returningShare: null,
  discountedShare: null,
  policyPages: null,
  reviewsDeclared: null,
  shippingMentioned: null,
};

const PREMIUM = deduceAudience({
  ...VIDE,
  medianPrice: 700,
  currency: "EUR",
  productCount: 17,
  texts: ["Snowboard premium artisanal"],
}) as AudienceHypothesis;

const ENTREE = deduceAudience({
  ...VIDE,
  medianPrice: 12,
  currency: "EUR",
  productCount: 60,
  texts: ["petit prix"],
}) as AudienceHypothesis;

function obs(id: string, value: number | null): Observation {
  return {
    id,
    source: "shopify",
    domain: "retention",
    label: id,
    value,
    unit: "count",
    periodDays: 30,
    evidence: `preuve ${id}`,
    sample: null,
  } as Observation;
}

export default defineSuite("Site public — expérience, perception et rétention", (t) => {
  // --- 1. Extraction sur une page saine ------------------------------------
  const saine = extractExperience(PAGE_SAINE);
  t.check("le titre principal est lu", saine.h1?.startsWith("Snowboards fabriqués"), true);
  t.check("la longueur du titre est comptée", saine.h1Words >= 6, true);
  t.check("un appel à l'action est trouvé en haut", saine.ctaInFirstBlock, true);
  t.check("les liens de navigation sont comptés", saine.navLinks, 3);
  t.check("la réassurance est détectée", saine.mentionsTrust, true);
  t.check("les avis sont détectés", saine.mentionsReviews, true);
  t.check("le contact est détecté", saine.hasContact, true);
  t.check("le texte du premier bloc est substantiel", saine.firstBlockWords > 40, true);
  // Une page saine ne doit produire aucun constat : un moteur qui trouve
  // toujours quelque chose ne trouve rien.
  t.check("une page saine ne produit aucun constat", experienceFindings(saine, PREMIUM).length, 0);

  // --- 2. Le cas le plus courant : le thème jamais rempli ------------------
  const muette = extractExperience(PAGE_MUETTE);
  t.check("aucun titre n'est trouvé", muette.h1, null);
  t.check("aucun appel à l'action n'est trouvé", muette.ctaCount, 0);
  t.check("aucune navigation n'est trouvée", muette.navLinks, 0);
  t.check("aucune réassurance", muette.mentionsTrust, false);

  const constatsMuette = experienceFindings(muette, PREMIUM);
  const ids = constatsMuette.map((f) => f.id);
  t.check("l'absence de promesse est constatée", ids.includes("experience.promesse_absente"), true);
  t.check("l'absence d'appel à l'action est constatée", ids.includes("experience.aucun_cta"), true);
  t.check(
    "l'absence de navigation est constatée",
    ids.includes("experience.navigation_absente"),
    true,
  );
  t.check(
    "l'absence de réassurance est constatée",
    ids.includes("experience.reassurance_absente"),
    true,
  );
  t.check("le premier bloc muet est constaté", ids.includes("experience.premier_bloc_muet"), true);

  // --- 3. La chaîne complète, sur chaque constat ---------------------------
  const tous = [
    ...constatsMuette,
    ...experienceFindings(extractExperience(PAGE_SURCHARGEE), PREMIUM),
  ];
  for (const f of tous) {
    t.check(`${f.id} : observation présente`, f.observation.length > 25, true);
    t.check(`${f.id} : problème distinct de l'observation`, f.problem !== f.observation, true);
    t.check(`${f.id} : preuve présente`, f.evidence.length > 0, true);
    t.check(`${f.id} : impact potentiel présent`, f.impact.length > 25, true);
    t.check(`${f.id} : recommandation présente`, f.recommendation.length > 25, true);
    t.check(`${f.id} : correction exécutable`, f.correction.length > 60, true);
    t.check(`${f.id} : impact borné`, f.impactScore >= 1 && f.impactScore <= 5, true);
    t.check(`${f.id} : effort borné`, f.effort >= 1 && f.effort <= 5, true);
  }
  // Les corrections doivent descendre au geste, pas rester en conseil.
  const creux = [
    "améliorer le design",
    "optimiser l'expérience",
    "revoir l'ergonomie",
    "moderniser",
  ];
  for (const f of tous) {
    for (const c of creux) {
      t.check(
        `${f.id} ne recommande pas « ${c} »`,
        f.recommendation.toLowerCase().includes(c) || f.correction.toLowerCase().includes(c),
        false,
      );
    }
  }

  // --- 4. LA LIGNE À NE PAS FRANCHIR : ce qui est vu ne se lit pas ---------
  // Aucun constat ne doit affirmer ce que le visiteur voit. Ce qui relève de la
  // perception est plafonné à « à vérifier », et le nier serait la faute la plus
  // coûteuse du module : un conseil qui paraît expert et se trompe.
  const perception = [
    "premier_bloc_muet",
    "cta_trop_bas",
    "typographies_multiples",
    "palette_dispersee",
  ];
  for (const f of tous) {
    if (perception.some((p) => f.id.includes(p))) {
      t.check(`${f.id} reste « à vérifier »`, f.level, "a_verifier");
    }
  }
  // Un fait purement documentaire — un titre existe ou non — peut être prouvé.
  const promesse = constatsMuette.find((f) => f.id === "experience.promesse_absente");
  t.check("l'absence de balise est un fait prouvé", promesse?.level, "prouve");

  // Aucun constat ne doit employer le vocabulaire de la perception visuelle.
  const interdits = [
    "ligne de flottaison",
    "au-dessus du pli",
    "joli",
    "moche",
    "élégant",
    "moderne",
  ];
  for (const f of tous) {
    const texte = `${f.observation} ${f.problem} ${f.impact}`.toLowerCase();
    for (const mot of interdits) {
      t.check(`${f.id} n'emploie pas « ${mot} »`, texte.includes(mot), false);
    }
  }

  // --- 5. Le public change la gravité, pas le fait ------------------------
  const gravePremium = experienceFindings(muette, PREMIUM).find(
    (f) => f.id === "experience.reassurance_absente",
  );
  const graveEntree = experienceFindings(muette, ENTREE).find(
    (f) => f.id === "experience.reassurance_absente",
  );
  t.check("le constat sort dans les deux cas", Boolean(gravePremium && graveEntree), true);
  t.check(
    "la gravité est plus élevée sur un public exigeant",
    (gravePremium?.impactScore ?? 0) > (graveEntree?.impactScore ?? 0),
    true,
  );
  t.check(
    "le problème est formulé différemment selon le public",
    gravePremium?.problem !== graveEntree?.problem,
    true,
  );
  // La preuve sociale n'est réclamée que là où elle décide.
  t.check(
    "la preuve sociale est exigée sur du premium",
    experienceFindings(muette, PREMIUM).some((f) => f.id === "experience.preuve_sociale_absente"),
    true,
  );
  t.check(
    "la preuve sociale n'est pas exigée en entrée de gamme",
    experienceFindings(muette, ENTREE).some((f) => f.id === "experience.preuve_sociale_absente"),
    false,
  );
  // Sans public déduit, les constats sortent quand même, sans gravité inventée.
  const sansPublic = experienceFindings(muette, null);
  t.check("les constats sortent sans public déduit", sansPublic.length > 0, true);
  t.check(
    "aucune gamme n'est citée quand le public est inconnu",
    sansPublic.some((f) => /positionnée en/.test(f.observation)),
    false,
  );

  // --- 6. Page surchargée --------------------------------------------------
  const surchargee = extractExperience(PAGE_SURCHARGEE);
  t.check("les polices distinctes sont comptées", surchargee.distinctFonts >= 5, true);
  t.check("les couleurs distinctes sont comptées", surchargee.distinctColors >= 20, true);
  t.check("les liens de navigation sont comptés", surchargee.navLinks, 15);
  const idsSurcharge = experienceFindings(surchargee, PREMIUM).map((f) => f.id);
  t.check(
    "la navigation surchargée est constatée",
    idsSurcharge.includes("experience.navigation_surchargee"),
    true,
  );
  t.check(
    "les typographies multiples sont constatées",
    idsSurcharge.includes("experience.typographies_multiples"),
    true,
  );
  t.check(
    "la palette dispersée est constatée",
    idsSurcharge.includes("experience.palette_dispersee"),
    true,
  );

  // --- 7. Robustesse : un document cassé ne fait rien lever ---------------
  let leve = false;
  try {
    const casse = extractExperience(PAGE_CASSEE);
    experienceFindings(casse, PREMIUM);
    t.check("un document cassé rend quand même des faits", typeof casse.firstBlockWords, "number");
    t.check(
      "le contenu des scripts n'est pas compté comme du texte",
      casse.firstBlockWords < 50,
      true,
    );
    t.check("le titre est retrouvé malgré les balises non fermées", casse.h1, "Boutique");
  } catch {
    leve = true;
  }
  t.check("un document cassé ne fait pas lever le module", leve, false);
  t.check("une page vide ne fait pas lever", extractExperience("").h1, null);

  // --- 8. Les limites sont déclarées, pas approchées ----------------------
  t.check("les limites du document sont nommées", OUT_OF_REACH.length >= 3, true);
  for (const o of OUT_OF_REACH) {
    t.check(`${o.id} dit pourquoi c'est hors de portée`, o.reason.length > 60, true);
    t.check(`${o.id} dit ce que cela permettrait`, o.wouldEnable.length > 30, true);
  }

  const bloc = experienceToPromptBlock(constatsMuette, true);
  t.check("le bloc suit la chaîne complète", /Correction :/.test(bloc), true);
  t.check("le niveau de preuve accompagne chaque constat", /À VÉRIFIER|PROUVÉ/.test(bloc), true);
  t.check("les limites partent au modèle", /NE PERMET PAS DE JUGER/.test(bloc), true);
  t.check(
    "le jugement esthétique est interdit nommément",
    /AUCUN jugement esthétique/.test(bloc),
    true,
  );
  t.check("la ligne de flottaison est interdite au modèle", /ligne de flottaison/.test(bloc), true);
  // Site non scanné : interdiction de conclure, pas un silence.
  const blocSansScan = experienceToPromptBlock([], false);
  t.check("un site non scanné est déclaré", /NON ANALYSÉE/.test(blocSansScan), true);
  t.check("le modèle a interdiction de conclure", /Ne conclus rien/.test(blocSansScan), true);
  t.check("le seuil du premier bloc est explicite", FIRST_BLOCK_CHARS >= 1000, true);

  // --- 9. Rétention : rien n'est fabriqué sans commandes ------------------
  const ctx = (observations: Observation[]): RuleContext => ({
    observations,
    gaps: [],
    currency: "EUR",
  });
  const sansCommande = runRules(ctx([obs("shopify.orders_30d", 0)]));
  const retention = sansCommande.find((f) => f.ruleId === "data.retention_non_evaluable");
  t.check("la rétention est déclarée non évaluable", Boolean(retention), true);
  t.check("elle est marquée donnée insuffisante", retention?.level, "donnee_insuffisante");
  t.check(
    "aucun constat de rétention n'est fabriqué",
    sansCommande.some((f) => f.axis === "retention"),
    false,
  );
  t.check(
    "la recommandation dit à partir de quand le moteur se prononcera",
    /20 commandes payées/.test(retention?.recommendation ?? ""),
    true,
  );
  t.check(
    "elle nomme ce qui sera calculé",
    /délai entre deux commandes/.test(retention?.recommendation ?? ""),
    true,
  );
  // L'axe rétention n'est pas noté 100 : il est aveuglé.
  const axes = scoreAxes(sansCommande, [obs("shopify.orders_30d", 0)]);
  t.check(
    "l'axe rétention n'est pas noté sans commandes",
    axes.find((a) => a.axis === "retention")?.measured,
    false,
  );
  // Dès que la rétention EST mesurable, la règle se tait.
  const mesurable = runRules(
    ctx([obs("shopify.orders_30d", 200), obs("shopify.returning_customer_rate", 0.4)]),
  );
  t.check(
    "la règle se tait quand la rétention est mesurable",
    mesurable.some((f) => f.ruleId === "data.retention_non_evaluable"),
    false,
  );

  // --- 10. Le module est branché dans le chemin d'audit ------------------
  const runner = readFileSync(
    new URL("../../src/lib/audit-runner.server.ts", import.meta.url).pathname,
    "utf8",
  );
  t.check("le chemin d'audit extrait l'expérience", /extractExperience\(/.test(runner), true);
  t.check(
    "les constats d'expérience partent dans le prompt",
    /experienceToPromptBlock\(/.test(runner),
    true,
  );
});
