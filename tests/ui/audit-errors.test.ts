import { readFileSync } from "node:fs";
import { defineSuite } from "../harness";
import {
  auditFailureText,
  canRetryNow,
  classifyAuditFailure,
  explainAuditFailure,
} from "@/lib/audit-errors";
import { readAudience, readCauses } from "@/lib/audit-narrative";

/**
 * CE QUE LE MARCHAND LIT QUAND SON AUDIT ÉCHOUE.
 *
 * LE DÉFAUT QUI JUSTIFIE CETTE SUITE, cité mot pour mot depuis la production :
 *
 *   « AI Gateway 404: models/gemini-2.5-pro is no longer available to new
 *     users. Please update your code to use a newer model. »
 *
 * Le marchand y lit qu'on lui demande de programmer, pour une panne qui venait
 * de NOTRE configuration. Il vient d'attendre son audit, et il repart avec une
 * phrase en anglais qui lui reproche implicitement quelque chose.
 *
 * Deux questions doivent trouver leur réponse dans chaque message : est-ce que
 * cela vient de moi ou d'eux, et qu'est-ce que je fais maintenant. Un message
 * d'échec qui ne répond pas aux deux ne sert qu'à prouver qu'on a détecté
 * l'échec.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");

export default defineSuite("Interface — échecs d'audit expliqués", (t) => {
  // --- 1. Le message réel de production est reconnu -----------------------
  const reel =
    "AI Gateway 404: models/gemini-2.5-pro is no longer available to new users. Please update your code to use a newer model for the latest features and improvements.";
  t.check("la panne réelle est classée", classifyAuditFailure(reel), "modele_indisponible");
  const f = explainAuditFailure(reel);
  t.check("elle est imputée à nous", f.whose, "nous");
  t.check("le marchand est explicitement déchargé", /Vous n'avez rien à faire/.test(f.next), true);
  t.check("son quota est rassuré", /pas été décompté/.test(f.next), true);

  // --- 2. Chaque famille répond aux deux questions -------------------------
  const cas: Array<[string, string]> = [
    ["AI Gateway 429: overloaded", "modele_surcharge"],
    ["AI Gateway 503 unavailable", "modele_surcharge"],
    ["Réponse IA invalide (length). Relance l'audit.", "reponse_invalide"],
    ["Jeton Shopify illisible.", "shopify_expire"],
    ["Shopify timeout", "shopify_injoignable"],
    ["Quota d'audits atteint", "quota"],
    ["Nombre de tentatives dépassé", "trop_de_tentatives"],
    ["Failed to fetch", "reseau"],
    ["boum", "inconnu"],
  ];
  for (const [brut, attendu] of cas) {
    t.check(`« ${brut.slice(0, 30)} » est classé`, classifyAuditFailure(brut), attendu);
    const e = explainAuditFailure(brut);
    t.check(`${attendu} : dit ce qui s'est passé`, e.what.length > 30, true);
    t.check(
      `${attendu} : dit à qui incombe la suite`,
      ["nous", "vous", "partenaire"].includes(e.whose),
      true,
    );
    t.check(`${attendu} : dit quoi faire`, e.next.length > 30, true);

    const texte = auditFailureText(brut);
    // AUCUN VOCABULAIRE TECHNIQUE, ni anglais, ni code d'erreur.
    for (const interdit of [
      "gateway",
      "404",
      "429",
      "503",
      "json",
      "token",
      "api",
      "update your code",
      "http",
    ]) {
      t.check(
        `${attendu} : n'expose pas « ${interdit} »`,
        texte.toLowerCase().includes(interdit),
        false,
      );
    }
    t.check(`${attendu} : le texte est en français`, /[éèàêç]/.test(texte), true);
  }

  // Une entrée absente ou vide reste traitée, sans lever.
  t.check("un message absent est traité", auditFailureText(null).length > 40, true);
  t.check("un message vide est traité", classifyAuditFailure(""), "inconnu");

  // --- 3. Le bouton proposé correspond à la panne -------------------------
  // Proposer « Relancer » sur une panne qui exige une reconnexion enverrait le
  // marchand échouer une seconde fois, et lui ferait croire que le produit
  // tourne en rond.
  t.check("une panne de notre côté se relance", canRetryNow(reel), true);
  t.check("une surcharge se relance", canRetryNow("AI Gateway 429"), true);
  t.check("un jeton expiré ne se relance pas", canRetryNow("Jeton Shopify illisible."), false);
  t.check("un quota atteint ne se relance pas", canRetryNow("Quota d'audits atteint"), false);

  // --- 4. L'écran utilise bien la traduction ------------------------------
  const page = read("src/routes/_authenticated/audits.$auditId.tsx");
  t.check("le message technique n'est plus affiché", /\{audit\.error_message\}/.test(page), false);
  t.check(
    "la traduction est utilisée",
    /auditFailureText\(audit\.error_message\)/.test(page),
    true,
  );
  t.check("le bouton dépend de la panne", /canRetryNow\(audit\.error_message\)/.test(page), true);
  // Le titre ne doit pas accuser : « Audit échoué » sonne comme un reproche,
  // et le marchand n'y est presque jamais pour quelque chose.
  t.check("le titre n'est pas accusateur", /Audit échoué/.test(page), false);
  t.check("le titre est factuel", /Cet audit n'a pas abouti/.test(page), true);
  // La reprise automatique ne doit pas non plus exposer le message brut.
  t.check(
    "la reprise automatique n'affiche plus l'erreur technique",
    /\{jobQ\.data\.lastError\}/.test(page),
    false,
  );
  t.check(
    "elle rassure sur le décompte",
    /sans que\s*\n?\s*cela vous coûte un audit/.test(page.replace(/\s+/g, " ")),
    true,
  );

  // --- 5. Le raisonnement du moteur est VISIBLE ---------------------------
  // Le portrait du client cible et les causes racines étaient calculés à chaque
  // audit, transmis au modèle, puis perdus. Ils influençaient le texte sans
  // jamais être montrés : le marchand lisait les conclusions sans voir le
  // raisonnement qui les produit — la différence exacte entre un consultant et
  // un générateur de conseils.
  t.check("le rapport affiche le raisonnement", /<AuditNarrative/.test(page), true);
  t.check("il lit le portrait conservé", /readAudience\(audit\.audience\)/.test(page), true);
  t.check("il lit les causes conservées", /readCauses\(audit\.root_causes\)/.test(page), true);

  const narratif = read("src/components/AuditNarrative.tsx");
  // LE POURCENTAGE DE CONFIANCE EST À CÔTÉ DU TITRE. Un lecteur qui ne le
  // verrait pas lirait une déduction comme un fait, et déciderait dessus.
  t.check(
    "le portrait est annoncé comme une hypothèse",
    /hypothèse — \{audience\.confidence\} % de confiance/.test(narratif),
    true,
  );
  t.check(
    "un signal d'achat se distingue d'un signal d'affichage",
    /s\.proven \? "vos ventes" : "votre site"/.test(narratif),
    true,
  );
  t.check(
    "ce qui manque pour affiner est dit",
    /Ce qui affinerait ce portrait/.test(narratif),
    true,
  );
  // Les causes doivent expliquer POURQUOI elles sont regroupées, sinon elles
  // ressemblent à une liste de plus.
  t.check(
    "le regroupement est justifié au marchand",
    /viennent du même problème/.test(narratif),
    true,
  );
  // Un audit sans ces données ne doit rien afficher plutôt qu'un cadre vide.
  t.check(
    "rien n'est affiché sans données",
    /if \(!audience && causes\.length === 0\) return null;/.test(narratif),
    true,
  );
  // Une valeur illisible en base ne fait pas tomber la page. Vérifié en
  // APPELANT la relecture, pas en cherchant sa garde dans le source : c'est le
  // comportement qui protège la page, pas la présence d'une ligne.
  t.check("un portrait absent rend null", readAudience(null), null);
  t.check("un portrait qui n'est pas un objet rend null", readAudience("premium"), null);
  t.check("un portrait sans énoncé rend null", readAudience({ confidence: 70 }), null);
  // SANS POURCENTAGE, PAS DE PORTRAIT : l'écran affiche la confiance à côté du
  // titre. Un portrait sans elle s'afficherait comme un fait établi.
  t.check("un portrait sans confiance rend null", readAudience({ segment: "Des skieurs" }), null);
  const relu = readAudience({ segment: "Des skieurs", confidence: 40 });
  t.check("un portrait minimal est relu", relu?.segment, "Des skieurs");
  t.check("sa confiance est conservée", relu?.confidence, 40);
  t.check("ses listes manquantes deviennent vides", relu?.signals.length, 0);
  t.check("une gamme illisible ne devient pas un texte", relu?.tier, null);
  // Les causes : ce qui n'a pas de titre ne s'affiche pas, mais ne fait pas
  // disparaître les autres.
  t.check("des causes absentes rendent une liste vide", readCauses(undefined).length, 0);
  t.check(
    "une cause sans titre est écartée sans perdre les autres",
    readCauses([{ id: "a" }, { id: "b", title: "Confiance insuffisante" }]).length,
    1,
  );
  // Aucun mot du moteur à l'écran. On juge le TEXTE AFFICHÉ, pas les
  // commentaires : ceux-ci expliquent le raisonnement à qui lit le code, et
  // c'est précisément là que le vocabulaire interne a sa place. Sans ce
  // retrait, la suite interdirait de documenter le module qu'elle protège.
  const affiche = narratif.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  for (const mot of ["cause racine", "symptôme", "avatar", "observation", "scoring"]) {
    t.check(`le rapport n'emploie pas « ${mot} »`, affiche.toLowerCase().includes(mot), false);
  }

  // Le moteur écrit bien ce que l'écran relit.
  const runner = read("src/lib/audit-runner.server.ts");
  t.check("le portrait est enregistré avec l'audit", /audience: audience/.test(runner), true);
  const migration = read("supabase/migrations/20260817120000_audit_audience.sql");
  t.check(
    "la colonne du portrait est créée",
    /ADD COLUMN IF NOT EXISTS audience jsonb/.test(migration),
    true,
  );

  // --- 6. Le message technique reste enregistré ---------------------------
  // Il ne doit pas être perdu : il sert à qui peut agir dessus.
  const jobs = read("src/lib/audit-jobs.server.ts");
  t.check("l'erreur technique est toujours stockée", /error_message: message/.test(jobs), true);
});
