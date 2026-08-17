import type { Db } from "@/lib/actions.server";
import { currencyLabel, normalizeCurrency } from "@/lib/currency";
import { computeCategoryScores, computeGlobalScore, computePotential } from "@/lib/scoring";
import { analyseFindings, applyTechnicalFrontier } from "@/lib/finding-graph";
import { applyHistory, historyToPromptBlock, type Attempt } from "@/lib/attempt-history";
import { sanitizeAuditPayload } from "@/lib/audit-sanitize";
import { allGaps, allObservations, observationsToPromptBlock } from "@/lib/observations";
import { analyse as analyseRules, rulesToPromptBlock } from "@/lib/audit-rules";
import {
  audienceInputFrom,
  audienceToPromptBlock,
  deduceAudience,
  findIncoherences,
} from "@/lib/audience";
import {
  experienceFindings,
  experienceToPromptBlock,
  extractExperience,
} from "@/lib/storefront-experience";
import { causesToPromptBlock, groupByCause, type Symptom } from "@/lib/root-cause";
import { assessDiagnostics, diagnosticsToPromptBlock } from "@/lib/diagnostics";
import { crossSignals, crossSignalsToPromptBlock } from "@/lib/cross-source";
import { anchorGainsOnLeak, buildFunnel, funnelToPromptBlock } from "@/lib/funnel";
import type { SourceReport } from "@/lib/observations";
import { AUDIT_MODEL, SYSTEM_PROMPT } from "@/lib/audit-prompt";
import { extractJsonBlock } from "@/lib/audit-parse";

/**
 * Travail long d'un audit : capture des données des canaux, appel au modèle,
 * calcul du score et écriture des résultats.
 *
 * Extrait tel quel de `runAudit`, sans changement de comportement : mêmes
 * requêtes, même prompt, mêmes règles de scoring, mêmes écritures. Seule change
 * la façon dont il est déclenché — hors du temps de la requête qui l'a demandé,
 * et donc hors de son délai d'expiration.
 *
 * La fonction ne rattrape pas ses propres échecs : elle laisse remonter, et
 * l'appelant décide s'il faut retenter ou déclarer forfait. C'est ce qui rend
 * la reprise possible.
 */
/**
 * Champs de la boutique dont l'audit a besoin.
 *
 * Énumérés plutôt que laissés en `Record<string, any>` : le compilateur signale
 * alors toute faute de frappe sur un nom de colonne, qui produirait sinon
 * silencieusement « (non renseigné) » dans le prompt.
 */
export type AuditStore = {
  id: string;
  name: string;
  url: string | null;
  niche: string | null;
  currency: string | null;
  situation: string | null;
  goal: string | null;
  monthly_revenue: number | null;
  monthly_ad_budget: number | null;
  revenue_goal: number | null;
  avg_product_cost_ratio: number | null;
  fixed_costs_monthly: number | null;
};

export async function executeAuditWork(input: {
  supabase: Db;
  userId: string;
  store: AuditStore;
  auditId: string;
}): Promise<void> {
  const { supabase, userId, store, auditId } = input;

  // Le fournisseur de modèles est résolu ici pour échouer tout de suite si la
  // configuration manque, plutôt qu'après la capture des données.
  const { aiChatCompletion, aiModel } = await import("@/lib/ai-gateway.server");

  // Données réelles de toutes les sources connectées (tolérant aux pannes)
  const { captureAndStoreSnapshot, getSnapshotAround, snapshotToPromptBlock } =
    await import("@/lib/snapshots.server");
  const snapshot = await captureAndStoreSnapshot(supabase as never, store.id);
  const previous = await getSnapshotAround(supabase as never, store.id, 7);
  const dataBlock = snapshotToPromptBlock(snapshot, previous, normalizeCurrency(store.currency));

  // OBSERVATIONS. La couche commune que toutes les sources alimenteront —
  // Shopify aujourd'hui, Meta, Google, l'organique et le marché ensuite. Le
  // moteur ne connaît que ce format : ajouter une source n'oblige jamais à le
  // rouvrir. Chaque observation porte sa preuve, sa taille d'échantillon et ce
  // qu'elle permet d'établir.
  const reports: SourceReport[] = [];
  /** Adresses où des commandes ont réellement atterri, à vérifier sur le site. */
  let landings: Array<{ path: string; orders: number }> = [];
  /** Titres et descriptions, pour lire le vocabulaire adressé au client. */
  let productTexts: string[] = [];
  try {
    const { loadChannelCredentials } = await import("@/lib/tracking.server");
    const creds = await loadChannelCredentials(supabase, store.id);
    if (creds.shopify) {
      const { fetchShopifyObservations } = await import("@/lib/connectors/shopify-observe.server");
      // Deux sources d'un seul appel : l'état de la boutique, et l'origine des
      // commandes — la seule mesure d'acquisition qui ne vienne pas des régies
      // elles-mêmes, donc la seule qui puisse les contredire.
      const shopifyReports = await fetchShopifyObservations(
        creds.shopify.shop,
        creds.shopify.encryptedToken,
      );
      reports.push(shopifyReports.shopify, shopifyReports.organic);
      landings = shopifyReports.landings;
      productTexts = shopifyReports.productTexts;
    }
    if (creds.meta) {
      const { fetchMetaObservations } = await import("@/lib/connectors/meta-observe.server");
      reports.push(await fetchMetaObservations(creds.meta.accountId, creds.meta.encryptedToken));
    }
    // Google appartient au chemin de diagnostic, pas aux statistiques : sans
    // lui, une boutique dont Meta va mal et Google va bien reçoit « ton
    // acquisition ne fonctionne pas » — faux, et coûteux.
    if (creds.google) {
      const { fetchGoogleObservations } = await import("@/lib/connectors/google-observe.server");
      reports.push(
        await fetchGoogleObservations(creds.google.customerId, creds.google.encryptedRefreshToken),
      );
    }
  } catch (err) {
    // Une collecte en échec ne doit pas faire échouer l'audit : il repart
    // alors sur les seules données déclarées, en le disant.
    console.error("[audit] collecte des observations impossible :", err);
  }

  // LE SITE PUBLIC. L'angle mort le plus coûteux : le moteur diagnostiquait la
  // conversion sans avoir jamais ouvert la page que le visiteur reçoit. Une
  // fiche parfaite dans l'API peut être servie sans bouton d'achat, et une
  // page d'arrivée qui a vendu peut renvoyer 404 depuis des semaines.
  //
  // Scan isolé du reste : le site du marchand peut être lent, protégé ou en
  // panne, et cela ne doit jamais emporter un audit qui a par ailleurs de quoi
  // conclure. Ce qu'il produit reste des FAITS TECHNIQUES — leur passage à une
  // explication commerciale n'a lieu que dans le croisement, avec preuve.
  /**
   * Le document d'accueil, conservé hors du `try`.
   *
   * Il sert à la lecture d'expérience, bien plus bas. Le déclarer ici plutôt
   * qu'au vol garantit qu'un scan qui échoue laisse `null` — donc une lecture
   * d'expérience qui ne s'exécute pas — au lieu d'une variable absente.
   */
  let homeHtml: string | null = null;
  try {
    const { scanStorefront } = await import("@/lib/connectors/storefront.server");
    const storefrontScan = await scanStorefront(store.url, landings);
    reports.push(storefrontScan);
    homeHtml = storefrontScan.homeHtml;
  } catch (err) {
    console.error("[audit] scan du site public impossible :", err);
  }

  // Ce que ces données autorisent à conclure — et surtout ce qu'elles
  // interdisent. C'est la barrière la plus en amont contre l'invention :
  // celle qui agit avant que la phrase ne soit écrite.
  const availability = assessDiagnostics(allObservations(reports));

  // CROISEMENT. Ce qu'aucune source ne montre seule : ce que devient le trafic
  // payant une fois arrivé sur la boutique. C'est ce croisement qui départage
  // « ma publicité est mauvaise » de « ma boutique perd les gens qu'elle
  // amène » — deux diagnostics opposés qu'un seul canal ne peut pas séparer.
  const crossed = crossSignals(allObservations(reports));

  // L'ENTONNOIR. Le croisement dit que la fuite est après le clic ; l'entonnoir
  // dit à QUELLE MARCHE, et ce qu'elle coûte. C'est ce qui transforme une liste
  // de chiffres en « voici le problème qui te coûte le plus ». Les marches non
  // mesurées sont nommées : la fuite n'est jamais cherchée au travers d'un trou.
  const funnel = buildFunnel(allObservations(reports));

  const { data: profile } = await supabase
    .from("profiles")
    .select("experience_level")
    .eq("user_id", userId)
    .maybeSingle();

  // MÉMOIRE DE LA BOUTIQUE. Ce qui a déjà été corrigé, et ce que la mesure en a
  // dit. Sans elle le diagnostic repartirait de zéro et reproposerait ce qui a
  // échoué le mois dernier — la faute qui fait perdre confiance en premier.
  // Une lecture en échec ne doit pas empêcher l'audit : on repart alors sans
  // mémoire, comme avant, plutôt que de ne rien produire.
  let history: Attempt[] = [];
  try {
    const { data: attempts } = await supabase
      .from("fix_attempts")
      .select(
        "finding_key, title, category, tool_name, verdict, headline, applied_at, rollback_recommended, rollback_possible",
      )
      .eq("store_id", store.id)
      .order("applied_at", { ascending: false })
      .limit(40);
    history = ((attempts ?? []) as Array<Record<string, unknown>>).map((a) => ({
      key: (a.finding_key as string | null) ?? null,
      title: (a.title as string) ?? "Correction",
      category: (a.category as string | null) ?? null,
      tool: (a.tool_name as string | null) ?? null,
      verdict: (a.verdict as string | null) ?? null,
      headline: (a.headline as string | null) ?? null,
      appliedAt: (a.applied_at as string) ?? new Date().toISOString(),
      rollbackRecommended: (a.rollback_recommended as boolean | null) ?? false,
      rollbackPossible: (a.rollback_possible as boolean | null) ?? false,
    }));
  } catch (err) {
    console.error("[audit] mémoire des corrections illisible :", err);
  }

  const levelHint =
    profile?.experience_level === "avance"
      ? "Utilisateur AVANCÉ : tu peux être plus technique et plus dense."
      : profile?.experience_level === "intermediaire"
        ? "Utilisateur INTERMÉDIAIRE : reste simple mais tu peux utiliser les termes courants (ROAS, CPA, AOV) en les rappelant."
        : "Utilisateur DÉBUTANT : phrases courtes, zéro jargon, maximum 4 problèmes, et commence par ce qui bloque la toute première vente.";

  const situationHint =
    store.situation === "no_sales"
      ? "Situation : AUCUNE VENTE. Concentre-toi en priorité sur offre, prix, page produit, confiance, trafic, tracking et checkout."
      : store.situation === "few_sales"
        ? "Situation : QUELQUES VENTES. Cherche ce qui empêche de passer à l'échelle."
        : store.situation === "plateau"
          ? "Situation : CA QUI STAGNE. Cherche le plafond : offre, panier moyen, acquisition, rétention."
          : store.situation === "not_profitable"
            ? "Situation : DU CA MAIS PAS RENTABLE. Priorise marge, coût d'acquisition, ROAS minimum rentable."
            : "Situation non précisée.";

  // Les montants déclarés par l'utilisateur sont dans la devise de sa
  // boutique. Le modèle doit la connaître : sans elle il raisonnerait en
  // euros par habitude et chiffrerait ses recommandations dans la mauvaise unité.
  const storeCurrency = normalizeCurrency(store.currency);

  // LE MOTEUR DÉTERMINISTE PASSE AVANT LE MODÈLE. Les constats, les scores par
  // axe et les priorités sont établis ici, par des règles et des seuils. Le
  // modèle les reçoit déjà faits : il rédige, relie et explique — il ne décide
  // plus de ce qui est vrai. C'est ce qui rend deux audits successifs sur les
  // mêmes données comparables, ce qu'un modèle seul ne peut pas promettre.
  const ruleReport = analyseRules({
    observations: allObservations(reports),
    gaps: allGaps(reports),
    currency: storeCurrency,
  });

  // LE CLIENT CIBLE, DÉDUIT — JAMAIS DEMANDÉ. Le marchand qui débute ne sait
  // pas ce qu'est un avatar client, et celui qui croit le savoir décrit celui
  // qu'il aimerait avoir. Sa boutique, elle, dit déjà à qui elle s'adresse :
  // prix, vocabulaire, preuves présentes ou absentes. On le lit plutôt que de
  // le réclamer, et on transmet le portrait avec son degré de certitude.
  const audienceInput = audienceInputFrom(allObservations(reports), productTexts, storeCurrency);
  const audience = deduceAudience(audienceInput);
  const incoherences = audience ? findIncoherences(audience, audienceInput) : [];

  // CE QUE LE VISITEUR COMPREND, lu sur le MÊME document que le scan technique.
  // Deux questions différentes sur une seule page téléchargée : « fonctionne-
  // t-elle ? » et « que dit-elle ? ». La seconde n'a jamais été posée jusqu'ici.
  const experience = homeHtml ? experienceFindings(extractExperience(homeHtml), audience) : [];

  // LES TROIS FENÊTRES SE REJOIGNENT ICI. Les règles voient des fiches sans
  // description, la lecture d'expérience voit une page sans promesse, le
  // croisement avec le client cible voit un prix sans argument : trois constats
  // justes, un seul problème. Les livrer séparément produirait un rapport de
  // consultant — long, exhaustif, et abandonné à la troisième ligne.
  const symptomes: Symptom[] = [
    ...ruleReport.findings.map((f) => ({
      id: f.ruleId,
      title: f.title,
      evidence: f.evidence,
      level: f.level,
      impact: f.impact,
      effort: f.effort,
    })),
    ...experience.map((f) => ({
      id: f.id,
      title: f.observation,
      evidence: f.evidence,
      // La lecture d'expérience n'a que deux niveaux ; ce sont exactement deux
      // valeurs de l'échelle du moteur, sans conversion arbitraire.
      level: f.level as Symptom["level"],
      impact: f.impactScore,
      effort: f.effort,
    })),
    ...incoherences.map((i) => ({
      id: i.id,
      title: i.observation,
      evidence: i.evidence,
      // Une incohérence croise un public DÉDUIT avec une observation : elle ne
      // peut donc pas prétendre au niveau le plus haut.
      level: "fortement_suggere" as Symptom["level"],
      impact: i.impactScore,
      effort: i.effort,
    })),
  ];
  const { causes, isolated } = groupByCause(symptomes);

  const userPrompt = `Voici les infos de la boutique à auditer :

- Nom : ${store.name}
- URL : ${store.url || "(non fournie)"}
- Niche : ${store.niche || "(non précisée)"}
- Devise de la boutique : ${currencyLabel(storeCurrency)}
- Chiffre d'affaires déclaré : ${store.monthly_revenue ? `${store.monthly_revenue} ${currencyLabel(storeCurrency)}/mois` : "(non renseigné)"}
- Budget pub déclaré : ${store.monthly_ad_budget ? `${store.monthly_ad_budget} ${currencyLabel(storeCurrency)}/mois` : "(non renseigné)"}
- Objectif de CA : ${store.revenue_goal ? `${store.revenue_goal} ${currencyLabel(storeCurrency)}/mois` : store.goal || "(non précisé)"}
- Coût produit moyen : ${store.avg_product_cost_ratio ? `${Math.round(store.avg_product_cost_ratio * 100)} % du prix de vente` : "(non renseigné)"}
- Charges fixes : ${store.fixed_costs_monthly ? `${store.fixed_costs_monthly} ${currencyLabel(storeCurrency)}/mois` : "(non renseignées)"}

${levelHint}
${situationHint}

DONNÉES RÉELLES DISPONIBLES :
${dataBlock}

${observationsToPromptBlock(reports)}

${diagnosticsToPromptBlock(availability, allGaps(reports))}

${rulesToPromptBlock(ruleReport)}

${audienceToPromptBlock(audience, incoherences)}

${experienceToPromptBlock(experience, Boolean(homeHtml))}

${causesToPromptBlock(causes, isolated)}

${funnelToPromptBlock(funnel)}

${crossSignalsToPromptBlock(crossed)}

${historyToPromptBlock(history)}

Rédige comme un consultant e-commerce senior qui vient de lire ces constats. Ton rôle : expliquer au marchand ce que chaque constat signifie pour SON activité, montrer ce qui relie les constats entre eux, et donner l'ordre dans lequel s'y prendre. Reprends les constats du moteur — tu n'en ajoutes aucun, tu n'en retires aucun, tu n'en modifies ni le niveau de preuve ni le chiffrage.

Réponds STRICTEMENT en JSON valide selon la structure demandée.`;

  const tool = {
    type: "function" as const,
    function: {
      name: "submit_audit",
      description: "Soumet le résultat de l'audit e-commerce",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          score: { type: "integer", description: "Score global 0-100" },
          verdict: { type: "string" },
          summary: { type: "string" },
          findings: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                key: {
                  type: "string",
                  description: "Identifiant court en minuscules avec tirets, unique dans cet audit",
                },
                caused_by: {
                  type: "array",
                  description: "Clés des problèmes qui causent celui-ci. Vide si aucun.",
                  items: { type: "string" },
                },
                category: {
                  type: "string",
                  enum: [
                    "offre",
                    "produit",
                    "boutique",
                    "conversion",
                    "acquisition",
                    "retention",
                    "rentabilite",
                    "operations",
                  ],
                },
                severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                title: { type: "string" },
                root_cause: { type: "string" },
                impact_description: { type: "string" },
                estimated_gain_min: { type: "number" },
                estimated_gain_max: { type: "number" },
                action_steps: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: { text: { type: "string" } },
                    required: ["text"],
                  },
                },
                auto_correction: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    title: { type: "string" },
                    content: { type: "string" },
                  },
                  required: ["title", "content"],
                },
                timeframe: { type: "string", enum: ["today", "this_week", "this_month"] },
                difficulty: { type: "integer", description: "1 très facile à 5 expert" },
                time_minutes: { type: "integer", description: "Temps estimé en minutes" },
                confidence: { type: "string", enum: ["low", "medium", "high"] },
                evidence: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    based_on: { type: "string" },
                    assumptions: { type: "string" },
                  },
                  required: ["based_on", "assumptions"],
                },
              },
              required: [
                "key",
                "caused_by",
                "category",
                "severity",
                "title",
                "root_cause",
                "impact_description",
                "estimated_gain_min",
                "estimated_gain_max",
                "action_steps",
                "timeframe",
                "difficulty",
                "time_minutes",
                "confidence",
                "evidence",
              ],
            },
          },
        },
        required: ["score", "verdict", "summary", "findings"],
      },
    },
  };

  const res = await aiChatCompletion({
    model: aiModel("audit"),
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    tools: [tool],
    tool_choice: { type: "function", function: { name: "submit_audit" } },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI Gateway ${res.status}: ${errText}`);
  }

  const json = await res.json();
  const message = json.choices?.[0]?.message;
  const rawArgs: string | undefined =
    message?.tool_calls?.[0]?.function?.arguments ??
    // Certains modèles répondent en texte brut malgré tool_choice : on récupère le JSON.
    extractJsonBlock(
      typeof message?.content === "string"
        ? message.content
        : Array.isArray(message?.content)
          ? message.content.map((p: { text?: string }) => p?.text ?? "").join("")
          : "",
    );
  if (!rawArgs) {
    throw new Error(
      `Réponse IA invalide (${json.choices?.[0]?.finish_reason ?? "sans contenu"}). Relance l'audit.`,
    );
  }
  // Le modèle renvoie du texte libre validé par un schéma que RIEN ne garantit
  // à l'exécution : `category`, `severity` et `timeframe` sont des énumérations
  // PostgreSQL, et une seule valeur inattendue faisait échouer l'insertion
  // ENTIÈRE — un audit déjà payé, dont les neuf problèmes valides étaient
  // perdus avec le dixième. Tout passe donc par un nettoyage qui répare ce qui
  // l'est, écarte ce qui ne l'est pas, et n'invente jamais rien.
  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(rawArgs);
  } catch {
    throw new Error("Réponse IA illisible (JSON invalide). Relance l'audit.");
  }
  const parsed = sanitizeAuditPayload(rawPayload);
  if (parsed.repairs.length > 0) {
    console.info(`[audit] ${parsed.repairs.length} correction(s) de forme :`, parsed.repairs);
  }

  // BARRIÈRE MÉCANIQUE. Le prompt DEMANDE au modèle de ne pas reproposer ce qui
  // a échoué ; ce filtre l'EMPÊCHE. Une consigne de prompt est une préférence,
  // pas une garantie : un modèle qui reformule légèrement passerait au travers.
  // La mémoire tranche donc après coup, sur la clé du problème.
  const reviewed = applyHistory(
    // Les corrections proposées par l'audit ne passent pas par un outil : c'est
    // le marchand, ou une action confirmée plus tard, qui les exécute. Le
    // rapprochement se fait donc sur la clé et le domaine.
    parsed.findings.map((f) => ({ ...f, tool: null as string | null })),
    history,
  );
  const guidanceByIndex = new Map(
    reviewed.kept.map((entry, index) => [index, entry.guidance] as const),
  );
  if (reviewed.dropped.length > 0) {
    console.info(
      `[audit] ${reviewed.dropped.length} piste(s) écartée(s) par la mémoire de la boutique.`,
    );
  }
  parsed.findings = reviewed.kept.map((entry) => entry.finding);

  // ANCRAGE SUR LA MESURE. L'entonnoir a chiffré la fuite à partir des données
  // réelles de la boutique. Sans cette étape, le classement reposerait sur le
  // montant DEVINÉ par le modèle : un problème réel à 7 000 EUR passerait
  // derrière une piste à laquelle il aurait spontanément attribué 12 000 EUR.
  // La mesure fait foi contre l'estimation, sur le domaine où elle porte.
  const anchoring = anchorGainsOnLeak(parsed.findings, funnel.worst);
  parsed.findings = anchoring.findings;
  if (anchoring.anchored > 0) {
    console.info(
      `[audit] ${anchoring.anchored} problème(s) ancré(s) sur la fuite mesurée (${funnel.worst?.costPerMonth}).`,
    );
  }

  // LA FRONTIÈRE TECHNIQUE, posée juste après l'ancrage et pour cause : c'est
  // l'ancrage lui-même qui vient d'attribuer le coût de la fuite mesurée à tout
  // ce qui tombe dans le bon domaine — y compris à une lenteur de serveur dont
  // rien n'établit qu'elle y soit pour quelque chose. Le montant est vrai, son
  // attribution ne l'est pas. Un constat technique repart donc sans montant, et
  // sans pouvoir se déclarer critique.
  const frontier = applyTechnicalFrontier(parsed.findings);
  parsed.findings = frontier.findings;
  if (frontier.stripped > 0) {
    console.info(
      `[audit] ${frontier.stripped} constat(s) technique(s) privé(s) de montant : aucun lien mesuré avec les ventes.`,
    );
  }

  // Scoring et priorisation déterministes côté serveur (jamais devinés par l'IA)
  const categoryScores = computeCategoryScores(parsed.findings);
  const globalScore = computeGlobalScore(categoryScores);
  const potential = computePotential(parsed.findings);

  // Le modèle a proposé des liens de cause à effet ; c'est ici qu'ils deviennent
  // un ordre d'exécution. `analyseFindings` écarte ce qui ne tient pas debout
  // (renvois vers un problème inexistant, causalité circulaire), classe chaque
  // conclusion selon ce qui la soutient, et interdit à une conclusion sans
  // preuve d'être annoncée comme critique. Le tableau revient trié : les causes
  // avant leurs symptômes, le plus rentable d'abord à contrainte satisfaite.
  const analysis = analyseFindings(parsed.findings);

  await supabase
    .from("audits")
    .update({
      status: "completed",
      score: globalScore,
      category_scores: categoryScores,
      potential_gain_min: potential.min,
      potential_gain_max: potential.max,
      verdict: parsed.verdict,
      summary: parsed.summary,
      // Conservés tels qu'ils étaient au moment de conclure. Les recalculer à
      // l'affichage produirait un écran qui contredit son propre texte.
      funnel,
      cross_signals: crossed,
      data_gaps: allGaps(reports),
      // CONSERVÉS POUR LA COMPARAISON. Sans eux, deux audits ne se comparent
      // que par leur score global — le seul chiffre qui n'apprend rien au
      // marchand. `measured` est la valeur décisive : sans elle, un axe perdu
      // de vue entre deux passages se lirait comme une dégradation.
      root_causes: causes.map((c) => ({
        id: c.id,
        title: c.title,
        level: c.level,
        priority: c.priority,
      })),
      axis_scores: ruleReport.axes.map((a) => ({
        axis: a.axis,
        score: a.score,
        measured: a.measured,
      })),
      completed_at: new Date().toISOString(),
    })
    .eq("id", auditId);

  if (analysis.findings.length > 0) {
    const rows = analysis.findings.map((a) => {
      const f = parsed.findings[a.index];
      return {
        audit_id: auditId,
        category: f.category,
        severity: f.severity,
        title: f.title,
        root_cause: f.root_cause,
        impact_description: f.impact_description,
        estimated_gain_min: f.estimated_gain_min,
        estimated_gain_max: f.estimated_gain_max,
        action_steps: f.action_steps,
        auto_correction: f.auto_correction ?? null,
        timeframe: f.timeframe,
        difficulty: Math.min(5, Math.max(1, f.difficulty ?? 2)),
        time_minutes: f.time_minutes ?? 30,
        confidence: f.confidence === "high" || f.confidence === "low" ? f.confidence : "medium",
        evidence: f.evidence ?? {},
        priority_score: a.priority,
        sort_order: a.order,
        finding_key: a.key,
        caused_by: a.causes,
        priority_band: a.band,
        priority_reason: a.justification,
        epistemic_level: a.epistemic,
        blocks_count: a.blocks,
        chain_depth: a.chain_depth,
        // Ce que la mémoire de la boutique dit de cette piste. Figé ici, et
        // non recalculé à l'affichage : la mémoire évolue — une correction
        // mesurée « en cours » devient « nul » huit jours plus tard — et un
        // rapport doit pouvoir expliquer la décision telle qu'elle a été prise
        // le jour où il a été produit.
        history_action: guidanceByIndex.get(a.index)?.action ?? "proposer",
        history_note: guidanceByIndex.get(a.index)?.reason ?? null,
      };
    });
    const { error: fErr } = await supabase.from("audit_findings").insert(rows);
    if (fErr) throw fErr;
  }
}
