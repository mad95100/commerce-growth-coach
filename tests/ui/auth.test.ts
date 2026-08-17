import { readFileSync } from "node:fs";
import { defineSuite } from "../harness";
import {
  CONFIRMATION_TITLE,
  MIN_PASSWORD_LENGTH,
  authErrorMessage,
  classifyAuthError,
  confirmationMessage,
  passwordHint,
  signupOutcome,
} from "@/lib/auth-messages";

/**
 * LE PREMIER ÉCRAN, CELUI QU'ON NE VOIT QU'UNE FOIS.
 *
 * LE DÉFAUT QUI JUSTIFIE CETTE SUITE. L'inscription affichait « Compte créé !
 * Bienvenue » puis envoyait l'utilisateur sur une page protégée — y compris
 * quand Supabase exige une confirmation par e-mail et ne rend donc AUCUNE
 * session. La page protégée renvoyait vers la connexion, qui refusait le compte
 * tout juste créé faute de confirmation. L'utilisateur bouclait, avec un message
 * de succès en mémoire.
 *
 * C'est le pire endroit possible pour un défaut : il frappe quelqu'un qui n'est
 * pas encore client, au moment exact où il décide si le produit est sérieux.
 *
 * Le second sujet est le vocabulaire. Supabase répond en anglais technique —
 * « Invalid login credentials » — et c'était affiché tel quel. Un message qui
 * décrit un échec sans dire comment en sortir ne fait que déplacer la
 * frustration.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");

export default defineSuite("Interface — inscription et connexion", (t) => {
  // --- 1. La session est LUE, jamais supposée ------------------------------
  t.check(
    "sans session, une confirmation est requise",
    signupOutcome(null),
    "confirmation_requise",
  );
  t.check("sans session (undefined non plus)", signupOutcome(undefined), "confirmation_requise");
  t.check(
    "avec session, l'utilisateur est connecté",
    signupOutcome({ access_token: "x" }),
    "connecte",
  );

  const page = read("src/routes/auth.tsx");
  t.check(
    "l'écran distingue les deux issues d'inscription",
    /signupOutcome\(data\.session\) === "confirmation_requise"/.test(page),
    true,
  );
  // LE CONTRÔLE DÉCISIF : aucune navigation vers une page protégée avant de
  // savoir si une session existe.
  const posControle = page.indexOf("signupOutcome(data.session)");
  const posNav = page.indexOf('navigate({ to: "/onboarding" })');
  t.check("le contrôle précède la navigation", posControle > 0 && posControle < posNav, true);
  t.check("l'écran d'attente remplace le formulaire", /if \(sent\) \{/.test(page), true);
  t.check("le titre d'attente vient du module", page.includes("CONFIRMATION_TITLE"), true);

  // Le message d'attente doit dire quoi faire, et prévenir de l'échec sinon.
  const msg = confirmationMessage("alex@exemple.com");
  t.check("le message nomme l'adresse", msg.includes("alex@exemple.com"), true);
  t.check("il annonce que la connexion échouerait sans cette étape", /refusée/.test(msg), true);
  t.check("il pense aux indésirables", /indésirables/.test(msg), true);
  t.check("le titre est une instruction", CONFIRMATION_TITLE.length > 10, true);

  // --- 2. Les erreurs sont traduites, avec le geste suivant ---------------
  const cas: Array<[string, string]> = [
    ["Invalid login credentials", "identifiants"],
    ["Email not confirmed", "email_non_confirme"],
    ["User already registered", "deja_inscrit"],
    ["Password should be at least 6 characters", "mot_de_passe_faible"],
    ["Unable to validate email address: invalid format", "email_invalide"],
    ["Email rate limit exceeded", "trop_de_tentatives"],
    ["Failed to fetch", "reseau"],
    ["quelque chose d'inattendu", "inconnu"],
  ];
  for (const [brut, attendu] of cas) {
    t.check(`« ${brut} » est reconnu`, classifyAuthError(brut), attendu);
    const message = authErrorMessage(new Error(brut));
    t.check(`« ${brut} » produit un message en français`, /[éèàêç]/.test(message), true);
    t.check(
      `« ${brut} » ne laisse passer aucun anglais technique`,
      /credentials|rate limit|fetch|registered/i.test(message),
      false,
    );
    t.check(`« ${brut} » dit quoi faire`, message.length > 50, true);
  }
  // Une erreur non reconnue reste utilisable plutôt que précise et fausse.
  t.check("une erreur vide est traitée", authErrorMessage(null).length > 30, true);
  t.check(
    "une chaîne brute est acceptée",
    authErrorMessage("Invalid login credentials").includes("mot de passe"),
    true,
  );

  // L'ÉNUMÉRATION DES COMPTES EST FERMÉE. Un e-mail inconnu et un mot de passe
  // faux doivent rendre le MÊME message : répondre différemment permettrait de
  // découvrir, une adresse à la fois, qui a un compte chez nous.
  t.check(
    "un mot de passe faux ne révèle pas si le compte existe",
    /n'existe pas|inconnu|aucun compte/i.test(
      authErrorMessage(new Error("Invalid login credentials")),
    ),
    false,
  );
  t.check(
    "la réinitialisation ne révèle pas non plus l'existence du compte",
    /Si un compte existe pour/.test(page),
    true,
  );

  // Le code ne doit plus afficher l'erreur brute.
  t.check(
    "l'erreur brute de Supabase n'est plus affichée",
    /toast\.error\(err instanceof Error \? err\.message/.test(page),
    false,
  );
  t.check(
    "toutes les erreurs passent par la traduction",
    (page.match(/toast\.error\(authErrorMessage\(err\)\)/g) ?? []).length >= 2,
    true,
  );

  // --- 3. La récupération de mot de passe existe --------------------------
  // Sans elle, un utilisateur qui oublie son mot de passe est enfermé dehors
  // définitivement : c'était le cas.
  t.check("un mode « oublié » existe", /"oubli"/.test(page), true);
  t.check("il appelle bien la réinitialisation", /resetPasswordForEmail/.test(page), true);
  t.check("le lien est accessible depuis la connexion", /Oublié \?/.test(page), true);
  t.check(
    "il revient sur la page d'authentification",
    /redirectTo: `\$\{window\.location\.origin\}\/auth`/.test(page),
    true,
  );

  // --- 4. Le mot de passe peut être vérifié à l'œil -----------------------
  // Taper huit caractères à l'aveugle est la première cause d'échec de
  // connexion, et la plus facile à supprimer.
  t.check("la visibilité du mot de passe est basculable", /setShowPassword/.test(page), true);
  t.check(
    "le bouton est nommé pour les lecteurs d'écran",
    /aria-label=\{showPassword \? "Masquer le mot de passe"/.test(page),
    true,
  );
  t.check(
    "l'exigence de longueur vient du module",
    /minLength=\{mode === "signup" \? MIN_PASSWORD_LENGTH/.test(page),
    true,
  );

  // L'indication de longueur est utile, pas moralisatrice.
  t.check(
    "un mot de passe vide annonce l'exigence",
    passwordHint("").text.includes(String(MIN_PASSWORD_LENGTH)),
    true,
  );
  t.check(
    "un mot de passe court dit ce qu'il reste",
    passwordHint("abc").text,
    "Encore 5 caractères",
  );
  t.check("le singulier est respecté", passwordHint("abcdefg").text, "Encore 1 caractère");
  t.check("un mot de passe assez long est validé", passwordHint("abcdefgh").ok, true);
  // Aucune exigence de majuscule ou de caractère spécial : ces règles produisent
  // surtout des mots de passe notés sur un papier.
  t.check("aucune règle de composition n'est imposée", passwordHint("aaaaaaaa").ok, true);

  // --- 5. Le remplissage automatique du navigateur fonctionne -------------
  // Sans `autoComplete`, le gestionnaire de mots de passe ne propose rien, et
  // l'utilisateur retape tout à la main sur mobile.
  for (const attendu of [
    'autoComplete="email"',
    'autoComplete="given-name"',
    'autoComplete={mode === "signup" ? "new-password" : "current-password"}',
  ]) {
    t.check(`${attendu} est renseigné`, page.includes(attendu), true);
  }

  // --- 6. Les quatre états partagent un seul cadre ------------------------
  // Dupliquer le logo et le centrage ferait diverger les écrans au premier
  // ajustement, et la page « sauterait » en passant de l'un à l'autre.
  t.check("un cadre commun existe", /function Cadre\(/.test(page), true);
  t.check("tous les états l'utilisent", (page.match(/<Cadre>/g) ?? []).length >= 3, true);

  // --- 7. Ce que l'utilisateur doit savoir avant de s'inscrire ------------
  // La question qu'il se pose vraiment : « est-ce que cet outil va toucher à ma
  // boutique ? ». Y répondre avant qu'il la pose vaut mieux qu'une page d'aide.
  t.check(
    "la promesse de lecture seule est affichée à l'inscription",
    /Il ne modifie jamais votre boutique/.test(page),
    true,
  );
  t.check("la gratuité du premier audit est dite", /gratuit, sans carte bancaire/.test(page), true);
});
