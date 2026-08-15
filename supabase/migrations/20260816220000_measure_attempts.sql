-- La différence entre « mesuré » et « on a essayé de mesurer ».
--
-- LE DÉFAUT. Le passage périodique choisit deux boutiques par minute, les moins
-- récemment mesurées d'abord, en se fondant sur `checked_at`. Or `checked_at`
-- n'est écrit qu'après une mesure RÉUSSIE. Une boutique dont plus aucun canal
-- n'est connecté échoue donc à chaque passage sans jamais faire avancer sa
-- date : elle reste éternellement en tête de file et occupe l'un des deux
-- créneaux, indéfiniment, pendant que les boutiques mesurables attendent
-- derrière. Deux boutiques déconnectées suffisaient à figer toute la mesure.
--
-- LA CORRECTION. `attempted_at` enregistre la TENTATIVE, posée avant l'appel,
-- qu'il aboutisse ou non. La cadence — deux mesures par jour au plus — se règle
-- sur la plus récente des deux dates, tandis que `checked_at` garde son sens
-- exact : la dernière fois qu'un verdict a réellement été calculé. Une boutique
-- qui échoue retombe donc en fin de file comme une boutique mesurée, et une
-- panne partenaire ne prive plus les autres de leur tour.
--
-- Même remède que `reaudit_checked_at` sur les boutiques : une file d'attente
-- ne peut pas être ordonnée par la date d'un succès qui ne vient jamais.
--
-- STRICTEMENT ADDITIVE et REJOUABLE.

ALTER TABLE public.fix_outcomes
  ADD COLUMN IF NOT EXISTS attempted_at timestamptz;

COMMENT ON COLUMN public.fix_outcomes.attempted_at IS
  'Dernière TENTATIVE de mesure, posée avant l''appel aux partenaires, qu''il aboutisse ou non. Règle la cadence du passage périodique. À ne pas confondre avec checked_at, qui date le dernier verdict réellement calculé.';

-- Les suivis à re-mesurer se trouvent sans balayer la table.
CREATE INDEX IF NOT EXISTS idx_fix_outcomes_attempted
  ON public.fix_outcomes (attempted_at NULLS FIRST);
