import { defineSuite } from "../harness";
import {
  MIN_COMPARABLE_SHARE,
  compareAudits,
  comparisonToText,
  type AuditSnapshot,
} from "@/lib/audit-comparison";
import { JARGON } from "@/lib/plain-language";
import type { AuditAxis } from "@/lib/audit-rules";

/**
 * DEUX AUDITS COMPARÉS, ET LE PIÈGE QUE PERSONNE N'ÉVITE.
 *
 * Comparer deux scores suppose qu'ils mesurent la même chose. Ce n'est presque
 * jamais le cas : entre deux audits, une source se déconnecte, une permission
 * expire, un site passe derrière un mot de passe. Le score chute de vingt points
 * sans qu'aucune boutique n'ait bougé, et l'outil annonce une dégradation
 * imaginaire. Un marchand à qui cela arrive une fois n'ouvre plus jamais
 * l'écran — et il a raison.
 *
 * La règle vérifiée en priorité est donc négative : un point qui n'était pas
 * mesuré des DEUX côtés ne se compare pas. Mieux vaut une comparaison partielle
 * et vraie qu'une comparaison complète et fausse.
 */

function axe(axis: AuditAxis, score: number, measured = true) {
  return { axis, score, measured };
}

function audit(over: Partial<AuditSnapshot> = {}): AuditSnapshot {
  return {
    id: "a1",
    createdAt: "2026-08-01T10:00:00Z",
    score: 60,
    axes: [axe("conversion", 60), axe("merchandising", 60)],
    findings: [],
    causes: [],
    ...over,
  };
}

export default defineSuite("Audit — comparaison entre deux passages", (t) => {
  // --- 1. LE PIÈGE : un point perdu de vue n'est pas un point dégradé -----
  const avant = audit({
    id: "a1",
    score: 70,
    axes: [axe("conversion", 80), axe("merchandising", 60)],
  });
  const apres = audit({
    id: "a2",
    createdAt: "2026-09-01T10:00:00Z",
    score: 60,
    // La conversion n'est plus mesurée : la source a lâché, pas la boutique.
    axes: [axe("conversion", 0, false), axe("merchandising", 60)],
  });
  const perte = compareAudits(avant, apres);
  const conv = perte.axes.find((a) => a.axis === "conversion");
  t.check("un point non mesuré des deux côtés n'est pas comparé", conv?.comparable, false);
  t.check("aucun écart n'est calculé dessus", conv?.delta, null);
  t.check("la valeur d'après est nulle, pas zéro", conv?.after, null);
  t.check(
    "le motif dit que cela vient de la collecte",
    /vient de la collecte, pas de votre boutique/.test(conv?.reason ?? ""),
    true,
  );
  // Sous le seuil de couverture, le score global se tait plutôt que de mentir.
  t.check("le score global n'est pas comparé", perte.scoreDelta, null);
  t.check("et le silence est expliqué", (perte.scoreCaveat ?? "").length > 40, true);

  // --- 2. Couverture identique : la comparaison a lieu ---------------------
  const stable = compareAudits(
    audit({ score: 60, axes: [axe("conversion", 50), axe("merchandising", 70)] }),
    audit({ id: "a2", score: 68, axes: [axe("conversion", 66), axe("merchandising", 70)] }),
  );
  t.check("le score est comparé quand la couverture tient", stable.scoreDelta, 8);
  t.check("aucune réserve n'est ajoutée", stable.scoreCaveat, null);
  t.check(
    "l'écart par point est calculé",
    stable.axes.find((a) => a.axis === "conversion")?.delta,
    16,
  );
  t.check(
    "un point inchangé donne un écart nul",
    stable.axes.find((a) => a.axis === "merchandising")?.delta,
    0,
  );
  t.check("le seuil de couverture est explicite", MIN_COMPARABLE_SHARE >= 0.5, true);

  // Un point noté pour la première fois n'est pas une amélioration.
  const nouveau = compareAudits(
    audit({ axes: [axe("conversion", 0, false), axe("merchandising", 60)] }),
    audit({ id: "a2", axes: [axe("conversion", 90), axe("merchandising", 60)] }),
  );
  const conv2 = nouveau.axes.find((a) => a.axis === "conversion");
  t.check("un point mesuré pour la première fois n'est pas comparé", conv2?.comparable, false);
  t.check("son écart reste nul", conv2?.delta, null);
  t.check(
    "le motif dit qu'il n'y a rien à comparer",
    /rien à comparer/.test(conv2?.reason ?? ""),
    true,
  );

  // --- 3. Constats : résolus, apparus, aggravés, persistants ---------------
  const f = (key: string, impact = 3) => ({ key, title: `titre ${key}`, severity: "high", impact });
  const constats = compareAudits(
    audit({ findings: [f("desc"), f("cta"), f("avis", 2)] }),
    audit({ id: "a2", findings: [f("cta"), f("avis", 4), f("stock")] }),
  );
  t.check(
    "un constat disparu est résolu",
    constats.resolved.map((x) => x.key),
    ["desc"],
  );
  t.check(
    "un constat nouveau est signalé",
    constats.appeared.map((x) => x.key),
    ["stock"],
  );
  t.check(
    "un constat dont l'impact monte est aggravé",
    constats.worsened.map((x) => x.key),
    ["avis"],
  );
  t.check(
    "un constat stable persiste",
    constats.persisting.map((x) => x.key),
    ["cta"],
  );
  // Chaque constat est dans exactement une catégorie : sinon le marchand
  // compterait deux fois le même travail.
  const toutes = [
    ...constats.resolved,
    ...constats.appeared,
    ...constats.worsened,
    ...constats.persisting,
  ].map((x) => x.key);
  t.check("aucun constat n'est classé deux fois", new Set(toutes).size, toutes.length);

  // « Aggravé » ne se déduit pas d'un ressenti : sans hausse d'impact, un
  // constat persiste, il ne s'aggrave pas.
  const sansAggravation = compareAudits(
    audit({ findings: [f("x", 4)] }),
    audit({ id: "a2", findings: [f("x", 4)] }),
  );
  t.check("un impact identique n'est pas une aggravation", sansAggravation.worsened.length, 0);
  t.check("il est compté comme persistant", sansAggravation.persisting.length, 1);
  const baisse = compareAudits(
    audit({ findings: [f("x", 5)] }),
    audit({ id: "a2", findings: [f("x", 2)] }),
  );
  t.check("un impact qui baisse n'est pas une aggravation", baisse.worsened.length, 0);

  // --- 4. Les causes racines, ce qui parle vraiment au marchand -----------
  const c = (id: string, title: string) => ({ id, title });
  const causes = compareAudits(
    audit({
      causes: [
        c("cause.boutique_muette", "La boutique n'explique pas ce qu'elle vend"),
        c("cause.rien_ne_rassure", "Rien ne rassure au moment de payer"),
      ],
    }),
    audit({
      id: "a2",
      causes: [
        c("cause.rien_ne_rassure", "Rien ne rassure au moment de payer"),
        c("cause.chemin_absent", "Le visiteur n'a pas de chemin vers l'achat"),
      ],
    }),
  );
  t.check(
    "une cause disparue est signalée",
    causes.causesResolved.map((x) => x.id),
    ["cause.boutique_muette"],
  );
  t.check(
    "une cause nouvelle est signalée",
    causes.causesAppeared.map((x) => x.id),
    ["cause.chemin_absent"],
  );
  t.check(
    "une cause qui demeure est signalée",
    causes.causesPersisting.map((x) => x.id),
    ["cause.rien_ne_rassure"],
  );

  // LA PHRASE D'OUVERTURE PARLE D'ABORD DU TRAVAIL FOURNI. Une cause disparue
  // correspond à quelque chose que le marchand se rappelle avoir fait ; sept
  // points de score ne correspondent à rien.
  t.check(
    "l'ouverture annonce le problème de fond réglé",
    /réglé un problème de fond/.test(causes.headline),
    true,
  );
  t.check(
    "elle nomme la cause en toutes lettres",
    /n'explique pas ce qu'elle vend/.test(causes.headline),
    true,
  );
  t.check(
    "elle signale aussi ce qui est apparu",
    /nouveau problème de fond/.test(causes.headline),
    true,
  );

  // --- 5. Aucune félicitation quand rien n'a bougé ------------------------
  // Un outil qui trouve toujours du positif cesse d'être cru le jour où il en
  // trouverait à raison.
  const rien = compareAudits(audit(), audit({ id: "a2" }));
  t.check(
    "l'immobilité est dite telle quelle",
    rien.headline,
    "Rien n'a changé depuis le dernier audit.",
  );
  const felicitations = ["bravo", "félicitations", "excellent", "super", "continuez ainsi"];
  for (const cas of [causes, constats, perte, stable, rien]) {
    for (const mot of felicitations) {
      t.check(
        `l'ouverture n'emploie pas « ${mot} »`,
        cas.headline.toLowerCase().includes(mot),
        false,
      );
    }
  }

  // --- 6. Le rendu ne contient aucun mot du moteur ------------------------
  for (const cas of [causes, constats, perte, stable, rien]) {
    const texte = comparisonToText(cas).join(" ").toLowerCase();
    for (const mot of JARGON) {
      t.check(`le récit n'emploie pas « ${mot} »`, texte.includes(mot), false);
    }
    for (const mot of ["cause racine", "symptôme", "axe ", "constat "]) {
      t.check(`le récit n'emploie pas « ${mot.trim()} »`, texte.includes(mot), false);
    }
  }
  t.check(
    "le récit commence par la phrase d'ouverture",
    comparisonToText(causes)[0],
    causes.headline,
  );
  t.check(
    "le récit dit ce qui bloque encore",
    comparisonToText(causes).some((l) => /bloque encore/.test(l)),
    true,
  );
  // Quand le score n'est pas comparable, le récit le dit au lieu de l'omettre.
  t.check(
    "un score non comparable est expliqué dans le récit",
    comparisonToText(perte).some((l) => /pas comparable/.test(l)),
    true,
  );
  t.check(
    "un point perdu de vue est expliqué dans le récit",
    comparisonToText(perte).some((l) => /collecte/.test(l)),
    true,
  );

  // --- 7. Cas limites ------------------------------------------------------
  // Deux audits sans rien : aucune exception, aucun chiffre inventé.
  const vides = compareAudits(
    audit({ score: null, axes: [], findings: [], causes: [] }),
    audit({ id: "a2", score: null, axes: [], findings: [], causes: [] }),
  );
  t.check("deux audits vides ne produisent aucun écart", vides.scoreDelta, null);
  t.check("et la raison est donnée", (vides.scoreCaveat ?? "").length > 30, true);
  t.check("aucun constat n'est fabriqué", vides.resolved.length + vides.appeared.length, 0);

  // Le tout premier audit d'une boutique n'a rien à quoi se comparer : la
  // fonction n'est simplement pas appelée, mais si elle l'était sur lui-même
  // elle ne doit rien inventer.
  const memeAudit = audit({ findings: [f("x")], causes: [c("cause.x", "X")] });
  const soi = compareAudits(memeAudit, memeAudit);
  t.check("un audit comparé à lui-même ne résout rien", soi.resolved.length, 0);
  t.check("ni ne fait apparaître quoi que ce soit", soi.appeared.length, 0);
  t.check("ni n'aggrave quoi que ce soit", soi.worsened.length, 0);
  t.check("et son écart de score est nul", soi.scoreDelta, 0);

  // Un axe présent d'un seul côté n'est jamais comparé.
  const asymetrique = compareAudits(
    audit({ axes: [axe("conversion", 50)] }),
    audit({ id: "a2", axes: [axe("conversion", 50), axe("seo", 90)] }),
  );
  t.check(
    "un axe absent d'un côté n'est pas comparé",
    asymetrique.axes.find((a) => a.axis === "seo")?.comparable,
    false,
  );
  t.check("mais il apparaît quand même dans la liste", asymetrique.axes.length, 2);
});
