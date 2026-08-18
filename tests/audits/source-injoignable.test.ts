import { readFileSync } from "node:fs";
import { defineSuite } from "../harness";
import { SOURCE_LABELS, allGaps, type SourceReport } from "../../src/lib/observations";
import { fetchShopifyObservations } from "../../src/lib/connectors/shopify-observe.server";

/**
 * « SOURCE INJOIGNABLE » DISAIT LA MÊME CHOSE DE TOUT.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI ARRIVAIT AU MARCHAND.
 *
 * Le connecteur Shopify savait très bien pourquoi il n'avait rien : jeton
 * indéchiffrable, 401, 429, 503, silence réseau. Il rangeait la raison dans
 * `SourceReport.error` — un champ dont le commentaire dit, à juste titre,
 * qu'il n'est jamais montré au marchand tel quel.
 *
 * Sauf qu'il n'était montré nulle part du tout. `allGaps`, dernier maillon
 * avant l'écran, écrivait une phrase FIXE :
 *
 *     reason: "Source injoignable — aucune donnée de ce canal."
 *
 * C'est la seule phrase que le marchand lise à ce sujet — dans `data_gaps`,
 * sous « Ce que nous n'avons pas pu mesurer », et dans le prompt envoyé au
 * modèle. Toutes les causes y devenaient identiques.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE N'EST PAS UN DÉTAIL DE FORMULATION.
 *
 * Une seule de ces causes est réparable par le marchand, et c'est aussi la
 * plus fréquente après un branchement qui s'est mal terminé : l'autorisation
 * invalide. Trente secondes lui suffisent — ENCORE FAUT-IL QU'IL SACHE. Sous
 * la phrase générique, il lisait un incident passager, attendait, relançait
 * l'audit, et retombait sur le même résultat vide.
 *
 * C'est la forme finale de la boucle signalée : la boutique paraît reliée,
 * l'audit aboutit, ne trouve rien, et rien nulle part ne dit qu'il faut
 * rebrancher.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LES DEUX MOITIÉS, TESTÉES SÉPARÉMENT.
 *
 * 1. Le connecteur CLASSE ce qu'il a rencontré — vérifié en le faisant
 *    réellement tourner contre un `fetch` de substitution qui répond ce qu'on
 *    veut. C'est du code exécuté, pas de la lecture de source.
 * 2. `allGaps` TRADUIT cette classe en une phrase qui dit à qui revient la
 *    suite.
 *
 * Ni l'une ni l'autre ne remplace le parcours réel contre une vraie boutique.
 */

const ROOT = new URL("../../", import.meta.url).pathname;

/** Un `fetch` de substitution qui répond toujours le même statut. */
function fetcherQuiRépond(statut: number, corps: unknown = {}) {
  return async () =>
    new Response(JSON.stringify(corps), {
      status: statut,
      headers: { "content-type": "application/json" },
    });
}

export default defineSuite("Collecte — une source muette dit pourquoi", async (t) => {
  // =========================================================================
  // 1. LE CONNECTEUR CLASSE — exécuté, pas relu
  // =========================================================================
  /*
    Le jeton est déchiffré avant tout appel. Sans clé utilisable, on n'atteint
    jamais le `fetch` et la classification testée serait celle du jeton, pas
    celle du statut. On pose donc une clé le temps de la suite.
  */
  const cléAvant = process.env.DATA_CONNECTIONS_ENCRYPTION_KEY;
  process.env.DATA_CONNECTIONS_ENCRYPTION_KEY = "0".repeat(64);
  const { encryptToken } = await import("../../src/lib/crypto.server");
  const jeton = encryptToken("shpat_faux_jeton_de_test");

  const CAS = [
    [401, "autorisation_invalide", "une autorisation retirée"],
    [403, "autorisation_invalide", "un accès refusé"],
    [404, "autorisation_invalide", "une app désinstallée"],
    [429, "quota_depasse", "une limite de requêtes"],
    [500, "fournisseur_en_panne", "une panne du fournisseur"],
    [503, "fournisseur_en_panne", "un service indisponible"],
  ] as const;

  for (const [statut, attendue, description] of CAS) {
    const rapports = await fetchShopifyObservations(
      "boutique-test.myshopify.com",
      jeton,
      fetcherQuiRépond(statut) as never,
    );
    t.check(
      `${statut} — ${description} : la source est bien muette`,
      rapports.shopify.reachable,
      false,
    );
    t.check(
      `${statut} — ${description} : la cause est « ${attendue} »`,
      rapports.shopify.cause,
      attendue,
    );
    // Les deux lectures issues du même appel doivent porter la même cause :
    // c'est le même refus, il ne peut pas avoir deux explications.
    t.check(
      `${statut} — la lecture organique porte la même cause`,
      rapports.organic.cause,
      attendue,
    );
    // Et surtout : AUCUN ZÉRO. Une source muette qui rend des compteurs à zéro
    // fabrique un diagnostic — c'est la panne qui devient un constat.
    t.check(`${statut} — aucune observation inventée`, rapports.shopify.observations.length, 0);
    t.check(`${statut} — l'entonnoir reste inconnu`, rapports.funnel.sessions, null);
  }

  // Un jeton indéchiffrable n'atteint jamais le réseau : la connexion est à
  // refaire, et c'est la même issue pour le marchand qu'un 401.
  const clé = process.env.DATA_CONNECTIONS_ENCRYPTION_KEY;
  process.env.DATA_CONNECTIONS_ENCRYPTION_KEY = "1".repeat(64);
  const illisible = await fetchShopifyObservations(
    "boutique-test.myshopify.com",
    jeton,
    fetcherQuiRépond(200, { shop: { currency: "EUR" } }) as never,
  );
  t.check("jeton illisible : la source est muette", illisible.shopify.reachable, false);
  t.check("jeton illisible : à rebrancher", illisible.shopify.cause, "autorisation_invalide");
  process.env.DATA_CONNECTIONS_ENCRYPTION_KEY = clé;

  // Le cas qui doit encore marcher : une boutique qui répond.
  const ok = await fetchShopifyObservations(
    "boutique-test.myshopify.com",
    jeton,
    (async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes("shop.json") ? { shop: { currency: "EUR" } } : { products: [], orders: [] },
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as never,
  );
  t.check("une boutique qui répond reste joignable", ok.shopify.reachable, true);
  t.check("…et ne porte aucune cause d'échec", ok.shopify.cause ?? null, null);

  if (cléAvant === undefined) delete process.env.DATA_CONNECTIONS_ENCRYPTION_KEY;
  else process.env.DATA_CONNECTIONS_ENCRYPTION_KEY = cléAvant;

  // =========================================================================
  // 2. `allGaps` TRADUIT — et les phrases sont réellement différentes
  // =========================================================================
  const muet = (cause: SourceReport["cause"]): SourceReport => ({
    source: "shopify",
    observations: [],
    gaps: [],
    reachable: false,
    error: "détail technique qui ne doit pas sortir",
    cause,
  });

  const phrases = new Map<string, string>();
  for (const cause of [
    "autorisation_invalide",
    "quota_depasse",
    "fournisseur_en_panne",
    "injoignable",
  ] as const) {
    const [manque] = allGaps([muet(cause)]);
    t.check(`${cause} : un manque est bien produit`, manque !== undefined, true);
    phrases.set(cause, manque!.reason);

    t.check(
      `${cause} : la source est nommée`,
      manque!.reason.includes(SOURCE_LABELS.shopify),
      true,
    );
    // Le message technique reste au journal. C'était déjà la règle ; elle ne
    // doit pas se perdre en devenant plus précis.
    t.check(
      `${cause} : le détail technique ne sort pas`,
      /détail technique/.test(manque!.reason),
      false,
    );
  }

  // LE CŒUR DU CONTRÔLE : quatre causes, quatre phrases. Si deux redevenaient
  // identiques, le défaut serait revenu sans qu'aucune autre vérification ne
  // bouge.
  t.check("quatre causes donnent quatre phrases distinctes", new Set(phrases.values()).size, 4);

  // Et celle qui compte le plus dit ce qu'il y a à faire, à qui, et que c'est
  // court. C'est la seule des quatre que le marchand puisse réparer.
  const àRebrancher = phrases.get("autorisation_invalide")!;
  t.check("l'autorisation invalide demande de rebrancher", /rebranchez/i.test(àRebrancher), true);
  t.check("…et annonce que c'est rapide", /moins d'une minute/i.test(àRebrancher), true);

  // Les trois autres disent l'inverse — qu'il n'y a RIEN à rebrancher. C'est
  // aussi important : envoyer refaire une connexion valable use la confiance
  // aussi sûrement que de ne rien dire.
  for (const cause of ["quota_depasse", "fournisseur_en_panne", "injoignable"] as const) {
    t.check(
      `${cause} : n'envoie pas rebrancher une connexion valable`,
      /rebranchez/i.test(phrases.get(cause)!),
      false,
    );
    t.check(
      `${cause} : propose de relancer l'audit`,
      /relancez l'audit/i.test(phrases.get(cause)!),
      true,
    );
  }

  // Une source SANS cause déclarée doit rester lisible : les connecteurs qui
  // n'ont pas encore été instrumentés ne doivent pas produire « undefined ».
  const [sansCause] = allGaps([{ ...muet(undefined) }]);
  t.check("une source sans cause reste lisible", /undefined|null/.test(sansCause!.reason), false);
  t.check("…et retombe sur la formulation prudente", sansCause!.reason, phrases.get("injoignable"));

  // =========================================================================
  // 3. LA PHRASE FIXE NE DOIT PAS REVENIR
  // =========================================================================
  const source = readFileSync(`${ROOT}src/lib/observations.ts`, "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    " ",
  );
  t.check(
    "l'ancienne phrase unique a disparu du code",
    /reason: "Source injoignable/.test(source),
    false,
  );
  t.check(
    "la raison se choisit désormais d'après la cause",
    /RAISON_PAR_CAUSE\[r\.cause \?\? "injoignable"\]/.test(source),
    true,
  );
});
