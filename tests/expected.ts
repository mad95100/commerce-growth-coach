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
    minChecks: 50,
    covers:
      "Cohérence du déploiement Cloudflare : entrée du worker, nodejs_compat, actifs statiques, cron, absence de secret versionné, et concordance entre wrangler.toml, vite.config.ts et .env.example.",
  },
  {
    file: "actions/state-compare.test.ts",
    minChecks: 29,
    covers:
      "Comparaison d'état indépendante de l'ordre des clés : `jsonb` ne le préserve pas, et une comparaison naïve refusait des corrections légitimes.",
  },
];

/** Total minimal, tous domaines confondus. */
export const MIN_TOTAL_CHECKS = EXPECTED_SUITES.reduce((sum, s) => sum + s.minChecks, 0);
