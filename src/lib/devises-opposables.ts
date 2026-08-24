/**
 * LA DEVISE ÉCRITE PAR LE MODÈLE, CONFRONTÉE À CELLES QUE NOUS AVONS MESURÉES.
 *
 * LE DÉFAUT. Le bloc de données envoyé au modèle est irréprochable : chaque
 * canal y annonce SA devise, et un avertissement interdit d'additionner deux
 * devises. Mais cette rigueur s'arrête aux CHAMPS CHIFFRÉS. Le verdict, le
 * résumé, la cause racine et la description d'impact sont du texte libre, et
 * rien ne relisait ce que le modèle y écrivait. Une boutique en euros pouvait
 * donc lire « environ 900 $ perdus par mois » dans un produit d'analyse
 * financière — un montant juste, dans une unité fausse.
 *
 * CE QUI REND LA RÈGLE DÉCIDABLE. Le modèle ne voit AUCUN montant hors du bloc
 * que nous construisons, et ce bloc ne contient que des devises réellement
 * relevées : celle de la boutique, celle du compte Meta, celle du compte
 * Google. Une devise qui n'y figure pas n'a donc pas pu être lue quelque part :
 * elle a été inventée. Ce n'est pas un jugement de vraisemblance, c'est une
 * constatation.
 *
 * DEUX SITUATIONS, DEUX TRAITEMENTS — et la différence est la seule chose qui
 * compte ici :
 *
 * - UNE SEULE DEVISE MESURÉE. Tous les chiffres que le modèle a vus étaient
 *   dans cette devise. Le nombre est donc bon et seule l'étiquette est fausse :
 *   on corrige l'étiquette. C'est démontré, pas supposé.
 *
 * - PLUSIEURS DEVISES MESURÉES. Le nombre peut venir de l'une ou de l'autre, et
 *   rien dans le texte ne dit laquelle. Corriger reviendrait à choisir au
 *   hasard une affirmation financière. La phrase est retirée, comme le fait
 *   déjà `confronter` pour une affirmation qui contredit une mesure : un blanc
 *   se remarque, un chiffre faux se croit.
 *
 * AUCUNE CONVERSION, JAMAIS. Ce module ne connaît aucun taux de change et n'en
 * appliquera aucun. Il ne touche qu'à l'étiquette, jamais au nombre.
 */

import { normalizeCurrency } from "@/lib/currency";

/**
 * Symboles monétaires courants et le code qu'ils désignent.
 *
 * Cette table ne décide PAS quelles devises existent — `currency.ts` accepte
 * tout code ISO valide, sans liste. Elle sert uniquement à lire ce qu'un modèle
 * a écrit : un symbole est ambigu par nature (« $ » vaut pour plusieurs
 * dollars), on retient la lecture la plus commune, et la comparaison qui suit
 * fait le reste — un symbole résolu vers une devise que nous avons mesurée est
 * laissé intact, quel que soit le dollar dont il s'agissait.
 */
const SYMBOLES: ReadonlyArray<{ symbole: string; code: string }> = [
  { symbole: "$", code: "USD" },
  { symbole: "€", code: "EUR" },
  { symbole: "£", code: "GBP" },
  { symbole: "¥", code: "JPY" },
  { symbole: "₹", code: "INR" },
  { symbole: "₽", code: "RUB" },
  { symbole: "₺", code: "TRY" },
  { symbole: "R$", code: "BRL" },
];

/**
 * Une marque de devise dans une phrase : un symbole, ou un code ISO accolé à un
 * nombre.
 *
 * POURQUOI LE CODE DOIT ÊTRE ACCOLÉ À UN NOMBRE. Trois majuscules isolées ne
 * sont pas nécessairement une devise — « TVA », « CGV », « SEO » n'en sont pas.
 * Adossée à un montant, la même suite ne peut plus être qu'une unité.
 */
const MARQUE =
  /(?:R\$|[$\u20AC\u00A3\u00A5\u20B9\u20BD\u20BA])|(?<=\d[\d\u0020\u00A0\u202F.,]*)\s?[A-Z]{3}\b|\b[A-Z]{3}(?=\s?\d)/g;

/** Code désigné par une marque relevée, ou `null` si elle n'en désigne aucun. */
function codeDeLaMarque(marque: string): string | null {
  const nu = marque.trim();
  const parSymbole = SYMBOLES.find((s) => s.symbole === nu);
  if (parSymbole) return parSymbole.code;
  return normalizeCurrency(nu);
}

/**
 * Les devises que nos mesures portent réellement.
 *
 * L'ordre n'a pas d'importance ; les doublons et les valeurs illisibles sont
 * écartés. Une entrée `null` — devise non déterminée — n'entre pas : elle ne
 * peut ni autoriser une marque, ni servir de correction.
 */
export function devisesMesurees(brutes: ReadonlyArray<string | null | undefined>): string[] {
  const vues = new Set<string>();
  for (const b of brutes) {
    const code = normalizeCurrency(b);
    if (code) vues.add(code);
  }
  return [...vues];
}

export type ConfrontationDevise = {
  /** Le texte, étiquettes corrigées et phrases indécidables retirées. */
  texte: string;
  /** Ce qui a été corrigé, pour le journal. */
  corrige: string[];
  /** Ce qui a été retiré faute de pouvoir trancher, pour le journal. */
  retire: string[];
};

/** Découpe en phrases, en gardant leur ponctuation finale. */
function phrases(texte: string): string[] {
  return texte
    .split(/(?<=[.!?…])\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Confronte les devises d'un texte à celles que nous avons mesurées.
 *
 * Sans aucune devise mesurée, rien n'est décidable : le texte revient intact.
 * Refuser en bloc reviendrait à supprimer des phrases sur la foi d'une ignorance.
 */
export function confronterDevise(texte: string, mesurees: string[]): ConfrontationDevise {
  if (!texte.trim() || mesurees.length === 0) return { texte, corrige: [], retire: [] };

  const connues = new Set(mesurees);
  const seule = mesurees.length === 1 ? mesurees[0] : null;
  const corrige: string[] = [];
  const retire: string[] = [];

  const gardees: string[] = [];
  for (const phrase of phrases(texte)) {
    const inventees = [...phrase.matchAll(MARQUE)]
      .map((m) => codeDeLaMarque(m[0]))
      .filter((c): c is string => c !== null && !connues.has(c));

    if (inventees.length === 0) {
      gardees.push(phrase);
      continue;
    }

    if (seule === null) {
      // Plusieurs devises mesurées : le nombre est peut-être juste, mais rien
      // ne dit dans laquelle il est libellé. On ne devine pas un montant.
      retire.push(phrase);
      continue;
    }

    const reecrite = phrase.replace(MARQUE, (m) => {
      const code = codeDeLaMarque(m);
      if (code === null || connues.has(code)) return m;
      // L'espace éventuel qui précédait la marque est conservé : « 900 $ »
      // devient « 900 EUR », jamais « 900EUR ».
      return m.startsWith(" ") ? ` ${seule}` : seule;
    });
    corrige.push(`${phrase} → ${reecrite}`);
    gardees.push(reecrite);
  }

  return { texte: gardees.join(" "), corrige, retire };
}
