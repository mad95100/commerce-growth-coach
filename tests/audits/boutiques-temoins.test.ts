import { defineSuite } from "../harness";
import { analyse, type RuleContext } from "@/lib/audit-rules";
import { groupByCause } from "@/lib/root-cause";
import { audienceInputFrom, deduceAudience, findIncoherences } from "@/lib/audience";
import { JARGON } from "@/lib/plain-language";
import type { Observation, ObservationGap } from "@/lib/observations";

/**
 * BOUTIQUES TÉMOINS — LE MOTEUR JUGÉ SUR SON VERDICT, PAS SUR SES PIÈCES.
 *
 * POURQUOI CETTE SUITE EXISTE ALORS QUE TOUT EST DÉJÀ TESTÉ. Chaque module a
 * ses contrôles, et ils passent tous. Ce n'est pas la même chose que dire que
 * le moteur a raison. Les défauts les plus graves de ce projet ne se sont
 * jamais produits DANS un module : ils sont nés entre deux.
 *
 *   — « Conversion 100/100 » sur une boutique sans un seul visiteur mesuré.
 *     La règle de conversion était juste : elle ne s'était pas déclenchée,
 *     faute d'entrées. Le calcul de score était juste aussi : aucune
 *     déduction, donc la note maximale. Les deux ensemble affirmaient une
 *     excellence sur un sujet dont on ne savait rien.
 *
 *   — « 9999 % » dans une phrase adressée au marchand, parce qu'un module
 *     rendait un ratio et qu'un autre attendait un pourcentage.
 *
 * Un test par module ne peut pas voir cela. Il faut faire tourner la chaîne
 * ENTIÈRE — règles, scores, causes racines, portrait du client — sur des
 * boutiques telles qu'on en rencontre, et juger ce qui en sort.
 *
 * CE QUE CHAQUE BOUTIQUE ÉPROUVE. Elles ne sont pas des variations : chacune
 * correspond à une situation où le moteur a déjà eu tort, ou pourrait avoir
 * tort de façon coûteuse.
 *
 * LES PROPRIÉTÉS SONT VÉRIFIÉES SUR TOUTES. Ce qui suit ne doit jamais arriver,
 * quelle que soit la boutique : un axe noté sans donnée, un constat sans
 * preuve, un pourcentage hors bornes, un mot du moteur dans un texte destiné au
 * marchand. Ce sont les contrôles qui attrapent la prochaine erreur, pas ceux
 * qui documentent les précédentes.
 */

// ---------------------------------------------------------------------------
// Fabrique d'observations
// ---------------------------------------------------------------------------

let compteur = 0;
function obs(id: string, value: number | null, over: Partial<Observation> = {}): Observation {
  compteur += 1;
  return {
    id,
    source: id.startsWith("storefront.")
      ? "storefront"
      : id.startsWith("organic.")
        ? "organic"
        : "shopify",
    domain: "produit",
    label: id,
    value,
    unit: "count",
    periodDays: 30,
    evidence: `valeur relevée pour ${id} (témoin ${compteur})`,
    sample: 100,
    ...over,
  };
}

function trou(id: string, label: string): ObservationGap {
  return {
    id,
    label,
    source: id.startsWith("storefront.") ? "storefront" : "shopify",
    reason: "Donnée absente sur cette boutique témoin.",
    wouldEnable: "Ce que cette donnée permettrait d'établir.",
  };
}

type Temoin = {
  nom: string;
  ctx: RuleContext;
  /** Textes réellement lus sur le site, pour le portrait du client. */
  texts: string[];
};

// ---------------------------------------------------------------------------
// Les boutiques
// ---------------------------------------------------------------------------

/**
 * 1. LA BOUTIQUE QUE PERSONNE NE VISITE.
 *
 * Le catalogue est en ligne, les fiches sont correctes, et il n'y a aucun
 * trafic mesuré. C'est la boutique qui a produit « Conversion 100/100 ».
 */
const sansTrafic: Temoin = {
  nom: "boutique sans trafic mesuré",
  ctx: {
    currency: "EUR",
    observations: [
      obs("shopify.product_count", 24),
      obs("shopify.products_without_description", 1),
      obs("shopify.products_without_image", 0),
      obs("shopify.orders_30d", 0),
      obs("shopify.revenue_30d", 0, { unit: "currency", currency: "EUR" }),
      obs("storefront.policy_pages", 3, { source: "storefront" }),
      obs("storefront.mobile_viewport", 1, { source: "storefront" }),
      obs("storefront.broken_pages", 0, { source: "storefront" }),
    ],
    gaps: [trou("shopify.sessions_30d", "Sessions et visiteurs")],
  },
  texts: ["Bonnet en laine mérinos", "Écharpe tricotée main", "Livraison en 48 h"],
};

/**
 * 2. LA BOUTIQUE QUI VEND CHER SANS RIEN POUR LE JUSTIFIER.
 *
 * Prix médian de 480 €, aucune page de politique, aucun avis, deux commandes.
 * Le portrait doit conclure « premium » ET refuser d'en être sûr — puis
 * relever la contradiction entre le prix affiché et l'absence de réassurance.
 */
const cherSansPreuve: Temoin = {
  nom: "boutique premium sans réassurance",
  ctx: {
    currency: "EUR",
    observations: [
      obs("shopify.product_count", 8),
      obs("shopify.products_without_description", 5),
      obs("shopify.products_without_image", 0),
      obs("shopify.orders_30d", 2, { sample: 2 }),
      obs("shopify.revenue_30d", 960, { unit: "currency", currency: "EUR", sample: 2 }),
      obs("storefront.policy_pages", 0, { source: "storefront" }),
      obs("storefront.mobile_viewport", 1, { source: "storefront" }),
      obs("storefront.product_structured_data", 0, { source: "storefront" }),
    ],
    gaps: [trou("shopify.sessions_30d", "Sessions et visiteurs")],
  },
  texts: [
    "Manteau en cachemire, coupe atelier",
    "Sac de voyage cuir pleine fleur, fabrication française",
    "Édition limitée",
  ],
};

/**
 * 3. LA BOUTIQUE QUI A DU TRAFIC ET NE CONVERTIT PAS.
 *
 * Le cas où le moteur DOIT se prononcer : 5 200 sessions, 21 commandes. C'est
 * l'inverse du premier témoin — ici, se taire serait la faute.
 */
const traficSansVente: Temoin = {
  nom: "boutique avec trafic et sans conversion",
  ctx: {
    currency: "EUR",
    observations: [
      obs("shopify.product_count", 60),
      obs("shopify.products_without_description", 38),
      obs("shopify.products_without_image", 4),
      obs("shopify.orders_30d", 21, { sample: 21 }),
      obs("shopify.revenue_30d", 630, { unit: "currency", currency: "EUR", sample: 21 }),
      obs("shopify.sessions_30d", 5200, { sample: 5200 }),
      obs("shopify.sessions_with_cart_30d", 420, { sample: 5200 }),
      obs("shopify.sessions_reached_checkout_30d", 96, { sample: 5200 }),
      obs("shopify.sessions_completed_checkout_30d", 21, { sample: 5200 }),
      obs("shopify.discounted_order_share", 0.71, { unit: "ratio", sample: 21 }),
      obs("storefront.policy_pages", 1, { source: "storefront" }),
      obs("storefront.mobile_viewport", 0, { source: "storefront" }),
      obs("storefront.broken_pages", 7, { source: "storefront" }),
    ],
    gaps: [],
  },
  texts: ["Coque téléphone 9,90 €", "Promo -50 %", "Déstockage"],
};

/**
 * 4. LA BOUTIQUE DONT ON NE SAIT RIEN.
 *
 * Aucune source n'a répondu. C'est le témoin le plus important : c'est ici
 * qu'un moteur mal réglé invente. Il ne doit rien affirmer, rien noter, et le
 * dire.
 */
const inconnue: Temoin = {
  nom: "boutique dont aucune source n'a répondu",
  ctx: {
    currency: null,
    observations: [],
    gaps: [trou("shopify.unreachable", "Shopify"), trou("storefront.unreachable", "Site public")],
  },
  texts: [],
};

const TEMOINS = [sansTrafic, cherSansPreuve, traficSansVente, inconnue];

export default defineSuite("Moteur — boutiques témoins, verdict de bout en bout", (t) => {
  // =========================================================================
  // 1. Ce qui ne doit JAMAIS arriver, sur aucune boutique
  // =========================================================================
  for (const temoin of TEMOINS) {
    const rapport = analyse(temoin.ctx);
    const mesures = new Set(
      temoin.ctx.observations.filter((o) => o.value !== null).map((o) => o.id),
    );

    // UN AXE NOTÉ EST UN AXE MESURÉ. C'est la règle née de « Conversion
    // 100/100 » : une note parfaite sur un sujet inconnu est pire qu'une
    // absence de note, parce qu'elle remonte dans le score global.
    for (const axe of rapport.axes) {
      // UN AXE NON MESURÉ NE PORTE PLUS DE NOTE DU TOUT. Le champ valait 100
      // — la note qu'obtient mécaniquement un sujet sur lequel aucune règle
      // n'a pu se prononcer — et il suffisait qu'un lecteur oublie de
      // consulter `measured` pour afficher une excellence imaginaire.
      t.check(
        `${temoin.nom} — ${axe.axis} non mesuré n'a pas de note`,
        axe.score === null,
        !axe.measured,
      );
      if (axe.score !== null) {
        t.check(
          `${temoin.nom} — ${axe.axis} reste dans les bornes`,
          axe.score >= 0 && axe.score <= 100,
          true,
        );
      }
    }

    // UN CONSTAT SANS PREUVE N'EST PAS UN CONSTAT. Sauf « donnée
    // insuffisante », qui est précisément l'aveu d'une absence de preuve.
    for (const f of rapport.findings) {
      if (f.level !== "donnee_insuffisante") {
        t.check(`${temoin.nom} — ${f.ruleId} cite une preuve`, f.evidence.length > 0, true);
        t.check(
          `${temoin.nom} — ${f.ruleId} s'appuie sur des données présentes`,
          f.basedOn.every((id) => mesures.has(id)),
          true,
        );
      }
      // AUCUN POURCENTAGE HORS BORNES dans une phrase lue par le marchand.
      // C'est le défaut « 9999 % », né entre deux modules et invisible pour
      // chacun d'eux pris séparément.
      const pourcents = [
        ...`${f.statement} ${f.why} ${f.recommendation}`.matchAll(/([\d.]+)\s?%/g),
      ];
      for (const p of pourcents) {
        const valeur = Number(p[1]);
        t.check(
          `${temoin.nom} — ${f.ruleId} : « ${p[0]} » est un pourcentage plausible`,
          Number.isFinite(valeur) && valeur >= 0 && valeur <= 100,
          true,
        );
      }
      // LE VOCABULAIRE DU MOTEUR NE SORT PAS. Le texte des règles est lu tel
      // quel par le marchand ; le jargon y revient tout seul.
      const texte = `${f.title} ${f.statement} ${f.why} ${f.recommendation}`.toLowerCase();
      for (const mot of JARGON) {
        t.check(`${temoin.nom} — ${f.ruleId} n'emploie pas « ${mot} »`, texte.includes(mot), false);
      }
      t.check(
        `${temoin.nom} — ${f.ruleId} recommande un geste précis`,
        f.recommendation.trim().length > 20,
        true,
      );
    }

    // LES CAUSES NE REMONTENT JAMAIS LE NIVEAU DE PREUVE DE LEURS SYMPTÔMES.
    const { causes } = groupByCause(
      rapport.findings.map((f) => ({
        id: f.ruleId,
        title: f.title,
        evidence: f.evidence,
        level: f.level,
        impact: f.impact,
        effort: f.effort,
      })),
    );
    const parId = new Map(rapport.findings.map((f) => [f.ruleId, f]));
    const ordre = ["donnee_insuffisante", "a_verifier", "fortement_suggere", "prouve"];
    for (const cause of causes) {
      const membres = cause.symptoms
        .map((s) => parId.get(s.id))
        .filter((f): f is NonNullable<typeof f> => Boolean(f));
      if (membres.length === 0) continue;
      const plusFaible = Math.min(...membres.map((m) => ordre.indexOf(m.level)));
      t.check(
        `${temoin.nom} — la cause « ${cause.id} » ne dépasse pas son symptôme le moins sûr`,
        ordre.indexOf(cause.level) <= plusFaible,
        true,
      );
    }
  }

  // =========================================================================
  // 2. La boutique sans trafic : le défaut historique, en situation
  // =========================================================================
  const r1 = analyse(sansTrafic.ctx);
  const conversion = r1.axes.find((a) => a.axis === "conversion");
  t.check("sans trafic — la conversion n'est pas notée", conversion?.measured ?? false, false);
  t.check("sans trafic — et surtout pas notée 100", conversion?.score, null);
  // Le score global ne doit pas être flatté par des axes muets.
  t.check(
    "sans trafic — le score global reste modeste ou absent",
    r1.score === null || r1.score < 100,
    true,
  );

  // =========================================================================
  // 3. La boutique premium sans réassurance : le portrait et sa réserve
  // =========================================================================
  const entree2 = audienceInputFrom(cherSansPreuve.ctx.observations, cherSansPreuve.texts, "EUR");
  const portrait2 = deduceAudience({
    ...entree2,
    medianPrice: 480,
    priceMin: 320,
    priceMax: 890,
    aov: 480,
    orders: 2,
    policyPages: 0,
    reviewsDeclared: false,
  });
  t.check("premium — un portrait est produit", portrait2 !== null, true);
  if (portrait2) {
    // DEUX COMMANDES NE PROUVENT RIEN. La confiance doit rester basse même
    // quand tous les signaux d'affichage concordent : c'est exactement le
    // moment où un moteur bavard se tromperait avec assurance.
    t.check("premium — la confiance reste plafonnée", portrait2.confidence <= 60, true);
    t.check(
      "premium — la confiance est bornée",
      portrait2.confidence >= 0 && portrait2.confidence <= 100,
      true,
    );
    t.check(
      "premium — la gamme haute est reconnue",
      ["premium", "luxe"].includes(portrait2.tier ?? ""),
      true,
    );
    // La contradiction prix / réassurance est le constat le plus utile ici.
    const incoherences = findIncoherences(portrait2, {
      ...entree2,
      medianPrice: 480,
      aov: 480,
      orders: 2,
      policyPages: 0,
      reviewsDeclared: false,
    });
    t.check("premium — une contradiction est relevée", incoherences.length > 0, true);
    for (const i of incoherences) {
      // Une contradiction doit porter les trois choses qui la rendent
      // actionnable : ce qui a été vu, pourquoi c'est un problème POUR CE
      // public, et le geste. Sans le troisième, c'est un reproche.
      t.check(`premium — « ${i.id} » dit ce qui a été vu`, i.observation.length > 15, true);
      t.check(`premium — « ${i.id} » dit le problème`, i.problem.length > 15, true);
      t.check(`premium — « ${i.id} » dit quoi faire`, i.correction.length > 15, true);
      t.check(`premium — « ${i.id} » cite une preuve`, i.evidence.length > 0, true);
    }
  }

  // =========================================================================
  // 4. La boutique avec trafic : ici, se taire serait la faute
  // =========================================================================
  const r3 = analyse(traficSansVente.ctx);
  const conv3 = r3.axes.find((a) => a.axis === "conversion");
  t.check("trafic — la conversion EST mesurée", conv3?.measured ?? false, true);
  t.check("trafic — et elle n'est pas parfaite", (conv3?.score ?? 100) < 100, true);
  t.check("trafic — le moteur se prononce", r3.findings.length > 0, true);
  t.check("trafic — un plan est proposé", r3.priorities.length > 0, true);
  // Les priorités sont ordonnées : le premier geste est le mieux placé.
  const impacts = r3.priorities.map((p) => p.priority);
  t.check(
    "trafic — les priorités sont réellement ordonnées",
    impacts.every((v, i) => i === 0 || impacts[i - 1]! >= v),
    true,
  );

  // =========================================================================
  // 5. La boutique inconnue : ne rien inventer
  // =========================================================================
  const r4 = analyse(inconnue.ctx);
  t.check(
    "inconnue — aucun axe n'est mesuré",
    r4.axes.every((a) => !a.measured),
    true,
  );
  t.check("inconnue — aucun score global n'est produit", r4.score, null);
  t.check(
    "inconnue — aucun constat n'est présenté comme prouvé",
    r4.findings.some((f) => f.level === "prouve"),
    false,
  );
  t.check("inconnue — ce qui manque est nommé", r4.unresolved.length > 0, true);
  // Et surtout : aucun portrait de client tiré de rien.
  const portrait4 = deduceAudience(audienceInputFrom([], [], null));
  t.check("inconnue — aucun portrait n'est déduit du vide", portrait4, null);
});
