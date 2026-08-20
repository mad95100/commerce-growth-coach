/**
 * LE SITE PUBLIC DE LA BOUTIQUE — ce qu'un visiteur reçoit réellement.
 *
 * L'ANGLE MORT QUE CE MODULE FERME. Le moteur diagnostiquait la conversion sans
 * avoir jamais regardé la boutique. Il lisait le catalogue par l'API Admin, les
 * commandes, les campagnes — et jamais la page que le visiteur ouvre. Une fiche
 * produit peut être parfaite dans l'API et inatteignable en ligne ; une page
 * d'atterrissage payante peut renvoyer une erreur ; un site peut mettre quatre
 * secondes à répondre. Rien de tout cela n'apparaissait, alors que c'est là que
 * la vente se perd.
 *
 * AUCUNE AUTORISATION À DEMANDER. Le site est public et appartient au marchand,
 * qui a lui-même connecté sa boutique. On lit ce que n'importe quel visiteur
 * lit, sans session, sans compte, sans rien écrire.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * LA RÈGLE QUI GOUVERNE TOUT CE FICHIER
 * ══════════════════════════════════════════════════════════════════════════
 * UN PROBLÈME TECHNIQUE EST UN FAIT TECHNIQUE. Il ne devient JAMAIS ici une
 * perte de chiffre d'affaires ni une cause de non-conversion. Ce module produit
 * des constats — « le serveur a répondu en 2 340 ms », « la page produit ne
 * déclare aucune donnée structurée », « trois liens internes renvoient 404 ».
 * Rien de plus.
 *
 * Le passage du fait technique à l'explication commerciale se fait AILLEURS,
 * dans `cross-source.ts`, et uniquement en croisant avec Shopify, Meta ou
 * Google — avec la preuve nommée des deux côtés. Un site lent n'explique une
 * perte que si on constate par ailleurs que le trafic arrive et n'achète pas.
 * Sans ce second constat, la lenteur reste une lenteur.
 *
 * CE QUI N'EST PAS OBSERVABLE ET NE SERA PAS INVENTÉ :
 *  - Les Core Web Vitals (LCP, CLS, INP). Ils se mesurent dans un navigateur
 *    réel, sur du trafic réel. Une requête serveur ne peut pas les approcher —
 *    et un « LCP estimé » serait précisément le chiffre inventé qu'on s'interdit.
 *  - Le rendu mobile. On lit le HTML servi, pas la page peinte. La présence
 *    d'un `viewport` est un fait ; « le site est illisible sur mobile » ne l'est
 *    pas.
 *  - Le tunnel de commande. L'observer demanderait de créer un panier et une
 *    commande sur la boutique du marchand — donc d'écrire chez lui pendant un
 *    diagnostic qui doit rester en lecture seule.
 *
 * Module PUR : aucune I/O. La partie réseau est dans le fichier voisin.
 */

import { observe, type Observation, type ObservationGap } from "@/lib/observations";
// Le compte des appels à l'action et le titre de niveau 1 sont lus par le module
// d'expérience. Les importer plutôt que de les recopier évite que deux
// détecteurs du même objet ne finissent par répondre deux choses différentes.
// Les deux modules sont purs ; il n'y a pas de cycle.
import { litLeTitrePrincipal, litLesCliquables } from "@/lib/storefront-experience";

/** Une page telle que le réseau l'a rendue. `null` partout = jamais atteinte. */
export type FetchedPage = {
  /** URL demandée. */
  url: string;
  /** Rôle de la page dans le parcours. */
  role: PageRole;
  status: number | null;
  /** Millisecondes entre la demande et la réponse complète. */
  elapsedMs: number | null;
  /** Octets de HTML reçus. Ne compte ni les images ni les scripts externes. */
  bytes: number | null;
  html: string | null;
  /** Message d'échec, quand la page n'a pas pu être lue du tout. */
  error?: string | null;
};

export const PAGE_ROLES = ["accueil", "produit", "collection", "panier", "politique"] as const;
export type PageRole = (typeof PAGE_ROLES)[number];

export type StorefrontRaw = {
  /** Origine réellement scannée, après redirections. */
  origin: string;
  pages: FetchedPage[];
  /** Contenu de `robots.txt`, `null` s'il est absent ou illisible. */
  robots: string | null;
  /** `sitemap.xml` atteint ? */
  sitemapFound: boolean;
  /** Liens internes vérifiés, avec le code obtenu. */
  linkChecks: Array<{ url: string; status: number | null }>;
  /**
   * Pages d'atterrissage réellement utilisées par les commandes, telles que
   * Shopify les a enregistrées. Croisement de fait, pas de supposition.
   */
  landingChecks: Array<{ path: string; status: number | null; orders: number }>;
  /**
   * L'accueil redemandé avec un agent mobile.
   *
   * CE QUE CELA MESURE, ET RIEN DE PLUS : le serveur sert-il un document
   * DIFFÉRENT selon l'appareil ? C'est un fait vérifiable. Le rendu, lui, ne
   * l'est pas — deux documents identiques peuvent s'afficher très
   * différemment selon le CSS, et aucune requête serveur ne le dira.
   */
  mobileHome?: FetchedPage | null;
  /**
   * D'où viennent les fiches inspectées : de la vitrine, du catalogue, ou des
   * deux.
   *
   * CE QUE CE CHAMP EMPÊCHE. Un échantillon tiré de la seule vitrine décrit ce
   * que la boutique met en avant — ses meilleures pages — et surestime donc la
   * qualité moyenne du catalogue. Un échantillon réparti sur le catalogue n'a
   * pas ce biais. Les deux produisent les mêmes chiffres et n'autorisent pas les
   * mêmes phrases : la preuve doit dire lequel a été lu.
   */
  sampleOrigin?: { vitrine: number; catalogue: number };
  /** Fiches publiées connues par l'API. `0` = catalogue non consulté. */
  catalogueKnown?: number;
};

/** Fenêtre : un scan est un instantané, pas une moyenne. */
export const STOREFRONT_WINDOW_DAYS = 0;

/**
 * Temps de réponse au-delà duquel on parle de lenteur — comme d'un FAIT de
 * temps de réponse, jamais comme d'une cause de perte.
 *
 * Deux secondes serveur ne sont pas un seuil de conversion : c'est le moment où
 * la lenteur cesse d'être discutable et devient mesurable sans ambiguïté.
 */
export const SLOW_RESPONSE_MS = 2000;

/** Poids de HTML au-delà duquel le document est objectivement lourd. */
export const HEAVY_HTML_BYTES = 500_000;

/**
 * Écart de poids au-delà duquel mobile et ordinateur reçoivent deux documents.
 *
 * Un thème renvoie rarement des octets rigoureusement identiques d'une requête
 * à l'autre — jetons de session, horodatages, blocs personnalisés. Un cinquième
 * d'écart n'est plus du bruit : c'est une autre page.
 */
export const MOBILE_DIVERGENCE_RATIO = 0.2;

// ---------------------------------------------------------------------------
// Analyse d'un document
// ---------------------------------------------------------------------------

/** Ce qu'on lit dans le HTML. Uniquement des présences et des comptes. */
export type PageFacts = {
  hasViewportMeta: boolean;
  title: string | null;
  metaDescription: string | null;
  h1Count: number;
  imageCount: number;
  /** Images sans attribut `alt`. Fait d'accessibilité et de référencement. */
  imagesWithoutAlt: number;
  /** Images sans dimensions déclarées : cause connue de décalage à l'affichage. */
  imagesWithoutDimensions: number;
  /** Scripts bloquants dans le `<head>` : ni `async`, ni `defer`, ni `module`. */
  blockingScripts: number;
  /** Types déclarés en JSON-LD : `Product`, `Organization`… */
  structuredDataTypes: string[];
  /** Formulaire d'ajout au panier présent. Fait, pas jugement de visibilité. */
  hasAddToCart: boolean;
  /** Un prix est-il exposé en donnée structurée ? */
  declaredPrice: number | null;
  declaredCurrency: string | null;
  /** Note agrégée déclarée : élément de confiance vérifiable. */
  hasAggregateRating: boolean;
  /**
   * La page mentionne-t-elle la livraison ou les frais de port ?
   *
   * PRÉSENCE, pas montant. Lire un seuil de gratuité dans du texte libre
   * produirait un chiffre faux une fois sur deux. Ce qui se vérifie, c'est que
   * le sujet est abordé avant le panier — ou qu'il ne l'est pas du tout.
   */
  mentionsShipping: boolean;
  /** Liens internes trouvés, dédoublonnés. */
  internalLinks: string[];
  /** Le document est-il servi en `noindex` ? Fait technique majeur. */
  isNoindex: boolean;
  /**
   * Fiches produit ATTEIGNABLES depuis cette page, dédoublonnées.
   *
   * Sur une page de collection, c'est le nombre de choix réellement offerts au
   * visiteur. Sur l'accueil, c'est le nombre de produits qu'il peut ouvrir sans
   * chercher. Un compte de liens n'est pas un compte de produits en catalogue —
   * l'API Admin donne le second, et les deux ensemble disent si le catalogue
   * est visible ou seulement existant.
   */
  productLinks: number;
  /** Collections atteignables depuis cette page, dédoublonnées. */
  collectionLinks: number;
  /** Un formulaire de recherche est-il exposé ? */
  hasSearchForm: boolean;
  /**
   * Des filtres de collection sont-ils exposés ?
   *
   * Shopify sert ses facettes par des paramètres `filter.` et un formulaire
   * nommé. Les deux formes se lisent dans le document servi ; leur ABSENCE au
   * delà d'un certain nombre d'articles est ce qui rend une collection
   * impraticable.
   */
  hasFacetFilters: boolean;
};

const TAG = (name: string) => new RegExp(`<${name}\\b[^>]*>`, "gi");

/**
 * Mots qui signalent que la livraison est abordée sur la page.
 *
 * Volontairement larges : on cherche à établir qu'un sujet EST traité, pas à
 * comprendre ce qui en est dit. Un faux positif laisse une page tranquille ;
 * un faux négatif annoncerait à tort qu'une boutique cache ses frais.
 */
const SHIPPING_WORDS = [
  "livraison",
  "frais de port",
  "expédition",
  "expedition",
  "shipping",
  "delivery",
];

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  if (!match) return null;
  return match[2] ?? match[3] ?? match[4] ?? null;
}

function headOf(html: string): string {
  const end = html.search(/<\/head>/i);
  return end === -1 ? html.slice(0, 50_000) : html.slice(0, end);
}

/** Décode les entités qu'on rencontre dans un titre ou une description. */
function decode(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/**
 * Blocs JSON-LD du document.
 *
 * Tolérant : un bloc invalide est ignoré, il n'emporte pas les autres. Un site
 * réel en contient régulièrement un cassé, et refuser tout le document pour
 * autant reviendrait à ne jamais rien lire.
 */
export function parseJsonLd(html: string): unknown[] {
  const blocks: unknown[] = [];
  const pattern =
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) blocks.push(...parsed);
      else blocks.push(parsed);
    } catch {
      /* bloc cassé : ignoré, jamais fatal */
    }
  }
  return blocks;
}

function collectTypes(node: unknown, into: Set<string>): void {
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  const type = record["@type"];
  if (typeof type === "string") into.add(type);
  else if (Array.isArray(type)) for (const t of type) if (typeof t === "string") into.add(t);
  // `@graph` est la forme que Shopify et la plupart des thèmes emploient.
  for (const key of ["@graph", "itemListElement", "mainEntity"]) {
    const nested = record[key];
    if (Array.isArray(nested)) for (const item of nested) collectTypes(item, into);
    else if (nested) collectTypes(nested, into);
  }
}

function findOffer(nodes: unknown[]): { price: number | null; currency: string | null } {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const record = node as Record<string, unknown>;
    const offers = record.offers;
    const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const offer = raw as Record<string, unknown>;
      const price = Number(offer.price);
      if (Number.isFinite(price)) {
        const currency = offer.priceCurrency;
        return { price, currency: typeof currency === "string" ? currency : null };
      }
    }
    const graph = record["@graph"];
    if (Array.isArray(graph)) {
      const nested = findOffer(graph);
      if (nested.price != null) return nested;
    }
  }
  return { price: null, currency: null };
}

export function analysePage(html: string, origin: string): PageFacts {
  const head = headOf(html);
  const jsonLd = parseJsonLd(html);
  const types = new Set<string>();
  for (const block of jsonLd) collectTypes(block, types);

  const imageTags = [...html.matchAll(TAG("img"))].map((m) => m[0]);
  const scriptTags = [...head.matchAll(TAG("script"))].map((m) => m[0]);

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descTag = [...head.matchAll(TAG("meta"))].find(
    (m) => (attr(m[0], "name") ?? "").toLowerCase() === "description",
  );
  const robotsTag = [...head.matchAll(TAG("meta"))].find(
    (m) => (attr(m[0], "name") ?? "").toLowerCase() === "robots",
  );

  const links = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    const href = (match[2] ?? match[3] ?? "").trim();
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
      continue;
    }
    if (href.startsWith("/")) links.add(href);
    else if (origin && href.startsWith(origin)) links.add(href.slice(origin.length) || "/");
  }

  const offer = findOffer(jsonLd);

  return {
    hasViewportMeta: [...head.matchAll(TAG("meta"))].some(
      (m) => (attr(m[0], "name") ?? "").toLowerCase() === "viewport",
    ),
    title: titleMatch ? decode(titleMatch[1]) || null : null,
    metaDescription: descTag ? decode(attr(descTag[0], "content") ?? "") || null : null,
    h1Count: (html.match(/<h1\b/gi) ?? []).length,
    imageCount: imageTags.length,
    imagesWithoutAlt: imageTags.filter((tag) => attr(tag, "alt") === null).length,
    imagesWithoutDimensions: imageTags.filter(
      (tag) => attr(tag, "width") === null || attr(tag, "height") === null,
    ).length,
    blockingScripts: scriptTags.filter(
      (tag) =>
        attr(tag, "src") !== null &&
        !/\basync\b/i.test(tag) &&
        !/\bdefer\b/i.test(tag) &&
        (attr(tag, "type") ?? "").toLowerCase() !== "module",
    ).length,
    structuredDataTypes: [...types].sort(),
    // Shopify sert l'ajout au panier par un formulaire vers `/cart/add`, ou un
    // bouton nommé `add`. Les deux formes existent selon le thème.
    hasAddToCart: /\/cart\/add/i.test(html) || /name\s*=\s*["']add["']/i.test(html),
    declaredPrice: offer.price,
    declaredCurrency: offer.currency,
    hasAggregateRating: types.has("AggregateRating") || /"aggregateRating"/i.test(html),
    mentionsShipping: SHIPPING_WORDS.some((word) => html.toLowerCase().includes(word)),
    internalLinks: [...links],
    isNoindex: /noindex/i.test(attr(robotsTag?.[0] ?? "", "content") ?? ""),
    // Dédoublonnage par la fiche, pas par l'URL : `/products/x` et
    // `/products/x?variant=42` mènent au même produit, et les compter deux fois
    // gonflerait artificiellement la richesse d'une collection.
    productLinks: new Set(
      [...links]
        .filter((l) => l.startsWith("/products/"))
        .map((l) => l.split(/[?#]/)[0].replace(/\/$/, "")),
    ).size,
    collectionLinks: new Set(
      [...links]
        .filter((l) => l.startsWith("/collections/"))
        .map((l) => l.split(/[?#]/)[0].replace(/\/$/, "")),
    ).size,
    hasSearchForm:
      /action\s*=\s*["'][^"']*\/search/i.test(html) || /name\s*=\s*["']q["']/i.test(html),
    hasFacetFilters: /filter\.[vp]\./i.test(html) || /facetfiltersform/i.test(html),
  };
}

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

function pageOf(raw: StorefrontRaw, role: PageRole): FetchedPage | undefined {
  return raw.pages.find((p) => p.role === role);
}

const isOk = (page: FetchedPage | undefined) =>
  page?.status != null && page.status >= 200 && page.status < 400 && page.html != null;

/**
 * Observations du site public.
 *
 * Toutes sont des FAITS TECHNIQUES. Aucune ne porte de gain, de perte ni de
 * taux de conversion : ce module n'a pas les données pour, et ne doit pas en
 * avoir l'air.
 */
export function storefrontObservations(raw: StorefrontRaw): {
  observations: Observation[];
  gaps: ObservationGap[];
} {
  const observations: Observation[] = [];
  const gaps: ObservationGap[] = [];
  const add = (o: Observation) => observations.push(o);

  const home = pageOf(raw, "accueil");
  const collection = pageOf(raw, "collection");
  /*
    TOUTES LES FICHES LUES, PAS LA PREMIÈRE.

    `product` reste la première : les observations de structure et les
    croisements qui parlent d'UNE page gardent exactement leur sens. Ce qui
    change, c'est que le moteur dispose désormais de l'ensemble, avec son
    dénominateur — de quoi distinguer un défaut isolé d'un défaut systématique,
    ce qu'une fiche unique ne permettait pas même en principe.
  */
  const productPages = raw.pages.filter((p) => p.role === "produit" && isOk(p) && p.html);
  const product = productPages[0] ?? pageOf(raw, "produit");

  // --- Disponibilité et temps de réponse -----------------------------------
  const reachable = raw.pages.filter((p) => isOk(p));
  const broken = raw.pages.filter((p) => p.status != null && p.status >= 400);

  if (reachable.length === 0) {
    gaps.push({
      id: "storefront.reachable",
      label: "Site public",
      source: "storefront",
      reason:
        "Aucune page du site n'a répondu correctement : adresse inconnue, site protégé par mot de passe, ou blocage automatique. Rien n'a pu être observé.",
      wouldEnable:
        "Tout ce qui concerne la page réellement servie au visiteur : vitesse, structure, confiance, cohérence avec les publicités.",
    });
    return { observations, gaps };
  }

  const timings = reachable.map((p) => p.elapsedMs).filter((ms): ms is number => ms != null);
  if (timings.length > 0) {
    const slowest = Math.max(...timings);
    add(
      observe({
        id: "storefront.response_ms",
        source: "storefront",
        domain: "conversion",
        label: "Temps de réponse le plus long",
        value: slowest,
        unit: "count",
        periodDays: STOREFRONT_WINDOW_DAYS,
        evidence: `${Math.round(slowest)} ms pour recevoir le document complet, mesuré sur ${timings.length} page(s) du site (requête serveur, sans navigateur)`,
        sample: timings.length,
      }),
    );
  }

  const weights = reachable.map((p) => p.bytes).filter((b): b is number => b != null);
  if (weights.length > 0) {
    const heaviest = Math.max(...weights);
    add(
      observe({
        id: "storefront.html_bytes",
        source: "storefront",
        domain: "conversion",
        label: "Poids du document le plus lourd",
        value: heaviest,
        unit: "count",
        periodDays: STOREFRONT_WINDOW_DAYS,
        evidence: `${Math.round(heaviest / 1024)} Ko de HTML sur la page la plus lourde (hors images, scripts et feuilles de style externes)`,
        sample: weights.length,
      }),
    );
  }

  if (broken.length > 0) {
    add(
      observe({
        id: "storefront.broken_pages",
        source: "storefront",
        domain: "conversion",
        label: "Pages du parcours en erreur",
        value: broken.length,
        unit: "count",
        periodDays: STOREFRONT_WINDOW_DAYS,
        evidence: broken
          .map((p) => `${p.url} répond ${p.status}`)
          .slice(0, 5)
          .join(" ; "),
        sample: raw.pages.length,
      }),
    );
  }

  // --- Structure du document ------------------------------------------------
  if (isOk(home) && home?.html) {
    const facts = analysePage(home.html, raw.origin);
    addStructureObservations(add, facts, "accueil", raw.origin);

    // COMMENT ON ENTRE DANS LE CATALOGUE. Le scan savait déjà ouvrir une
    // collection — il s'en servait pour choisir une page à télécharger, puis
    // jetait le compte. Or c'est le compte qui dit quelque chose : une page
    // d'accueil qui ne mène à aucune collection oblige chaque visiteur à passer
    // par le menu, et une qui n'expose aucun produit ne montre rien à acheter.
    add(
      observe({
        id: "storefront.accueil_collection_links",
        source: "storefront",
        domain: "boutique",
        label: "Collections atteignables depuis l'accueil",
        value: facts.collectionLinks,
        unit: "count",
        periodDays: STOREFRONT_WINDOW_DAYS,
        evidence: `${facts.collectionLinks} collection(s) distincte(s) et ${facts.productLinks} fiche(s) produit distincte(s) atteignables en un clic depuis ${home.url}`,
        sample: 1,
      }),
    );
    /*
      LES TROIS PIÈCES DU PARCOURS D'ENTRÉE, chacune mesurée séparément.

      Elles existaient déjà, éparpillées : le titre et les boutons dans le
      module d'expérience, qui produit ses propres constats sans passer par les
      règles ; les liens de collection ici. Aucune règle ne pouvait donc les
      RAPPROCHER — et c'est le rapprochement qui vaut quelque chose. Un titre
      court est un détail ; un titre court, aucun bouton d'action et aucune
      porte vers le catalogue, c'est une page d'accueil qui ne mène nulle part.
    */
    const titrePrincipal = litLeTitrePrincipal(home.html);
    const motsDuTitre = titrePrincipal ? titrePrincipal.split(/\s+/).filter(Boolean).length : 0;
    add(
      observe({
        id: "storefront.accueil_h1_mots",
        source: "storefront",
        domain: "boutique",
        label: "Longueur de la promesse d'accueil",
        value: motsDuTitre,
        unit: "count",
        text: titrePrincipal,
        periodDays: STOREFRONT_WINDOW_DAYS,
        evidence: titrePrincipal
          ? `Titre de niveau 1 relevé sur ${home.url} : « ${titrePrincipal} » (${motsDuTitre} mots)`
          : `Aucun titre de niveau 1 dans le document de ${home.url}`,
        sample: 1,
      }),
    );

    const { labels, ctaCount } = litLesCliquables(home.html);
    add(
      observe({
        id: "storefront.accueil_cta",
        source: "storefront",
        domain: "conversion",
        label: "Appels à l'action sur l'accueil",
        value: ctaCount,
        unit: "count",
        periodDays: STOREFRONT_WINDOW_DAYS,
        evidence:
          ctaCount > 0
            ? `${ctaCount} lien(s) ou bouton(s) portant un verbe d'action sur ${labels.length} relevés dans le document de ${home.url}`
            : `Aucun des ${labels.length} liens et boutons de ${home.url} ne porte de verbe d'achat ou de découverte`,
        sample: 1,
      }),
    );

    add(
      observe({
        id: "storefront.accueil_recherche",
        source: "storefront",
        domain: "boutique",
        label: "Recherche exposée sur l'accueil",
        value: facts.hasSearchForm ? 1 : 0,
        unit: "count",
        periodDays: STOREFRONT_WINDOW_DAYS,
        evidence: facts.hasSearchForm
          ? `Un formulaire de recherche est présent dans le document de ${home.url}`
          : `Aucun formulaire de recherche dans le document de ${home.url}`,
        sample: 1,
      }),
    );
  }

  // --- La page de collection, enfin lue -------------------------------------
  // Elle était téléchargée depuis toujours, comptée dans les temps de réponse
  // et dans les poids, puis jetée sans être analysée. C'est pourtant la page où
  // le visiteur CHOISIT : la fiche ne fait que confirmer un choix déjà fait.
  if (isOk(collection) && collection?.html) {
    const facts = analysePage(collection.html, raw.origin);
    addStructureObservations(add, facts, "collection", raw.origin);

    add(
      observe({
        id: "storefront.collection_produits_listes",
        source: "storefront",
        domain: "produit",
        label: "Produits listés sur la collection inspectée",
        value: facts.productLinks,
        unit: "count",
        periodDays: STOREFRONT_WINDOW_DAYS,
        evidence: `${facts.productLinks} fiche(s) produit distincte(s) listée(s) sur ${collection.url}`,
        sample: 1,
      }),
    );
    add(
      observe({
        id: "storefront.collection_filtres",
        source: "storefront",
        domain: "produit",
        label: "Filtres sur la collection inspectée",
        value: facts.hasFacetFilters ? 1 : 0,
        unit: "count",
        periodDays: STOREFRONT_WINDOW_DAYS,
        evidence: facts.hasFacetFilters
          ? `Des filtres de collection sont exposés sur ${collection.url}`
          : `Aucun filtre de collection exposé sur ${collection.url} (${facts.productLinks} produit(s) listé(s))`,
        sample: 1,
      }),
    );
  }
  if (isOk(product) && product?.html) {
    const facts = analysePage(product.html, raw.origin);
    addStructureObservations(add, facts, "produit", raw.origin);

    add(
      observe({
        id: "storefront.product_add_to_cart",
        source: "storefront",
        domain: "conversion",
        label: "Ajout au panier présent sur la fiche produit",
        value: facts.hasAddToCart ? 1 : 0,
        unit: "count",
        periodDays: STOREFRONT_WINDOW_DAYS,
        evidence: facts.hasAddToCart
          ? `Un formulaire d'ajout au panier est présent dans le HTML de ${product.url}`
          : `Aucun formulaire d'ajout au panier trouvé dans le HTML de ${product.url}`,
        sample: 1,
      }),
    );
    add(
      observe({
        id: "storefront.product_structured_data",
        source: "storefront",
        domain: "produit",
        label: "Données structurées produit déclarées",
        value: facts.structuredDataTypes.includes("Product") ? 1 : 0,
        unit: "count",
        periodDays: STOREFRONT_WINDOW_DAYS,
        evidence: facts.structuredDataTypes.length
          ? `Types déclarés en JSON-LD sur ${product.url} : ${facts.structuredDataTypes.join(", ")}`
          : `Aucune donnée structurée JSON-LD sur ${product.url}`,
        sample: 1,
      }),
    );
    add(
      observe({
        id: "storefront.product_shipping_mentioned",
        source: "storefront",
        domain: "conversion",
        label: "Livraison évoquée sur la fiche produit",
        value: facts.mentionsShipping ? 1 : 0,
        unit: "count",
        periodDays: STOREFRONT_WINDOW_DAYS,
        evidence: facts.mentionsShipping
          ? `La fiche ${product.url} évoque la livraison ou les frais de port`
          : `La fiche ${product.url} ne mentionne ni livraison ni frais de port : l'acheteur les découvre plus loin dans le parcours`,
        sample: 1,
      }),
    );
    add(
      observe({
        id: "storefront.product_reviews_declared",
        source: "storefront",
        domain: "boutique",
        label: "Note client déclarée sur la fiche produit",
        value: facts.hasAggregateRating ? 1 : 0,
        unit: "count",
        periodDays: STOREFRONT_WINDOW_DAYS,
        evidence: facts.hasAggregateRating
          ? `Une note agrégée est déclarée sur ${product.url}`
          : `Aucune note client n'apparaît sur ${product.url}`,
        sample: 1,
      }),
    );

    if (facts.declaredPrice != null) {
      add(
        observe({
          id: "storefront.product_price",
          source: "storefront",
          domain: "offre",
          label: "Prix affiché sur la fiche produit",
          value: facts.declaredPrice,
          unit: "currency",
          currency: facts.declaredCurrency,
          periodDays: STOREFRONT_WINDOW_DAYS,
          evidence:
            `Prix déclaré en donnée structurée sur ${product.url} : ${facts.declaredPrice} ${facts.declaredCurrency ?? ""}`.trim(),
          sample: 1,
        }),
      );
    }
  } else {
    gaps.push({
      id: "storefront.product_page",
      label: "Fiche produit publique",
      source: "storefront",
      reason:
        "Aucune fiche produit n'a pu être lue en ligne : catalogue vide, produits non publiés, ou site protégé.",
      wouldEnable:
        "Vérifier que la page que le visiteur ouvre porte bien un prix, un ajout au panier et de quoi décider.",
    });
  }

  /*
    L'ÉCHANTILLON, ET SON DÉNOMINATEUR.

    CE QUE CE BLOC EMPÊCHE. Jusqu'ici, une seule fiche était lue et les constats
    parlaient du catalogue : « les fiches produit n'ont pas de description ».
    Une boutique dont la fiche mise en avant est soignée passait pour
    irréprochable, une boutique dont la première fiche est un brouillon oublié
    était condamnée sur cet unique exemplaire, et personne ne pouvait faire la
    différence entre les deux en lisant le rapport.

    Chaque observation ci-dessous porte donc DEUX nombres : combien de fiches
    présentent le défaut, et combien ont été inspectées. Le second n'est pas un
    détail de méthode — c'est lui qui autorise ou interdit de généraliser, et
    les règles s'en servent pour choisir entre « sur la seule fiche inspectée »,
    « sur k des n inspectées » et « sur les n inspectées, toutes ».

    AUCUN CONSTAT NE PARLE DU CATALOGUE. Cinq fiches sur trois cents restent
    cinq fiches ; le dénombrement le dit, et les règles ne l'oublient pas.
  */
  if (productPages.length > 0) {
    const echantillon = productPages.map((p) => ({
      page: p,
      facts: analysePage(p.html!, raw.origin),
    }));
    const n = echantillon.length;
    const adresses = echantillon.map((e) => e.page.url).join(", ");
    /*
      LA PROVENANCE ENTRE DANS LA PREUVE, et ce n'est pas un détail de méthode.

      « 5 fiches inspectées » ne dit pas la même chose selon qu'elles viennent
      de la page d'accueil — donc des fiches que le marchand a choisi de mettre
      en avant — ou d'un balayage régulier du catalogue. Le premier échantillon
      surestime la qualité moyenne par construction. Un lecteur qui ne peut pas
      faire la différence lit le second alors qu'on lui montre le premier.
    */
    const o = raw.sampleOrigin;
    const provenance = (() => {
      if (!o || (o.vitrine === 0 && o.catalogue === 0)) {
        return "provenance de l'échantillon non renseignée";
      }
      if (o.catalogue === 0) {
        return `toutes issues du parcours visible (accueil et collection), le catalogue complet n'ayant pas été consulté — un tel échantillon montre ce que la boutique met en avant, pas sa moyenne`;
      }
      if (o.vitrine === 0) {
        return `réparties à pas régulier sur les ${raw.catalogueKnown ?? "?"} fiches publiées du catalogue`;
      }
      return `${o.vitrine} issues du parcours visible et ${o.catalogue} réparties à pas régulier sur les ${raw.catalogueKnown ?? "?"} fiches publiées du catalogue`;
    })();

    add(
      observe({
        id: "storefront.produits_inspectes",
        source: "storefront",
        domain: "produit",
        label: "Fiches produit inspectées",
        value: n,
        unit: "count",
        periodDays: STOREFRONT_WINDOW_DAYS,
        evidence: `${n} fiche(s) produit ouverte(s) pendant le diagnostic — ${provenance} : ${adresses}`,
        sample: n,
      }),
    );

    const compte = (
      id: string,
      domain: "conversion" | "produit" | "boutique" | "offre",
      label: string,
      manque: (f: PageFacts) => boolean,
      quoi: string,
    ) => {
      const touchees = echantillon.filter((e) => manque(e.facts));
      add(
        observe({
          id,
          source: "storefront",
          domain,
          label,
          value: touchees.length,
          unit: "count",
          periodDays: STOREFRONT_WINDOW_DAYS,
          evidence:
            touchees.length === 0
              ? `Aucune des ${n} fiche(s) inspectée(s) ne présente ce manque : ${quoi}`
              : `${touchees.length} des ${n} fiche(s) inspectée(s) ${quoi} — ${touchees.map((e) => e.page.url).join(", ")}`,
          sample: n,
        }),
      );
    };

    compte(
      "storefront.produits_sans_ajout_panier",
      "conversion",
      "Fiches sans formulaire d'ajout au panier",
      (f) => !f.hasAddToCart,
      "ne contiennent aucun formulaire d'ajout au panier dans le document servi",
    );
    compte(
      "storefront.produits_sans_livraison",
      "conversion",
      "Fiches n'évoquant pas la livraison",
      (f) => !f.mentionsShipping,
      "n'évoquent ni livraison ni frais de port",
    );
    compte(
      "storefront.produits_sans_avis",
      "boutique",
      "Fiches sans note client déclarée",
      (f) => !f.hasAggregateRating,
      "ne déclarent aucune note ni aucun avis",
    );
    compte(
      "storefront.produits_sans_donnees_structurees",
      "produit",
      "Fiches sans données structurées produit",
      (f) => !f.structuredDataTypes.includes("Product"),
      "ne déclarent aucune donnée structurée de type Produit",
    );
    compte(
      "storefront.produits_sans_prix",
      "offre",
      "Fiches sans prix en donnée structurée",
      (f) => f.declaredPrice == null,
      "n'exposent aucun prix en donnée structurée",
    );
  }

  // --- Confiance : pages de politique réellement servies --------------------
  const policies = raw.pages.filter((p) => p.role === "politique");
  const policiesOk = policies.filter((p) => isOk(p));
  if (policies.length > 0) {
    add(
      observe({
        id: "storefront.policy_pages",
        source: "storefront",
        domain: "boutique",
        label: "Pages de politique accessibles",
        value: policiesOk.length,
        unit: "count",
        periodDays: STOREFRONT_WINDOW_DAYS,
        evidence: `${policiesOk.length} page(s) de politique servies sur ${policies.length} vérifiées : ${policies.map((p) => `${p.url.split("/").pop()} (${p.status ?? "aucune réponse"})`).join(", ")}`,
        sample: policies.length,
      }),
    );
  }

  // --- Référencement technique ----------------------------------------------
  add(
    observe({
      id: "storefront.sitemap",
      source: "storefront",
      domain: "acquisition",
      label: "Plan du site accessible",
      value: raw.sitemapFound ? 1 : 0,
      unit: "count",
      periodDays: STOREFRONT_WINDOW_DAYS,
      evidence: raw.sitemapFound
        ? `${raw.origin}/sitemap.xml répond`
        : `${raw.origin}/sitemap.xml ne répond pas`,
      sample: 1,
    }),
  );

  if (raw.robots != null) {
    // `Disallow: /` interdit tout le site à l'indexation. C'est un fait
    // technique majeur, et il se lit sans ambiguïté.
    const blocksAll = /^\s*disallow\s*:\s*\/\s*$/im.test(raw.robots);
    add(
      observe({
        id: "storefront.robots_blocks_all",
        source: "storefront",
        domain: "acquisition",
        label: "Indexation interdite par robots.txt",
        value: blocksAll ? 1 : 0,
        unit: "count",
        periodDays: STOREFRONT_WINDOW_DAYS,
        evidence: blocksAll
          ? `${raw.origin}/robots.txt contient une directive « Disallow: / » qui interdit tout le site`
          : `${raw.origin}/robots.txt n'interdit pas l'ensemble du site`,
        sample: 1,
      }),
    );
  } else {
    gaps.push({
      id: "storefront.robots",
      label: "robots.txt",
      source: "storefront",
      reason: "Le fichier robots.txt n'a pas répondu : impossible de dire ce qu'il autorise.",
      wouldEnable: "Vérifier qu'aucune directive n'interdit l'indexation du site.",
    });
  }

  // --- Liens internes cassés -------------------------------------------------
  const checked = raw.linkChecks.filter((l) => l.status != null);
  if (checked.length > 0) {
    const dead = checked.filter((l) => (l.status ?? 0) >= 400);
    add(
      observe({
        id: "storefront.broken_links",
        source: "storefront",
        domain: "conversion",
        label: "Liens internes cassés",
        value: dead.length,
        unit: "count",
        periodDays: STOREFRONT_WINDOW_DAYS,
        evidence: dead.length
          ? `${dead.length} lien(s) sur ${checked.length} vérifiés renvoient une erreur : ${dead
              .slice(0, 5)
              .map((l) => `${l.url} (${l.status})`)
              .join(" ; ")}`
          : `Aucun lien cassé parmi les ${checked.length} liens internes vérifiés`,
        sample: checked.length,
      }),
    );
  }

  // --- Cohérence entre la publicité et la page servie -----------------------
  // Le seul croisement que ce module se permet, parce qu'il reste factuel : ces
  // adresses sont celles où des commandes ont réellement atterri.
  const landings = raw.landingChecks.filter((l) => l.status != null);
  if (landings.length > 0) {
    const dead = landings.filter((l) => (l.status ?? 0) >= 400);
    add(
      observe({
        id: "storefront.landing_pages_broken",
        source: "storefront",
        domain: "acquisition",
        label: "Pages d'arrivée en erreur",
        value: dead.length,
        unit: "count",
        periodDays: STOREFRONT_WINDOW_DAYS,
        evidence: dead.length
          ? `${dead.length} page(s) où des commandes ont atterri renvoient aujourd'hui une erreur : ${dead
              .slice(0, 5)
              .map((l) => `${l.path} (${l.status}, ${l.orders} commande(s) passées)`)
              .join(" ; ")}`
          : `Les ${landings.length} pages d'arrivée les plus utilisées répondent normalement`,
        sample: landings.length,
      }),
    );
  }

  // --- Mobile et ordinateur : le même document, ou deux ? -------------------
  // Un thème qui sert une version distincte aux mobiles est un fait, et il
  // change tout le reste du diagnostic : ce qu'on a analysé plus haut est alors
  // la version ordinateur, pas celle que la majorité des visiteurs reçoit.
  const mobile = raw.mobileHome;
  if (mobile && isOk(mobile) && isOk(home) && mobile.bytes != null && home?.bytes != null) {
    const ratio = home.bytes > 0 ? mobile.bytes / home.bytes : 1;
    const differs = Math.abs(1 - ratio) > MOBILE_DIVERGENCE_RATIO;
    add(
      observe({
        id: "storefront.mobile_document_differs",
        source: "storefront",
        domain: "conversion",
        label: "Document distinct servi aux mobiles",
        value: differs ? 1 : 0,
        unit: "count",
        periodDays: STOREFRONT_WINDOW_DAYS,
        evidence: differs
          ? `L'accueil pèse ${Math.round(home.bytes / 1024)} Ko pour un agent ordinateur et ${Math.round(mobile.bytes / 1024)} Ko pour un agent mobile : le serveur sert deux documents différents`
          : `L'accueil sert le même document aux deux agents (${Math.round(home.bytes / 1024)} Ko contre ${Math.round(mobile.bytes / 1024)} Ko)`,
        sample: 2,
      }),
    );

    if (mobile.html) {
      const mobileFacts = analysePage(mobile.html, raw.origin);
      add(
        observe({
          id: "storefront.mobile_viewport",
          source: "storefront",
          domain: "conversion",
          label: "Balise viewport servie aux mobiles",
          value: mobileFacts.hasViewportMeta ? 1 : 0,
          unit: "count",
          periodDays: STOREFRONT_WINDOW_DAYS,
          evidence: mobileFacts.hasViewportMeta
            ? "Le document servi à un agent mobile déclare une balise viewport"
            : "Le document servi à un agent mobile ne déclare AUCUNE balise viewport : les navigateurs le rendent alors à la largeur d'un écran d'ordinateur",
          sample: 1,
        }),
      );
    }
  } else if (mobile && !isOk(mobile) && isOk(home)) {
    // L'accueil répond à un agent ordinateur et pas à un agent mobile : c'est
    // un fait, et il est grave.
    add(
      observe({
        id: "storefront.mobile_unreachable",
        source: "storefront",
        domain: "conversion",
        label: "Accueil injoignable pour un agent mobile",
        value: 1,
        unit: "count",
        periodDays: STOREFRONT_WINDOW_DAYS,
        evidence: `L'accueil répond à un agent ordinateur mais renvoie ${mobile.status ?? "aucune réponse"} à un agent mobile`,
        sample: 1,
      }),
    );
  }

  // --- CE QUI NE SE MESURE PAS DEPUIS UN SERVEUR ----------------------------
  // Déclaré une fois pour toutes. Les inventer serait fabriquer exactement les
  // chiffres sur lesquels on décide.
  gaps.push(
    {
      id: "storefront.core_web_vitals",
      label: "Core Web Vitals (LCP, CLS, INP)",
      source: "storefront",
      reason:
        "Ces mesures n'existent que dans un navigateur réel, sur du trafic réel. Une requête serveur mesure un temps de réponse, jamais un temps d'affichage : les approcher produirait un chiffre inventé sur lequel personne ne devrait décider.",
      wouldEnable:
        "Dire si la lenteur ressentie vient du serveur, du thème ou des scripts tiers — et laquelle des trois corriger.",
    },
    {
      id: "storefront.mobile_rendering",
      label: "Rendu réel sur mobile",
      source: "storefront",
      reason:
        "On lit le HTML servi, pas la page peinte. La présence d'une balise `viewport` est un fait ; l'ergonomie mobile constatée demanderait de rendre la page dans un vrai navigateur.",
      wouldEnable:
        "Constater ce qu'un visiteur mobile voit vraiment : ce qui est visible sans défiler, ce qui déborde, ce qui est trop petit pour être touché.",
    },
    {
      id: "storefront.checkout_funnel",
      label: "Tunnel de commande",
      source: "storefront",
      reason:
        "L'observer demanderait de créer un panier puis une commande sur la boutique du marchand. Un diagnostic n'écrit rien chez lui : cette étape reste volontairement hors de portée.",
      wouldEnable:
        "Situer l'abandon dans le tunnel : livraison, paiement, création de compte, frais découverts trop tard.",
    },
  );

  return { observations, gaps };
}

function addStructureObservations(
  add: (o: Observation) => void,
  facts: PageFacts,
  role: PageRole,
  origin: string,
): void {
  const url = `${origin} (${role})`;

  add(
    observe({
      id: `storefront.${role}_viewport`,
      source: "storefront",
      domain: "conversion",
      label: `Balise viewport — ${role}`,
      value: facts.hasViewportMeta ? 1 : 0,
      unit: "count",
      periodDays: STOREFRONT_WINDOW_DAYS,
      evidence: facts.hasViewportMeta
        ? `La page ${url} déclare une balise viewport`
        : `La page ${url} ne déclare AUCUNE balise viewport : les navigateurs mobiles la rendent alors à la largeur d'un écran d'ordinateur`,
      sample: 1,
    }),
  );

  add(
    observe({
      id: `storefront.${role}_noindex`,
      source: "storefront",
      domain: "acquisition",
      label: `Indexation interdite — ${role}`,
      value: facts.isNoindex ? 1 : 0,
      unit: "count",
      periodDays: STOREFRONT_WINDOW_DAYS,
      evidence: facts.isNoindex
        ? `La page ${url} porte une directive « noindex » : elle demande explicitement à ne pas être référencée`
        : `La page ${url} n'interdit pas son indexation`,
      sample: 1,
    }),
  );

  add(
    observe({
      id: `storefront.${role}_meta_description`,
      source: "storefront",
      domain: "acquisition",
      label: `Description référencement — ${role}`,
      value: facts.metaDescription ? 1 : 0,
      unit: "count",
      periodDays: STOREFRONT_WINDOW_DAYS,
      evidence: facts.metaDescription
        ? `La page ${url} déclare une description de ${facts.metaDescription.length} caractères`
        : `La page ${url} ne déclare aucune description : les moteurs composent alors eux-mêmes l'extrait affiché`,
      sample: 1,
    }),
  );

  // LE TITRE DE L'ONGLET, lu depuis toujours et jamais rapporté.
  //
  // C'est la ligne bleue d'un résultat de recherche et le nom de l'onglet : la
  // seule phrase que le visiteur lit AVANT d'ouvrir la page. La citer mot pour
  // mot est aussi ce qui rend un constat reconnaissable — un lecteur du rapport
  // doit pouvoir retrouver la page dont on parle.
  add(
    observe({
      id: `storefront.${role}_title`,
      source: "storefront",
      domain: "acquisition",
      label: `Titre de la page — ${role}`,
      value: facts.title ? facts.title.length : 0,
      unit: "count",
      text: facts.title,
      periodDays: STOREFRONT_WINDOW_DAYS,
      evidence: facts.title
        ? `Titre servi par ${url} : « ${facts.title} » (${facts.title.length} caractères)`
        : `La page ${url} ne sert aucun titre : les moteurs et les onglets affichent alors l'adresse`,
      sample: 1,
    }),
  );

  add(
    observe({
      id: `storefront.${role}_blocking_scripts`,
      source: "storefront",
      domain: "conversion",
      label: `Scripts bloquants dans l'en-tête — ${role}`,
      value: facts.blockingScripts,
      unit: "count",
      periodDays: STOREFRONT_WINDOW_DAYS,
      evidence: `${facts.blockingScripts} script(s) externes chargés sans « async » ni « defer » dans le <head> de ${url} : le navigateur les attend avant d'afficher quoi que ce soit`,
      sample: 1,
    }),
  );

  if (facts.imageCount > 0) {
    add(
      observe({
        id: `storefront.${role}_images_without_dimensions`,
        source: "storefront",
        domain: "conversion",
        label: `Images sans dimensions — ${role}`,
        value: facts.imagesWithoutDimensions,
        unit: "count",
        periodDays: STOREFRONT_WINDOW_DAYS,
        evidence: `${facts.imagesWithoutDimensions} image(s) sur ${facts.imageCount} n'annoncent ni largeur ni hauteur sur ${url} : la page se réagence pendant leur chargement`,
        sample: facts.imageCount,
      }),
    );
    add(
      observe({
        id: `storefront.${role}_images_without_alt`,
        source: "storefront",
        domain: "acquisition",
        label: `Images sans texte alternatif — ${role}`,
        value: facts.imagesWithoutAlt,
        unit: "count",
        periodDays: STOREFRONT_WINDOW_DAYS,
        evidence: `${facts.imagesWithoutAlt} image(s) sur ${facts.imageCount} sans attribut « alt » sur ${url}`,
        sample: facts.imageCount,
      }),
    );
  }

  add(
    observe({
      id: `storefront.${role}_h1_count`,
      source: "storefront",
      domain: "acquisition",
      label: `Titres de niveau 1 — ${role}`,
      value: facts.h1Count,
      unit: "count",
      periodDays: STOREFRONT_WINDOW_DAYS,
      evidence: `${facts.h1Count} balise(s) <h1> sur ${url}`,
      sample: 1,
    }),
  );
}
