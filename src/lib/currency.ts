/**
 * Devises : identification, formatage, et refus des mélanges.
 *
 * PRINCIPE. Le système n'a pas de liste de devises. Toute devise valide
 * renvoyée par Shopify, Meta Ads, Google Ads ou une autre plateforme intégrée
 * est acceptée et conservée telle quelle, sous son code ISO 4217.
 *
 * POURQUOI PAS DE LISTE. Une liste codée en dur rejetterait une devise
 * pourtant réelle — une boutique sur un marché non prévu, une devise
 * nouvellement émise, un renommage. Le rejet serait silencieux et arbitraire.
 * La forme alphabétique d'ISO 4217 est trois lettres : c'est la seule règle
 * structurelle qui existe, et c'est donc la seule que l'on applique.
 *
 * POURQUOI PAS `Intl` POUR VALIDER. `Intl.NumberFormat` lève sur un code
 * inconnu de sa base ICU, laquelle suit les mises à jour avec retard. Valider
 * par ICU reviendrait à réintroduire une liste, simplement écrite ailleurs.
 * ICU n'est donc utilisé que pour FORMATER, avec un repli quand il ne connaît
 * pas le code.
 *
 * AUCUNE CONVERSION. Ce module ne convertit rien et ne connaît aucun taux de
 * change. Deux montants de devises différentes ne sont pas comparables : toute
 * tentative lève `CurrencyMismatchError` plutôt que de produire un nombre faux.
 */

/** Forme alphabétique d'ISO 4217 : exactement trois lettres. */
const ISO_4217_ALPHA = /^[A-Z]{3}$/;

/** Affiché partout où la devise d'un montant n'a pas pu être déterminée. */
export const UNDETERMINED_CURRENCY_LABEL = "Devise non déterminée";

/**
 * Ramène une valeur quelconque à un code ISO 4217, ou `null`.
 *
 * `null` signifie « indéterminée », jamais « euro par défaut ». Aucun appelant
 * ne doit substituer une devise à une absence.
 */
export function normalizeCurrency(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return ISO_4217_ALPHA.test(code) ? code : null;
}

/** `true` si la valeur est un code de devise exploitable. */
export function isCurrencyCode(raw: unknown): boolean {
  return normalizeCurrency(raw) !== null;
}

/** Un montant n'a de sens qu'accompagné de sa devise. */
export type Money = {
  amount: number;
  /** Code ISO 4217, ou `null` si indéterminée. */
  currency: string | null;
};

export function money(amount: number, currency: unknown): Money {
  return { amount, currency: normalizeCurrency(currency) };
}

/** Levée dès qu'un calcul mélangerait deux devises, ou porterait sur une devise inconnue. */
export class CurrencyMismatchError extends Error {
  readonly left: string | null;
  readonly right: string | null;

  constructor(operation: string, left: string | null, right: string | null) {
    const describe = (c: string | null) => c ?? "devise inconnue";
    super(
      `Opération « ${operation} » impossible entre ${describe(left)} et ${describe(right)} : ` +
        `aucune conversion n'est disponible. Les montants doivent être dans la même devise.`,
    );
    this.name = "CurrencyMismatchError";
    this.left = left;
    this.right = right;
  }
}

/**
 * `true` si les deux montants portent la même devise, connue.
 *
 * Deux devises indéterminées ne sont PAS réputées identiques : on ignore ce
 * qu'elles sont, donc on ignore si elles coïncident.
 */
export function sameCurrency(a: Money, b: Money): boolean {
  return a.currency !== null && b.currency !== null && a.currency === b.currency;
}

/** Barrière obligatoire avant toute comparaison, somme, différence ou marge. */
export function assertSameCurrency(a: Money, b: Money, operation: string): void {
  if (!sameCurrency(a, b)) throw new CurrencyMismatchError(operation, a.currency, b.currency);
}

/** Somme de deux montants de même devise. Lève sinon. */
export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b, "addition");
  return { amount: a.amount + b.amount, currency: a.currency };
}

/** Différence de deux montants de même devise. Lève sinon. */
export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b, "soustraction");
  return { amount: a.amount - b.amount, currency: a.currency };
}

/**
 * Comparaison de deux montants de même devise.
 * Renvoie un nombre négatif, nul ou positif, à la manière d'un comparateur.
 */
export function compareMoney(a: Money, b: Money): number {
  assertSameCurrency(a, b, "comparaison");
  return a.amount - b.amount;
}

/**
 * Formate un montant avec sa devise.
 *
 * Devise inconnue d'ICU : on écrit le code tel quel plutôt que d'échouer — une
 * devise réelle mais récente doit rester lisible.
 */
export function formatMoney(value: number | null | undefined, currency: string | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value);
  const code = normalizeCurrency(currency);

  if (code === null) {
    return `${rounded.toLocaleString("fr-FR")} (${UNDETERMINED_CURRENCY_LABEL})`;
  }

  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 0,
    }).format(rounded);
  } catch {
    return `${rounded.toLocaleString("fr-FR")} ${code}`;
  }
}

/** Formate un objet `Money`. */
export function formatMoneyValue(value: Money | null | undefined): string {
  if (!value) return "—";
  return formatMoney(value.amount, value.currency);
}

/** Libellé d'une devise seule, pour une étiquette de champ ou un en-tête. */
export function currencyLabel(currency: string | null): string {
  return normalizeCurrency(currency) ?? UNDETERMINED_CURRENCY_LABEL;
}
