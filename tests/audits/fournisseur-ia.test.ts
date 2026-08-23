import { readFileSync } from "node:fs";
import { defineSuite } from "../harness";
import {
  auditFailureText,
  classifyAuditFailure,
  explainAuditFailure,
  shouldRefundAudit,
} from "@/lib/audit-errors";
import {
  AI_TIMEOUT_MS,
  aiChatCompletionAvecSecours,
  aiFallbackModel,
  aiModel,
  meriteUnSecours,
} from "@/lib/ai-gateway.server";
import { LEASE_MS } from "@/lib/audit-jobs";
import { PARTENAIRE_TIMEOUT_MS, estUnDelaiDepasse } from "@/lib/fetch-borne.server";

/**
 * LE FOURNISSEUR D'ANALYSE : QUOTA, SECOURS, ET CE QU'ON DIT AU MARCHAND.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA PANNE RÉELLE, RELEVÉE EN PRODUCTION.
 *
 *     AI Gateway 429 … "status": "RESOURCE_EXHAUSTED"
 *     "quotaMetric": "generativelanguage.googleapis.com/
 *                     generate_content_free_tier_requests"
 *     "quotaValue": "20"      "model": "gemini-3.7-flash"
 *
 * Vingt analyses par JOUR sur l'offre gratuite. Passé la vingtième, tous les
 * audits de la journée échouent.
 *
 * CE QUE LE MARCHAND LISAIT. « Notre fournisseur d'analyse était saturé au
 * moment de votre audit. Cela vient d'un service externe, momentanément.
 * Relancez l'audit dans une dizaine de minutes. C'est passager et cela ne vient
 * ni de vous ni de vos données. »
 *
 * Quatre affirmations, trois fausses. Ce n'était pas passager — le compteur est
 * journalier. Dix minutes n'y changeaient rien. Et le fournisseur n'était pas
 * saturé : il refusait un client ayant dépassé son forfait. Seule la dernière
 * tenait, par accident.
 *
 * Le marchand relance, échoue, relance, échoue, et conclut que le produit ne
 * marche pas — au moment précis où il évalue s'il va payer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CETTE SUITE TIENT.
 *
 * 1. Les deux 429 ne se confondent plus : quota épuisé et débit limité
 *    n'appellent pas la même conduite, et l'un des deux ne s'arrange pas en
 *    attendant.
 * 2. Le secours ne se déclenche QUE sur ce qu'un autre modèle peut réparer.
 * 3. Le secours ne dégrade pas le diagnostic — c'est la condition qui rend un
 *    repli acceptable plutôt que dangereux.
 * 4. Un échec du fournisseur ne détruit pas ce qui a été collecté avant lui.
 *
 * Ce qui n'est PAS établi ici : qu'un modèle donné réponde réellement. Aucun
 * appel réseau n'est possible depuis cet environnement ; c'est l'étape « Les
 * modèles de langage configurés répondent » du déploiement qui s'en charge, sur
 * les trois modèles, à chaque livraison.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const lire = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");

/** Le corps réel renvoyé par Google, réduit à ce qui porte l'information. */
const QUOTA_REEL =
  'AI Gateway 429: {"error":{"code":429,"message":"You exceeded your current quota.",' +
  '"status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.QuotaFailure",' +
  '"violations":[{"quotaMetric":"generativelanguage.googleapis.com/generate_content_free_tier_requests",' +
  '"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier","quotaValue":"20"}]}]}}';

export default defineSuite("Fournisseur d'analyse — quota, secours et vérité", async (t) => {
  // =========================================================================
  // 1. LES DIX ÉCHECS, ET CE QU'ILS DEVIENNENT
  // =========================================================================
  const CAS: Array<[string, string, string]> = [
    ["429 quota journalier", QUOTA_REEL, "quota_fournisseur"],
    ["429 quota, forme courte", "AI Gateway 429: RESOURCE_EXHAUSTED", "quota_fournisseur"],
    ["429 débit limité", "AI Gateway 429: too many requests, slow down", "modele_surcharge"],
    ["413 charge trop grosse", "AI Gateway 413: request entity too large", "requete_invalide"],
    ["422 charge invalide", "AI Gateway 422: unprocessable entity", "requete_invalide"],
    ["503 fournisseur indisponible", "AI Gateway 503: service unavailable", "modele_en_panne"],
    ["408 délai dépassé", "AI Gateway 408: request timeout", "delai_depasse"],
    ["401 clé invalide", 'AI Gateway 401: {"error":"API key not valid"}', "configuration_ia"],
    [
      "404 modèle indisponible",
      "AI Gateway 404: models/gemini-x is no longer available",
      "modele_indisponible",
    ],
    ["réseau coupé", "fetch failed", "reseau"],
  ];

  for (const [nom, brut, attendu] of CAS) {
    t.check(`${nom} : classé`, classifyAuditFailure(brut), attendu);
    const texte = auditFailureText(brut);
    // Rien de technique n'atteint le marchand : la précision gagnée ne se paie
    // pas en jargon.
    for (const interdit of ["429", "gateway", "resource_exhausted", "quota_metric", "http"]) {
      t.check(
        `${nom} : n'expose pas « ${interdit} »`,
        texte.toLowerCase().includes(interdit),
        false,
      );
    }
    // Un échec du fournisseur ou de notre configuration rend toujours le
    // passage : le marchand n'a pas à payer notre panne.
    t.check(`${nom} : le passage est rendu`, shouldRefundAudit(brut), true);
  }

  // =========================================================================
  // 2. LE QUOTA NE SE DÉGUISE PLUS EN SATURATION
  // =========================================================================
  /*
    C'EST LE CŒUR DE LA CORRECTION, ET IL SE VÉRIFIE SUR LA PHRASE.

    Classer juste ne suffit pas : c'est le texte que le marchand lit, et lui
    seul, qui décide s'il relance dans dix minutes pour rien.
  */
  const quota = auditFailureText(QUOTA_REEL);
  t.check("le quota n'est pas annoncé comme une saturation", /saturé/i.test(quota), false);
  // ATTENTION À LA NÉGATION. Un simple /passager/ attrapait le mot dans la
  // phrase « Ce n'est pas un encombrement passager » — c'est-à-dire dans
  // l'affirmation inverse de celle qu'on veut interdire. On cherche donc la
  // forme AFFIRMATIVE, celle qu'emploie le message de saturation.
  t.check("il n'est pas annoncé comme passager", /c'est passager/i.test(quota), false);
  t.check(
    "…et il dit explicitement le contraire",
    /pas un encombrement passager/i.test(quota),
    true,
  );
  t.check(
    "il n'envoie pas relancer dans dix minutes",
    /dizaine de minutes|quelques minutes/i.test(quota),
    false,
  );
  t.check(
    "il dit franchement de ne pas relancer tout de suite",
    /inutile de relancer/i.test(quota),
    true,
  );
  t.check("il dit quand cela repart", /demain/i.test(quota), true);
  t.check("il est imputé à nous", explainAuditFailure(QUOTA_REEL).whose, "nous");
  t.check(
    "et il dédouane la boutique",
    /ne vient ni de vous ni de votre boutique/i.test(quota),
    true,
  );

  // Le débit limité, lui, garde le bon conseil : c'est vraiment passager.
  const debit = auditFailureText("AI Gateway 429: too many requests");
  t.check("un débit limité reste annoncé comme passager", /passager/i.test(debit), true);
  t.check("et il invite bien à relancer", /relancez/i.test(debit), true);
  t.check("les deux 429 ne disent pas la même chose", quota === debit, false);

  /*
    NE PAS INVENTER L'ÉTAT DE L'ERREUR — C'EST LA MÊME RÈGLE QUE POUR LE
    DIAGNOSTIC, APPLIQUÉE À NOS PROPRES PANNES.

    Le message d'un 5xx affirmait « ce n'est pas une saturation passagère » puis
    conseillait de « relancer dans l'heure plutôt que tout de suite ». Un code
    500, 502 ou 503 n'établit AUCUN des deux : il dit qu'une erreur s'est
    produite chez le fournisseur, pas si elle durera dix secondes ou deux jours.
    Le délai d'une heure était une invention, et la première phrase écartait
    précisément l'explication la plus fréquente d'un 502.

    Ce qui EST établi : le code vient du fournisseur, il n'a donc pas été
    déclenché par le contenu de la boutique.
  */
  const panne = auditFailureText("AI Gateway 503: service unavailable");
  t.check(
    "un 5xx n'affirme pas que ce n'est pas passager",
    /pas une saturation/.test(panne),
    false,
  );
  t.check("…et n'invente aucun délai d'attente", /dans l'heure/.test(panne), false);
  t.check(
    "…il dit que nous ne savons pas",
    /nous ne savons pas si c'est passager/i.test(panne),
    true,
  );
  // L'origine est située par l'étiquette « à qui c'est », pas répétée dans le
  // conseil : la redire deux fois dans le même message affaiblissait les deux.
  t.check("…tout en situant l'origine", /service externe que nous appelons/.test(panne), true);

  // « momentanément » était affirmé pour TOUTE panne partenaire, y compris
  // celles qui durent. Nous savons d'où vient l'erreur, pas combien de temps.
  t.check(
    "aucun message ne qualifie une panne externe de momentanée",
    /momentanément/.test(panne),
    false,
  );

  // ET AUCUN MESSAGE NE RENVOIE VERS UNE OFFRE PAYANTE QUI N'EXISTE PAS.
  const plafond = auditFailureText("Quota d'audits atteint pour cette période");
  t.check(
    "le plafond ne propose pas de passer à une offre supérieure",
    /offre supérieure|passer à une offre/i.test(plafond),
    false,
  );

  // UNE ERREUR INCONNUE RESTE UNE ERREUR INCONNUE.
  const mystere = auditFailureText("quelque chose d'inattendu s'est produit");
  t.check(
    "un échec inclassable ne s'invente pas de cause",
    /nous n'avons pas su dire précisément pourquoi/.test(mystere),
    true,
  );

  // =========================================================================
  // 3. LE SECOURS NE PART QUE QUAND IL PEUT SERVIR
  // =========================================================================
  /*
    Un secours déclenché trop largement est pire que pas de secours : sur une
    clé refusée il double les échecs d'authentification, et sur une charge
    invalide il risque qu'un modèle plus permissif accepte à moitié une demande
    mal formée — un diagnostic dégradé que rien ne distinguerait d'un bon.
  */
  for (const statut of [429, 404, 500, 502, 503, 504]) {
    t.check(`${statut} mérite un second modèle`, meriteUnSecours(statut), true);
  }
  for (const statut of [400, 401, 402, 403, 408, 413, 422, 200, 201]) {
    t.check(`${statut} ne mérite pas de second modèle`, meriteUnSecours(statut), false);
  }

  // =========================================================================
  // 4. LE SECOURS SE CONFIGURE, IL NE SE DEVINE PAS
  // =========================================================================
  const avant = process.env.AI_AUDIT_FALLBACK_MODEL;
  const avantPrincipal = process.env.AI_AUDIT_MODEL;

  delete process.env.AI_AUDIT_FALLBACK_MODEL;
  t.check("sans configuration, aucun secours", aiFallbackModel("audit"), null);

  process.env.AI_AUDIT_FALLBACK_MODEL = "  ";
  t.check("une valeur vide ne fait pas un secours", aiFallbackModel("audit"), null);

  process.env.AI_AUDIT_MODEL = "modele-principal";
  process.env.AI_AUDIT_FALLBACK_MODEL = "modele-principal";
  // Rejouer le même modèle rejouerait le même quota, pour le même refus.
  t.check("un secours identique au principal n'en est pas un", aiFallbackModel("audit"), null);

  process.env.AI_AUDIT_FALLBACK_MODEL = "modele-secours";
  t.check("un secours distinct est retenu", aiFallbackModel("audit"), "modele-secours");
  t.check("le principal reste le principal", aiModel("audit"), "modele-principal");

  if (avant === undefined) delete process.env.AI_AUDIT_FALLBACK_MODEL;
  else process.env.AI_AUDIT_FALLBACK_MODEL = avant;
  if (avantPrincipal === undefined) delete process.env.AI_AUDIT_MODEL;
  else process.env.AI_AUDIT_MODEL = avantPrincipal;

  // =========================================================================
  // 4 bis. LE SECOURS, EXÉCUTÉ POUR DE VRAI
  // =========================================================================
  /*
    LES CONTRÔLES CI-DESSOUS APPELLENT LA POLITIQUE DE REPRISE, ils ne la lisent
    pas. C'est la différence qui compte : une règle qui ne sert QUE les jours de
    panne est celle qu'on n'exerce jamais, et donc celle qui casse en silence.

    Le `fetch` est remplacé par une fonction qui note les modèles demandés et
    répond ce qu'on veut. Aucun appel réseau — cet environnement n'en permet
    aucun, et il n'en faudrait pas ici de toute façon.
  */
  const reponse = (statut: number, corps = "{}") =>
    new Response(corps, { status: statut, headers: { "content-type": "application/json" } });

  /** Enregistre les modèles appelés, dans l'ordre, et répond selon un scénario. */
  function passerelleSimulee(...statuts: number[]) {
    const appels: string[] = [];
    let i = 0;
    return {
      appels,
      appeler: async (corps: Record<string, unknown>) => {
        appels.push(String(corps.model));
        const statut = statuts[Math.min(i, statuts.length - 1)];
        i++;
        return reponse(statut, statut === 200 ? '{"ok":true}' : `{"error":${statut}}`);
      },
    };
  }

  const envAvant = {
    principal: process.env.AI_AUDIT_MODEL,
    secours: process.env.AI_AUDIT_FALLBACK_MODEL,
  };
  process.env.AI_AUDIT_MODEL = "principal-x";
  process.env.AI_AUDIT_FALLBACK_MODEL = "secours-y";
  const corpsPour = (modele: string) => ({ model: modele, messages: [], tools: [] });

  // --- Le cas heureux : le principal répond, rien d'autre n'est appelé ------
  {
    const p = passerelleSimulee(200);
    const r = await aiChatCompletionAvecSecours("audit", corpsPour, p.appeler);
    t.check("principal OK : la réponse est rendue", r.ok, true);
    t.check("principal OK : un seul appel", p.appels.length, 1);
    t.check("principal OK : c'est bien le principal", p.appels[0], "principal-x");
  }

  // --- FALLBACK RÉUSSI : quota épuisé, le secours aboutit ------------------
  {
    const p = passerelleSimulee(429, 200);
    const r = await aiChatCompletionAvecSecours("audit", corpsPour, p.appeler);
    t.check("secours réussi : une réponse exploitable est rendue", r.ok, true);
    t.check("secours réussi : deux appels", p.appels.length, 2);
    t.check("secours réussi : le principal d'abord", p.appels[0], "principal-x");
    t.check("secours réussi : puis le secours", p.appels[1], "secours-y");
  }

  // --- FALLBACK ÉCHOUÉ : les deux tombent, les deux statuts sont dits ------
  {
    const p = passerelleSimulee(429, 503);
    let message = "";
    try {
      await aiChatCompletionAvecSecours("audit", corpsPour, p.appeler);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    t.check("secours échoué : l'erreur remonte", message.length > 0, true);
    t.check("secours échoué : le premier statut est dit", /AI Gateway 429/.test(message), true);
    t.check("secours échoué : le second aussi", /AI Gateway 503/.test(message), true);
    t.check("secours échoué : le modèle de secours est nommé", /secours-y/.test(message), true);
    // Et le message reste classable sur la CAUSE D'ORIGINE : c'est le quota qui
    // a fait basculer, pas la panne du secours.
    t.check(
      "secours échoué : classé sur la cause d'origine",
      classifyAuditFailure(message),
      "modele_surcharge",
    );
  }

  // --- AUCUN SECOURS NE PART SUR UNE CLÉ REFUSÉE ---------------------------
  {
    const p = passerelleSimulee(401, 200);
    let message = "";
    try {
      await aiChatCompletionAvecSecours("audit", corpsPour, p.appeler);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    t.check("clé refusée : un seul appel", p.appels.length, 1);
    t.check("clé refusée : l'erreur est celle du principal", /AI Gateway 401/.test(message), true);
  }

  // --- NI SUR UNE CHARGE TROP GROSSE ---------------------------------------
  {
    const p = passerelleSimulee(413, 200);
    try {
      await aiChatCompletionAvecSecours("audit", corpsPour, p.appeler);
    } catch {
      /* attendu */
    }
    t.check("charge trop grosse : un seul appel", p.appels.length, 1);
  }

  // --- SANS SECOURS CONFIGURÉ, LE COMPORTEMENT NE CHANGE PAS ---------------
  {
    delete process.env.AI_AUDIT_FALLBACK_MODEL;
    const p = passerelleSimulee(429, 200);
    let message = "";
    try {
      await aiChatCompletionAvecSecours("audit", corpsPour, p.appeler);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    t.check("sans secours : un seul appel", p.appels.length, 1);
    t.check("sans secours : l'erreur d'origine remonte", /AI Gateway 429/.test(message), true);
  }

  // --- LES DEUX APPELS PORTENT LA MÊME DEMANDE -----------------------------
  /*
    LA GARANTIE QUI REND LE REPLI ACCEPTABLE. Si le secours envoyait autre chose
    — un schéma relâché, un prompt raccourci, l'outil forcé retiré — il rendrait
    un diagnostic d'une AUTRE NATURE, que rien à l'écran ni en base ne
    distinguerait du premier. Le marchand paierait le même prix pour autre chose.
  */
  {
    process.env.AI_AUDIT_FALLBACK_MODEL = "secours-y";
    const corps: Array<Record<string, unknown>> = [];
    const appeler = async (c: Record<string, unknown>) => {
      corps.push(c);
      return reponse(corps.length === 1 ? 429 : 200);
    };
    const riche = (modele: string) => ({
      model: modele,
      messages: [{ role: "system", content: "consigne" }],
      tools: [{ type: "function", function: { name: "submit_audit" } }],
      tool_choice: { type: "function", function: { name: "submit_audit" } },
    });
    await aiChatCompletionAvecSecours("audit", riche, appeler);
    t.check("deux demandes envoyées", corps.length, 2);
    const sansModele = (c: Record<string, unknown>) => {
      const { model: _model, ...reste } = c;
      return JSON.stringify(reste);
    };
    t.check("seul le modèle diffère", sansModele(corps[0]!) === sansModele(corps[1]!), true);
    t.check("le premier porte le principal", corps[0]!.model, "principal-x");
    t.check("le second porte le secours", corps[1]!.model, "secours-y");
  }

  if (envAvant.principal === undefined) delete process.env.AI_AUDIT_MODEL;
  else process.env.AI_AUDIT_MODEL = envAvant.principal;
  if (envAvant.secours === undefined) delete process.env.AI_AUDIT_FALLBACK_MODEL;
  else process.env.AI_AUDIT_FALLBACK_MODEL = envAvant.secours;

  // =========================================================================
  // 5. LE SECOURS NE DÉGRADE PAS LE DIAGNOSTIC
  // =========================================================================
  /*
    LA CONDITION QUI REND UN REPLI ACCEPTABLE.

    Un secours qui relâcherait le schéma de sortie, retirerait l'appel d'outil
    forcé ou raccourcirait le prompt « pour faire passer » la réponse
    produirait un diagnostic d'une AUTRE NATURE — et rien, ni à l'écran ni en
    base, ne permettrait de le distinguer du premier. Le marchand paierait le
    même prix pour autre chose.

    Le corps de l'appel est donc construit une seule fois, par une fonction qui
    ne prend que le nom du modèle. C'est vérifié sur la source : c'est la seule
    façon de garantir qu'un remaniement futur ne réintroduise pas deux corps
    d'appel qui divergeraient.
  */
  const runner = lire("src/lib/audit-runner.server.ts");
  t.check(
    "le corps de l'appel est construit une seule fois",
    /const corpsAppel = \(modele: string\) => \(\{/.test(runner),
    true,
  );
  t.check("seul le modèle varie", /model: modele,/.test(runner), true);
  // Que les deux appels partagent réellement ce corps est vérifié plus haut PAR
  // L'EXÉCUTION (« seul le modèle diffère »), ce qui vaut mieux qu'une lecture
  // de source. Ce qui reste ici est ce que l'exécution ne peut pas voir : que
  // le moteur d'audit délègue la reprise au lieu de la réécrire chez lui.
  t.check(
    "le moteur délègue la reprise à la passerelle",
    /aiChatCompletionAvecSecours\("audit", corpsAppel\)/.test(runner),
    true,
  );
  // L'outil forcé n'est déclaré qu'à un endroit : un secours qui l'oublierait
  // rendrait du texte libre, et `Réponse IA invalide` masquerait la cause.
  t.check(
    "l'appel d'outil forcé n'est déclaré qu'une fois",
    (runner.match(/tool_choice: \{ type: "function"/g) ?? []).length,
    1,
  );

  // Que le message d'un double échec porte les DEUX statuts est vérifié par
  // l'exécution, plus haut. Ce qui suit vérifie la conséquence : le message
  // combiné doit rester classable sur le PREMIER statut, celui qui explique
  // pourquoi on a basculé.
  const double = `AI Gateway 429: ${QUOTA_REEL} — secours modele-b : AI Gateway 503: down`;
  t.check(
    "un double échec reste classé sur la cause d'origine",
    classifyAuditFailure(double),
    "quota_fournisseur",
  );

  // =========================================================================
  // 6. UN ÉCHEC DU FOURNISSEUR NE DÉTRUIT PAS CE QUI A ÉTÉ COLLECTÉ
  // =========================================================================
  /*
    C'est la garantie la plus importante de cette suite, et la moins visible.

    La collecte Shopify, Meta, Google et le scan du site public tournent AVANT
    l'appel au modèle. Si leurs manques n'étaient enregistrés qu'après, un échec
    du fournisseur les emporterait tous — et le marchand lirait « fournisseur en
    erreur » sans jamais apprendre que son entonnoir était illisible depuis le
    début. C'est exactement le masquage que ce produit s'efforce d'éviter.
  */
  const iEnregistrement = runner.indexOf("data_gaps: allGaps(reports)");
  // ON VISE L'APPEL, PAS L'IMPORT. `indexOf` trouvait la ligne d'import en haut
  // du fichier — position ~74 — et non le site d'appel, mille lignes plus bas.
  // Deux contrôles d'ordre passaient ainsi par accident, en comparant une étape
  // du moteur à un import qui la précède toujours. `lastIndexOf` vise la
  // dernière occurrence, qui est l'appel.
  const iAppelModele = runner.lastIndexOf("aiChatCompletionAvecSecours");
  t.check("les manques de collecte sont enregistrés", iEnregistrement > -1, true);
  t.check("…AVANT l'appel au fournisseur", iEnregistrement < iAppelModele, true);

  // Chaque source garde son propre bloc d'échec : une source qui tombe n'emporte
  // pas les autres, et le fournisseur n'emporte aucune d'elles.
  t.check(
    "chaque source échoue pour son compte",
    (runner.match(/reachable: false/g) ?? []).length >= 4,
    true,
  );

  // =========================================================================
  // 7. LE SECOURS EST ESSAYÉ AU DÉPLOIEMENT, PAS LE JOUR DE LA PANNE
  // =========================================================================
  // Un secours dont on ne vérifie rien n'est pas un secours : on ne l'appelle
  // que lorsque le principal est déjà tombé — au pire moment pour découvrir
  // qu'il ne répond pas non plus.
  const deploiement = lire(".github/workflows/deploy.yml");
  t.check(
    "le workflow lit le modèle de secours",
    /AI_AUDIT_FALLBACK_MODEL/.test(deploiement),
    true,
  );
  t.check(
    "…et l'essaie avec les autres",
    /for modele in "\$audit" "\$fix" \$secours; do/.test(deploiement),
    true,
  );

  const wrangler = lire("wrangler.toml");
  t.check(
    "un secours est configuré en production",
    /^AI_AUDIT_FALLBACK_MODEL = "/m.test(wrangler),
    true,
  );
  // Et il diffère du principal, sinon il partagerait le même compteur de quota.
  const principal = /^AI_AUDIT_MODEL = "([^"]+)"/m.exec(wrangler)?.[1];
  const secours = /^AI_AUDIT_FALLBACK_MODEL = "([^"]+)"/m.exec(wrangler)?.[1];
  t.check("les deux modèles sont bien lus", Boolean(principal && secours), true);
  t.check("le secours n'est pas le principal", principal === secours, false);

  // =========================================================================
  // 8. UN FOURNISSEUR MUET FINIT PAR RENDRE LA MAIN
  // =========================================================================
  /*
    LE DÉFAUT, RELEVÉ SUR UN AUDIT RÉEL. Trois minutes de « Analyse en cours… »
    sur un écran qui en annonce quatre-vingt-dix secondes. L'appel au modèle
    partait SANS AUCUN DÉLAI : un fournisseur qui accepte la connexion puis ne
    répond jamais suspendait l'audit entier — pas d'erreur, pas de trace, pas de
    fin. Le travail étant réclamé sous un bail de cinq minutes, personne ne
    pouvait le reprendre pendant ce temps, et l'écran continuait d'affirmer
    qu'une analyse avançait.

    Ce qui rend ce défaut coûteux : `delai_depasse` existait déjà, avec le bon
    message et la bonne suite — « relancez maintenant, ce n'est ni vous ni une
    panne ». La branche était simplement INATTEIGNABLE.
  */
  t.check("l'appel au modèle porte un délai", AI_TIMEOUT_MS > 0, true);
  t.check(
    "…assez court pour tenir sous le bail qui protège l'audit",
    AI_TIMEOUT_MS < LEASE_MS,
    true,
  );

  const passerelle = lire("src/lib/ai-gateway.server.ts");
  t.check(
    "le délai est réellement posé sur la requête",
    /signal: AbortSignal\.timeout\(AI_TIMEOUT_MS\)/.test(passerelle),
    true,
  );

  // UN SILENCE DEVIENT UN CODE. Sans conversion, la `TimeoutError` nue ne porte
  // pas le préfixe `AI Gateway <code>` : elle serait rangée en « inconnu »,
  // c'est-à-dire « nous ne savons pas », alors que nous savons.
  const muet = await aiChatCompletionAvecSecours(
    "audit",
    (modele) => ({ model: modele }),
    async () => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    },
  ).catch((e: unknown) => e);
  t.check("un appel qui n'aboutit jamais lève", muet instanceof Error, true);

  const messageTimeout = "AI Gateway 408: aucune réponse au bout de 90 secondes";
  t.check(
    "un dépassement se classe en délai dépassé",
    classifyAuditFailure(messageTimeout),
    "delai_depasse",
  );
  t.check(
    "…et le marchand apprend qu'il peut relancer tout de suite",
    /[Rr]elancez/.test(auditFailureText(messageTimeout)),
    true,
  );
  // Il n'est PAS de notre faute, et il ne consomme pas le passage du marchand.
  t.check("…sans que ce soit présenté comme sa faute", shouldRefundAudit(messageTimeout), true);

  // LES PARTENAIRES AUSSI. Shopify, Meta et Google partaient nus eux aussi ;
  // c'est la valeur par défaut du `fetcher` qui porte la borne, pour que les
  // suites continuent d'injecter la leur.
  t.check("un délai partenaire est défini", PARTENAIRE_TIMEOUT_MS > 0, true);
  for (const connecteur of [
    "src/lib/connectors/shopify-observe.server.ts",
    "src/lib/connectors/meta-observe.server.ts",
    "src/lib/connectors/google-observe.server.ts",
  ]) {
    t.check(
      `${connecteur} ne part plus sur un fetch nu`,
      /fetcher: Fetcher = fetch,/.test(lire(connecteur)),
      false,
    );
    t.check(
      `${connecteur} borne ses appels`,
      /fetcher: Fetcher = fetchBorne,/.test(lire(connecteur)),
      true,
    );
  }

  // Un `signal` déjà posé par l'appelant est respecté : l'écraser retirerait
  // le budget global du scan de vitrine, qui pose déjà les siens.
  t.check(
    "un signal fourni par l'appelant n'est pas écrasé",
    /if \(init\?\.signal\) return fetch\(url, init\);/.test(lire("src/lib/fetch-borne.server.ts")),
    true,
  );

  // Le nom, pas la classe : `DOMException` diffère entre navigateur, Node et
  // worker, et un `instanceof` rendrait `false` sur l'une des trois — c'est-à-
  // dire précisément là où le cas se produit.
  t.check("un dépassement se reconnaît", estUnDelaiDepasse({ name: "TimeoutError" }), true);
  t.check("une annulation aussi", estUnDelaiDepasse({ name: "AbortError" }), true);
  t.check("une panne ordinaire, non", estUnDelaiDepasse(new Error("boom")), false);
  t.check("et une valeur nue ne fait pas tomber la lecture", estUnDelaiDepasse(null), false);
});
