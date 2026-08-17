import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  WORK_STATES,
  WORK_STATE_LABELS,
  buildBriefing,
  summariseWork,
  type BriefingInput,
} from "../../src/lib/briefing";
import { buildFunnel } from "../../src/lib/funnel";
import type { NextMovePlan, PlannedMove } from "../../src/lib/next-move";
import type { Observation } from "../../src/lib/observations";
import { defineSuite } from "../harness";

/**
 * Le briefing : ce qu'un directeur dirait, en arrivant.
 *
 * CE QUI EST EN JEU. Le moteur calcule l'entonnoir, localise la fuite, la
 * chiffre, croise les canaux et sait ce qu'il ignore — et le marchand ne voit
 * qu'une liste de problèmes. Une liste, même bien classée, ne répond pas à la
 * seule question qu'il se pose : « qu'est-ce que je fais maintenant ? »
 *
 * DEUX RÈGLES QUE L'AFFICHAGE NE DOIT PAS TRAHIR, et qui sont vérifiées ici :
 *
 * 1. **Un montant non chiffrable ne devient pas zéro.** Une case vide dans un
 *    tableau de bord se lit comme une mesure. Une phrase ne se lit pas ainsi.
 *
 * 2. **Un bouton ne prétend jamais avoir corrigé.** « Corriger maintenant »
 *    n'apparaît que là où une correction existe, et il ouvre un aperçu avant
 *    toute écriture. Partout ailleurs, c'est une procédure annoncée comme telle.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

function obs(id: string, value: number, currency?: string): Observation {
  return {
    id,
    source: id.startsWith("meta") ? "meta" : "shopify",
    domain: "conversion",
    label: id,
    value,
    unit: currency ? "currency" : "count",
    currency: currency ?? null,
    periodDays: 30,
    evidence: `${value} relevé (${id.startsWith("meta") ? "Meta" : "Shopify"})`,
    sample: value,
  };
}

function move(overrides: Partial<PlannedMove> = {}): PlannedMove {
  return {
    id: "f1",
    auditId: "a1",
    title: "Frais de port cachés",
    category: "conversion",
    band: "critique",
    reason: "Sévérité critique. Établi sur tes données réelles.",
    gainMin: 200,
    gainMax: 400,
    timeMinutes: 30,
    unlocks: [],
    measure: "le taux de conversion et le taux d'abandon de panier, sur 7 jours",
    hasAutoFix: false,
    historyNote: null,
    ...overrides,
  };
}

function plan(overrides: Partial<NextMovePlan> = {}): NextMovePlan {
  return {
    alert: null,
    now: move(),
    then: [],
    blocked: [],
    unknowns: [],
    proven: [],
    ineffective: [],
    rationale: "…",
    ...overrides,
  };
}

/** Entonnoir avec une fuite chiffrée : 300 paniers, 60 commandes, 80 EUR pièce. */
const leaking = buildFunnel([
  obs("shopify.orders_30d", 60),
  obs("shopify.abandoned_checkouts_30d", 240),
  obs("shopify.aov", 80, "EUR"),
]);

export default defineSuite("Produit — briefing du directeur", (t) => {
  // --- Boutique avec une fuite chiffrée ------------------------------------
  const full = buildBriefing({
    plan: plan(),
    funnel: leaking,
    currency: "EUR",
    finding: {
      rootCause: "Les frais de livraison n'apparaissent qu'au paiement.",
      impactDescription: "Les visiteurs découvrent le vrai prix trop tard.",
      epistemic: "fait",
      basedOn: "240 paniers abandonnés pour 60 commandes payées (Shopify)",
      assumptions: "",
      actionSteps: ["Afficher les frais sur la fiche produit", "Proposer un seuil de gratuité"],
    },
  });

  t.check("le problème en tête est nommé", full.headline, "Priorité #1 — Frais de port cachés");
  // LE point : le montant vient de la MESURE, pas de l'estimation du modèle.
  t.check("l'impact est chiffré depuis les données", full.impact.includes("2400 EUR"), true);
  t.check(
    "et on dit d'où il vient",
    full.impact.includes("Ce montant vient de vos chiffres"),
    true,
  );
  t.check("la preuve de la fuite est citée", full.proof.length >= 2, true);
  t.check("la certitude est nommée", full.certainty.label, "Fait");
  t.check("avec ce qu'elle autorise", full.certainty.hint.length > 10, true);
  t.check("la cause racine est donnée", full.rootCause?.includes("frais de livraison"), true);
  t.check(
    "ce qu'on sait cite le taux de passage",
    full.known.some((k) => k.includes("20 %")),
    true,
  );
  t.check(
    "ce qu'on ignore rappelle que la référence est un ordre de grandeur",
    full.unknown.some((u) => u.includes("ordre de grandeur")),
    true,
  );
  t.check("le résultat attendu est chiffré", full.expected.includes("30"), true);
  t.check("la vérification est annoncée", full.verification.includes("taux de conversion"), true);
  t.check("et elle refuse l'impression", full.verification.includes("pas une impression"), true);

  // --- Le bouton ne ment pas ------------------------------------------------
  t.check("sans correction automatisable, on guide", full.action?.kind, "guider");
  t.check("le libellé le dit", full.action?.label, "Guider la correction");
  t.check("avec les étapes", full.action?.steps.length, 2);
  t.check("et rien n'est écrit", full.action?.writes, false);

  const auto = buildBriefing({
    plan: plan({ now: move({ hasAutoFix: true }) }),
    funnel: leaking,
    currency: "EUR",
  });
  t.check("avec une correction prête, on propose de corriger", auto.action?.kind, "corriger");
  t.check("le libellé le dit", auto.action?.label, "Corriger maintenant");
  t.check("sans étapes manuelles", auto.action?.steps.length, 0);
  // Même là, rien n'est écrit tant que l'aperçu n'a pas été confirmé.
  t.check("et rien n'est encore écrit", auto.action?.writes, false);

  // --- Fuite non chiffrable -------------------------------------------------
  const noAov = buildFunnel([
    obs("shopify.orders_30d", 20),
    obs("shopify.abandoned_checkouts_30d", 280),
  ]);
  const unpriced = buildBriefing({
    plan: plan({ now: move({ gainMin: null, gainMax: null }) }),
    funnel: noAov,
  });
  t.check(
    "un montant non chiffrable ne devient pas zéro",
    unpriced.impact.includes("Ce n'est pas zéro"),
    true,
  );
  t.check("il est annoncé comme inconnu", unpriced.impact.includes("inconnu"), true);
  t.check("et le problème reste traité", unpriced.headline !== null, true);

  // --- Estimation du modèle, faute de mesure -------------------------------
  const estimated = buildBriefing({
    plan: plan(),
    funnel: null,
    currency: "EUR",
    finding: { gainMin: 200, gainMax: 400, currency: "EUR" },
  });
  t.check(
    "l'estimation est utilisée en dernier recours",
    estimated.impact.includes("200 EUR"),
    true,
  );
  // Ce qui compte : elle est annoncée comme telle, pas comme une mesure.
  t.check(
    "et annoncée comme une estimation",
    estimated.impact.includes("C'est une estimation, pas une mesure"),
    true,
  );

  // --- Données manquantes ---------------------------------------------------
  const partial = buildFunnel([
    obs("shopify.orders_30d", 20),
    obs("shopify.abandoned_checkouts_30d", 280),
    obs("shopify.aov", 100, "EUR"),
  ]);
  const gapped = buildBriefing({
    plan: plan({ unknowns: [{ id: "u1", title: "Prix trop élevé" }] }),
    funnel: partial,
    currency: "EUR",
  });
  t.check(
    "les étapes non mesurées sont dites",
    gapped.unknown.some((u) => u.includes("n'est pas mesuré")),
    true,
  );
  t.check(
    "et la fuite non cherchée autour d'elles aussi",
    gapped.unknown.some((u) => u.includes("la fuite n'a pas été cherchée")),
    true,
  );
  t.check(
    "les conclusions non établies sont listées",
    gapped.unknown.some((u) => u.includes("Prix trop élevé")),
    true,
  );

  // --- Boutique saine -------------------------------------------------------
  const nothing = buildBriefing({ plan: plan({ now: null }) });
  t.check("sans problème, aucun titre alarmant", nothing.headline, null);
  t.check("aucune action", nothing.action, null);
  t.check("et rien n'est chiffré", nothing.impact.includes("Rien à chiffrer"), true);
  t.check(
    "on invite à relancer un diagnostic",
    nothing.nextDecision.includes("Relancez un diagnostic"),
    true,
  );

  // --- Aucune donnée du tout ------------------------------------------------
  const blank = buildBriefing({ plan: null });
  t.check("sans plan, rien n'est inventé", blank.headline, null);
  t.check(
    "et on propose le premier diagnostic",
    blank.nextDecision.includes("premier diagnostic"),
    true,
  );

  // --- Régression : elle passe avant tout ----------------------------------
  const regressed = buildBriefing({
    plan: plan({
      alert: {
        findingId: "x",
        title: "Budget Meta doublé",
        headline: "Achats Meta : -22 %.",
        automatic: true,
        actionId: "act1",
      },
    }),
    funnel: leaking,
  });
  t.check(
    "la régression prend la tête",
    regressed.headline?.includes("À réparer avant tout"),
    true,
  );
  t.check("l'action est d'annuler", regressed.action?.kind, "annuler");
  t.check("automatisable ici", regressed.action?.label, "Annuler la correction");
  t.check("c'est un fait mesuré", regressed.certainty.label, "Fait");
  t.check(
    "et le geste prévu reprend ensuite",
    regressed.nextDecision.includes("Frais de port cachés"),
    true,
  );

  const manual = buildBriefing({
    plan: plan({
      alert: { findingId: "x", title: "Ciblage", headline: null, automatic: false, actionId: null },
    }),
  });
  t.check("une annulation manuelle est dite", manual.action?.label, "Revenir en arrière à la main");
  t.check("avec une procédure", manual.action!.steps.length > 0, true);

  // --- Plusieurs problèmes : hiérarchie, pas liste -------------------------
  const many = buildBriefing({
    plan: plan({
      then: [
        move({ id: "f2", title: "Réassurance absente" }),
        move({ id: "f3", title: "Relance panier" }),
      ],
      blocked: [{ id: "f4", title: "Bloqué", blockedBy: ["Frais de port cachés"] }],
    }),
    funnel: leaking,
    currency: "EUR",
  });
  t.check("un seul problème est mis en tête", many.headline?.includes("Priorité #1"), true);
  t.check(
    "et la suite est annoncée, pas déversée",
    many.nextDecision.includes("Réassurance absente"),
    true,
  );

  // --- Corrections mesurées : prouvé, sans effet ---------------------------
  const learned = buildBriefing({
    plan: plan({
      proven: [{ findingId: "p", title: "Prix revu", headline: "+18 %" }],
      ineffective: [{ findingId: "i", title: "Bandeau", headline: null }],
    }),
    funnel: leaking,
    currency: "EUR",
  });
  t.check(
    "ce qui est prouvé est dit",
    learned.known.some((k) => k.includes("Prix revu") && k.includes("+18 %")),
    true,
  );
  t.check(
    "ce qui n'a rien donné aussi",
    learned.known.some((k) => k.includes("Bandeau") && k.includes("ce n'était pas le blocage")),
    true,
  );

  // --- Ce que le marchand voit d'un coup d'œil -----------------------------
  t.check("six états de travail", WORK_STATES.length, 6);
  const counts = summariseWork(
    plan({
      then: [move({ id: "f2" })],
      blocked: [{ id: "b", title: "B", blockedBy: ["A"] }],
      proven: [{ findingId: "p", title: "P", headline: null }],
      ineffective: [{ findingId: "i", title: "I", headline: null }],
      alert: { findingId: "r", title: "R", headline: null, automatic: true, actionId: null },
    }),
  );
  t.check("le travail restant est compté", counts.a_faire, 2);
  t.check("ce qui attend aussi", counts.en_attente, 1);
  t.check("ce qui est prouvé aussi", counts.prouve, 1);
  t.check("ce qui n'a rien donné aussi", counts.sans_effet, 1);
  t.check("la régression aussi", counts.regression, 1);
  t.check("sans plan, tout est à zéro", summariseWork(null).a_faire, 0);
  t.check(
    "chaque état a un libellé lisible",
    WORK_STATES.every((s) => WORK_STATE_LABELS[s].length > 3),
    true,
  );

  // --- L'affichage ne trahit pas le moteur ---------------------------------
  const funnelView = read("src/components/FunnelView.tsx");
  t.check(
    "une étape non mesurée s'affiche comme telle, pas à zéro",
    funnelView.includes("non mesuré"),
    true,
  );
  t.check(
    "et on dit pourquoi aucune fuite n'y est cherchée",
    // ESPACES SOUPLES, PAS `includes`. Prettier reflowe cette phrase sur trois
    // lignes du JSX, et un fragment littéral se casserait au prochain
    // formatage sans qu'un seul mot ait changé.
    /vous attribuer une perte dont\s+nous ne savons\s+rien/.test(funnelView),
    true,
  );
  t.check("une fuite non chiffrable le dit", funnelView.includes("sans votre panier moyen"), true);
  t.check(
    "un entonnoir sans décrochage ne conclut pas que tout va bien",
    funnelView.includes("Cela ne veut pas dire que tout va bien"),
    true,
  );
  t.check("la devise accompagne le montant", funnelView.includes("leak.currency"), true);
  t.check("la période est annoncée", funnelView.includes("30 derniers jours"), true);
  t.check("la preuve est accessible", funnelView.includes("step.evidence"), true);

  const card = read("src/components/BriefingCard.tsx");
  t.check("le briefing affiche la preuve", card.includes("Preuve"), true);
  t.check("la cause racine", card.includes("Cause racine"), true);
  t.check("ce qu'on sait", card.includes("Ce que nous savons"), true);
  t.check("ce qu'on ignore", card.includes("Ce que nous ne savons pas encore"), true);
  t.check("le résultat attendu", card.includes("Résultat attendu"), true);
  t.check("et comment ce sera vérifié", card.includes("Comment nous vérifierons"), true);
  // LE garde-fou : le bouton mène à l'aperçu, il n'exécute rien.
  t.check(
    "le bouton annonce l'aperçu avant écriture",
    // Fragment court : prettier reflowe les phrases longues sur plusieurs
    // lignes, et coller au texte entier rendrait le test faux au prochain
    // formatage sans que rien n'ait changé.
    card.includes("Vous verrez exactement ce qui sera modifié"),
    true,
  );

  const cockpit = read("src/components/Cockpit.tsx");
  t.check("le centre de pilotage affiche le briefing", cockpit.includes("BriefingCard"), true);
  t.check("et l'entonnoir", cockpit.includes("FunnelView"), true);
  t.check("et la répartition du travail", cockpit.includes("WORK_STATE_LABELS"), true);
  t.check(
    "le briefing passe avant les statistiques détaillées",
    cockpit.indexOf("BriefingCard") < cockpit.indexOf("Vos priorités"),
    true,
  );

  const cockpitFn = read("src/lib/cockpit.functions.ts");
  t.check("le briefing est construit depuis le moteur", cockpitFn.includes("buildBriefing"), true);
  t.check(
    "l'entonnoir vient de l'audit, il n'est pas recalculé",
    cockpitFn.includes("audit.funnel"),
    true,
  );
  const runner = read("src/lib/audit-runner.server.ts");
  t.check("et l'audit le conserve", runner.includes("funnel,"), true);
  t.check("avec les croisements", runner.includes("cross_signals: crossed"), true);
  t.check("et les manques de données", runner.includes("data_gaps"), true);

  // =========================================================================
  // UNE FUITE MESURÉE NE S'ATTRIBUE PAS À UN CONSTAT TECHNIQUE
  // =========================================================================
  // Le dernier endroit où un constat technique pouvait se voir habillé en
  // perte. La fuite est mesurée et son montant est juste — mais l'afficher sous
  // le problème en tête revient à LE LUI ATTRIBUER. Quand ce problème n'est
  // qu'un constat technique, rien n'établit ce lien, et la phrase se lirait
  // pourtant comme une facture.
  //
  // Le cas est atteignable : il suffit que la seule conclusion du domaine où
  // porte la fuite soit un constat technique. Elle repart alors sans montant,
  // plus rien n'est chiffré ailleurs, et elle prend la tête du plan.
  const constatEnTete = buildBriefing({
    plan: plan(),
    funnel: leaking,
    currency: "EUR",
    finding: {
      rootCause: null,
      impactDescription: null,
      epistemic: "fait",
      basedOn: "storefront.response_ms : 2 400 ms",
      assumptions: "",
      technicalOnly: true,
      actionSteps: [],
    },
  });

  t.check(
    "la fuite mesurée est toujours annoncée : elle est réelle",
    constatEnTete.impact.includes("2400 EUR"),
    true,
  );
  t.check(
    "mais elle n'est PAS attribuée au constat technique",
    constatEnTete.impact.includes("n'est PAS attribué à ce constat technique"),
    true,
  );
  t.check(
    "et l'absence de lien est dite en toutes lettres",
    constatEnTete.impact.includes("rien ne relie encore les deux"),
    true,
  );
  t.check(
    "ce que le constat coûte reste déclaré non mesuré",
    constatEnTete.impact.includes("n'est pas mesuré"),
    true,
  );
  t.check(
    "la formule qui attribuerait le montant disparaît",
    constatEnTete.impact.includes("Ce montant vient de tes chiffres"),
    false,
  );

  // Sans le drapeau, rien ne change pour les conclusions ordinaires.
  t.check(
    "une conclusion commerciale garde l'attribution directe",
    full.impact.includes("Ce montant vient de vos chiffres"),
    true,
  );

  // Cohérence de bout en bout : le drapeau doit réellement être calculé et
  // transmis, sinon la règle ne s'applique jamais en production.
  const cockpitSource = readFileSync(
    join(new URL("../../", import.meta.url).pathname, "src/lib/cockpit.functions.ts"),
    "utf8",
  );
  t.check(
    "le cockpit calcule le drapeau depuis la règle partagée",
    cockpitSource.includes("technicalOnly: lead ? isTechnicalConstat(lead) : false"),
    true,
  );
  t.check(
    "et il l'importe plutôt que de le redéduire",
    cockpitSource.includes("isTechnicalConstat,"),
    true,
  );
});
