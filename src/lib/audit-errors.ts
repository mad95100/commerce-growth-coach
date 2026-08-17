/**
 * POURQUOI UN AUDIT A ÉCHOUÉ, DIT AU MARCHAND.
 *
 * POURQUOI CE MODULE EXISTE. Quand un audit échoue, l'écran affichait le
 * message technique tel quel. Le nôtre disait, mot pour mot :
 *
 *   « AI Gateway 404: models/gemini-2.5-pro is no longer available to new
 *     users. Please update your code to use a newer model. »
 *
 * Le marchand lit « update your code » et comprend qu'on lui demande de
 * programmer. Il ne peut rien faire — c'était notre configuration, pas la
 * sienne — et rien ne le lui dit. C'est le pire moment pour ce genre de
 * message : il vient de lancer son audit et d'attendre.
 *
 * DEUX QUESTIONS, TOUJOURS. Est-ce que cela vient de moi ou d'eux ? Et
 * qu'est-ce que je fais maintenant ? Un message d'échec qui ne répond pas aux
 * deux ne sert qu'à prouver qu'on a détecté l'échec.
 *
 * LE MESSAGE TECHNIQUE N'EST PAS PERDU. Il reste en base et dans les journaux,
 * où il sert à qui peut agir dessus. Il ne s'affiche simplement plus à qui ne le
 * peut pas.
 *
 * Module PUR.
 */

export type AuditFailureKind =
  | "modele_indisponible"
  | "modele_surcharge"
  | "reponse_invalide"
  | "shopify_expire"
  | "shopify_injoignable"
  | "quota"
  | "trop_de_tentatives"
  | "reseau"
  | "inconnu";

export type AuditFailure = {
  kind: AuditFailureKind;
  /** Ce qui s'est passé, en une phrase. */
  what: string;
  /** À qui incombe la suite. Le marchand doit le savoir tout de suite. */
  whose: "nous" | "vous" | "partenaire";
  /** Le geste, s'il y en a un. */
  next: string;
};

/**
 * Reconnaît la panne à partir du message technique.
 *
 * Fondé sur des fragments : les codes d'erreur des fournisseurs changent plus
 * souvent que leurs phrases, et une panne mal reconnue tombe sur `inconnu`, qui
 * reste honnête. Mieux vaut un message général vrai qu'un message précis faux.
 */
export function classifyAuditFailure(raw: string): AuditFailureKind {
  const m = (raw ?? "").toLowerCase();

  // L'ordre compte : « no longer available » est plus précis que « 404 ».
  if (m.includes("no longer available") || m.includes("model not found")) {
    return "modele_indisponible";
  }
  if (m.includes("ai gateway 404") || m.includes("ai gateway 400")) return "modele_indisponible";
  if (m.includes("ai gateway 429") || m.includes("overloaded") || m.includes("rate limit")) {
    return "modele_surcharge";
  }
  if (/ai gateway 5\d\d/.test(m) || m.includes("unavailable")) return "modele_surcharge";
  if (
    m.includes("réponse ia invalide") ||
    m.includes("invalid json") ||
    m.includes("finish_reason")
  ) {
    return "reponse_invalide";
  }
  if (m.includes("jeton shopify illisible") || m.includes("401") || m.includes("unauthorized")) {
    return "shopify_expire";
  }
  if (m.includes("shopify") && (m.includes("timeout") || m.includes("injoignable"))) {
    return "shopify_injoignable";
  }
  if (m.includes("quota") || m.includes("limite d'audits")) return "quota";
  if (m.includes("tentatives") || m.includes("attempts")) return "trop_de_tentatives";
  if (m.includes("fetch") || m.includes("network") || m.includes("econnreset")) return "reseau";
  return "inconnu";
}

const FAILURES: Record<AuditFailureKind, Omit<AuditFailure, "kind">> = {
  modele_indisponible: {
    what: "Notre moteur d'analyse n'a pas pu être utilisé : le modèle sur lequel il s'appuie n'est plus disponible.",
    whose: "nous",
    next: "Vous n'avez rien à faire — le problème vient de notre configuration, pas de votre boutique. Relancez l'audit dans quelques heures ; votre passage ne vous a pas été décompté.",
  },
  modele_surcharge: {
    what: "Notre fournisseur d'analyse était saturé au moment de votre audit.",
    whose: "partenaire",
    next: "Relancez l'audit dans une dizaine de minutes. C'est passager et cela ne vient ni de vous ni de vos données.",
  },
  reponse_invalide: {
    what: "L'analyse a été produite mais nous n'avons pas pu la lire entièrement.",
    whose: "nous",
    next: "Relancez l'audit : cela suffit presque toujours. Si cela se reproduit deux fois, écrivez-nous — nous regarderons ce que votre boutique a de particulier.",
  },
  shopify_expire: {
    what: "Notre accès à votre boutique Shopify n'est plus valide.",
    whose: "vous",
    next: "Reconnectez votre boutique depuis l'onglet Connexions. Cela arrive quand l'application a été retirée de votre administration Shopify, ou après un changement de mot de passe.",
  },
  shopify_injoignable: {
    what: "Shopify n'a pas répondu pendant que nous récupérions vos données.",
    whose: "partenaire",
    next: "Relancez l'audit dans quelques minutes. Vos données sont intactes ; c'est la lecture qui n'a pas abouti.",
  },
  quota: {
    what: "Vous avez atteint le nombre d'audits inclus dans votre offre pour cette période.",
    whose: "vous",
    next: "Votre compteur repart au début de la prochaine période. Vous pouvez aussi passer à une offre supérieure depuis les réglages.",
  },
  trop_de_tentatives: {
    what: "Nous avons essayé plusieurs fois sans y parvenir, et nous nous sommes arrêtés.",
    whose: "nous",
    next: "Nous préférons nous arrêter plutôt que de tourner en boucle. Vérifiez que votre boutique est bien connectée, puis relancez.",
  },
  reseau: {
    what: "La communication avec l'un de nos services a été interrompue.",
    whose: "nous",
    next: "Relancez l'audit dans un instant.",
  },
  inconnu: {
    what: "L'audit s'est interrompu et nous n'avons pas su dire précisément pourquoi.",
    whose: "nous",
    next: "Relancez-le. Si cela se reproduit, écrivez-nous en indiquant l'heure — nous retrouverons ce qui s'est passé.",
  },
};

const WHOSE_LABEL: Record<AuditFailure["whose"], string> = {
  nous: "Cela vient de chez nous.",
  vous: "Une action de votre part est nécessaire.",
  partenaire: "Cela vient d'un service externe, momentanément.",
};

/** Ce qu'il faut afficher à la place du message technique. */
export function explainAuditFailure(raw: string | null | undefined): AuditFailure {
  const kind = classifyAuditFailure(raw ?? "");
  return { kind, ...FAILURES[kind] };
}

/** La phrase complète, prête à afficher. */
export function auditFailureText(raw: string | null | undefined): string {
  const f = explainAuditFailure(raw);
  return `${f.what} ${WHOSE_LABEL[f.whose]} ${f.next}`;
}

/**
 * Le marchand peut-il utilement relancer tout de suite ?
 *
 * Proposer un bouton « Relancer » sur une panne qui exige une reconnexion
 * enverrait le marchand échouer une seconde fois, et lui ferait croire que le
 * produit tourne en rond.
 */
export function canRetryNow(raw: string | null | undefined): boolean {
  const kind = classifyAuditFailure(raw ?? "");
  return kind !== "shopify_expire" && kind !== "quota";
}
