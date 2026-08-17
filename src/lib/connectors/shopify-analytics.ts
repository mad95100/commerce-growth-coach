/**
 * L'ENTONNOIR RÉEL, LU CHEZ SHOPIFY.
 *
 * POURQUOI CE MODULE EXISTE. Le connecteur Shopify déclarait le trafic
 * définitivement hors de portée : « l'API Admin n'expose pas le trafic ».
 * C'était faux, et cette erreur coûtait cher. Shopify expose les sessions, les
 * ajouts au panier et les passages en caisse par ShopifyQL, interrogeable
 * depuis l'API Admin GraphQL avec la permission `read_analytics` — que l'app
 * demande DÉJÀ et que les boutiques connectées ont DÉJÀ accordée.
 *
 * Conséquence de l'erreur : le moteur déclarait « Conversion : non mesuré » et
 * invitait le marchand à brancher un outil de mesure tiers pour une donnée que
 * sa propre boutique possédait. C'est le pire conseil qu'un audit puisse
 * donner — il fait payer au marchand le prix de notre méconnaissance.
 *
 * CE QUE CELA DÉBLOQUE. L'entonnoir cesse d'être troué :
 *   sessions → ajouts au panier → passages en caisse → commandes
 * Les trois taux de passage deviennent calculables, donc la fuite devient
 * LOCALISABLE. Sans cela, un audit ne peut que constater « ça ne convertit
 * pas » — exactement la phrase creuse qu'un consultant ne prononce jamais.
 *
 * Module PUR : la requête est construite ici, elle est émise ailleurs.
 */

import { observe, type Observation, type ObservationGap } from "@/lib/observations";

/** Fenêtre d'analyse, alignée sur celle du reste du connecteur Shopify. */
export const ANALYTICS_WINDOW_DAYS = 30;

/**
 * En dessous, aucun taux n'est publié.
 *
 * Un taux de conversion sur douze sessions n'est pas une mesure imprécise :
 * c'est une mesure qui n'existe pas. Une seule commande la ferait passer de
 * 0 % à 8 %.
 */
export const MIN_SESSIONS_FOR_RATE = 100;

/**
 * La requête ShopifyQL.
 *
 * Un seul appel rapporte les quatre étages de l'entonnoir. Les noms de colonnes
 * sont ceux du jeu de données `sessions` de Shopify ; les changer casserait la
 * lecture en silence, d'où leur présence unique ici.
 */
export function funnelQuery(windowDays: number = ANALYTICS_WINDOW_DAYS): string {
  return (
    "FROM sessions " +
    "SHOW sessions, sessions_with_cart_additions, sessions_that_reached_checkout, " +
    "sessions_that_completed_checkout " +
    `SINCE -${windowDays}d UNTIL today`
  );
}

/** Ce que ShopifyQL rend, une fois la réponse GraphQL dépliée. */
export type FunnelRaw = {
  sessions: number | null;
  cartAdditions: number | null;
  reachedCheckout: number | null;
  completedCheckout: number | null;
  /** L'appel a-t-il abouti ? `false` = permission refusée, ou API en erreur. */
  reachable: boolean;
  /** Message technique, jamais montré tel quel au marchand. */
  error?: string | null;
};

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Déplie la réponse de `shopifyqlQuery`.
 *
 * ShopifyQL rend un tableau de colonnes et un tableau de lignes, pas un objet :
 * la position d'une colonne n'est pas garantie, on la retrouve par son nom. Une
 * colonne absente reste `null` — jamais zéro, qui se lirait comme « personne
 * n'est venu » alors que la vérité est « on n'a pas su lire ».
 */
export function parseFunnel(payload: unknown): FunnelRaw {
  const vide: FunnelRaw = {
    sessions: null,
    cartAdditions: null,
    reachedCheckout: null,
    completedCheckout: null,
    reachable: false,
  };
  if (!payload || typeof payload !== "object") return vide;

  const table = payload as {
    tableData?: {
      columns?: Array<{ name?: string; dataType?: string }>;
      rowData?: unknown[][];
    };
    parseErrors?: Array<{ message?: string }>;
  };

  const erreur = table.parseErrors?.[0]?.message;
  if (erreur) return { ...vide, error: erreur };

  const columns = table.tableData?.columns ?? [];
  const row = table.tableData?.rowData?.[0];
  if (!Array.isArray(row)) return vide;

  const at = (name: string): number | null => {
    const index = columns.findIndex((c) => c?.name === name);
    return index >= 0 ? toNumber(row[index]) : null;
  };

  return {
    sessions: at("sessions"),
    cartAdditions: at("sessions_with_cart_additions"),
    reachedCheckout: at("sessions_that_reached_checkout"),
    completedCheckout: at("sessions_that_completed_checkout"),
    reachable: true,
  };
}

/** Un taux de passage, ou rien. Jamais une division par zéro déguisée. */
function rate(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null) return null;
  if (denominator <= 0) return null;
  const value = numerator / denominator;
  if (!Number.isFinite(value) || value < 0 || value > 1) return null;
  return value;
}

/**
 * Les observations de l'entonnoir.
 *
 * DEUX RÈGLES, ET ELLES SONT LA RAISON D'ÊTRE DE CETTE FONCTION.
 *
 * Un compte à zéro EST une mesure : zéro session sur trente jours est un fait,
 * et un fait important. Il est donc publié.
 *
 * Un TAUX, lui, n'est publié que si le dénominateur porte assez de volume. En
 * dessous, il ne mesure rien et il serait pourtant lu comme une note. C'est la
 * distinction qui manque à la plupart des tableaux de bord.
 */
export function funnelObservations(raw: FunnelRaw): {
  observations: Observation[];
  gaps: ObservationGap[];
} {
  const observations: Observation[] = [];
  const gaps: ObservationGap[] = [];

  if (!raw.reachable) {
    gaps.push({
      id: "shopify.sessions_30d",
      label: "Sessions et entonnoir",
      source: "shopify",
      reason:
        raw.error && /access|permission|scope/i.test(raw.error)
          ? "La permission d'analyse n'a pas été accordée à l'application : le trafic reste illisible."
          : "Les statistiques de trafic de la boutique n'ont pas pu être lues.",
      wouldEnable:
        "Localiser la fuite : combien de visiteurs arrivent, combien ajoutent au panier, combien entrent en caisse, combien paient.",
    });
    return { observations, gaps };
  }

  const window = ANALYTICS_WINDOW_DAYS;
  const push = (
    id: string,
    label: string,
    value: number | null,
    evidence: string,
    sample: number | null,
    unit: "count" | "percent" = "count",
    domain: "conversion" | "boutique" = "conversion",
  ) => {
    if (value === null) return;
    observations.push(
      observe({
        id,
        source: "shopify",
        domain,
        label,
        value,
        unit,
        periodDays: window,
        evidence,
        sample,
      }),
    );
  };

  push(
    "shopify.sessions_30d",
    "Sessions",
    raw.sessions,
    `${raw.sessions} sessions sur ${window} jours (Shopify, ShopifyQL FROM sessions)`,
    raw.sessions,
  );
  push(
    "shopify.sessions_with_cart_30d",
    "Sessions avec ajout au panier",
    raw.cartAdditions,
    `${raw.cartAdditions} sessions avec au moins un ajout au panier sur ${window} jours (Shopify, ShopifyQL)`,
    raw.sessions,
  );
  push(
    "shopify.sessions_reached_checkout_30d",
    "Sessions entrées en caisse",
    raw.reachedCheckout,
    `${raw.reachedCheckout} sessions ayant atteint le paiement sur ${window} jours (Shopify, ShopifyQL)`,
    raw.sessions,
  );
  push(
    "shopify.sessions_completed_checkout_30d",
    "Sessions ayant payé",
    raw.completedCheckout,
    `${raw.completedCheckout} sessions ayant terminé le paiement sur ${window} jours (Shopify, ShopifyQL)`,
    raw.sessions,
  );

  // --- Les taux de passage -------------------------------------------------
  // Publiés seulement au-dessus du volume minimal. En dessous, le trou est
  // nommé : c'est plus utile qu'un chiffre qui ne veut rien dire.
  const assezDeVolume = (raw.sessions ?? 0) >= MIN_SESSIONS_FOR_RATE;

  if (assezDeVolume) {
    const paires: Array<[string, string, number | null, number | null, string]> = [
      [
        "shopify.rate_session_to_cart",
        "Passage visite → panier",
        raw.cartAdditions,
        raw.sessions,
        "sessions avec ajout au panier rapportées aux sessions",
      ],
      [
        "shopify.rate_cart_to_checkout",
        "Passage panier → caisse",
        raw.reachedCheckout,
        raw.cartAdditions,
        "sessions entrées en caisse rapportées aux sessions avec panier",
      ],
      [
        "shopify.rate_checkout_to_order",
        "Passage caisse → paiement",
        raw.completedCheckout,
        raw.reachedCheckout,
        "sessions ayant payé rapportées aux sessions entrées en caisse",
      ],
      [
        "shopify.conversion_rate",
        "Taux de conversion",
        raw.completedCheckout,
        raw.sessions,
        "sessions ayant payé rapportées à toutes les sessions",
      ],
    ];
    for (const [id, label, num, den, comment] of paires) {
      const value = rate(num, den);
      if (value === null) continue;
      push(
        id,
        label,
        value,
        `${Math.round(value * 1000) / 10} % — ${comment}, sur ${window} jours (Shopify, ShopifyQL)`,
        den,
        "percent",
      );
    }
  } else if (raw.sessions !== null) {
    gaps.push({
      id: "shopify.conversion_rate",
      label: "Taux de conversion",
      source: "shopify",
      reason: `${raw.sessions} sessions sur ${window} jours : en dessous de ${MIN_SESSIONS_FOR_RATE}, un taux de conversion n'est pas une mesure — une seule commande le ferait varier de plusieurs points.`,
      wouldEnable:
        "Comparer la boutique à elle-même dans le temps, et situer la fuite à une marche précise de l'entonnoir.",
    });
  }

  return { observations, gaps };
}

// ---------------------------------------------------------------------------
// Localisation de la fuite
// ---------------------------------------------------------------------------

export const FUNNEL_STEPS = ["visite", "panier", "caisse", "paiement"] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export type FunnelLeak = {
  /** Marche d'où le volume disparaît. */
  from: FunnelStep;
  to: FunnelStep;
  /** Part des visiteurs perdus à cette marche, sur ceux qui l'ont atteinte. */
  lossRate: number;
  /** Nombre de sessions perdues à cette marche. */
  lost: number;
  evidence: string;
};

/**
 * Où le volume disparaît réellement.
 *
 * CE QUE CETTE FONCTION REFUSE DE FAIRE. Elle ne cherche jamais la fuite AU
 * TRAVERS d'une marche non mesurée. Si les ajouts au panier sont inconnus, elle
 * ne compare pas les sessions aux commandes pour conclure « la conversion est
 * mauvaise » : ce raccourci impute au checkout ce qui peut venir de la fiche
 * produit, et c'est ainsi qu'un audit envoie un marchand refaire son tunnel
 * quand son problème est une photo manquante.
 *
 * Elle rend la marche où la PERTE ABSOLUE est la plus grande — pas le taux le
 * plus bas. Perdre 80 % de dix personnes n'est pas un problème ; perdre 40 % de
 * mille en est un.
 */
export function locateLeak(raw: FunnelRaw): FunnelLeak | null {
  if (!raw.reachable) return null;

  const marches: Array<[FunnelStep, FunnelStep, number | null, number | null]> = [
    ["visite", "panier", raw.sessions, raw.cartAdditions],
    ["panier", "caisse", raw.cartAdditions, raw.reachedCheckout],
    ["caisse", "paiement", raw.reachedCheckout, raw.completedCheckout],
  ];

  let pire: FunnelLeak | null = null;
  for (const [from, to, amont, aval] of marches) {
    // Les deux bouts doivent être mesurés. Une marche à trou est sautée, jamais
    // franchie par interpolation.
    if (amont === null || aval === null) continue;
    if (amont <= 0) continue;
    const lost = amont - aval;
    if (lost <= 0) continue;
    const lossRate = lost / amont;
    if (!Number.isFinite(lossRate) || lossRate < 0 || lossRate > 1) continue;
    const candidat: FunnelLeak = {
      from,
      to,
      lossRate,
      lost,
      evidence: `${lost} sessions perdues entre « ${from} » et « ${to} » (${amont} → ${aval}), soit ${Math.round(lossRate * 100)} % (Shopify, ShopifyQL)`,
    };
    if (!pire || candidat.lost > pire.lost) pire = candidat;
  }
  return pire;
}
