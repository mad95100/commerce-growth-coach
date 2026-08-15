# Déploiement d'EcomPilot AI

Chaîne cible : **Claude Code → GitHub → GitHub Actions → Cloudflare Workers → Supabase.**

Le dépôt sait désormais se construire, se tester et se déployer seul. Ce document
décrit ce qui reste à renseigner à la main — parce que cela demande des comptes
et des identifiants qu'aucun automatisme ne peut créer à votre place.

---

## 1. Ce qui tourne où

Frontend, backend et fonctions serveur sont **un seul artefact** : un worker
Cloudflare produit par Nitro dans `.output/`. Il n'y a pas de service séparé.

| Brique                     | Où                                          |
| -------------------------- | ------------------------------------------- |
| Rendu serveur + API + jobs | Cloudflare Workers (`wrangler.toml`)        |
| Base de données            | Supabase PostgreSQL, RLS sur 16 tables      |
| Fichiers statiques         | Workers Assets (`.output/public`)           |
| Travaux planifiés          | Cron Trigger, toutes les minutes            |
| Journaux                   | Workers Logs (`[observability] enabled`)    |
| CI                         | `.github/workflows/ci.yml`                  |
| Déploiement                | `.github/workflows/deploy.yml`              |

---

## 2. Secrets à renseigner

**Aucun secret ne doit être écrit dans le dépôt.** `.env` est versionné et ne
contient que les valeurs publiques de Supabase ; la CI échoue si un secret y
apparaît.

### 2.1 À l'exécution — Cloudflare

```sh
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put DATA_CONNECTIONS_ENCRYPTION_KEY
wrangler secret put OAUTH_STATE_SECRET
wrangler secret put SHOPIFY_CLIENT_ID
wrangler secret put SHOPIFY_CLIENT_SECRET
wrangler secret put AI_API_KEY
wrangler secret put JOBS_TICK_SECRET
# Facultatifs, selon les canaux activés :
wrangler secret put META_CLIENT_ID
wrangler secret put META_CLIENT_SECRET
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GOOGLE_ADS_DEVELOPER_TOKEN
```

`SUPABASE_URL` et `SUPABASE_PUBLISHABLE_KEY` sont publiques : ajoutez-les dans
`[vars]` de `wrangler.toml`, ou en secrets si vous préférez.

> ### ⚠️ `DATA_CONNECTIONS_ENCRYPTION_KEY` — à reporter à l'identique
>
> Cette clé déchiffre les jetons Shopify, Meta et Google déjà enregistrés en
> base (AES-256-GCM). **Une valeur différente rend tous les jetons existants
> illisibles** et impose une reconnexion de chaque boutique.
>
> Elle ne doit donc pas être régénérée, mais recopiée depuis l'environnement
> actuel. Si elle n'y est pas lisible, voir §6.

### 2.2 En CI — secrets du dépôt GitHub

`Settings → Secrets and variables → Actions`

| Secret                   | Rôle                                          |
| ------------------------ | --------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`   | Déploiement. Gabarit « Edit Cloudflare Workers » |
| `CLOUDFLARE_ACCOUNT_ID`  | Compte cible                                  |
| `SUPABASE_ACCESS_TOKEN`  | Migrations. Facultatif : l'étape est sautée sans lui |
| `SUPABASE_DB_PASSWORD`   | Migrations                                    |

Variables (`Actions → Variables`) :

| Variable                  | Rôle                                            |
| ------------------------- | ----------------------------------------------- |
| `SUPABASE_PROJECT_ID`     | Référence du projet, pour `supabase link`       |
| `DEPLOY_HEALTHCHECK_URL`  | URL testée après déploiement. Sans elle, le contrôle est sauté |

---

## 3. Développement local

```sh
bun install
bun run dev          # Vite, port 8080
bun run build        # produit .output/
bun run preview      # wrangler dev — le worker réel, pas Vite
bun run test         # 1217 contrôles, 23 suites
bun run typecheck
bun run lint
```

Pour les secrets en local, créez `.env.local` (ignoré par git). **`wrangler` lit
`.env` et `.env.local`, pas `.dev.vars`.**

### Déclencher le cron en local

Le cron ne part pas tout seul en développement :

```sh
curl "http://localhost:8787/cdn-cgi/local/scheduled"
```

---

## 4. Travaux planifiés

Un audit n'a plus besoin d'un onglet ouvert pour progresser.

- **Déclencheur normal** : Cron Trigger Cloudflare, chaque minute
  (`[triggers]` dans `wrangler.toml` → `src/nitro/scheduled.ts`).
- **Déclencheur de secours** : `POST /api/internal/jobs/tick`, protégé par
  `JOBS_TICK_SECRET`.

```sh
curl -X POST https://<domaine>/api/internal/jobs/tick \
     -H "x-jobs-secret: $JOBS_TICK_SECRET"
```

Trois audits au plus par passage. La réclamation reste atomique : deux
déclencheurs simultanés ne produisent jamais deux exécutions du même audit.

---

## 5. Migrations Supabase

`deploy.yml` exécute `supabase db push` après un déploiement réussi.

`db push` n'applique **que** les migrations absentes de
`supabase_migrations.schema_migrations`. Il ne recrée rien, ne supprime rien et
ne touche à aucune donnée.

**Avant la première exécution automatisée**, vérifiez que l'historique local
correspond à ce que la base a déjà appliqué :

```sh
supabase link --project-ref <ref>
supabase migration list      # compare local et distant
```

Une migration rejouée sur le durcissement RLS réexécuterait des `REVOKE` et des
`GRANT`. Faites une sauvegarde avant le premier `push` automatisé.

---

## 6. Bascule de domaine, sans interruption

Le `redirect_uri` OAuth doit correspondre au caractère près à une URL déclarée
chez le partenaire. La règle qui rend l'opération sûre : **ajouter d'abord,
retirer ensuite.**

1. Attacher le domaine au worker (Cloudflare → Workers → Custom Domains).
2. **Ajouter** — sans retirer l'existante — l'URL de redirection dans l'app
   Shopify, l'app Meta et le client OAuth Google :
   `https://<domaine>/api/public/oauth/{shopify,meta,google}/callback`
3. Passer `APP_URL` dans `wrangler.toml` sur le nouveau domaine, déployer.
4. Vérifier une connexion Shopify réelle sur une boutique de test.
5. Ne retirer l'ancienne URL qu'après une période d'observation.

Les connexions **déjà actives ne sont pas concernées** : un jeton obtenu ne
dépend plus du `redirect_uri`, qui n'intervient qu'au moment de l'autorisation.

### Si la clé de chiffrement n'est pas récupérable

Le déchiffrement des jetons existants est perdu. Marche à suivre :

1. Générer une nouvelle clé : `openssl rand -base64 32`.
2. La renseigner par `wrangler secret put DATA_CONNECTIONS_ENCRYPTION_KEY`.
3. Passer les connexions concernées en `status = 'expired'` pour que
   l'interface propose la reconnexion.
4. Reconnecter chaque boutique depuis l'application.

Le coût de cette opération croît avec le nombre de marchands connectés : c'est
la raison de la faire tôt.

---

## 7. Ce qui dépend encore de l'ancien hébergeur

Deux replis transitoires, atteints **uniquement** si la configuration
correspondante manque. `wrangler.toml` renseigne les deux, ils sont donc
inatteignables sur la nouvelle infrastructure — vérifié par
`tests/infra/no-lovable.test.ts`.

| Constante         | Fichier                            | Neutralisée par |
| ----------------- | ---------------------------------- | --------------- |
| `LEGACY_ORIGIN`   | `src/lib/public-origin.server.ts`  | `APP_URL`       |
| `LEGACY_BASE_URL` | `src/lib/ai-gateway.server.ts`     | `AI_BASE_URL`   |

**À supprimer à la coupure définitive**, avec les entrées `ALLOWED` du test, le
bloc `LOVABLE:BEGIN/END` d'`AGENTS.md` et la section correspondante du `README`.
Le test échouera tant que ce ménage ne sera pas cohérent — c'est le rappel voulu.

---

## 8. Webhooks Shopify

Le socle est en place (`src/routes/api/public/webhooks/shopify/$topic.ts`) :
signature vérifiée sur le corps brut, acquittement immédiat. **Aucun sujet n'est
abonné** — Shopify n'envoie donc rien, et la route est sans effet tant qu'on ne
l'active pas.

À brancher dans le chantier produit : `app/uninstalled`, puis `shop/redact`,
`customers/redact` et `customers/data_request`, obligatoires pour publier sur
l'App Store Shopify.
