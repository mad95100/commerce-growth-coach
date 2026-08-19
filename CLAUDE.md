# EcomPilot — mémoire technique

SaaS d'audit de boutique Shopify. Le produit lit une boutique, chiffre ce qui lui
fait perdre de l'argent, et donne les corrections. L'utilisateur est un
**marchand**, jamais un développeur.

## Stack

TanStack Start 1.168 (SSR, routage par fichiers) · React 19 · TanStack Router /
Query · TypeScript 5.8 strict · Tailwind 4 (`@theme inline`, pas de
`tailwind.config`) · Supabase (Postgres + GoTrue) · Cloudflare Workers via
wrangler 4 · Vite 8 · Zod 3.

## Structure

```
src/routes/            routage par FICHIERS — voir src/routes/README.md
  __root.tsx           coque unique (pas de src/pages/, pas de app/layout.tsx)
  _authenticated/      branche protégée (beforeLoad → supabase.auth.getUser)
  api/public/oauth/    retours OAuth Shopify · Meta · Google
  api/internal/jobs/   tick planifié
src/lib/               60 modules ; *.server.ts = serveur, *.functions.ts = server fn
src/lib/connectors/    23 modules ; par source : *-observe.ts (PUR) + *-observe.server.ts (réseau)
src/components/        écrans ; ui/ = primitives shadcn
supabase/migrations/   18 migrations, horodatées
tests/                 64 suites, harnais maison (pas de Vitest — délibéré)
tests/navigateur/      sondes Playwright, hors `npm test`
```

**Règle de séparation** : tout calcul est dans un module PUR ; les `.server.ts`
ne font que chercher sur le réseau. C'est ce qui rend le moteur testable.

## Commandes

```
npm test        # 64 suites, ~16 700 contrôles — DOIT être vert avant tout push
npm run typecheck
npm run lint
npm run build
npm run dev     # ajouter --host 127.0.0.1 (bind :: échoue ici)
```

`tests/expected.ts` liste chaque suite avec un **plancher de contrôles**. Une
suite absente ou amaigrie fait échouer la CI. Ajouter des contrôles → relever le
plancher. L'abaisser doit être visible en revue.

Sondes navigateur (serveur de dev requis, backend simulé par
`tests/navigateur/harness.mjs`) : `debordement` · `fuites` · `a11y` ·
`lecture-partielle` · `echec-audit` · `shoot`.
**Les fixtures du harnais dérivent** : vérifier un nom de colonne contre
`src/integrations/supabase/types.ts` AVANT de conclure à un défaut. Plusieurs
faux défauts ont déjà coûté du temps ainsi. Les boutons radio « sans nom
accessible » sont un faux positif connu (nommés par `<label for>`).

## Base de données

Tables : `stores` · `audits` · `audit_findings` · `actions` · `action_results` ·
`data_connections` · `data_snapshots` · `fix_attempts` · `fix_outcomes` ·
`profiles` · `subscriptions` · `usage` · `goals` · `tasks` · `notifications` ·
`coach_conversations` · `coach_messages`.

L'appartenance est portée par `stores.owner_id`. Tout le reste s'y rattache par
`store_id`.

### Sécurité — jamais contourner

- RLS sur toutes les tables marchand. Le navigateur ne voit que ses boutiques.
- `data_connections` a des droits **colonne par colonne**
  (`GRANT SELECT (...) ON public.data_connections`). Les colonnes
  `access_token_ciphertext` / `refresh_token_ciphertext` ne sont **jamais**
  accordées au navigateur.
- **Postgres refuse la requête ENTIÈRE si une seule colonne demandée n'est pas
  accordée (42501).** Un oubli n'affaiblit pas la lecture, il l'annule.
  → Ajouter une colonne au `.select()` du navigateur impose une migration
  `GRANT`. Couvert par `tests/integrations/shopify-connecte.test.ts`.
- `supabaseAdmin` (rôle de service) **contourne RLS et les droits de colonne**.
  Partout où il est utilisé, vérifier l'appartenance à la main
  (`.select("store_id, stores(owner_id)")` puis comparaison au `userId`).
  Couvert par `tests/security/rls.test.ts`.
- Jetons partenaires chiffrés AES-256-GCM (`crypto.server.ts`,
  `DATA_CONNECTIONS_ENCRYPTION_KEY`).
- État OAuth signé HMAC, **valable 15 minutes** (`OAUTH_STATE_SECRET`). Il
  transporte `{userId, storeId, provider}` : c'est la seule chose qui empêche
  d'attacher un compte à la boutique d'autrui.

## Authentification et OAuth

Supabase GoTrue, session en `localStorage` (`sb-<ref>-auth-token`).
`_authenticated/route.tsx` valide le jeton par le RÉSEAU dans `beforeLoad` →
`pendingComponent` obligatoire (`pendingMs: 300`).

Les trois retours OAuth partagent **`src/lib/oauth-page.server.ts`**
(`page` / `errorBody` / `successBody` / `escapeHtml`).
Règles absolues, chacune née d'un défaut réel :

- Tout texte étranger (paramètre d'URL, réponse fournisseur, message interne)
  entre par `errorBody` / `successBody`, qui échappent. **Jamais de
  concaténation directe dans le HTML** — une injection joignable sans compte a
  déjà existé sur Meta et Google.
- Aucun retour ne refabrique sa propre page : pas de `<!doctype html>` local,
  pas de `function htmlResponse` locale. Un alias qui délègue à `page()` pour
  fixer le titre d'onglet est la forme attendue. C'est la divergence de trois
  copies indépendantes qui avait produit la faille.
- Redirection par `<meta http-equiv="refresh">` + lien cliquable, **jamais par
  `<script>`** (bloqué = page morte).
- Chaque page d'erreur porte un chemin de sortie.
- `if (error) throw error` sur un upsert Supabase est **interdit** : une
  PostgrestError est un objet nu, `String(err)` rend `[object Object]`.
- Le drapeau `écritureTentée` distingue « rien n'a été enregistré » de « issue
  inconnue ». Ne jamais promettre le premier après le début de l'écriture.

Couvert par `tests/security/pages-oauth.test.ts`.

## Intégrations

**Shopify** — API Admin `2026-01`, fenêtre 30 j. Permissions dans
`shopify-scopes.ts` (réduire la liste force une réinstallation chez tous les
marchands connectés). L'entonnoir passe par **ShopifyQL** (GraphQL,
`read_analytics`), seuil `MIN_SESSIONS_FOR_RATE = 100` sous lequel aucun taux
n'est publié. `read_checkouts` n'est **pas** demandée : les paniers abandonnés
peuvent rester illisibles.

**Meta Ads / Google Ads** — OAuth, comptes stockés dans
`data_connections.metadata`. `defaultAccount()` choisit le premier compte
**actif**, jamais `accounts[0]`.

**Cloudflare** — `wrangler.toml` porte les variables non secrètes ; les secrets
sont provisionnés par le déploiement. Cron `* * * * *` → `runJobsTick`.

**GitHub** — CI (tests, typage/style, build) puis `workflow_run` → Déploiement.
Le déploiement applique les migrations, vérifie que les modèles répondent, et
contrôle `/` et `/auth`. Le CLI Supabase est téléchargé depuis la publication
GitHub, **jamais par npm** (dépendance optionnelle silencieusement absente → a
cassé la production).

## Moteur d'audit

`audit-runner.server.ts` orchestre, mais ne calcule rien lui-même.

1. `loadChannelCredentials` (rôle de service).
2. Collecte par source, **chacune dans son propre try/catch** : une source qui
   tombe n'emporte pas les autres. Un échec produit un `SourceReport`
   `reachable: false` — **jamais des compteurs à zéro**.
3. `allGaps(reports)` → **écrit dans `audits.data_gaps` AVANT l'appel au
   modèle**. C'est ce qui fait survivre les manques de collecte à un échec du
   fournisseur. Ne jamais déplacer après.
4. Moteur de règles déterministe, croisements, entonnoir, audience.
5. Appel au modèle, sortie contrainte par `tool_choice` forcé.
6. `applyHistory`, écriture des constats.

File d'attente : `MAX_ATTEMPTS = 3`, état dans `audits.input_snapshot.job`.
Le message technique brut va dans `audits.error_message`, **non tronqué** —
c'est là qu'on lit la cause exacte d'un échec réel.

## Fournisseur IA

`ai-gateway.server.ts`. Protocole OpenAI (`POST /chat/completions`).
Configuration : `AI_BASE_URL` · `AI_API_KEY` · `AI_AUDIT_MODEL` ·
`AI_FIX_MODEL` · `AI_AUDIT_FALLBACK_MODEL`.

`aiChatCompletionAvecSecours(role, corpsPour)` : un seul constructeur de corps
pour les deux appels — **même prompt, même schéma, même outil forcé, seul le nom
du modèle change**. Un repli qui relâcherait le schéma produirait un diagnostic
d'une autre nature que rien ne distinguerait du premier.

`meriteUnSecours` : oui sur 429 / 404 / 5xx. **Non** sur 401/403 (c'est la clé)
et 400/413/422 (c'est notre demande — un modèle plus permissif l'accepterait à
moitié).

Quotas Google gratuits comptés **par modèle et par jour** — d'où l'utilité d'un
second modèle. Le secours vient de la configuration, jamais du code : ce fichier
ne peut pas savoir quels modèles la clé du jour autorise.

### Classification des échecs (`audit-errors.ts`)

La SOURCE avant la nature : le préfixe `AI Gateway <code>` est écrit par nous et
n'est pas fabricable depuis un corps de réponse. Les règles générales ne
s'appliquent qu'ensuite.

| Signal | Genre |
| --- | --- |
| 429 + `RESOURCE_EXHAUSTED`/`free_tier`/`PerDay` | `quota_fournisseur` |
| 429 autre | `modele_surcharge` |
| 413 / 422 | `requete_invalide` (notre faute) |
| 408 | `delai_depasse` |
| 401 / 403 / 402 | `configuration_ia` |
| 400 / 404 | `modele_indisponible` |
| 5xx | `modele_en_panne` |
| code inattendu | `inconnu` — **jamais** un diagnostic emprunté |

Ne jamais ajouter de `return` attrape-tout qui affirme une cause. Un code jamais
vu se dit « nous ne savons pas ».

## Rédaction produit

- **Vouvoiement partout.** Vérifié par `tests/ui/voice.test.ts` (~11 000
  contrôles). Un consultant vouvoie.
- Court, direct, orienté bénéfice. Chaque écran répond à : qu'est-ce que je
  regarde, pourquoi c'est important, que dois-je faire maintenant.
- **Aucun jargon** au marchand : liste `JARGON` dans `plain-language.ts`. Aucun
  nom de variable d'environnement, aucun code HTTP, aucune réponse brute de
  fournisseur. Ces éléments vont au journal, où ils servent.
- **Ne jamais demander une action impossible** (modifier un secret, une config
  serveur, l'app partenaire).
- Tout message d'échec répond à DEUX questions : est-ce chez moi ou chez eux, et
  que fais-je maintenant. `whose: "nous" | "vous" | "partenaire"`.
- Ne pas envoyer rebrancher une connexion valable — c'est l'erreur symétrique de
  ne rien dire.

## Données manquantes, hypothèses, preuves

Règles non négociables — c'est le cœur du produit.

- Une donnée absente **n'est jamais** remplacée par une estimation présentée
  comme un fait, ni par un zéro. « Non mesuré » ≠ « nul ».
- Chaque constat porte son `evidence` (`based_on` + `assumptions`), affiché.
  Ce qui n'est pas mesuré est dit non mesuré, au même endroit.
- Un taux n'est publié que si le dénominateur porte assez de volume.
- Chaque manque nomme sa **cause classée**
  (`SourceFailureCause` : `autorisation_invalide` · `quota_depasse` ·
  `fournisseur_en_panne` · `injoignable`) et à qui revient la suite.
- Ordre d'un constat à l'écran : **problème → impact → preuve → action**.
- Une écriture dont l'issue est inconnue n'est jamais rejouée seule.

## Interface

Système visuel dans `src/styles.css` (jetons uniquement — ne pas coder de
couleur en dur dans un composant).

- Clair, papier crème, cartes blanches, bordures **opaques** (une bordure en
  alpha disparaît sur fond blanc).
- **La couleur porte un sens** : vert = argent récupérable, orange = urgent.
  Rien d'autre n'est coloré.
- Le montant récupérable (`.montant`) a la **même taille sur tous les écrans**.
- Typo : Bricolage Grotesque (titres) · Public Sans (texte) · Instrument Serif
  (rapport).
- Cibles tactiles ≥ 44 px. Focus 2 px avec décalage.
- Aucun débordement horizontal de 320 à 1440 px. `truncate` exige `min-w-0` sur
  le parent flexible.
- Un texte écrit par le modèle (verdict) a une taille **responsive** : sa
  longueur n'est pas sous notre contrôle.

### États — la classe de défaut la plus coûteuse

`xQ.data ?? []` transforme un **échec de lecture** en liste vide, et une liste
vide a un SENS (« rien à afficher »). Toute requête repliée ainsi doit consulter
son `isError` et afficher un `ErrorState` distinct. Vérifié pour tous les écrans
par `tests/ui/etats-de-chargement.test.ts`.

Trois états distincts, toujours : **chargement** ≠ **échec** ≠ **vide**.
`.single()` lève sur zéro ligne (406) → utiliser `.maybeSingle()`, sinon une
absence réelle s'affiche comme une panne.

## Pièges déjà payés

- Une jointure PostgREST (`stores(...)`) rend `null` dès que la ligne n'est pas
  visible. Ne jamais caster : `(audit.stores as {...} | undefined)?.x`.
- Les colonnes JSON (`evidence`, `funnel`, `data_gaps`) sont un contrat, pas une
  garantie : lire défensivement.
- Un test qui épingle une classe CSS ou une phrase au caractère près casse au
  premier remaniement sans qu'aucune règle n'ait bougé. Vérifier la **règle**.
- Un test qui compare des `indexOf` doit viser l'APPEL, pas la ligne d'import du
  même nom (`lastIndexOf`). Un `indexOf` qui rend −1 fait passer le contrôle à
  l'envers.
- Le formateur répartit le texte JSX sur plusieurs lignes : normaliser les
  espaces avant de chercher une phrase dans une source.
- La typographie française met une espace avant `:` et `;` — attention aux
  balayages de ponctuation.

## Environnement de travail

L'egress sortant est **bloqué** (production, Supabase, Shopify injoignables). Le
parcours réel ne peut pas être exécuté ici : le dire plainement plutôt que de
simuler. Les rendus Playwright utilisent un backend simulé et **ne valent pas**
un test réel.

Ne jamais écrire d'identifiant, de jeton ou de clé dans le code, les commits,
les tests ou les journaux.
