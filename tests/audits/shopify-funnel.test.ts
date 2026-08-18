import { readFileSync } from "node:fs";
import { defineSuite } from "../harness";
import {
  ANALYTICS_WINDOW_DAYS,
  MIN_SESSIONS_FOR_RATE,
  funnelObservations,
  funnelQuery,
  locateLeak,
  parseFunnel,
  type FunnelRaw,
} from "@/lib/connectors/shopify-analytics";
import { analyse, runRules, type RuleContext } from "@/lib/audit-rules";
import type { Observation } from "@/lib/observations";

/**
 * L'ENTONNOIR SHOPIFY, ET LA LOCALISATION DE LA FUITE.
 *
 * CE QUE CETTE SUITE PROTÈGE. Le connecteur déclarait le trafic hors de portée
 * de l'API Admin. C'était faux : ShopifyQL l'expose, avec une permission déjà
 * accordée. L'erreur avait un coût direct — le moteur réclamait au marchand un
 * outil de mesure tiers pour une donnée que sa boutique possédait, et laissait
 * la conversion non notée.
 *
 * Ce qui se vérifie ici est surtout ce que le moteur REFUSE de faire : publier
 * un taux sur trop peu de volume, chercher la fuite au travers d'une marche non
 * mesurée, ou transformer une lecture échouée en un zéro qui se lirait comme
 * une mesure.
 */

function obs(partial: Partial<Observation> & { id: string }): Observation {
  return {
    source: "shopify",
    domain: "conversion",
    label: partial.id,
    value: null,
    unit: "count",
    periodDays: 30,
    evidence: `preuve ${partial.id}`,
    sample: null,
    ...partial,
  } as Observation;
}

/** Réponse ShopifyQL telle que l'API la rend réellement. */
function reponse(sessions: number, panier: number, caisse: number, paye: number) {
  return {
    tableData: {
      columns: [
        { name: "sessions", dataType: "number" },
        { name: "sessions_with_cart_additions", dataType: "number" },
        { name: "sessions_that_reached_checkout", dataType: "number" },
        { name: "sessions_that_completed_checkout", dataType: "number" },
      ],
      rowData: [[String(sessions), String(panier), String(caisse), String(paye)]],
    },
  };
}

export default defineSuite("Shopify — entonnoir réel et localisation de la fuite", (t) => {
  // --- 1. La requête ne demande aucune permission nouvelle -----------------
  const scopes = readFileSync(
    new URL("../../src/lib/connectors/shopify-scopes.ts", import.meta.url).pathname,
    "utf8",
  );
  t.check("la permission d'analyse est déjà demandée", /"read_analytics"/.test(scopes), true);
  const requete = funnelQuery();
  t.check("la requête vise le jeu de données sessions", /FROM sessions/.test(requete), true);
  t.check(
    "les quatre étages sont demandés en un appel",
    [
      "sessions",
      "sessions_with_cart_additions",
      "sessions_that_reached_checkout",
      "sessions_that_completed_checkout",
    ].every((c) => requete.includes(c)),
    true,
  );
  t.check(
    "la fenêtre de la requête est celle du connecteur",
    requete.includes(`-${ANALYTICS_WINDOW_DAYS}d`),
    true,
  );

  // --- 2. Lecture de la réponse --------------------------------------------
  const lu = parseFunnel(reponse(1000, 250, 120, 60));
  t.check("les sessions sont lues", lu.sessions, 1000);
  t.check("les ajouts au panier sont lus", lu.cartAdditions, 250);
  t.check("les entrées en caisse sont lues", lu.reachedCheckout, 120);
  t.check("les paiements sont lus", lu.completedCheckout, 60);
  t.check("la lecture est marquée joignable", lu.reachable, true);

  // LA COLONNE EST RETROUVÉE PAR SON NOM, jamais par sa position : ShopifyQL ne
  // garantit pas l'ordre, et une lecture positionnelle intervertirait
  // silencieusement les sessions et les paiements.
  const inverse = {
    tableData: {
      columns: [
        { name: "sessions_that_completed_checkout" },
        { name: "sessions" },
        { name: "sessions_with_cart_additions" },
        { name: "sessions_that_reached_checkout" },
      ],
      rowData: [["60", "1000", "250", "120"]],
    },
  };
  t.check("l'ordre des colonnes n'est pas supposé", parseFunnel(inverse).sessions, 1000);
  t.check(
    "l'ordre des colonnes n'est pas supposé (paiements)",
    parseFunnel(inverse).completedCheckout,
    60,
  );

  // Une réponse vide, absente ou en erreur n'est JAMAIS un zéro.
  t.check("une réponse absente ne devient pas zéro", parseFunnel(null).sessions, null);
  t.check("une réponse absente est marquée injoignable", parseFunnel(null).reachable, false);
  t.check(
    "une réponse sans ligne ne devient pas zéro",
    parseFunnel({ tableData: { columns: [], rowData: [] } }).sessions,
    null,
  );
  const erreur = parseFunnel({ parseErrors: [{ message: "Access denied" }] });
  t.check("une erreur d'analyse est remontée", erreur.error, "Access denied");
  t.check("une erreur d'analyse ne produit aucune valeur", erreur.sessions, null);
  // Une colonne manquante reste nulle, les autres sont lues.
  const partiel = parseFunnel({
    tableData: { columns: [{ name: "sessions" }], rowData: [["500"]] },
  });
  t.check("une colonne manquante reste nulle", partiel.cartAdditions, null);
  t.check("les colonnes présentes sont lues quand même", partiel.sessions, 500);

  // --- 3. Observations : un compte est publié, un taux est mérité ----------
  const richeBrut: FunnelRaw = {
    sessions: 1000,
    cartAdditions: 250,
    reachedCheckout: 120,
    completedCheckout: 60,
    reachable: true,
  };
  const riche = funnelObservations(richeBrut);
  t.check(
    "les quatre comptes sont publiés",
    riche.observations.filter((o) => o.unit === "count").length,
    4,
  );
  t.check(
    "le taux de conversion est publié au-dessus du volume minimal",
    riche.observations.some((o) => o.id === "shopify.conversion_rate"),
    true,
  );
  t.check(
    "les trois taux de passage sont publiés",
    [
      "shopify.rate_session_to_cart",
      "shopify.rate_cart_to_checkout",
      "shopify.rate_checkout_to_order",
    ].every((id) => riche.observations.some((o) => o.id === id)),
    true,
  );
  t.check("aucun trou quand tout est lu", riche.gaps.length, 0);
  for (const o of riche.observations) {
    t.check(`${o.id} porte sa preuve`, o.evidence.length > 10, true);
    t.check(`${o.id} nomme sa source dans sa preuve`, /Shopify/.test(o.evidence), true);
    if (o.unit === "percent") {
      t.check(
        `${o.id} est une part entre 0 et 1`,
        o.value !== null && o.value >= 0 && o.value <= 1,
        true,
      );
    }
  }

  // SOUS LE VOLUME MINIMAL, LE TAUX N'EST PAS PUBLIÉ — il est déclaré manquant.
  // Le cas réel de la boutique de test : onze sessions.
  const maigre = funnelObservations({
    sessions: 11,
    cartAdditions: 0,
    reachedCheckout: 0,
    completedCheckout: 0,
    reachable: true,
  });
  t.check(
    "les comptes sont publiés même à faible volume",
    maigre.observations.some((o) => o.id === "shopify.sessions_30d" && o.value === 11),
    true,
  );
  t.check(
    "aucun taux de conversion sur onze sessions",
    maigre.observations.some((o) => o.id === "shopify.conversion_rate"),
    false,
  );
  t.check(
    "le taux absent est déclaré, avec son motif chiffré",
    maigre.gaps.some((g) => g.id === "shopify.conversion_rate" && g.reason.includes("11")),
    true,
  );
  t.check("le seuil de publication est franc", MIN_SESSIONS_FOR_RATE >= 100, true);

  // Zéro session EST une mesure, et elle est publiée.
  const zero = funnelObservations({
    sessions: 0,
    cartAdditions: 0,
    reachedCheckout: 0,
    completedCheckout: 0,
    reachable: true,
  });
  t.check(
    "zéro session est publié comme un fait",
    zero.observations.find((o) => o.id === "shopify.sessions_30d")?.value,
    0,
  );

  // Lecture échouée : aucune observation, un trou nommé.
  const echec = funnelObservations({
    sessions: null,
    cartAdditions: null,
    reachedCheckout: null,
    completedCheckout: null,
    reachable: false,
    error: "Access denied for shopifyqlQuery",
  });
  t.check("une lecture échouée ne produit aucune observation", echec.observations.length, 0);
  t.check("une lecture échouée déclare un trou", echec.gaps.length, 1);
  t.check(
    "une permission refusée est nommée comme telle",
    /permission/i.test(echec.gaps[0]?.reason ?? ""),
    true,
  );

  /*
    LES CAUSES QUI NE S'ARRANGERONT PAS TOUTES SEULES.

    Une seule phrase couvrait tout ce qui n'était pas une permission : « Les
    statistiques de trafic de la boutique n'ont pas pu être lues. » Elle laisse
    entendre qu'une prochaine tentative pourrait aboutir. C'est faux pour deux
    des causes réelles, et c'est là que cela coûte le plus cher :

      · le champ interrogé n'existe plus chez Shopify — notre défaut, identique
        à chaque audit, et rien de ce que fait le marchand n'y changera rien ;
      · ShopifyQL n'est pas ouvert à l'offre de la boutique — une question
        d'abonnement Shopify, ni un branchement ni une panne.

    Faire patienter quelqu'un devant l'une de ces deux-là, audit après audit,
    est exactement ce que le reste de ce produit s'efforce d'éviter.
  */
  const causes: Array<[string, string, RegExp]> = [
    [
      "champ disparu",
      "Field 'shopifyqlQuery' doesn't exist on type 'QueryRoot'",
      /défaut de notre côté|relancer l'audit ne changera rien/i,
    ],
    [
      "offre Shopify",
      "shopifyqlQuery is not available for this plan",
      /offre Shopify|rien à rebrancher/i,
    ],
    ["panne passagère", "HTTP 503", /passager|un peu plus tard/i],
  ];
  for (const [nom, brut, attendu] of causes) {
    const g = funnelObservations({
      sessions: null,
      cartAdditions: null,
      reachedCheckout: null,
      completedCheckout: null,
      reachable: false,
      error: brut,
    }).gaps[0];
    t.check(`${nom} : la cause est reconnue`, attendu.test(g?.reason ?? ""), true);
    // Aucun terme technique n'atteint le marchand : la règle du produit ne
    // s'assouplit pas parce qu'on devient plus précis.
    for (const interdit of ["shopifyql", "graphql", "queryroot", "http"]) {
      t.check(
        `${nom} : n'expose pas « ${interdit} »`,
        (g?.reason ?? "").toLowerCase().includes(interdit),
        false,
      );
    }
  }

  // Ce qui n'est reconnu par aucun motif ne prend pas la formulation du voisin.
  const opaque = funnelObservations({
    sessions: null,
    cartAdditions: null,
    reachedCheckout: null,
    completedCheckout: null,
    reachable: false,
    error: "quelque chose d'inattendu",
  }).gaps[0];
  t.check(
    "une cause non identifiée se dit comme telle",
    /n'avons pas su dire pourquoi/i.test(opaque?.reason ?? ""),
    true,
  );
  t.check(
    "…sans accuser la permission ni l'offre",
    /permission|offre Shopify/i.test(opaque?.reason ?? ""),
    false,
  );
  // Et les quatre causes ne se confondent pas entre elles.
  const phrases = new Set(
    [
      "Access denied",
      "Field 'x' doesn't exist",
      "not available for this plan",
      "HTTP 503",
      "?",
    ].map(
      (e) =>
        funnelObservations({
          sessions: null,
          cartAdditions: null,
          reachedCheckout: null,
          completedCheckout: null,
          reachable: false,
          error: e,
        }).gaps[0]?.reason ?? "",
    ),
  );
  t.check("cinq causes donnent cinq phrases distinctes", phrases.size, 5);

  // --- 4. Localisation de la fuite -----------------------------------------
  const fuite = locateLeak(richeBrut);
  t.check("la fuite est localisée", fuite?.from, "visite");
  t.check("la marche aval est nommée", fuite?.to, "panier");
  t.check("le volume perdu est compté", fuite?.lost, 750);
  t.check("la preuve cite les deux bouts", /1000 → 250/.test(fuite?.evidence ?? ""), true);

  // LA PLUS GRANDE PERTE ABSOLUE, PAS LE PIRE TAUX. Perdre 90 % de dix
  // personnes n'est pas le problème d'une boutique qui perd 40 % de mille.
  const tauxTrompeur = locateLeak({
    sessions: 1000,
    cartAdditions: 600, // 400 perdus, 40 %
    reachedCheckout: 20, // 580 perdus, 97 %
    completedCheckout: 18,
    reachable: true,
  });
  t.check("la marche retenue est celle du plus grand volume perdu", tauxTrompeur?.from, "panier");

  // UNE MARCHE À TROU EST SAUTÉE, JAMAIS FRANCHIE. Sans les ajouts au panier,
  // on ne conclut pas « visite → caisse » : ce raccourci imputerait au tunnel
  // ce qui peut venir de la fiche produit.
  const troue = locateLeak({
    sessions: 1000,
    cartAdditions: null,
    reachedCheckout: 100,
    completedCheckout: 50,
    reachable: true,
  });
  t.check("la fuite trouvée saute la marche non mesurée", troue?.from, "caisse");
  t.check("aucune marche n'est franchie par interpolation", troue?.from === "visite", false);

  t.check(
    "un entonnoir injoignable ne localise rien",
    locateLeak({ ...richeBrut, reachable: false }),
    null,
  );
  t.check(
    "un entonnoir sans perte ne localise rien",
    locateLeak({
      sessions: 100,
      cartAdditions: 100,
      reachedCheckout: 100,
      completedCheckout: 100,
      reachable: true,
    }),
    null,
  );

  // --- 5. La règle de conversion consomme l'entonnoir ----------------------
  const ctx = (observations: Observation[]): RuleContext => ({
    observations,
    gaps: [],
    currency: "EUR",
  });
  const avecEntonnoir = ctx([
    obs({ id: "shopify.sessions_30d", value: 1000, sample: 1000 }),
    obs({ id: "shopify.sessions_with_cart_30d", value: 250, sample: 1000 }),
    obs({ id: "shopify.sessions_reached_checkout_30d", value: 120, sample: 1000 }),
    obs({ id: "shopify.sessions_completed_checkout_30d", value: 60, sample: 1000 }),
  ]);
  const constatFuite = runRules(avecEntonnoir).find((f) => f.ruleId === "conversion.leak_located");
  t.check("la règle localise la fuite", Boolean(constatFuite), true);
  t.check("le constat nomme la marche", /ajout au panier/.test(constatFuite?.title ?? ""), true);
  t.check("le constat est prouvé", constatFuite?.level, "prouve");
  t.check(
    "la cause écarte explicitement le tunnel quand la fuite est en amont",
    /tunnel de commande n'est pas en cause/.test(constatFuite?.why ?? ""),
    true,
  );
  t.check(
    "l'action est précise, pas une généralité",
    /téléphone/.test(constatFuite?.recommendation ?? ""),
    true,
  );

  // La conversion cesse d'être un axe aveugle dès que l'entonnoir est là.
  const rapport = analyse(avecEntonnoir);
  t.check(
    "la conversion devient notable",
    rapport.axes.find((a) => a.axis === "conversion")?.measured,
    true,
  );
  t.check(
    "aucun constat ne réclame un outil de mesure tiers",
    rapport.findings.some((f) => f.ruleId === "data.traffic_unmeasured"),
    false,
  );

  // Sous le volume minimal, la règle se tait : pas de fuite « localisée » sur
  // onze sessions.
  const troupeu = ctx([
    obs({ id: "shopify.sessions_30d", value: 11, sample: 11 }),
    obs({ id: "shopify.sessions_with_cart_30d", value: 0, sample: 11 }),
  ]);
  t.check(
    "aucune fuite localisée sous le volume minimal",
    runRules(troupeu).some((f) => f.ruleId === "conversion.leak_located"),
    false,
  );

  // --- 6. Le connecteur appelle bien ShopifyQL -----------------------------
  // Un module de lecture que personne n'appelle laisse le trou intact.
  const serveur = readFileSync(
    new URL("../../src/lib/connectors/shopify-observe.server.ts", import.meta.url).pathname,
    "utf8",
  );
  t.check("le connecteur interroge ShopifyQL", /shopifyqlQuery/.test(serveur), true);
  t.check("la requête passe par GraphQL", /graphql\.json/.test(serveur), true);
  t.check(
    "les observations de l'entonnoir rejoignent le rapport Shopify",
    /funnelReport\.observations/.test(serveur),
    true,
  );
  // Le trou historique doit disparaître dès que l'entonnoir le couvre, sinon le
  // rapport annoncerait à la fois la donnée et son absence.
  t.check(
    "un trou couvert par l'entonnoir est retiré",
    /gaps\.filter\([\s\S]{0,160}funnelReport\.observations\.some/.test(serveur),
    true,
  );
  // L'échec de l'entonnoir ne doit pas emporter le reste du diagnostic.
  t.check(
    "l'appel est isolé des autres lectures",
    /async function fetchFunnel/.test(serveur) && /catch \(e\)/.test(serveur),
    true,
  );
});
