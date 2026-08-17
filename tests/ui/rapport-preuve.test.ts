import { readFileSync } from "node:fs";
import { defineSuite } from "../harness";

/**
 * LA PREUVE ÉTAIT ÉCRITE, ENREGISTRÉE, ET JAMAIS MONTRÉE.
 *
 * CE QU'UNE REVUE DE L'APPLICATION RENDUE A MONTRÉ. Le rapport d'audit
 * affichait, pour chaque constat : une gravité, une catégorie, un titre, un
 * montant et deux boutons. Rien d'autre. Le marchand lisait « Critique ·
 * Les frais de livraison n'apparaissent qu'au paiement · +900 € à 1700 €/mois »
 * et devait décider, sur cette seule base, de modifier sa boutique.
 *
 * CE QUI EXISTAIT DÉJÀ. `audit_findings.evidence` est une colonne NON NULLE.
 * `audit-runner.server.ts` impose au modèle deux champs obligatoires —
 * `based_on` (ce sur quoi le constat repose) et `assumptions` (ce qu'il a fallu
 * supposer) — et les enregistre pour chaque constat, depuis toujours. La donnée
 * était donc produite, payée, stockée, et perdue à l'affichage.
 *
 * POURQUOI C'EST LE DÉFAUT LE PLUS COÛTEUX DU PRODUIT. Tout le reste de
 * l'application refuse d'inventer : un axe non mesuré reste non mesuré, un
 * score sans données n'est pas noté, une donnée absente est annoncée absente.
 * Cette rigueur ne servait à rien tant que le marchand ne pouvait pas la VOIR.
 * Un diagnostic sans preuve se croit ou ne se croit pas ; il ne se vérifie pas.
 * Et un marchand débutant, à qui l'on demande de toucher à sa propre boutique,
 * ne se croit pas.
 *
 * CE QUE CE CONTRÔLE PROTÈGE. Que la chaîne exigée du produit —
 * Observation → Problème → PREUVE → Impact → Recommandation → Correction —
 * reste entière à l'écran, et dans cet ordre. Un remaniement de la carte de
 * constat qui supprimerait le bloc de preuve, ou le déplacerait après la
 * recommandation, ferait échouer ici.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const lire = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");

const RAPPORT = "src/routes/_authenticated/audits.$auditId.tsx";
const MOTEUR = "src/lib/audit-runner.server.ts";

export default defineSuite("Rapport — la preuve est montrée au marchand", (t) => {
  const rapport = lire(RAPPORT);
  const moteur = lire(MOTEUR);

  // =========================================================================
  // 1. La donnée existe bien en amont — sinon ce contrôle n'aurait aucun objet
  // =========================================================================
  t.check("le moteur exige `based_on` du modèle", /based_on/.test(moteur), true);
  t.check("le moteur exige `assumptions` du modèle", /assumptions/.test(moteur), true);
  t.check(
    "les deux champs sont obligatoires, pas facultatifs",
    /required:\s*\["based_on",\s*"assumptions"\]/.test(moteur),
    true,
  );
  t.check(
    "et la preuve est bien écrite en base pour chaque constat",
    /evidence:\s*f\.evidence/.test(moteur),
    true,
  );

  // =========================================================================
  // 2. Le rapport lit la colonne, la déclare, et la rend
  // =========================================================================
  t.check(
    "le type Finding de la page déclare `evidence`",
    /^\s*evidence: unknown;/m.test(rapport),
    true,
  );
  t.check("la page lit la preuve", /lirePreuve\(/.test(rapport), true);
  t.check(
    "la preuve est rendue sous un intitulé que le marchand comprend",
    /Sur quoi nous nous appuyons/.test(rapport),
    true,
  );
  t.check(
    "les suppositions sont rendues au même endroit",
    /Ce que nous supposons/.test(rapport),
    true,
  );

  // LES DEUX CHAMPS SONT RENDUS SÉPARÉMENT. Fusionner « ce sur quoi on
  // s'appuie » et « ce qu'on suppose » ferait passer une hypothèse pour une
  // mesure — exactement ce que le reste du produit s'interdit.
  t.check("`based_on` est rendu", /preuve\.basedOn/.test(rapport), true);
  t.check("`assumptions` est rendu", /preuve\.assumptions/.test(rapport), true);

  // =========================================================================
  // 3. L'ORDRE de la chaîne, à l'écran
  // =========================================================================
  // Un bloc de preuve placé après la recommandation ne sert plus à décider : il
  // justifie après coup. L'ordre est donc vérifié, pas seulement la présence.
  const iPourquoi = rapport.indexOf("finding.root_cause");
  const iPreuve = rapport.indexOf("Sur quoi nous nous appuyons");
  const iImpact = rapport.indexOf("finding.impact_description");
  const iActions = rapport.indexOf("Ce que vous devez faire");

  t.check("« Pourquoi » est bien présent", iPourquoi > -1, true);
  t.check("« Impact » est bien présent", iImpact > -1, true);
  t.check("« Ce que vous devez faire » est bien présent", iActions > -1, true);
  t.check("la preuve vient après le problème", iPreuve > iPourquoi, true);
  t.check("la preuve vient avant l'impact", iPreuve < iImpact, true);
  t.check("l'impact vient avant la recommandation", iImpact < iActions, true);

  // =========================================================================
  // 4. Une preuve absente ne produit ni bloc vide ni « undefined »
  // =========================================================================
  // Les audits antérieurs à l'introduction de la colonne portent `{}`. Afficher
  // « Sur quoi nous nous appuyons » suivi de rien coûterait plus de confiance
  // que de ne rien afficher.
  t.check(
    "le rendu est conditionné à une preuve réellement lisible",
    /\{!compact && preuve && \(/.test(rapport),
    true,
  );
  t.check(
    "`lirePreuve` rend `null` quand les deux champs manquent",
    /if \(!basedOn && !assumptions\) return null;/.test(rapport),
    true,
  );
  t.check(
    "une valeur non textuelle est refusée plutôt qu'affichée",
    /typeof v === "string" && v\.trim\(\)/.test(rapport),
    true,
  );
  t.check(
    "un tableau ou une valeur nulle ne passe pas pour un objet de preuve",
    /!brut \|\| typeof brut !== "object" \|\| Array\.isArray\(brut\)/.test(rapport),
    true,
  );
});
