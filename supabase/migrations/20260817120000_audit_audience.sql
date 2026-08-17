-- Le portrait du client cible, conservé avec son audit.
--
-- LE DÉFAUT. Le portrait est déduit à chaque audit — gamme, signaux, niveau de
-- confiance, objections probables — puis transmis au modèle et perdu. Le
-- marchand ne le voit donc jamais, alors que c'est le raisonnement le plus
-- distinctif du produit : celui qu'aucun outil ne fait à sa place, et celui
-- qu'il n'aurait pas su formuler lui-même.
--
-- Le conserver permet aussi ce que la comparaison ne sait pas encore faire :
-- montrer que l'hypothèse a CHANGÉ quand de nouvelles ventes l'ont corrigée.
-- Une vitrine dit ce qu'on veut vendre, les commandes disent qui achète ; voir
-- l'hypothèse se déplacer de l'une vers l'autre est en soi une information.
--
-- Nullable et sans valeur par défaut : les audits antérieurs n'en ont pas, et
-- l'écran doit pouvoir dire « nous n'avions pas encore cette analyse » plutôt
-- que d'afficher un portrait vide.

ALTER TABLE public.audits
  ADD COLUMN IF NOT EXISTS audience jsonb;

COMMENT ON COLUMN public.audits.audience IS
  'Portrait du client cible déduit lors de cet audit, avec son niveau de confiance et les signaux utilisés. NULL sur les audits antérieurs — à distinguer d''un portrait vide, qui signifie « aucun signal exploitable ».';
