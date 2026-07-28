# Plan EcomPilot AI

## Cible n°1
**Débutants en e-commerce** qui ont lancé une boutique (souvent Shopify) mais qui :
- N'arrivent pas à générer de ventes ou à convertir le trafic qu'ils paient.
- Ne comprennent pas *pourquoi* ça ne fonctionne pas.
- N'ont ni consultant, ni compétences techniques, ni temps d'analyser des tableaux de bord.

L'app doit donc parler comme un mentor bienveillant, pas comme un outil d'analytics. Chaque diagnostic est expliqué en français simple, avec un exemple concret et une action à faire *aujourd'hui*.

Cible secondaire : consultants / agences qui gèrent plusieurs boutiques (mode multi-clients conservé pour plus tard, mais l'UX par défaut est mono-boutique).

## Promesse produit
"Connecte ta boutique. En 2 minutes, EcomPilot AI te dit **pourquoi tu ne vends pas** et **quoi corriger en premier** pour gagner de l'argent."

## Structure imposée de chaque audit
1. **SCORE GLOBAL** (0-100) avec verdict en une phrase.
2. **PROBLÈMES CRITIQUES** : 3 à 5 blocages majeurs, langage débutant.
3. **CAUSE RACINE** : pourquoi ça arrive (souvent : mauvais produit, offre floue, prix, page produit, tunnel, tracking, ciblage pub).
4. **PLAN D'ACTION** : étapes classées par impact, chacune avec une case "à faire aujourd'hui / cette semaine / ce mois".
5. **GAINS ESTIMÉS** : euros/mois potentiels après correction (fourchette réaliste).
6. **CORRECTIONS AUTOMATIQUES** : textes prêts à copier (fiches produit, titres pubs, emails de relance panier, structure d'offre).

## Fonctionnalités clés

### 1. Onboarding ultra-simple
- Demande : nom de la boutique, URL, niche, budget pub mensuel, chiffre d'affaires actuel, objectif.
- Pas de jargon. Le mot "audit" est expliqué.

### 2. Connexion des sources (optionnelle, progressive)
- Shopify (obligatoire pour l'audit boutique).
- Meta Ads, Google Ads, Google Analytics 4 (optionnelles — activent des sections supplémentaires).
- Si aucune source pub : l'audit se base uniquement sur la boutique + l'URL publique (scraping léger des pages produit, vitesse, mobile, prix, avis).

### 3. Audit "premier lancement" sans connexion
Pour un vrai débutant qui n'a pas encore de trafic payant :
- Analyse de l'URL du site (vitesse mobile, clarté offre, page produit, structure, panier, checkout).
- Analyse manuelle guidée : questions type "combien de visiteurs par jour ?", "combien de ventes cette semaine ?".
- L'IA compare aux benchmarks de la niche et sort un diagnostic.

### 4. Audit complet avec connexions
Quand les connecteurs sont branchés :
- Tunnel de conversion (visiteurs → panier → checkout → paiement).
- Rentabilité pub (ROAS, CAC, marge après pub).
- Produits qui tuent la marge, produits sous-exploités.
- Emails/SMS manquants (relance panier, welcome, post-achat).

### 5. Corrections auto générées par l'IA
- Réécriture de fiche produit (titre, bullets bénéfices, description, FAQ).
- Titres et accroches publicitaires.
- Objets d'emails de relance panier + corps du mail.
- Structure d'offre (bundle, garantie, urgence).
- Script d'appel à l'action.

### 6. Suivi de progression
- Chaque recommandation peut être marquée "à faire / en cours / fait".
- Nouvel audit → l'app compare avec le précédent et félicite les progrès.

## Architecture technique

### Backend (Lovable Cloud)
- Auth email/mot de passe + Google (défaut).
- PostgreSQL avec RLS strict.
- TanStack Start `createServerFn` pour toute la logique.
- Lovable AI Gateway (`google/gemini-2.5-pro` pour l'analyse, `google/gemini-2.5-flash` pour les corrections rapides).
- App User Connectors pour Shopify, Meta Ads, Google Ads, GA4.

### Base de données
1. **profiles** — user_id, full_name, avatar, experience_level (`debutant`, `intermediaire`, `avance`), created_at.
2. **stores** — id, owner_id, name, url, niche, monthly_ad_budget, monthly_revenue, goal, created_at.
3. **store_members** — pour le mode multi-clients (consultants).
4. **data_connections** — id, store_id, provider, status.
5. **audits** — id, store_id, created_by, status, score, verdict, metadata, created_at.
6. **audit_findings** — id, audit_id, category, severity, title, root_cause, impact_description, estimated_gain_min, estimated_gain_max, action_steps (JSON), auto_correction (JSON), timeframe (`today`, `this_week`, `this_month`), status.
7. **app_user_connections** — clés OAuth chiffrées (standard Lovable).

### Frontend
- TanStack Router + React 19 + Tailwind v4 + shadcn/ui.
- Design system sombre premium, ton mentor/coach.
- Composants clés : score circulaire animé, cartes "problème → action → gain", boutons "Copier la correction", cases "à faire aujourd'hui".

## Pages

- `/` — landing publique orientée débutants : "Tu ne vends pas ? Découvre pourquoi en 2 minutes."
- `/auth` — signup/login.
- `/oauth/:provider/return` — callback OAuth.
- `/_authenticated/onboarding` — création de la boutique.
- `/_authenticated/dashboard` — vue boutique(s) + dernier audit + score.
- `/_authenticated/stores/$storeId` — détail boutique, connexions, historique audits, bouton "Lancer un nouvel audit".
- `/_authenticated/audits/$auditId` — rapport structuré (les 6 sections).
- `/_authenticated/settings` — profil.

## Moteur d'audit IA

Server function `runAudit({ storeId })` :
1. Récupère les données de la boutique (formulaire + données connectées + scrape léger de l'URL si possible).
2. Construit un prompt système EcomPilot avec :
   - Rôle : "directeur e-commerce senior, ton bienveillant pour débutants".
   - Structure imposée en 6 sections.
   - Interdiction du jargon analyste.
   - Obligation de chiffrer les gains.
3. Appelle Lovable AI Gateway avec `Output.object` pour structurer la sortie.
4. Insère audit + findings.

## Ton et copywriting
- Tutoiement.
- Analogies concrètes ("c'est comme une boutique physique avec la porte fermée").
- Zéro anglicisme non expliqué (CAC → "coût pour gagner 1 client").
- Encouragement systématique : "Bonne nouvelle : c'est réparable rapidement."

## Design
- Sombre premium, fond bleu nuit `#0B0F1E`.
- Accents : vert croissance `#22c55e`, orange alerte `#f97316`, cyan confiance `#06b6d4`.
- Typo moderne (Space Grotesk / Inter).
- Micro-animations sur le score et les cartes.
- Aucun toggle light/dark.

## SEO
- Titre : "EcomPilot AI — Découvre pourquoi ta boutique ne vend pas"
- Description : "L'IA qui audite ta boutique Shopify et te dit exactement quoi corriger pour enfin vendre. Diagnostic en 2 minutes."
- Sitemap + robots.txt.

## Livraison par phases

### Phase 1 — Fondations (livrée d'un bloc)
- Design system.
- Auth email + Google.
- Migrations DB (profiles, stores, audits, findings, connections).
- Landing page orientée débutants.
- Onboarding.
- Dashboard.

### Phase 2 — Audit "démarrage" sans connecteurs
- Formulaire de diagnostic guidé.
- Server function `runAudit` avec Lovable AI Gateway et sortie structurée en 6 sections.
- Page rapport d'audit complète.
- Système de progression (à faire / fait).

### Phase 3 — Connexion Shopify
- Configuration App User Connector Shopify.
- Récupération produits, commandes, sessions.
- Audit enrichi.

### Phase 4 — Connexions publicitaires
- Meta Ads + Google Ads + GA4.
- Sections rentabilité pub, tunnel de conversion.

### Phase 5 — Corrections auto
- Réécriture fiche produit.
- Générateur d'emails de relance panier.
- Générateur d'accroches pubs.

### Phase 6 — Finitions
- Sitemap, robots, méta.
- Publication.

## Notes
- Le mode multi-clients (consultants) reste possible via `store_members` mais n'est pas la surface principale — un utilisateur "débutant" ne voit qu'une seule boutique par défaut.
- Toutes les clés API restent server-side.
- Les appels IA passent par Lovable AI Gateway, aucune clé à demander à l'utilisateur.