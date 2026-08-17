/**
 * CE QUI A CHANGÉ DEPUIS LE DERNIER AUDIT.
 *
 * POURQUOI CE MODULE EXISTE. Un audit isolé dit où en est la boutique. Deux
 * audits comparés disent si le travail a servi — et c'est la seule question que
 * le marchand se pose vraiment après avoir passé une soirée à réécrire ses
 * fiches produit.
 *
 * LE PIÈGE, QUI EST LE MÊME PARTOUT ET QUE PERSONNE N'ÉVITE. Comparer deux
 * scores suppose qu'ils mesurent la même chose. Ce n'est presque jamais le cas :
 * entre deux audits, une source a pu se déconnecter, une permission expirer, un
 * site être protégé par mot de passe. Le score baisse alors de vingt points sans
 * qu'aucune boutique ait bougé, et l'outil annonce une dégradation imaginaire.
 * Un marchand à qui cela arrive une fois n'ouvre plus jamais l'écran.
 *
 * La règle centrale de ce module est donc négative : **un axe qui n'était pas
 * mesuré des DEUX côtés ne se compare pas.** Il est déclaré non comparable, avec
 * son motif. Mieux vaut une comparaison partielle et vraie qu'une comparaison
 * complète et fausse.
 *
 * CE QUI COMPTE LE PLUS N'EST PAS LE CHIFFRE. « Votre score est passé de 61 à
 * 68 » n'apprend rien. « La boutique n'explique plus ce qu'elle vend : cette
 * cause a disparu » se comprend d'un coup, parce que c'est exactement le travail
 * que le marchand a fourni. Les causes racines se comparent donc au même titre
 * que les scores, et passent devant dans le rendu.
 *
 * Module PUR.
 */

import type { AuditAxis } from "@/lib/audit-rules";
import { AXIS_LABELS } from "@/lib/audit-rules";

// ---------------------------------------------------------------------------
// Entrées
// ---------------------------------------------------------------------------

/** L'état d'un audit, réduit à ce qui se compare. */
export type AuditSnapshot = {
  id: string;
  /** Date de l'audit, en ISO. Sert à ordonner et à dater le récit. */
  createdAt: string;
  /** Score global. `null` quand aucun axe n'était mesuré. */
  score: number | null;
  /**
   * Score par axe. `null` quand l'axe n'était pas mesuré — un axe sans note
   * n'en porte plus une fausse, et deux `null` ne se soustraient pas.
   */
  axes: Array<{ axis: AuditAxis; score: number | null; measured: boolean }>;
  /** Constats, identifiés par une clé stable à travers les audits. */
  findings: Array<{ key: string; title: string; severity: string; impact: number }>;
  /** Causes racines établies lors de cet audit. */
  causes: Array<{ id: string; title: string }>;
};

// ---------------------------------------------------------------------------
// Sorties
// ---------------------------------------------------------------------------

export type AxisChange = {
  axis: AuditAxis;
  label: string;
  before: number | null;
  after: number | null;
  delta: number | null;
  /** Comparable seulement si les deux côtés étaient mesurés. */
  comparable: boolean;
  /** Quand ce n'est pas comparable, pourquoi — en langage marchand. */
  reason: string | null;
};

export type FindingChange = {
  key: string;
  title: string;
  /** Gravité, telle qu'elle sera dite au marchand. */
  severity: string;
};

export type CauseChange = { id: string; title: string };

export type AuditComparison = {
  /** Ce que le marchand lit en premier, en une phrase. */
  headline: string;
  before: { id: string; createdAt: string; score: number | null };
  after: { id: string; createdAt: string; score: number | null };
  /** Écart de score global, seulement s'il veut dire quelque chose. */
  scoreDelta: number | null;
  /** Pourquoi l'écart de score n'est pas donné, le cas échéant. */
  scoreCaveat: string | null;
  axes: AxisChange[];
  resolved: FindingChange[];
  appeared: FindingChange[];
  worsened: FindingChange[];
  persisting: FindingChange[];
  causesResolved: CauseChange[];
  causesAppeared: CauseChange[];
  causesPersisting: CauseChange[];
};

/**
 * Part des axes qui doit rester comparable pour que le score global le soit.
 *
 * En dessous, l'écart de score mesure surtout un changement de couverture, pas
 * un changement de boutique. Le taire vaut mieux que l'annoncer avec une
 * réserve que personne ne lit.
 */
export const MIN_COMPARABLE_SHARE = 0.6;

function byKey<T extends { key: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((i) => [i.key, i]));
}

/**
 * Compare deux audits.
 *
 * L'ordre des arguments n'est pas déduit des dates : l'appelant sait lequel est
 * l'ancien. Le deviner ici rendrait la fonction dépendante d'horloges qui
 * peuvent être fausses — et une comparaison inversée raconterait exactement
 * l'inverse de la vérité.
 */
export function compareAudits(before: AuditSnapshot, after: AuditSnapshot): AuditComparison {
  // --- Axes ----------------------------------------------------------------
  const axesAvant = new Map(before.axes.map((a) => [a.axis, a]));
  const axesApres = new Map(after.axes.map((a) => [a.axis, a]));
  const tousAxes = [...new Set([...axesAvant.keys(), ...axesApres.keys()])];

  const axes: AxisChange[] = tousAxes.map((axis) => {
    const a = axesAvant.get(axis);
    const b = axesApres.get(axis);
    // MESURÉ ET NOTÉ. Les deux conditions, pas une : un axe marqué mesuré mais
    // sans note ne se soustrait pas, et c'est le compilateur qui l'impose
    // maintenant que le score peut être absent.
    const avantNote = a?.measured && a.score !== null ? a.score : null;
    const apresNote = b?.measured && b.score !== null ? b.score : null;
    const comparable = avantNote !== null && apresNote !== null;
    return {
      axis,
      label: AXIS_LABELS[axis] ?? axis,
      before: avantNote,
      after: apresNote,
      delta: comparable ? apresNote - avantNote : null,
      comparable,
      reason: comparable
        ? null
        : !a?.measured && !b?.measured
          ? "Nous n'avons jamais eu les données nécessaires pour noter ce point."
          : !a?.measured
            ? "Nous n'avions pas ces données lors du premier audit : il n'y a rien à comparer, mais le point est noté aujourd'hui."
            : "Nous n'avons pas pu récupérer ces données cette fois-ci. Le point était noté avant, il ne l'est plus — cela vient de la collecte, pas de votre boutique.",
    };
  });

  // --- Score global --------------------------------------------------------
  // Il ne se compare que si la couverture est restée à peu près la même. Sinon
  // l'écart mesure notre collecte, pas le travail du marchand.
  const comparables = axes.filter((a) => a.comparable).length;
  const part = tousAxes.length > 0 ? comparables / tousAxes.length : 0;
  const scoreComparable =
    before.score !== null && after.score !== null && part >= MIN_COMPARABLE_SHARE;

  const scoreDelta = scoreComparable ? after.score! - before.score! : null;
  const scoreCaveat = scoreComparable
    ? null
    : before.score === null || after.score === null
      ? "Le score global n'est pas comparable : l'un des deux audits n'a pas pu noter assez de points."
      : "Le score global n'est pas comparable d'un audit à l'autre : nous n'avons pas eu accès aux mêmes données les deux fois. Les points ci-dessous, eux, restent comparables.";

  // --- Constats ------------------------------------------------------------
  const avant = byKey(before.findings);
  const apres = byKey(after.findings);

  const resolved: FindingChange[] = [];
  const persisting: FindingChange[] = [];
  const worsened: FindingChange[] = [];
  for (const [key, f] of avant) {
    const suite = apres.get(key);
    if (!suite) {
      resolved.push({ key, title: f.title, severity: f.severity });
      continue;
    }
    // « Aggravé » ne se déduit pas d'un ressenti : l'impact chiffré du constat
    // a augmenté, ou rien n'est dit.
    if (suite.impact > f.impact)
      worsened.push({ key, title: suite.title, severity: suite.severity });
    else persisting.push({ key, title: suite.title, severity: suite.severity });
  }
  const appeared: FindingChange[] = [...apres.entries()]
    .filter(([key]) => !avant.has(key))
    .map(([key, f]) => ({ key, title: f.title, severity: f.severity }));

  // --- Causes racines ------------------------------------------------------
  // C'est ce qui parle le plus au marchand : il a travaillé sur une cause, pas
  // sur une liste de symptômes.
  const causesAvant = new Map(before.causes.map((c) => [c.id, c]));
  const causesApres = new Map(after.causes.map((c) => [c.id, c]));
  const causesResolved = before.causes.filter((c) => !causesApres.has(c.id));
  const causesAppeared = after.causes.filter((c) => !causesAvant.has(c.id));
  const causesPersisting = after.causes.filter((c) => causesAvant.has(c.id));

  return {
    headline: headlineFor({
      causesResolved,
      causesAppeared,
      resolved,
      appeared,
      scoreDelta,
    }),
    before: { id: before.id, createdAt: before.createdAt, score: before.score },
    after: { id: after.id, createdAt: after.createdAt, score: after.score },
    scoreDelta,
    scoreCaveat,
    axes,
    resolved,
    appeared,
    worsened,
    persisting,
    causesResolved,
    causesAppeared,
    causesPersisting,
  };
}

/**
 * La phrase d'ouverture.
 *
 * ELLE PARLE D'ABORD DES CAUSES, ensuite des constats, et du score en dernier —
 * exactement l'inverse de l'ordre habituel. Une cause disparue correspond à un
 * travail que le marchand a fourni et reconnaît ; un score qui monte de sept
 * points ne correspond à rien qu'il puisse se rappeler avoir fait.
 *
 * Aucune félicitation quand rien n'a bougé : un outil qui trouve toujours du
 * positif cesse d'être cru le jour où il en trouverait à raison.
 */
function headlineFor(input: {
  causesResolved: CauseChange[];
  causesAppeared: CauseChange[];
  resolved: FindingChange[];
  appeared: FindingChange[];
  scoreDelta: number | null;
}): string {
  const { causesResolved, causesAppeared, resolved, appeared, scoreDelta } = input;

  if (causesResolved.length > 0) {
    const noms = causesResolved.map((c) => `« ${c.title.toLowerCase()} »`).join(" et ");
    const suite =
      causesAppeared.length > 0
        ? ` En revanche, un nouveau problème de fond est apparu : ${causesAppeared[0]!.title.toLowerCase()}.`
        : "";
    return `Vous avez réglé un problème de fond : ${noms} ne ressort plus de l'analyse.${suite}`;
  }
  if (causesAppeared.length > 0) {
    return `Un problème de fond est apparu depuis le dernier audit : ${causesAppeared[0]!.title.toLowerCase()}.`;
  }
  if (resolved.length > 0 && appeared.length === 0) {
    return `${resolved.length} point${resolved.length > 1 ? "s ont" : " a"} été corrigé${resolved.length > 1 ? "s" : ""} depuis le dernier audit, sans nouveau problème.`;
  }
  if (resolved.length > 0) {
    return `${resolved.length} point(s) corrigé(s), mais ${appeared.length} nouveau(x) est apparu.`;
  }
  if (appeared.length > 0) {
    return `${appeared.length} nouveau(x) point(s) à traiter depuis le dernier audit.`;
  }
  if (scoreDelta !== null && scoreDelta !== 0) {
    return `Aucun problème n'a été résolu ni ajouté ; le score a bougé de ${scoreDelta > 0 ? "+" : ""}${scoreDelta} point(s).`;
  }
  return "Rien n'a changé depuis le dernier audit.";
}

// ---------------------------------------------------------------------------
// Rendu marchand
// ---------------------------------------------------------------------------

/**
 * Le récit de la comparaison, sans un mot du moteur.
 *
 * Destiné à l'écran, pas au modèle : c'est déjà la sortie finale. Les mots
 * « cause racine », « axe », « constat » n'y figurent pas — un test le vérifie.
 */
export function comparisonToText(c: AuditComparison): string[] {
  const lignes: string[] = [c.headline];

  if (c.causesResolved.length > 0) {
    lignes.push(
      `Ce qui ne pose plus problème : ${c.causesResolved.map((x) => x.title.toLowerCase()).join(", ")}.`,
    );
  }
  if (c.causesPersisting.length > 0) {
    lignes.push(
      `Ce qui bloque encore : ${c.causesPersisting.map((x) => x.title.toLowerCase()).join(", ")}.`,
    );
  }
  if (c.resolved.length > 0) {
    lignes.push(
      `${c.resolved.length} point(s) réglé(s) : ${c.resolved.map((f) => f.title).join(" ; ")}.`,
    );
  }
  if (c.worsened.length > 0) {
    lignes.push(
      `${c.worsened.length} point(s) qui s'est aggravé : ${c.worsened.map((f) => f.title).join(" ; ")}.`,
    );
  }
  if (c.appeared.length > 0) {
    lignes.push(
      `${c.appeared.length} nouveau(x) point(s) : ${c.appeared.map((f) => f.title).join(" ; ")}.`,
    );
  }

  if (c.scoreDelta !== null) {
    lignes.push(
      `Note d'ensemble : ${c.before.score} → ${c.after.score} (${c.scoreDelta > 0 ? "+" : ""}${c.scoreDelta}).`,
    );
  } else if (c.scoreCaveat) {
    lignes.push(c.scoreCaveat);
  }

  const perdus = c.axes.filter((a) => !a.comparable && a.before !== null && a.after === null);
  for (const a of perdus) {
    lignes.push(`${a.label} : ${a.reason}`);
  }

  return lignes;
}
