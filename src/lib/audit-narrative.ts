/**
 * RELECTURE DE CE QUE LA BASE A CONSERVÉ DU RAISONNEMENT.
 *
 * POURQUOI UN MODULE SÉPARÉ. Ces fonctions ne dessinent rien : elles décident
 * si une valeur venue de la base est exploitable. C'est de la logique, pas de
 * l'affichage, et la garder dans le composant la rendait intestable autrement
 * qu'en lisant du JSX.
 *
 * TOLÉRANT PAR NÉCESSITÉ. Les audits antérieurs à ces colonnes n'ont ni
 * portrait ni causes ; un contenu inattendu ne doit pas faire tomber la page
 * entière d'un rapport par ailleurs valide. Une valeur illisible rend `null`,
 * ce que l'écran sait présenter en n'affichant rien — jamais un cadre vide qui
 * laisserait croire que l'analyse a été faite et n'a rien trouvé.
 *
 * Module PUR.
 */

export type AudienceView = {
  segment: string;
  tier: string | null;
  confidence: number;
  priceSensitivity: string;
  signals: Array<{ evidence: string; reading: string; proven: boolean }>;
  motivations: string[];
  objections: string[];
  missing: string[];
};

export type CauseView = {
  id: string;
  title: string;
  level?: string;
  priority?: number;
};

/**
 * Un portrait n'est lisible que s'il porte ses deux garanties : ce qu'il
 * affirme, et à quel point il en est sûr. Sans le pourcentage, l'écran
 * afficherait une déduction comme un fait.
 */
export function readAudience(raw: unknown): AudienceView | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Partial<AudienceView>;
  if (typeof a.segment !== "string" || typeof a.confidence !== "number") return null;
  return {
    segment: a.segment,
    tier: typeof a.tier === "string" ? a.tier : null,
    confidence: a.confidence,
    priceSensitivity: typeof a.priceSensitivity === "string" ? a.priceSensitivity : "inconnue",
    signals: Array.isArray(a.signals) ? a.signals : [],
    motivations: Array.isArray(a.motivations) ? a.motivations : [],
    objections: Array.isArray(a.objections) ? a.objections : [],
    missing: Array.isArray(a.missing) ? a.missing : [],
  };
}

export function readCauses(raw: unknown): CauseView[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (c): c is CauseView =>
      Boolean(c) && typeof c === "object" && typeof (c as CauseView).title === "string",
  );
}
