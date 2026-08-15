# Reconnexion Shopify après changement de clé de chiffrement

**Procédure prête, non exécutée.** À dérouler seulement quand le Worker Cloudflare
sert réellement l'application. Tant que la production tourne sur l'ancien
hébergeur, il ne faut rien toucher : elle possède l'ancienne clé et fonctionne.

---

## Pourquoi cette procédure existe

`DATA_CONNECTIONS_ENCRYPTION_KEY` chiffre les jetons partenaires stockés dans
`data_connections` (AES-256-GCM). Sa valeur d'origine vit dans l'environnement de
l'ancien hébergeur et n'est récupérable par aucun accès automatisable :

- aucun outil de la plateforme n'expose les variables d'environnement ;
- le coffre-fort Supabase (`vault.secrets`) est vide ;
- le projet Supabase appartient à l'organisation de la plateforme, sans accès
  direct à son tableau de bord.

Le déploiement génère donc une nouvelle clé (voir `deploy.yml`, étape
« Générer les secrets qui peuvent l'être »). Conséquence, et **elle est unique** :
le jeton Shopify déjà enregistré devient illisible pour le nouveau Worker.

## Ce qui n'est PAS affecté

Rien d'autre. La clé ne protège que la colonne des jetons.

|                                               |                                                  |
| --------------------------------------------- | ------------------------------------------------ |
| Boutiques, audits, résultats, profils, quotas | intacts, en clair                                |
| Politiques RLS et droits                      | intacts                                          |
| Historique des migrations                     | intact                                           |
| Compte Shopify et ses données                 | intacts — l'app est réautorisée, pas réinstallée |

**Aucune donnée n'est supprimée. Une seule autorisation est refaite.**

---

## Procédure

### 1. Vérifier d'abord que le Worker fonctionne

Inutile de reconnecter quoi que ce soit sur un déploiement qui ne répond pas.

```sh
curl -si https://<domaine-du-worker>/ | head -1        # attendu : HTTP/2 200
curl -si https://<domaine-du-worker>/auth | head -1    # attendu : HTTP/2 200
```

Puis connectez-vous à l'application et vérifiez que le tableau de bord charge —
c'est la preuve que `SUPABASE_SERVICE_ROLE_KEY` est bonne.

### 2. Marquer la connexion comme expirée

Une seule ligne change d'état. Aucune suppression.

```sql
update public.data_connections
   set status = 'expired',
       last_error = 'Clé de chiffrement renouvelée lors de la migration — reconnexion requise'
 where provider = 'shopify'
   and account_id = 'ecom-pilot-test.myshopify.com';
```

Le jeton chiffré reste en base. S'il fallait revenir en arrière, remettre
`status = 'active'` suffit — à condition d'avoir aussi remis l'ancienne clé.

### 3. Reconnecter depuis l'application

Ouvrir la boutique dans l'application, puis « Connecter Shopify ». Le parcours
habituel s'exécute : autorisation, échange du code, relevé des permissions,
chiffrement du nouveau jeton **avec la nouvelle clé**.

Prérequis, à vérifier avant de cliquer :

- `SHOPIFY_CLIENT_ID` et `SHOPIFY_CLIENT_SECRET` renseignés (Shopify Partner
  Dashboard → votre app → **Client credentials**) ;
- l'URL de redirection du nouveau domaine **ajoutée** dans l'app Shopify —
  ajoutée, pas substituée, tant que l'ancien domaine sert encore.

### 4. Contrôler

```sql
select provider, status, account_id,
       connected_at,
       length(access_token_ciphertext) as longueur_chiffre,
       last_error
  from public.data_connections
 where provider = 'shopify';
```

Attendu : `status = 'active'`, `connected_at` récent, `last_error` nul.
Longueur du chiffré : 88 caractères pour un jeton Shopify standard
(12 octets d'IV + 16 de marqueur + 38 de jeton, en base64).

Puis lancer un audit depuis l'application : il exerce réellement le
déchiffrement du jeton et l'appel à l'API Shopify.

---

## Si l'ancienne clé réapparaît

Elle reste prioritaire. La renseigner dans les secrets du dépôt GitHub
(`DATA_CONNECTIONS_ENCRYPTION_KEY`) suffit : le déploiement l'écrase sur le
Worker, la règle est « valeur fournie > valeur déjà posée > génération ». Aucune
reconnexion n'est alors nécessaire, et cette procédure devient sans objet.
