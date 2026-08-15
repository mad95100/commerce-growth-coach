-- Relance automatique du diagnostic après mesure.
--
-- POURQUOI CETTE COLONNE. Le passage périodique décide seul quand un nouveau
-- diagnostic est justifié. Quand le quota d'audits est compté — plan gratuit —
-- il ne le lance pas : il le PROPOSE, parce que dépenser l'allocation
-- mensuelle de quelqu'un sans son accord n'est pas de l'autonomie.
--
-- Une proposition ignorée est un refus. Sans trace de la date, la proposition
-- repartirait à chaque passage, c'est-à-dire toutes les minutes, et l'outil
-- deviendrait une réclame. Cette colonne est ce qui rend le silence possible.
--
-- STRICTEMENT ADDITIVE et REJOUABLE.

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS reaudit_prompted_at timestamptz;

COMMENT ON COLUMN public.stores.reaudit_prompted_at IS
  'Dernière fois qu''un nouveau diagnostic a été proposé automatiquement. Empêche de reproposer avant le délai de courtoisie.';

-- Le passage périodique cherche les boutiques dont des corrections viennent
-- d''obtenir un verdict définitif. Sans index, cette recherche parcourt toute
-- la table de mémoire à chaque minute.
CREATE INDEX IF NOT EXISTS idx_fix_attempts_measured
  ON public.fix_attempts (store_id, measured_at DESC)
  WHERE verdict IN ('confirme', 'nul', 'regression');
