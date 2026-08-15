-- Mémoire des corrections déjà tentées, à l'échelle de la BOUTIQUE.
--
-- POURQUOI UNE TABLE, ALORS QUE `fix_outcomes` EXISTE. `fix_outcomes` porte une
-- ligne par PROBLÈME (`finding_id`), et un problème appartient à un audit. À
-- chaque nouvel audit, de nouveaux problèmes sont créés : la mémoire y est donc
-- remise à zéro exactement au moment où elle deviendrait utile. Un audit ne
-- pouvait pas savoir qu'on avait déjà réécrit la fiche produit le mois
-- précédent, ni que ça n'avait rien donné.
--
-- Cette table est indexée par (boutique, signature du problème) et survit aux
-- audits. C'est ce qui permet au diagnostic de ne pas reproposer ce qui a déjà
-- échoué — la faute qui fait perdre confiance en premier.
--
-- LA SIGNATURE est la clé courte du problème (`finding_key`) normalisée, à
-- défaut son titre normalisé. Deux audits reformulent volontiers le même
-- problème ; la clé, elle, est explicitement demandée stable au modèle.
--
-- STRICTEMENT ADDITIVE et REJOUABLE : création conditionnelle, aucune donnée
-- existante lue, déplacée ni supprimée.

CREATE TABLE IF NOT EXISTS public.fix_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  -- Identité stable du problème corrigé, à travers les audits.
  signature text NOT NULL,
  -- Le problème et l'audit d'origine, pour pouvoir remonter à la source.
  -- `SET NULL` : la mémoire doit survivre à la suppression d'un audit.
  finding_id uuid REFERENCES public.audit_findings(id) ON DELETE SET NULL,
  finding_key text,
  title text NOT NULL,
  category text,
  -- Outil d'exécution, `null` si la correction a été faite à la main.
  tool_name text,
  applied_at timestamptz NOT NULL DEFAULT now(),
  -- Verdict de `measure.ts` : en_cours | confirme | insuffisant | nul | regression.
  verdict text,
  headline text,
  rollback_recommended boolean NOT NULL DEFAULT false,
  rollback_possible boolean NOT NULL DEFAULT false,
  measured_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Une seule ligne de mémoire par problème et par boutique : une correction
-- retentée met à jour la ligne existante plutôt que d'en empiler une seconde.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fix_attempts_signature
  ON public.fix_attempts (store_id, signature);

-- L'audit charge toute la mémoire d'une boutique, la plus récente d'abord.
CREATE INDEX IF NOT EXISTS idx_fix_attempts_store
  ON public.fix_attempts (store_id, applied_at DESC);

ALTER TABLE public.fix_attempts DROP CONSTRAINT IF EXISTS fix_attempts_verdict_check;
ALTER TABLE public.fix_attempts
  ADD CONSTRAINT fix_attempts_verdict_check
  CHECK (verdict IS NULL OR verdict IN ('en_cours', 'confirme', 'insuffisant', 'nul', 'regression'));

-- DROITS. La mémoire est LUE par le navigateur (elle s'affiche dans le rapport
-- et le centre de pilotage) mais ÉCRITE par le seul serveur : elle décide de ce
-- que l'audit suivant s'interdit de proposer. La laisser modifiable depuis le
-- client reviendrait à laisser n'importe qui neutraliser un garde-fou, ou faire
-- passer une correction jamais faite pour un échec avéré.
REVOKE ALL ON public.fix_attempts FROM authenticated;
GRANT SELECT ON public.fix_attempts TO authenticated;
GRANT ALL ON public.fix_attempts TO service_role;

ALTER TABLE public.fix_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fix_attempts_owner_read ON public.fix_attempts;
CREATE POLICY fix_attempts_owner_read ON public.fix_attempts
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.stores s
    WHERE s.id = fix_attempts.store_id AND s.owner_id = auth.uid()
  ));

DROP TRIGGER IF EXISTS trg_fix_attempts_updated_at ON public.fix_attempts;
CREATE TRIGGER trg_fix_attempts_updated_at
  BEFORE UPDATE ON public.fix_attempts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.fix_attempts IS
  'Mémoire des corrections tentées sur une boutique, à travers les audits. Alimente le prompt du diagnostic suivant et le filtre qui empêche de reproposer ce qui a échoué.';
COMMENT ON COLUMN public.fix_attempts.signature IS
  'Clé courte du problème normalisée (finding_key, à défaut le titre). Identité stable d''un audit à l''autre.';

-- Ce que la mémoire dit de chaque piste retenue par l'audit.
--
-- Conservé sur le problème lui-même, et non recalculé à l'affichage : la
-- mémoire évolue (une correction mesurée « en cours » devient « nul » huit
-- jours plus tard), et un rapport doit pouvoir expliquer la décision telle
-- qu'elle a été prise le jour où il a été produit.
ALTER TABLE public.audit_findings
  -- proposer | prioriser | reformuler | ecarter
  ADD COLUMN IF NOT EXISTS history_action text,
  ADD COLUMN IF NOT EXISTS history_note text;

ALTER TABLE public.audit_findings DROP CONSTRAINT IF EXISTS audit_findings_history_action_check;
ALTER TABLE public.audit_findings
  ADD CONSTRAINT audit_findings_history_action_check
  CHECK (history_action IS NULL OR history_action IN ('proposer', 'prioriser', 'reformuler', 'ecarter'));

COMMENT ON COLUMN public.audit_findings.history_note IS
  'Pourquoi la mémoire de la boutique laisse passer, reformule ou priorise cette piste. Figé au moment de l''audit.';
