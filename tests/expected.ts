/**
 * Inventaire attendu des suites.
 *
 * POURQUOI CE FICHIER EXISTE. Un test supprimé ne fait échouer personne : la
 * suite passe, en vert, avec moins de garanties. Un test neutralisé non plus.
 * C'est le mode de défaillance le plus courant d'une base de tests, et le plus
 * silencieux.
 *
 * Le lanceur confronte ce que les suites ont réellement exécuté à ce tableau.
 * Une suite absente, ou qui exécute moins de contrôles qu'annoncé, fait échouer
 * la CI — même si tout ce qui reste passe.
 *
 * Les seuils sont des PLANCHERS, jamais des égalités : ajouter des contrôles ne
 * doit rien casser. Les abaisser demande de modifier ce fichier, ce qui est
 * visible en revue — c'est tout l'intérêt.
 */

export type ExpectedSuite = {
  /** Chemin du fichier, relatif à `tests/`. */
  file: string;
  /** Nombre minimal de contrôles que la suite doit exécuter. */
  minChecks: number;
  /** Ce que ce domaine protège, en une phrase. */
  covers: string;
};

export const EXPECTED_SUITES: ExpectedSuite[] = [
  {
    file: "shopify/hmac.test.ts",
    minChecks: 29,
    covers:
      "Authenticité des retours OAuth Shopify : signature valide acceptée sous les deux canonicalisations, toute altération refusée.",
  },
  {
    file: "shopify/scopes.test.ts",
    minChecks: 13,
    covers:
      "Permissions Shopify réellement accordées, et stabilité du paramètre `scope` envoyé — le changer imposerait une réinstallation aux marchands connectés.",
  },
  {
    file: "shopify/shop-domain.test.ts",
    minChecks: 10,
    covers: "Normalisation du domaine de boutique, y compris l'adresse d'admin moderne.",
  },
  {
    file: "shopify/oauth-origin.test.ts",
    minChecks: 20,
    covers:
      "Stabilité du `redirect_uri` OAuth : une origine variable produisait « redirect_uri is not whitelisted ».",
  },
  {
    file: "security/rls.test.ts",
    minChecks: 56,
    covers:
      "Droits PostgREST : jetons partenaires jamais servis au navigateur, journaux non réécrivables, et vérification d'appartenance partout où le rôle de service contourne RLS.",
  },
  {
    file: "billing/plans.test.ts",
    minChecks: 55,
    covers:
      "Quotas : décompte sûr sous concurrence, période mensuelle, et abonnement impayé qui ne donne pas le plan payant.",
  },
  {
    file: "currency/currency.test.ts",
    minChecks: 68,
    covers:
      "Devises ISO 4217 sans liste codée en dur, et refus de tout calcul entre devises différentes.",
  },
  {
    file: "audits/jobs.test.ts",
    minChecks: 69,
    covers:
      "Audit asynchrone : réclamation atomique contre la double exécution, reprise par bail expirant, tentatives bornées.",
  },
  {
    file: "actions/guards.test.ts",
    minChecks: 48,
    covers:
      "Garde-fous sur les écritures automatiques : plafonds de budget, planchers, et preuves exigées avant une mise en pause.",
  },
  {
    file: "actions/dispatch.test.ts",
    minChecks: 34,
    covers:
      "Aiguillage complet validation → cible → garde-fou → état avant/après, sur Meta et Google Ads.",
  },
  {
    file: "audits/jobs-tick.test.ts",
    minChecks: 30,
    covers:
      "Déclencheur périodique : sélection des audits à reprendre sans navigateur, plafond par passage, et refus de relancer un audit déjà en cours ou condamné.",
  },
  {
    file: "audits/finding-graph.test.ts",
    minChecks: 115,
    covers:
      "Chaîne causale, quatre niveaux de certitude et priorité justifiée : une conclusion sans preuve ne peut pas être déclarée critique, un symptôme n'est jamais proposé avant sa cause, et une causalité circulaire ne fait pas boucler le cron.",
  },
  {
    file: "audits/next-move.test.ts",
    minChecks: 100,
    covers:
      "Le prochain geste : rien n'est proposé tant que ce qui le cause n'est pas corrigé, une correction qui a fait reculer la boutique passe avant tout gain potentiel, un constat technique dont le coût n'est pas mesuré ne passe jamais devant une perte chiffrée (mais reprend la tête quand rien n'est chiffrable), ce qui est prouvé est gardé, et une chaîne causale corrompue depuis le navigateur ne vide jamais l'écran de pilotage.",
  },
  {
    file: "audits/measure.test.ts",
    minChecks: 94,
    covers:
      "Verdict d'une correction : dilution de la fenêtre glissante compensée, métriques choisies selon ce qui a été corrigé, garde-fous qui empêchent de prendre un ROAS gonflé par la coupe du volume pour un succès, et annulation recommandée seulement quand elle est justifiée.",
  },
  {
    file: "audits/measure-tick.test.ts",
    minChecks: 30,
    covers:
      "Re-mesure automatique : cadence qui ne brûle pas le quota partenaire, arrêt dès qu'un verdict est définitif, équité entre boutiques, et dates corrompues depuis le navigateur qui ne déclenchent pas de mesures en boucle.",
  },
  {
    file: "audits/attempt-history.test.ts",
    minChecks: 80,
    covers:
      "Mémoire des corrections à travers les audits : une correction sans effet n'est jamais reproposée, une réussite devient un acquis, une régression remonte en tête, un résultat non tranché produit « il manque des données » et non une conclusion, et le filtre ne rend jamais un rapport vide.",
  },
  {
    file: "audits/reaudit.test.ts",
    minChecks: 57,
    covers:
      "Relance du diagnostic : jamais deux audits concurrents, jamais de relance sans verdict nouveau, jamais de quota compté dépensé sans l'accord du marchand, et jamais de boucle payante sur une boutique dont les diagnostics échouent — la cadence se règle sur la dernière tentative, pas sur le dernier succès.",
  },
  {
    file: "audits/robustness.test.ts",
    minChecks: 78,
    covers:
      "Robustesse en conditions réelles : une réponse de modèle mal formée n'emporte plus l'audit entier, la première vente d'une boutique partie de zéro est enfin mesurable, et onze boutiques types — sans ventes, sans publicité, internationale, contradictoire — obtiennent un verdict honnête ou aucun verdict, jamais une conclusion inventée.",
  },
  {
    file: "audits/observations.test.ts",
    minChecks: 100,
    covers:
      "Couche commune source → observation → diagnostic : ce qui n'est pas observé ne produit aucune valeur (jamais un zéro qui passerait pour une mesure), chaque observation porte sa preuve et sa taille d'échantillon, et ce que les données ne permettent pas d'établir part dans le prompt comme une interdiction nommée.",
  },
  {
    file: "audits/meta-cross.test.ts",
    minChecks: 85,
    covers:
      "Meta Ads sur la couche commune, et le raisonnement croisé : commandes Shopify rapportées aux clics Meta — la seule mesure qui départage une publicité inefficace d'une boutique qui ne transforme pas, qu'aucune source ne calcule seule. Un CTR bas reste un fait dont la cause est une hypothèse, un ROAS sans volume ne fait pas une bonne campagne, et deux devises différentes interdisent tout rapprochement chiffré.",
  },
  {
    file: "audits/funnel.test.ts",
    minChecks: 60,
    covers:
      "Entonnoir et localisation de la fuite : à quelle marche le volume disparaît et ce que cela coûte par mois. Aucune marche n'est interpolée — une marche non mesurée est un trou nommé et la fuite n'est jamais cherchée au travers, ce qui empêche d'imputer un problème de checkout à la publicité.",
  },
  {
    file: "audits/briefing.test.ts",
    minChecks: 78,
    covers:
      "Le briefing du directeur : neuf réponses assemblées depuis le moteur, jamais écrites en dur. Un montant non chiffrable ne devient pas zéro, une étape non mesurée ne devient pas une barre vide, et « Corriger maintenant » n'apparaît que là où une correction existe — le bouton ouvre un aperçu, il n'exécute rien.",
  },
  {
    file: "audits/google-attribution.test.ts",
    minChecks: 75,
    covers:
      "Google Ads dans le chemin de diagnostic, et l'attribution entre canaux : Meta faible avec Google fort ne condamne pas l'acquisition entière, deux canaux faibles désignent ce qu'ils partagent plutôt que les régies, un seul canal mesuré fait baisser la certitude, et le trafic payant est la somme des canaux — sur Meta seul la fuite après clic serait manquée.",
  },
  {
    file: "audits/read-only.test.ts",
    minChecks: 86,
    covers:
      "Garantie mécanique que le diagnostic ne modifie rien chez le marchand : le graphe d'imports réel depuis l'audit et depuis le cron est parcouru, et aucune des quatorze fonctions d'écriture partenaire n'y est atteignable. Vérifie aussi qu'aucun raccourci de test ne subsiste dans le chemin réel.",
  },
  {
    file: "infra/no-lovable.test.ts",
    minChecks: 25,
    covers:
      "Indépendance vis-à-vis de Lovable : aucune URL, aucun SDK, aucun paquet ni aucune résolution de registre privé à l'exécution, replis transitoires nommés et neutralisés par la configuration.",
  },
  {
    file: "infra/migrations.test.ts",
    minChecks: 12,
    covers:
      "Historique des migrations : versions uniques et ordonnées, durcissement RLS rejouable sans dommage, et déploiement qui annonce ce qu'il applique. Un décalage d'une seconde avait fait rejouer la migration initiale.",
  },
  {
    file: "infra/deploy-config.test.ts",
    minChecks: 58,
    covers:
      "Cohérence du déploiement Cloudflare : entrée du worker, nodejs_compat, actifs statiques, cron, absence de secret versionné, et concordance entre wrangler.toml, vite.config.ts et .env.example.",
  },
  {
    file: "actions/state-compare.test.ts",
    minChecks: 29,
    covers:
      "Comparaison d'état indépendante de l'ordre des clés : `jsonb` ne le préserve pas, et une comparaison naïve refusait des corrections légitimes.",
  },
  {
    file: "audits/storefront.test.ts",
    minChecks: 195,
    covers:
      "Le site public tel que le visiteur le reçoit — l'angle mort du moteur, qui diagnostiquait la conversion sans avoir jamais ouvert la page. Un problème technique y reste un FAIT technique : il ne devient une explication de perte que croisé avec Shopify, Meta ou Google, preuve nommée des deux côtés, et un site lent sur une boutique qui convertit bien produit un signal qui interdit d'y voir une cause. Core Web Vitals, rendu mobile et tunnel de commande sont déclarés hors de portée plutôt qu'approchés.",
  },
  {
    file: "audits/organic-attribution.test.ts",
    minChecks: 70,
    covers:
      "Origine réelle des commandes, lue sur les commandes elles-mêmes sans permission nouvelle : le seul contrepoids indépendant au ROAS déclaré par les régies. Un clic payant depuis Google n'est jamais compté en recherche naturelle, les ventes en caisse sortent du calcul, et rien n'est publié tant que la majorité des commandes est sans trace — une absence de référent n'est pas du trafic direct.",
  },
  {
    file: "audits/measure-path.test.ts",
    minChecks: 58,
    covers:
      "Chemin de la mesure et du verdict : file équitable même quand une boutique échoue à répétition, verdicts définitifs jamais recalculés sur une fenêtre qui ne recouvre plus la correction, outil attribué à partir des seules écritures abouties, et aucun verdict affiché sans sa période ni sa couverture.",
  },
  {
    file: "actions/execution.test.ts",
    minChecks: 60,
    covers:
      "Chemin « corriger maintenant » : une écriture interrompue n'est jamais annoncée comme faite, deux propositions sur un même problème n'écrivent pas deux fois, une correction non appliquée est remboursée, et la réversibilité promise est réellement tenue.",
  },
];

/** Total minimal, tous domaines confondus. */
export const MIN_TOTAL_CHECKS = EXPECTED_SUITES.reduce((sum, s) => sum + s.minChecks, 0);
