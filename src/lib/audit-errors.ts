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
  | "configuration_ia"
  | "modele_indisponible"
  | "modele_surcharge"
  | "modele_en_panne"
  | "requete_invalide"
  | "delai_depasse"
  | "donnees_absentes"
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
/**
 * Reconnaît la panne à partir du message technique.
 *
 * LA SOURCE AVANT LA NATURE, ET C'EST TOUT LE CORRECTIF.
 *
 * CE QUE FAISAIT LA VERSION PRÉCÉDENTE. Elle cherchait des fragments dans le
 * message entier, sans jamais se demander D'OÙ il venait :
 *
 *     if (/ai gateway 5\d\d/.test(m) || m.includes("unavailable"))
 *       return "modele_surcharge";
 *     ...
 *     if (m.includes("jeton shopify illisible") || m.includes("401") ||
 *         m.includes("unauthorized")) return "shopify_expire";
 *
 * OR LE MESSAGE CONTIENT LE CORPS BRUT DU FOURNISSEUR. `audit-runner.server.ts`
 * lève `AI Gateway ${status}: ${errText}`, où `errText` est la réponse du
 * fournisseur, mot pour mot. Ce texte peut contenir n'importe quoi.
 *
 * LES DEUX MÉPRISES, DANS LES DEUX SENS, ÉTAIENT ATTEIGNABLES :
 *
 *   · `AI Gateway 401: {"error":"invalid api key"}` — notre clé est refusée.
 *     Aucune règle « ai gateway » ne couvrait 401, mais « unauthorized » figurait
 *     dans la règle Shopify. Le marchand lisait donc « Notre accès à votre
 *     boutique Shopify n'est plus valide. Reconnectez votre boutique. » On
 *     l'envoyait refaire une connexion parfaitement saine, pour une clé qui est
 *     la NÔTRE.
 *
 *   · Shopify renvoie `503 Service Unavailable`. Le mot « unavailable » était
 *     capturé plus haut, sans exiger le contexte du fournisseur d'analyse : le
 *     marchand lisait « Notre fournisseur d'analyse était saturé », un service
 *     qui n'était pour rien dans la panne.
 *
 * CE QUI CHANGE. On identifie d'abord la SOURCE par un marqueur que NOUS
 * écrivons — le préfixe `AI Gateway <code>` est émis par notre propre code, il
 * n'est pas devinable depuis un corps de réponse. Les règles générales ne
 * s'appliquent qu'ensuite, et seulement à ce qui n'a pas déjà été attribué.
 *
 * ET LA SATURATION EST SÉPARÉE DE LA PANNE. Un 429 est une saturation réelle et
 * se réessaie dans dix minutes ; un 500 est une panne du fournisseur et ne se
 * réessaie pas de la même façon. Les confondre faisait attendre le marchand pour
 * rien, ou l'inverse.
 */
export function classifyAuditFailure(raw: string): AuditFailureKind {
  const m = (raw ?? "").toLowerCase();

  // =========================================================================
  // 1. NOTRE CONFIGURATION — reconnue avant tout : c'est notre faute, et aucun
  //    fragment de fournisseur ne doit pouvoir la déguiser.
  // =========================================================================
  if (m.includes("configuration ia absente") || m.includes("configuration ia incomplète")) {
    return "configuration_ia";
  }

  // =========================================================================
  // 2. LE FOURNISSEUR D'ANALYSE — identifié par le préfixe que NOUS écrivons.
  // =========================================================================
  // `AI Gateway <code>:` vient de `audit-runner.server.ts`. Un corps de réponse
  // ne peut pas le fabriquer : c'est ce qui rend l'attribution sûre.
  const passerelle = /ai gateway (\d{3})/.exec(m);
  if (passerelle) {
    const code = Number(passerelle[1]);
    // Le modèle demandé n'existe plus : notre configuration, pas leur charge.
    if (m.includes("no longer available") || m.includes("model not found")) {
      return "modele_indisponible";
    }
    if (code === 404 || code === 400) return "modele_indisponible";
    // 401/403 : c'est NOTRE clé qui est refusée. Jamais Shopify.
    if (code === 401 || code === 403) return "configuration_ia";
    // 402 : le compte que NOUS avons chez le fournisseur ne permet plus
    // l'appel. Rien de passager, et rien qui concerne la boutique.
    if (code === 402) return "configuration_ia";
    /*
      413 / 422 : LA DEMANDE EST REFUSÉE, PAS LE SERVICE EN PANNE.

      Une charge trop volumineuse ou un corps que le fournisseur juge
      inexploitable sont des défauts de CE QUE NOUS ENVOYONS. Ils tombaient
      auparavant dans le repli ci-dessous, et le marchand lisait « Notre
      fournisseur d'analyse a renvoyé une erreur […] Vos données et votre
      boutique ne sont pas en cause ».

      Les deux moitiés de cette phrase étaient fausses à la fois : la panne
      n'était pas chez le fournisseur, et sur un 413 elle tient précisément au
      volume de données de la boutique. On attribuait donc à un tiers un défaut
      qui est le nôtre, en promettant qu'attendre une heure y changerait quelque
      chose — alors que le même audit échouera identiquement.
    */
    if (code === 413 || code === 422) return "requete_invalide";
    // 408 : le fournisseur n'a pas répondu à temps. Ce n'est pas une panne de
    // son service, et cela se relance tout de suite, pas dans une heure.
    if (code === 408) return "delai_depasse";
    // Saturation réelle, et elle seule.
    if (code === 429) return "modele_surcharge";
    // 5xx : le fournisseur est en panne. Ce n'est pas la même chose qu'être
    // saturé, et cela ne se réessaie pas au même rythme.
    if (code >= 500) return "modele_en_panne";
    /*
      TOUT LE RESTE : ON NE SAIT PAS, ET ON LE DIT.

      Cette ligne rendait `modele_en_panne` — c'est-à-dire une AFFIRMATION :
      « le fournisseur a renvoyé une erreur », « cela vient d'un service
      externe », « vos données ne sont pas en cause », « attendez une heure ».
      Quatre assertions, pour un code que ce classificateur n'a jamais vu et sur
      lequel il n'a rien établi.

      C'est exactement le geste que tout ce fichier existe pour empêcher :
      déguiser une cause inconnue en diagnostic. Un code inattendu du
      fournisseur reste un échec dont nous ne savons rien de plus que son
      numéro, et « nous ne savons pas » est la seule phrase vraie disponible.
    */
    return "inconnu";
  }

  // Formulations de saturation sans code, émises par certains fournisseurs.
  if (m.includes("overloaded") || m.includes("rate limit")) return "modele_surcharge";
  if (m.includes("no longer available") || m.includes("model not found")) {
    return "modele_indisponible";
  }

  // =========================================================================
  // 3. LA LECTURE DE LA RÉPONSE — produite par notre propre analyseur.
  // =========================================================================
  if (
    m.includes("réponse ia invalide") ||
    m.includes("réponse ia illisible") ||
    m.includes("invalid json") ||
    m.includes("finish_reason")
  ) {
    return "reponse_invalide";
  }

  // =========================================================================
  // 4. SHOPIFY — exigé nommément. Sans le mot « shopify », aucune de ces
  //    conclusions n'est prononcée : c'est ce qui empêchait un 401 du
  //    fournisseur d'analyse de se transformer en « reconnectez votre boutique ».
  // =========================================================================
  if (m.includes("shopify")) {
    if (
      m.includes("jeton shopify illisible") ||
      m.includes("401") ||
      m.includes("unauthorized") ||
      m.includes("403")
    ) {
      return "shopify_expire";
    }
    if (
      m.includes("timeout") ||
      m.includes("injoignable") ||
      m.includes("unavailable") ||
      /\b5\d\d\b/.test(m)
    ) {
      return "shopify_injoignable";
    }
  }

  // AUCUNE SOURCE BRANCHÉE. L'audit a tourné sur les seuls chiffres saisis à la
  // main : ce n'est pas une panne, et le dire évite d'aller chercher un
  // coupable là où il n'y en a pas.
  if (m.includes("aucune source") || m.includes("aucune donnée")) return "donnees_absentes";

  // =========================================================================
  // 5. NOS PROPRES LIMITES
  // =========================================================================
  if (m.includes("quota") || m.includes("limite d'audits")) return "quota";
  if (m.includes("tentatives") || m.includes("attempts")) return "trop_de_tentatives";
  if (m.includes("fetch") || m.includes("network") || m.includes("econnreset")) return "reseau";

  return "inconnu";
}

const FAILURES: Record<AuditFailureKind, Omit<AuditFailure, "kind">> = {
  configuration_ia: {
    what: "Notre moteur d'analyse n'a pas pu être appelé : son raccordement n'est pas complet de notre côté.",
    whose: "nous",
    next: "Rien à faire de votre côté, et surtout pas de reconnecter votre boutique : elle n'est pas en cause. Relancez l'audit plus tard ; votre passage ne vous a pas été décompté.",
  },
  modele_en_panne: {
    what: "Notre fournisseur d'analyse a renvoyé une erreur.",
    whose: "partenaire",
    next: "Ce n'est pas une saturation passagère : relancez l'audit dans l'heure plutôt que tout de suite. Vos données et votre boutique ne sont pas en cause.",
  },
  requete_invalide: {
    what: "Notre demande d'analyse a été refusée telle que nous l'avions formée.",
    whose: "nous",
    next: "Cela ne vient ni d'une panne ni d'un encombrement : c'est notre façon de préparer la demande qui est en cause, et attendre n'y changerait rien. Nous en avons la trace et c'est à nous de la corriger. Votre passage ne vous a pas été décompté.",
  },
  delai_depasse: {
    what: "Notre fournisseur d'analyse n'a pas répondu dans le temps imparti.",
    whose: "partenaire",
    next: "Relancez l'audit maintenant : un dépassement de délai ne se répète pas systématiquement, et il n'y a rien à attendre. Vos données et votre boutique ne sont pas en cause.",
  },
  donnees_absentes: {
    what: "L'audit n'a trouvé aucune source de données à lire.",
    whose: "vous",
    next: "Connectez Shopify depuis l'onglet Sources de données : sans lui, le diagnostic ne peut s'appuyer que sur les chiffres que vous avez saisis à la main.",
  },
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

/**
 * L'audit raté doit-il être rendu au marchand ?
 *
 * POURQUOI CETTE FONCTION EXISTE. Le message d'échec ci-dessus PROMET, en
 * toutes lettres : « votre passage ne vous a pas été décompté ». Le quota est
 * pourtant prélevé au lancement, et rien ne le rendait quand l'analyse
 * échouait. La phrase était donc fausse, et fausse au pire endroit — un
 * marchand qui vérifie son compteur après une panne venue de chez nous y
 * découvre qu'il a payé notre erreur, après qu'on lui a dit le contraire.
 *
 * LA RÈGLE SUIT « À QUI INCOMBE LA SUITE », déjà établie plus haut. Une panne
 * de notre côté ou de celui d'un fournisseur est rendue. Ce qui demande une
 * action du marchand — un accès Shopify à reconnecter — ne l'est pas : l'audit
 * a bien été tenté avec ce qu'il nous avait donné, et rendre le passage
 * l'inciterait à relancer une analyse qui échouera de la même façon.
 *
 * Le cas du quota atteint ne passe jamais ici : il est refusé avant que le
 * moindre décompte n'ait lieu.
 */
export function shouldRefundAudit(raw: string | null | undefined): boolean {
  return explainAuditFailure(raw).whose !== "vous";
}
