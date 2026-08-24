/**
 * CE QUE LE MARCHAND LIT QUAND QUELQUE CHOSE ÉCHOUE.
 *
 * LE DÉFAUT, ÉCRIT QUINZE FOIS À L'IDENTIQUE :
 *
 *     toast.error(err instanceof Error ? err.message : "Votre boutique n'a pas
 *                 pu être enregistrée. Vos réponses sont toujours à l'écran…")
 *
 * La phrase de droite est écrite pour un marchand : elle dit ce qui s'est
 * passé, de quel côté vient le problème, et ce qu'il reste à faire. Elle n'a
 * JAMAIS été affichée. `donneesOuLeve` construit une vraie `Error` à partir de
 * la réponse PostgREST — c'était même son objet — donc `err instanceof Error`
 * est vrai à chaque échec de lecture ou d'écriture, et c'est le message de
 * Postgres qui gagne. En anglais, avec le nom de la table :
 *
 *     new row violates row-level security policy for table "stores"
 *     permission denied for column access_token_ciphertext
 *
 * Le même chemin remonte « AI Gateway 503: … », « Meta API 400: {…} » et
 * « GOOGLE_ADS_DEVELOPER_TOKEN manquant » — un nom de secret de serveur, dans
 * une notification, à quelqu'un qui n'y a aucun accès.
 *
 * POURQUOI UNE LISTE DE SIGNATURES ICI, ALORS QU'UNE LISTE NOIRE PERD TOUJOURS.
 * Parce que le corpus n'est pas le même. Le texte d'un modèle est un ensemble
 * OUVERT : il peut reformuler indéfiniment, et c'est pour cela que
 * `faits-opposables.ts` décrit le sujet plutôt que d'énumérer les tournures.
 * Les messages levés par notre propre code sont un ensemble FERMÉ et
 * dénombrable : `tests/ui/messages-serveur.test.ts` les relève tous dans les
 * sources et vérifie le classement de chacun. Un message technique ajouté
 * demain fait échouer ce test tant que personne n'a tranché son sort.
 *
 * LE TEXTE TECHNIQUE N'EST PAS PERDU : il part dans la console du navigateur et
 * reste dans le journal du serveur, où il sert à qui peut agir dessus.
 */

/** Erreur enrichie par `donneesOuLeve` : la présence de ces champs signe PostgREST. */
type ErreurPeutEtreTechnique = {
  message?: unknown;
  code?: unknown;
  status?: unknown;
};

/**
 * Signatures qui désignent un texte de machine.
 *
 * Chacune vient d'un message réellement levé par ce dépôt, ou réellement reçu
 * d'un partenaire. Aucune n'est préventive.
 */
const SIGNATURES_TECHNIQUES: ReadonlyArray<RegExp> = [
  // Un code HTTP. Nos phrases n'en portent jamais — c'est une règle du produit.
  /\b[45]\d{2}\b/,
  // Nom de variable d'environnement : deux segments capitales séparés par `_`.
  /\b[A-Z][A-Z0-9]{2,}(?:_[A-Z0-9]+)+\b/,
  // Vocabulaire de PostgreSQL et de PostgREST.
  /permission denied|row-level security|duplicate key|violates |relation "|column "|JSON object requested|PGRST/i,
  // Vocabulaire de transport et de sérialisation.
  /\b(?:Unauthorized|Bearer|fetch failed|NetworkError|Internal Server Error|HTTP|JSON|SQL|stack trace)\b/i,
  // Un jeton, un secret, une clé — nommés comme tels.
  /\b(?:token|jeton d'accès|access_token|refresh_token|api[_ -]?key|secret)\b/i,
  // Le résultat d'un `String(objet)` : le défaut que les pages OAuth ont déjà payé.
  /\[object [A-Za-z]+\]/,
  // Un corps de réponse brut, JSON ou HTML.
  /^\s*[{[<]/,
  // Une adresse technique.
  /https?:\/\//i,
  // Le nom d'un partenaire suivi de sa ponctuation d'API : « Meta API : », « Shopify: ».
  /\b(?:AI Gateway|Meta API|Google Ads API|Shopify)\s*[:(]/,
];

/** `true` si ce texte a été écrit par une machine, pour une machine. */
export function texteTechnique(texte: string): boolean {
  return SIGNATURES_TECHNIQUES.some((s) => s.test(texte));
}

/**
 * `true` si l'erreur vient de la base plutôt que d'une décision de notre code.
 *
 * `donneesOuLeve` recopie `code` et `status` sur l'erreur qu'elle lève : leur
 * présence suffit, quel que soit le texte. Une politique d'accès peut très bien
 * répondre en français un jour ; ce n'est pas pour autant une phrase écrite
 * pour le marchand.
 */
function vientDeLaBase(erreur: unknown): boolean {
  if (!erreur || typeof erreur !== "object") return false;
  const e = erreur as ErreurPeutEtreTechnique;
  return typeof e.code === "string" || typeof e.status === "number";
}

/**
 * Le message à afficher : celui de l'erreur s'il a été écrit pour un marchand,
 * sinon le repli fourni par l'écran.
 *
 * `repli` n'est pas un message générique de secours : c'est la phrase que
 * l'écran a écrite pour CE geste précis. Elle dit ce qui n'a pas eu lieu et ce
 * qui reste vrai — « vos réponses sont toujours à l'écran », « la source reste
 * branchée ». Aucun texte de partenaire ne dira jamais cela.
 */
export function messageMarchand(erreur: unknown, repli: string): string {
  const texte =
    erreur instanceof Error
      ? erreur.message
      : typeof erreur === "string"
        ? erreur
        : typeof (erreur as ErreurPeutEtreTechnique)?.message === "string"
          ? String((erreur as ErreurPeutEtreTechnique).message)
          : "";

  const utilisable = texte.trim();
  if (!utilisable) return repli;

  // Un pavé n'est pas une phrase : au-delà, c'est une trace, pas un message.
  const technique = vientDeLaBase(erreur) || utilisable.length > 400 || texteTechnique(utilisable);
  if (!technique) return utilisable;

  // ÉCARTÉ N'EST PAS PERDU. Sans cette ligne, le seul endroit où la cause réelle
  // était lisible disparaîtrait avec le message. La console du navigateur est la
  // destination toujours disponible ; en test il n'y a pas de fenêtre, donc pas
  // de bruit.
  if (typeof window !== "undefined") {
    console.error(`[EcomPilot] échec technique masqué à l'écran : ${utilisable}`, erreur);
  }
  return repli;
}
