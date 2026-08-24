-- POURQUOI IL N'Y A PAS DE NOTE.
--
-- `audits.score` peut valoir NULL pour deux raisons qui ne se disent pas de la
-- même façon au marchand :
--
--   · couverture_insuffisante — nous n'avons pas pu mesurer assez de sujets,
--     ou aucun sujet commercial. La moyenne décrirait ce que nous avons réussi
--     à regarder, pas l'état de la boutique.
--
--   · offre_absente — la boutique ne propose aucun produit. La couverture peut
--     être excellente ; il n'y a simplement rien à noter.
--
-- L'écran n'avait que le NULL, et une seule phrase pour l'expliquer : celle de
-- la couverture. Sur une boutique au catalogue vide, elle s'affichait à côté du
-- constat n°1 qui dit qu'elle n'a aucun produit — deux affirmations
-- incompatibles dans le même rapport.
--
-- Colonne TEXT et non un enum : la liste des raisons appartient au moteur
-- (`RaisonSansNote` dans `audit-rules.ts`), et une raison ajoutée là-bas ne doit
-- pas exiger une migration d'enum pour être écrite. La lecture est défensive,
-- comme pour toutes les colonnes de contrat de ce schéma.
--
-- NULL sur les audits déjà enregistrés : ils sont tous antérieurs à
-- l'annulation par catalogue vide, donc leur absence de note tient bien à la
-- couverture, et c'est ce que l'écran affiche à défaut de valeur.

ALTER TABLE public.audits
  ADD COLUMN IF NOT EXISTS score_absence_reason TEXT;

COMMENT ON COLUMN public.audits.score_absence_reason IS
  'Pourquoi score est NULL : couverture_insuffisante | offre_absente. NULL si une note a été attribuée, ou pour les audits antérieurs à cette colonne.';
