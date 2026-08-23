import { readdirSync, readFileSync, statSync } from "node:fs";
import { defineSuite } from "../harness";

/**
 * LE PRODUIT PARLE COMME UN CONSULTANT, PAS COMME UNE CHECKLIST.
 *
 * CE QUE CETTE SUITE GARDE. Le vouvoiement est déjà vérifié ailleurs, et
 * l'absence de jargon aussi. Ce qui manquait est plus insidieux : des phrases
 * grammaticalement irréprochables, polies, et vides — « il est important de »,
 * « pensez à », « optimisez votre boutique ». Elles ne sont fausses nulle part,
 * ce qui les rend impossibles à corriger par un test de vérité ; elles sont
 * simplement interchangeables d'une boutique à l'autre, et c'est exactement ce
 * qui distingue une checklist d'un diagnostic.
 *
 * LA SECONDE PROTECTION porte sur les consignes envoyées au modèle. Elles
 * ordonnaient « Tutoie l'utilisateur » et « Parle comme un mentor bienveillant »
 * — l'inverse de ce que tout le reste du produit vérifie. Le rapport est le
 * texte le plus lu d'EcomPilot, et il était le seul écrit sous des consignes
 * contraires.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const lire = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");

function fichiersDe(dossier: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(`${ROOT}${dossier}`)) {
    const rel = `${dossier}/${e}`;
    if (statSync(`${ROOT}${rel}`).isDirectory()) out.push(...fichiersDe(rel));
    else if (rel.endsWith(".ts") || rel.endsWith(".tsx")) out.push(rel);
  }
  return out;
}

/** Les commentaires expliquent le code : ils ne s'adressent à aucun marchand. */
const sansCommentaires = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

/**
 * Formules qui ne disent rien de la boutique qu'on regarde.
 *
 * Chacune est vraie de n'importe quel site, donc aucune n'est un diagnostic.
 * Elles sont cherchées dans les ÉCRANS, là où le marchand les lirait — les
 * consignes au modèle les citent au contraire pour les interdire, et le
 * contrôle ne doit pas confondre l'interdiction avec l'infraction.
 */
const FORMULES_CREUSES = [
  "il est important de",
  "pensez à ",
  "optimisez votre boutique",
  "améliorez votre conversion",
  "rendez votre boutique plus attractive",
  "votre boutique n'est pas optimisée",
  "cela peut faire fuir",
  "les visiteurs risquent de",
];

export default defineSuite("Éditorial — le produit parle comme un consultant", (t) => {
  const ecrans = [...fichiersDe("src/routes"), ...fichiersDe("src/components")];
  t.check("le relevé parcourt bien les écrans", ecrans.length >= 30, true);

  for (const chemin of ecrans) {
    const texte = sansCommentaires(lire(chemin)).toLowerCase();
    for (const formule of FORMULES_CREUSES) {
      t.check(`${chemin} ne dit pas « ${formule.trim()} »`, texte.includes(formule), false);
    }
  }

  // =========================================================================
  // LES CONSIGNES AU MODÈLE PORTENT LA MÊME EXIGENCE
  // =========================================================================
  const consignes = lire("src/lib/audit-prompt.ts");
  t.check("elles imposent le vouvoiement", /VOUVOIEMENT partout/.test(consignes), true);
  t.check("…et n'ordonnent plus de tutoyer", /Tutoie l'utilisateur/.test(consignes), false);
  t.check(
    "…et bannissent le ton de mentor encourageant",
    /mentor bienveillant|Encourage systématiquement/.test(consignes),
    false,
  );
  t.check(
    "…et interdisent les formules creuses par leur nom",
    FORMULES_CREUSES.filter((f) => consignes.toLowerCase().includes(f.trim())).length >= 3,
    true,
  );
  t.check(
    "…et rappellent que la portée n'est pas un effet de style",
    /Cinq fiches inspectées ne sont pas "votre catalogue"/.test(consignes),
    true,
  );
  t.check("…et exigent la recopie littérale de la preuve", /MOT POUR MOT/.test(consignes), true);
  t.check(
    "…et interdisent d'inventer un gain",
    /N'inventez JAMAIS une métrique, un pourcentage de gain/.test(consignes),
    true,
  );

  // =========================================================================
  // AUCUN COMPORTEMENT DE VISITEUR SANS MESURE DE COMPORTEMENT
  // =========================================================================
  /*
    LE DÉFAUT, RELEVÉ SUR UN VRAI RAPPORT. Le moteur écrivait « les personnes qui
    arrivent sur votre boutique quittent le site aussitôt » et « l'absence de ces
    pages provoque le refus systématique de vos publicités ». Aucun départ n'a
    été observé, aucun refus publicitaire n'a été constaté : ce sont deux
    conduites prêtées à des gens que personne n'a vus, et une conséquence
    décrétée sans mesure. Elles rendent le rapport spectaculaire et indéfendable
    — la seule chose qu'un consultant ne peut pas se permettre.
  */
  t.check(
    "les consignes interdisent de prêter une conduite aux visiteurs",
    /AUCUN COMPORTEMENT DE VISITEUR SANS MESURE DE COMPORTEMENT/.test(consignes),
    true,
  );
  t.check(
    "…en nommant les formules bannies",
    /les visiteurs quittent le site aussitôt/.test(consignes) &&
      /provoque le refus de vos publicités/.test(consignes),
    true,
  );
  t.check(
    "…et la distinction qui les remplace",
    /ce que le manque EMPÊCHE, jamais ce qu'il DÉCLENCHE/.test(consignes),
    true,
  );
  t.check("…sans dramatisation", /Aucune dramatisation/.test(consignes), true);

  /*
    L'INTERDICTION PORTE SUR LA CLASSE, PAS SUR UNE LISTE DE PHRASES.

    Relevé sur un rapport réel. La consigne bannit nommément « provoque le refus
    de vos publicités ». Le modèle a écrit : « ce manque d'informations
    juridiques et logistiques BLOQUE FRÉQUEMMENT L'APPROBATION de vos comptes
    publicitaires sur les régies comme Google ou Meta ». Même affirmation,
    synonyme différent, aucun refus mesuré — et la règle du moteur portait
    pourtant la version prudente, que le modèle a réécrite.

    Une liste d'exemples se contourne par un synonyme. Ce qui ne se contourne
    pas, c'est un TEST que le modèle doit s'appliquer : quelle mesure de ce
    rapport établit ce lien ? S'il ne peut pas la citer, la phrase tombe, quel
    que soit le verbe.
  */
  t.check(
    "l'interdit s'énonce comme un test, pas comme une liste",
    /QUELLE MESURE de ce rapport l'établit/.test(consignes),
    true,
  );
  t.check(
    "…et le contournement par synonyme est nommé",
    /Reformuler avec un synonyme ne lève pas l'interdiction/.test(consignes),
    true,
  );
  t.check(
    "…avec le contournement réellement constaté cité en exemple",
    /bloque fréquemment l'approbation de vos comptes publicitaires/.test(consignes),
    true,
  );
  t.check(
    "…et la liste est déclarée non limitative",
    /sans que la liste soit limitative/.test(consignes),
    true,
  );
  // La métaphore aussi : « enveloppe vide » est passée entre « muette »,
  // « invisible » et « morte », qui étaient les seules nommées.
  t.check(
    "la dramatisation est interdite par classe",
    /c'est la CLASSE qui est interdite, pas une liste/.test(consignes),
    true,
  );
  // ZÉRO COMMANDE EST UN FAIT ; SA CAUSE EST AUTRE CHOSE. Le rapport écrivait
  // « n'enregistre aucune commande CAR elle est une enveloppe vide », puis
  // déclarait deux paragraphes plus bas ne pas pouvoir trancher entre un
  // problème de trafic et un problème d'achat. Il se contredisait lui-même.
  t.check(
    "une causalité non mesurée est interdite",
    /N'écrivez jamais « X parce que Y » quand Y n'est pas mesuré/.test(consignes),
    true,
  );
  // Et le marchand n'a pas échoué : « vous devez » était dans le verdict.
  t.check(
    "les consignes bannissent « ce que vous devez faire »",
    /jamais « ce que vous devez faire »/.test(consignes),
    true,
  );

  /*
    LES CONSTATS DU MOTEUR SONT OBLIGATOIRES, PAS INDICATIFS.

    LE DÉFAUT, ET C'EST LE PLUS COÛTEUX DE CE CHANTIER. Sur une boutique dont le
    catalogue Shopify est VIDE, le moteur classe en position [1] — le fait le
    mieux établi et le plus lourd du rapport — « Votre boutique ne propose aucun
    produit à la vente ». Le rapport rendu n'en disait pas un mot.

    La règle se déclenchait bien, sortait bien première avec une priorité de 250
    contre 100 au deuxième, et figurait bien dans le bloc envoyé au modèle. Rien
    ne DISAIT au modèle qu'il devait la reprendre. Le bloc s'intitule « source de
    vérité », ce qui se lit comme une documentation où puiser — pas comme une
    liste de ce qu'il faut dire. Le modèle a donc sélectionné, et il a écarté le
    seul fait qui expliquait les quatre autres.
  */
  t.check(
    "les constats du moteur sont déclarés obligatoires",
    /LES CONSTATS DU MOTEUR SONT OBLIGATOIRES, PAS INDICATIFS/.test(consignes),
    true,
  );
  t.check(
    "…chacun donne un problème dans la sortie",
    /CHAQUE constat classé par le moteur donne UN problème dans votre sortie/.test(consignes),
    true,
  );
  t.check(
    "…on peut ajouter, jamais retirer",
    /Vous ne pouvez\s+pas en RETIRER un qu'il a établi/.test(consignes.replace(/\n/g, " ")),
    true,
  );
  t.check(
    "…et un constat mesuré ne redescend pas en hypothèse",
    /ne se dégrade jamais en hypothèse/.test(consignes),
    true,
  );

  /*
    AUCUNE CORRECTION NE PROMET UNE VENTE. Le rapport écrivait « pour débloquer
    votre toute première vente » : nous ne mesurons ni trafic, ni intention, ni
    rien qui permette de promettre une commande.
  */
  t.check(
    "aucune correction ne promet une vente",
    /AUCUNE CORRECTION NE PROMET UNE VENTE/.test(consignes),
    true,
  );

  /*
    OÙ PASSE LA LIGNE, et pourquoi elle devait être écrite noir sur blanc.

    « L'absence de ces éléments de réassurance bloque les décisions d'achat »
    est interdit — c'est une conduite décrétée. Mais « quelqu'un qui découvre la
    boutique doit comprendre seul ce qu'elle vend » est PERMIS, et c'est même la
    formulation que la voix du produit donne en exemple : elle décrit la page,
    pas les gens, et reste vraie même si personne ne visite.

    Sans cette ligne écrite, une correction trop large aurait interdit la
    seconde en même temps que la première, et le rapport n'aurait plus rien pu
    dire d'utile.
  */
  t.check(
    "la ligne entre page et conduite est explicite",
    /OÙ PASSE EXACTEMENT LA LIGNE/.test(consignes),
    true,
  );
  t.check(
    "…avec un test applicable",
    /retirez le mot « visiteur » de votre phrase/.test(consignes),
    true,
  );

  /*
    UNE HYPOTHÈSE PORTE SUR UN FAIT, JAMAIS SUR UNE CONDUITE. Le rapport
    écrivait : « Cette constatation suppose que les visiteurs recherchent des
    éléments rassurants avant de s'engager. » Ce n'est pas une hypothèse de
    travail — c'est une psychologie d'acheteur inventée, présentée comme le
    socle du constat.
  */
  t.check(
    "une hypothèse porte sur un fait vérifiable",
    /UNE HYPOTHÈSE PORTE SUR UN FAIT QU'ON AURAIT PU VÉRIFIER, JAMAIS SUR UNE\s+CONDUITE/.test(
      consignes,
    ),
    true,
  );
  t.check(
    "…et le contre-exemple réellement produit est cité",
    /suppose que les visiteurs\s+recherchent des éléments rassurants/.test(consignes),
    true,
  );
  t.check(
    "…avec les trois conditions, faute de quoi le champ reste vide",
    /Trois conditions, toutes les trois/.test(consignes),
    true,
  );

  /*
    ET SURTOUT : UNE HYPOTHÈSE NE CONTREDIT PAS UN CHIFFRE COMPTÉ.

    Enfreint en production. Sur une boutique dont le catalogue avait été compté à
    ZÉRO — fait mesuré, classé premier, présent dans le contexte du modèle — le
    rapport a écrit « Le catalogue contient des produits actifs et publiés ».
    Deux constats plus haut, il disait le contraire.

    La consigne ne suffit pas et ne suffira jamais seule : `faits-opposables.ts`
    retire mécaniquement ces phrases. Elle reste utile en amont — mieux vaut que
    le modèle ne l'écrive pas que de la lui retirer après coup.
  */
  t.check(
    "une hypothèse ne peut pas contredire un chiffre compté",
    /UNE HYPOTHÈSE NE PEUT PAS CONTREDIRE UN CHIFFRE QUE NOUS AVONS COMPTÉ/.test(consignes),
    true,
  );
  t.check(
    "…avec le cas réellement produit en exemple",
    /Le catalogue contient des produits actifs et publiés/.test(consignes),
    true,
  );
  t.check(
    "…et le chiffre l'emporte sur l'hypothèse",
    /S'il existe, il gagne/.test(consignes),
    true,
  );
  // LA MOITIÉ QU'IL NE FAUT PAS PERDRE : ce que le chiffre ne dit pas reste
  // supposable. Sinon la consigne interdirait de raisonner.
  t.check(
    "…mais ce que le chiffre ne dit pas reste supposable",
    /Ce que vous pouvez encore supposer sur ce sujet/.test(consignes),
    true,
  );
  t.check(
    "le diagnostic passe avant la preuve technique",
    /LE DIAGNOSTIC D'ABORD, LA PREUVE TECHNIQUE ENSUITE/.test(consignes),
    true,
  );

  // Le jargon du moteur ne remonte pas jusqu'au marchand.
  const certitudes = lire("src/lib/finding-graph.ts");
  t.check(
    "« Déduction forte » ne s'affiche plus tel quel",
    /deduction_forte: "Déduction forte"/.test(certitudes),
    false,
  );
  t.check(
    "…le libellé dit d'où vient la conclusion",
    /Déduit des éléments observés/.test(certitudes),
    true,
  );
  t.check(
    "la mémoire des corrections ne parle plus de « piste »",
    /Piste jamais tentée/.test(lire("src/lib/attempt-history.ts")),
    false,
  );

  // UN SEUL JEU DE LIBELLÉS DE CERTITUDE. Le cockpit en tenait un second, écrit
  // à la main : le même niveau s'appelait « Fait » ici et « Mesuré » sur le
  // rapport, et « Déduction forte » y avait survécu. Deux noms pour une même
  // chose apprennent au lecteur que les mots ne sont pas choisis.
  const cockpit = sansCommentaires(lire("src/components/Cockpit.tsx"));
  t.check(
    "le cockpit ne recopie pas les libellés de certitude",
    // Viser le LIBELLÉ, pas la table des teintes, qui est légitimement
    // indexée par les mêmes clés — une classe CSS commence en minuscule.
    /deduction_forte: "[A-ZÉÈÀ]/.test(cockpit),
    false,
  );
  t.check(
    "…il dérive de la table de référence",
    /CERTAINTY_LABELS[^=]*= \{ \.\.\.EPISTEMIC_LABELS \}/.test(cockpit),
    true,
  );
  t.check(
    "…et son repli n'affiche jamais la clé du moteur",
    /\?\? signal\.certainty/.test(cockpit),
    false,
  );

  // AUCUN GESTE QU'UN ÉCRAN TACTILE NE PERMET PAS. L'entonnoir demandait de
  // « survoler » pour lire la source d'un chiffre : impossible au doigt, et le
  // seul tutoiement restant du produit.
  t.check(
    "aucun écran ne demande de survoler pour lire une information",
    /survole/i.test(sansCommentaires(lire("src/components/FunnelView.tsx"))),
    false,
  );

  // LE VOCABULAIRE NE S'ÉCHANGE PAS D'UN ÉCRAN À L'AUTRE. Les cartes de
  // boutique annonçaient « Prête à être auditée » à côté d'un texte qui parle
  // de « diagnostic », et abrégeaient le chiffre d'affaires en « CA ».
  for (const écran of [
    "src/routes/_authenticated/dashboard.tsx",
    "src/routes/_authenticated/stores.index.tsx",
  ]) {
    const src = sansCommentaires(lire(écran));
    t.check(
      `${écran} ne dit pas « auditée » là où il dit « diagnostic »`,
      /auditée/.test(src),
      false,
    );
    t.check(`${écran} n'abrège pas le chiffre d'affaires`, /"CA à/.test(src), false);
  }

  // AUCUN MOT DE DÉVELOPPEUR SUR UN ÉCRAN DE CONNEXION. « OAuth », « serveur »
  // et « HTTPS » désignent des choses que le marchand ne peut ni vérifier ni
  // corriger : ils appartiennent au journal.
  const connexions = sansCommentaires(lire("src/components/ConnectionsPanel.tsx"));
  for (const mot of ["OAuth", "HTTPS", "serveur"]) {
    t.check(
      `le panneau des sources ne dit pas « ${mot} »`,
      new RegExp(mot).test(connexions),
      false,
    );
  }

  // =========================================================================
  // PRIORITÉ ET CERTITUDE NE SE CONFONDENT JAMAIS À L'ÉCRAN
  // =========================================================================
  /*
    Deux pastilles se suivaient sur chaque carte — « Critique » puis « Mesuré » —
    sans que rien ne dise qu'elles répondent à deux questions différentes. Un
    lecteur pressé les additionne, et conclut qu'un constat critique est un
    constat certain. Ce sont deux axes indépendants : un constat peut être
    critique et hypothétique, ou secondaire et mesuré.
  */
  const rapport = lire("src/routes/_authenticated/audits.$auditId.tsx");
  t.check("la pastille de priorité se nomme", /Priorité : critique/.test(rapport), true);
  t.check("…jusque dans ses degrés faibles", /Priorité : opportunité/.test(rapport), true);
  t.check(
    "la pastille de certitude se nomme",
    /Certitude : \{EPISTEMIC_LABELS/.test(rapport),
    true,
  );
  t.check(
    "le rapport nomme le diagnostic, pas un vague « pourquoi »",
    /> ?Diagnostic ?</.test(rapport),
    true,
  );
  t.check(
    "…et ce que le problème empêche, plutôt qu'un mot seul",
    /Ce que cela empêche/.test(rapport),
    true,
  );
  // Un manque de donnée ne se referme pas sur lui-même : il dit ce qu'il
  // interdit de conclure.
  t.check(
    "une donnée manquante dit ce qu'elle empêche",
    /nous ne pouvons ni les chiffrer, ni les classer/.test(rapport),
    true,
  );
  // Et une note absente s'explique au lieu de ressembler à une panne.
  t.check("une note absente s'explique", /Nous n'attribuons pas de note/.test(rapport), true);
});
