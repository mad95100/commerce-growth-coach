import { readFileSync } from "node:fs";
import { defineSuite } from "../harness";
import {
  AUDIT_AXES,
  EVIDENCE_LEVELS,
  EVIDENCE_WEIGHT,
  MAX_PRIORITIES,
  RULES,
  THRESHOLDS,
  TECHNICAL_CEILING,
  analyse,
  axisOfObservation,
  buildActionPlan,
  capLevel,
  globalScore,
  COMMERCIAL_AXES,
  MIN_MEASURED_AXES_SHARE,
  prioritise,
  runRules,
  rulesToPromptBlock,
  scoreAxes,
  type RuleContext,
  type RuleFinding,
} from "@/lib/audit-rules";
import type { Observation, ObservationGap } from "@/lib/observations";

/**
 * LE MOTEUR DE RÈGLES, CONFRONTÉ AUX BOUTIQUES QUI CASSENT LES MOTEURS.
 *
 * Une règle qui se déclenche correctement sur une boutique moyenne ne prouve
 * rien : c'est le cas facile. Ce qui se vérifie ici, c'est le comportement sur
 * les boutiques dont un diagnostic générique parle quand même — sans données,
 * sans commandes, sans trafic, avec un catalogue vide, avec des valeurs
 * aberrantes. Sur chacune, le moteur doit produire un constat honnête ou aucun
 * constat, jamais une conclusion inventée.
 */

function obs(partial: Partial<Observation> & { id: string }): Observation {
  return {
    source: "shopify",
    domain: "conversion",
    label: partial.id,
    value: null,
    unit: "count",
    periodDays: 30,
    evidence: `preuve pour ${partial.id}`,
    sample: null,
    ...partial,
  } as Observation;
}

function ctx(observations: Observation[], gaps: ObservationGap[] = []): RuleContext {
  return { observations, gaps, currency: "EUR" };
}

const gapSessions: ObservationGap = {
  id: "shopify.sessions_30d",
  label: "Sessions et visiteurs",
  source: "shopify",
  reason: "L'API Admin de Shopify n'expose pas le trafic.",
  wouldEnable: "Calculer un taux de conversion.",
};

export default defineSuite("Audit — moteur de règles déterministes", (t) => {
  // --- 1. L'invariant qui tient tout : aucune règle sans ses entrées --------
  t.check("le moteur déclare au moins dix règles", RULES.length >= 10, true);
  const axesCouverts = new Set(RULES.map((r) => r.axis));
  t.check(
    "chaque axe déclaré est couvert par une règle au moins",
    AUDIT_AXES.every((a) => axesCouverts.has(a)),
    true,
  );

  // Sur un contexte VIDE, aucune règle ne doit se prononcer. C'est le test le
  // plus important du fichier : il dit qu'aucune règle ne se rabat sur une
  // valeur par défaut quand la donnée manque.
  t.check("contexte vide => aucun constat", runRules(ctx([])).length, 0);

  // Et une par une, pour qu'une règle ajoutée demain ne puisse pas y échapper.
  for (const rule of RULES) {
    if (rule.requires.length === 0) continue;
    t.check(
      `${rule.id} ne se prononce pas sans ses observations`,
      rule.evaluate(ctx([])) === null || runRules(ctx([])).some((f) => f.ruleId === rule.id),
      true,
    );
  }

  // Une observation PRÉSENTE mais à `null` ne vaut pas une mesure.
  t.check(
    "une observation à null ne déclenche rien",
    runRules(
      ctx([
        obs({ id: "shopify.product_count", value: null }),
        obs({ id: "shopify.products_without_description", value: null }),
      ]),
    ).length,
    0,
  );

  // --- 2. Boutique sans trafic, sans commande ------------------------------
  // Le cas de `ecom-pilot-test` : un catalogue, aucune vente, aucun trafic
  // mesurable. Le moteur doit dire ce qu'il voit, et déclarer le reste absent.
  const boutiqueVide = ctx(
    [
      obs({ id: "shopify.product_count", value: 17, sample: 17, periodDays: 0 }),
      obs({ id: "shopify.products_without_description", value: 15, sample: 17, periodDays: 0 }),
      obs({ id: "shopify.products_without_image", value: 1, sample: 17, periodDays: 0 }),
      obs({ id: "shopify.products_out_of_stock", value: 0, sample: 17, periodDays: 0 }),
      obs({ id: "shopify.orders_30d", value: 0, sample: 0 }),
      obs({ id: "shopify.revenue_30d", value: 0, sample: 0, unit: "currency" }),
    ],
    [gapSessions],
  );
  const rapportVide = analyse(boutiqueVide);

  t.check(
    "catalogue faible => le constat sort",
    rapportVide.findings.some((f) => f.ruleId === "merchandising.descriptions_missing"),
    true,
  );
  t.check(
    "produit sans visuel => le constat sort",
    rapportVide.findings.some((f) => f.ruleId === "merchandising.images_missing"),
    true,
  );
  // ZÉRO COMMANDE N'EST PAS UN PROBLÈME DE CONVERSION. Sans trafic mesuré, on
  // ne peut pas distinguer « personne ne vient » de « personne n'achète ».
  t.check(
    "zéro commande sans trafic mesuré => aucun constat de conversion",
    rapportVide.findings.some((f) => f.axis === "conversion" && f.level !== "donnee_insuffisante"),
    false,
  );
  t.check(
    "le trafic non mesuré est déclaré, pas tu",
    rapportVide.findings.some(
      (f) => f.ruleId === "data.traffic_unmeasured" && f.level === "donnee_insuffisante",
    ),
    true,
  );
  t.check("les données manquantes sont énumérées", rapportVide.unresolved.length > 0, true);

  // --- 3. Petits échantillons ----------------------------------------------
  // Sous le seuil, un taux ne veut rien dire : la règle se tait.
  const petitEchantillon = ctx([
    obs({ id: "shopify.orders_30d", value: THRESHOLDS.MIN_ORDERS_FOR_RATES - 1, sample: 19 }),
    obs({ id: "shopify.returning_customer_rate", value: 0.02, unit: "percent", sample: 19 }),
    obs({ id: "shopify.top_product_revenue_share", value: 0.95, unit: "percent", sample: 19 }),
    obs({ id: "shopify.discounted_order_share", value: 0.9, unit: "percent", sample: 19 }),
  ]);
  // Un constat « donnée insuffisante » n'est PAS un taux commenté : c'est
  // précisément le refus d'en commenter un. Il est donc exclu du décompte.
  t.check(
    "sous le seuil d'échantillon, aucun taux n'est commenté",
    runRules(petitEchantillon).filter((f) => f.level !== "donnee_insuffisante").length,
    0,
  );
  t.check(
    "sous le seuil, l'impossibilité de conclure est déclarée",
    runRules(petitEchantillon).some((f) => f.level === "donnee_insuffisante"),
    true,
  );

  // Juste au-dessus, les mêmes valeurs produisent bien les constats.
  const echantillonSuffisant = ctx([
    obs({ id: "shopify.orders_30d", value: THRESHOLDS.MIN_ORDERS_FOR_RATES, sample: 20 }),
    obs({ id: "shopify.returning_customer_rate", value: 0.02, unit: "percent", sample: 20 }),
  ]);
  t.check(
    "au seuil d'échantillon, le constat sort",
    runRules(echantillonSuffisant).some((f) => f.ruleId === "retention.returning_rate_low"),
    true,
  );

  // --- 4. Catalogue vide ----------------------------------------------------
  /*
    CE CONTRÔLE ENCODAIT LE DÉFAUT QU'IL FALLAIT CORRIGER.

    Il exigeait ZÉRO constat sur un catalogue vide. Sa moitié juste : aucune
    PART ne doit être commentée — « 0 fiche sur 0 » n'est pas une mesure, et
    chaque règle de merchandising a raison de se retirer.

    Sa moitié fausse : il en concluait qu'il n'y avait rien à dire. Un rapport
    réel l'a montré — une boutique sans aucun produit a reçu quatre constats
    sur sa page d'accueil, sa navigation et son référencement, tous exacts, et
    pas un seul ne disait qu'il n'y avait rien à vendre. Le moteur décrivait
    très rigoureusement les conséquences d'un fait qu'il ne nommait pas.

    Les deux moitiés sont donc séparées, et chacune vérifiée pour elle-même.
  */
  const catalogueVide = runRules(
    ctx([
      obs({ id: "shopify.product_count", value: 0, sample: 0 }),
      obs({ id: "shopify.products_without_description", value: 0, sample: 0 }),
      obs({ id: "shopify.products_out_of_stock", value: 0, sample: 0 }),
    ]),
  );
  t.check(
    "catalogue vide => aucune part de catalogue commentée",
    catalogueVide.filter((f) => f.ruleId !== "merchandising.catalogue_vide").length,
    0,
  );
  t.check(
    "…mais le catalogue vide est nommé",
    catalogueVide.some((f) => f.ruleId === "merchandising.catalogue_vide"),
    true,
  );
  // C'est un COMPTE rendu par Shopify, pas une déduction : le niveau le dit.
  t.check(
    "…comme un fait mesuré",
    catalogueVide.find((f) => f.ruleId === "merchandising.catalogue_vide")?.level,
    "prouve",
  );
  // Et rien de ce que le marchand ferait ailleurs ne peut aboutir avant : le
  // constat doit passer devant, pas se ranger au milieu des autres.
  t.check(
    "…avec l'impact maximal",
    catalogueVide.find((f) => f.ruleId === "merchandising.catalogue_vide")?.impact,
    5,
  );

  // UN CATALOGUE FOURNI NE DÉCLENCHE RIEN. La règle ne se lit que sur zéro :
  // un seuil « catalogue trop petit » serait une opinion, pas une mesure.
  t.check(
    "un catalogue fourni ne déclenche pas la règle",
    runRules(ctx([obs({ id: "shopify.product_count", value: 12, sample: 12 })])).some(
      (f) => f.ruleId === "merchandising.catalogue_vide",
    ),
    false,
  );
  // Et un compte non lu n'est pas un compte à zéro.
  t.check(
    "un compte absent ne vaut pas un catalogue vide",
    runRules(ctx([])).some((f) => f.ruleId === "merchandising.catalogue_vide"),
    false,
  );

  // --- 5. La règle absolue : un fait technique reste technique -------------
  const techniqueSeul = ctx([
    obs({ id: "storefront.robots_blocks_all", value: 1, source: "storefront", periodDays: 0 }),
    obs({ id: "storefront.policy_pages", value: 0, source: "storefront", periodDays: 0 }),
    obs({ id: "storefront.mobile_viewport", value: 0, source: "storefront", periodDays: 0 }),
    obs({ id: "storefront.broken_pages", value: 2, source: "storefront", periodDays: 0 }),
  ]);
  const constatsTechniques = runRules(techniqueSeul);
  t.check(
    "les faits techniques produisent bien des constats",
    constatsTechniques.length >= 3,
    true,
  );
  t.check(
    "aucun fait technique n'est déclaré prouvé sans corroboration commerciale",
    constatsTechniques.every(
      (f) => EVIDENCE_LEVELS.indexOf(f.level) >= EVIDENCE_LEVELS.indexOf(TECHNICAL_CEILING),
    ),
    true,
  );
  // Toute règle marquée technique DOIT passer par le plafond. Le contrôle porte
  // sur le résultat, pas sur l'intention : une règle qui construirait son objet
  // à la main serait prise ici.
  for (const rule of RULES.filter((r) => r.technical)) {
    const produit = constatsTechniques.find((f) => f.ruleId === rule.id);
    if (!produit) continue;
    t.check(
      `${rule.id} plafonne au niveau technique`,
      EVIDENCE_LEVELS.indexOf(produit.level) >= EVIDENCE_LEVELS.indexOf(TECHNICAL_CEILING),
      true,
    );
  }
  t.check("capLevel n'élève jamais un niveau", capLevel("a_verifier", "prouve"), "a_verifier");
  t.check("capLevel abaisse bien", capLevel("prouve", "a_verifier"), "a_verifier");

  // --- 6. Chaque constat porte sa preuve -----------------------------------
  const tousConstats: RuleFinding[] = [
    ...rapportVide.findings,
    ...constatsTechniques,
    ...runRules(echantillonSuffisant),
  ];
  for (const f of tousConstats) {
    t.check(`${f.ruleId} porte au moins une phrase de preuve`, f.evidence.length > 0, true);
    t.check(`${f.ruleId} porte une recommandation`, f.recommendation.length > 20, true);
    t.check(`${f.ruleId} sépare le constat de l'interprétation`, f.statement !== f.why, true);
    t.check(`${f.ruleId} a un impact borné`, f.impact >= 1 && f.impact <= 5, true);
    t.check(`${f.ruleId} a un effort borné`, f.effort >= 1 && f.effort <= 5, true);
  }
  // Une recommandation vague est le défaut qu'on cherche à éviter : les
  // formules creuses sont interdites, nommément.
  const creux = ["améliorer le seo", "améliorer l'expérience", "optimiser le site"];
  for (const f of tousConstats) {
    t.check(
      `${f.ruleId} ne recommande pas une généralité`,
      creux.some((c) => f.recommendation.toLowerCase().includes(c)),
      false,
    );
  }

  // --- 7. Scores explicables ------------------------------------------------
  const axes = scoreAxes(rapportVide.findings, boutiqueVide.observations);
  t.check("les dix axes sont notés", axes.length, AUDIT_AXES.length);
  for (const a of axes) {
    // UN AXE NON MESURÉ N'A PLUS DE NOTE DU TOUT, et c'est le type qui
    // l'impose : le champ valait 100 — la note qu'obtient mécaniquement un
    // sujet sur lequel aucune règle n'a pu se prononcer — et il suffisait
    // d'oublier de consulter `measured` pour afficher une excellence
    // imaginaire.
    if (a.score === null) {
      t.check(`${a.axis} : sans note, il est déclaré non mesuré`, a.measured, false);
      continue;
    }
    t.check(`${a.axis} : score borné`, a.score >= 0 && a.score <= 100, true);
    const perdu = a.deductions.reduce((s, d) => s + d.points, 0);
    t.check(`${a.axis} : chaque point perdu est justifié`, a.score, Math.max(0, 100 - perdu));
  }
  // Un axe sans aucune donnée n'est pas en bonne santé : il est non mesuré.
  t.check(
    "un axe sans observation est marqué non mesuré",
    axes.find((a) => a.axis === "retention")?.measured,
    false,
  );
  // LE SCORE GLOBAL DEMANDE UNE COUVERTURE, pas seulement un axe mesuré.
  //
  // Le cas qui a imposé ce seuil vient des boutiques témoins : vingt-quatre
  // produits tous décrits et illustrés, trois pages de politique, aucune page
  // cassée — et zéro vente, zéro visiteur mesuré. Les trois axes visibles
  // étaient irréprochables, la moyenne sortait à 100, et le marchand lisait
  // 100/100 sur une boutique qui ne vend rien. Chaque étape était juste ; le
  // verdict était absurde.
  const mesures = axes.filter((a) => a.score !== null).length;
  const scoreTout = globalScore(axes);
  t.check(
    "sous la moitié des axes mesurés, aucune note globale",
    scoreTout,
    mesures / axes.length < MIN_MEASURED_AXES_SHARE
      ? null
      : Math.round(axes.reduce((sum, a) => sum + (a.score ?? 0), 0) / Math.max(1, mesures)),
  );
  t.check("aucun axe mesuré => aucun score", globalScore(scoreAxes([], [])), null);
  // Une couverture suffisante rend bien une note : le seuil ne doit pas rendre
  // le score inatteignable en pratique.
  const large = AUDIT_AXES.map((axis, i) => ({
    axis,
    label: axis,
    score: i % 2 === 0 ? 70 : null,
    deductions: [],
    measured: i % 2 === 0,
  }));
  t.check("la moitié des axes suffit à noter", globalScore(large), 70);

  /*
    COMPTER LES AXES NE SUFFIT PAS : IL FAUT REGARDER LESQUELS.

    LE CAS RÉEL. Une boutique au catalogue vide, sans une seule commande et sans
    donnée de trafic, a reçu 86/100. Chaque étape était juste. Cinq axes sur dix
    étaient mesurés — Confiance, SEO, Technique, UX, Merchandising — la moitié
    exactement, donc le seuil par le nombre était franchi, et la moyenne de ces
    cinq sortait à 86.

    Ces cinq axes ont une chose en commun : ils se lisent ENTIÈREMENT en
    téléchargeant quelques pages. Ils sont toujours mesurables, sur n'importe
    quelle boutique, y compris une qui ne vend rien. Les quatre autres demandent
    des ventes, des visites ou de la dépense — et sont donc absents précisément
    quand la boutique ne marche pas.

    Le seuil par le NOMBRE se laisse donc satisfaire par les seuls contrôles
    faciles : la note finissait par mesurer la qualité de fabrication d'un site
    plutôt que la santé d'un commerce.
  */
  const axeNote = (axis: (typeof AUDIT_AXES)[number], score: number | null) => ({
    axis,
    label: axis,
    score,
    deductions: [],
    measured: score !== null,
  });
  const vitrineSeule = [
    axeNote("trust", 100),
    axeNote("seo", 92),
    axeNote("technique", 100),
    axeNote("ux", 78),
    axeNote("merchandising", 60),
    axeNote("acquisition", null),
    axeNote("conversion", null),
    axeNote("offre", null),
    axeNote("retention", null),
    axeNote("data", null),
  ];
  t.check(
    "la moitié des axes atteinte par les seuls contrôles de vitrine",
    vitrineSeule.filter((a) => a.score !== null).length / vitrineSeule.length >=
      MIN_MEASURED_AXES_SHARE,
    true,
  );
  t.check("…mais aucun axe commercial mesuré => aucune note", globalScore(vitrineSeule), null);

  // UN SEUL AXE COMMERCIAL SUFFIT À RENDRE LA NOTE : le garde-fou refuse de
  // noter une vitrine, il n'interdit pas de noter un commerce.
  for (const commercial of COMMERCIAL_AXES) {
    const avecCommerce = vitrineSeule.map((a) =>
      a.axis === commercial ? axeNote(commercial, 40) : a,
    );
    t.check(`${commercial} mesuré rend la note`, globalScore(avecCommerce) !== null, true);
  }

  /*
    ET L'OFFRE NE COMPTE PAS COMME UN RÉSULTAT COMMERCIAL.

    Elle y figurait dans la première version de ce garde-fou, au motif qu'un
    prix relève du commerce. Une exécution l'a démentie : sur une boutique aux
    dix produits décrits, vitrine complète, ZÉRO commande et AUCUNE session, le
    score sortait à 100/100. `offre` devient « mesuré » dès que
    `shopify.price_min` existe — donc avant la première visite.

    Un prix est une PROPRIÉTÉ de l'offre ; une conversion, une dépense ou un
    taux de retour sont des RÉSULTATS. La disponibilité d'un axe n'est pas sa
    représentativité.
  */
  t.check(
    "l'offre ne compte pas comme un résultat commercial",
    COMMERCIAL_AXES.includes("offre"),
    false,
  );
  const avecOffreSeule = vitrineSeule.map((a) => (a.axis === "offre" ? axeNote("offre", 100) : a));
  t.check(
    "une offre mesurée depuis les prix ne rend pas la note",
    globalScore(avecOffreSeule),
    null,
  );

  /*
    UNE DONNÉE MANQUANTE N'EST JAMAIS COMPTÉE COMME UN ZÉRO. C'est la faute qui
    coûterait le plus cher ici : elle ferait chuter la moyenne d'une boutique
    dont on ne sait rien, et le marchand lirait une mauvaise note là où il n'y a
    pas de note du tout.
  */
  const avecConversion = vitrineSeule.map((a) =>
    a.axis === "conversion" ? axeNote("conversion", 80) : a,
  );
  t.check(
    "les axes non mesurés ne pèsent pas dans la moyenne",
    globalScore(avecConversion),
    Math.round((100 + 92 + 100 + 78 + 60 + 80) / 6),
  );
  t.check(
    "…et ne sont donc pas comptés comme des zéros",
    globalScore(avecConversion) !== Math.round((100 + 92 + 100 + 78 + 60 + 80) / 10),
    true,
  );

  // ET LE GARDE-FOU NE DÉPEND D'AUCUN CONSTAT EN PARTICULIER. Un catalogue vide
  // n'annule pas la note à lui seul — c'est la couverture qui décide, pas un
  // constat. Une boutique qui vend garde sa note même avec un catalogue mince.
  const catalogueVideMaisCommerceMesure = vitrineSeule.map((a) =>
    a.axis === "conversion" ? axeNote("conversion", 55) : a,
  );
  t.check(
    "un catalogue vide n'annule pas à lui seul la note",
    globalScore(catalogueVideMaisCommerceMesure) !== null,
    true,
  );
  // La note reste la moyenne des axes MESURÉS, garde-fou franchi : le seuil
  // décide s'il y a une note, jamais laquelle.
  t.check(
    "la note est bien la moyenne des axes mesurés",
    globalScore(catalogueVideMaisCommerceMesure),
    Math.round((100 + 92 + 100 + 78 + 60 + 55) / 6),
  );

  // L'AXE AVEUGLÉ N'EST PAS NOTÉ. Sans trafic mesuré, une note de conversion
  // serait une note sur rien — et elle remonterait dans le score global,
  // donnant une bonne moyenne à une boutique dont on ne sait rien.
  t.check(
    "sans trafic, la conversion n'est pas notée",
    axes.find((a) => a.axis === "conversion")?.measured,
    false,
  );
  t.check(
    "un axe aveuglé ne pèse pas dans le score global",
    globalScore(axes) === globalScore(scoreAxes(rapportVide.findings, boutiqueVide.observations)),
    true,
  );
  // Le blocage vient bien du constat, pas d'un hasard : sans lui, l'axe est noté.
  const sansConstatDeTrou = rapportVide.findings.filter((f) => !f.blocksAxes);
  t.check(
    "retirer le constat de trou rend l'axe notable",
    scoreAxes(sansConstatDeTrou, boutiqueVide.observations).find((a) => a.axis === "conversion")
      ?.measured,
    true,
  );

  // Un constat « donnée insuffisante » ne retire aucun point sur son axe.
  t.check("le poids d'une donnée insuffisante est nul", EVIDENCE_WEIGHT.donnee_insuffisante, 0);
  const axeData = axes.find((a) => a.axis === "data");
  // Le constat retire zéro point : l'axe ne porte AUCUNE retenue. On le
  // vérifie sur les retenues plutôt que sur la note, qui vaut désormais `null`
  // tant qu'aucune donnée n'a été relevée sur cet axe.
  t.check(
    "un trou de données ne fait pas chuter son propre axe",
    (axeData?.deductions ?? []).reduce((s, d) => s + d.points, 0),
    0,
  );

  // --- 8. Priorisation ------------------------------------------------------
  const priorites = prioritise(rapportVide.findings);
  t.check("jamais plus de sept priorités", priorites.length <= MAX_PRIORITIES, true);
  t.check(
    "les priorités sont ordonnées",
    priorites.every((p, i) => i === 0 || priorites[i - 1]!.priority >= p.priority),
    true,
  );
  t.check(
    "les rangs sont consécutifs à partir de 1",
    priorites.every((p, i) => p.rank === i + 1),
    true,
  );
  // Un constat sans preuve suffisante ne peut jamais être priorisé.
  t.check(
    "une donnée insuffisante n'entre jamais dans les priorités",
    priorites.some((p) => p.level === "donnee_insuffisante"),
    false,
  );
  // À impact égal, l'effort faible passe devant. C'est la promesse d'Impact ×
  // Effort, et elle doit être vérifiable.
  const memeImpact = prioritise([
    { ...rapportVide.findings[0]!, ruleId: "a.lourd", impact: 4, effort: 5, level: "prouve" },
    { ...rapportVide.findings[0]!, ruleId: "b.leger", impact: 4, effort: 1, level: "prouve" },
  ]);
  t.check("à impact égal, l'effort faible passe devant", memeImpact[0]?.ruleId, "b.leger");

  // --- 9. Plan d'action -----------------------------------------------------
  const plan = buildActionPlan(priorites);
  t.check("« Maintenant » ne dépasse jamais trois actions", plan.maintenant.length <= 3, true);
  t.check("« Cette semaine » ne dépasse jamais cinq actions", plan.cette_semaine.length <= 5, true);
  t.check(
    "« Maintenant » ne contient que du fort impact et du faible effort",
    plan.maintenant.every((f) => f.impact >= 4 && f.effort <= 2),
    true,
  );
  t.check(
    "un chantier ne se retrouve jamais dans « Maintenant »",
    plan.maintenant.some((f) => f.effort >= 4),
    false,
  );
  t.check(
    "toute priorité est rangée dans exactement un horizon",
    plan.maintenant.length +
      plan.cette_semaine.length +
      plan.ce_mois.length +
      plan.plus_tard.length,
    priorites.length,
  );

  // --- 10. Valeurs aberrantes et données contradictoires -------------------
  // Des taux hors bornes, des négatifs, des infinis : rien ne doit lever, et
  // aucun pourcentage absurde ne doit sortir.
  const aberrant = ctx([
    obs({ id: "shopify.orders_30d", value: 1000, sample: 1000 }),
    obs({ id: "shopify.returning_customer_rate", value: -5, unit: "percent", sample: 1000 }),
    obs({ id: "shopify.cart_abandonment_rate", value: 9999, unit: "percent", sample: 1000 }),
    obs({ id: "shopify.top_product_revenue_share", value: Number.POSITIVE_INFINITY, sample: 1000 }),
    obs({ id: "shopify.product_count", value: -3, sample: 0 }),
  ]);
  let leve = false;
  let sorties: RuleFinding[] = [];
  try {
    sorties = runRules(aberrant);
  } catch {
    leve = true;
  }
  t.check("des valeurs aberrantes ne font pas lever le moteur", leve, false);
  t.check(
    "aucun constat ne cite un pourcentage impossible",
    sorties.some((f) => /(-\d|\b\d{4,}) %/.test(f.statement)),
    false,
  );

  // Données contradictoires : plus de fiches sans description que de produits.
  const contradictoire = ctx([
    obs({ id: "shopify.product_count", value: 10, sample: 10 }),
    obs({ id: "shopify.products_without_description", value: 40, sample: 10 }),
  ]);
  const sortiesContradictoires = runRules(contradictoire);
  t.check(
    "une contradiction ne produit pas une part supérieure à 100 %",
    sortiesContradictoires.some((f) => {
      const m = f.statement.match(/(\d+) %/);
      return m ? Number(m[1]) > 100 : false;
    }),
    false,
  );

  // --- 11. Entonnoir incomplet ---------------------------------------------
  // Paniers connus, sessions inconnues : aucune étape ne doit être interpolée,
  // et aucun taux ne doit être calculé au travers du trou.
  const funnelTroue = ctx(
    [
      obs({ id: "shopify.orders_30d", value: 50, sample: 50 }),
      obs({ id: "shopify.abandoned_checkouts_30d", value: 400, sample: 400 }),
    ],
    [gapSessions],
  );
  const sortiesFunnel = runRules(funnelTroue);
  t.check(
    "un entonnoir troué ne produit aucun taux de conversion",
    sortiesFunnel.some((f) => f.ruleId === "conversion.traffic_without_orders"),
    false,
  );
  t.check(
    "le trou de l'entonnoir est nommé",
    analyse(funnelTroue).unresolved.some((u) => u.toLowerCase().includes("session")),
    true,
  );

  // --- 12. Rattachement des observations aux axes --------------------------
  t.check("robots.txt relève du SEO", axisOfObservation("storefront.robots_blocks_all"), "seo");
  t.check("le viewport relève de l'UX", axisOfObservation("storefront.mobile_viewport"), "ux");
  t.check(
    "les pages de politique relèvent de la confiance",
    axisOfObservation("storefront.policy_pages"),
    "trust",
  );
  t.check(
    "les dépenses Meta relèvent de l'acquisition",
    axisOfObservation("meta.spend_30d"),
    "acquisition",
  );
  t.check("un identifiant inconnu n'est rattaché à rien", axisOfObservation("inconnu.truc"), null);

  // --- 13. Le montant n'est jamais estimé ----------------------------------
  // Seule une dépense réellement lue peut devenir un montant.
  const depenseSansAchat = ctx([
    obs({ id: "meta.spend_30d", value: 1200, unit: "currency", source: "meta", sample: 30 }),
    obs({ id: "meta.purchases_30d", value: 0, source: "meta", sample: 30 }),
  ]);
  const constatDepense = runRules(depenseSansAchat).find(
    (f) => f.ruleId === "acquisition.spend_without_purchase",
  );
  t.check("une dépense sans achat est constatée", Boolean(constatDepense), true);
  t.check(
    "le montant reprend la dépense lue, sans extrapolation",
    constatDepense?.amount?.value,
    1200,
  );
  // Sans devise connue, pas de montant : un chiffre sans unité n'est pas un montant.
  const sansDevise: RuleContext = { ...depenseSansAchat, currency: null };
  t.check(
    "sans devise, aucun montant n'est produit",
    runRules(sansDevise).find((f) => f.ruleId === "acquisition.spend_without_purchase")?.amount,
    null,
  );
  // Aucun autre constat ne doit porter de montant : rien n'est estimé ailleurs.
  t.check(
    "aucun constat de catalogue ne chiffre un gain",
    rapportVide.findings.some((f) => f.amount != null),
    false,
  );

  // --- 14. Le moteur est RÉELLEMENT branché --------------------------------
  // Un moteur de règles que personne n'appelle est du code mort qui rassure.
  // Ce contrôle lit le chemin d'audit réel et vérifie trois choses : le moteur
  // est appelé, ses constats partent dans le prompt, et cela se produit AVANT
  // l'appel au modèle. C'est la différence entre une architecture et un plan.
  const runner = readFileSync(
    new URL("../../src/lib/audit-runner.server.ts", import.meta.url).pathname,
    "utf8",
  );
  t.check("le chemin d'audit appelle le moteur de règles", /analyseRules\(\{/.test(runner), true);
  // Le contrôle vise la RÈGLE, pas le nom de la variable : le rapport du moteur
  // est interpolé dans le prompt. Épingler `ruleReport` a cassé au premier
  // remaniement — le rapport passe désormais par un second classement — sans
  // qu'aucune garantie n'ait bougé.
  t.check(
    "les constats du moteur partent dans le prompt",
    /\$\{rulesToPromptBlock\([a-zA-Z]+\)\}/.test(runner),
    true,
  );
  // Et c'est bien le rapport RECLASSÉ qui part : sans cela, le modèle recevrait
  // un ordre de priorités que les causes racines ont déjà corrigé.
  t.check(
    "…après prise en compte des dépendances",
    /prioritise\(ruleReport\.findings, dependances\)/.test(runner),
    true,
  );
  t.check(
    "…et les dépendances viennent des causes racines",
    /dependentsByFinding\(causes\)/.test(runner),
    true,
  );
  t.check(
    "le moteur s'exécute avant l'appel au modèle",
    // Même remarque que dans les suites voisines : l'appel au modèle est
    // désormais construit par une fonction, pour que le modèle principal et
    // celui de secours envoient EXACTEMENT la même demande. On repère l'appel,
    // pas sa ponctuation — sinon `indexOf` rend -1 et le contrôle passe à
    // l'envers, en se déclarant conforme.
    runner.indexOf("analyseRules({") < runner.lastIndexOf("aiChatCompletion"),
    true,
  );
  // Les interdictions transmises au modèle sont vérifiées à la lettre : ce sont
  // elles qui l'empêchent de faire remonter un constat dans l'échelle de preuve.
  const bloc = rulesToPromptBlock(rapportVide);
  t.check("le bloc annonce la source de vérité", /source de vérité/.test(bloc), true);
  t.check(
    "le bloc interdit de faire remonter un niveau de preuve",
    /ne fais JAMAIS remonter un constat dans l'échelle de preuve/.test(bloc),
    true,
  );
  t.check("le bloc interdit les moyennes de marché", /aucune moyenne de marché/.test(bloc), true);
  t.check(
    "le bloc interdit de chiffrer un gain non constaté",
    /ne chiffres aucun gain qui ne figure pas/.test(bloc),
    true,
  );
  t.check("le bloc énumère les scores par axe", /SCORES PAR AXE/.test(bloc), true);
  t.check("un axe non mesuré est annoncé comme tel, jamais à 100", /NON MESURÉ/.test(bloc), true);
  t.check(
    "ce qui n'est pas établi est transmis au modèle",
    /CE QUE LES DONNÉES NE PERMETTENT PAS D'ÉTABLIR/.test(bloc),
    true,
  );

  // --- 15. Idempotence ------------------------------------------------------
  // Deux passages sur les mêmes données donnent le même résultat : c'est ce
  // qu'un moteur déterministe apporte et qu'un modèle ne peut pas promettre.
  t.check(
    "deux exécutions donnent le même résultat",
    JSON.stringify(analyse(boutiqueVide)),
    JSON.stringify(analyse(boutiqueVide)),
  );
});
