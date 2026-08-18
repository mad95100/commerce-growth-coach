import { readFileSync } from "node:fs";
import { defineSuite } from "../harness";
import {
  CAUSES,
  MIN_SYMPTOMS_FOR_CAUSE,
  causesToPromptBlock,
  groupByCause,
  type Symptom,
} from "@/lib/root-cause";
import {
  EXPLANATIONS,
  JARGON,
  explain,
  explanationToText,
  fallbackExplanation,
  isExplained,
} from "@/lib/plain-language";
import { OBSERVATION_SOURCES } from "@/lib/observations";

/**
 * UNE CAUSE, UNE ACTION — ET LE PRODUIT QUI PARLE AU MARCHAND.
 *
 * DEUX DÉFAUTS QUE CES CONTRÔLES EXISTENT POUR EMPÊCHER.
 *
 * Le premier est le rapport de consultant : cinq recommandations justes pour un
 * seul problème sous-jacent. Le marchand en commence trois, n'en finit aucune,
 * et conclut que l'outil ne sert à rien. Il aurait raison.
 *
 * Le second est le jargon. « Conversion non mesurée faute de sessions » est
 * exact et inutile : il n'apprend ni ce qui manque, ni pourquoi c'est gênant, ni
 * quoi faire. Le vocabulaire du moteur revient tout seul dès qu'on ajoute une
 * phrase sans y penser, d'où un contrôle mécanique plutôt qu'une consigne.
 */

function s(id: string, over: Partial<Symptom> = {}): Symptom {
  return {
    id,
    title: `titre de ${id}`,
    evidence: [`preuve de ${id}`],
    level: "prouve",
    impact: 3,
    effort: 2,
    ...over,
  };
}

export default defineSuite("Audit — causes racines et langage marchand", (t) => {
  // --- 1. Une cause ne se forme pas à partir d'un seul signe ---------------
  // Le contrôle central : inventer une cause racine sur un symptôme isolé
  // serait le raisonnement de complaisance que ce module doit empêcher.
  const seul = groupByCause([s("merchandising.descriptions_missing")]);
  t.check("un symptôme isolé ne forme aucune cause", seul.causes.length, 0);
  t.check("mais il n'est jamais perdu", seul.isolated.length, 1);
  t.check("le seuil est d'au moins deux symptômes", MIN_SYMPTOMS_FOR_CAUSE >= 2, true);

  // --- 2. Deux symptômes de la même famille forment la cause ---------------
  const muette = groupByCause([
    s("merchandising.descriptions_missing", { impact: 4, effort: 3 }),
    s("experience.promesse_absente", { impact: 5, effort: 1 }),
  ]);
  t.check("deux symptômes forment une cause", muette.causes.length, 1);
  t.check("la cause est bien identifiée", muette.causes[0]?.id, "cause.boutique_muette");
  t.check("aucun symptôme ne reste isolé", muette.isolated.length, 0);
  t.check("les deux constats sont rattachés", muette.causes[0]?.symptoms.length, 2);
  // L'impact est celui du symptôme le plus grave ; l'effort celui du premier
  // geste, pas la somme des corrections.
  t.check("l'impact retenu est le plus fort", muette.causes[0]?.impact, 5);
  t.check("l'effort retenu est celui du premier geste", muette.causes[0]?.effort, 1);

  // --- 3. LE REGROUPEMENT NE PEUT PAS ÊTRE PLUS CERTAIN QUE SES PARTS ------
  // Sans cela, un constat « à vérifier » sortirait promu par le simple fait
  // d'être accompagné — une promotion gratuite, et fausse.
  const melange = groupByCause([
    s("experience.aucun_cta", { level: "prouve" }),
    s("experience.cta_trop_bas", { level: "a_verifier" }),
  ]);
  t.check("la cause prend le niveau le plus faible", melange.causes[0]?.level, "a_verifier");
  const tousProuves = groupByCause([
    s("trust.policy_pages_missing", { level: "prouve" }),
    s("experience.reassurance_absente", { level: "prouve" }),
  ]);
  t.check(
    "deux constats prouvés donnent une cause prouvée",
    tousProuves.causes[0]?.level,
    "prouve",
  );
  // Une donnée insuffisante ne peut pas être remontée non plus.
  const insuffisant = groupByCause([
    s("data.traffic_unmeasured", { level: "donnee_insuffisante" }),
    s("data.attribution_coverage_low", { level: "prouve" }),
  ]);
  t.check(
    "une donnée insuffisante tire la cause vers le bas",
    insuffisant.causes[0]?.level,
    "donnee_insuffisante",
  );

  // --- 4. Les preuves sont l'union, jamais une phrase de plus --------------
  const preuves = groupByCause([
    s("trust.policy_pages_missing", { evidence: ["A", "B"] }),
    s("experience.contact_absent", { evidence: ["B", "C"] }),
  ]);
  t.check("les preuves sont réunies", preuves.causes[0]?.evidence.length, 3);
  t.check(
    "aucune preuve n'est inventée",
    preuves.causes[0]?.evidence.every((e) => ["A", "B", "C"].includes(e)),
    true,
  );
  t.check(
    "les doublons de preuve sont retirés",
    new Set(preuves.causes[0]?.evidence).size,
    preuves.causes[0]?.evidence.length,
  );

  // --- 5. Un symptôme n'appartient qu'à une cause -------------------------
  // Sans cela, le marchand verrait le même constat deux fois, sous deux
  // conseils différents — exactement ce qu'on cherche à supprimer.
  const complet = groupByCause([
    s("merchandising.descriptions_missing"),
    s("experience.promesse_absente"),
    s("trust.policy_pages_missing"),
    s("experience.reassurance_absente"),
    s("experience.aucun_cta"),
    s("experience.navigation_absente"),
  ]);
  const rattaches = complet.causes.flatMap((c) => c.symptoms.map((x) => x.id));
  t.check("aucun symptôme n'est rattaché deux fois", new Set(rattaches).size, rattaches.length);
  t.check("trois causes se forment", complet.causes.length, 3);
  t.check("tous les symptômes sont rattachés", complet.isolated.length, 0);

  // --- 6. Les causes sont ordonnées par priorité --------------------------
  t.check(
    "les causes sortent ordonnées",
    complet.causes.every((c, i) => i === 0 || complet.causes[i - 1]!.priority >= c.priority),
    true,
  );
  // À impact égal, l'effort faible passe devant — même promesse que la
  // priorisation des constats.
  const ordre = groupByCause([
    s("data.traffic_unmeasured", { impact: 4, effort: 4 }),
    s("data.attribution_coverage_low", { impact: 4, effort: 4 }),
    s("experience.aucun_cta", { impact: 4, effort: 1 }),
    s("experience.navigation_absente", { impact: 4, effort: 1 }),
  ]);
  t.check("à impact égal, le geste court passe devant", ordre.causes[0]?.id, "cause.chemin_absent");

  // --- 7. Chaque définition de cause tient ses promesses -------------------
  for (const def of CAUSES) {
    t.check(`${def.id} dit quel est le problème réel`, def.statement.length > 50, true);
    t.check(`${def.id} dit pourquoi c'est UN problème`, def.why.length > 80, true);
    t.check(`${def.id} propose un premier geste`, def.firstAction.length > 40, true);
    t.check(`${def.id} propose une correction exécutable`, def.correction.length > 100, true);
    t.check(`${def.id} rattache au moins deux constats`, def.matches.length >= 2, true);
    // Une correction qui ne dit pas où agir n'est pas une correction.
    t.check(
      `${def.id} nomme un endroit ou un geste précis`,
      /Shopify|thème|page d'accueil|fiche|menu|lien|bouton/i.test(def.correction),
      true,
    );
  }
  // Aucun identifiant ne doit appartenir à deux familles : ce serait un
  // rattachement non déterministe, dépendant de l'ordre de déclaration.
  const tousMatches = CAUSES.flatMap((c) => c.matches);
  t.check("aucun constat ne relève de deux causes", new Set(tousMatches).size, tousMatches.length);

  // --- 8. Le bloc transmis au modèle ---------------------------------------
  const bloc = causesToPromptBlock(complet.causes, complet.isolated);
  t.check("les causes sont annoncées", /CAUSES RACINES/.test(bloc), true);
  t.check("la chaîne complète est transmise", /Correction :/.test(bloc), true);
  t.check("les symptômes expliqués sont listés", /Constats qu'il explique/.test(bloc), true);
  t.check(
    "le modèle a interdiction de donner une action par symptôme",
    /UNE action, pas une par symptôme/.test(bloc),
    true,
  );
  t.check(
    "le modèle a interdiction de créer des causes",
    /tu n'en fusionnes aucune/.test(bloc),
    true,
  );
  // Sans cause, le modèle est explicitement renvoyé aux constats individuels.
  const blocVide = causesToPromptBlock([], [s("x.isole")]);
  t.check("l'absence de cause est dite", /aucune/i.test(blocVide), true);
  t.check("les constats isolés sont transmis", /CONSTATS ISOLÉS/.test(blocVide), true);

  // --- 9. Le langage marchand : aucun mot du moteur -----------------------
  // Le contrôle qui compte : le vocabulaire technique revient tout seul dès
  // qu'on ajoute une entrée sans y penser.
  for (const [id, e] of Object.entries(EXPLANATIONS)) {
    const texte = explanationToText(e).toLowerCase();
    for (const mot of JARGON) {
      t.check(`${id} n'emploie pas « ${mot} »`, texte.includes(mot), false);
    }
    t.check(`${id} dit ce qui manque`, e.what.length > 25, true);
    t.check(`${id} dit pourquoi c'est important`, e.why.length > 60, true);
    t.check(`${id} dit quoi faire`, e.how.length > 25, true);
    t.check(`${id} dit ce que cela ouvrira`, e.unlocks.length > 30, true);
    // « Connectez une source de données » ne serait pas une instruction.
    t.check(
      `${id} ne renvoie pas à une notion abstraite`,
      /source de données|intégration|flux de données/i.test(e.how),
      false,
    );
  }

  // Une explication manquante rend un repli honnête, jamais une invention.
  const repli = fallbackExplanation("Vues par produit");
  t.check("le repli reste modeste", /pas encore accès/.test(repli.what), true);
  t.check("le repli ne promet aucune action", /aucune action/i.test(repli.how), true);
  t.check(
    "le repli assume de ne pas combler le vide",
    /plutôt que de combler le vide/.test(repli.why),
    true,
  );
  t.check(
    "une clé connue rend son explication",
    explain("shopify.sessions_30d", "x").what.length > 25,
    true,
  );
  t.check(
    "une clé inconnue rend le repli",
    explain("inconnu.truc", "Vues par produit").what,
    repli.what,
  );

  // --- 9 bis. La couverture est RELEVÉE, pas recopiée ---------------------
  // Une liste écrite à la main ne protège de rien : elle vieillit dès qu'une
  // source ajoute un trou, et l'oubli passe inaperçu jusqu'à ce qu'un marchand
  // lise « Non exposé par l'API Admin » sur son écran. On relève donc les
  // identifiants RÉELLEMENT produits par les sources, dans leur code, et on
  // exige que chacun ait sa phrase.
  const racine = new URL("../../", import.meta.url).pathname;
  const fichiersSources = [
    "src/lib/connectors/shopify-observe.ts",
    "src/lib/connectors/shopify-analytics.ts",
    "src/lib/connectors/meta-observe.ts",
    "src/lib/connectors/google-observe.ts",
    "src/lib/connectors/order-attribution.ts",
    "src/lib/connectors/storefront.ts",
    "src/lib/connectors/storefront.server.ts",
    "src/lib/storefront-experience.ts",
  ];
  // Un trou s'écrit toujours `{ id, label, source?, reason, wouldEnable }` :
  // l'identifiant est donc le dernier `id:` littéral avant `wouldEnable`.
  const trousReels = new Set<string>();
  for (const chemin of fichiersSources) {
    const src = readFileSync(`${racine}${chemin}`, "utf8");
    let curseur = 0;
    for (;;) {
      const fin = src.indexOf("wouldEnable", curseur);
      if (fin === -1) break;
      const avant = src.slice(0, fin);
      const ids = [...avant.matchAll(/id:\s*"([a-z_]+\.[a-z0-9_]+)"/g)];
      if (ids.length > 0) trousReels.add(ids[ids.length - 1]![1]!);
      curseur = fin + 1;
    }
  }
  // GARDE-FOU DU RELEVÉ LUI-MÊME. Si la forme du code change et que le relevé
  // ne trouve plus rien, il déclarerait la couverture parfaite sans avoir rien
  // vérifié — un test vert qui ne teste plus est pire qu'un test absent.
  t.check("le relevé trouve bien les trous des sources", trousReels.size >= 20, true);
  for (const id of [...trousReels].sort()) {
    t.check(`${id} a son explication écrite`, isExplained(id), true);
  }

  // Une source entièrement injoignable produit son propre trou, `<source>.
  // unreachable`, dont le motif de repli — « Source injoignable — aucune donnée
  // de ce canal » — est le plus opaque de tous. Chaque source doit avoir le sien.
  for (const source of OBSERVATION_SOURCES) {
    t.check(`${source} injoignable est expliqué`, isExplained(`${source}.unreachable`), true);
  }

  // --- 9 ter. L'écran affiche la phrase écrite, pas celle du code ---------
  const cockpit = readFileSync(`${racine}src/components/Cockpit.tsx`, "utf8");
  // Le troisième argument ne rouvre pas la porte au motif du moteur : `explain`
  // ne s'en sert que pour les trous `*.unreachable`, que seul `allGaps` produit
  // et où il écrit une phrase choisie d'après la cause classée. Sans lui, cet
  // écran conseillait de rebrancher une connexion valable pendant une panne du
  // fournisseur — l'inverse exact de ce qu'il fallait faire.
  t.check("l'écran traduit le trou", /explain\(gap\.id, gap\.label,/.test(cockpit), true);
  t.check("le motif technique n'est plus affiché", /\{gap\.reason\}/.test(cockpit), false);
  t.check("l'écran dit quoi faire", /Ce qu'il faut faire/.test(cockpit), true);

  // --- 10. Le module est branché dans le chemin d'audit -------------------
  const runner = readFileSync(
    new URL("../../src/lib/audit-runner.server.ts", import.meta.url).pathname,
    "utf8",
  );
  t.check("le chemin d'audit regroupe par cause", /groupByCause\(/.test(runner), true);
  t.check("les causes partent dans le prompt", /causesToPromptBlock\(/.test(runner), true);
  // Le regroupement doit voir les trois sources de constats, sinon il ne
  // regrouperait que ce qu'une seule fenêtre a vu.
  t.check(
    "les constats des règles alimentent le regroupement",
    /ruleReport\.findings/.test(runner),
    true,
  );
  t.check("les constats d'expérience alimentent le regroupement", /experience/.test(runner), true);
  t.check(
    "les incohérences du client cible alimentent le regroupement",
    /incoherences/.test(runner),
    true,
  );
});
