-- Chaîne causale, niveau de certitude et priorité justifiée sur les problèmes.
--
-- POURQUOI. Jusqu'ici un problème d'audit ne portait qu'un nombre
-- (`priority_score`) et un rang (`sort_order`). Un nombre ne dit ni pourquoi ce
-- problème passe devant un autre, ni sur quoi la conclusion repose, ni ce qu'il
-- faut corriger d'abord. Ces colonnes portent ces trois informations, calculées
-- par `src/lib/finding-graph.ts`.
--
-- STRICTEMENT ADDITIVE. Aucune colonne existante n'est modifiée, aucune donnée
-- n'est lue, déplacée ni supprimée. Les lignes déjà en base restent valides :
-- les nouvelles colonnes y valent NULL ou leur valeur par défaut, et
-- l'interface sait s'en passer.
--
-- REJOUABLE. `IF NOT EXISTS` partout, contraintes supprimées avant d'être
-- recréées : un second passage ne produit rien.

ALTER TABLE public.audit_findings
  -- Identifiant court et stable produit par le modèle, cible des renvois de
  -- `caused_by`. Unique à l'intérieur d'un audit, pas au-delà.
  ADD COLUMN IF NOT EXISTS finding_key text,
  -- Clés des problèmes qui causent celui-ci. C'est l'arête du graphe causal, et
  -- ce qui interdit de proposer un symptôme avant sa cause.
  ADD COLUMN IF NOT EXISTS caused_by jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- 🔴 critique | 🟠 important | 🟡 opportunite | 🟢 optimisation.
  -- Laissée NULL sur les lignes antérieures : mieux vaut n'afficher aucune
  -- bande qu'en afficher une qui n'a pas été calculée.
  ADD COLUMN IF NOT EXISTS priority_band text,
  -- La phrase qui explique la bande. Une priorité qu'on ne sait pas expliquer
  -- ne sera pas suivie.
  ADD COLUMN IF NOT EXISTS priority_reason text,
  -- fait | deduction_forte | hypothese | donnee_manquante.
  ADD COLUMN IF NOT EXISTS epistemic_level text,
  -- Nombre de problèmes en aval, transitivement. 0 = ne bloque rien.
  ADD COLUMN IF NOT EXISTS blocks_count integer NOT NULL DEFAULT 0,
  -- 0 = cause racine. Croît strictement le long de la chaîne.
  ADD COLUMN IF NOT EXISTS chain_depth integer NOT NULL DEFAULT 0;

-- Les deux colonnes de classement sont écrites par le serveur uniquement, mais
-- `audit_findings` est modifiable par le navigateur (policy `findings_owner_all`
-- en FOR ALL). Une contrainte de domaine évite qu'une valeur inventée y arrive
-- et casse l'affichage. NULL reste accepté : c'est l'état des lignes anciennes.
ALTER TABLE public.audit_findings DROP CONSTRAINT IF EXISTS audit_findings_priority_band_check;
ALTER TABLE public.audit_findings
  ADD CONSTRAINT audit_findings_priority_band_check
  CHECK (priority_band IS NULL OR priority_band IN ('critique', 'important', 'opportunite', 'optimisation'));

ALTER TABLE public.audit_findings DROP CONSTRAINT IF EXISTS audit_findings_epistemic_level_check;
ALTER TABLE public.audit_findings
  ADD CONSTRAINT audit_findings_epistemic_level_check
  CHECK (epistemic_level IS NULL OR epistemic_level IN ('fait', 'deduction_forte', 'hypothese', 'donnee_manquante'));

-- Deux problèmes d'un même audit ne peuvent pas porter la même clé : les renvois
-- `caused_by` deviendraient ambigus. L'unicité est portée par un index partiel,
-- pour ne pas contraindre les lignes antérieures qui n'ont pas de clé.
CREATE UNIQUE INDEX IF NOT EXISTS idx_findings_key_per_audit
  ON public.audit_findings (audit_id, finding_key)
  WHERE finding_key IS NOT NULL;

COMMENT ON COLUMN public.audit_findings.caused_by IS
  'Clés (finding_key) des problèmes qui causent celui-ci, dans le même audit.';
COMMENT ON COLUMN public.audit_findings.epistemic_level IS
  'Sur quoi la conclusion repose : fait | deduction_forte | hypothese | donnee_manquante.';
