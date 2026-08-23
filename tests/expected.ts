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
    minChecks: 50,
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
    minChecks: 91,
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
    minChecks: 121,
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
    minChecks: 115,
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
    minChecks: 79,
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
    file: "ui/messages-au-marchand.test.ts",
    minChecks: 82,
    covers:
      "Aucun message atteignant le marchand ne le renvoie à un secret de serveur : les pages d'erreur OAuth lui demandaient de vérifier SHOPIFY_CLIENT_SECRET, et le bouton de connexion Meta d'ajouter META_CLIENT_ID « dans les secrets » — une action impossible, au moment où il vient de confier l'accès à sa boutique. Le nom est déplacé au journal, pas supprimé.",
  },
  {
    file: "billing/affichage-quota.test.ts",
    minChecks: 19,
    covers:
      "Le compteur affiché dit le vrai plan : la carte lisait `used + remaining`, or le solde ne descend jamais sous zéro — au dépassement, la somme affichait la consommation du marchand comme son allocation, en contradiction avec le message de refus. Et une lecture ratée s'effaçait au lieu de se dire.",
  },
  {
    file: "infra/schema-coherence.test.ts",
    minChecks: 180,
    covers:
      "Concordance entre `types.ts` et le SQL : chaque colonne que le code croit pouvoir écrire a bien une migration qui la crée. Le déploiement ne compare que des noms de migrations ; un type engendré depuis une base de développement entrait sans son SQL, et l'écriture n'échouait qu'en production, sur l'audit déjà payé.",
  },
  {
    file: "infra/deploy-config.test.ts",
    minChecks: 85,
    covers:
      "Cohérence du déploiement Cloudflare : entrée du worker, nodejs_compat, actifs statiques, cron, absence de secret versionné, et concordance entre wrangler.toml, vite.config.ts et .env.example. Vérifie aussi que « déployé » ne se confond plus avec « fonctionne » — un worker publié sans clé de service fait échouer le déploiement au lieu d'afficher un vert trompeur, le contrôle de démarrage se rabat sur l'adresse que wrangler vient de publier plutôt que d'être sauté en silence, le parcours de connexion Shopify est sondé en lecture seule pour prouver que les identifiants arrivent jusqu'au code, et une origine OAuth injoignable est signalée — sinon le worker répond, le déploiement est vert, et pourtant aucune boutique ne peut se connecter.",
  },
  {
    file: "actions/state-compare.test.ts",
    minChecks: 29,
    covers:
      "Comparaison d'état indépendante de l'ordre des clés : `jsonb` ne le préserve pas, et une comparaison naïve refusait des corrections légitimes.",
  },
  {
    file: "audits/storefront.test.ts",
    minChecks: 205,
    covers:
      "Le site public tel que le visiteur le reçoit — l'angle mort du moteur, qui diagnostiquait la conversion sans avoir jamais ouvert la page. Un problème technique y reste un FAIT technique : il ne devient une explication de perte que croisé avec Shopify, Meta ou Google, preuve nommée des deux côtés, et un site lent sur une boutique qui convertit bien produit un signal qui interdit d'y voir une cause. Core Web Vitals, rendu mobile et tunnel de commande sont déclarés hors de portée plutôt qu'approchés.",
  },
  {
    file: "audits/organic-attribution.test.ts",
    minChecks: 71,
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
    file: "security/comparison-access.test.ts",
    minChecks: 30,
    covers:
      "La comparaison d'audits ne devient pas une fuite. Trois identifiants viennent du navigateur — une boutique, deux audits — et c'est la forme d'appel qui fuit : il est tentant de ne vérifier que « ces audits existent-ils ». L'appartenance de la boutique est donc vérifiée AVANT toute lecture d'audit, et les audits sont bornés à cette boutique. Le rôle de service contournant RLS, cette vérification ne peut pas être déléguée à la base. Vérifie aussi que la chaîne est entière de bout en bout : le moteur écrit les colonnes que la comparaison relit, la migration les crée, l'écran est monté, et le score ne s'affiche jamais quand le moteur a refusé de le calculer.",
  },
  {
    file: "audits/comparison.test.ts",
    minChecks: 85,
    covers:
      "Deux audits comparés, et le piège que personne n'évite : comparer deux scores suppose qu'ils mesurent la même chose. Entre deux passages une source se déconnecte, une permission expire — le score chute de vingt points sans qu'aucune boutique n'ait bougé. Un point non mesuré des DEUX côtés n'est donc jamais comparé, et le score global se tait sous le seuil de couverture plutôt que d'annoncer une dégradation imaginaire. Les causes racines se comparent au même titre que les chiffres et passent devant : une cause disparue correspond à un travail que le marchand se rappelle avoir fait, sept points de score ne correspondent à rien. Aucune félicitation quand rien n'a bougé, et aucun mot du moteur dans le récit.",
  },
  {
    file: "audits/root-cause.test.ts",
    minChecks: 700,
    covers:
      "Une cause, une action — et le produit qui parle au marchand. Les règles voient des fiches sans description, l'expérience voit une page sans promesse, le client cible voit un prix sans argument : trois constats justes, un seul problème. Les livrer séparément produit un rapport qu'on abandonne à la troisième ligne. Une cause ne se forme jamais sur un symptôme isolé, ses preuves sont exactement l'union de celles de ses symptômes, son niveau de certitude est celui du MOINS certain d'entre eux — sinon un « à vérifier » sortirait promu par le simple fait d'être accompagné — et aucun symptôme n'est rattaché deux fois. Couvre aussi la traduction en langage marchand : quatorze mots du moteur sont interdits un par un dans chaque explication, et une donnée absente dit toujours ce qui manque, pourquoi, quoi faire et ce que cela ouvrira. La couverture n'est plus recopiée à la main mais RELEVÉE dans le code des sources — une liste écrite vieillit dès qu'une source ajoute un trou, et l'oubli se lit alors sur l'écran d'un marchand sous la forme « Non exposé par l'API Admin ».",
  },
  {
    file: "audits/storefront-experience.test.ts",
    minChecks: 110,
    covers:
      "Ce que le visiteur comprend du site, et la limite que ce module ne franchit pas : le HTML ne dit pas ce qui est VU — ni taille de texte, ni couleur après cascade, ni ce qui tombe au-dessus de la ligne de flottaison. Ce qui relève de la perception plafonne à « à vérifier », aucun jugement esthétique n'est produit, et six mots de perception visuelle sont interdits un par un. Le public déduit change la GRAVITÉ d'un constat, jamais le fait : l'absence de réassurance pèse plus lourd sur un acheteur qui compare que sur un achat d'impulsion. Éprouvé sur quatre pages réalistes — saine, thème jamais rempli, surchargée, cassée. Couvre aussi la rétention : sans commandes, rien n'est fabriqué, l'axe est déclaré non évaluable et le moteur dit à partir de quel volume il se prononcera.",
  },
  {
    file: "audits/audience.test.ts",
    minChecks: 90,
    covers:
      "Le client cible, DÉDUIT de la boutique et jamais demandé au marchand — celui qui débute ne sait pas ce qu'est un avatar, celui qui croit le savoir décrit celui qu'il aimerait avoir. Sans signal, aucun portrait : il n'existe pas de client par défaut. La confiance est calculée depuis le nombre de signaux et plafonnée tant qu'aucune vente ne la corrobore, parce qu'une vitrine dit ce qu'on veut vendre et les commandes ce qu'on vous achète. Aucun trait démographique n'est inventé — ni âge, ni sexe, ni catégorie — et une donnée inconnue ne produit jamais d'incohérence. Le même fait n'a pas la même gravité selon le public : l'absence d'avis alerte sur du premium, pas sur de l'entrée de gamme.",
  },
  {
    file: "ui/audit-errors.test.ts",
    minChecks: 170,
    covers:
      "Ce que le marchand lit quand son audit échoue. Le message technique s'affichait tel quel — « AI Gateway 404: models/gemini-2.5-pro is no longer available. Please update your code » — et le marchand y lisait qu'on lui demandait de programmer, pour une panne venant de NOTRE configuration. Neuf familles sont traduites, chacune répondant aux deux seules questions qui comptent : est-ce que cela vient de moi ou d'eux, et qu'est-ce que je fais maintenant. Aucun code d'erreur ni mot anglais ne passe, le bouton proposé dépend de la panne — « Relancer » sur un jeton expiré enverrait échouer une seconde fois — et le message technique reste en base pour qui peut agir dessus.",
  },
  {
    file: "ui/multi-store.test.ts",
    minChecks: 29,
    covers:
      "Plusieurs boutiques sur un même compte. Le cockpit affichait TOUJOURS la première, sans dire laquelle : un marchand qui en gère deux lisait des chiffres sans savoir à quoi ils se rapportaient, et n'avait aucun moyen d'en changer. Le choix vit désormais dans l'adresse — un état local se perdrait au rechargement — et un identifiant de signet périmé retombe sur une boutique réelle. Couvre aussi la suppression, qui n'existait pas : une boutique ajoutée par erreur restait indéfiniment, comptée dans les quotas et reprise par le cron. Elle emporte onze tables en cascade, d'où le nom à retaper — qui protège du clic distrait, pas d'un attaquant.",
  },
  {
    file: "ui/auth.test.ts",
    minChecks: 55,
    covers:
      "Le premier écran, celui qu'on ne voit qu'une fois. L'inscription annonçait « Compte créé ! » puis envoyait sur une page protégée — y compris quand Supabase exige une confirmation par e-mail et ne rend aucune session : la page renvoyait vers la connexion, qui refusait le compte tout juste créé, et l'utilisateur bouclait avec un message de succès en mémoire. La session est désormais LUE avant toute navigation. Vérifie aussi que les erreurs anglaises de Supabase sont traduites avec le geste suivant, qu'un mot de passe faux ne révèle jamais si le compte existe, que la récupération de mot de passe existe — sans elle un utilisateur était enfermé dehors définitivement — et que le mot de passe peut être vérifié à l'œil.",
  },
  {
    file: "ui/states.test.ts",
    minChecks: 24,
    covers:
      "Ce que l'écran dit quand la lecture échoue. Le tableau de bord confondait « il n'y a rien » et « je n'ai pas réussi à lire » : sur échec de requête il annonçait « Aucune boutique » et proposait d'en recréer une — un marchand voyait sa boutique disparaître. L'échec est désormais testé avant le vide, porte son propre message et son propre geste, et la redirection automatique vers la création n'a lieu que sur un succès.",
  },
  {
    file: "audits/catalogue-vide-bout-en-bout.test.ts",
    minChecks: 73,
    covers:
      "product_count = 0, de la mesure au texte final. Le rapport réel affichait « Votre boutique ne propose aucun produit à la vente » en constat [1] et, deux constats plus bas, « Ce que nous supposons : Le catalogue contient des produits actifs et publiés dans l'administration Shopify, mais aucun lien n'a été créé pour les afficher sur la page d'accueil ». Deux phrases contradictoires dans le même rapport, dont la seconde inventait une cause alternative là où la vraie était établie et envoyait le marchand créer des liens vers des produits inexistants. Aucun test unitaire ne pouvait le voir : le défaut ne vivait DANS aucune couche, il vivait entre elles — le prompt demandait, `sanitizeAuditPayload` recopiait, et rien ne confrontait jamais le texte rendu aux chiffres comptés. Cette suite part des données brutes de Shopify, traverse observations, règles, priorisation, bloc envoyé au modèle, puis injecte la réponse de production mot pour mot et vérifie que la contradiction est retirée et remplacée par ce qui a été compté. Elle vérifie aussi les deux moitiés qu'on perd en corrigeant trop fort : une phrase qui NIE l'existence est conservée, et sans mesure du catalogue la même hypothèse redevient légitime.",
  },
  {
    file: "audits/boutiques-temoins.test.ts",
    minChecks: 157,
    covers:
      "Le moteur jugé sur son verdict, pas sur ses pièces. Chaque module a ses contrôles et ils passent tous — ce n'est pas la même chose que dire que le moteur a raison. Les défauts les plus graves de ce projet ne sont jamais nés DANS un module mais entre deux : « Conversion 100/100 » sur une boutique sans un seul visiteur (la règle ne s'était pas déclenchée, le calcul de score n'avait donc rien à déduire, et les deux ensemble affirmaient une excellence sur un sujet inconnu), « 9999 % » parce qu'un module rendait un ratio là où un autre attendait un pourcentage. Quatre boutiques telles qu'on en rencontre — sans trafic, premium sans réassurance, du trafic et pas de ventes, aucune source qui répond — traversent la chaîne entière et le verdict est jugé : jamais d'axe noté sans donnée, jamais de constat sans preuve, jamais de pourcentage hors bornes, jamais un mot du moteur dans une phrase lue par le marchand, et jamais une cause plus sûre que son symptôme le moins sûr.",
  },
  {
    file: "connectors/ad-accounts.test.ts",
    minChecks: 28,
    covers:
      "Sur quel compte publicitaire porte le diagnostic. Le retour d'autorisation Meta retenait `accounts[0]` et l'utilisait pour tout le diagnostic, sans le dire et sans qu'aucun écran ne permette d'en changer — alors que la fonction serveur qui le permet existait, écrite et jamais appelée. Un marchand qui gère deux marques, ou dont l'agence figure en tête de liste, lisait un rapport cohérent, chiffré et faux de bout en bout. Le choix par défaut est désormais annoncé comme un défaut, le compte se change, un compte désactivé n'est plus retenu d'office, et une différence de devise entre le compte et la boutique interdit de rapprocher dépense et chiffre d'affaires plutôt que de produire un coût par commande qui n'existe pas.",
  },
  {
    file: "security/oauth-state.test.ts",
    minChecks: 18,
    covers:
      "L'état OAuth, seule chose qui empêche d'attacher un compte publicitaire à la boutique d'autrui. Le retour d'autorisation est une route PUBLIQUE, appelée sans session à nous : le paramètre `state` lui dit pour quelle boutique elle travaille, et sa signature est tout ce qui empêche de le fabriquer. Sans elle, un état forgé avec l'identifiant de la boutique d'un autre y rattache le compte de l'attaquant — puis un diagnostic parle de campagnes que le marchand n'a jamais lancées. Le code était déjà correct quand cette suite a été écrite ; il n'était couvert par rien. Une primitive de sécurité juste mais non testée n'est juste que pour l'instant.",
  },
  {
    file: "audits/montee-en-gamme.test.ts",
    minChecks: 34,
    covers:
      "Ce qu'un rapport n'a pas le droit d'affirmer. Le score était calculé sur des catégories jamais instruites — une catégorie sans constat valait 78, qu'elle ait été examinée et trouvée saine ou qu'aucune donnée n'ait permis de la regarder ; une boutique dont aucune source n'avait répondu obtenait donc une note honorable sur du vide. Couvre aussi la devise jamais inventée, les boutons qui ne promettent plus une correction automatique là où aucun outil ne sait écrire, et les manques de collecte enfin montrés sur un audit ABOUTI — avec les quatre questions dans l'ordre où elles se posent, au lieu de s'arrêter à « donnée manquante ».",
  },
  {
    file: "ui/editorial.test.ts",
    minChecks: 336,
    covers:
      "Le produit parle comme un consultant, pas comme une checklist. Les formules qui ne disent rien de la boutique regardée — « il est important de », « pensez à », « optimisez votre boutique » — sont interdites sur tous les écrans : elles ne sont fausses nulle part, ce qui les rend invisibles à un test de vérité, et interchangeables d'une boutique à l'autre, ce qui est exactement la différence entre une checklist et un diagnostic. Couvre aussi les consignes envoyées au modèle, qui ordonnaient le tutoiement et le ton de mentor encourageant alors que tout le reste du produit vouvoie, et la séparation à l'écran des deux axes qu'un lecteur pressé additionne : la priorité et la certitude.",
  },
  {
    file: "audits/echantillon.test.ts",
    minChecks: 110,
    covers:
      "Un catalogue ne se juge pas sur une fiche. Le scan ouvrait UNE page produit et tous les constats produit en découlaient : une boutique dont la fiche mise en avant est soignée passait pour irréprochable, une boutique dont la première fiche est un brouillon oublié était condamnée sur cet exemplaire, et le rapport écrivait « les fiches produit n'ont pas de description » sans que rien ne distingue les deux cas. Couvre l'échantillon déterministe et borné, les observations agrégées et leur dénominateur explicite, les quatre portées — aucune, une fiche, plusieurs, toutes les inspectées —, l'interdiction d'extrapoler au catalogue, et le contrat de classification épistémique : les cinq niveaux, et le fait qu'une réponse ambiguë du modèle retombe sur « Déduit » et jamais sur « Observé », qui est un niveau confiant. Couvre aussi l'échantillon HYBRIDE : deux fiches du parcours visible, le reste réparti à pas régulier sur le catalogue complet lu par l'API Admin, parce qu'un échantillon tiré de la seule vitrine ne montre que ce que la boutique met en avant et surestime sa qualité moyenne par construction — le biais est démontré sur une même boutique. La provenance de l'échantillon entre dans la preuve, et la couverture du catalogue plafonne ce qu'un constat a le droit de prouver.",
  },
  {
    file: "audits/raisonnement.test.ts",
    minChecks: 75,
    covers:
      "Le passage du symptôme au raisonnement. Les causes racines étaient calculées, justes, et ignorées par le classement — le plan pouvait proposer de corriger un effet avant la cause qui le produit. Couvre l'effet de dépendance et ses trois garde-fous (il multiplie la formule, donc il passe par le poids de preuve ; il est plafonné ; une donnée insuffisante ne peut pas en profiter), les diagnostics de convergence qui remplacent leurs constituants au lieu de s'y ajouter, les trois états de disponibilité — disponible, épuisé, illisible — jamais réduits à deux, le prix, les variantes et les métadonnées enfin lus, et la portée des preuves : aucun constat de vitrine ne prétend avoir inspecté le site entier.",
  },
  {
    file: "audits/expertise-vitrine.test.ts",
    minChecks: 68,
    covers:
      "Le moteur parle de CETTE boutique, pas d'une boutique en général. La page de collection était téléchargée à chaque scan puis jetée sans être analysée, le titre d'onglet extrait et jamais rapporté, et la grande majorité des observations de vitrine n'était lue par AUCUNE règle : mesurées, transmises au modèle, et interdites d'emploi par le même prompt. Couvre la lecture de la collection, les règles qui consomment enfin ces observations, le viewport constaté même quand le scan mobile a été écourté, la corroboration qui seule autorise à relier l'absence de mention de livraison à un abandon mesuré, et l'exigence qui les tient toutes : une preuve porte un chiffre, une adresse ou une citation — jamais une phrase vraie de n'importe quel site.",
  },
  {
    file: "audits/fournisseur-ia.test.ts",
    minChecks: 117,
    covers:
      "Le fournisseur d'analyse : quota, secours, et ce qu'on en dit. Un audit réel a échoué sur `429 RESOURCE_EXHAUSTED`, quota `generate_content_free_tier_requests`, limite 20 par JOUR — et le marchand lisait « notre fournisseur était saturé, relancez dans une dizaine de minutes, c'est passager ». Trois affirmations fausses sur quatre : le compteur est journalier, dix minutes n'y changeaient rien, et le fournisseur n'était pas saturé. Cette suite sépare les deux 429, borne le déclenchement du secours aux statuts qu'un autre modèle peut réparer, exige que le secours rejoue le MÊME appel — même prompt, même schéma, même outil forcé, seul le nom du modèle change — et vérifie qu'un échec du fournisseur n'emporte pas les manques de collecte enregistrés avant lui.",
  },
  {
    file: "audits/source-injoignable.test.ts",
    minChecks: 76,
    covers:
      "Ce que le marchand lit quand une source n'a rien donné. Le connecteur savait distinguer une autorisation révoquée d'une panne de fournisseur ; `allGaps`, dernier maillon avant l'écran, écrivait la même phrase fixe pour toutes les causes. Or une seule est réparable par le marchand — et c'est la plus fréquente après un branchement qui a mal tourné. Sous « Source injoignable », il lisait un incident passager, attendait, relançait, et retombait sur le même vide : la forme finale de la boucle signalée. Le connecteur est exécuté ici contre un `fetch` de substitution, statut par statut.",
  },
  {
    file: "security/pages-oauth.test.ts",
    minChecks: 60,
    covers:
      "Les pages HTML rendues au retour d'une autorisation. Deux des trois retours recopiaient le paramètre `error` de l'adresse dans le document sans l'échapper : une adresse fabriquée exécutait du script sur l'origine de l'application, celle où la session Supabase est rangée dans le stockage local — sans compte, sur simple clic. Constaté au navigateur sur Meta et Google avant correction. La cause n'était pas l'oubli d'un échappement mais TROIS COPIES d'une même fonction, dans trois fichiers, dont une seule avait été corrigée au fil du temps ; d'où la seconde moitié de cette suite, qui vérifie qu'aucun retour ne refabrique ses pages lui-même. Couvre aussi ce que ces pages disaient : réponses brutes des fournisseurs, messages internes, et le « [object Object] » que rendait l'échec d'enregistrement — une PostgrestError étant un objet nu, jamais une `Error`.",
  },
  {
    file: "ui/promesses.test.ts",
    minChecks: 20,
    covers:
      "Ce que le produit promet, le produit le fait. Une phrase d'interface est un engagement et le code ne sait pas qu'il en a pris un : le texte reste, la fonction change, et plus rien ne les compare — personne ne s'en aperçoit avant un marchand, au moment précis où il vérifie parce qu'il a déjà un doute. Après une panne venue de chez nous, l'écran promettait « votre passage ne vous a pas été décompté » alors que le quota était prélevé au lancement et jamais rendu. « Nous vous prévenons si la situation ne se rétablit pas » laissait croire à un avertissement, alors que le produit n'a ni courriel ni notification. Chaque contrôle vérifie un LIEN — une phrase et le mécanisme qui doit la rendre vraie : aucune promesse de nous manifester tant que le canal n'existe pas, la restitution du quota déclenchée à l'abandon et une seule fois, chaque outil annoncé annulable pourvu de sa procédure, et l'aperçu séparé du chemin qui écrit.",
  },
  {
    file: "ui/voice.test.ts",
    minChecks: 8000,
    covers:
      "Une seule voix, du premier écran au dernier. Le rapport annonçait « L'IA analyse ta boutique… » puis, trois blocs plus bas, « Nous n'avons pas réussi à lire les données de votre boutique » : le produit tutoyait sur les écrans écrits en premier et vouvoyait dans tout ce que le moteur produit depuis. Cela ne se lit pas comme un choix mais comme un logiciel assemblé par plusieurs mains. Le tutoiement est désormais interdit fichier par fichier dans tout ce que le marchand lit ; les consignes adressées au MODÈLE, que personne d'autre ne lit, sont exclues nommément et doivent garder leur forme. La première version de ce contrôle ne cherchait que les pronoms : elle a laissé passer « Patiente… », « Clique sur » et « Relance la correction ». Les impératifs se cherchent maintenant aussi — mais en TÊTE DE PHRASE uniquement, parce que « relance » et « vérifie » sont aussi des indicatifs et des noms, et qu'un contrôle qui crie faux finit desserré puis supprimé.",
  },
  {
    file: "audits/shopify-funnel.test.ts",
    minChecks: 55,
    covers:
      "L'entonnoir réel lu chez Shopify par ShopifyQL, sans permission nouvelle : le connecteur déclarait le trafic hors de portée et réclamait au marchand un outil tiers pour une donnée que sa boutique possédait. Un compte à zéro est une mesure et se publie ; un taux sur trop peu de volume ne se publie pas, il se déclare manquant ; une lecture échouée ne devient jamais un zéro ; et la fuite est cherchée à la marche où le VOLUME perdu est le plus grand, jamais au travers d'une marche non mesurée — le raccourci qui impute au tunnel ce qui vient de la fiche produit.",
  },
  {
    file: "audits/rules.test.ts",
    minChecks: 124,
    covers:
      "Le moteur de règles déterministes : ce qui est constaté vient de seuils appliqués à des observations, jamais du modèle. Aucune règle ne se prononce sans ses entrées — vérifié règle par règle sur un contexte vide —, un fait technique plafonne à « à vérifier » tant qu'aucune donnée commerciale ne corrobore, un score se décompose en retenues nommées, et les boutiques qui cassent les moteurs (sans trafic, sans commande, catalogue vide, petits échantillons, valeurs aberrantes, données contradictoires, entonnoir troué) produisent un constat honnête ou aucun constat.",
  },
  {
    file: "integrations/shopify-connecte.test.ts",
    minChecks: 46,
    covers:
      "La boucle « Connectez Shopify » après un OAuth réussi, signalée en production. L'autorisation, l'échange du jeton et l'écriture étaient sains : le durcissement RLS avait redonné le droit de lecture COLONNE PAR COLONNE en omettant `metadata`, et PostgreSQL refuse la requête entière dès qu'une colonne demandée n'est pas accordée. Le panneau lisait `connsQ.data ?? []` : une lecture refusée devenait « aucune connexion », et le marchand se voyait proposer de refaire ce qu'il venait de réussir. Le contrôle confronte désormais les colonnes DEMANDÉES aux colonnes ACCORDÉES. Il fige aussi la distinction entre les deux symptômes — le moteur lit avec le rôle de service, donc l'audit tournait — et les deux méprises du classement d'échec : notre clé refusée accusait Shopify, une panne Shopify accusait le fournisseur d'analyse.",
  },
  {
    file: "ui/donnees-json.test.ts",
    minChecks: 13,
    covers:
      "Aucune valeur absente ne s'affiche telle quelle. Le tableau de bord pouvait afficher « il en manque . Soit environ undefined EUR par mois. » dans la phrase même qui chiffre la perte du marchand : la garde testait `!== null` alors que la valeur était ABSENTE, et `undefined !== null` est vrai. L'entonnoir est relu d'une colonne JSON par un simple cast — le type dit ce que le moteur écrit aujourd'hui, pas ce que la base contient. Sur un produit dont l'argument est de n'avancer aucun chiffre injustifié, le mot `undefined` à la place d'un montant contredit tout, et précisément là où l'on parle d'argent.",
  },
  {
    file: "ui/accessibilite.test.ts",
    minChecks: 40,
    covers:
      "Ce que l'application dit à qui ne la voit pas, relevé dans l'arbre d'accessibilité du navigateur. Le bouton qui met fin à la session s'annonçait « button », sans plus — seule action de l'en-tête mobile. Le champ « Votre objectif principal » n'était nommé que par son texte d'exemple, qui disparaît à la première frappe : il perdait son nom au moment où le marchand écrivait dedans. Et quatre écrans sautaient de `h1` à `h3`, creusant un trou dans la navigation par titres, principal moyen de parcourir une page sans la voir.",
  },
  {
    file: "ui/responsive.test.ts",
    minChecks: 25,
    covers:
      "Rien ne déborde du cadre, de 320 à 1440 px. Mesuré au navigateur sur neuf écrans à six largeurs : à 320 px, le document de la page boutique faisait 1065 pixels — plus de trois fois le cadre, en-tête compris, et le bouton d'action principal se trouvait hors de l'écran. Une seule cause partout : `min-width: auto`, qui interdit à un élément flexible ou de grille de descendre sous la largeur intrinsèque de son contenu — ici l'adresse insécable d'une boutique. C'est aussi pourquoi les `truncate` ne tronquaient rien. Le contrôle protège les `min-w-0` posés, le défilement local des onglets, et interdit toute largeur figée au-delà de 320 px.",
  },
  {
    file: "ui/erreurs-de-lecture.test.ts",
    minChecks: 40,
    covers:
      "Ce que le marchand voit quand une lecture échoue, et au bout de combien de temps. Deux défauts mesurés au navigateur. PostgREST ne rend pas une `Error` mais un objet nu : `err instanceof Error` était toujours faux, et toute l'interface affichait le mot « Erreur », seul, à qui n'avait pas pu enregistrer son modèle économique, son objectif ou sa boutique. Et l'ossature de chargement tenait 8,5 s avant le moindre mot — trois nouveaux essais par défaut, y compris sur un 403 qui ne changera jamais. Le statut HTTP, qui vit sur la RÉPONSE et non sur l'erreur, est désormais conservé ; ce qui est définitif n'est plus rejoué, les écritures ne sont jamais rejouées, et le délai est plafonné à 2 s.",
  },
  {
    file: "ui/page-accueil.test.ts",
    minChecks: 20,
    covers:
      "La vitrine parle comme le produit. La page d'accueil vendait « Cash récupéré », « Pas de blabla », « Chaque jour sans audit = de l'argent qui part » ; l'application, elle, dit « Nous n'avons pas cette donnée » et « ce n'est pas un potentiel nul, c'est un potentiel non mesuré ». Deux personnalités pour un seul produit — et le visiteur recruté par la première lit la seconde comme un recul, alors que la prudence EST le produit. Pire : la carte de démonstration affichait « Vous laissez ~2 400 €/mois » sans dire que le chiffre était inventé, sur la page d'un outil dont l'argument est de n'avancer aucun chiffre injustifiable. Chaque promesse de la vitrine est désormais reliée au code qui la tient.",
  },
  {
    file: "ui/page-boutique.test.ts",
    minChecks: 18,
    covers:
      "La page boutique, dans l'ordre où le marchand s'en sert. « Lancer un audit » arrivait en septième position, derrière le formulaire de réglages qui ouvrait la page. Deux « Objectif » cohabitaient sur un seul écran — la vignette lisait le texte libre `goal`, le formulaire éditait le nombre `revenue_goal` — si bien qu'un objectif renseigné s'affichait « — » juste au-dessus. Le texte libre, lui, se saisissait à l'inscription et n'était plus jamais ni affiché ni modifiable, alors que le moteur d'audit continuait de s'en servir. Et « Objectif de CA (Devise non déterminée/mois) » accueillait tout nouveau marchand, la devise étant toujours inconnue avant que la boutique n'existe.",
  },
  {
    file: "ui/etats-de-chargement.test.ts",
    minChecks: 30,
    covers:
      "L'attente occupe la place de ce qu'elle annonce. La branche protégée valide le jeton par le réseau dans `beforeLoad` sans composant d'attente : chaque ouverture de chaque page protégée commençait par un écran entièrement noir. Sept autres attentes étaient des lignes de texte nues, remplacées par des blocs de plusieurs centaines de pixels — la page sautait sous les yeux du marchand. Et « Boutique introuvable » s'affichait aussi bien sur un échec de lecture que sur une absence réelle. Chargement, échec et vide restent désormais trois états distincts, l'échec toujours testé avant le vide.",
  },
  {
    file: "ui/rapport-preuve.test.ts",
    minChecks: 16,
    covers:
      "La preuve, à l'écran. `audit_findings.evidence` — `based_on` et `assumptions`, tous deux exigés du modèle et enregistrés pour chaque constat — n'était affichée nulle part : le marchand lisait une gravité, un titre et un montant, et devait modifier sa boutique là-dessus. Toute la rigueur du moteur ne servait à rien tant qu'elle restait invisible. Le contrôle vérifie que la chaîne Observation → Problème → Preuve → Impact → Recommandation reste entière ET dans cet ordre à l'écran, et qu'une preuve absente ne produit ni bloc vide ni « undefined ».",
  },
  {
    file: "ui/rapport-robustesse.test.ts",
    minChecks: 9,
    covers:
      "Le rapport ne tombe pas pour une donnée d'ornement. Deux casts non gardés sur la ressource embarquée `stores(...)` — que PostgREST rend `null` sous RLS ou après suppression — faisaient partir la page entière sur la frontière d'erreur : le marchand perdait son rapport à cause du nom de boutique affiché au-dessus du titre. Le lien de retour passe par `audit.store_id`, déjà utilisé ailleurs sur la même page, et le nom manquant replie le titre au lieu de le casser.",
  },
  {
    file: "actions/execution.test.ts",
    minChecks: 98,
    covers:
      "Chemin « corriger maintenant » : une écriture interrompue n'est jamais annoncée comme faite, deux propositions sur un même problème n'écrivent pas deux fois, une correction non appliquée est remboursée, et la réversibilité promise est réellement tenue.",
  },
];

/** Total minimal, tous domaines confondus. */
export const MIN_TOTAL_CHECKS = EXPECTED_SUITES.reduce((sum, s) => sum + s.minChecks, 0);
