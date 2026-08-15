/**
 * Ce que le modèle renvoie, ramené à ce que la base accepte.
 *
 * LE DÉFAUT QUE CELA CORRIGE. La réponse du modèle partait telle quelle dans un
 * `insert`. Or `category`, `severity` et `timeframe` sont des ÉNUMÉRATIONS
 * PostgreSQL : une seule valeur inattendue — « pricing » au lieu de « offre »,
 * « urgent » au lieu de « critical » — faisait échouer l'insertion ENTIÈRE. Un
 * audit déjà payé, déjà facturé au fournisseur de modèles, et dont les neuf
 * autres problèmes parfaitement valides étaient perdus avec le dixième.
 *
 * Le même raisonnement vaut pour les nombres. `estimated_gain_min` renvoyé sous
 * forme de chaîne (« 500 € »), un `difficulty` à 12, un gain négatif : rien de
 * tout cela ne devrait décider de l'ordre dans lequel un marchand travaille.
 *
 * LE PRINCIPE : réparer ce qui est réparable, écarter ce qui ne l'est pas, et
 * ne JAMAIS inventer. Un champ manquant devient une valeur neutre annoncée
 * comme telle — jamais une valeur flatteuse. Un problème sans titre n'est pas
 * un problème : il est écarté, pas rebaptisé.
 *
 * Module PUR : aucune entrée-sortie.
 */

import { CATEGORIES } from "@/lib/scoring";

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export const TIMEFRAMES = ["today", "this_week", "this_month"] as const;
export const CONFIDENCES = ["low", "medium", "high"] as const;

/** Problème d'audit, une fois ramené à une forme sûre. */
export type SafeFinding = {
  key: string | null;
  caused_by: string[];
  category: string;
  severity: string;
  title: string;
  root_cause: string | null;
  impact_description: string | null;
  estimated_gain_min: number | null;
  estimated_gain_max: number | null;
  action_steps: Array<{ text: string }>;
  auto_correction: { title: string; content: string } | null;
  timeframe: string;
  difficulty: number;
  time_minutes: number;
  confidence: string;
  evidence: { based_on: string; assumptions: string };
};

export type SafeAudit = {
  verdict: string;
  summary: string;
  findings: SafeFinding[];
  /** Ce qui a été réparé ou écarté, pour les journaux. Jamais montré tel quel. */
  repairs: string[];
};

/**
 * Valeurs de repli.
 *
 * `medium` partout où le modèle n'a rien dit d'exploitable : ni alarmiste, ni
 * rassurant. `operations` comme domaine de repli parce qu'il porte le poids le
 * plus faible dans le score global — un problème mal classé ne doit pas peser
 * sur une note qu'il n'éclaire pas.
 */
const FALLBACK_CATEGORY = "operations";
const FALLBACK_SEVERITY = "medium";
const FALLBACK_TIMEFRAME = "this_week";
const FALLBACK_CONFIDENCE = "medium";

/** Bornes des champs numériques, telles que la base et le scoring les attendent. */
export const MAX_DIFFICULTY = 5;
export const MIN_DIFFICULTY = 1;
export const MAX_TIME_MINUTES = 60 * 24 * 30;
export const MAX_GAIN = 100_000_000;

function text(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, max);
}

/**
 * Un nombre, quelle que soit la façon dont le modèle l'a écrit.
 *
 * « 1 500 € », « 1500.50 », « ~2000 » : tous arrivent en pratique. On extrait
 * le nombre quand il y en a un, et on renvoie `null` sinon — jamais zéro, qui
 * serait une affirmation (« ce problème ne rapporte rien ») alors qu'on ne
 * sait pas.
 */
function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  // Espaces fines et insécables des milliers, virgule décimale française.
  const cleaned = value.replace(/[\s\u2009\u202f\u00a0]/gu, "").replace(",", ".");
  const match = cleaned.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function oneOf(value: unknown, allowed: readonly string[], fallback: string): [string, boolean] {
  const candidate = typeof value === "string" ? value.trim().toLowerCase() : "";
  return allowed.includes(candidate) ? [candidate, false] : [fallback, true];
}

/**
 * Ramène un problème à une forme insérable, ou l'écarte.
 *
 * Renvoie `null` quand il ne reste rien d'exploitable : sans titre, il n'y a
 * pas de problème à montrer, et lui en inventer un serait exactement ce que ce
 * module existe pour empêcher.
 */
export function sanitizeFinding(raw: unknown, repairs: string[] = []): SafeFinding | null {
  if (!raw || typeof raw !== "object") {
    repairs.push("Problème ignoré : ce n'était pas un objet.");
    return null;
  }
  const f = raw as Record<string, unknown>;

  const title = text(f.title, 300);
  if (!title) {
    repairs.push("Problème ignoré : sans titre.");
    return null;
  }

  const [category, categoryFixed] = oneOf(f.category, CATEGORIES, FALLBACK_CATEGORY);
  if (categoryFixed) {
    repairs.push(
      `« ${title} » : domaine « ${String(f.category)} » inconnu, reclassé en ${FALLBACK_CATEGORY}.`,
    );
  }
  const [severity, severityFixed] = oneOf(f.severity, SEVERITIES, FALLBACK_SEVERITY);
  if (severityFixed) {
    repairs.push(
      `« ${title} » : sévérité « ${String(f.severity)} » inconnue, ramenée à ${FALLBACK_SEVERITY}.`,
    );
  }
  const [timeframe] = oneOf(f.timeframe, TIMEFRAMES, FALLBACK_TIMEFRAME);
  const [confidence] = oneOf(f.confidence, CONFIDENCES, FALLBACK_CONFIDENCE);

  // Un gain négatif n'a pas de sens : une correction ne coûte pas du chiffre
  // d'affaires. Un gain démesuré non plus, et il écraserait tout le classement.
  const rawMin = num(f.estimated_gain_min);
  const rawMax = num(f.estimated_gain_max);
  let gainMin = rawMin === null ? null : clamp(rawMin, 0, MAX_GAIN);
  let gainMax = rawMax === null ? null : clamp(rawMax, 0, MAX_GAIN);
  // Une fourchette inversée est une inattention du modèle, pas une information.
  if (gainMin !== null && gainMax !== null && gainMin > gainMax) {
    [gainMin, gainMax] = [gainMax, gainMin];
    repairs.push(`« ${title} » : fourchette de gain inversée, remise à l'endroit.`);
  }

  const difficulty = clamp(Math.round(num(f.difficulty) ?? 2), MIN_DIFFICULTY, MAX_DIFFICULTY);
  const timeMinutes = clamp(Math.round(num(f.time_minutes) ?? 30), 1, MAX_TIME_MINUTES);

  const action_steps = Array.isArray(f.action_steps)
    ? f.action_steps
        .map((step) =>
          typeof step === "string"
            ? text(step, 600)
            : step && typeof step === "object"
              ? text((step as Record<string, unknown>).text, 600)
              : null,
        )
        .filter((t): t is string => Boolean(t))
        .map((t) => ({ text: t }))
    : [];

  const correction = f.auto_correction;
  const auto_correction =
    correction && typeof correction === "object"
      ? (() => {
          const c = correction as Record<string, unknown>;
          const cTitle = text(c.title, 300);
          const cContent = text(c.content, 20_000);
          // Une correction sans contenu n'est pas une correction : la garder
          // afficherait un bouton « copier » sur du vide.
          return cTitle && cContent ? { title: cTitle, content: cContent } : null;
        })()
      : null;

  const evidence =
    f.evidence && typeof f.evidence === "object" ? (f.evidence as Record<string, unknown>) : {};

  const causedBy = Array.isArray(f.caused_by)
    ? f.caused_by.filter((k): k is string => typeof k === "string" && k.trim().length > 0)
    : [];

  return {
    key: text(f.key, 120),
    caused_by: causedBy,
    category,
    severity,
    title,
    root_cause: text(f.root_cause),
    impact_description: text(f.impact_description),
    estimated_gain_min: gainMin,
    estimated_gain_max: gainMax,
    action_steps,
    auto_correction,
    timeframe,
    difficulty,
    time_minutes: timeMinutes,
    confidence,
    // Champs volontairement laissés VIDES plutôt que remplis d'une formule :
    // `finding-graph.ts` lit l'absence de base citée comme « donnée manquante »,
    // et c'est exactement ce qu'il faut dire quand le modèle n'a rien fourni.
    evidence: {
      based_on: text(evidence.based_on, 1000) ?? "",
      assumptions: text(evidence.assumptions, 1000) ?? "",
    },
  };
}

/**
 * Ramène une réponse d'audit entière à une forme sûre.
 *
 * Ne lève jamais. Une réponse sans le moindre problème exploitable produit un
 * audit vide et honnête — « rien n'a pu être établi » — plutôt qu'une erreur
 * technique ou, pire, une conclusion inventée pour remplir la page.
 */
export function sanitizeAuditPayload(raw: unknown): SafeAudit {
  const repairs: string[] = [];
  const payload = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const rawFindings = Array.isArray(payload.findings) ? payload.findings : [];
  if (!Array.isArray(payload.findings)) {
    repairs.push("Réponse sans liste de problèmes exploitable.");
  }

  const findings: SafeFinding[] = [];
  for (const item of rawFindings) {
    const safe = sanitizeFinding(item, repairs);
    if (safe) findings.push(safe);
  }

  return {
    verdict: text(payload.verdict, 300) ?? "Analyse terminée",
    summary:
      text(payload.summary, 4000) ??
      (findings.length === 0
        ? "Aucun problème n'a pu être établi à partir des données disponibles."
        : "Résumé indisponible."),
    findings,
    repairs,
  };
}
