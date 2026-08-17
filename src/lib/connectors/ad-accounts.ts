/**
 * QUEL COMPTE PUBLICITAIRE EST ANALYSÉ, ET QUI L'A CHOISI.
 *
 * LE DÉFAUT QUE CE MODULE EXISTE POUR RENDRE VISIBLE. À la connexion, le retour
 * d'autorisation prend le PREMIER compte publicitaire de la liste et l'utilise
 * pour tout le diagnostic. Personne ne le dit au marchand. Un marchand qui gère
 * deux marques, qui a gardé un compte de test, ou dont l'agence apparaît en
 * premier dans la liste se voit alors expliquer que « ses » campagnes ne
 * convertissent pas — sur un compte qu'il n'utilise pas.
 *
 * C'est la pire forme d'erreur que ce produit puisse commettre : elle ne
 * ressemble pas à une panne. Le rapport est cohérent, chiffré, argumenté, et
 * faux du début à la fin. Le marchand n'a aucun moyen de s'en apercevoir, et
 * s'il le découvre, il ne recroira plus rien de ce que nous écrivons.
 *
 * DEUX RÈGLES, ET ELLES SONT NÉGATIVES.
 *
 * 1. **Un choix fait par défaut se dit.** Quand plusieurs comptes existent, le
 *    produit ne prétend pas avoir choisi : il annonce lequel il a pris et
 *    demande confirmation. Le silence transformerait un tirage au sort en
 *    décision.
 * 2. **Deux devises ne se comparent pas.** Un compte publicitaire en dollars et
 *    une boutique en euros donnent un coût par commande et un retour sur
 *    dépense qui n'existent pas. Le produit le signale au lieu de produire le
 *    chiffre — c'est la même règle que partout ailleurs : mieux vaut une
 *    analyse incomplète et vraie qu'une analyse complète et fausse.
 *
 * Module PUR.
 */

export type AdAccount = {
  id: string;
  /** Nom lisible. Google ne renvoie que des identifiants : il est alors `null`. */
  name: string | null;
  /** Devise du compte, quand la régie la donne. Jamais supposée. */
  currency?: string | null;
  /** Statut renvoyé par la régie. Meta : 1 = actif. */
  status?: number | null;
};

export type AccountChoice = {
  /** Le compte réellement utilisé pour le diagnostic. */
  selected: AdAccount | null;
  /** Tous les comptes auxquels l'autorisation donne accès. */
  accounts: AdAccount[];
  /**
   * Le marchand doit-il confirmer ? Vrai dès qu'il y avait plusieurs comptes :
   * un choix par défaut n'est pas un choix.
   */
  needsConfirmation: boolean;
  /** Ce que l'écran affiche. Toujours rempli, jamais du vocabulaire technique. */
  message: string;
  /**
   * Réserve bloquante, s'il y en a une. Sa présence signifie que les chiffres
   * publicitaires ne doivent pas être rapprochés du chiffre d'affaires.
   */
  warning: string | null;
};

/** Meta marque un compte actif par `1`. Tout le reste est désactivé ou en attente. */
export const META_ACTIVE_STATUS = 1;

/**
 * Ce qu'il faut dire au marchand du compte analysé.
 *
 * `storeCurrency` peut être inconnue — une boutique qui n'a pas encore répondu
 * ne doit pas déclencher une fausse alerte de devise. Sans les deux devises, on
 * ne compare rien et on ne prétend rien.
 */
export function describeAccountChoice(input: {
  accounts: AdAccount[];
  selectedId: string | null;
  storeCurrency: string | null;
  providerLabel: string;
}): AccountChoice {
  const { accounts, selectedId, storeCurrency, providerLabel } = input;

  if (accounts.length === 0) {
    return {
      selected: null,
      accounts,
      needsConfirmation: false,
      message: `Cette autorisation ne donne accès à aucun compte ${providerLabel}. Rien ne peut être analysé de ce côté tant qu'un compte n'y est pas rattaché.`,
      warning: null,
    };
  }

  const selected = accounts.find((a) => a.id === selectedId) ?? null;

  // UN COMPTE DÉSIGNÉ QUI N'EXISTE PLUS N'EST PAS UN COMPTE. Il a pu être
  // fermé, ou retiré de l'autorisation depuis la connexion.
  if (selectedId && !selected) {
    return {
      selected: null,
      accounts,
      needsConfirmation: true,
      message: `Le compte ${providerLabel} analysé jusqu'ici n'est plus accessible. Choisissez celui à utiliser.`,
      warning: null,
    };
  }

  if (accounts.length === 1) {
    const seul = accounts[0]!;
    return {
      selected: selected ?? seul,
      accounts,
      needsConfirmation: false,
      message: `Analyse du compte ${nom(seul)}. C'est le seul auquel cette autorisation donne accès.`,
      warning: devise(selected ?? seul, storeCurrency, providerLabel),
    };
  }

  // PLUSIEURS COMPTES : le choix par défaut est annoncé comme tel.
  return {
    selected,
    accounts,
    needsConfirmation: true,
    message: selected
      ? `Cette autorisation donne accès à ${accounts.length} comptes ${providerLabel}. Nous analysons ${nom(selected)}, choisi automatiquement — vérifiez que c'est bien celui de cette boutique.`
      : `Cette autorisation donne accès à ${accounts.length} comptes ${providerLabel}. Indiquez celui de cette boutique : tant qu'il n'est pas choisi, rien n'est analysé de ce côté.`,
    warning: selected ? devise(selected, storeCurrency, providerLabel) : null,
  };
}

function nom(a: AdAccount): string {
  return a.name && a.name.trim().length > 0 ? `« ${a.name} »` : `nº ${a.id}`;
}

/**
 * La réserve de devise.
 *
 * Elle ne dit pas « attention » : elle dit ce qui deviendrait faux. Un marchand
 * à qui l'on annonce un coût par commande calculé sur deux devises prendra une
 * décision de budget dessus.
 */
function devise(
  account: AdAccount,
  storeCurrency: string | null,
  providerLabel: string,
): string | null {
  const compte = account.currency?.trim().toUpperCase();
  const boutique = storeCurrency?.trim().toUpperCase();
  if (!compte || !boutique || compte === boutique) return null;
  return `Ce compte ${providerLabel} dépense en ${compte} alors que votre boutique encaisse en ${boutique}. Nous ne rapprochons pas les deux : un coût par commande calculé sur deux devises serait un chiffre inventé. Les montants publicitaires restent affichés dans leur devise d'origine.`;
}

/**
 * Le compte à retenir par défaut à la connexion.
 *
 * Prend le premier compte ACTIF plutôt que le premier de la liste : proposer
 * d'emblée un compte désactivé garantit un diagnostic vide et une impression de
 * produit cassé. Reste un choix par défaut — il sera annoncé comme tel.
 */
export function defaultAccount(accounts: AdAccount[]): AdAccount | null {
  if (accounts.length === 0) return null;
  const actif = accounts.find((a) => a.status == null || a.status === META_ACTIVE_STATUS);
  return actif ?? accounts[0]!;
}
