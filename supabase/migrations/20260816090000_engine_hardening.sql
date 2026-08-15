-- Durcissement du moteur : trois défauts que la mise en production aurait payés.
--
-- STRICTEMENT ADDITIVE et REJOUABLE.

-- ---------------------------------------------------------------------------
-- 1. `settled_at` — arrête la boucle de réanalyse
-- ---------------------------------------------------------------------------
-- La relance du diagnostic comparait `measured_at` à la date du dernier audit
-- pour savoir « qu'a-t-on appris DEPUIS ? ». Or `measured_at` est réécrit à
-- CHAQUE re-mesure, deux fois par jour. Un verdict tranché avant le dernier
-- audit — donc déjà intégré à ses conclusions — repassait donc pour neuf dès
-- la re-mesure suivante, et déclenchait un nouvel audit. Puis un autre trois
-- jours plus tard. Indéfiniment, à chaque fois payé.
--
-- `settled_at` note UNE SEULE FOIS le moment où le verdict est devenu
-- définitif. C'est cette date, et non celle de la dernière mesure, qui répond
-- à « qu'a-t-on appris depuis le dernier diagnostic ? ».
ALTER TABLE public.fix_attempts
  ADD COLUMN IF NOT EXISTS settled_at timestamptz;

COMMENT ON COLUMN public.fix_attempts.settled_at IS
  'Moment où le verdict est devenu définitif, écrit une seule fois. Ne pas confondre avec measured_at, réécrit à chaque mesure : c''est cette distinction qui empêche la relance en boucle du diagnostic.';

CREATE INDEX IF NOT EXISTS idx_fix_attempts_settled
  ON public.fix_attempts (store_id, settled_at DESC)
  WHERE settled_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. `reaudit_launched_at` — interdit le double lancement
-- ---------------------------------------------------------------------------
-- Le cron tourne à la minute ; un passage qui traite des audits peut durer plus
-- longtemps que cela. Deux invocations se recouvrent alors, lisent toutes deux
-- « aucun diagnostic en cours », et en créent chacune un : deux rapports
-- concurrents sur les mêmes données, et DEUX QUOTAS consommés pour un seul.
--
-- Cette colonne sert de jeton de réclamation. Elle est posée par une écriture
-- conditionnée à sa valeur lue juste avant — le même compare-and-swap que la
-- réclamation d'audit —, ce qui fait perdre la course au second passage sans
-- verrou ni transaction.
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS reaudit_launched_at timestamptz;

COMMENT ON COLUMN public.stores.reaudit_launched_at IS
  'Jeton de réclamation du lancement automatique de diagnostic. Écrit par compare-and-swap : deux passages simultanés ne peuvent pas créer deux audits.';

-- ---------------------------------------------------------------------------
-- 3. `reaudit_checked_at` — équité entre boutiques
-- ---------------------------------------------------------------------------
-- Le passage n'examine que quelques boutiques par minute. Sans mémoire de
-- l'ordre, ce sont toujours les mêmes qui passent en tête : une boutique dont
-- la décision est « attendre » y reste éternellement, et celles derrière elle
-- ne sont jamais examinées. Le même piège que pour les mesures, corrigé de la
-- même façon : les moins récemment examinées d'abord.
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS reaudit_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_stores_reaudit_checked
  ON public.stores (reaudit_checked_at ASC NULLS FIRST);
