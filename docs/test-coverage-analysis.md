# Analyse de la couverture de tests

Date : 2026-08-13 · Périmètre : `src/`, `supabase/migrations/`

## 1. État actuel

**Il n'y a aucun test dans ce dépôt, et aucun moyen d'en exécuter un.**

| Élément | État |
|---|---|
| Fichiers de test | 0 |
| Test runner installé | aucun (ni vitest, ni jest, ni bun:test utilisé) |
| Script `test` dans `package.json` | absent |
| CI (`.github/workflows`) | absent |
| `lint` / `tsc --noEmit` automatisés | non — les scripts existent mais rien ne les déclenche |

Couverture mesurée : **0 %** sur ~6 100 lignes écrites à la main
(7 610 lignes TS/TSX hors `components/ui/`, dont 1 103 de types Supabase générés
et 347 de `routeTree.gen.ts`).

Conséquence directe : aucune régression n'est détectable avant la production, y
compris sur le code qui écrit dans la boutique Shopify de l'utilisateur et
modifie ses budgets publicitaires réels.

## 2. Cartographie du risque

Le code se répartit en cinq zones de risque très inégales. La colonne
« testabilité » indique le coût d'écriture d'un test aujourd'hui, sans
refactoring.

| Zone | Fichiers | Conséquence d'un bug | Testabilité |
|---|---|---|---|
| **A. Logique métier pure** | `scoring.ts`, `audit-parse.ts`, parties pures de `metrics.server.ts` et `snapshots.server.ts` | Score et priorités faux → l'utilisateur travaille sur le mauvais problème | **Immédiate** — aucune I/O |
| **B. Frontière de sécurité** | `crypto.server.ts`, les 3 callbacks OAuth, `auth-middleware.ts`, policies RLS | Fuite de tokens, accès inter-locataires | Facile (crypto) à moyenne (RLS) |
| **C. Écritures réelles pilotées par l'IA** | `apply-fix.server.ts` (458 L) | **Modifie la vraie boutique et les vrais budgets pub** | Moyenne — nécessite de mocker `fetch` |
| **D. Orchestration serveur + BDD** | `audit.functions.ts`, `cockpit.functions.ts`, `tracking.server.ts` | Audits perdus, chiffres du cockpit faux | Moyenne — nécessite un faux client Supabase |
| **E. UI** | `routes/`, `components/` | Dégâts cosmétiques | Coûteuse, faible retour |

La zone **C** est la plus dangereuse et la moins protégée : c'est le seul
endroit du produit où une sortie de modèle de langage se transforme en écriture
irréversible chez un tiers.

## 3. Défauts déjà présents, qu'un test aurait attrapés

Ces sept points ont été trouvés en lisant le code et vérifiés en exécutant la
logique concernée. Ils illustrent le type de bug que l'absence de tests laisse
passer — ils ne sont pas corrigés dans ce document.

### 3.1 Les garde-fous sur les arguments de l'IA produisent `NaN`

`src/lib/apply-fix.server.ts:341-342`, `:356`, `:411`

```js
Math.min(Math.max(Number("beaucoup"), 5), 25)  // → NaN
Math.min(Math.max(Number(undefined), 3), 30)   // → NaN
Math.max(5, Number("12,50"))                   // → NaN
```

`Math.max(NaN, 5)` vaut `NaN`, donc le clamp ne clampe rien. Ces bornes
existent précisément pour brider la sortie du modèle avant de l'envoyer aux API
Shopify / Meta / Google — et elles ne tiennent pas. Le cas `"12,50"` n'est pas
théorique : le prompt système est intégralement en français et demande des
montants en euros, la virgule décimale est la sortie attendue d'un modèle
francophone.

Note : `Math.max(5, Number(null))` vaut bien `5`. Seules les valeurs non
numériques non nulles passent.

### 3.2 Un `difficulty` non numérique fait échouer l'audit entier

`src/lib/scoring.ts:105` → `src/lib/audit.functions.ts:333,337`

Un `difficulty` à `NaN` traverse le clamp (même cause qu'en 3.1), donc
`computePriority` renvoie `NaN`. À l'insertion, `JSON.stringify` convertit
`NaN` en `null`, or `priority_score numeric NOT NULL` et
`difficulty smallint NOT NULL` (migration `20260807095300`). L'insertion est
groupée pour tous les findings : **une seule valeur invalide fait perdre les
findings de tout l'audit**, l'audit passe en `failed`, et l'appel au modèle est
déjà payé.

### 3.3 Le chemin de repli JSON n'est validé par rien

`src/lib/audit.functions.ts:263-275`

Quand le modèle répond en texte au lieu d'utiliser le tool call, la réponse
passe par `extractJsonBlock` puis `JSON.parse(...) as {...}` — un simple cast
TypeScript, effacé à l'exécution. L'`enum` du schéma d'outil n'est donc plus
appliqué sur ce chemin. Comme `category` est un enum PostgreSQL, une catégorie
inventée par le modèle (`"seo"`, `"tracking"`…) fait échouer l'insertion
groupée, avec la même perte totale qu'en 3.2. Zod est déjà une dépendance du
projet et n'est utilisé ici que pour valider l'entrée, pas la sortie du modèle.

### 3.4 `extractJsonBlock` jette du JSON parfaitement récupérable

`src/lib/audit-parse.ts`

```js
extractJsonBlock('{"a":1} et voilà, j\'espère que {ça} aide')  // → undefined
extractJsonBlock('{"a":1}\n{"b":2}')                           // → undefined
```

La fonction découpe du **premier** `{` au **dernier** `}`. Dès que le modèle
ajoute un commentaire contenant une accolade après le JSON — c'est-à-dire le
scénario exact pour lequel cette fonction existe — l'extraction échoue et
l'utilisateur voit « Réponse IA invalide. Relance l'audit. »

### 3.5 Un gain estimé négatif est relu comme un positif

`src/lib/scoring.ts:103` — `const impact = gain > 0 ? gain : SEVERITY_WEIGHT[...] * 10;`

Un finding que le modèle chiffre à −800 €/mois retombe sur le poids de sévérité
et obtient une priorité de 52, au lieu d'être signalé comme incohérent.
`computePotential` additionne également ces valeurs négatives dans le
« potentiel identifié » affiché en tête de l'audit.

### 3.6 Les CTR n'ont pas la même unité selon le canal

`src/lib/metrics.server.ts:143` vs `:147`

`meta_ctr` est affiché tel quel en `percent`, `google_ctr` est multiplié par
100 — et `snapshotToPromptBlock` refait la même distinction. La convention
retenue pour chaque API (fraction ou pourcentage) n'est écrite nulle part et
n'est vérifiée par rien. Si l'une des deux est fausse, le chiffre injecté dans
le prompt de l'audit et celui affiché dans les alertes sont faux d'un facteur
100.

### 3.7 XSS latente dans les pages de callback OAuth

`callback.ts` Shopify `:51`, `:80` · Meta `:93`, `:97` · Google `:101`

Le corps de réponse brut du endpoint de token tiers (`errText`), le message
d'exception, et le nom de compte publicitaire renvoyé par Meta (`primary.name`)
sont interpolés dans un document HTML sans échappement. Gravité limitée — page
sans session ni formulaire, en cul-de-sac — mais c'est typiquement l'invariant
qu'un test fige une fois pour toutes.

**Point positif :** `verifyOAuthState` est correctement écrit — comparaison en
temps constant, vérification préalable des longueurs, expiration. Il mérite des
tests pour le rester.

## 4. Plan proposé, par ordre de retour sur investissement

### Étape 0 — Rendre les tests possibles (préalable, ~1 h)

Vite 8 est déjà dans l'arbre de dépendances, donc **Vitest** est le choix qui
demande le moins de configuration ; `bun test` est l'alternative si l'on veut
zéro dépendance supplémentaire (Bun est déjà utilisé, cf. `bunfig.toml`).

- Ajouter `vitest` + `@vitest/coverage-v8`, et `@testing-library/react` +
  `jsdom` seulement quand l'étape 4 sera abordée.
- Deux environnements : `node` pour `src/lib/**` et `*.server.ts`, `jsdom` pour
  les composants.
- Scripts `test`, `test:watch`, `test:coverage`.
- Un workflow GitHub Actions qui exécute `tsc --noEmit`, `eslint .` et `vitest
  run`. **Aujourd'hui rien n'exécute ces trois commandes automatiquement** —
  c'est le gain le plus immédiat du lot.

### Étape 1 — Logique pure (le meilleur ratio, ~1 jour)

Cible : `scoring.ts`, `audit-parse.ts`, `metrics.server.ts` (parties pures),
`snapshots.server.ts` (`snapshotToPromptBlock`, `num`).

- `computePriority` : entrées nulles, gain négatif (3.5), `difficulty` hors
  bornes et non numérique (3.2), `timeframe` inconnu, sévérité inconnue →
  repli sur `medium`.
- `computeCategoryScores` : catégorie absente → 78 et non 100 ; plancher à 5 ;
  catégorie inconnue silencieusement ignorée.
- `computeGlobalScore` : stabilité de la pondération — un test de régression sur
  un jeu de findings de référence est ce qui empêchera un futur ajustement des
  poids de déplacer tous les scores sans qu'on s'en aperçoive.
- `computePotential`, `formatEur`, `formatMinutes` : `null`, `0`, `Infinity`,
  séparateur français.
- `extractJsonBlock` : fence, absence de fence, texte après le JSON (3.4),
  fence non fermée, deux objets, JSON invalide.
- `weightedAvg` : poids tous nuls → moyenne simple ; valeurs `null` ; liste
  vide → `null`.
- `computeDeltas` / `judgeOutcome` : `before = 0`, `after = null`, moins de
  3 jours écoulés → `measuring`, seuils −5 % et +3 %, choix du `main` driver.
- `snapshotToPromptBlock` : aucun canal → le texte doit exiger une confiance
  `low` ; canal indisponible → la consigne « n'invente aucun chiffre » doit être
  présente. Cette dernière assertion protège directement la promesse produit
  « jamais de métrique inventée ».

Ces tests ne nécessitent ni mock, ni base, ni réseau.

### Étape 2 — Frontière de sécurité (~1 jour)

- `crypto.server.ts` : aller-retour `encryptToken`/`decryptToken` ; IV différent
  à chaque appel ; texte chiffré altéré → rejet par le tag GCM ; clé absente →
  erreur explicite.
- `verifyOAuthState` : signature valide ; signature falsifiée ; état tronqué
  (`"abc"`, sans point) ; signature de mauvaise longueur ; état expiré au-delà
  de `maxAgeMs` ; corps JSON invalide.
- Callbacks OAuth : paramètres manquants → 400 ; `provider` ne correspondant pas
  → 400 ; `shop` différent de celui signé → 400 ; échec d'échange du code → 502 ;
  échappement HTML des messages d'erreur (3.7).
- `requireSupabaseAuth` : absence d'en-tête, schéma autre que `Bearer`, token
  n'ayant pas trois segments, variables d'environnement manquantes.
- **Isolation RLS** : un test d'intégration contre une base Supabase locale qui
  vérifie qu'un utilisateur A ne peut lire ni écrire les `stores`, `audits`,
  `audit_findings`, `data_connections` et `fix_outcomes` d'un utilisateur B. Les
  policies sont bien écrites, mais rien ne prouve qu'elles le resteront — et
  `data_connections` contient les tokens chiffrés de toutes les boutiques.

### Étape 3 — Écritures réelles pilotées par l'IA (~2 jours, priorité haute)

`apply-fix.server.ts` est le fichier où un bug coûte le plus cher, et il n'a
aucun filet. En mockant `fetch` (la passerelle IA et les API canal) :

- Les clamps tiennent pour toute sortie de modèle : `"beaucoup"`, `"12,50"`,
  `null`, `-30`, `1e9` (3.1). **À écrire en premier.**
- Un `product_id` inexistant est rejeté (ce garde-fou existe déjà, il faut le
  figer).
- Le nom d'outil renvoyé ne correspond à aucun canal connecté → repli
  `no_action` sans écriture.
- L'IA appelle un outil Meta alors que seul Shopify est connecté → aucune
  écriture.
- Aucun `tool_call` dans la réponse → erreur claire, aucune écriture.
- Le code promo est bien mis en majuscules et débarrassé des espaces.
- Assertion transversale : **dans tous les cas d'échec, zéro requête d'écriture
  n'est émise.**

### Étape 4 — Orchestration serveur (~2 jours)

Avec un faux client Supabase (double en mémoire) :

- `runAudit` : le chemin d'échec marque bien l'audit `failed` avec le message
  d'erreur ; un `category` hors enum ne doit pas faire perdre les autres
  findings (3.3) ; les findings sont insérés dans l'ordre de priorité
  décroissante avec un `sort_order` cohérent.
- `getCockpit` : absence de snapshot → repli sur les valeurs déclarées ;
  `adSpend` à 0 → repli sur le budget déclaré ; `roas` non calculable →
  `null` plutôt que `Infinity`.
- `refreshStoreOutcomes` : aucun canal connecté → erreur explicite ; une ligne
  en échec ne doit pas interrompre les suivantes.
- `captureStoreMetrics` : un canal en erreur est ignoré et **apparaît bien dans
  `unavailable`** — aujourd'hui trois `catch {}` silencieux (`metrics.server.ts`,
  `recordFixBaseline`, l'insertion de `captureAndStoreSnapshot`) rendent un
  pipeline de suivi durablement cassé indiscernable d'un pipeline sain.

### Étape 5 — UI (~1 jour, à faire en dernier)

Quelques tests de rendu ciblés seulement : `ScoreRing` (0, 100, `null`),
`Cockpit` (état vide, chiffres manquants), `ConnectionsPanel` (états
connecté / déconnecté / en erreur). Pas de tests exhaustifs sur `components/ui/`,
qui est du shadcn non modifié.

## 5. Objectifs de couverture suggérés

Viser un pourcentage global n'a pas de sens ici tant que `components/ui/` pèse
la moitié des fichiers. Des seuils par zone sont plus utiles :

| Zone | Cible | Justification |
|---|---|---|
| `src/lib/scoring.ts`, `audit-parse.ts` | 100 % branches | Pur, petit, décide ce que voit l'utilisateur |
| `src/lib/crypto.server.ts` | 100 % branches | Frontière de sécurité |
| `src/lib/apply-fix.server.ts` | ≥ 80 % branches | Écritures irréversibles |
| `src/lib/*.server.ts`, `*.functions.ts` | ≥ 70 % | Orchestration |
| `src/routes/api/**` | ≥ 80 % | Entrées non authentifiées |
| `src/components/ui/**` | exclu | shadcn non modifié |

## 6. Résumé

Les trois actions à mener en premier, dans l'ordre :

1. **Mettre en place le runner et la CI** — aujourd'hui même `tsc` et `eslint`
   ne tournent nulle part automatiquement.
2. **Tester `apply-fix.server.ts`**, en commençant par les clamps cassés du
   point 3.1 : c'est le seul code du produit qui transforme une sortie de modèle
   de langage en écriture irréversible chez un tiers.
3. **Tester `scoring.ts` et `audit-parse.ts`** — quelques heures de travail,
   aucune infrastructure, et cela couvre la logique qui décide du score affiché
   et de l'ordre des recommandations.
