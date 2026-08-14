/**
 * Contrôles de la gestion des devises.
 *
 * L'enjeu central : prouver que le système n'est PAS limité à une liste. Les
 * devises exotiques ci-dessous ne figurent nulle part dans le code — si l'une
 * d'elles était rejetée, c'est qu'une liste codée en dur se cache quelque part.
 *
 * Script hors dépôt, non commité.
 */
import {
  CurrencyMismatchError,
  UNDETERMINED_CURRENCY_LABEL,
  addMoney,
  assertSameCurrency,
  compareMoney,
  currencyLabel,
  formatMoney,
  isCurrencyCode,
  money,
  normalizeCurrency,
  sameCurrency,
  subtractMoney,
} from "../../src/lib/currency";
import { normalizeLegacyStateKeys, sameActionState } from "../../src/lib/action-plan";
import { defineSuite } from "../../tests/harness";

export default defineSuite("Devises — ISO 4217, sans liste ni conversion", async (t) => {
  // ---------------------------------------------------------------------------
  // 1. AUCUNE LISTE : des devises que le code ne mentionne nulle part
  // ---------------------------------------------------------------------------
  // Devises réelles, volontairement hors des « suspects habituels ».
  const EXOTIC = [
    "MGA", // ariary malgache
    "BTN", // ngultrum bhoutanais
    "STN", // dobra santoméen (code renuméroté en 2018)
    "VES", // bolívar souverain (redénomination récente)
    "MRU", // ouguiya mauritanien (renuméroté en 2018)
    "SLE", // leone sierra-léonais (redénomination 2022)
    "ZWG", // or zimbabwéen (créé en 2024)
    "XCG", // florin caribéen (créé en 2025)
  ];
  for (const code of EXOTIC) {
    t.check(`devise réelle peu courante « ${code} » acceptée`, normalizeCurrency(code), code);
    t.check(`« ${code} » reconnue comme code`, isCurrencyCode(code), true);
  }

  // Le cas décisif : une devise que PERSONNE n'a pu prévoir.
  t.check(
    "devise inédite « QQZ » acceptée sans être connue d'avance",
    normalizeCurrency("QQZ"),
    "QQZ",
  );
  t.check(
    "devise inédite formatée sans échec, code affiché tel quel",
    formatMoney(1500, "QQZ").includes("QQZ"),
    true,
  );
  t.check(
    "devise inédite : le montant reste lisible",
    // `Intl` sépare les milliers par une espace insécable étroite (U+202F) ou
    // une espace insécable (U+00A0) selon la locale et la version d'ICU : on les
    // ramène à l'espace ordinaire pour comparer le texte, sans dépendre de l'une
    // ni de l'autre.
    formatMoney(1500, "QQZ").replace(/[\u202f\u00a0]/g, " "),
    "1 500 QQZ",
  );

  // ---------------------------------------------------------------------------
  // 2. Normalisation
  // ---------------------------------------------------------------------------
  t.check("minuscules relevées", normalizeCurrency("usd"), "USD");
  t.check("espaces ignorés", normalizeCurrency("  eur  "), "EUR");
  t.check("casse mixte", normalizeCurrency("AeD"), "AED");
  for (const bad of ["EURO", "US", "", "   ", "12A", "U$D", "E UR", null, undefined, 42, {}, []]) {
    t.check(`valeur invalide ${JSON.stringify(bad)} => null`, normalizeCurrency(bad), null);
  }
  t.check("aucune substitution par défaut", normalizeCurrency(undefined), null);

  // ---------------------------------------------------------------------------
  // 3. Devise indéterminée : annoncée, jamais devinée
  // ---------------------------------------------------------------------------
  t.check("libellé d'une devise inconnue", currencyLabel(null), UNDETERMINED_CURRENCY_LABEL);
  t.check("libellé jamais remplacé par EUR", currencyLabel(null) === "EUR", false);
  t.check(
    "montant sans devise : mention explicite",
    formatMoney(1200, null).includes(UNDETERMINED_CURRENCY_LABEL),
    true,
  );
  t.check("montant absent", formatMoney(null, "USD"), "—");
  t.check("montant non fini", formatMoney(Number.NaN, "USD"), "—");

  // ---------------------------------------------------------------------------
  // 4. INTERDICTION DE MÉLANGER LES DEVISES (exigence centrale)
  // ---------------------------------------------------------------------------
  const usd = money(100, "USD");
  const eur = money(100, "EUR");
  const aed = money(100, "AED");
  const unknown = money(100, null);

  t.check("USD vs EUR : devises différentes", sameCurrency(usd, eur), false);
  t.check("USD vs AED : devises différentes", sameCurrency(usd, aed), false);
  t.check("USD vs USD : identiques", sameCurrency(usd, money(50, "USD")), true);
  t.check(
    "deux devises inconnues ne sont PAS réputées égales",
    sameCurrency(unknown, money(5, null)),
    false,
  );

  t.throws("comparaison USD/EUR refusée", () => compareMoney(usd, eur), CurrencyMismatchError);
  t.throws("comparaison USD/AED refusée", () => compareMoney(usd, aed), CurrencyMismatchError);
  t.throws("addition USD/EUR refusée", () => addMoney(usd, eur), CurrencyMismatchError);
  t.throws("soustraction USD/EUR refusée", () => subtractMoney(usd, eur), CurrencyMismatchError);
  t.throws(
    "assertion USD/EUR refusée",
    () => assertSameCurrency(usd, eur, "marge"),
    CurrencyMismatchError,
  );
  t.throws(
    "calcul avec devise inconnue refusé",
    () => addMoney(usd, unknown),
    CurrencyMismatchError,
  );
  t.throws(
    "devise inconnue des deux côtés refusée",
    () => addMoney(unknown, money(1, null)),
    CurrencyMismatchError,
  );
  t.throws(
    "devise inédite vs USD refusée",
    () => addMoney(usd, money(1, "QQZ")),
    CurrencyMismatchError,
  );

  // Même devise : les opérations passent.
  t.check("addition même devise", addMoney(usd, money(50, "USD")), {
    amount: 150,
    currency: "USD",
  });
  t.check("soustraction même devise", subtractMoney(usd, money(30, "USD")), {
    amount: 70,
    currency: "USD",
  });
  t.check("comparaison même devise", Math.sign(compareMoney(usd, money(150, "USD"))), -1);
  t.check(
    "addition en devise inédite : autorisée si identique des deux côtés",
    addMoney(money(10, "ZWG"), money(5, "ZWG")),
    { amount: 15, currency: "ZWG" },
  );

  // Le message d'erreur nomme les deux devises, pour être diagnosticable.
  try {
    addMoney(usd, aed);
  } catch (e) {
    const msg = (e as Error).message;
    t.check("message d'erreur : nomme USD", msg.includes("USD"), true);
    t.check("message d'erreur : nomme AED", msg.includes("AED"), true);
    t.check(
      "message d'erreur : dit qu'aucune conversion n'existe",
      msg.includes("conversion"),
      true,
    );
  }

  // ---------------------------------------------------------------------------
  // 5. Aucune conversion nulle part
  // ---------------------------------------------------------------------------
  t.check(
    "addition de même devise ne modifie jamais le montant par un taux",
    addMoney(money(100, "JPY"), money(100, "JPY")).amount,
    200,
  );

  // ---------------------------------------------------------------------------
  // 6. Clé monétaire héritée : les actions déjà en base restent exploitables
  // ---------------------------------------------------------------------------
  t.check(
    "daily_budget_eur renommé à la lecture",
    normalizeLegacyStateKeys({ daily_budget_eur: 20 }),
    { daily_budget: 20 },
  );
  t.check(
    "état hérité et état actuel réputés identiques",
    sameActionState(normalizeLegacyStateKeys({ daily_budget_eur: 20 }), { daily_budget: 20 }),
    true,
  );
  t.check(
    "sans normalisation, l'ancien état aurait été refusé à tort",
    sameActionState({ daily_budget_eur: 20 }, { daily_budget: 20 }),
    false,
  );
  t.check(
    "une vraie différence de valeur reste détectée",
    sameActionState(normalizeLegacyStateKeys({ daily_budget_eur: 20 }), { daily_budget: 21 }),
    false,
  );
  t.check(
    "la clé actuelle n'est jamais écrasée par l'héritée",
    normalizeLegacyStateKeys({ daily_budget_eur: 20, daily_budget: 35 }),
    { daily_budget: 35 },
  );
  t.check("null traversé sans dommage", normalizeLegacyStateKeys(null), null);
  t.check(
    "imbrication et tableaux traversés",
    normalizeLegacyStateKeys({ a: [{ daily_budget_eur: 7 }] }),
    { a: [{ daily_budget: 7 }] },
  );
  t.check(
    "les autres clés sont intactes",
    normalizeLegacyStateKeys({ status: "ACTIVE", headline: "x" }),
    { status: "ACTIVE", headline: "x" },
  );
});
