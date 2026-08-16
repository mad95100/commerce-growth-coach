import {
  analysePage,
  storefrontObservations,
  type FetchedPage,
  type PageRole,
  type StorefrontRaw,
} from "@/lib/connectors/storefront";
import type { SourceReport } from "@/lib/observations";

/**
 * Scan du site public. La partie réseau, et rien d'autre.
 *
 * TOUT LE JUGEMENT EST DANS LE FICHIER PUR VOISIN. Ici on demande des pages, on
 * chronomètre, on compte des octets, et on transmet.
 *
 * LECTURE SEULE, ET STRICTEMENT. Uniquement des `GET` et des `HEAD` sur des
 * adresses publiques. Aucun panier créé, aucun formulaire envoyé, aucune
 * commande passée — un diagnostic n'écrit rien chez le marchand, et le tunnel
 * de commande reste pour cette raison hors de portée, déclaré comme tel.
 *
 * SOBRIÉTÉ. Le scan est borné : une quinzaine de requêtes au plus, avec un
 * délai d'attente court, et il s'identifie. Une boutique ne doit pas voir
 * arriver une rafale parce qu'elle a lancé un diagnostic.
 */

/** Ce que le site voit arriver. S'identifier est la moindre des politesses. */
const USER_AGENT =
  "EcomPilotAI/1.0 (+diagnostic de boutique, lecture seule; contact via l'application)";

/** Un site lent ne doit pas bloquer l'audit entier. */
const TIMEOUT_MS = 8000;

/** Liens internes vérifiés au plus. Au-delà, on épuiserait le site pour rien. */
export const MAX_LINK_CHECKS = 8;

/** Pages d'arrivée vérifiées au plus, les plus utilisées d'abord. */
export const MAX_LANDING_CHECKS = 5;

/** Pages de politique dont l'absence est un fait de confiance vérifiable. */
const POLICY_PATHS = [
  "/policies/refund-policy",
  "/policies/shipping-policy",
  "/policies/terms-of-service",
];

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Normalise l'adresse déclarée par le marchand en origine scannable.
 *
 * Les marchands saisissent « maboutique.fr », « www.maboutique.fr/ »,
 * « https://maboutique.fr/collections/all ». On ne scanne que l'origine : le
 * reste des chemins est construit ici.
 */
export function toOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    // Une adresse sans point n'est pas un domaine : on ne va pas la chercher.
    if (!url.hostname.includes(".")) return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/** Un `GET` chronométré. Son échec ne concerne que lui. */
async function getPage(
  fetcher: Fetcher,
  url: string,
  role: PageRole,
  mobile = false,
): Promise<FetchedPage> {
  const started = Date.now();
  try {
    const res = await fetcher(url, {
      headers: {
        "user-agent": mobile ? `${USER_AGENT} Mobile` : USER_AGENT,
        accept: "text/html",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const html = await res.text();
    return {
      url,
      role,
      status: res.status,
      elapsedMs: Date.now() - started,
      // La longueur en octets, pas en caractères : un site accentué compte
      // davantage qu'il n'y paraît.
      bytes: new TextEncoder().encode(html).length,
      html,
    };
  } catch (err) {
    return {
      url,
      role,
      status: null,
      elapsedMs: null,
      bytes: null,
      html: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Un `HEAD`, pour savoir si une adresse répond sans en télécharger le contenu. */
async function headStatus(fetcher: Fetcher, url: string): Promise<number | null> {
  try {
    const res = await fetcher(url, {
      method: "HEAD",
      headers: { "user-agent": USER_AGENT },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.status;
  } catch {
    return null;
  }
}

/**
 * Scanne le site public d'une boutique.
 *
 * `landingPaths` vient des commandes réelles : ce sont les adresses où des
 * ventes ont atterri. Les vérifier n'est pas une supposition — c'est constater
 * que des chemins qui ont produit du chiffre d'affaires répondent encore.
 */
export async function scanStorefront(
  storeUrl: string | null,
  landingPaths: Array<{ path: string; orders: number }> = [],
  fetcher: Fetcher = fetch,
): Promise<SourceReport> {
  const origin = toOrigin(storeUrl);
  if (!origin) {
    return {
      source: "storefront",
      observations: [],
      gaps: [
        {
          id: "storefront.url",
          label: "Adresse du site",
          source: "storefront",
          reason:
            "Aucune adresse de boutique exploitable n'est enregistrée : le site public n'a pas pu être ouvert.",
          wouldEnable:
            "Voir la page que le visiteur reçoit vraiment — vitesse, structure, confiance, cohérence avec les publicités.",
        },
      ],
      reachable: false,
      error: "Adresse de boutique absente ou invalide.",
    };
  }

  // L'accueil d'abord : c'est lui qui fournit les liens à vérifier et le
  // premier produit à ouvrir.
  const home = await getPage(fetcher, `${origin}/`, "accueil");
  const pages: FetchedPage[] = [home];

  const homeFacts = home.html ? analysePage(home.html, origin) : null;

  // Une fiche produit réelle, trouvée depuis l'accueil. À défaut, l'adresse
  // canonique du premier produit du catalogue Shopify n'est pas connue ici :
  // on prend le premier lien produit rencontré, et rien si aucun n'existe.
  const productPath = homeFacts?.internalLinks.find((link) => link.startsWith("/products/"));
  if (productPath) {
    pages.push(await getPage(fetcher, `${origin}${productPath}`, "produit"));
  }

  const collectionPath = homeFacts?.internalLinks.find((link) => link.startsWith("/collections/"));
  if (collectionPath) {
    pages.push(await getPage(fetcher, `${origin}${collectionPath}`, "collection"));
  }

  // Le panier est la dernière page publique du parcours. Au-delà commence le
  // tunnel, qu'on n'ouvre pas.
  pages.push(await getPage(fetcher, `${origin}/cart`, "panier"));

  for (const path of POLICY_PATHS) {
    const status = await headStatus(fetcher, `${origin}${path}`);
    pages.push({
      url: `${origin}${path}`,
      role: "politique",
      status,
      elapsedMs: null,
      bytes: null,
      html: null,
    });
  }

  const [robotsPage, sitemapStatus] = await Promise.all([
    getPage(fetcher, `${origin}/robots.txt`, "accueil"),
    headStatus(fetcher, `${origin}/sitemap.xml`),
  ]);

  // Liens internes : on vérifie un échantillon, pas tout le site. Une boutique
  // de dix mille pages ne doit pas recevoir dix mille requêtes parce qu'elle a
  // demandé un diagnostic.
  const candidates = (homeFacts?.internalLinks ?? [])
    .filter((link) => !link.startsWith("/cart") && !link.startsWith("/account"))
    .slice(0, MAX_LINK_CHECKS);
  const linkChecks: Array<{ url: string; status: number | null }> = [];
  for (const link of candidates) {
    linkChecks.push({ url: link, status: await headStatus(fetcher, `${origin}${link}`) });
  }

  const landingChecks: StorefrontRaw["landingChecks"] = [];
  for (const landing of landingPaths.slice(0, MAX_LANDING_CHECKS)) {
    landingChecks.push({
      path: landing.path,
      orders: landing.orders,
      status: await headStatus(fetcher, `${origin}${landing.path}`),
    });
  }

  const { observations, gaps } = storefrontObservations({
    origin,
    // `robots.txt` n'est pas une page du parcours : il ne doit pas peser dans
    // les temps de réponse ni dans les poids de document.
    pages,
    robots: robotsPage.status === 200 ? robotsPage.html : null,
    sitemapFound: sitemapStatus != null && sitemapStatus < 400,
    linkChecks,
    landingChecks,
  });

  // Le site a-t-il répondu au moins une fois ? Sinon on le dit, sans produire
  // le moindre zéro qui se lirait comme une mesure.
  const reachable = pages.some((p) => p.status != null && p.status < 400);
  return {
    source: "storefront",
    observations,
    gaps,
    reachable,
    error: reachable ? null : "Le site public n'a répondu sur aucune de ses adresses.",
  };
}
