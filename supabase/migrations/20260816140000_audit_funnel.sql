-- L'entonnoir et les croisements, conservés sur l'audit.
--
-- POURQUOI. Le moteur calcule l'entonnoir, localise la fuite, la chiffre et
-- croise les canaux — puis jette tout après avoir rédigé le prompt. Le
-- marchand ne voit donc rien de ce qui a servi à le conseiller, et personne ne
-- peut vérifier après coup sur quoi une priorité reposait.
--
-- Conservés sur l'AUDIT et non recalculés à l'affichage : les données bougent,
-- et un rapport doit pouvoir montrer l'entonnoir tel qu'il était le jour où il
-- a conclu. Recalculer produirait un écran qui contredit son propre texte.
--
-- STRICTEMENT ADDITIVE et REJOUABLE.

ALTER TABLE public.audits
  -- Marches mesurées, marches inconnues, fuites classées par coût.
  ADD COLUMN IF NOT EXISTS funnel jsonb,
  -- Signaux issus du croisement des sources, avec leur niveau de certitude.
  ADD COLUMN IF NOT EXISTS cross_signals jsonb,
  -- Ce qui n'a pas pu être observé, et ce que cela aurait débloqué.
  ADD COLUMN IF NOT EXISTS data_gaps jsonb;

COMMENT ON COLUMN public.audits.funnel IS
  'Entonnoir mesuré au moment de l''audit : marches observées, marches inconnues nommées, et fuites entre marches consécutives observées. Jamais recalculé à l''affichage.';
