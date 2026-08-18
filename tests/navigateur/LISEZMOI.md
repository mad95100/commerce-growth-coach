# Sondes navigateur

Quatre outils qui **rendent réellement l'application** dans un navigateur et
mesurent ce que la lecture du code ne montre pas.

## Pourquoi ils existent

La suite de `bun run test` est de l'analyse statique : elle lit des fichiers et
compare des chaînes. C'est ce qui la rend rapide et sans dépendance, et c'est
aussi ce qu'elle ne pourra jamais faire — aucune lecture de source ne calcule
une largeur de document, ne construit un arbre d'accessibilité, ni ne dit ce
qu'un composant affiche à l'écran.

Les défauts suivants ont TOUS été trouvés par ces sondes, et par rien d'autre :

- le document de la page boutique mesurait **1065 px** dans un cadre de 320 ;
- le tableau de bord affichait « Soit environ **undefined** EUR par mois » dans
  la phrase qui chiffre la perte du marchand ;
- l'écran de facturation pouvait afficher « Période : **Invalid Date** » ;
- le bouton qui met fin à la session s'annonçait « button », sans nom, en vue
  mobile ;
- le champ du domaine Shopify n'avait aucune étiquette ;
- l'application démarrait sur un **écran entièrement noir** le temps de valider
  le jeton ;
- une lecture en échec laissait **8,5 secondes** d'ossature avant le moindre mot.

## Ce qu'ils NE sont pas

Ils ne sont **pas branchés sur `bun run test`**, délibérément : ils exigent un
serveur de développement en marche, un navigateur, et une dépendance que le
dépôt n'a pas. Les lancer est un geste volontaire.

Chaque défaut qu'ils ont trouvé a reçu, lui, un contrôle statique dans
`tests/ui/` — c'est celui-là qui protège en continu. Ces sondes servent à
TROUVER ; les suites servent à ne pas RETOMBER.

## Lancer

```bash
bunx vite dev --host 127.0.0.1 --port 8080     # dans un terminal
npm i playwright                                # une fois
NO_PROXY='*' node tests/navigateur/debordement.mjs   # débordement horizontal, 9 écrans × 6 largeurs
NO_PROXY='*' node tests/navigateur/fuites.mjs        # undefined / NaN / [object Object] rendus
NO_PROXY='*' node tests/navigateur/a11y.mjs          # noms accessibles, étiquettes, niveaux de titre
NO_PROXY='*' node tests/navigateur/shoot.mjs all     # captures d'écran, bureau + mobile
```

Sorties attendues : « Aucun débordement horizontal. », « Aucune valeur brute
rendue au marchand. », et rien pour `a11y.mjs` hormis les boutons radio, qui
sont un faux positif connu — l'arbre d'accessibilité montre qu'ils sont
correctement nommés par leur `<label for>`.

## Le point fragile : `harness.mjs`

Le harnais simule Supabase et les fonctions serveur avec des **fixtures écrites
à la main**, qui doivent suivre le schéma réel. Elles dérivent, et une fixture
fausse fait chercher des défauts qui n'existent pas — c'est arrivé plusieurs
fois pendant leur mise au point : un nom de colonne inventé, une forme d'objet
approximative, et l'écran paraît cassé alors que le code est juste.

**Avant de conclure qu'un défaut est réel, vérifier la fixture contre
`src/integrations/supabase/types.ts` et les types du moteur.** Les cas de
`profiles.user_id`, de `FunnelLeak.costPerMonth` et de `BriefingAction.steps`
l'ont tous montré.

Aucun identifiant réel ne figure ici : le harnais n'utilise pas de compte de
test, il simule le backend.
