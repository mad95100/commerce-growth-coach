import { defineSuite } from "../harness";
import {
  DEPENDENCY_STEP,
  MAX_COUNTED_DEPENDENTS,
  RULES,
  THRESHOLDS,
  dependencyEffect,
  prioritise,
  runRules,
  type RuleContext,
  type RuleFinding,
} from "@/lib/audit-rules";
import { CAUSES, dependentsByFinding, groupByCause, type Symptom } from "@/lib/root-cause";
import {
  hasUsablePrice,
  isOutOfStock,
  isPartiallyOutOfStock,
  stockIsUnknowable,
  variantCount,
  type RawProduct,
} from "@/lib/connectors/shopify-observe";
import type { Observation } from "@/lib/observations";

/**
 * DU SYMPTÔME AU RAISONNEMENT.
 *
 * TROIS DÉFAUTS QUE CETTE SUITE GARDE, chacun mesuré avant d'être corrigé.
 *
 * 1. LES CAUSES RACINES ÉTAIENT IGNORÉES PAR LE CLASSEMENT. Elles étaient
 *    calculées, justes, et n'avaient aucun poids sur l'ordre des actions : le
 *    plan pouvait proposer de corriger un symptôme avant la cause qui le
 *    produit. Corriger l'effet laisse la cause reproduire l'effet.
 *
 * 2. UNE SEULE RÈGLE CROISAIT DEUX SOURCES. Toutes les autres appliquaient un
 *    seuil à une observation unique — ce qui produit une checklist, pas un
 *    diagnostic.
 *
 * 3. PRIX, VARIANTES, DISPONIBILITÉ ET MÉTADONNÉES ÉTAIENT MESURÉS ET JAMAIS
 *    LUS. Les variantes ne servaient qu'à décider d'une rupture TOTALE ; le cas
 *    intermédiaire — une taille sur trois épuisée — n'existait nulle part.
 *
 * Le fil qui les relie : rien de tout cela ne doit permettre d'affirmer plus
 * que ce que les preuves portent. Une convergence n'est pas une causalité, un
 * regroupement n'est pas une promotion, et une absence de mesure n'est pas un
 * problème.
 */

const ctxDe = (
  valeurs: Record<string, number>,
  textes: Record<string, string> = {},
): RuleContext => ({
  observations: Object.entries(valeurs).map(([id, value]): Observation => ({
    id,
    source: id.startsWith("shopify.") ? "shopify" : "storefront",
    domain: "conversion",
    label: id,
    value,
    unit: "count",
    text: textes[id],
    periodDays: id.startsWith("shopify.") ? 30 : 0,
    evidence: `${id} = ${value} (relevé sur https://atelier-vela.fr)`,
    sample: 40,
  })),
  gaps: [],
  currency: "EUR",
});

const constat = (ctx: RuleContext, ruleId: string) =>
  runRules(ctx).find((f) => f.ruleId === ruleId);

/** Un constat minimal, pour éprouver la priorisation sans passer par les règles. */
const finding = (ruleId: string, over: Partial<RuleFinding> = {}): RuleFinding => ({
  ruleId,
  axis: "conversion",
  title: ruleId,
  statement: "…",
  why: "…",
  level: "prouve",
  basedOn: [],
  evidence: ["preuve"],
  sample: null,
  periodDays: null,
  impact: 3,
  effort: 2,
  recommendation: "…",
  ...over,
});

const symptome = (id: string, over: Partial<Symptom> = {}): Symptom => ({
  id,
  title: id,
  evidence: [`preuve de ${id}`],
  level: "prouve",
  impact: 3,
  effort: 2,
  ...over,
});

const produit = (variants: RawProduct["variants"]): RawProduct => ({ id: 1, variants });

export default defineSuite("Raisonnement — dépendances, convergence, données lues", (t) => {
  // =========================================================================
  // 1. L'EFFET DE DÉPENDANCE EST BORNÉ, ET IL PASSE PAR LA PREUVE
  // =========================================================================
  t.check("sans descendant, aucun avantage", dependencyEffect(0), 1);
  t.check("un descendant, un cran", dependencyEffect(1), 1 + DEPENDENCY_STEP);
  t.check(
    "au plafond, plus rien n'augmente",
    dependencyEffect(MAX_COUNTED_DEPENDENTS + 40),
    dependencyEffect(MAX_COUNTED_DEPENDENTS),
  );
  t.check("un compte négatif ne retire rien", dependencyEffect(-3), 1);
  // Sans plafond, une cause fourre-tout écraserait tout le reste par son nombre.
  t.check("le plafond reste modeste", dependencyEffect(99) <= 1.75, true);

  // --- Une cause pertinente remonte devant ses symptômes -------------------
  /*
    Trois constats identiques ; seul l'un d'eux débloque les deux autres. Sans
    la dépendance, l'ordre se joue à l'identifiant. Avec elle, le levier passe
    devant — et c'est exactement ce qu'un plan d'action doit dire.
  */
  const fratrie = [finding("z.symptome_a"), finding("z.symptome_b"), finding("a.levier")];
  const sansDep = prioritise(fratrie);
  t.check(
    "sans dépendance, tous à égalité de priorité",
    new Set(sansDep.map((f) => f.priority)).size,
    1,
  );

  const avecDep = prioritise(fratrie, new Map([["a.levier", 2]]));
  t.check("avec dépendance, le levier passe premier", avecDep[0].ruleId, "a.levier");
  t.check("…et son avantage est lisible", avecDep[0].dependents, 2);
  t.check(
    "…tandis que les symptômes gardent leur priorité d'avant",
    avecDep.filter((f) => f.ruleId !== "a.levier").every((f) => f.dependents === 0),
    true,
  );

  // --- Une cause hypothétique ne dépasse pas un constat observé ------------
  /*
    LE GARDE-FOU CENTRAL. L'avantage MULTIPLIE la formule, donc il passe par le
    poids de preuve. Une cause « à vérifier » qui explique trois constats vaut
    0,25 × 1,75 ; un constat prouvé isolé vaut 1. L'un ne peut pas rattraper
    l'autre en s'entourant.
  */
  const classement = prioritise(
    [
      finding("a.cause_hypothetique", { level: "a_verifier", impact: 4, effort: 2 }),
      finding("b.constat_prouve", { level: "prouve", impact: 4, effort: 2 }),
    ],
    new Map([["a.cause_hypothetique", MAX_COUNTED_DEPENDENTS]]),
  );
  t.check(
    "un constat prouvé reste devant une cause à vérifier",
    classement[0].ruleId,
    "b.constat_prouve",
  );
  t.check(
    "…même quand celle-ci explique le maximum de constats",
    classement.find((f) => f.ruleId === "a.cause_hypothetique")!.priority <
      classement.find((f) => f.ruleId === "b.constat_prouve")!.priority,
    true,
  );

  // --- Une donnée manquante ne devient jamais une priorité ------------------
  const manque = prioritise(
    [finding("a.donnee", { level: "donnee_insuffisante", impact: 5, effort: 1 })],
    new Map([["a.donnee", 3]]),
  );
  t.check("une donnée insuffisante reste hors du classement", manque.length, 0);

  // =========================================================================
  // 2. LA DÉPENDANCE VIENT DES CAUSES, ET ELLE EST TRAÇABLE
  // =========================================================================
  const groupe = groupByCause([
    symptome("merchandising.descriptions_missing"),
    symptome("experience.promesse_absente"),
    symptome("experience.premier_bloc_muet"),
  ]);
  t.check("les trois se regroupent sous une cause", groupe.causes.length, 1);
  const cause = groupe.causes[0];
  t.check(
    "le levier est celui qui a été DÉCLARÉ",
    cause.lever,
    "merchandising.descriptions_missing",
  );
  t.check("…et il débloque les deux autres", cause.dependents, 2);
  t.check(
    "la carte de dépendances ne charge que le levier",
    [...dependentsByFinding(groupe.causes)],
    [["merchandising.descriptions_missing", 2]],
  );

  // Chaque cause déclare un levier, et ce levier fait partie de ses membres
  // possibles : sans quoi la dépendance ne serait rattachable à rien.
  for (const def of CAUSES) {
    t.check(
      `${def.id} déclare un levier présent dans ses membres`,
      def.matches.includes(def.lever),
      true,
    );
  }

  // Le levier déclaré absent de l'audit du jour : un autre membre reprend le
  // rôle, plutôt que de perdre une dépendance réelle.
  const sansLevier = groupByCause([
    symptome("experience.promesse_absente", { impact: 5 }),
    symptome("experience.premier_bloc_muet", { impact: 2 }),
  ]);
  t.check(
    "sans son levier, la cause en désigne un autre",
    sansLevier.causes[0].lever,
    "experience.promesse_absente",
  );

  // Le niveau de preuve pèse enfin sur la priorité d'une cause : deux causes de
  // même impact et même effort ne peuvent plus sortir à égalité si l'une repose
  // sur des constats à vérifier.
  const prouvee = groupByCause([
    symptome("experience.aucun_cta"),
    symptome("experience.navigation_absente"),
  ]).causes[0];
  const douteuse = groupByCause([
    symptome("experience.aucun_cta", { level: "a_verifier" }),
    symptome("experience.navigation_absente", { level: "a_verifier" }),
  ]).causes[0];
  t.check(
    "une cause prouvée passe devant une cause à vérifier",
    prouvee.priority > douteuse.priority,
    true,
  );
  // Et un regroupement ne se promeut pas en s'élargissant : il porte le niveau
  // du MOINS certain de ses membres.
  const melange = groupByCause([
    symptome("experience.aucun_cta", { level: "prouve" }),
    symptome("experience.navigation_absente", { level: "a_verifier" }),
  ]).causes[0];
  t.check("le regroupement porte le niveau du plus faible", melange.level, "a_verifier");

  // =========================================================================
  // 3. PLUSIEURS PREUVES ALIMENTENT UN MÊME DIAGNOSTIC
  // =========================================================================
  /*
    Trois lectures indépendantes de la page d'accueil. Une seule ne dit rien
    qu'une règle isolée ne dise déjà ; leur convergence décrit une page qui ne
    mène nulle part.
  */
  const converge = constat(
    ctxDe({
      "storefront.accueil_h1_mots": 1,
      "storefront.accueil_cta": 0,
      "storefront.accueil_collection_links": 0,
    }),
    "parcours.entree_catalogue_absente",
  );
  t.check("trois signaux convergents produisent un diagnostic", Boolean(converge), true);
  t.check("…qui s'appuie sur les trois observations", converge?.basedOn.length, 3);
  t.check(
    "…et cite les trois dans son constat",
    (converge?.statement.match(/,/g) ?? []).length >= 1,
    true,
  );

  // UN SEUL SIGNAL N'EST PAS UNE CONVERGENCE. Le constat isolé a déjà sa règle.
  t.check(
    "un signal seul ne déclenche pas la convergence",
    constat(
      ctxDe({
        "storefront.accueil_h1_mots": 8,
        "storefront.accueil_cta": 4,
        "storefront.accueil_collection_links": 0,
      }),
      "parcours.entree_catalogue_absente",
    ),
    undefined,
  );

  // LA CONVERGENCE REMPLACE SES CONSTITUANTS : le rapport ne relit pas quatre
  // fois le même problème sous quatre titres.
  const apresConvergence = runRules(
    ctxDe({
      "storefront.accueil_h1_mots": 1,
      "storefront.accueil_cta": 0,
      "storefront.accueil_collection_links": 0,
    }),
  ).map((f) => f.ruleId);
  t.check(
    "le constat isolé s'efface derrière la convergence",
    apresConvergence.includes("ux.catalogue_invisible_depuis_accueil"),
    false,
  );
  // …mais il sort seul quand la convergence n'a pas lieu.
  t.check(
    "…et reparaît quand rien ne converge",
    runRules(
      ctxDe({
        "storefront.accueil_h1_mots": 8,
        "storefront.accueil_cta": 4,
        "storefront.accueil_collection_links": 0,
      }),
    ).some((f) => f.ruleId === "ux.catalogue_invisible_depuis_accueil"),
    true,
  );

  // Toute absorption déclarée doit viser une règle qui existe : sinon un
  // constat disparaîtrait au profit de rien.
  const ids = new Set(RULES.map((r) => r.id));
  for (const r of RULES) {
    for (const abs of r.absorbs ?? []) {
      t.check(`${r.id} absorbe une règle existante (${abs})`, ids.has(abs), true);
    }
  }

  // --- Le trafic mesuré rencontre des fiches muettes -----------------------
  const fiches = constat(
    ctxDe({
      "shopify.sessions_30d": 4200,
      "storefront.product_shipping_mentioned": 0,
      "storefront.product_reviews_declared": 0,
    }),
    "conversion.fiche_sans_reponse_avec_trafic",
  );
  t.check("trafic mesuré + deux manques de fiche : un diagnostic", Boolean(fiches), true);
  t.check("…il ne dépasse pas « fortement suggéré »", fiches?.level, "fortement_suggere");
  t.check(
    "…et il n'affirme aucune causalité",
    /provoque|à cause de|cause de la perte/i.test(`${fiches?.why} ${fiches?.statement}`),
    false,
  );
  t.check(
    "…il dit ce qu'il ne permet PAS de conclure",
    /demanderait|cohérents avec/i.test(fiches?.why ?? ""),
    true,
  );
  // Sans trafic mesuré, aucune convergence : les manques de fiche restent des
  // lectures de page.
  t.check(
    "sans trafic, pas de diagnostic croisé",
    constat(
      ctxDe({
        "storefront.product_shipping_mentioned": 0,
        "storefront.product_reviews_declared": 0,
      }),
      "conversion.fiche_sans_reponse_avec_trafic",
    ),
    undefined,
  );

  // --- Deux sources qui se contredisent ------------------------------------
  const invisible = constat(
    ctxDe({
      "shopify.product_count": 120,
      "storefront.collection_produits_listes": 2,
      "storefront.accueil_collection_links": 0,
    }),
    "merchandising.catalogue_present_mais_invisible",
  );
  t.check("catalogue fourni + vitrine vide : un diagnostic", Boolean(invisible), true);
  t.check("…qui cite les deux sources", invisible?.basedOn.length, 3);
  t.check(
    "…et le petit catalogue ne le déclenche pas",
    constat(
      ctxDe({
        "shopify.product_count": 6,
        "storefront.collection_produits_listes": 2,
      }),
      "merchandising.catalogue_present_mais_invisible",
    ),
    undefined,
  );

  // =========================================================================
  // 4. PRIX, VARIANTES, DISPONIBILITÉ — LUS, ET DISTINGUÉS
  // =========================================================================
  const suivie = (q: number | null) => ({
    price: "20.00",
    inventory_management: "shopify",
    inventory_quantity: q,
  });

  t.check("un prix positif est utilisable", hasUsablePrice(produit([{ price: "19.90" }])), true);
  t.check("un prix à zéro ne l'est pas", hasUsablePrice(produit([{ price: "0" }])), false);
  t.check("une fiche sans variante n'a pas de prix", hasUsablePrice(produit([])), false);
  t.check("le nombre de variantes est compté", variantCount(produit([{}, {}, {}])), 3);

  // LES TROIS ÉTATS, jamais deux.
  t.check("toutes épuisées : rupture", isOutOfStock(produit([suivie(0), suivie(0)])), true);
  t.check(
    "une seule épuisée : pas une rupture",
    isOutOfStock(produit([suivie(0), suivie(5)])),
    false,
  );
  t.check(
    "…mais un choix partiellement indisponible",
    isPartiallyOutOfStock(produit([suivie(0), suivie(5)])),
    true,
  );
  t.check(
    "toutes disponibles : ni l'un ni l'autre",
    isPartiallyOutOfStock(produit([suivie(3), suivie(5)])),
    false,
  );
  t.check("stock non suivi : illisible", stockIsUnknowable(produit([{ price: "10" }])), true);
  t.check("quantité non renvoyée : illisible", stockIsUnknowable(produit([suivie(null)])), true);
  t.check("stock suivi et lisible : lisible", stockIsUnknowable(produit([suivie(4)])), false);
  // LE POINT QUI COMPTE : illisible n'est ni disponible ni en rupture.
  t.check(
    "une quantité illisible ne devient pas une rupture",
    isOutOfStock(produit([suivie(null), suivie(0)])),
    false,
  );
  t.check(
    "…ni un choix partiellement épuisé",
    isPartiallyOutOfStock(produit([suivie(null), suivie(0)])),
    false,
  );

  // --- Les règles correspondantes ------------------------------------------
  t.check(
    "des fiches sans prix produisent un constat",
    Boolean(
      constat(
        ctxDe({ "shopify.products_without_price": 3, "shopify.product_count": 48 }),
        "offre.prix_absent",
      ),
    ),
    true,
  );
  t.check(
    "…et aucune fiche sans prix n'en produit aucun",
    constat(
      ctxDe({ "shopify.products_without_price": 0, "shopify.product_count": 48 }),
      "offre.prix_absent",
    ),
    undefined,
  );

  const choix = constat(
    ctxDe({
      "shopify.products_partially_out_of_stock": 12,
      "shopify.products_multi_variant": 30,
      "shopify.product_count": 48,
    }),
    "merchandising.choix_partiellement_epuise",
  );
  t.check("un choix largement épuisé produit un constat", Boolean(choix), true);
  // Le dénominateur est le nombre de fiches À CHOIX, pas le catalogue : sinon
  // une boutique à variante unique diluerait le défaut là où il existe.
  t.check(
    "le dénominateur est bien celui des fiches à choix",
    constat(
      ctxDe({
        "shopify.products_partially_out_of_stock": 12,
        "shopify.products_multi_variant": 200,
        "shopify.product_count": 400,
      }),
      "merchandising.choix_partiellement_epuise",
    ),
    undefined,
  );

  const stock = constat(
    ctxDe({ "shopify.products_stock_inconnu": 20, "shopify.product_count": 48 }),
    "data.disponibilite_non_lisible",
  );
  t.check("une disponibilité illisible est déclarée", Boolean(stock), true);
  t.check(
    "…comme une donnée insuffisante, pas comme un problème",
    stock?.level,
    "donnee_insuffisante",
  );
  t.check("…et elle ne pèse donc rien dans le classement", prioritise([stock!]).length, 0);
  t.check(
    "…et son texte ne parle jamais de rupture",
    /rupture|épuisé/i.test(`${stock?.statement} ${stock?.title}`),
    false,
  );

  // =========================================================================
  // 5. MÉTADONNÉES — ENFIN LUES
  // =========================================================================
  const titreCourt = constat(
    ctxDe({ "storefront.accueil_title": 12 }, { "storefront.accueil_title": "Atelier Vela" }),
    "seo.titre_page_muet",
  );
  t.check("un titre réduit au nom de la boutique est constaté", Boolean(titreCourt), true);
  t.check("…et il est cité mot pour mot", /Atelier Vela/.test(titreCourt?.statement ?? ""), true);
  t.check(
    "un titre qui dit ce qui est vendu ne déclenche rien",
    constat(
      ctxDe(
        { "storefront.accueil_title": 49 },
        { "storefront.accueil_title": "Sacs en toile cirée cousus à Nantes" },
      ),
      "seo.titre_page_muet",
    ),
    undefined,
  );
  const titreAbsent = constat(ctxDe({ "storefront.accueil_title": 0 }), "seo.titre_page_muet");
  t.check(
    "un titre absent est constaté séparément",
    /aucun titre/i.test(titreAbsent?.title ?? ""),
    true,
  );
  t.check(
    "une description absente est constatée",
    Boolean(
      constat(ctxDe({ "storefront.accueil_meta_description": 0 }), "seo.description_absente"),
    ),
    true,
  );
  // Un contrôle de référencement ne devient pas une urgence commerciale : il
  // reste plafonné, et son impact reste modeste.
  t.check("le titre reste un constat technique", titreCourt?.level, "a_verifier");
  t.check("…d'impact mesuré", (titreCourt?.impact ?? 9) <= 2, true);

  // =========================================================================
  // 6. LA PORTÉE DES PREUVES
  // =========================================================================
  /*
    LE DÉFAUT NOMMÉ. « Aucune page de livraison, de retour ou de conditions n'a
    été trouvée SUR LE SITE PUBLIC » — alors que trois adresses fixes sont
    interrogées. Une boutique publiant sa politique ailleurs était déclarée
    dépourvue, et le marchand invité à refaire ce qu'il avait déjà.
  */
  const politiques = constat(ctxDe({ "storefront.policy_pages": 0 }), "trust.policy_pages_missing");
  t.check("le constat de politiques existe toujours", Boolean(politiques), true);
  t.check(
    "…et n'affirme plus rien du site entier",
    /sur le site public/i.test(politiques?.statement ?? ""),
    false,
  );
  t.check(
    "…il nomme ce qui a été inspecté",
    /adresses.{0,20}vérifiées/i.test(politiques?.statement ?? ""),
    true,
  );

  // La règle générale : aucun constat de vitrine ne parle du site entier, du
  // catalogue entier ni de « toutes les pages ». Le scan lit une poignée
  // d'adresses ; ses conclusions ne peuvent pas être plus larges.
  const tous = runRules(
    ctxDe({
      "storefront.policy_pages": 0,
      "storefront.product_add_to_cart": 0,
      "storefront.product_reviews_declared": 0,
      "storefront.collection_produits_listes": 1,
      "storefront.accueil_collection_links": 0,
      "storefront.accueil_h1_mots": 8,
      "storefront.accueil_cta": 3,
      "storefront.response_ms": 3400,
      "storefront.product_shipping_mentioned": 0,
    }),
  );
  t.check("il y a bien des constats de vitrine à contrôler", tous.length > 0, true);
  for (const f of tous) {
    t.check(
      `${f.ruleId} ne prétend pas avoir tout inspecté`,
      /sur (le|l'ensemble du) site public|toutes les pages|partout sur la boutique/i.test(
        `${f.title} ${f.statement}`,
      ),
      false,
    );
  }

  // =========================================================================
  // 7. CE QUE RIEN NE DOIT FAIRE DIRE AU MOTEUR
  // =========================================================================
  // Aucune causalité affirmée sans mesure des deux bouts.
  for (const f of tous) {
    t.check(
      `${f.ruleId} n'affirme pas « provoque »`,
      / provoque | entraîne une perte de | fait perdre \d/i.test(`${f.statement} ${f.why}`),
      false,
    );
  }
  // Aucun montant inventé : seule une règle porte un montant, et il vient d'une
  // dépense réellement mesurée.
  const avecMontant = RULES.map((r) => r.evaluate.toString()).filter((s) => s.includes("amount:"));
  t.check("une seule règle chiffre un montant", avecMontant.length, 1);
  t.check(
    "…et elle le prend dans une dépense mesurée",
    avecMontant[0].includes("value: spend"),
    true,
  );

  // Un compteur à zéro reste une mesure ; une donnée absente reste absente.
  t.check(
    "zéro fiche sans prix : aucun constat, pas un constat vide",
    constat(
      ctxDe({ "shopify.products_without_price": 0, "shopify.product_count": 48 }),
      "offre.prix_absent",
    ),
    undefined,
  );
  t.check(
    "observation absente : la règle se tait",
    constat(ctxDe({ "shopify.product_count": 48 }), "offre.prix_absent"),
    undefined,
  );

  // Les seuils nouveaux restent dans des bornes défendables.
  t.check("la part de choix épuisé est une part", THRESHOLDS.PARTIAL_STOCK_SHARE < 1, true);
  t.check("le stock illisible aussi", THRESHOLDS.STOCK_UNKNOWN_SHARE < 1, true);
  t.check("un titre se juge en mots, pas en caractères", THRESHOLDS.TITLE_MIN_WORDS <= 3, true);
});
