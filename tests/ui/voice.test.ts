import { readdirSync, readFileSync, statSync } from "node:fs";
import { defineSuite } from "../harness";

/**
 * UNE SEULE VOIX, DU PREMIER ÉCRAN AU DERNIER.
 *
 * LE DÉFAUT, VISIBLE SUR UNE MÊME PAGE. Le rapport d'audit annonçait
 * « L'IA analyse ta boutique… », puis, trois blocs plus bas, « Nous n'avons pas
 * réussi à lire les données de votre boutique ». Le produit tutoyait sur les
 * écrans écrits en premier et vouvoyait dans tout ce que le moteur produit
 * depuis. Personne ne lit cela comme un choix : cela se lit comme un logiciel
 * assemblé par plusieurs mains qui ne se sont pas parlé — exactement ce qu'un
 * marchand hésite à laisser écrire dans sa boutique.
 *
 * POURQUOI « VOUS ». La promesse du produit est celle d'un consultant qui a
 * accompagné des centaines de boutiques. Un consultant vouvoie. Le tutoiement
 * appartenait au discours d'origine, tourné vers le débutant qu'on met à l'aise ;
 * il entre en contradiction avec un diagnostic qui refuse de conclure sans
 * preuve et annonce ses niveaux de confiance.
 *
 * CE QUI RESTE AU TUTOIEMENT, ET POURQUOI. Les consignes adressées au MODÈLE —
 * « Tu ne chiffres aucun gain qui ne figure pas en Montant constaté » — ne sont
 * lues par aucun marchand. Les convertir n'apporterait rien et alourdirait des
 * instructions dont la précision compte. Ces fichiers sont donc exclus
 * NOMMÉMENT : une exclusion par motif large finirait par couvrir un écran.
 *
 * LA SECONDE FRACTURE, TROUVÉE APRÈS COUP : QUI EST « NOUS » ET QUI EST « JE ».
 * Le vouvoiement réglait la façon dont le produit s'adresse au marchand ; il ne
 * disait rien de la façon dont il se désigne LUI-MÊME. Sur un même écran, le
 * briefing annonçait « Ce que je ferais maintenant » et l'échec d'audit, trois
 * blocs plus bas, « Nous n'avons pas réussi à lire les données ». Un lecteur
 * n'a aucun moyen de savoir s'il a devant lui une personne ou une équipe — et
 * l'hésitation tombe au pire endroit : sur un produit qui demande l'accès en
 * écriture à une boutique, savoir à qui on le confie n'est pas un détail de ton.
 *
 * C'EST « NOUS ». Le produit n'est pas un assistant qui aurait un avis
 * personnel : c'est une équipe qui répond de ses écritures, et un refus de
 * garde-fou — « nous ne coupons pas une campagne qui convertit » — engage cette
 * équipe. « Je ne coupe pas » n'engageait personne.
 *
 * CE QUI RESTE AU SINGULIER, ET POURQUOI. Un seul fichier : celui où c'est le
 * MARCHAND qui parle, en choisissant la phrase qui décrit sa situation — « Je
 * n'ai pas encore de vente ». Les boutons gardent aussi ses possessifs
 * (« Créer mon compte », « Mes boutiques ») : c'est lui qui les prononce en
 * cliquant. Le contrôle ci-dessous ne poursuit donc que « je » et « j' », les
 * deux formes qui ne peuvent être que la voix du produit une fois ce fichier
 * excepté.
 *
 * POURQUOI UN TEST ET PAS UNE CONSIGNE. Un texte se réécrit à chaque nouvelle
 * fonctionnalité, souvent en copiant une phrase voisine. Sans contrôle
 * mécanique, la première page ajoutée après celle-ci rouvrira l'écart.
 */

const ROOT = new URL("../../", import.meta.url).pathname;

/**
 * Fichiers dont les textes s'adressent au MODÈLE, jamais au marchand.
 *
 * Liste nominative et volontairement fastidieuse à allonger : y ajouter un
 * fichier doit être un geste conscient, pas un effet de bord.
 */
const DESTINÉS_AU_MODÈLE = new Set([
  "src/lib/audit-prompt.ts",
  "src/lib/audit-rules.ts",
  "src/lib/audit-runner.server.ts",
  "src/lib/audit.functions.ts",
  "src/lib/apply-fix.server.ts",
  "src/lib/attempt-history.ts",
  "src/lib/audience.ts",
  "src/lib/cross-source.ts",
  "src/lib/diagnostics.ts",
  "src/lib/funnel.ts",
  "src/lib/observations.ts",
  "src/lib/root-cause.ts",
  "src/lib/snapshots.server.ts",
  "src/lib/storefront-experience.ts",
]);

/**
 * Marqueurs du tutoiement. Chacun est sans ambiguïté une fois les mots isolés.
 *
 * CE QUE CETTE LISTE NE COUVRE PAS, ET IL FAUT LE SAVOIR. Elle attrape les
 * pronoms, les possessifs et les impératifs NOMMÉS ci-dessous — pas toutes les
 * conjugaisons de la deuxième personne. La première version de ce contrôle
 * s'arrêtait aux pronoms : elle est passée à côté de « Patiente… », « Clique
 * sur », « Relance la correction », et un lot est parti en production avec ces
 * boutons. Un impératif nouveau échappera de la même façon jusqu'à ce qu'on
 * l'ajoute ici. Le contrôle réduit la surface, il ne la ferme pas.
 */
const TUTOIEMENT = ["tu", "toi", "ta", "ton", "tes", "te"];

/**
 * Impératifs de la deuxième personne du singulier.
 *
 * ILS NE SE CHERCHENT PAS COMME LES PRONOMS. « Relance », « vérifie »,
 * « annule » sont aussi des indicatifs de troisième personne et parfois des
 * noms — « un e-mail de relance », « le service qui vérifie ». Les chercher
 * partout produisait dix-sept accusations dont aucune n'était fondée, et un
 * contrôle qui crie faux finit desserré, puis supprimé.
 *
 * On les cherche donc là où un impératif se trouve réellement : en TÊTE DE
 * PHRASE et avec une majuscule. Un impératif glissé en milieu de phrase après
 * une virgule échappe — c'est le prix d'un contrôle qui ne se trompe jamais
 * plutôt que d'un contrôle exhaustif que personne ne garderait.
 */
const IMPÉRATIFS = [
  "Patiente",
  "Clique",
  "Choisis",
  "Renseigne",
  "Ajoute",
  "Coche",
  "Vérifie",
  "Relance",
  "Connecte",
  "Réessaie",
  "Annule",
  "Reviens",
  "Lance",
  "Branche",
  "Colle",
  "Corrige",
  "Attends",
  // AJOUTÉS APRÈS COUP, ET C'EST LA RÈGLE. « Ensuite, regarde le taux de
  // conversion » vivait en production : le verbe manquait à cette liste, si
  // bien que le second passage — celui qui inspecte l'après-virgule — n'avait
  // rien à chercher. Une liste nommée ne protège que de ce qu'elle nomme ;
  // c'est la mutation qui l'a montré, pas la lecture.
  "Regarde",
  "Ouvre",
  "Compare",
  // TROUVÉ EN PARCOURANT L'APPLICATION RENDUE, pas en relisant le code : la
  // page de suivi affichait, dans son état vide, « Applique une correction
  // depuis un rapport d'audit, puis reviens ici pour voir l'avant / après ».
  // Deux tutoiements dans une phrase de douze mots, sur le seul écran qui
  // répond à « est-ce que ce que j'ai fait a servi ? ».
  "Applique",
  // AJOUTÉ APRÈS LA FRONTIÈRE D'ERREUR GLOBALE. « Recharge la page ou reviens à
  // l'accueil » y vivait — le DERNIER écran que voit un marchand quand tout le
  // reste a échoué, et le seul qui tutoyait encore. Le verbe manquait à cette
  // liste : rien ne le cherchait, donc rien ne l'a vu.
  "Recharge",
  // Relevés en même temps, par balayage : aucun n'était présent dans le code,
  // et c'est précisément pour cela qu'ils sont nommés maintenant — une liste
  // qui n'est complétée qu'après coup n'a jamais protégé de rien.
  "Sélectionne",
  "Remplis",
  "Saisis",
  "Consulte",
  "Modifie",
  "Supprime",
  "Enregistre",
  "Envoie",
  "Active",
  "Configure",
  "Complète",
  "Indique",
  "Essaie",
  "Valide",
  "Confirme",
  "Copie",
];

/**
 * L'impératif EN MINUSCULE, en seconde proposition.
 *
 * QUATRE PHRASES Y VIVAIENT, dont deux que le marchand rencontre au moment le
 * plus sensible du produit — la saisie de ses marges : « Coût produit moyen :
 * indique un pourcentage entre 0 et 100, ou laisse le champ vide. » Elles ont
 * traversé les deux contrôles précédents sans les effleurer : la recherche en
 * tête de phrase exige une MAJUSCULE, et le passage après adverbe ne regarde
 * que cinq mots d'ouverture.
 *
 * DEUX CONDITIONS, ET IL FAUT LES DEUX. Ni l'une ni l'autre ne suffit.
 *
 * La PONCTUATION qui précède — deux-points, point-virgule, virgule, tiret —
 * ouvre une proposition sans sujet. Elle écarte « le service qui vérifie », les
 * faux positifs qui avaient fait renoncer à chercher ces verbes ailleurs qu'en
 * tête de phrase.
 *
 * Mais elle ne suffit pas, et une énumération l'a montré tout de suite :
 * « email, relance panier, post-achat » — un NOM, dans une liste, précédé
 * d'une virgule. D'où la seconde condition : ce qui SUIT le verbe. Un impératif
 * prend un objet, et cet objet s'annonce par un déterminant, une conjonction,
 * une préposition de lieu ou un pronom accroché — « laissez LE champ vide »,
 * « vérifiez QUE », « gardez-LA ». Le nom « relance », lui, est suivi de son
 * complément : « relance panier », « relance de panier ». La distinction est
 * nette, et elle évite d'avoir à réécrire un texte juste pour faire taire un
 * contrôle — ce qui aurait été le geste inverse de celui qu'on cherche.
 *
 * La liste reste nommée, pour la même raison que les précédentes : ce qui n'y
 * est pas n'est pas cherché, et l'y ajouter doit rester un geste conscient.
 */
const IMPÉRATIFS_EN_SECONDE_PROPOSITION = [
  "indique",
  "laisse",
  "vérifie",
  "relance",
  "clique",
  "choisis",
  "renseigne",
  "ajoute",
  "coche",
  "connecte",
  "réessaie",
  "annule",
  "lance",
  "corrige",
  "regarde",
  "garde",
  "saisis",
  "remplis",
  "sélectionne",
];

/**
 * Ce qui suit un impératif : son objet.
 *
 * Déterminants, conjonction complétive, prépositions, et les pronoms accrochés
 * par un trait d'union (« gardez-la », « allez-y »). Un nom homographe du verbe
 * n'a jamais cette suite.
 *
 * LE NOM DE VARIABLE EN CAPITALES compte aussi comme objet : « renseignez
 * AI_BASE_URL » n'a pas de déterminant, et cette phrase-là existait. Les
 * capitales la distinguent sans ambiguïté d'une énumération de noms communs,
 * qui est le seul faux positif que cette règle ait produit.
 */
const OBJET_D_IMPÉRATIF =
  "(?:le|la|les|l['’]|un|une|des|votre|vos|ce|cet|cette|ces|mon|ma|mes|que|qu['’]|à|au|aux|dans|sur|vers|depuis|ici)(?![\\p{L}])|['’-](?:la|le|les|y|en|moi|nous)(?![\\p{L}])|[A-Z][A-Z_]{2,}";

/**
 * Le seul fichier où la première personne du singulier est celle du MARCHAND.
 *
 * `store-profile.ts` ne contient que des phrases qu'il choisit pour se décrire
 * — « Je vends, mais je ne gagne pas d'argent ». Les mettre au pluriel n'aurait
 * aucun sens. Une exception unique et nommée, plutôt qu'un motif large qui
 * finirait par couvrir un écran du produit.
 */
const LE_MARCHAND_PARLE = new Set(["src/lib/store-profile.ts"]);

/**
 * Adverbes qui ouvrent une proposition sans sujet.
 *
 * POURQUOI CE SECOND PASSAGE. La recherche d'impératifs ne regarde qu'en TÊTE
 * de phrase, avec majuscule — délibérément, pour ne jamais accuser à tort. Un
 * impératif glissé après « Ensuite, » échappait donc, et c'est exactement ce qui
 * s'est produit : « Ensuite, regarde le taux de conversion » a vécu en
 * production dans la phrase la plus lue du produit, celle qui dit quoi faire.
 *
 * Après l'un de ces adverbes suivi d'une virgule, un verbe sans sujet ne peut
 * être qu'un impératif : la position lève l'ambiguïté qui interdisait de
 * chercher ces verbes ailleurs qu'en tête de phrase.
 */
const OUVERTURES_SANS_SUJET = ["Ensuite", "Puis", "Alors", "Enfin", "Maintenant"];

/**
 * « Compte » suivi d'un chiffre — le seul cas où ce mot est un impératif.
 *
 * Il ne peut PAS rejoindre `IMPÉRATIFS` : « Compte publicitaire enregistré »,
 * « Compte créé », « Compte analysé pour cette boutique » ouvrent des phrases
 * dans six fichiers irréprochables. L'y mettre a produit six accusations, toutes
 * fausses — la démonstration exacte de ce que la liste ci-dessus documente.
 *
 * Ce qui distingue l'impératif est ce qui le suit : une DURÉE. « Compte 1,5 h »,
 * « Compte 20 min » tutoyaient dans le briefing et dans le plan ; aucun nom
 * « compte » de ce produit n'est jamais suivi d'un chiffre.
 */
const COMPTE_IMPÉRATIF = /(^|[^\p{L}])Compte\s+[\d{$]/u;

function fichiersDe(dossier: string): string[] {
  const out: string[] = [];
  for (const entrée of readdirSync(`${ROOT}${dossier}`)) {
    const relatif = `${dossier}/${entrée}`;
    if (statSync(`${ROOT}${relatif}`).isDirectory()) {
      out.push(...fichiersDe(relatif));
    } else if (relatif.endsWith(".ts") || relatif.endsWith(".tsx")) {
      out.push(relatif);
    }
  }
  return out;
}

/**
 * Retire les commentaires avant de juger.
 *
 * Les commentaires de ce dépôt expliquent le raisonnement à qui lit le code, et
 * c'est là que le tutoiement de travail a sa place. Les inclure interdirait de
 * documenter les modules que ce contrôle protège.
 */
function texteAffiché(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

/** Le texte d'un fichier, commentaires retirés. */
const parle = (chemin: string) => texteAffiché(readFileSync(`${ROOT}${chemin}`, "utf8"));

export default defineSuite("Interface — une seule voix", (t) => {
  const fichiers = [
    ...fichiersDe("src/components"),
    ...fichiersDe("src/routes"),
    ...fichiersDe("src/lib"),
  ].filter((f) => !DESTINÉS_AU_MODÈLE.has(f));

  // GARDE-FOU DU RELEVÉ. Un parcours qui ne trouverait plus rien déclarerait le
  // produit irréprochable sans avoir rien lu.
  t.check("le relevé parcourt bien le produit", fichiers.length >= 40, true);

  for (const chemin of fichiers) {
    const contenu = texteAffiché(readFileSync(`${ROOT}${chemin}`, "utf8"));
    for (const mot of TUTOIEMENT) {
      // PAS `\b` : en JavaScript, une lettre accentuée n'est pas un caractère
      // de mot, si bien que `\bte\b` trouve « te » à l'intérieur de « coûte »
      // et `\btes\b` à l'intérieur de « êtes ». Le contrôle accusait alors des
      // fichiers irréprochables — et, pire, aurait fini par être desserré pour
      // les faire taire. On délimite donc sur les LETTRES, accents compris.
      const trouvé = new RegExp(`(^|[^\\p{L}])${mot}($|[^\\p{L}])`, "iu").test(contenu);
      t.check(`${chemin} n'emploie pas « ${mot} »`, trouvé, false);
    }
    for (const verbe of IMPÉRATIFS) {
      const trouvé = new RegExp(`(?:^|[.!?:»"'\`(>{])\\s*${verbe}(?![\\p{L}])`, "mu").test(contenu);
      t.check(`${chemin} n'ouvre pas une phrase par « ${verbe} »`, trouvé, false);
    }
    // LE PRONOM ÉLIDÉ. « t'attribuer », « qui t'appartient » : le pronom
    // disparaît derrière son apostrophe et échappait aux deux contrôles
    // ci-dessus. Deux phrases sont passées en production ainsi. Le « t' » n'a
    // pas d'autre emploi en français que la deuxième personne du singulier,
    // donc aucune ambiguïté à craindre ici.
    t.check(
      `${chemin} n'emploie pas « t' »`,
      /(^|[^\p{L}])t['’][aeiouéèêàhy]/iu.test(contenu),
      false,
    );

    t.check(
      `${chemin} n'écrit pas « Compte » suivi d'une durée`,
      COMPTE_IMPÉRATIF.test(contenu),
      false,
    );

    // L'IMPÉRATIF APRÈS UN ADVERBE D'OUVERTURE. Voir `OUVERTURES_SANS_SUJET` :
    // la virgule garantit qu'aucun sujet ne suit, donc qu'un verbe de la liste
    // trouvé là est bien un impératif adressé au marchand.
    for (const ouverture of OUVERTURES_SANS_SUJET) {
      const verbes = IMPÉRATIFS.map((v) => v.toLowerCase()).join("|");
      t.check(
        `${chemin} ne tutoie pas après « ${ouverture}, »`,
        new RegExp(`${ouverture},\\s*(?:${verbes})(?![\\p{L}])`, "iu").test(contenu),
        false,
      );
      // LA VIRGULE EST DEVANT L'ADVERBE, PAS DERRIÈRE — et c'est la forme la
      // plus courante en français : « …, puis revenez ici », « …, ensuite
      // regardez ». La règle ci-dessus exigeait « Puis, » et laissait donc
      // passer « , puis ». C'est exactement par là que « Applique une
      // correction …, puis reviens ici » est entré en production.
      t.check(
        `${chemin} ne tutoie pas après « , ${ouverture.toLowerCase()} »`,
        new RegExp(`[,;]\\s*${ouverture}\\s+(?:${verbes})(?![\\p{L}])`, "iu").test(contenu),
        false,
      );
    }

    // L'IMPÉRATIF EN MINUSCULE APRÈS PONCTUATION. Voir
    // `IMPÉRATIFS_EN_SECONDE_PROPOSITION` : c'est la ponctuation, pas le verbe,
    // qui garantit qu'aucun sujet ne précède.
    for (const verbe of IMPÉRATIFS_EN_SECONDE_PROPOSITION) {
      t.check(
        `${chemin} n'enchaîne pas sur « ${verbe} »`,
        new RegExp(`[:;,–—]\\s*${verbe}\\s*(?:${OBJET_D_IMPÉRATIF})`, "u").test(contenu),
        false,
      );
    }

    // LA PREMIÈRE PERSONNE DU SINGULIER. Elle ne peut être que la voix du
    // produit une fois `LE_MARCHAND_PARLE` excepté — et le produit est une
    // équipe. Les possessifs (« mon compte », « ma boutique ») ne sont PAS
    // poursuivis : ils appartiennent aux boutons, que le marchand prononce en
    // cliquant. Les poursuivre aurait forcé une seconde liste d'exceptions
    // aussi longue que la liste des écrans, et un contrôle qu'on allonge à
    // chaque page est un contrôle qu'on finit par retirer.
    if (!LE_MARCHAND_PARLE.has(chemin)) {
      t.check(`${chemin} ne dit pas « je »`, /(^|[^\p{L}])je($|[^\p{L}])/iu.test(contenu), false);
      t.check(`${chemin} ne dit pas « j' »`, /(^|[^\p{L}])j['’]/iu.test(contenu), false);
    }
  }

  // LE TÉMOIN. Les contrôles ci-dessus sont des absences : un produit devenu
  // muet les passerait tous. Ces trois-là vérifient que la voix retenue est
  // bien PRÉSENTE, et à l'endroit qui compte — le briefing, les garde-fous, et
  // le refus d'écrire, c'est-à-dire partout où le produit engage sa parole.
  t.check(
    "le briefing parle au nom de l'équipe",
    /Ce que nous ferions maintenant/.test(parle("src/components/BriefingCard.tsx")),
    true,
  );
  t.check(
    "un garde-fou refuse au nom de l'équipe",
    /nous ne coupons pas une campagne qui convertit/.test(parle("src/lib/action-guards.ts")),
    true,
  );
  t.check(
    "l'issue inconnue s'annonce au nom de l'équipe",
    /Nous ne savons pas si cette correction/.test(parle("src/lib/action-plan.ts")),
    true,
  );

  // ET LE MARCHAND, LUI, GARDE SA VOIX. Sans ce contrôle, la façon la plus
  // simple de faire taire celui du dessus serait de mettre ses réponses au
  // pluriel — « Nous n'avons pas encore de vente » — et le contrôle vert
  // signerait une régression.
  t.check(
    "le marchand se décrit encore à la première personne",
    /Je n'ai pas encore de vente/.test(parle("src/lib/store-profile.ts")),
    true,
  );
  t.check(
    "et les boutons restent les siens",
    /Créer mon compte/.test(parle("src/routes/auth.tsx")),
    true,
  );

  // Les écrans les plus lus disent bien « vous » — un fichier peut passer le
  // contrôle ci-dessus simplement en n'adressant personne.
  t.check(
    "l'accueil s'adresse au marchand",
    /\bvotre boutique\b/i.test(parle("src/routes/index.tsx")),
    true,
  );
  t.check(
    "le rapport d'audit s'adresse au marchand",
    /\bvotre\b/i.test(parle("src/routes/_authenticated/audits.$auditId.tsx")),
    true,
  );
  t.check(
    "l'ajout de boutique s'adresse au marchand",
    /\bvotre boutique\b/i.test(parle("src/routes/_authenticated/onboarding.tsx")),
    true,
  );

  /*
    LES CONSIGNES AU MODÈLE IMPOSENT LA MÊME VOIX QUE LE RESTE DU PRODUIT.

    Elles disaient « Tutoie l'utilisateur » et « Parle comme un mentor
    bienveillant » — soit exactement l'inverse de ce que cette suite vérifie
    partout ailleurs. Le rapport est le texte le plus lu du produit, et il était
    le seul écrit sous des consignes contraires.
  */
  const consignes = readFileSync(`${ROOT}src/lib/audit-prompt.ts`, "utf8");
  t.check(
    "les consignes au modèle imposent le vouvoiement",
    /VOUVOIEMENT partout/.test(consignes),
    true,
  );
  t.check(
    "…et interdisent explicitement le tutoiement",
    /Jamais de tutoiement/.test(consignes),
    true,
  );
  t.check("…et n'ordonnent plus de tutoyer", /Tutoie l'utilisateur|Tutoyez/.test(consignes), false);
  t.check(
    "…et bannissent les formules creuses",
    /il est important de/.test(consignes) && /optimisez votre boutique/.test(consignes),
    true,
  );
  t.check(
    "…et rappellent que la portée n'est pas une nuance de style",
    /LA PORTÉE EST UNE VÉRITÉ/.test(consignes),
    true,
  );
});
