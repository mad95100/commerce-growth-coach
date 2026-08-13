# Analyse de couverture de tests — EcomPilot

État au moment de l'analyse : **aucun test dans le dépôt**.

- 0 fichier `*.test.*` / `*.spec.*`
- Aucun runner installé (pas de `vitest`, `jest`, `playwright` dans `package.json`)
- Aucun script `test` dans `package.json` (seulement `dev`, `build`, `lint`, `format`)
- Aucun workflow CI (`.github/` absent)

La couverture est donc de **0 %**, et le seul filet de sécurité actuel est `tsc` + ESLint.
Ce document ne demande pas « couvrons tout » : il classe les zones du code par
*coût d'un bug non détecté*, et liste les cas de test concrets à écrire en premier.

---

## Pourquoi c'est urgent ici en particulier

Ce produit n'est pas une app en lecture seule. Il fait trois choses qui rendent
l'absence de tests coûteuse :

1. **Il dépense l'argent réel de l'utilisateur** — `applyFixAcrossChannels` modifie
   des budgets Meta/Google Ads, met des campagnes en pause, réécrit des fiches
   produit Shopify et crée des codes promo.
2. **Il laisse un LLM choisir l'action** — les paramètres d'écriture viennent d'un
   `tool_call` de `google/gemini-2.5-flash`, pas d'un formulaire validé.
3. **Il produit un chiffre que l'utilisateur croit** — le score /100 et le classement
   des priorités pilotent toutes les décisions dans l'app.

Une régression silencieuse dans le scoring n'est visible par personne. Une régression
dans les garde-fous d'écriture coûte de l'argent au client.

---

## Priorité 1 — Garde-fous des écritures pilotées par l'IA

**Fichiers :** `src/lib/apply-fix.server.ts`, `src/lib/connectors/{meta,google,shopify}-apply.server.ts`

C'est la zone la plus risquée du dépôt et elle est entièrement non testée.

Les règles métier (« budget entre -50 % et +100 % », « jamais sous 5 €/jour »,
« remise 5-25 % », « titres RSA max 30 caractères ») sont écrites **dans le prompt
système**, en français, à destination du modèle. Le code, lui, n'applique qu'une
partie de ces règles :

| Règle annoncée dans le prompt | Appliquée dans le code ? |
| --- | --- |
| Budget jamais sous 5 €/jour | Oui — `Math.max(5, …)` |
| Budget variation max +100 % | **Non** — aucune borne haute |
| Remise 5-25 % | Oui — `Math.min(Math.max(n, 5), 25)` |
| Durée promo 3-30 jours | Oui |
| Titres RSA max 30 caractères | **Non** — envoyé tel quel à Google |
| Descriptions RSA max 90 caractères | **Non** |
| Mots-clés négatifs « non acheteurs » | **Non** — liste envoyée telle quelle |

Un prompt n'est pas une validation. Si le modèle renvoie `daily_budget_eur: 5000`
sur un compte qui dépensait 20 €/jour, le code exécute l'appel.

**Cas de test à écrire (unitaires, gateway IA et API canaux mockées) :**

- `meta_update_budget` avec `daily_budget_eur = 5000` alors que le budget courant est 20 →
  doit être borné (ou refusé), pas transmis tel quel.
- `daily_budget_eur` non numérique (`"beaucoup"`, `null`, `undefined`) →
  `Math.max(5, Number(x))` renvoie `NaN`, actuellement transmis à l'API. Doit échouer proprement.
- Idem pour `create_discount_code` : `percentage: "vingt"` → `NaN` transmis à Shopify.
- `google_update_rsa` avec un titre de 60 caractères → doit être rejeté avant l'appel API.
- `update_product` visant un `product_id` absent de la liste → déjà géré
  (`« L'IA a visé un produit qui n'existe plus »`), à verrouiller par un test de non-régression.
- Le modèle appelle `meta_pause_adset` alors que seul Shopify est connecté →
  doit retomber sur `no_action`, sans appel réseau.
- Un canal en erreur (Meta injoignable) ne doit pas empêcher l'application d'une
  correction Shopify.

**Effort :** moyen. **Valeur :** la plus haute du dépôt.

---

## Priorité 2 — Moteur de scoring (`src/lib/scoring.ts`)

164 lignes, 100 % pur, zéro dépendance, zéro I/O. C'est le code le plus facile à
tester du dépôt et il pilote tout ce que l'utilisateur voit. Il devrait être à
~100 % de couverture.

L'écriture des tests fait apparaître au moins trois comportements douteux qu'il
faut trancher (bug ou intention ?) :

**a) Une catégorie avec un petit problème note mieux qu'une catégorie propre.**

```
0 finding                          → 78
1 finding low / confiance low      → 100 - (4 × 0.4) = 98
```

Trouver un problème mineur *améliore* la note de 20 points. L'inversion vient du
plancher prudent à 78 pour les catégories sans finding. Un test rendrait la règle
explicite et empêcherait la dérive.

**b) `computePriority` mélange deux unités.**

```ts
const impact = gain > 0 ? gain : SEVERITY_WEIGHT[severity(f)] * 10;
```

Quand l'IA fournit un gain estimé, `impact` est en euros/mois. Quand elle ne le
fournit pas, `impact` vaut 300 pour un `critical`. Résultat : un finding *sans*
estimation chiffrée écrase systématiquement un finding réel à 150 €/mois. Le
classement affiché dans le cockpit s'en trouve faussé.

**c) `estimated_gain_min` nul mais `max` renseigné.**

`((null ?? 0) + (max)) / 2` → la fourchette est divisée par deux silencieusement.

**Cas de test à écrire :**

- `computeCategoryScores([])` → toutes les catégories à 78.
- Comparaison explicite : catégorie vide vs catégorie avec 1 finding mineur (fixe l'intention).
- Plancher à 5 : 10 findings `critical` / confiance `high` → 5, jamais négatif.
- `severity` / `confidence` inconnus (`"catastrophique"`, `""`, `null`) → retombent sur `medium`.
- `computePriority` : ordre stable entre findings avec et sans gain estimé.
- `difficulty` hors bornes (`0`, `12`, `null`) → clampé sur 1-5, jamais de division par zéro.
- `timeframe` inconnu → poids d'urgence 1.
- `computeGlobalScore` avec des catégories manquantes → défaut 78, pas `NaN`.
- `formatEur(null)`, `formatEur(NaN)`, `formatEur(Infinity)` → `"—"`.
- `formatEur(1234.6)` → `"1 235 €"` (verrouille aussi la disponibilité de l'ICU `fr-FR` dans le runtime de déploiement).
- `formatMinutes(0)` → `"—"` (comportement actuel : 0 est falsy — voulu ?).

**Effort :** faible (une journée). **Valeur :** très haute.

---

## Priorité 3 — Crypto et OAuth (`src/lib/crypto.server.ts`)

Chiffre les tokens d'accès Shopify/Meta/Google et signe l'état OAuth. 58 lignes,
testables sans réseau (il suffit de poser `DATA_CONNECTIONS_ENCRYPTION_KEY` et
`OAUTH_STATE_SECRET` dans l'environnement de test).

**Cas de test à écrire :**

- Aller-retour `encryptToken` / `decryptToken`, y compris sur chaîne vide et UTF-8 accentué.
- Deux chiffrements du même texte donnent deux résultats différents (IV aléatoire).
- Ciphertext altéré d'un octet → `decryptToken` lève (l'authentification GCM fait son travail).
- Ciphertext tronqué (< 28 octets) → erreur claire, pas un crash obscur.
- Clé absente → message `"DATA_CONNECTIONS_ENCRYPTION_KEY manquant"`.
- `verifyOAuthState` : signature valide → payload rendu ; signature falsifiée → lève.
- État sans le séparateur `.` → `"État OAuth invalide"`.
- État de plus de 15 minutes → `"État OAuth expiré"` (à tester avec une horloge simulée).
- **Rejeu :** le `nonce` est bien mis dans l'état mais n'est jamais vérifié côté
  callback. Un même `state` peut être rejoué autant de fois qu'on veut pendant 15
  minutes. Un test qui documente ce trou est plus utile qu'un commentaire.

**Effort :** faible. **Valeur :** haute (sécurité).

---

## Priorité 4 — Validation du domaine Shopify (`normalizeShop`)

Dans `src/lib/connectors/shopify.functions.ts`. Cette fonction décide vers quel
hôte le serveur va faire une requête authentifiée. C'est la barrière anti-SSRF
du flux OAuth, et elle tient en 8 lignes de regex — exactement le genre de code
qui casse à la première « petite amélioration ».

**Cas de test à écrire :**

- `"monshop"` → `"monshop.myshopify.com"`.
- `"https://monshop.myshopify.com/admin"` → `"monshop.myshopify.com"`.
- `"MonShop.MyShopify.COM"` → normalisé en minuscules.
- Rejets attendus : `"evil.com"`, `"evil.com/monshop.myshopify.com"`,
  `"monshop.myshopify.com.evil.com"`, `"user@evil.com"`, `"-monshop"`, `""`,
  `"monshop.myshopify.com:8080"`.
- Cohérence bout en bout : le `shop` signé dans le state doit être celui vérifié
  dans le callback (`payload.shop !== shop.toLowerCase()` → 400).

**Effort :** très faible (une heure). **Valeur :** haute.

---

## Priorité 5 — Métriques, écarts et verdict (`src/lib/metrics.server.ts`)

`computeDeltas`, `weightedAvg` et `judgeOutcome` sont purs et non testés. Ils
décident du message « ta correction a marché / n'a pas marché » affiché à
l'utilisateur.

Deux comportements à trancher, révélés en écrivant les tests :

**a) Un passage de 0 à un chiffre réel est invisible.**

```ts
const change_pct = b != null && a != null && b !== 0 ? … : null;
```

Une boutique qui passe de 0 € à 3 000 € de CA a `change_pct = null`. `judgeOutcome`
filtre les drivers dont `change_pct` est nul → il ne reste aucun driver → statut
`"measuring"` indéfiniment. C'est précisément le cas d'usage `situation: "no_sales"`
que le produit cible en priorité.

**b) Un effondrement du ROAS est calculé puis ignoré.**

`worst` est calculé sur tous les drivers, mais si le CA est présent il devient
`main` : si le CA monte de 4 % pendant que le ROAS chute de 50 %, le statut est
`on_track` et `alert_message` est `null`. `worst` n'est utilisé que dans la branche
`regressed`.

**Cas de test à écrire :**

- `weightedAvg([])` → `null` ; poids tous à zéro → moyenne simple ; valeurs `null`/`NaN` ignorées.
- `computeDeltas` : ne renvoie que les métriques présentes des deux côtés ou d'un côté.
- `computeDeltas` avec `before = 0` → comportement à définir explicitement.
- `judgeOutcome` à J+1 → `measuring` (quel que soit le delta).
- `judgeOutcome` à J+10 avec CA −12 % → `regressed`, message non nul.
- `judgeOutcome` à J+10 avec CA +1 % → `underperforming`, message différent selon
  que `expectedGainMin` est fourni ou non.
- `judgeOutcome` CA +4 % / ROAS −50 % → fixe la décision produit (`on_track` ou alerte ?).
- `appliedAt` dans le futur ou invalide → pas de `NaN` dans le message affiché.

Note produit à confirmer : les métriques sont des fenêtres glissantes de 30 jours,
mais le verdict tombe dès J+3. Un correctif appliqué il y a 3 jours ne peut
mécaniquement influencer que ~10 % de la fenêtre. Le seuil `change < 3` est donc
presque toujours atteint → `underperforming` par défaut. Un test rend ce biais visible.

---

## Priorité 6 — Parsing des réponses IA (`src/lib/audit-parse.ts`)

16 lignes, pur, et c'est le point de rattrapage quand le modèle ignore
`tool_choice`. S'il échoue, l'audit entier passe en `failed`.

**Cas de test à écrire :**

- JSON dans un bloc ` ```json `.
- JSON dans un bloc ` ``` ` sans langage.
- JSON brut sans bloc.
- Texte avant *et* après le JSON.
- **Deux objets JSON dans le texte** → `indexOf("{")` + `lastIndexOf("}")` produit
  une tranche invalide → `undefined`. Comportement acceptable, mais à verrouiller.
- Bloc de code non fermé.
- JSON tronqué (cas réel : `finish_reason: "length"`) → `undefined`, pas d'exception.
- Chaîne vide / `undefined`.

**Effort :** très faible. **Valeur :** moyenne-haute (fiabilité perçue du produit).

---

## Priorité 7 — Agrégation du cockpit (`src/lib/cockpit.functions.ts`)

La logique de calcul est enfouie dans un `createServerFn`, donc non testable sans
extraction. C'est la principale amélioration de *testabilité* à faire dans le dépôt :
sortir le calcul pur dans un `computeCockpit(store, snapshot, audit, findings)` et
laisser le server function ne faire que les I/O Supabase.

Deux comportements à couvrir une fois extraits :

```ts
const adSpend = (snap?.meta?.spend ?? 0) + (snap?.google?.cost ?? 0)
  || store.monthly_ad_budget || null;
```

Une dépense réelle mesurée à 0 € est *falsy* → l'app affiche à la place le budget
**déclaré** par l'utilisateur. Le chiffre présenté n'est alors plus une mesure.

```ts
const roas = snap?.meta?.roas ?? (revenue && adSpend ? revenue / adSpend : null);
```

Le ROAS affiché est soit le ROAS Meta seul, soit un ROAS global CA/dépense —
deux grandeurs différentes sous la même étiquette.

**Cas de test à écrire :** aucun snapshot (fallback sur les valeurs déclarées),
snapshot partiel, dépense réelle à 0, `orders = 0` (division), `avg_product_cost_ratio`
absent → `margin`/`profit` à `null` et non `NaN`, priorités limitées à 3 et triées.

---

## Ce qui ne mérite *pas* de tests

Pour éviter de gonfler la couverture sans gagner en sécurité :

- **`src/components/ui/**` (48 fichiers)** — shadcn/ui non modifié. Testé en amont.
- **`src/routeTree.gen.ts`**, `src/integrations/supabase/types.ts` — générés.
- **`src/lib/utils.ts`** (`cn`) — wrapper de `twMerge`.
- Les composants de présentation purs (`ScoreRing`, `AppShell`) — sauf si une logique
  s'y ajoute plus tard.

Les composants qui mériteraient un test de rendu plus tard, une fois le socle en
place : `ConnectionsPanel` (271 lignes, gère des états de connexion/erreur) et
`Cockpit` (affichage des chiffres monétaires et des états vides).

---

## Socle technique proposé

Vite est déjà là, donc Vitest s'intègre sans nouvelle chaîne de build :

```jsonc
// devDependencies
"vitest": "^3",
"@vitest/coverage-v8": "^3",
// scripts
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

Rappel : `bunfig.toml` impose `minimumReleaseAge = 86400`. Toute nouvelle dépendance
doit avoir plus de 24 h, ou être ajoutée explicitement à `minimumReleaseAgeExcludes`
(à confirmer avec le propriétaire du projet).

Points d'attention pour la configuration :

- Environnement `node` par défaut ; `jsdom` uniquement pour les tests de composants.
- Les fichiers `*.server.ts` importent `node:crypto` → ils doivent tourner en environnement Node.
- Poser `DATA_CONNECTIONS_ENCRYPTION_KEY` et `OAUTH_STATE_SECRET` dans un fichier
  `setupFiles` de test (valeurs factices).
- Mocker `fetch` globalement : **aucun test ne doit joindre l'API Lovable, Shopify,
  Meta ou Google.** Un test qui appelle `applyFixAcrossChannels` sans mock dépenserait
  de l'argent réel.
- L'alias `@/` est déjà résolu par `vite-tsconfig-paths`.

## Ordre de mise en œuvre suggéré

1. Installer Vitest + script `test` + un premier test trivial sur `scoring.ts` (valide la chaîne).
2. Couvrir `scoring.ts` intégralement — pur, rapide, révèle les trois points ci-dessus.
3. `crypto.server.ts` et `normalizeShop` — sécurité, effort faible.
4. `audit-parse.ts` — effort très faible.
5. `metrics.server.ts` (`weightedAvg`, `computeDeltas`, `judgeOutcome`).
6. Garde-fous d'`apply-fix.server.ts` avec `fetch` mocké — le plus gros morceau,
   mais aussi le seul qui protège l'argent de l'utilisateur.
7. Extraire la logique du cockpit hors du server function, puis la couvrir.
8. Ajouter un workflow CI (`lint` + `tsc --noEmit` + `test`) — sans ça, les tests
   cessent d'être exécutés au bout de quelques semaines.

## Cible réaliste

Ne pas viser un pourcentage global (les 48 composants shadcn le rendraient
trompeur). Viser plutôt, par répertoire :

| Zone | Cible |
| --- | --- |
| `src/lib/scoring.ts` | 100 % |
| `src/lib/crypto.server.ts` | ~95 % |
| `src/lib/audit-parse.ts` | 100 % |
| `src/lib/metrics.server.ts` (fonctions pures) | ~90 % |
| `src/lib/apply-fix.server.ts` (branches d'exécution) | ~80 % |
| `src/components/ui/**` | exclu du rapport |
