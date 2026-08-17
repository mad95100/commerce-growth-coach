import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineSuite } from "../harness";

/**
 * L'ÉTAT OAUTH : CE QUI EMPÊCHE D'ATTACHER UN COMPTE À LA BOUTIQUE D'AUTRUI.
 *
 * POURQUOI CETTE SUITE EXISTE. Le retour d'autorisation Meta, Google et Shopify
 * est une route PUBLIQUE : elle est appelée par le navigateur du marchand après
 * un détour chez le partenaire, sans session à nous. La seule chose qui lui dit
 * pour quelle boutique elle travaille est le paramètre `state`, et la seule
 * chose qui empêche n'importe qui de le fabriquer est sa signature.
 *
 * CE QUI ARRIVERAIT SANS ELLE. Un `state` forgé avec l'identifiant de la
 * boutique d'un autre, et le compte publicitaire de l'attaquant se retrouve
 * attaché à cette boutique — avec, ensuite, un diagnostic qui parle de
 * campagnes que le marchand n'a jamais lancées, et des écritures automatiques
 * proposées sur un compte qui n'est pas le sien.
 *
 * LE CODE ÉTAIT DÉJÀ CORRECT quand cette suite a été écrite : signature HMAC,
 * comparaison en temps constant, péremption, fournisseur vérifié. Il n'était
 * couvert par aucun contrôle. Une primitive de sécurité juste mais non testée
 * n'est qu'une primitive de sécurité pour l'instant : rien n'avertit le jour où
 * une simplification bien intentionnée la desserre.
 */

// Le secret doit exister AVANT l'import du module, qui le lit à l'appel.
process.env.OAUTH_STATE_SECRET ??= "secret-de-test-uniquement-pour-cette-suite";

const { signOAuthState, verifyOAuthState } = await import("@/lib/crypto.server");

const ROOT = new URL("../../", import.meta.url).pathname;
const lire = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");

function refuse(état: string): boolean {
  try {
    verifyOAuthState(état);
    return false;
  } catch {
    return true;
  }
}

export default defineSuite("Sécurité — l'état OAuth ne se forge pas", (t) => {
  const état = signOAuthState({
    userId: "11111111-1111-1111-1111-111111111111",
    storeId: "22222222-2222-2222-2222-222222222222",
    provider: "meta_ads",
    nonce: "n-1",
  });

  // --- 1. L'aller-retour honnête -------------------------------------------
  const relu = verifyOAuthState<{ userId: string; storeId: string; provider: string }>(état);
  t.check("l'utilisateur est restitué", relu.userId, "11111111-1111-1111-1111-111111111111");
  t.check("la boutique est restituée", relu.storeId, "22222222-2222-2222-2222-222222222222");
  t.check("le fournisseur est restitué", relu.provider, "meta_ads");

  // --- 2. Tout ce qui est modifié est refusé -------------------------------
  const [corps, signature] = état.split(".");

  // LE CAS QUI COMPTE : changer la boutique visée en gardant la signature.
  // C'est l'attaque exacte — rattacher un compte publicitaire à la boutique
  // d'un autre.
  const autreBoutique = Buffer.from(
    JSON.stringify({
      userId: "11111111-1111-1111-1111-111111111111",
      storeId: "33333333-3333-3333-3333-333333333333",
      provider: "meta_ads",
      nonce: "n-1",
      iat: Date.now(),
    }),
    "utf8",
  ).toString("base64url");
  t.check(
    "une autre boutique avec la même signature est refusée",
    refuse(`${autreBoutique}.${signature}`),
    true,
  );

  t.check("un corps modifié est refusé", refuse(`${corps}X.${signature}`), true);
  t.check("une signature modifiée est refusée", refuse(`${corps}.${signature}X`), true);
  t.check("une signature vide est refusée", refuse(`${corps}.`), true);
  t.check("un état sans point est refusé", refuse(corps ?? ""), true);
  t.check("un état vide est refusé", refuse(""), true);
  t.check("un état arbitraire est refusé", refuse("nimporte.quoi"), true);
  // Une signature d'une AUTRE longueur ne doit pas faire lever la comparaison
  // en temps constant — elle doit être refusée proprement.
  t.check(
    "une signature tronquée est refusée",
    refuse(`${corps}.${signature?.slice(0, 10)}`),
    true,
  );

  // --- 3. La péremption ----------------------------------------------------
  // Un état volé dans un journal de navigation ou un référent ne doit pas
  // rester utilisable indéfiniment.
  const source = lire("src/lib/crypto.server.ts");
  t.check("une péremption existe", /maxAgeMs\s*=\s*15 \* 60 \* 1000/.test(source), true);

  /** Signe comme le module, pour pouvoir choisir la date. */
  function signerÀLaDate(iat: number): string {
    const clé = createHmac("sha256", "ecompilot-oauth-state")
      .update(process.env.OAUTH_STATE_SECRET!)
      .digest();
    const corpsDaté = Buffer.from(
      JSON.stringify({ userId: "u", storeId: "s", provider: "meta_ads", iat }),
      "utf8",
    );
    const sig = createHmac("sha256", clé).update(corpsDaté).digest();
    return `${corpsDaté.toString("base64url")}.${sig.toString("base64url")}`;
  }

  // LE TÉMOIN D'ABORD. Sans lui, un état refusé pour signature invalide
  // passerait pour un état refusé par péremption, et le contrôle suivant ne
  // vérifierait rien du tout.
  t.check(
    "le témoin, signé à l'instant, est bien accepté",
    refuse(signerÀLaDate(Date.now())),
    false,
  );
  t.check(
    "un état vieux d'une heure est refusé",
    refuse(signerÀLaDate(Date.now() - 3_600_000)),
    true,
  );

  // --- 4. Les propriétés qu'on ne veut pas voir disparaître ----------------
  t.check("la comparaison est en temps constant", /timingSafeEqual\(/.test(source), true);
  t.check(
    "le secret n'a pas de valeur par défaut",
    /OAUTH_STATE_SECRET manquant/.test(source),
    true,
  );
  t.check(
    "le secret ne sert pas de clé brute",
    /createHmac\("sha256", "ecompilot-oauth-state"\)/.test(source),
    true,
  );

  // --- 5. Chaque retour vérifie que l'état est bien le sien ----------------
  // Un état signé pour Meta ne doit pas ouvrir le retour Google : les jetons
  // seraient enregistrés sous le mauvais fournisseur, et lus plus tard comme
  // s'ils venaient de l'autre.
  for (const [fournisseur, attendu] of [
    ["meta", "meta_ads"],
    ["google", "google_ads"],
  ] as const) {
    const callback = lire(`src/routes/api/public/oauth/${fournisseur}/callback.ts`);
    t.check(
      `le retour ${fournisseur} vérifie la signature`,
      /verifyOAuthState/.test(callback),
      true,
    );
    t.check(
      `le retour ${fournisseur} refuse un état d'un autre fournisseur`,
      new RegExp(`payload\\.provider !== "${attendu}"`).test(callback),
      true,
    );
  }
});
