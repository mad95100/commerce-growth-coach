import { defineSuite } from "../harness";
import { analyse, COMMERCIAL_AXES, type RuleContext } from "@/lib/audit-rules";
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

  // =========================================================================
  // BOUTIQUE 5 — IRRÉPROCHABLE SUR LE PAPIER, ET QUI NE VEND RIEN
  // =========================================================================
  /*
    LE DÉFAUT QUE CETTE BOUTIQUE A RÉVÉLÉ, ET POURQUOI IL A SURVÉCU AUX TESTS.

    Dix produits décrits et illustrés, des prix, une vitrine complète — titre,
    navigation, appel à l'action, trois pages de politique, viewport mobile.
    ZÉRO commande, ZÉRO euro, AUCUNE session mesurée.

    Le score sortait à **100/100**. Exactement le verdict absurde que le seuil
    de couverture avait été créé pour empêcher, et il l'a franchi
    légitimement : cinq axes sur dix étaient mesurés.

    POURQUOI LE GARDE-FOU N'A PAS MORDU. Il exigeait qu'au moins un axe
    « commercial » soit mesuré, et comptait `offre` parmi eux. Or `offre`
    devient « mesuré » dès que `shopify.price_min` existe — dès qu'un catalogue
    porte des prix, donc avant la première visite. `axisOfObservation` porte
    pourtant son propre avertissement : ce rattachement « ne sert qu'à savoir si
    un axe a été REGARDÉ, jamais à calculer un score ». La représentativité
    était fondée sur un drapeau qui ne mesure que le regard.

    POURQUOI AUCUN TEST NE L'A VU. Tous les contrôles de score travaillaient sur
    des `AxisScore[]` FABRIQUÉS À LA MAIN. Aucun ne partait d'observations pour
    arriver à une note, et c'est précisément entre les deux que le défaut
    vivait. Cette boutique part donc des observations.
  */
  const vitrineIrreprochable: Observation[] = [
    // Ce que la boutique CONTIENT — connu avant la première visite.
    obs("shopify.product_count", 10),
    obs("shopify.products_without_description", 0),
    obs("shopify.products_without_image", 0),
    obs("shopify.price_min", 20),
    obs("shopify.price_max", 29),
    obs("shopify.price_median", 24.5),
    obs("storefront.policy_pages", 3, { source: "storefront" }), // → confiance
    obs("storefront.mobile_viewport", 1, { source: "storefront" }), // → ux
    obs("storefront.accueil_h1_mots", 5, { source: "storefront" }),
    obs("storefront.accueil_cta", 2, { source: "storefront" }),
    obs("storefront.response_ms", 250, { source: "storefront" }), // → technique
    obs("storefront.accueil_title", 4, { source: "storefront" }), // → seo
    obs("storefront.structured_data", 1, { source: "storefront" }),
    // Ce que la boutique OBTIENT : rien, et rien n'est mesuré.
    obs("shopify.orders_30d", 0),
    obs("shopify.revenue_30d", 0),
  ];
  /*
    LE MANQUE DE SESSIONS EST DÉCLARÉ, comme le fait le vrai collecteur. Ce
    détail n'en est pas un : `data.traffic_unmeasured` — qui AVEUGLE la
    conversion — ne se déclenche pas sur l'absence de `sessions_30d`, mais sur
    la présence du TROU correspondant. Une première version de ce fixture
    l'omettait ; la conversion passait alors pour « mesurée » à partir d'un
    compte de commandes à zéro, et le contrôle est tombé.

    C'est une fragilité réelle, pas un artefact de test, et elle est vérifiée
    plus bas : la protection de l'axe conversion tient au trou déclaré.
  */
  const trouSessions = [trou("shopify.sessions_30d", "Sessions et visiteurs")];
  const r5 = analyse({
    observations: vitrineIrreprochable,
    gaps: trouSessions,
  } as RuleContext);
  const mesures5 = r5.axes.filter((a) => a.score !== null);

  t.check(
    "vitrine irréprochable — la couverture par le nombre est bien atteinte",
    mesures5.length >= r5.axes.length / 2,
    true,
  );
  t.check("vitrine irréprochable — et pourtant aucune note", r5.score, null);
  // LE POINT EXACT : `offre` est mesuré, et cela ne suffit pas.
  t.check(
    "…alors même que l'offre est « mesurée » depuis les prix",
    r5.axes.find((a) => a.axis === "offre")?.measured,
    true,
  );
  // Ce qui manque n'est pas un axe de plus : c'est un RÉSULTAT.
  for (const axe of COMMERCIAL_AXES) {
    t.check(
      `…et aucun résultat commercial n'est mesuré (${axe})`,
      r5.axes.find((a) => a.axis === axe)?.measured,
      false,
    );
  }
  // ZÉRO COMMANDE N'EST PAS TRANSFORMÉ EN NOTE NULLE. L'absence de note et une
  // note de 0 disent deux choses opposées : « nous ne savons pas juger » et
  // « nous avons jugé, c'est mauvais ».
  t.check("…et surtout pas une note de 0", r5.score === 0, false);

  // CE QUI PROTÈGE LA CONVERSION EST LE TROU DÉCLARÉ, PAS L'ABSENCE DE DONNÉE.
  // Sans le trou, `orders_30d = 0` suffit à faire passer l'axe pour mesuré —
  // un compte de commandes n'est pas un taux, et zéro commande sans
  // dénominateur ne dit pas si la boutique ne reçoit personne ou ne transforme
  // pas. Le jour où un collecteur omettrait ce trou, la note reviendrait.
  const sansTrouDeclare = analyse({ observations: vitrineIrreprochable, gaps: [] } as RuleContext);
  t.check(
    "sans trou déclaré, la conversion passe pour mesurée",
    sansTrouDeclare.axes.find((a) => a.axis === "conversion")?.measured,
    true,
  );
  t.check(
    "…c'est donc bien l'aveuglement qui protège la note",
    r5.axes.find((a) => a.axis === "conversion")?.measured,
    false,
  );

  /*
    LA MÊME BOUTIQUE, LE JOUR OÙ ELLE VEND. Le garde-fou refuse de noter une
    vitrine ; il n'interdit pas de noter un commerce. Sans cette contrepartie,
    la correction aurait rendu le score inatteignable en pratique — ce qui est
    l'autre façon de le rendre inutile.
  */
  const memeBoutiqueQuiVend = analyse({
    observations: [
      ...vitrineIrreprochable.filter((o) => o.id !== "shopify.orders_30d"),
      obs("shopify.orders_30d", 120),
      obs("shopify.sessions_30d", 4000),
      obs("shopify.conversion_rate", 0.03, { unit: "percent" }),
    ],
    gaps: [],
  } as RuleContext);
  t.check("la même boutique qui vend retrouve une note", memeBoutiqueQuiVend.score !== null, true);
  t.check(
    "…parce qu'un résultat commercial est enfin mesuré",
    COMMERCIAL_AXES.some((axe) => memeBoutiqueQuiVend.axes.find((a) => a.axis === axe)?.measured),
    true,
  );

  // =========================================================================
  // SIX BOUTIQUES, SIX COUVERTURES — LA NOTE JUGÉE PAR EXÉCUTION
  // =========================================================================
  /*
    Ces six cas partent des OBSERVATIONS et traversent la chaîne entière. C'est
    la seule façon de répondre à la question qui compte : la note décrit-elle
    l'état du commerce, ou la facilité des contrôles disponibles ?

    Le cas 3 est celui qui a imposé le plafond commercial. Quatre mille sessions,
    ZÉRO commande, catalogue complet, vitrine irréprochable : la règle
    `conversion.traffic_without_orders` se déclenchait bien et faisait tomber
    l'axe conversion, mais six axes de construction à 100 le noyaient — 94/100
    sur une boutique qui ne vend rien.
  */
  const VITRINE_SAINE = [
    obs("storefront.policy_pages", 3, { source: "storefront" }),
    obs("storefront.mobile_viewport", 1, { source: "storefront" }),
    obs("storefront.response_ms", 250, { source: "storefront" }),
    obs("storefront.accueil_title", 4, { source: "storefront" }),
    obs("storefront.structured_data", 1, { source: "storefront" }),
    obs("storefront.accueil_h1_mots", 5, { source: "storefront" }),
    obs("storefront.accueil_cta", 2, { source: "storefront" }),
  ];
  const CATALOGUE_FOURNI = [
    obs("shopify.product_count", 12),
    obs("shopify.products_without_description", 0),
    obs("shopify.products_without_image", 0),
    obs("shopify.price_min", 20),
    obs("shopify.price_max", 60),
    obs("shopify.price_median", 35),
  ];
  const SANS_SESSIONS = [trou("shopify.sessions_30d", "Sessions et visiteurs")];

  const note = (observations: Observation[], gaps: ObservationGap[] = []) =>
    analyse({ observations, gaps } as RuleContext).score;

  t.check(
    "1. catalogue vide — aucune note",
    note(
      [...VITRINE_SAINE, obs("shopify.product_count", 0), obs("shopify.orders_30d", 0)],
      SANS_SESSIONS,
    ),
    null,
  );
  t.check(
    "2. catalogue rempli mais aucune session — aucune note",
    note([...VITRINE_SAINE, ...CATALOGUE_FOURNI, obs("shopify.orders_30d", 0)], SANS_SESSIONS),
    null,
  );

  // 3. DU TRAFIC ET PAS UNE VENTE. La note existe — nous savons quelque chose du
  // commerce — mais elle ne peut pas dépasser ce que ce commerce obtient.
  const trafficSansVente = note([
    ...VITRINE_SAINE,
    ...CATALOGUE_FOURNI,
    obs("shopify.sessions_30d", 4000),
    obs("shopify.orders_30d", 0),
  ]);
  t.check("3. du trafic, aucune commande — une note existe", trafficSansVente !== null, true);
  t.check("…mais elle n'est pas flatteuse", (trafficSansVente ?? 100) < 70, true);

  // 4. LA MÊME BOUTIQUE QUI VEND. Le plafond ne doit pas rendre la note
  // inatteignable : ce serait l'autre façon de la rendre inutile.
  const quiVend = note([
    ...VITRINE_SAINE,
    ...CATALOGUE_FOURNI,
    obs("shopify.sessions_30d", 4000),
    obs("shopify.orders_30d", 120),
    obs("shopify.conversion_rate", 3, { unit: "percent" }),
  ]);
  t.check("4. trafic et commandes — une note existe", quiVend !== null, true);
  t.check("…et elle est nettement meilleure", (quiVend ?? 0) > (trafficSansVente ?? 0), true);

  t.check(
    "5. des commandes mais trop peu d'axes — aucune note",
    note([obs("shopify.orders_30d", 120), obs("shopify.sessions_30d", 4000)]),
    null,
  );
  t.check(
    "6. techniquement parfaite, commercialement inactive — aucune note",
    note([...VITRINE_SAINE, ...CATALOGUE_FOURNI], SANS_SESSIONS),
    null,
  );

  /*
    UNE COMMANDE SUFFISAIT À PASSER ENTRE LES MAILLES.

    `shopify.conversion_rate` était calculé par la collecte depuis toujours et
    AUCUNE des trente-sept règles ne le lisait. `traffic_without_orders` ne
    couvrait que le cas binaire — zéro commande.

    Conséquence mesurée : dix mille sessions et UNE commande, soit 0,01 % de
    transformation, ne produisaient aucun constat. L'axe conversion restait à
    100, et le score global sortait à 99 sur une faiblesse commerciale
    démontrée. Il tombe maintenant au niveau de ce que le commerce obtient.
  */
  const dixMillePourUne = note([
    ...VITRINE_SAINE,
    ...CATALOGUE_FOURNI,
    obs("shopify.sessions_30d", 10000),
    obs("shopify.orders_30d", 1),
    obs("shopify.conversion_rate", 1 / 10000, { unit: "percent" }),
  ]);
  t.check("7. dix mille visites, une commande — une note existe", dixMillePourUne !== null, true);
  t.check("…et elle n'est pas flatteuse", (dixMillePourUne ?? 100) < 70, true);

  // ET LE CONSTAT EXISTE, avec son volume — pas une comparaison de marché.
  const constatTaux = analyse({
    observations: [
      ...VITRINE_SAINE,
      ...CATALOGUE_FOURNI,
      obs("shopify.sessions_30d", 10000),
      obs("shopify.orders_30d", 1),
      obs("shopify.conversion_rate", 1 / 10000, { unit: "percent" }),
    ],
    gaps: [],
  } as RuleContext).findings.find((f) => f.ruleId === "conversion.taux_anormalement_bas");
  t.check("le taux anormalement bas produit un constat", constatTaux !== undefined, true);
  t.check("…mesuré, pas déduit", constatTaux?.level, "prouve");
  t.check("…qui cite le volume qui n'a pas commandé", /9999/.test(constatTaux?.why ?? ""), true);
  // AUCUNE MOYENNE DE MARCHÉ : le produit s'interdit d'opposer au marchand une
  // norme sectorielle qu'il ne peut pas vérifier.
  t.check(
    "…sans invoquer une moyenne de marché",
    /moyenne du secteur|taux moyen|norme|benchmark|standard du march/i.test(
      `${constatTaux?.statement ?? ""} ${constatTaux?.why ?? ""}`,
    ),
    false,
  );
  // ET IL N'AFFIRME AUCUNE CAUSE : sans entonnoir, la marche reste inconnue.
  t.check(
    "…et reconnaît ne pas situer la marche",
    /ne mesurons pas à quelle marche/.test(constatTaux?.why ?? ""),
    true,
  );

  // 8. UN TAUX SAIN NE DÉCLENCHE RIEN. Un seuil qui mordrait sur une boutique
  // normale rendrait la note inutilisable.
  t.check(
    "8. un taux sain ne produit pas ce constat",
    analyse({
      observations: [
        ...VITRINE_SAINE,
        ...CATALOGUE_FOURNI,
        obs("shopify.sessions_30d", 4000),
        obs("shopify.orders_30d", 130),
        obs("shopify.conversion_rate", 130 / 4000, { unit: "percent" }),
      ],
      gaps: [],
    } as RuleContext).findings.some((f) => f.ruleId === "conversion.taux_anormalement_bas"),
    false,
  );

  // ET LES CONSTATS RESTENT VISIBLES QUAND LA NOTE EST REFUSÉE. « Non
  // déterminable » veut dire « nous ne savons pas noter », jamais « nous
  // préférons ne pas montrer ».
  const sansNote = analyse({
    observations: [...VITRINE_SAINE, obs("shopify.product_count", 0), obs("shopify.orders_30d", 0)],
    gaps: SANS_SESSIONS,
  } as RuleContext);
  t.check(
    "sans note, les constats restent",
    sansNote.score === null && sansNote.findings.length > 0,
    true,
  );
  t.check(
    "…et le catalogue vide en fait partie",
    sansNote.findings.some((f) => f.ruleId === "merchandising.catalogue_vide"),
    true,
  );
});
