import {
  BAND_RANK,
  BLOCKING_SHARE,
  EPISTEMIC_CEILING,
  EPISTEMIC_LEVELS,
  PRIORITY_BANDS,
  ROOT_CAUSE_THRESHOLD,
  analyseFindings,
  citeUneMesure,
  classifyEpistemic,
  countByBand,
  decideBand,
  formatBand,
  hasSubstance,
  normalizeKey,
  toEpistemicLevel,
  toPriorityBand,
  type GraphFinding,
} from "../../src/lib/finding-graph";
import { defineSuite } from "../harness";

/**
 * Chaîne causale, certitude et priorité justifiée.
 *
 * CE QUI EST EN JEU. Ce module décide de l'ordre dans lequel un marchand va
 * dépenser son temps et son argent, à partir d'un texte produit par un modèle
 * de langage. Trois fautes seraient graves et invisibles :
 *
 * - déclarer critique une conclusion qui ne repose sur rien — c'est ainsi
 *   qu'une hallucination devient une urgence ;
 * - proposer de corriger un symptôme avant sa cause, ce qui ne produit rien et
 *   fait réapparaître le même problème à l'audit suivant ;
 * - boucler sur une causalité circulaire, dans un cron qui tourne toutes les
 *   minutes et qui n'a personne devant l'écran.
 *
 * Les trois sont exercées ici, avec les entrées malformées qu'un modèle produit
 * réellement : clés absentes, clés en double, renvois vers un problème
 * inexistant, causalités qui se mordent la queue.
 */

/** Problème type : mesuré, sévérité moyenne, correction facile. Priorité de base 45. */
function make(overrides: Partial<GraphFinding> = {}): GraphFinding {
  return {
    key: "a",
    category: "conversion",
    severity: "medium",
    timeframe: "this_week",
    difficulty: 2,
    confidence: "high",
    evidence: { based_on: "Taux de conversion Shopify sur 30 jours", assumptions: "" },
    ...overrides,
  };
}

export default defineSuite("Audits — chaîne causale et priorité justifiée", (t) => {
  // --- Les champs vides déguisés -------------------------------------------
  // Un modèle sollicité pour un champ obligatoire le remplit toujours.
  t.check("une base citée compte", hasSubstance("Commandes Shopify sur 30 jours"), true);
  t.check("une chaîne vide ne compte pas", hasSubstance(""), false);
  t.check("« aucune » ne compte pas", hasSubstance("Aucune"), false);
  t.check("« aucune. » ponctué ne compte pas", hasSubstance("Aucune."), false);
  t.check("« néant » accentué ne compte pas", hasSubstance("Néant"), false);
  t.check("« n/a » ne compte pas", hasSubstance("N/A"), false);
  t.check("« non renseigné » ne compte pas", hasSubstance("non renseigné"), false);
  t.check("un tiret cadratin ne compte pas", hasSubstance("—"), false);
  t.check("null ne compte pas", hasSubstance(null), false);
  t.check("undefined ne compte pas", hasSubstance(undefined), false);
  t.check("un texte trop court ne compte pas", hasSubstance("ok"), false);
  t.check("les espaces seuls ne comptent pas", hasSubstance("   "), false);

  // --- Les cinq niveaux de certitude ---------------------------------------
  /*
    « OBSERVÉ » A ÉTÉ AJOUTÉ, ET IL COMBLE UNE CONFUSION RÉELLE.

    Le classement ne regardait que la PRÉSENCE d'une base citée, jamais sa
    NATURE. Deux preuves de nature opposée recevaient donc le même niveau :

      · « 412 paniers créés, 149 paiements engagés (Shopify, 30 derniers
        jours) » — une quantité, une source, une période. On peut en tirer un
        montant.
      · « Titre principal relevé sur la page d'accueil : Collection » — une
        constatation certaine, mais qui ne compte rien.

    Les deux s'affichaient « Fait — mesuré dans vos données, vous pouvez agir
    dessus sans vérifier ». Sur la seconde, c'était une promesse que la preuve
    ne tenait pas.

    Les deux restent également CERTAINS — d'où un plafond de priorité identique.
    Ce qui les sépare est le chiffrage, et le rapport le montre sur un second
    axe plutôt que de le fondre dans le premier.
  */
  t.check("cinq niveaux, pas un de plus", EPISTEMIC_LEVELS.length, 5);

  const evidence = (based_on: string, assumptions = "") => ({ based_on, assumptions });
  const source = "Sessions et commandes Shopify sur 30 jours";
  const guess = "On suppose que le trafic est comparable au mois dernier";

  t.check(
    "base citée, sans hypothèse, confiance élevée → Fait",
    classifyEpistemic({ confidence: "high", evidence: evidence(source) }),
    "fait",
  );
  const releve = "Titre principal relevé sur la page d'accueil : « Collection »";
  t.check(
    "constatation non chiffrée, confiance élevée → Observé",
    classifyEpistemic({ confidence: "high", evidence: evidence(releve) }),
    "observe",
  );
  t.check(
    "une constatation ne devient pas une mesure par confiance déclarée",
    classifyEpistemic({ confidence: "high", evidence: evidence(releve) }) === "fait",
    false,
  );
  // Le test de chiffrage exige une quantité ET un repère de source ou de
  // période : un nombre isolé — une référence, une année — n'en fait pas une
  // mesure.
  t.check("un chiffre seul ne suffit pas", citeUneMesure("Référence 4021 absente"), false);
  t.check("un texte sans chiffre n'est jamais une mesure", citeUneMesure(releve), false);
  t.check("quantité + source = mesure", citeUneMesure(source), true);
  t.check(
    "quantité + période = mesure",
    citeUneMesure("412 paniers créés sur les 30 derniers jours"),
    true,
  );

  t.check(
    "base citée, sans hypothèse, confiance moyenne → Déduction forte",
    classifyEpistemic({ confidence: "medium", evidence: evidence(source) }),
    "deduction_forte",
  );
  t.check(
    "base citée, avec hypothèse, confiance élevée → Déduction forte",
    classifyEpistemic({ confidence: "high", evidence: evidence(source, guess) }),
    "deduction_forte",
  );
  t.check(
    "base citée, avec hypothèse, confiance moyenne → Hypothèse",
    classifyEpistemic({ confidence: "medium", evidence: evidence(source, guess) }),
    "hypothese",
  );
  t.check(
    "confiance faible → Hypothèse, même sans hypothèse déclarée",
    classifyEpistemic({ confidence: "low", evidence: evidence(source) }),
    "hypothese",
  );
  t.check(
    "sans base citée → Donnée manquante",
    classifyEpistemic({ confidence: "medium", evidence: evidence("") }),
    "donnee_manquante",
  );

  // LA règle anti-hallucination : la confiance annoncée par le modèle ne
  // rachète jamais l'absence de preuve.
  t.check(
    "confiance élevée sans base citée → Donnée manquante quand même",
    classifyEpistemic({ confidence: "high", evidence: evidence("") }),
    "donnee_manquante",
  );
  t.check(
    "champ evidence absent → Donnée manquante",
    classifyEpistemic({ confidence: "high" }),
    "donnee_manquante",
  );
  t.check(
    "evidence à null → Donnée manquante",
    classifyEpistemic({ confidence: "high", evidence: null }),
    "donnee_manquante",
  );
  t.check(
    "confiance inconnue traitée comme moyenne",
    classifyEpistemic({ confidence: "tres_haute", evidence: evidence(source) }),
    "deduction_forte",
  );
  t.check(
    "confiance absente traitée comme moyenne",
    classifyEpistemic({ evidence: evidence(source) }),
    "deduction_forte",
  );

  // --- Plafonds imposés par la certitude -----------------------------------
  t.check("un fait peut être critique", EPISTEMIC_CEILING.fait, "critique");
  t.check("une déduction forte peut être critique", EPISTEMIC_CEILING.deduction_forte, "critique");
  t.check("une hypothèse plafonne à Important", EPISTEMIC_CEILING.hypothese, "important");
  t.check(
    "une donnée manquante plafonne à Opportunité",
    EPISTEMIC_CEILING.donnee_manquante,
    "opportunite",
  );

  // --- Bandes ---------------------------------------------------------------
  t.check("quatre bandes", PRIORITY_BANDS.length, 4);
  t.check("critique est la plus urgente", BAND_RANK.critique, 0);
  t.check("optimisation est la moins urgente", BAND_RANK.optimisation, 3);
  t.check("la bande s'affiche avec sa pastille", formatBand("critique"), "🔴 Critique");
  t.check("la pastille verte est l'optimisation", formatBand("optimisation"), "🟢 Optimisation");

  // Relecture depuis la base : les problèmes analysés avant l'existence de ce
  // module ne portent ni bande ni niveau, et rien ne doit être inventé pour eux.
  t.check("une bande connue est relue", toPriorityBand("critique"), "critique");
  t.check("une bande inconnue est écartée", toPriorityBand("urgentissime"), null);
  t.check("une bande absente est écartée", toPriorityBand(null), null);
  t.check("un niveau connu est relu", toEpistemicLevel("donnee_manquante"), "donnee_manquante");
  t.check("un niveau inconnu est écarté", toEpistemicLevel("certitude"), null);
  t.check("un niveau absent est écarté", toEpistemicLevel(undefined), null);

  const band = (over: Partial<Parameters<typeof decideBand>[0]> = {}) =>
    decideBand({
      severity: "medium",
      epistemic: "fait",
      blocks: 0,
      causes: 0,
      gain: 0,
      difficulty: 2,
      ...over,
    });

  t.check(
    "une sévérité critique établie donne Critique",
    band({ severity: "critical" }).band,
    "critique",
  );
  t.check("une sévérité élevée donne Important", band({ severity: "high" }).band, "important");
  t.check(
    "une cause racine de deux problèmes devient critique",
    band({ blocks: ROOT_CAUSE_THRESHOLD }).band,
    "critique",
  );
  t.check("bloquer un seul problème donne Important", band({ blocks: 1 }).band, "important");
  t.check(
    "un gain chiffré et accessible donne Opportunité",
    band({ gain: 500 }).band,
    "opportunite",
  );
  t.check(
    "un gain chiffré mais difficile reste une Optimisation",
    band({ gain: 500, difficulty: 5 }).band,
    "optimisation",
  );
  t.check("sans gain ni dépendance, c'est une Optimisation", band().band, "optimisation");

  // Les deux plafonds, sur le cas qui compte : une sévérité critique annoncée.
  t.check(
    "une hypothèse critique est ramenée à Important",
    band({ severity: "critical", epistemic: "hypothese" }).band,
    "important",
  );
  t.check(
    "une donnée manquante critique est ramenée à Opportunité",
    band({ severity: "critical", epistemic: "donnee_manquante" }).band,
    "opportunite",
  );
  t.check(
    "le déclassement est dit dans la justification",
    band({ severity: "critical", epistemic: "hypothese" }).justification.includes(
      "Priorité ramenée de Critique à Important",
    ),
    true,
  );
  t.check(
    "aucun déclassement n'est annoncé quand il n'y en a pas",
    band({ severity: "critical" }).justification.includes("Priorité ramenée"),
    false,
  );

  // Une priorité qu'on ne sait pas expliquer ne sera pas suivie.
  t.check(
    "la justification commence par la sévérité",
    band({ severity: "critical" }).justification.startsWith("Sévérité critique."),
    true,
  );
  t.check(
    "la justification nomme le nombre de conséquences",
    band({ blocks: 3 }).justification.includes("Cause racine : 3 autres problèmes en découlent."),
    true,
  );
  t.check(
    "la justification annonce la dépendance amont",
    band({ causes: 1 }).justification.includes(
      "Conséquence d'un problème en amont, à corriger d'abord.",
    ),
    true,
  );
  t.check(
    "la justification dit sur quoi la conclusion repose",
    band({ epistemic: "donnee_manquante" }).justification.includes(
      "La donnée qui permettrait de conclure manque.",
    ),
    true,
  );

  // --- Clés -----------------------------------------------------------------
  t.check(
    "une clé est réduite à sa forme comparable",
    normalizeKey("Frais de Port"),
    "frais-de-port",
  );
  t.check(
    "les accents sont neutralisés",
    normalizeKey("Fiche produit détaillée"),
    "fiche-produit-detaillee",
  );
  t.check("les tirets en trop sont retirés", normalizeKey("  --panier--  "), "panier");
  t.check("une clé absente donne une chaîne vide", normalizeKey(undefined), "");
  t.check("une clé non textuelle donne une chaîne vide", normalizeKey(null), "");

  // --- Analyse : le cas nominal --------------------------------------------
  const solo = analyseFindings([make({ key: "panier" })]);
  t.check("un problème isolé reste seul", solo.findings.length, 1);
  t.check("sa priorité de base est celle du moteur de scoring", solo.findings[0].base_priority, 45);
  t.check("sans aval, la priorité n'est pas remontée", solo.findings[0].priority, 45);
  t.check("il est à la racine", solo.findings[0].chain_depth, 0);
  t.check("il ne bloque rien", solo.findings[0].blocks, 0);
  t.check("il n'est pas une cause racine", solo.findings[0].is_root_cause, false);
  t.check("il n'est pas un symptôme", solo.findings[0].is_symptom, false);
  t.check("un problème seul ne fait pas une chaîne", solo.chains.length, 0);
  t.check("aucune anomalie à signaler", solo.cycles.length + solo.unknown_references.length, 0);

  t.check("un tableau vide ne fait pas échouer l'analyse", analyseFindings([]).findings.length, 0);

  // --- Analyse : une cause et son symptôme ---------------------------------
  const pair = analyseFindings([
    make({ key: "frais-caches" }),
    make({ key: "abandon-panier", caused_by: ["frais-caches"] }),
  ]);
  const cause = pair.findings.find((f) => f.key === "frais-caches")!;
  const symptom = pair.findings.find((f) => f.key === "abandon-panier")!;

  t.check("la cause est identifiée comme telle", cause.is_root_cause, true);
  t.check("le symptôme est identifié comme tel", symptom.is_symptom, true);
  t.check("la cause bloque un problème", cause.blocks, 1);
  t.check("le symptôme ne bloque rien", symptom.blocks, 0);
  t.check("la profondeur du symptôme est 1", symptom.chain_depth, 1);
  t.check("le symptôme référence sa cause", symptom.causes, ["frais-caches"]);
  t.check("la cause référence son effet", cause.effects, ["abandon-panier"]);
  t.check(
    "la priorité de la cause remonte la moitié de celle du symptôme",
    cause.priority,
    Math.round(45 + BLOCKING_SHARE * 45),
  );
  t.check("celle du symptôme est inchangée", symptom.priority, 45);
  t.check("la cause passe avant", pair.findings[0].key, "frais-caches");
  t.check(
    "les rangs d'exécution se suivent",
    [pair.findings[0].order, pair.findings[1].order],
    [0, 1],
  );
  t.check("une chaîne est reconnue", pair.chains.length, 1);
  t.check("sa racine est la cause", pair.chains[0].root, "frais-caches");
  t.check("elle porte son symptôme", pair.chains[0].links, ["abandon-panier"]);

  // --- La contrainte dure : jamais le symptôme avant sa cause --------------
  // Cause peu grave et coûteuse, symptôme critique et immédiat : le classement
  // par priorité seule mettrait le symptôme devant. C'est exactement ce qu'il
  // ne faut pas faire — le corriger sans traiter sa cause ne produit rien.
  const inverted = analyseFindings([
    make({ key: "cause-mineure", severity: "low", difficulty: 5 }),
    make({
      key: "symptome-grave",
      severity: "critical",
      difficulty: 1,
      caused_by: ["cause-mineure"],
    }),
  ]);
  const minor = inverted.findings.find((f) => f.key === "cause-mineure")!;
  const severe = inverted.findings.find((f) => f.key === "symptome-grave")!;

  t.check("le symptôme grave pèse plus lourd seul", severe.base_priority, 300);
  t.check("la cause mineure pèse peu seule", minor.base_priority, 8);
  t.check("la cause hérite de ce qu'elle débloque", minor.priority, 158);
  t.check("le symptôme reste malgré tout devant au score", severe.priority > minor.priority, true);
  t.check("mais la cause est exécutée en premier", inverted.findings[0].key, "cause-mineure");
  t.check("le symptôme suit", inverted.findings[1].key, "symptome-grave");

  // --- Chaîne à trois maillons ---------------------------------------------
  const chain = analyseFindings([
    make({ key: "racine" }),
    make({ key: "milieu", caused_by: ["racine"] }),
    make({ key: "bout", caused_by: ["milieu"] }),
  ]);
  const root = chain.findings.find((f) => f.key === "racine")!;

  t.check("la racine bloque toute la descendance", root.blocks, 2);
  t.check(
    "la profondeur du dernier maillon est 2",
    chain.findings.find((f) => f.key === "bout")!.chain_depth,
    2,
  );
  t.check(
    "l'ordre suit la chaîne",
    chain.findings.map((f) => f.key),
    ["racine", "milieu", "bout"],
  );
  t.check("une seule chaîne est racontée", chain.chains.length, 1);
  t.check("elle porte ses deux conséquences", chain.chains[0].links, ["milieu", "bout"]);
  t.check("sa profondeur est annoncée", chain.chains[0].depth, 2);
  t.check("bloquer deux problèmes rend la racine critique", root.band, "critique");
  t.check(
    "et la justification le dit",
    root.justification.includes("Cause racine : 2 autres problèmes en découlent."),
    true,
  );

  // --- Le gain débloqué en aval --------------------------------------------
  const gains = analyseFindings([
    make({ key: "porte", estimated_gain_min: 0, estimated_gain_max: 0 }),
    make({
      key: "derriere",
      estimated_gain_min: 400,
      estimated_gain_max: 600,
      caused_by: ["porte"],
    }),
  ]);
  t.check(
    "une cause sans gain propre affiche le gain qu'elle débloque",
    gains.findings.find((f) => f.key === "porte")!.downstream_gain,
    500,
  );
  t.check(
    "le gain de la chaîne additionne ses maillons",
    [gains.chains[0].gain_min, gains.chains[0].gain_max],
    [400, 600],
  );

  // --- Entrées malformées : ce qu'un modèle produit réellement -------------
  const cyclic = analyseFindings([
    make({ key: "a", caused_by: ["b"] }),
    make({ key: "b", caused_by: ["a"] }),
  ]);
  t.check("une causalité circulaire ne fait pas boucler", cyclic.findings.length, 2);
  t.check("le cycle est signalé", cyclic.cycles.length, 1);
  t.check("le cycle est rapporté tel quel", cyclic.cycles[0], ["a", "b", "a"]);
  t.check(
    "une seule arête survit au cycle",
    cyclic.findings.reduce((sum, f) => sum + f.causes.length, 0),
    1,
  );

  const unknown = analyseFindings([make({ key: "a", caused_by: ["fantome"] })]);
  t.check("un renvoi vers un problème inexistant est écarté", unknown.findings[0].causes, []);
  t.check("et rapporté", unknown.unknown_references, [{ from: "a", reference: "fantome" }]);

  const selfRef = analyseFindings([make({ key: "a", caused_by: ["a"] })]);
  t.check("une auto-référence est écartée", selfRef.findings[0].causes, []);
  t.check("sans être signalée comme une référence inconnue", selfRef.unknown_references.length, 0);

  const duplicates = analyseFindings([make({ key: "panier" }), make({ key: "panier" })]);
  t.check("les clés en double sont rendues uniques", duplicates.findings.map((f) => f.key).sort(), [
    "panier",
    "panier-2",
  ]);
  t.check("le renommage est rapporté", duplicates.duplicate_keys, ["panier-2"]);

  const unkeyed = analyseFindings([make({ key: undefined }), make({ key: "" })]);
  t.check("une clé absente est reconstruite", unkeyed.findings.map((f) => f.key).sort(), [
    "probleme-1",
    "probleme-2",
  ]);

  const loose = analyseFindings([
    make({ key: "Frais de Port" }),
    make({ key: "panier", caused_by: ["frais de port"] }),
  ]);
  t.check(
    "un renvoi écrit autrement retrouve sa cible",
    loose.findings.find((f) => f.key === "panier")!.causes,
    ["frais-de-port"],
  );

  const duplicatedRef = analyseFindings([
    make({ key: "a" }),
    make({ key: "b", caused_by: ["a", "a"] }),
  ]);
  t.check(
    "une cause citée deux fois n'est comptée qu'une",
    duplicatedRef.findings.find((f) => f.key === "b")!.causes,
    ["a"],
  );

  const notAnArray = analyseFindings([make({ key: "a", caused_by: null })]);
  t.check("caused_by à null ne fait pas échouer", notAnArray.findings[0].causes, []);

  // --- Ce que l'audit ne sait pas ------------------------------------------
  const unsupported = analyseFindings([
    make({ key: "devine", severity: "critical", evidence: { based_on: "", assumptions: "" } }),
  ]);
  t.check(
    "une conclusion sans base est classée Donnée manquante",
    unsupported.findings[0].epistemic,
    "donnee_manquante",
  );
  t.check("et ne peut pas être déclarée critique", unsupported.findings[0].band, "opportunite");
  t.check("elle est listée à part", unsupported.missing_data, ["devine"]);

  // --- Répartition et stabilité --------------------------------------------
  t.check("la répartition par bande est comptée", countByBand(chain.findings), {
    critique: 1,
    important: 1,
    opportunite: 0,
    optimisation: 1,
  });

  const sample: GraphFinding[] = [
    make({ key: "un", severity: "high" }),
    make({ key: "deux", caused_by: ["un"] }),
    make({ key: "trois", severity: "critical", estimated_gain_min: 900, estimated_gain_max: 1100 }),
  ];
  t.check(
    "deux analyses des mêmes données donnent le même résultat",
    JSON.stringify(analyseFindings(sample)),
    JSON.stringify(analyseFindings(sample)),
  );
  t.check(
    "l'ordre d'exécution est une permutation complète",
    analyseFindings(sample)
      .findings.map((f) => f.order)
      .sort((a, b) => a - b),
    [0, 1, 2],
  );
});
