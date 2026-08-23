/**
 * LES ERREURS D'AUTHENTIFICATION, DITES À QUELQU'UN QUI N'EST PAS DÉVELOPPEUR.
 *
 * POURQUOI CE MODULE EXISTE. Supabase renvoie ses erreurs en anglais et en
 * vocabulaire technique : « Invalid login credentials », « User already
 * registered », « Email not confirmed ». Elles étaient affichées telles quelles.
 *
 * Trois conséquences, toutes coûteuses au pire moment — celui où l'utilisateur
 * n'est pas encore client. Il ne comprend pas ce qui s'est passé. Il ne sait pas
 * quoi faire ensuite. Et il en déduit, à raison, que le produit n'a pas été fini.
 *
 * LA RÈGLE : chaque message dit ce qui s'est passé ET le geste suivant. Un
 * message qui décrit un échec sans dire comment en sortir n'aide personne ; il
 * ne fait que déplacer la frustration.
 *
 * CE QU'AUCUN MESSAGE NE FAIT ICI. Distinguer « cet e-mail n'existe pas » de
 * « le mot de passe est faux ». Les deux rendent la même phrase, délibérément :
 * répondre différemment permettrait de découvrir quels e-mails ont un compte
 * chez nous, un par un.
 *
 * Module PUR : il traduit, il n'appelle rien.
 */

export type AuthErrorKind =
  | "identifiants"
  | "email_non_confirme"
  | "deja_inscrit"
  | "mot_de_passe_faible"
  | "email_invalide"
  | "trop_de_tentatives"
  | "reseau"
  | "inconnu";

/**
 * Reconnaît une erreur à partir de son message d'origine.
 *
 * Fondé sur des fragments plutôt que sur des codes : Supabase ne garantit pas de
 * codes stables sur toutes ses versions, alors que ces phrases-là bougent peu.
 * Une erreur non reconnue tombe sur `inconnu`, qui reste utilisable — c'est
 * préférable à un message précis mais faux.
 */
export function classifyAuthError(raw: string): AuthErrorKind {
  const m = raw.toLowerCase();
  if (m.includes("invalid login") || m.includes("invalid credentials")) return "identifiants";
  if (m.includes("email not confirmed") || m.includes("not confirmed")) return "email_non_confirme";
  if (m.includes("already registered") || m.includes("already been registered")) {
    return "deja_inscrit";
  }
  if (m.includes("password should be") || m.includes("weak password")) return "mot_de_passe_faible";
  if (m.includes("invalid email") || m.includes("unable to validate email"))
    return "email_invalide";
  if (m.includes("rate limit") || m.includes("too many")) return "trop_de_tentatives";
  if (m.includes("fetch") || m.includes("network") || m.includes("failed to fetch"))
    return "reseau";
  return "inconnu";
}

const MESSAGES: Record<AuthErrorKind, string> = {
  // Volontairement identique pour un e-mail inconnu et un mot de passe faux.
  identifiants:
    "L'adresse e-mail ou le mot de passe ne correspond pas. Vérifiez les deux, ou utilisez « Mot de passe oublié » si vous avez un doute.",
  email_non_confirme:
    "Votre compte existe, mais il n'est pas encore confirmé. Ouvrez le lien reçu par e-mail, puis revenez vous connecter.",
  deja_inscrit:
    "Un compte existe déjà avec cette adresse. Connectez-vous plutôt, ou demandez un nouveau mot de passe si vous l'avez oublié.",
  mot_de_passe_faible:
    "Ce mot de passe est trop court. Choisissez-en un d'au moins huit caractères.",
  email_invalide: "Cette adresse e-mail ne semble pas valide. Vérifiez la saisie.",
  trop_de_tentatives:
    "Trop de tentatives en peu de temps. Attendez une minute avant de réessayer — c'est une protection, votre compte n'est pas bloqué.",
  reseau:
    "La connexion n'a pas abouti. Vérifiez votre accès à internet, puis réessayez dans un instant.",
  inconnu:
    "Quelque chose n'a pas fonctionné. Réessayez dans un instant ; si cela se reproduit, contactez-nous.",
};

/** Le message à afficher, à partir de l'erreur brute. */
export function authErrorMessage(raw: unknown): string {
  const texte = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : "";
  return MESSAGES[classifyAuthError(texte)];
}

/**
 * Ce qu'il faut afficher après une inscription.
 *
 * LE DÉFAUT QUE CETTE FONCTION CORRIGE. L'écran annonçait « Compte créé !
 * Bienvenue » puis envoyait l'utilisateur sur une page protégée — y compris
 * quand Supabase exige une confirmation par e-mail et ne rend donc AUCUNE
 * session. La page protégée renvoyait alors vers la connexion, où le compte
 * fraîchement créé était refusé faute de confirmation. L'utilisateur bouclait,
 * avec un message de succès en mémoire.
 *
 * La présence d'une session est la seule chose qui distingue les deux cas. Elle
 * est donc lue, et non supposée.
 */
export function signupOutcome(session: unknown): "connecte" | "confirmation_requise" {
  return session ? "connecte" : "confirmation_requise";
}

export const CONFIRMATION_TITLE = "Vérifiez votre boîte e-mail";

export function confirmationMessage(email: string): string {
  return `Nous avons envoyé un lien de confirmation à ${email}. Ouvrez-le pour activer votre compte — sans cette étape, la connexion sera refusée. Pensez à regarder dans les indésirables.`;
}

/**
 * Force du mot de passe, dite sans jargon.
 *
 * Aucune exigence de majuscule, de chiffre ou de caractère spécial : ces règles
 * produisent surtout des mots de passe notés sur un papier. Seule la longueur
 * est exigée, parce que c'est la seule qui compte vraiment.
 */
export const MIN_PASSWORD_LENGTH = 8;

export function passwordHint(password: string): { ok: boolean; text: string } {
  if (password.length === 0)
    return { ok: false, text: `Au moins ${MIN_PASSWORD_LENGTH} caractères` };
  if (password.length < MIN_PASSWORD_LENGTH) {
    const reste = MIN_PASSWORD_LENGTH - password.length;
    return { ok: false, text: `Encore ${reste} caractère${reste > 1 ? "s" : ""}` };
  }
  return { ok: true, text: "Assez long" };
}
