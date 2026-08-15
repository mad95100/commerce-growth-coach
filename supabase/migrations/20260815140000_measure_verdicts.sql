-- Verdict complet d'une correction mesurée.
--
-- POURQUOI DES COLONNES PLUTÔT QU'UNE VALEUR D'ÉNUMÉRATION. Le verdict compte
-- désormais cinq états — mesure en cours, amélioration confirmée, impact
-- insuffisant, aucun impact, régression — là où `public.tracking_status` en
-- porte quatre. Lui ajouter une valeur demande `ALTER TYPE ... ADD VALUE`, que
-- PostgreSQL refuse d'exécuter dans une transaction ; or `supabase db push`
-- enveloppe chaque migration dans une transaction. Le déploiement échouerait.
--
-- Le verdict vit donc dans une colonne texte contrainte par un CHECK, et
-- l'ancienne colonne `status` continue d'être renseignée par correspondance
-- (voir `LEGACY_STATUS` dans `src/lib/measure.ts`). Rien de ce qui lit `status`
-- aujourd'hui ne casse.
--
-- « Aucun impact » distinct d'« impact insuffisant » n'est pas une nuance
-- décorative : le premier dit que le diagnostic s'est trompé de cause, le
-- second qu'il faut attendre. Les deux appellent des gestes opposés.
--
-- STRICTEMENT ADDITIVE et REJOUABLE. Aucune donnée lue, déplacée ni supprimée.

ALTER TABLE public.fix_outcomes
  -- en_cours | confirme | insuffisant | nul | regression
  ADD COLUMN IF NOT EXISTS verdict text,
  -- La phrase qu'on lit en premier, chiffres inclus.
  ADD COLUMN IF NOT EXISTS headline text,
  -- Le raisonnement complet : métriques retenues, dilution, garde-fous.
  ADD COLUMN IF NOT EXISTS explanation text,
  -- Part de la fenêtre de 30 jours postérieure à la correction, entre 0 et 1.
  -- En dessous de 0,25 aucun verdict n'est rendu : la mesure ne dirait rien.
  ADD COLUMN IF NOT EXISTS coverage numeric,
  -- Jours écoulés depuis l'application.
  ADD COLUMN IF NOT EXISTS measured_days numeric,
  -- Faut-il revenir en arrière, et est-ce automatisable ?
  ADD COLUMN IF NOT EXISTS rollback_recommended boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rollback_possible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rollback_reason text,
  -- Métriques réellement retenues pour ce verdict, avec leur écart ramené à
  -- fenêtre pleine. Les conserver rend le verdict vérifiable après coup.
  ADD COLUMN IF NOT EXISTS drivers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS guards jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Outil d'exécution, quand la correction est passée par une action
  -- automatique : c'est lui qui détermine les métriques à regarder.
  ADD COLUMN IF NOT EXISTS tool_name text,
  -- Action à annuler, si l'annulation est automatisable.
  ADD COLUMN IF NOT EXISTS action_id uuid REFERENCES public.actions(id) ON DELETE SET NULL;

-- `fix_outcomes` reste modifiable depuis le navigateur (policy
-- `fix_outcomes_owner_all` en FOR ALL). Une valeur inventée dans `verdict`
-- casserait l'affichage et, pire, le plan d'action. NULL reste accepté : c'est
-- l'état des lignes mesurées avant ce moteur.
ALTER TABLE public.fix_outcomes DROP CONSTRAINT IF EXISTS fix_outcomes_verdict_check;
ALTER TABLE public.fix_outcomes
  ADD CONSTRAINT fix_outcomes_verdict_check
  CHECK (verdict IS NULL OR verdict IN ('en_cours', 'confirme', 'insuffisant', 'nul', 'regression'));

-- Le plan d'action interroge « y a-t-il une régression à réparer ? » à chaque
-- affichage du centre de pilotage.
CREATE INDEX IF NOT EXISTS idx_fix_outcomes_verdict
  ON public.fix_outcomes (store_id, verdict)
  WHERE verdict IS NOT NULL;

COMMENT ON COLUMN public.fix_outcomes.coverage IS
  'Part de la fenêtre glissante de 30 jours postérieure à la correction. Sous 0,25, aucun verdict n''est rendu.';
COMMENT ON COLUMN public.fix_outcomes.verdict IS
  'en_cours | confirme | insuffisant | nul | regression. La colonne status en donne l''équivalent dans l''ancienne énumération.';
