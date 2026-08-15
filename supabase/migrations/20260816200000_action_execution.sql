-- L'issue RÉELLE d'une écriture, distincte de l'intention de l'écrire.
--
-- LE DÉFAUT. `claimProposal` fait passer la ligne en `applied` AVANT d'appeler
-- Shopify, Meta ou Google — c'est le verrou qui empêche une double exécution, et
-- il doit rester posé avant l'appel. Mais si le worker meurt pendant cet appel
-- (limite CPU, éviction, coupure réseau au retour), la ligne reste `applied`
-- pour toujours alors que rien ne prouve que l'écriture soit partie. L'interface
-- annonce alors « corrigé » pour une correction dont personne ne connaît le
-- sort. C'est exactement ce qu'un produit qui touche à l'argent d'un marchand
-- n'a pas le droit de faire.
--
-- LA DISTINCTION AJOUTÉE. `status` reste ce qu'il est : l'état du journal.
-- `run_state` dit où en est l'exécution :
--   - `reserve` : le verrou est posé, l'appel partenaire est en vol. Issue INCONNUE.
--   - `ecrit`   : le partenaire a répondu, le résultat est consigné.
--   - `echoue`  : l'appel a échoué proprement, avant ou pendant, avec un motif.
--
-- Une ligne restée en `reserve` n'est jamais présentée comme appliquée, et n'est
-- jamais rejouée automatiquement : on ignore si la première écriture a abouti,
-- et rejouer à l'aveugle créerait un second code promo ou une seconde hausse de
-- budget. Elle est signalée telle quelle, à vérifier chez le partenaire.
--
-- POURQUOI UNE COLONNE TEXTE ET NON UNE VALEUR D'ÉNUMÉRATION. `action_status`
-- est un type énuméré PostgreSQL, et `ALTER TYPE ... ADD VALUE` ne peut pas
-- s'exécuter dans une transaction — ce que `supabase db push` fait toujours. La
-- contrainte CHECK donne la même garantie sans ce blocage.
--
-- STRICTEMENT ADDITIVE et REJOUABLE.

ALTER TABLE public.actions
  ADD COLUMN IF NOT EXISTS run_state text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'actions_run_state_check'
  ) THEN
    ALTER TABLE public.actions
      ADD CONSTRAINT actions_run_state_check
      CHECK (run_state IS NULL OR run_state IN ('reserve', 'ecrit', 'echoue'));
  END IF;
END $$;

COMMENT ON COLUMN public.actions.run_state IS
  'Issue réelle de l''écriture partenaire : reserve (verrou posé, appel en vol, issue inconnue), ecrit (résultat consigné), echoue (motif consigné). NULL sur les lignes antérieures à cette colonne, qui ont toutes été finalisées par l''ancien code.';

-- Les lignes bloquées en vol se retrouvent sans balayer la table entière.
CREATE INDEX IF NOT EXISTS idx_actions_in_flight
  ON public.actions (store_id, created_at DESC)
  WHERE run_state = 'reserve';
