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
const TIMEOUT_MS = 5000;

/**
 * Budget TOTAL du scan, tout compris.
 *
 * LE DÉFAUT QUE CELA CORRIGE, et il est de ma main. Le scan enchaîne une
 * vingtaine de requêtes, très majoritairement en série. Sur une boutique lente
 * ou injoignable, chacune allait jusqu'au bout de son délai d'attente : le scan
 * pouvait à lui seul dépasser deux minutes, à l'intérieur d'une invocation
 * planifiée qui doit rendre la main. L'audit se faisait alors interrompre,
 * repartait, rescannait le même site lent, et se faisait interrompre à nouveau.
 * Autrement dit : la boucle que la relance de diagnostic vient précisément
 * d'apprendre à ne plus faire, réintroduite un cran plus bas.
 *
 * Le budget tranche cela net. Passé ce délai, le scan s'arrête là où il en est
 * et DÉCLARE ce qu'il n'a pas vérifié. C'est le point qui compte : sans cette
 * déclaration, « aucun lien cassé » signifierait « aucun lien vérifié », et se
 * lirait comme un satisfecit.
 */
export const SCAN_BUDGET_MS = 15_000;

/** Requêtes menées de front. Assez pour tenir le budget, assez peu pour être poli. */
const CONCURRENCY = 4;

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
 * Compteur de budget. Une horloge, et la question « me reste-t-il du temps ? ».
 */
function budget(startedAt: number, totalMs: number) {
  return {
    exhausted: () => Date.now() - startedAt >= totalMs,
    remaining: () => Math.max(0, totalMs - (Date.now() - startedAt)),
  };
}

/**
 * Applique `task` à chaque entrée, quelques-unes de front, et s'arrête net dès
 * que le budget est épuisé.
 *
 * Renvoie ce qui a été fait ET ce qui ne l'a pas été : le second est ce qui
 * permet de ne pas faire passer un contrôle sauté pour un contrôle réussi.
 */
async function withinBudget<T, R>(
  items: T[],
  clock: ReturnType<typeof budget>,
  task: (item: T) => Promise<R>,
): Promise<{ done: R[]; skipped: number }> {
  const done: R[] = [];
  let index = 0;

  while (index < items.length) {
    if (clock.exhausted()) return { done, skipped: items.length - index };
    const slice = items.slice(index, index + CONCURRENCY);
    done.push(...(await Promise.all(slice.map(task))));
    index += slice.length;
  }
  return { done, skipped: 0 };
}

/**
 * Scanne le site public d'une boutique.
 *
 * `landingPaths` vient des commandes réelles : ce sont les adresses où des
 * ventes ont atterri. Les vérifier n'est pas une supposition — c'est constater
 * que des chemins qui ont produit du chiffre d'affaires répondent encore.
 */
/** Le rapport du scan, augmenté du document d'accueil réellement reçu. */
export type StorefrontScan = SourceReport & { homeHtml: string | null };

export async function scanStorefront(
  storeUrl: string | null,
  landingPaths: Array<{ path: string; orders: number }> = [],
  fetcher: Fetcher = fetch,
): Promise<StorefrontScan> {
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
      homeHtml: null,
    };
  }

  const clock = budget(Date.now(), SCAN_BUDGET_MS);
  /** Ce qui a été sauté faute de temps, pour le déclarer plutôt que le taire. */
  const unchecked: string[] = [];

  // L'accueil d'abord : c'est lui qui fournit les liens à vérifier et le
  // premier produit à ouvrir. Il n'est jamais sauté — sans lui il n'y a pas de
  // scan du tout.
  const home = await getPage(fetcher, `${origin}/`, "accueil");
  const pages: FetchedPage[] = [home];

  const homeFacts = home.html ? analysePage(home.html, origin) : null;

  // Les pages du parcours, de front. Elles sont peu nombreuses et leur intérêt
  // est le même : les enchaîner en série ne servirait qu'à consommer le budget.
  const productPath = homeFacts?.internalLinks.find((link) => link.startsWith("/products/"));
  const collectionPath = homeFacts?.internalLinks.find((link) => link.startsWith("/collections/"));
  const journey: Array<{ path: string; role: PageRole }> = [
    ...(productPath ? [{ path: productPath, role: "produit" as PageRole }] : []),
    ...(collectionPath ? [{ path: collectionPath, role: "collection" as PageRole }] : []),
    // Le panier est la dernière page publique du parcours. Au-delà commence le
    // tunnel, qu'on n'ouvre pas.
    { path: "/cart", role: "panier" as PageRole },
  ];
  const journeyRun = await withinBudget(journey, clock, (step) =>
    getPage(fetcher, `${origin}${step.path}`, step.role),
  );
  pages.push(...journeyRun.done);
  if (journeyRun.skipped > 0) unchecked.push(`${journeyRun.skipped} page(s) du parcours`);

  const policyRun = await withinBudget(POLICY_PATHS, clock, async (path) => ({
    url: `${origin}${path}`,
    role: "politique" as PageRole,
    status: await headStatus(fetcher, `${origin}${path}`),
    elapsedMs: null,
    bytes: null,
    html: null,
  }));
  pages.push(...policyRun.done);
  if (policyRun.skipped > 0) unchecked.push(`${policyRun.skipped} page(s) de politique`);

  // L'accueil, redemandé avec un agent mobile. Une seule requête de plus, pour
  // la seule question qu'un serveur puisse trancher : le document servi est-il
  // le même ? Sautée si le budget est déjà épuisé — auquel cas la comparaison
  // n'a simplement pas lieu, plutôt que d'être devinée.
  const mobileHome = clock.exhausted()
    ? null
    : await getPage(fetcher, `${origin}/`, "accueil", true);
  if (mobileHome === null) unchecked.push("la version servie aux mobiles");

  const [robotsPage, sitemapStatus] = clock.exhausted()
    ? [null, null]
    : await Promise.all([
        getPage(fetcher, `${origin}/robots.txt`, "accueil"),
        headStatus(fetcher, `${origin}/sitemap.xml`),
      ]);
  if (robotsPage === null) unchecked.push("robots.txt et plan du site");

  // Liens internes : on vérifie un échantillon, pas tout le site. Une boutique
  // de dix mille pages ne doit pas recevoir dix mille requêtes parce qu'elle a
  // demandé un diagnostic.
  const candidates = (homeFacts?.internalLinks ?? [])
    .filter((link) => !link.startsWith("/cart") && !link.startsWith("/account"))
    .slice(0, MAX_LINK_CHECKS);
  const linkRun = await withinBudget(candidates, clock, async (link) => ({
    url: link,
    status: await headStatus(fetcher, `${origin}${link}`),
  }));
  const linkChecks = linkRun.done;
  if (linkRun.skipped > 0) unchecked.push(`${linkRun.skipped} lien(s) interne(s)`);

  // Les pages d'arrivée passent APRÈS les liens dans l'ordre du code, mais ce
  // sont elles qui portent la preuve la plus forte : on leur réserve donc leur
  // propre passage, même si le budget est déjà entamé.
  const landingRun = await withinBudget(
    landingPaths.slice(0, MAX_LANDING_CHECKS),
    clock,
    async (landing) => ({
      path: landing.path,
      orders: landing.orders,
      status: await headStatus(fetcher, `${origin}${landing.path}`),
    }),
  );
  const landingChecks: StorefrontRaw["landingChecks"] = landingRun.done;
  if (landingRun.skipped > 0) unchecked.push(`${landingRun.skipped} page(s) d'arrivée`);

  const { observations, gaps } = storefrontObservations({
    origin,
    // `robots.txt` n'est pas une page du parcours : il ne doit pas peser dans
    // les temps de réponse ni dans les poids de document.
    pages,
    robots: robotsPage?.status === 200 ? robotsPage.html : null,
    sitemapFound: sitemapStatus != null && sitemapStatus < 400,
    linkChecks,
    landingChecks,
    mobileHome,
  });

  // Le site a-t-il répondu au moins une fois ? Sinon on le dit, sans produire
  // le moindre zéro qui se lirait comme une mesure.
  const reachable = pages.some((p) => p.status != null && p.status < 400);

  // UN CONTRÔLE SAUTÉ N'EST PAS UN CONTRÔLE RÉUSSI. Sans cette déclaration,
  // « aucun lien cassé » voudrait dire « aucun lien vérifié » et se lirait
  // exactement à l'envers.
  if (unchecked.length > 0) {
    gaps.push({
      id: "storefront.scan_incomplet",
      label: "Scan écourté",
      source: "storefront",
      reason: `Le site a mis trop de temps à répondre : le scan s'est arrêté au bout de ${Math.round(SCAN_BUDGET_MS / 1000)} secondes sans vérifier ${unchecked.join(", ")}. Ce qui n'a pas été vérifié n'est pas pour autant sain.`,
      wouldEnable:
        "Un état complet du site. La lenteur constatée est elle-même un fait, déjà reporté comme tel.",
    });
  }

  return {
    source: "storefront",
    observations,
    gaps,
    reachable,
    error: reachable ? null : "Le site public n'a répondu sur aucune de ses adresses.",
    // LE DOCUMENT LUI-MÊME, conservé pour la lecture d'expérience.
    //
    // Le scan répond à « la page fonctionne-t-elle ? » ; la lecture
    // d'expérience répond à « que comprend le visiteur ? ». Ce sont deux
    // questions différentes sur le MÊME document, et le retélécharger pour la
    // seconde doublerait le coût d'un audit sans rien apprendre de plus.
    homeHtml: home.html ?? null,
  };
}
