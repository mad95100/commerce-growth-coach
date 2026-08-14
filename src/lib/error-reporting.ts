/**
 * Remontée des erreurs du navigateur.
 *
 * CE QUI A CHANGÉ. Ce module poussait les exceptions vers deux crochets globaux
 * injectés uniquement par l'aperçu de l'ancien éditeur. Hors de cet aperçu —
 * c'est-à-dire en production — ils n'existaient pas, et **toutes les erreurs du
 * navigateur partaient donc dans le vide.**
 *
 * CE QUE FAIT LA VERSION ACTUELLE. Elle écrit d'abord dans la console, ce qui
 * garantit une trace en toutes circonstances, puis transmet à un collecteur
 * compatible Sentry s'il est présent. Le collecteur est détecté à l'exécution
 * et n'est pas une dépendance : brancher Sentry se fait en chargeant son script
 * d'initialisation, sans toucher à ce fichier ni aux appelants.
 */

type ReportOptions = {
  mechanism?: "manual" | "onerror" | "unhandledrejection" | "react_error_boundary";
  handled?: boolean;
  severity?: "error" | "warning" | "info";
};

/**
 * Surface minimale d'un collecteur. Sentry l'implémente, Bugsnag et Rollbar
 * exposent la même signature à un nom près — le typage reste donc volontairement
 * structurel, sans dépendre d'un fournisseur.
 */
type ErrorCollector = {
  captureException?: (
    error: unknown,
    context?: Record<string, unknown>,
    options?: ReportOptions,
  ) => void;
};

declare global {
  interface Window {
    Sentry?: ErrorCollector;
    __errorCollector?: ErrorCollector;
  }
}

/** Message lisible pour une valeur levée quelconque. */
export function describeThrown(error: unknown): string {
  // Les loaders et les fonctions serveur lèvent couramment une `Response` brute.
  // `String(...)` donnerait « [object Response] » : on extrait le statut et l'URL.
  if (error instanceof Response) {
    return `Response ${error.status}${error.url ? ` at ${error.url}` : ""}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export function reportError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;

  const route = window.location.pathname;
  const details = { source: "react_error_boundary", route, ...context };

  // La console d'abord : c'est la seule destination toujours disponible, et une
  // erreur perdue faute de collecteur configuré serait pire que tout.
  console.error(`[EcomPilot] ${describeThrown(error)}`, { error, ...details });

  const collector = window.Sentry ?? window.__errorCollector;
  collector?.captureException?.(error, details, {
    mechanism: "react_error_boundary",
    handled: false,
    severity: "error",
  });
}
