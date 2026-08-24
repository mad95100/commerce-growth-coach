import { defineSuite } from "../harness";
import { confronterDevise, devisesMesurees } from "@/lib/devises-opposables";
import { formatMoney, normalizeCurrency, UNDETERMINED_CURRENCY_LABEL } from "@/lib/currency";
import { snapshotToPromptBlock } from "@/lib/snapshots.server";

/**
 * LA DEVISE, DE LA MESURE JUSQU'AU TEXTE QUE LE MARCHAND LIT.
 *
 * LE DÉFAUT. Le bloc de données envoyé au modèle est irréprochable : chaque
 * canal y annonce SA devise, et un avertissement interdit d'additionner deux
 * devises. Cette rigueur s'arrêtait aux champs CHIFFRÉS. Le verdict, le résumé,
 * la cause racine et la description d'impact sont du texte libre, et rien ne
 * relisait ce que le modèle y écrivait — une boutique en euros pouvait lire
 * « environ 900 $ perdus par mois » dans un produit d'analyse commerciale.
 *
 * CE QUE CETTE SUITE ÉTABLIT :
 *
 * 1. une devise absente de nos mesures est une INVENTION, pas une lecture ;
 * 2. quand une seule devise a été mesurée, seule l'étiquette est fausse et elle
 *    se corrige — le nombre, lui, n'est jamais touché ;
 * 3. quand plusieurs devises coexistent, on ne DEVINE pas : la phrase est
 *    retirée, parce qu'un montant faux se croit là où un blanc se remarque ;
 * 4. aucune conversion n'est jamais appliquée, nulle part.
 */

const obs = (id: string, value: number, currency: string | null) =>
  ({
    id,
    source: "shopify",
    domain: "conversion",
    label: id,
    value,
    unit: "currency",
    currency,
    periodDays: 30,
    evidence: id,
  }) as never;

export default defineSuite("Devises — jamais supposées, jamais converties", (t) => {
  // =========================================================================
  // 1. Ce que nous avons réellement mesuré
  // =========================================================================
  t.check(
    "les devises viennent des observations, pas d'une liste",
    devisesMesurees(["EUR", null, "eur", "USD", undefined, "pas une devise"]),
    ["EUR", "USD"],
  );
  t.check("une devise indéterminée n'entre pas", devisesMesurees([null, undefined, "", "12"]), []);

  // =========================================================================
  // 2. UNE SEULE DEVISE MESURÉE : l'étiquette se corrige, le nombre jamais
  // =========================================================================
  const eur = ["EUR"];

  const dollar = confronterDevise("Vous perdez environ 900 $ par mois sur cette étape.", eur);
  t.check("le symbole inventé est corrigé", dollar.texte.includes("900 EUR"), true);
  t.check("le symbole faux a disparu", dollar.texte.includes("$"), false);
  t.check("la correction est journalisée", dollar.corrige.length, 1);
  t.check("aucune phrase n'est retirée", dollar.retire.length, 0);
  t.check("le NOMBRE est intact", dollar.texte.includes("900"), true);

  const code = confronterDevise("Le panier moyen ressort à 47 USD.", eur);
  t.check("un code ISO inventé est corrigé aussi", code.texte.includes("47 EUR"), true);
  t.check("…et USD a disparu", code.texte.includes("USD"), false);

  const juste = confronterDevise("Vous perdez environ 900 EUR par mois.", eur);
  t.check(
    "une devise mesurée est laissée intacte",
    juste.texte,
    "Vous perdez environ 900 EUR par mois.",
  );
  t.check("…et rien n'est journalisé", juste.corrige.length + juste.retire.length, 0);

  const symboleJuste = confronterDevise("Vous perdez environ 900 € par mois.", eur);
  t.check(
    "le symbole de la devise mesurée est laissé intact",
    symboleJuste.texte.includes("€"),
    true,
  );

  // =========================================================================
  // 3. PLUSIEURS DEVISES : on ne devine pas
  // =========================================================================
  /*
    C'est le cas d'une boutique en euros dont le compte publicitaire facture en
    dollars — situation ordinaire, et la seule où corriger l'étiquette
    reviendrait à choisir au hasard entre deux affirmations financières.
  */
  const deux = ["EUR", "USD"];
  const ambigu = confronterDevise("Votre coût par commande atteint 32 £ ce mois-ci.", deux);
  t.check("la phrase indécidable est retirée", ambigu.texte, "");
  t.check("…et le journal dit laquelle", ambigu.retire.length, 1);
  t.check("…sans jamais prétendre l'avoir corrigée", ambigu.corrige.length, 0);

  const melange = confronterDevise(
    "Votre chiffre d'affaires est de 12 000 EUR. Votre dépense publicitaire atteint 4 000 USD. Le coût par commande ressort à 18 £.",
    deux,
  );
  t.check("les deux devises mesurées survivent", melange.texte.includes("12 000 EUR"), true);
  t.check("…toutes les deux", melange.texte.includes("4 000 USD"), true);
  t.check("seule la phrase inventée tombe", melange.texte.includes("18"), false);
  t.check("une seule phrase retirée", melange.retire.length, 1);

  // =========================================================================
  // 4. CE QUI NE DOIT PAS ÊTRE PRIS POUR UNE DEVISE
  // =========================================================================
  /*
    Trois majuscules ne sont pas une devise. Le produit écrit « TVA », « CGV »,
    « SEO », « URL » — les corriger en EUR produirait des phrases absurdes, et
    surtout : ce serait le signe que la règle attrape par la forme au lieu
    d'attraper par le sens.
  */
  for (const phrase of [
    "La TVA est incluse dans les prix affichés.",
    "Vos CGV ne mentionnent pas les délais de rétractation.",
    "Le SEO de vos collections est faible.",
    "Cette URL renvoie une page vide.",
  ]) {
    const r = confronterDevise(phrase, eur);
    t.check(`intact : « ${phrase.slice(0, 30)}… »`, r.texte, phrase);
    t.check(`…et rien de journalisé : « ${phrase.slice(0, 24)}… »`, r.corrige.length, 0);
  }

  // Une suite de majuscules adossée à un nombre, en revanche, EST une unité.
  const accole = confronterDevise("Le seuil est fixé à 50 CHF.", eur);
  t.check("un code accolé à un nombre est bien lu", accole.texte.includes("50 EUR"), true);

  // =========================================================================
  // 5. RIEN À DÉCIDER : le texte revient intact
  // =========================================================================
  /*
    Sans aucune devise mesurée, refuser en bloc reviendrait à supprimer des
    phrases sur la foi d'une ignorance. C'est la même règle que
    `faits-opposables` applique à un catalogue non compté.
  */
  const rien = confronterDevise("Vous perdez environ 900 $ par mois.", []);
  t.check("sans mesure, rien n'est corrigé", rien.texte, "Vous perdez environ 900 $ par mois.");
  t.check("…ni retiré", rien.retire.length, 0);

  t.check("un texte vide ne provoque rien", confronterDevise("", eur).texte, "");

  // =========================================================================
  // 6. AUCUNE CONVERSION, NULLE PART
  // =========================================================================
  /*
    Le montant ne change JAMAIS. Corriger « 900 $ » en « 900 EUR » n'est pas une
    conversion : c'est la reconnaissance que le 900 venait déjà de nos euros et
    que seule l'étiquette avait été inventée. Un taux de change appliqué ici
    serait un chiffre fabriqué.
  */
  const source = "Vous perdez 1 234 $ par mois, soit 14 808 $ par an.";
  const converti = confronterDevise(source, eur);
  for (const nombre of ["1 234", "14 808"]) {
    t.check(`le nombre ${nombre} traverse sans changer`, converti.texte.includes(nombre), true);
  }

  // =========================================================================
  // 7. LE SOCLE : aucune devise par défaut, aucune addition entre devises
  // =========================================================================
  t.check("une devise absente reste absente", normalizeCurrency(null), null);
  t.check("une devise absente n'est pas l'euro", normalizeCurrency(undefined), null);
  t.check(
    "un montant sans devise le dit",
    formatMoney(900, null).includes(UNDETERMINED_CURRENCY_LABEL),
    true,
  );

  /*
    LE BLOC ENVOYÉ AU MODÈLE ANNONCE CHAQUE DEVISE, ET AVERTIT QUAND ELLES
    DIFFÈRENT. C'est la moitié amont de la garantie : sans elle, la confrontation
    aval n'aurait aucune référence à opposer.
  */
  const blocMixte = snapshotToPromptBlock(
    {
      shopify: { revenue_30d: 12000, orders_30d: 100, aov: 120, currency: "EUR" },
      meta: { spend: 4000, purchases: 30, roas: 2, ctr: 1.2, currency: "USD" },
      google: null,
      unavailable: [],
    } as never,
    null,
    "EUR",
  );
  t.check("l'avertissement de devises est émis", /AVERTISSEMENT DEVISES/.test(blocMixte), true);
  t.check("les deux devises sont nommées", /EUR, USD|USD, EUR/.test(blocMixte), true);
  t.check("la conversion est interdite au modèle", /ne convertis pas/.test(blocMixte), true);
  t.check("chaque canal porte SA devise", /Dépense : 4000 USD/.test(blocMixte), true);

  const blocSimple = snapshotToPromptBlock(
    {
      shopify: { revenue_30d: 12000, orders_30d: 100, aov: 120, currency: "EUR" },
      meta: { spend: 4000, purchases: 30, roas: 2, ctr: 1.2, currency: "EUR" },
      google: null,
      unavailable: [],
    } as never,
    null,
    "EUR",
  );
  t.check(
    "une seule devise n'émet aucun avertissement",
    /AVERTISSEMENT DEVISES/.test(blocSimple),
    false,
  );

  // Devise inconnue : annoncée comme telle au modèle, jamais remplacée.
  const blocSansDevise = snapshotToPromptBlock(
    {
      shopify: { revenue_30d: 12000, orders_30d: 100, aov: 120, currency: null },
      meta: null,
      google: null,
      unavailable: [],
    } as never,
    null,
    null,
  );
  t.check(
    "une devise inconnue est dite inconnue au modèle",
    blocSansDevise.includes(UNDETERMINED_CURRENCY_LABEL),
    true,
  );
  t.check("…et jamais remplacée par l'euro", /12000 EUR/.test(blocSansDevise), false);

  // =========================================================================
  // 8. LE CHEMIN COMPLET, TEL QUE LE MOTEUR L'APPLIQUE
  // =========================================================================
  /*
    Les devises que la confrontation oppose viennent des OBSERVATIONS, ce qui
    couvre du même coup la boutique, Meta et Google sans liste à tenir à jour.
    On rejoue ici la ligne exacte du moteur d'exécution.
  */
  const observations = [
    obs("shopify.revenue_30d", 12000, "EUR"),
    obs("shopify.aov", 120, "EUR"),
    obs("meta.spend_30d", 4000, "EUR"),
  ];
  const mesurees = devisesMesurees([
    "EUR",
    ...(observations as unknown as Array<{ currency: string | null }>).map((o) => o.currency),
  ]);
  t.check("le moteur n'oppose qu'une devise ici", mesurees, ["EUR"]);

  const verdictDuModele =
    "Votre boutique perd environ 3 200 $ par mois à l'étape du paiement. Le panier moyen est de 120 EUR.";
  const corrige = confronterDevise(verdictDuModele, mesurees);
  t.check("le verdict est corrigé, pas amputé", corrige.retire.length, 0);
  t.check("…et il porte maintenant la bonne devise", corrige.texte.includes("3 200 EUR"), true);
  t.check("…sans toucher à ce qui était juste", corrige.texte.includes("120 EUR"), true);
});
