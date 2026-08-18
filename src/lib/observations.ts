/**
 * LA COUCHE COMMUNE. Ce que toutes les sources produisent, et rien d'autre.
 *
 * POURQUOI ELLE EXISTE AVANT LE PREMIER CONNECTEUR. Shopify, Meta, Google, le
 * contenu organique, le marché et les concurrents n'ont ni les mêmes API, ni
 * les mêmes unités, ni les mêmes fenêtres. Si chacun parlait au moteur dans sa
 * propre langue, le moteur aurait six dialectes à connaître et chaque nouvelle
 * source demanderait de le rouvrir. C'est ainsi qu'on obtient six silos et un
 * diagnostic qui ne sait raisonner que sur le premier.
 *
 * Une OBSERVATION est le seul objet que le moteur accepte. Elle porte quatre
 * choses que rien d'autre ne porte :
 *
 * 1. **Sa valeur**, dans une unité déclarée — jamais un nombre nu dont il
 *    faudrait deviner s'il est un euro, un pourcentage ou un compte.
 * 2. **Sa preuve** : la phrase qui dit ce qui a été RÉELLEMENT lu, et où. Elle
 *    remonte telle quelle jusqu'au marchand. Une conclusion sans cette phrase
 *    n'est pas une conclusion, c'est une opinion.
 * 3. **Sa taille d'échantillon.** Un taux calculé sur trois commandes et le
 *    même taux sur trois mille ne se valent pas, et le moteur doit pouvoir
 *    refuser de conclure sur le premier.
 * 4. **Ce qu'elle permet de diagnostiquer.** C'est le chaînon qui manque
 *    partout ailleurs : une donnée n'a pas de valeur en soi, elle en a par ce
 *    qu'elle permet d'établir — ou d'écarter.
 *
 * LA RÈGLE QUI PROTÈGE DE L'INVENTION : ce qui n'est pas observé n'existe pas.
 * Une source qui ne fournit pas la donnée ne produit AUCUNE observation — elle
 * ne produit surtout pas une observation à zéro, qui se lirait comme une
 * mesure. L'absence est déclarée à part, nommément, et le moteur l'annonce au
 * modèle comme une interdiction de conclure.
 *
 * Module PUR : aucune entrée-sortie, aucune dépendance à une API.
 */

import type { Category } from "@/lib/scoring";

export const OBSERVATION_SOURCES = [
  "shopify",
  "meta",
  "google",
  "organic",
  "storefront",
  "market",
  "competitors",
  "declared",
] as const;

export type ObservationSource = (typeof OBSERVATION_SOURCES)[number];

export const SOURCE_LABELS: Record<ObservationSource, string> = {
  shopify: "Shopify",
  meta: "Meta Ads",
  google: "Google Ads",
  organic: "Contenu organique",
  storefront: "Site public",
  market: "Marché",
  competitors: "Concurrents",
  declared: "Déclaré par vous",
};

/** Unité de la valeur. Sans elle, un nombre nu n'est pas interprétable. */
export type ObservationUnit = "currency" | "count" | "percent" | "ratio" | "days" | "text";

export type Observation = {
  /** Identifiant stable, préfixé par sa source : `shopify.aov`. */
  id: string;
  source: ObservationSource;
  /** Domaine du moteur que cette donnée éclaire. */
  domain: Category;
  /** Nom lisible, tel qu'il apparaîtra au marchand. */
  label: string;
  value: number | null;
  unit: ObservationUnit;
  /** Valeur textuelle, pour ce qui ne se chiffre pas (nom de produit, statut). */
  text?: string | null;
  /** Devise, pour les montants uniquement. Jamais supposée. */
  currency?: string | null;
  /** Fenêtre couverte, en jours. 0 = état instantané (un stock, un prix). */
  periodDays: number;
  /**
   * CE QUI A ÉTÉ LU, mot pour mot. Remonte jusqu'au marchand comme preuve.
   * « 412 commandes payées sur 30 jours (Shopify /orders.json) ».
   */
  evidence: string;
  /**
   * Nombre d'éléments sous-jacents. `null` quand la notion n'a pas de sens.
   * Un taux sur 3 commandes ne vaut pas le même sur 3 000.
   */
  sample: number | null;
};

/** Fabrique une observation en garantissant les champs obligatoires. */
export function observe(input: Observation): Observation {
  return input;
}

export function findObservation(observations: Observation[], id: string): Observation | undefined {
  return observations.find((o) => o.id === id);
}

export function observationValue(observations: Observation[], id: string): number | null {
  return findObservation(observations, id)?.value ?? null;
}

/**
 * Ce qu'une source n'a PAS pu fournir, et pourquoi.
 *
 * Aussi important que ce qu'elle a fourni. C'est ce qui permet au moteur de
 * dire « je ne peux pas trancher, il me manque X » au lieu de trancher quand
 * même — le seul comportement qui distingue un diagnostic d'une devinette.
 */
export type ObservationGap = {
  /** Identifiant de la donnée absente, même forme que les observations. */
  id: string;
  label: string;
  source: ObservationSource;
  /** Pourquoi elle manque : permission, API, boutique trop jeune… */
  reason: string;
  /** Ce qu'on pourrait diagnostiquer si on l'avait. */
  wouldEnable: string;
};

/**
 * POURQUOI UNE SOURCE N'A PAS RÉPONDU.
 *
 * `error` porte la phrase technique, et la règle est bonne : elle n'est jamais
 * montrée au marchand. Mais tant qu'elle était la SEULE trace de la cause,
 * toutes les causes finissaient identiques — `allGaps` écrivait « Source
 * injoignable — aucune donnée de ce canal » pour chacune d'elles.
 *
 * Or elles ne demandent pas la même chose. Une autorisation révoquée se
 * répare en trente secondes, PAR LE MARCHAND, et lui seul peut le faire. Une
 * panne du fournisseur ne se répare pas du tout : il faut attendre. Les
 * confondre, c'est faire patienter quelqu'un devant une porte dont il a la
 * clé — et c'est précisément la boucle qui a été signalée : la boutique
 * apparaît reliée, le diagnostic ne trouve rien, et rien ne dit qu'il faut
 * rebrancher.
 *
 * Ce champ est donc un vocabulaire FERMÉ : il ne transporte aucun texte de
 * fournisseur, seulement de quoi choisir la bonne phrase.
 */
export type SourceFailureCause =
  /** 401/403, ou jeton indéchiffrable : l'accès est à refaire. Actionnable. */
  | "autorisation_invalide"
  /** 429 : nous avons trop demandé, ou la boutique est déjà sollicitée. */
  | "quota_depasse"
  /** 5xx : la panne est chez le fournisseur. Rien à faire, sinon reprendre. */
  | "fournisseur_en_panne"
  /** Réseau, délai dépassé, réponse illisible. Cause réellement inconnue. */
  | "injoignable";

/** Tout ce qu'une source a produit en un passage. */
export type SourceReport = {
  source: ObservationSource;
  observations: Observation[];
  gaps: ObservationGap[];
  /** La source a-t-elle répondu ? `false` = panne ou déconnexion. */
  reachable: boolean;
  /** Message d'erreur technique, jamais montré au marchand tel quel. */
  error?: string | null;
  /** Cause classée de l'échec. Absente, elle vaut `injoignable`. */
  cause?: SourceFailureCause | null;
};

/**
 * Ce que le marchand lit quand une source n'a rien donné.
 *
 * Chaque phrase dit deux choses et pas une : ce qui s'est passé, et à qui
 * revient la suite. C'est la seconde qui manquait.
 */
const RAISON_PAR_CAUSE: Record<SourceFailureCause, (nom: string) => string> = {
  autorisation_invalide: (nom) =>
    `Notre accès à ${nom} n'est plus valide : l'autorisation a été retirée, a expiré, ou n'a jamais été complète. Rebranchez ${nom} depuis votre boutique — c'est la seule chose à faire, et elle prend moins d'une minute.`,
  quota_depasse: (nom) =>
    `${nom} a limité le nombre de requêtes que nous pouvions faire au moment de l'analyse. Rien n'est cassé et il n'y a rien à rebrancher : relancez l'audit un peu plus tard.`,
  fournisseur_en_panne: (nom) =>
    `${nom} n'a pas pu répondre : la panne est de leur côté, pas du vôtre, et votre connexion reste valable. Relancez l'audit quand leur service sera rétabli.`,
  injoignable: (nom) =>
    `${nom} n'a pas répondu et nous n'avons pas su pourquoi. Votre connexion n'est pas remise en cause. Relancez l'audit ; si le silence persiste, la trace est de notre côté.`,
};

const UNIT_SUFFIX: Record<ObservationUnit, string> = {
  currency: "",
  count: "",
  percent: " %",
  ratio: "x",
  days: " jours",
  text: "",
};

/** Formate une valeur d'observation pour le prompt et l'affichage. */
export function formatObservation(o: Observation): string {
  if (o.value === null || !Number.isFinite(o.value)) return o.text ?? "donnée indisponible";
  const rounded = Math.round(o.value * 100) / 100;
  const money = o.unit === "currency" && o.currency ? ` ${o.currency}` : "";
  return `${rounded}${UNIT_SUFFIX[o.unit]}${money}`;
}

/**
 * Le bloc de FAITS injecté dans la demande d'audit.
 *
 * Chaque ligne porte sa preuve et sa taille d'échantillon. C'est ce qui permet
 * au modèle de remplir honnêtement le champ `evidence.based_on` — et donc au
 * classement épistémique de distinguer un fait d'une hypothèse au lieu de tout
 * recevoir au même niveau.
 */
export function observationsToPromptBlock(reports: SourceReport[]): string {
  const blocks: string[] = [];

  for (const report of reports) {
    const name = SOURCE_LABELS[report.source];

    if (!report.reachable) {
      blocks.push(
        `${name.toUpperCase()} : source injoignable pour le moment. N'invente AUCUN chiffre pour ce canal ; dis simplement que la donnée manque.`,
      );
      continue;
    }

    if (report.observations.length > 0) {
      const lines = report.observations.map(
        (o) =>
          `- ${o.label} : ${formatObservation(o)}${
            o.sample !== null ? ` (sur ${o.sample} élément(s))` : ""
          } — source : ${o.evidence}`,
      );
      blocks.push(`${name.toUpperCase()} — FAITS MESURÉS :\n${lines.join("\n")}`);
    }

    if (report.gaps.length > 0) {
      const lines = report.gaps.map((g) => `- ${g.label} : ${g.reason}`);
      blocks.push(
        `${name.toUpperCase()} — DONNÉES NON DISPONIBLES :\n${lines.join("\n")}\n` +
          `Tu n'as PAS le droit de conclure sur ces points. Si une piste en dépend, classe-la en confiance "low" et laisse "evidence.based_on" VIDE.`,
      );
    }
  }

  if (blocks.length === 0) {
    return `AUCUNE SOURCE DE DONNÉES CONNECTÉE. Chaque estimation est donc une hypothèse : confiance "low" partout, et "evidence.based_on" VIDE.`;
  }

  return blocks.join("\n\n");
}

/** Toutes les observations de tous les rapports, à plat. */
export function allObservations(reports: SourceReport[]): Observation[] {
  return reports.flatMap((r) => (r.reachable ? r.observations : []));
}

/** Tous les manques, à plat. Une source injoignable est un manque global. */
export function allGaps(reports: SourceReport[]): ObservationGap[] {
  return reports.flatMap((r) =>
    r.reachable
      ? r.gaps
      : [
          {
            id: `${r.source}.unreachable`,
            label: SOURCE_LABELS[r.source],
            source: r.source,
            // LA CAUSE ÉTAIT CALCULÉE, PUIS JETÉE ICI. Le connecteur savait
            // distinguer une autorisation révoquée d'une panne de fournisseur ;
            // cette ligne écrivait la même phrase pour les deux, et c'est la
            // seule que le marchand lise. Il n'apprenait donc jamais qu'il
            // devait rebrancher — sur l'écran fait pour le lui dire.
            reason: RAISON_PAR_CAUSE[r.cause ?? "injoignable"](SOURCE_LABELS[r.source]),
            wouldEnable: `Tout le diagnostic ${SOURCE_LABELS[r.source]}.`,
          },
        ],
  );
}
