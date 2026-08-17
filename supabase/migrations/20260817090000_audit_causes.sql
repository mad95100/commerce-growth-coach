-- Ce qu'il faut conserver pour qu'une comparaison entre audits veuille dire
-- quelque chose.
--
-- LE DÉFAUT. La comparaison entre deux audits sait confronter des causes
-- racines et des scores par axe — mais rien de tout cela n'était écrit en base.
-- Les causes étaient calculées pendant l'audit, envoyées au modèle, puis
-- perdues. Deux audits ne pouvaient donc être comparés que par leur score
-- global, c'est-à-dire par le seul chiffre qui n'apprend rien au marchand.
--
-- LE PIÈGE QUE CES COLONNES PERMETTENT D'ÉVITER. Comparer deux scores suppose
-- qu'ils mesurent la même chose. Entre deux audits, une source peut s'être
-- déconnectée : le score baisse alors sans qu'aucune boutique n'ait bougé.
-- `axis_scores` conserve, pour chaque axe, s'il était RÉELLEMENT MESURÉ ce
-- jour-là. Sans cette information, il est impossible de distinguer une
-- dégradation d'une perte de collecte — et l'outil annonce des régressions
-- imaginaires.
--
-- POURQUOI DU JSON ET NON DES TABLES. Ces deux valeurs sont des instantanés :
-- elles décrivent ce que le moteur pensait à un moment donné, et ne sont
-- jamais requêtées transversalement ni jointes. Les normaliser créerait deux
-- tables, deux politiques et deux jeux d'index pour un contenu qu'on relit
-- toujours en bloc, avec son audit.
--
-- Les colonnes sont nullables et sans valeur par défaut : les audits antérieurs
-- ne les ont pas, et une comparaison qui les rencontre doit pouvoir dire « nous
-- n'avions pas cette information » plutôt que de lire un tableau vide comme une
-- absence de cause.

ALTER TABLE public.audits
  ADD COLUMN IF NOT EXISTS root_causes jsonb,
  ADD COLUMN IF NOT EXISTS axis_scores jsonb;

COMMENT ON COLUMN public.audits.root_causes IS
  'Causes racines établies lors de cet audit : [{id, title, level, priority}]. NULL sur les audits antérieurs au regroupement causal — à distinguer d''un tableau vide, qui signifie « aucune cause trouvée ».';

COMMENT ON COLUMN public.audits.axis_scores IS
  'Score par axe AVEC son état de mesure : [{axis, score, measured}]. `measured` est indispensable : sans lui, un axe perdu de vue entre deux audits se lit comme une dégradation.';
