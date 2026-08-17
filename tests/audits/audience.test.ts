import { readFileSync } from "node:fs";
import { defineSuite } from "../harness";
import {
  MAX_CONFIDENCE_WITHOUT_SALES,
  MIN_CONFIDENCE_TO_PUBLISH,
  MIN_ORDERS_FOR_BEHAVIOUR,
  TIER_LABELS,
  audienceInputFrom,
  audienceToPromptBlock,
  deduceAudience,
  findIncoherences,
  tierOf,
  type AudienceInput,
} from "@/lib/audience";
import type { Observation } from "@/lib/observations";

/**
 * LE CLIENT CIBLE DÉDUIT, ET CE QU'IL NE FAUT JAMAIS EN FAIRE.
 *
 * POURQUOI CETTE SUITE EXISTE. Un portrait de client est le genre de sortie qui
 * paraît excellente et se vérifie mal : elle est faite de phrases, donc tout y
 * semble plausible. C'est précisément pour cela qu'elle est dangereuse — rien
 * n'est plus facile que de faire dire à un moteur qu'il s'adresse à « une femme
 * urbaine de 25 à 40 ans sensible à l'écologie » à partir de trois prix.
 *
 * Ce qui se vérifie ici est donc surtout ce que le module REFUSE : produire un
 * portrait sans signal, accorder une confiance élevée à une simple lecture de
 * vitrine, ou inventer un trait démographique que rien n'a observé.
 */

function obs(id: string, value: number | null): Observation {
  return {
    id,
    source: "shopify",
    domain: "offre",
    label: id,
    value,
    unit: "count",
    periodDays: 30,
    evidence: `preuve ${id}`,
    sample: null,
  } as Observation;
}

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

export default defineSuite("Audit — client cible déduit et cohérence", (t) => {
  // --- 1. Aucun signal, aucun portrait -------------------------------------
  // Le test le plus important : il n'existe pas de « client par défaut ».
  t.check("sans aucune donnée, aucun portrait n'est produit", deduceAudience(VIDE), null);
  t.check(
    "un catalogue sans prix ni texte ne suffit pas",
    deduceAudience({ ...VIDE, productCount: 40 }),
    null,
  );

  // --- 2. La gamme se lit sur le prix médian -------------------------------
  t.check("un prix bas place en entrée de gamme", tierOf(12), "entree");
  t.check("un prix moyen place en milieu de gamme", tierOf(80), "milieu");
  t.check("un prix élevé place en premium", tierOf(400), "premium");
  t.check("un prix très élevé place en luxe", tierOf(2500), "luxe");
  t.check("un prix absent ne place nulle part", tierOf(null), null);
  t.check("un prix nul ne place nulle part", tierOf(0), null);
  t.check("un prix négatif ne place nulle part", tierOf(-40), null);
  t.check("un prix infini ne place nulle part", tierOf(Number.POSITIVE_INFINITY), null);

  // --- 3. Vitrine seule : la confiance est plafonnée -----------------------
  // Une boutique peut afficher ce qu'elle veut ; tant que rien n'est vendu, ce
  // n'est qu'une intention.
  const vitrine = deduceAudience({
    ...VIDE,
    medianPrice: 700,
    priceMin: 600,
    priceMax: 900,
    currency: "EUR",
    productCount: 17,
    texts: ["Snowboard premium artisanal", "Fabrication haut de gamme, savoir-faire"],
    descriptionsMissingShare: 0.88,
  });
  t.check("une vitrine seule produit un portrait", Boolean(vitrine), true);
  t.check("la gamme est lue", vitrine?.tier, "premium");
  t.check(
    "sans vente, la confiance est plafonnée",
    (vitrine?.confidence ?? 100) <= MAX_CONFIDENCE_WITHOUT_SALES,
    true,
  );
  t.check(
    "aucun signal de vitrine n'est marqué comme prouvé",
    vitrine?.signals.every((s) => !s.proven),
    true,
  );
  t.check(
    "l'absence de signal d'achat est déclarée",
    vitrine?.missing.some((m) => /panier moyen|comportement d'achat/i.test(m)),
    true,
  );
  t.check("ce qui trancherait est nommé", (vitrine?.wouldSettle.length ?? 0) > 0, true);

  // --- 4. Avec des ventes, la confiance monte — et reste bornée ------------
  const avecVentes = deduceAudience({
    ...VIDE,
    medianPrice: 700,
    currency: "EUR",
    productCount: 17,
    texts: ["Snowboard premium artisanal"],
    aov: 690,
    orders: 120,
    returningShare: 0.35,
  });
  t.check(
    "des achats réels font monter la confiance",
    (avecVentes?.confidence ?? 0) > (vitrine?.confidence ?? 0),
    true,
  );
  t.check("la confiance ne dépasse jamais 95", (avecVentes?.confidence ?? 0) <= 95, true);
  t.check(
    "les signaux d'achat sont marqués comme prouvés",
    avecVentes?.signals.some((s) => s.proven),
    true,
  );

  // Sous le seuil de commandes, le panier moyen n'est PAS un signal.
  const peuDeVentes = deduceAudience({
    ...VIDE,
    medianPrice: 700,
    currency: "EUR",
    texts: ["premium"],
    aov: 690,
    orders: MIN_ORDERS_FOR_BEHAVIOUR - 1,
  });
  t.check(
    "sous le seuil, le panier moyen n'est pas retenu",
    peuDeVentes?.signals.some((s) => s.id === "panier_reel"),
    false,
  );
  t.check(
    "sous le seuil, la confiance reste plafonnée",
    (peuDeVentes?.confidence ?? 100) <= MAX_CONFIDENCE_WITHOUT_SALES,
    true,
  );
  t.check(
    "le nombre exact de commandes est cité dans ce qui manque",
    peuDeVentes?.missing.some((m) => m.includes(String(MIN_ORDERS_FOR_BEHAVIOUR - 1))),
    true,
  );

  // --- 5. L'écart entre ce qu'on montre et ce qu'on vend -------------------
  // Le constat le plus riche du module.
  const ecart = deduceAudience({
    ...VIDE,
    medianPrice: 700,
    currency: "EUR",
    texts: ["premium"],
    aov: 90,
    orders: 200,
  });
  const signalEcart = ecart?.signals.find((s) => s.id === "ecart_vitrine_achat");
  t.check("l'écart vitrine/achat est détecté", Boolean(signalEcart), true);
  t.check("l'écart est un signal prouvé", signalEcart?.proven, true);
  t.check(
    "l'écart dit dans quel sens il penche",
    /en dessous de la gamme affichée/.test(signalEcart?.reading ?? ""),
    true,
  );
  // Panier aligné sur la vitrine : aucun écart ne doit être signalé.
  const aligne = deduceAudience({
    ...VIDE,
    medianPrice: 700,
    currency: "EUR",
    texts: ["premium"],
    aov: 720,
    orders: 200,
  });
  t.check(
    "un panier aligné ne produit aucun écart",
    aligne?.signals.some((s) => s.id === "ecart_vitrine_achat"),
    false,
  );

  // --- 6. Aucun trait démographique inventé --------------------------------
  // C'est le travers exact que ce module doit éviter.
  const interdits = [
    "ans",
    "femme",
    "homme",
    "urbain",
    "millennial",
    "génération",
    "csp",
    "cadre",
    "étudiant",
  ];
  for (const h of [vitrine, avecVentes, ecart]) {
    if (!h) continue;
    const texte = [h.segment, ...h.motivations, ...h.needs, ...h.objections, ...h.expectations]
      .join(" ")
      .toLowerCase();
    for (const mot of interdits) {
      t.check(
        `le portrait n'invente pas « ${mot} »`,
        new RegExp(`\\b${mot}\\b`).test(texte),
        false,
      );
    }
  }

  // --- 7. Chaque signal porte sa preuve ------------------------------------
  for (const h of [vitrine, avecVentes, ecart]) {
    if (!h) continue;
    for (const s of h.signals) {
      t.check(`${s.id} porte une preuve littérale`, s.evidence.length > 15, true);
      t.check(`${s.id} nomme sa source`, /Shopify|site public|scan/i.test(s.evidence), true);
      t.check(`${s.id} dit ce qu'il indique`, s.reading.length > 20, true);
    }
    t.check(
      "la confiance est bornée",
      h.confidence >= MIN_CONFIDENCE_TO_PUBLISH && h.confidence <= 95,
      true,
    );
  }

  // --- 8. Les incohérences croisent le public ET l'observation -------------
  // Constater qu'il manque des avis est banal ; le constater sur un public qui
  // achète après comparaison est un diagnostic.
  const inputPremium: AudienceInput = {
    ...VIDE,
    medianPrice: 700,
    currency: "EUR",
    productCount: 17,
    texts: ["premium"],
    descriptionsMissingShare: 0.88,
    reviewsDeclared: false,
    policyPages: 0,
    shippingMentioned: false,
  };
  const premium = deduceAudience(inputPremium)!;
  const incoherences = findIncoherences(premium, inputPremium);
  t.check("des incohérences sont trouvées", incoherences.length >= 3, true);
  for (const i of incoherences) {
    t.check(`${i.id} a une observation`, i.observation.length > 20, true);
    t.check(`${i.id} a un problème distinct de l'observation`, i.problem !== i.observation, true);
    t.check(`${i.id} porte des preuves`, i.evidence.length > 0, true);
    t.check(`${i.id} a un impact potentiel`, i.impact.length > 20, true);
    t.check(`${i.id} a une recommandation`, i.recommendation.length > 20, true);
    t.check(`${i.id} a une correction concrète`, i.correction.length > 40, true);
    t.check(`${i.id} a un impact borné`, i.impactScore >= 1 && i.impactScore <= 5, true);
    t.check(`${i.id} a un effort borné`, i.effort >= 1 && i.effort <= 5, true);
    // La gravité doit être justifiée PAR LE PUBLIC, pas énoncée dans l'absolu.
    t.check(
      `${i.id} rattache le problème au public`,
      /ce public|cette gamme|premium|luxe|acheteur/i.test(i.problem),
      true,
    );
  }

  // Le même fait sur une boutique d'entrée de gamme ne produit pas les mêmes
  // incohérences : c'est toute la différence avec un audit générique.
  const inputEntree: AudienceInput = {
    ...VIDE,
    medianPrice: 12,
    currency: "EUR",
    productCount: 40,
    texts: ["petit prix"],
    reviewsDeclared: false,
    policyPages: 0,
  };
  const entree = deduceAudience(inputEntree)!;
  const incoherencesEntree = findIncoherences(entree, inputEntree);
  t.check(
    "l'absence d'avis n'est pas la même alerte en entrée de gamme",
    incoherencesEntree.some((i) => i.id === "audience.premium_sans_avis"),
    false,
  );
  t.check(
    "le public d'entrée de gamme est bien caractérisé",
    entree.tier ? TIER_LABELS[entree.tier] : null,
    "entrée de gamme",
  );

  // Une observation manquante ne produit AUCUNE incohérence : ne pas savoir
  // s'il y a des avis n'est pas la même chose que savoir qu'il n'y en a pas.
  const inconnu = findIncoherences(premium, {
    ...inputPremium,
    reviewsDeclared: null,
    policyPages: null,
  });
  t.check(
    "une donnée inconnue ne produit pas d'incohérence",
    inconnu.some(
      (i) => i.id === "audience.premium_sans_avis" || i.id === "audience.premium_sans_politique",
    ),
    false,
  );

  // --- 9. Le portrait part au modèle avec ses garde-fous ------------------
  const bloc = audienceToPromptBlock(premium, incoherences);
  t.check("la confiance est écrite en tête", /confiance \d+ %/.test(bloc), true);
  t.check(
    "le compte des signaux est donné",
    /signaux, dont \d+ tirés d'achats réels/.test(bloc),
    true,
  );
  t.check("chaque signal est étiqueté achat ou affichage", /\[affichage\]/.test(bloc), true);
  t.check("le modèle est prévenu que c'est une hypothèse", /pas un fait/.test(bloc), true);
  t.check(
    "l'invention de traits démographiques est interdite nommément",
    /ni âge, ni sexe/.test(bloc),
    true,
  );
  t.check(
    "l'invention d'études de marché est interdite",
    /aucune étude de marché/.test(bloc),
    true,
  );
  t.check("les incohérences suivent la chaîne complète", /Correction :/.test(bloc), true);

  // Sans portrait, le modèle reçoit une interdiction, pas un vide.
  const blocVide = audienceToPromptBlock(null, []);
  t.check("l'absence de portrait est déclarée", /NON DÉDUCTIBLE/.test(blocVide), true);
  t.check("le modèle a interdiction d'en inventer un", /N'en propose AUCUN/.test(blocVide), true);

  // --- 10. Lecture depuis les observations réelles -------------------------
  const depuisObs = audienceInputFrom(
    [
      obs("shopify.price_median", 699.95),
      obs("shopify.product_count", 17),
      obs("shopify.products_without_description", 15),
      obs("storefront.policy_pages", 0),
    ],
    ["Snowboard"],
    "USD",
  );
  t.check("le prix médian est lu", depuisObs.medianPrice, 699.95);
  t.check(
    "la part de fiches muettes est calculée",
    Math.round((depuisObs.descriptionsMissingShare ?? 0) * 100),
    88,
  );
  t.check("une observation absente reste nulle", depuisObs.aov, null);
  t.check("un booléen absent reste nul, jamais faux", depuisObs.reviewsDeclared, null);
  t.check("un zéro observé devient bien faux", depuisObs.policyPages, 0);

  // --- 11. Le module est branché dans le chemin d'audit -------------------
  const runner = readFileSync(
    new URL("../../src/lib/audit-runner.server.ts", import.meta.url).pathname,
    "utf8",
  );
  t.check("le chemin d'audit déduit le client cible", /deduceAudience\(/.test(runner), true);
  t.check("les incohérences sont calculées", /findIncoherences\(/.test(runner), true);
  t.check("le portrait part dans le prompt", /audienceToPromptBlock\(/.test(runner), true);
});
