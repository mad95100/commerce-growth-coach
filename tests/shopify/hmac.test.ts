/**
 * Contrôles de la vérification HMAC du retour OAuth Shopify.
 *
 * Les signatures de référence sont calculées ICI, indépendamment du module
 * testé, en appliquant à la main la procédure documentée par Shopify. Aucun
 * vecteur officiel reproductible n'existe (l'exemple publié contient un
 * gabarit `{shop}`) : ces contrôles prouvent la cohérence et le comportement
 * de refus, PAS la conformité au calcul réel de Shopify.
 *
 * Script hors dépôt, non commité.
 */
import { createHmac } from "node:crypto";
import { verifyShopifyHmac, isValidShopHostname } from "../../src/lib/shopify-hmac.server";
import { defineSuite } from "../../tests/harness";

export default defineSuite("Shopify — signature HMAC des retours OAuth", async (t) => {
  const SECRET = "shpss_secret_de_test_uniquement";

  /** Signe selon la procédure Shopify, sur les valeurs DÉCODÉES. */
  function signDecoded(params: Record<string, string>): string {
    const msg = Object.entries(params)
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join("&");
    return createHmac("sha256", SECRET).update(msg, "utf8").digest("hex");
  }

  /** Signe selon la procédure Shopify, sur les valeurs PERCENT-ENCODÉES. */
  function signEncoded(params: Record<string, string>): string {
    const msg = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .sort()
      .join("&");
    return createHmac("sha256", SECRET).update(msg, "utf8").digest("hex");
  }

  function query(params: Record<string, string>, hmac: string): string {
    const p = new URLSearchParams(params);
    p.set("hmac", hmac);
    return p.toString();
  }

  // Un retour d'autorisation réaliste, tel que Shopify le construit.
  const base = {
    code: "0907a61c0c8d55e99db179b68161bc00",
    shop: "ecom-pilot-test.myshopify.com",
    state: "eyJ1c2VySWQiOiJhIn0.c2lnbmF0dXJl",
    timestamp: "1337178173",
  };

  // --- 1. Signature authentique : les deux canonicalisations sont acceptées ---
  t.check(
    "valeurs décodées => accepté",
    verifyShopifyHmac(query(base, signDecoded(base)), SECRET),
    true,
  );
  t.check(
    "valeurs encodées => accepté",
    verifyShopifyHmac(query(base, signEncoded(base)), SECRET),
    true,
  );

  // --- 2. Le cas qui motive la double forme : `host` en base64 avec remplissage ---
  const withHost = { ...base, host: "ZWNvbS1waWxvdC10ZXN0Lm15c2hvcGlmeS5jb20vYWRtaW4=" };
  t.check(
    "host base64 (= à encoder), forme décodée => accepté",
    verifyShopifyHmac(query(withHost, signDecoded(withHost)), SECRET),
    true,
  );
  t.check(
    "host base64 (= à encoder), forme encodée => accepté",
    verifyShopifyHmac(query(withHost, signEncoded(withHost)), SECRET),
    true,
  );
  // Preuve que les deux messages diffèrent réellement dans ce cas :
  t.check(
    "les deux canonicalisations produisent bien des signatures différentes ici",
    signDecoded(withHost) === signEncoded(withHost),
    false,
  );

  // --- 3. Refus : toute altération invalide la signature ---
  const authentic = signDecoded(base);
  t.check(
    "paramètre modifié => refusé",
    verifyShopifyHmac(query({ ...base, shop: "attaquant.myshopify.com" }, authentic), SECRET),
    false,
  );
  t.check(
    "code remplacé => refusé",
    verifyShopifyHmac(
      query({ ...base, code: "ffffffffffffffffffffffffffffffff" }, authentic),
      SECRET,
    ),
    false,
  );
  t.check(
    "paramètre ajouté => refusé",
    verifyShopifyHmac(query({ ...base, extra: "1" }, authentic), SECRET),
    false,
  );
  t.check(
    "paramètre retiré => refusé",
    verifyShopifyHmac(query({ code: base.code, shop: base.shop }, authentic), SECRET),
    false,
  );
  t.check(
    "mauvais secret => refusé",
    verifyShopifyHmac(query(base, authentic), "autre_secret"),
    false,
  );

  // --- 4. Refus : formes dégradées ---
  t.check(
    "hmac absent => refusé",
    verifyShopifyHmac(new URLSearchParams(base).toString(), SECRET),
    false,
  );
  t.check("hmac vide => refusé", verifyShopifyHmac(query(base, ""), SECRET), false);
  t.check(
    "hmac non hexadécimal => refusé",
    verifyShopifyHmac(query(base, "zz".repeat(32)), SECRET),
    false,
  );
  t.check("hmac trop court => refusé", verifyShopifyHmac(query(base, "abcd"), SECRET), false);
  t.check(
    "hmac trop long => refusé",
    verifyShopifyHmac(query(base, authentic + "00"), SECRET),
    false,
  );
  t.check("secret vide => refusé", verifyShopifyHmac(query(base, authentic), ""), false);
  t.check("chaîne de requête vide => refusé", verifyShopifyHmac("", SECRET), false);
  t.check(
    "hmac seul, sans autre paramètre => refusé",
    verifyShopifyHmac(`hmac=${authentic}`, SECRET),
    false,
  );

  // --- 5. `signature`, forme héritée, est exclue du message comme `hmac` ---
  const legacy = new URLSearchParams(base);
  legacy.set("signature", "vieille-valeur");
  legacy.set("hmac", signDecoded(base));
  t.check(
    "`signature` ignorée dans le calcul => accepté",
    verifyShopifyHmac(legacy.toString(), SECRET),
    true,
  );

  // --- 6. Accepte un URLSearchParams comme une chaîne, sans différence ---
  t.check(
    "URLSearchParams accepté à l'identique",
    verifyShopifyHmac(new URLSearchParams(query(base, authentic)), SECRET),
    true,
  );

  // --- 7. Nom d'hôte de boutique ---
  const hostnames: Array<[string, boolean]> = [
    ["ecom-pilot-test.myshopify.com", true],
    ["ECOM-PILOT-TEST.MYSHOPIFY.COM", true],
    ["a.myshopify.com", true],
    ["-mauvais.myshopify.com", false],
    ["boutique.myshopify.com.attaquant.fr", false],
    ["attaquant.fr", false],
    ["boutique.myshopify.com/admin", false],
    ["boutique..myshopify.com", false],
    ["", false],
  ];
  for (const [value, expected] of hostnames) {
    t.check(`nom d'hôte « ${value || "(vide)"} »`, isValidShopHostname(value), expected);
  }
});
