-- Durcissement des accès directs depuis le navigateur.
--
-- Toutes les tables sont exposées au client par PostgREST. Les politiques
-- existantes cantonnent bien chaque utilisateur à ses propres lignes — aucune
-- fuite entre comptes n'a été trouvée — mais elles lui accordent l'écriture sur
-- des tables qui ne sont pas les siennes à écrire, et la lecture de colonnes
-- qui ne devraient jamais quitter le serveur.
--
-- Cette migration ne retire aucun accès dont l'application se sert depuis le
-- navigateur. Les écritures concernées sont toutes émises par des fonctions
-- serveur, qui basculent sur le rôle de service dans le même changement.

-- ---------------------------------------------------------------------------
-- 1. data_connections : les jetons partenaires ne doivent jamais être servis
-- ---------------------------------------------------------------------------
-- La table portait `GRANT SELECT` sur TOUTES ses colonnes, dont
-- `access_token_ciphertext` et `refresh_token_ciphertext`. N'importe quel
-- utilisateur connecté pouvait donc récupérer le jeton chiffré de ses propres
-- connexions Shopify, Meta et Google depuis son navigateur.
--
-- Le chiffrement n'excuse pas l'exposition : il protège la base en cas de fuite,
-- pas contre la distribution volontaire du chiffré à un client. Servir le
-- chiffré, c'est offrir une cible hors ligne à qui obtiendrait la clé par
-- ailleurs.
--
-- L'application n'a besoin, côté navigateur, que de savoir QUE la connexion
-- existe et dans quel état elle est : c'est exactement ce que lit
-- `ConnectionsPanel`. Le droit de lecture est donc redonné colonne par colonne,
-- en laissant les deux colonnes de jetons hors de la liste.
REVOKE ALL ON public.data_connections FROM authenticated;
GRANT SELECT (
  id,
  store_id,
  provider,
  status,
  account_id,
  account_label,
  scope,
  connected_at,
  expires_at,
  last_error,
  created_at,
  updated_at
) ON public.data_connections TO authenticated;

DROP POLICY IF EXISTS "data_connections_owner_all" ON public.data_connections;
CREATE POLICY data_connections_select_own ON public.data_connections
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.owner_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. actions : journal des écritures automatiques, écrit par le serveur seul
-- ---------------------------------------------------------------------------
-- C'est le défaut structurel principal. La table enregistre ce que l'IA
-- s'apprête à faire, puis ce qu'elle a fait, avec l'état avant et après. Avec
-- `GRANT INSERT, UPDATE, DELETE`, un utilisateur pouvait depuis son navigateur :
--   - fabriquer une proposition de toutes pièces, avec les arguments de son
--     choix, puis la faire exécuter en la confirmant ;
--   - basculer une action en `applied` sans qu'elle ait jamais été exécutée ;
--   - réécrire `before_value` pour tromper la vérification de fraîcheur ;
--   - effacer la trace d'une action appliquée.
--
-- Un journal que son sujet peut réécrire ne prouve rien. La lecture reste
-- ouverte : l'utilisateur doit voir ses propres actions.
REVOKE INSERT, UPDATE, DELETE ON public.actions FROM authenticated;

DROP POLICY IF EXISTS actions_owner_all ON public.actions;
CREATE POLICY actions_select_own ON public.actions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.owner_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. action_results : résultat constaté d'une action, même raisonnement
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.action_results FROM authenticated;

DROP POLICY IF EXISTS action_results_owner_all ON public.action_results;
CREATE POLICY action_results_select_own ON public.action_results
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.actions a
      JOIN public.stores s ON s.id = a.store_id
      WHERE a.id = action_id AND s.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 4. fix_outcomes : mesure avant/après d'une correction
-- ---------------------------------------------------------------------------
-- Sert à dire si les gains annoncés se matérialisent. Écrit uniquement par le
-- serveur, à partir de mesures relevées chez les partenaires. Laisser le client
-- l'écrire permettrait de se fabriquer des résultats flatteurs.
REVOKE INSERT, UPDATE, DELETE ON public.fix_outcomes FROM authenticated;

DROP POLICY IF EXISTS fix_outcomes_owner_all ON public.fix_outcomes;
CREATE POLICY fix_outcomes_select_own ON public.fix_outcomes
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.owner_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. data_snapshots : mesures relevées chez les partenaires
-- ---------------------------------------------------------------------------
-- Ces chiffres nourrissent l'audit et le suivi. Les laisser modifiables par le
-- client, c'est laisser choisir les données sur lesquelles l'IA raisonne.
REVOKE INSERT, UPDATE, DELETE ON public.data_snapshots FROM authenticated;

DROP POLICY IF EXISTS snapshots_owner_all ON public.data_snapshots;
CREATE POLICY data_snapshots_select_own ON public.data_snapshots
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.owner_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 6. profiles : suppression jamais prévue
-- ---------------------------------------------------------------------------
-- Le droit DELETE était accordé sans qu'aucune politique ne l'autorise : il
-- était donc déjà sans effet. On le retire pour que le droit accordé décrive
-- l'intention, plutôt que de compter sur l'absence de politique.
REVOKE DELETE ON public.profiles FROM authenticated;

-- ---------------------------------------------------------------------------
-- Non modifié, et pourquoi
-- ---------------------------------------------------------------------------
-- `subscriptions` et `usage` n'accordaient déjà que SELECT : les quotas
-- n'étaient pas contournables depuis le navigateur, contrairement à ce que
-- l'on pouvait craindre. Vérifié, laissé tel quel.
--
-- `stores`, `audits`, `audit_findings`, `tasks`, `goals`, `notifications` et
-- les tables du coach restent modifiables par leur propriétaire : ce sont ses
-- données, qu'il crée et modifie depuis l'interface.
