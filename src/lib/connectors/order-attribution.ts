/**
 * D'OÙ VIENNENT LES COMMANDES — lu sur les commandes elles-mêmes.
 *
 * POURQUOI CE MODULE, ET POURQUOI MAINTENANT. Le moteur sait ce que Meta et
 * Google DISENT avoir apporté. Il ne savait pas ce qui est réellement arrivé.
 * Or les deux régies attribuent chacune de leur côté, avec des fenêtres qui se
 * chevauchent : additionner leurs achats donne régulièrement plus de commandes
 * que la boutique n'en a enregistré. Sans point de comparaison, impossible de
 * dire laquelle exagère, ni de combien.
 *
 * Chaque commande Shopify porte le site référent et la page d'atterrissage de
 * la session qui l'a produite. C'est une trace du côté du MARCHAND, indépendante
 * des régies — et elle répond à la question qui décide de tout un budget : quelle
 * part de mes ventes ne doit rien au payant ?
 *
 * AUCUNE PERMISSION NOUVELLE. `read_orders` est déjà accordé, et
 * `referring_site` / `landing_site` / `source_name` font partie de la ressource
 * commande. Rien à redemander au marchand.
 *
 * LA LIMITE, ET ELLE EST SÉRIEUSE. Le référent est vide bien plus souvent qu'on
 * ne le croit : navigateurs intégrés aux applications, politiques de référent
 * restrictives, applications mobiles, liens copiés-collés. Une part « directe »
 * élevée n'est donc PAS une preuve de trafic direct — c'est, le plus souvent,
 * une absence de trace. Ce module mesure donc d'abord sa propre couverture, et
 * le moteur a l'interdiction de conclure quand elle est faible. C'est la seule
 * façon honnête d'utiliser cette donnée.
 *
 * Module PUR.
 */

import { observe, type Observation, type ObservationGap } from "@/lib/observations";

/** Fenêtre alignée sur celle des commandes Shopify. */
export const ATTRIBUTION_WINDOW_DAYS = 30;

/**
 * Couverture minimale sous laquelle aucune répartition n'est publiée.
 *
 * En dessous, la majorité des commandes est sans trace : les parts calculées
 * décriraient la minorité qui en a une, et se liraient comme la répartition de
 * l'ensemble. C'est exactement le genre de chiffre qui oriente un budget entier
 * dans la mauvaise direction.
 */
export const MIN_ATTRIBUTION_COVERAGE_PCT = 40;

/** Commandes minimales sous lesquelles une part en pourcentage ne dit rien. */
export const MIN_ORDERS_FOR_SHARES = 20;

export type AttributedOrder = {
  /** Site référent de la session, tel que Shopify l'a enregistré. */
  referring_site?: string | null;
  /** Page d'atterrissage, avec ses paramètres de campagne s'il y en a. */
  landing_site?: string | null;
  /** Canal de création : `web`, `pos`, nom d'application… */
  source_name?: string | null;
  total_price?: string | number | null;
};

export const ORIGINS = ["payant", "recherche", "social", "referent", "direct", "inconnu"] as const;
export type Origin = (typeof ORIGINS)[number];

export const ORIGIN_LABELS: Record<Origin, string> = {
  payant: "Publicité payante",
  recherche: "Recherche naturelle",
  social: "Réseaux sociaux",
  referent: "Site référent",
  direct: "Direct ou sans trace",
  inconnu: "Non attribuable",
};

/**
 * Marqueurs de clic publicitaire posés par les régies sur la page d'arrivée.
 *
 * Leur PRÉSENCE est une preuve : ces paramètres ne s'ajoutent pas tout seuls.
 * Leur absence n'en est pas une — un lien partagé perd ses paramètres.
 */
const PAID_MARKERS = [
  "gclid=",
  "gbraid=",
  "wbraid=",
  "fbclid=",
  "ttclid=",
  "msclkid=",
  "utm_medium=cpc",
  "utm_medium=ppc",
  "utm_medium=paid",
  "utm_medium=paidsocial",
  "utm_medium=paid_social",
];

const SEARCH_HOSTS = [
  "google.",
  "bing.",
  "yahoo.",
  "duckduckgo.",
  "ecosia.",
  "qwant.",
  "baidu.",
  "yandex.",
  "search.brave.",
];

const SOCIAL_HOSTS = [
  "facebook.",
  "instagram.",
  "tiktok.",
  "pinterest.",
  "twitter.",
  "x.com",
  "snapchat.",
  "youtube.",
  "linkedin.",
  "reddit.",
  "t.co",
  "l.facebook.",
  "lm.facebook.",
];

/** Canaux de création qui ne sont pas du commerce en ligne. */
const OFFLINE_SOURCES = ["pos", "shopify_draft_order", "draft_order", "iphone", "android"];

function host(url: string): string {
  // Les référents Shopify sont des URL absolues, mais pas toujours : on
  // travaille sur la chaîne brute plutôt que d'échouer sur un format inattendu.
  const withoutScheme = url.replace(/^[a-z]+:\/\//i, "");
  return withoutScheme.split("/")[0]?.toLowerCase() ?? "";
}

export function isOfflineOrder(order: AttributedOrder): boolean {
  const source = (order.source_name ?? "").trim().toLowerCase();
  if (!source) return false;
  return OFFLINE_SOURCES.includes(source);
}

/**
 * D'où vient cette commande ?
 *
 * L'ordre de lecture n'est pas arbitraire : un marqueur publicitaire l'emporte
 * sur le référent, parce qu'un clic payant depuis Google arrive avec
 * `google.com` en référent et se compterait sinon en recherche naturelle —
 * l'erreur exacte qui ferait couper le budget qui marche.
 */
export function classifyOrigin(order: AttributedOrder): Origin {
  const landing = (order.landing_site ?? "").toLowerCase();
  if (PAID_MARKERS.some((marker) => landing.includes(marker))) return "payant";

  const referring = (order.referring_site ?? "").trim();
  if (!referring) {
    // Sans référent ET sans le moindre paramètre de campagne, la session est
    // arrivée sans trace. « Direct » est le nom qu'on lui donne, pas une preuve
    // que le visiteur a tapé l'adresse.
    return landing.includes("utm_") ? "inconnu" : "direct";
  }

  const h = host(referring);
  if (!h) return "inconnu";
  if (SEARCH_HOSTS.some((s) => h.includes(s))) return "recherche";
  if (SOCIAL_HOSTS.some((s) => h.includes(s))) return "social";
  return "referent";
}

export type AttributionBreakdown = {
  /** Commandes en ligne retenues, hors point de vente et brouillons. */
  online: number;
  /** Commandes écartées parce qu'elles ne viennent pas du web. */
  offline: number;
  /** Répartition par origine. */
  counts: Record<Origin, number>;
  /** Chiffre d'affaires par origine, dans la devise de la boutique. */
  revenue: Record<Origin, number>;
  /**
   * Part des commandes dont l'origine porte une trace exploitable, en
   * pourcentage. « direct » n'en fait PAS partie : c'est une absence de trace.
   */
  coveragePct: number;
};

function money(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function breakdownOrders(orders: AttributedOrder[]): AttributionBreakdown {
  const counts = Object.fromEntries(ORIGINS.map((o) => [o, 0])) as Record<Origin, number>;
  const revenue = Object.fromEntries(ORIGINS.map((o) => [o, 0])) as Record<Origin, number>;
  let offline = 0;

  for (const order of orders) {
    if (isOfflineOrder(order)) {
      offline += 1;
      continue;
    }
    const origin = classifyOrigin(order);
    counts[origin] += 1;
    revenue[origin] += money(order.total_price);
  }

  const online = ORIGINS.reduce((sum, o) => sum + counts[o], 0);
  // Ce qui porte une trace : tout sauf le direct et le non attribuable.
  const traced = counts.payant + counts.recherche + counts.social + counts.referent;

  return {
    online,
    offline,
    counts,
    revenue,
    coveragePct: online > 0 ? (traced / online) * 100 : 0,
  };
}

/**
 * Observations du canal organique, tirées de l'attribution des commandes.
 *
 * Rien n'est publié tant que la couverture est faible ou l'échantillon mince :
 * l'absence est alors déclarée comme un manque nommé, avec sa raison.
 */
export function attributionObservations(input: {
  orders: AttributedOrder[];
  currency: string | null;
}): { observations: Observation[]; gaps: ObservationGap[] } {
  const observations: Observation[] = [];
  const gaps: ObservationGap[] = [];
  const b = breakdownOrders(input.orders);

  if (b.online < MIN_ORDERS_FOR_SHARES) {
    gaps.push({
      id: "organic.order_origin",
      label: "Origine des commandes",
      source: "organic",
      reason: `${b.online} commande(s) en ligne sur ${ATTRIBUTION_WINDOW_DAYS} jours : trop peu pour qu'une répartition en pourcentage veuille dire quelque chose (il en faut au moins ${MIN_ORDERS_FOR_SHARES}).`,
      wouldEnable:
        "Savoir quelle part des ventes ne doit rien à la publicité — donc ce qui resterait si le budget s'arrêtait.",
    });
    return { observations, gaps };
  }

  // La couverture d'abord, TOUJOURS : c'est elle qui autorise ou interdit de
  // lire les parts qui suivent.
  observations.push(
    observe({
      id: "organic.attribution_coverage",
      source: "organic",
      domain: "acquisition",
      label: "Commandes dont l'origine est traçable",
      value: b.coveragePct,
      unit: "percent",
      periodDays: ATTRIBUTION_WINDOW_DAYS,
      evidence: `${Math.round((b.coveragePct * b.online) / 100)} commandes sur ${b.online} portent un référent ou un paramètre de campagne (Shopify /orders.json, champs referring_site et landing_site)`,
      sample: b.online,
    }),
  );

  if (b.coveragePct < MIN_ATTRIBUTION_COVERAGE_PCT) {
    gaps.push({
      id: "organic.order_origin",
      label: "Origine des commandes",
      source: "organic",
      reason: `Seules ${Math.round(b.coveragePct)} % des commandes portent une trace d'origine (seuil : ${MIN_ATTRIBUTION_COVERAGE_PCT} %). Les navigateurs intégrés aux applications et les politiques de référent restrictives effacent cette information : la majorité des commandes est sans trace, et une répartition calculée sur la minorité qui en a une se lirait comme celle de l'ensemble.`,
      wouldEnable: "Départager ce que les régies s'attribuent de ce qui serait arrivé sans elles.",
    });
    return { observations, gaps };
  }

  const share = (origin: Origin) => (b.counts[origin] / b.online) * 100;
  const detail = (origin: Origin) =>
    `${b.counts[origin]} commandes sur ${b.online} en ligne (Shopify /orders.json, attribution par referring_site et landing_site)`;

  for (const origin of ["payant", "recherche", "social", "referent", "direct"] as const) {
    observations.push(
      observe({
        id: `organic.${origin}_order_share`,
        source: "organic",
        domain: "acquisition",
        label: `Commandes — ${ORIGIN_LABELS[origin]}`,
        value: share(origin),
        unit: "percent",
        periodDays: ATTRIBUTION_WINDOW_DAYS,
        evidence: detail(origin),
        sample: b.online,
      }),
    );
  }

  // Ce que le marchand garderait si le budget s'arrêtait demain. C'est le
  // chiffre qui décide s'il pilote une entreprise ou un robinet publicitaire.
  const nonPaidCount = b.online - b.counts.payant;
  const nonPaidRevenue =
    b.revenue.recherche + b.revenue.social + b.revenue.referent + b.revenue.direct;
  observations.push(
    observe({
      id: "organic.non_paid_order_share",
      source: "organic",
      domain: "acquisition",
      label: "Commandes sans marqueur publicitaire",
      value: (nonPaidCount / b.online) * 100,
      unit: "percent",
      periodDays: ATTRIBUTION_WINDOW_DAYS,
      evidence: `${nonPaidCount} commandes sur ${b.online} n'arrivent avec aucun identifiant de clic publicitaire (Shopify /orders.json, landing_site)`,
      sample: b.online,
    }),
    observe({
      id: "organic.non_paid_revenue_30d",
      source: "organic",
      domain: "rentabilite",
      label: "Chiffre d'affaires sans marqueur publicitaire",
      value: nonPaidRevenue,
      unit: "currency",
      currency: input.currency,
      periodDays: ATTRIBUTION_WINDOW_DAYS,
      evidence: `Somme des ${nonPaidCount} commandes sans identifiant de clic publicitaire (Shopify /orders.json)`,
      sample: nonPaidCount,
    }),
  );

  if (b.offline > 0) {
    observations.push(
      observe({
        id: "organic.offline_orders_30d",
        source: "organic",
        domain: "acquisition",
        label: "Commandes hors ligne, exclues de la répartition",
        value: b.offline,
        unit: "count",
        periodDays: ATTRIBUTION_WINDOW_DAYS,
        evidence: `${b.offline} commandes créées hors du web (point de vente ou brouillon), écartées de l'attribution (Shopify /orders.json, champ source_name)`,
        sample: b.offline,
      }),
    );
  }

  // Le référent ne dit RIEN du contenu qui a produit la visite : ni la requête
  // tapée, ni la page positionnée. Le déclarer évite qu'un « 40 % de recherche
  // naturelle » passe pour un diagnostic de référencement.
  gaps.push({
    id: "organic.search_terms",
    label: "Requêtes et pages positionnées",
    source: "organic",
    reason:
      "Les commandes disent qu'un moteur de recherche a envoyé le visiteur, jamais sur quelle requête ni depuis quelle page. Cela demanderait la Search Console, donc une connexion et une autorisation supplémentaires du marchand.",
    wouldEnable:
      "Dire QUOI travailler en référencement : les requêtes qui rapportent, celles qu'on perd, les pages à reprendre.",
  });

  return { observations, gaps };
}
