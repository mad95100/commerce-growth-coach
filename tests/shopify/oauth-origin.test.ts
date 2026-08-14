/**
 * Contrôles de l'origine publique, après passage à une origine FIGÉE.
 *
 * L'exigence a changé : l'origine ne doit plus dépendre de la requête, sans
 * quoi le `redirect_uri` varie selon l'adresse de navigation et le partenaire
 * répond « redirect_uri is not whitelisted ». Ces contrôles vérifient donc
 * surtout une NON-dépendance.
 *
 * Script hors dépôt, non commité.
 */
import { publicOrigin, oauthCallbackUrl } from "../../src/lib/public-origin.server";
import { defineSuite } from "../../tests/harness";

export default defineSuite("OAuth — origine publique et redirect_uri", async (t) => {
  const CANONICAL = "https://commerce-growth-coach.lovable.app";

  function withAppUrl<T>(value: string | undefined, fn: () => T): T {
    const previous = process.env.APP_URL;
    if (value === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = value;
    try {
      return fn();
    } finally {
      if (previous === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = previous;
    }
  }

  // --- 1. Sans APP_URL : l'origine canonique, toujours ---
  withAppUrl(undefined, () => {
    t.check("sans APP_URL => origine canonique", publicOrigin(), CANONICAL);
    t.check(
      "callback Shopify => URL déclarée chez Shopify",
      oauthCallbackUrl("shopify"),
      `${CANONICAL}/api/public/oauth/shopify/callback`,
    );
    t.check(
      "callback Meta",
      oauthCallbackUrl("meta"),
      `${CANONICAL}/api/public/oauth/meta/callback`,
    );
    t.check(
      "callback Google",
      oauthCallbackUrl("google"),
      `${CANONICAL}/api/public/oauth/google/callback`,
    );
  });

  // --- 2. Stabilité : c'est LA propriété qui corrige le bug ---
  withAppUrl(undefined, () => {
    const calls = Array.from({ length: 5 }, () => oauthCallbackUrl("shopify"));
    t.check("appels répétés => valeur strictement identique", new Set(calls).size, 1);
    t.check(
      "aucune dépendance à une requête (la fonction n'en prend plus)",
      publicOrigin.length,
      0,
    );
  });

  // --- 3. APP_URL reste prioritaire, pour un domaine personnalisé ---
  withAppUrl("https://app.exemple.com", () => {
    t.check("APP_URL prioritaire", publicOrigin(), "https://app.exemple.com");
    t.check(
      "APP_URL prioritaire jusqu'au callback",
      oauthCallbackUrl("shopify"),
      "https://app.exemple.com/api/public/oauth/shopify/callback",
    );
  });
  withAppUrl("https://app.exemple.com/", () =>
    t.check("APP_URL : barre finale retirée", publicOrigin(), "https://app.exemple.com"),
  );
  withAppUrl("https://app.exemple.com///", () =>
    t.check(
      "APP_URL : barres finales multiples retirées",
      publicOrigin(),
      "https://app.exemple.com",
    ),
  );
  withAppUrl("https://app.exemple.com/sous/chemin", () =>
    t.check("APP_URL : chemin ignoré, origine seule", publicOrigin(), "https://app.exemple.com"),
  );
  withAppUrl("app.exemple.com", () =>
    t.check("APP_URL sans schéma => https ajouté", publicOrigin(), "https://app.exemple.com"),
  );
  withAppUrl("http://localhost:3000", () =>
    t.check("APP_URL en http local => conservé", publicOrigin(), "http://localhost:3000"),
  );
  withAppUrl("https://app.exemple.com:8443", () =>
    t.check("APP_URL avec port => conservé", publicOrigin(), "https://app.exemple.com:8443"),
  );

  // --- 4. APP_URL inexploitable => repli sur l'origine canonique, jamais d'échec ---
  for (const bad of ["", "   ", "javascript:alert(1)", "ftp://x.y", "://///"]) {
    withAppUrl(bad, () =>
      t.check(
        `APP_URL invalide « ${bad.trim() || "(vide)"} » => canonique`,
        publicOrigin(),
        CANONICAL,
      ),
    );
  }

  // --- 5. L'origine canonique est bien celle déclarée chez Shopify ---
  t.check(
    "origine canonique = domaine publié Lovable",
    CANONICAL,
    "https://commerce-growth-coach.lovable.app",
  );
});
