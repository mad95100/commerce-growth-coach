# « 0 € → Premier client » — vidéo TikTok 9:16

Film de 30 s, vertical 1080 × 1920, sans visage, **sans voix ni musique**.
Tout est fabriqué à partir du brief : aucun rush, aucune banque d'images.

Les plans sont des scènes jouées par des appareils et des interfaces —
un portable posé dans la lumière, un fil de messages, un navigateur, une page
d'offre, un tableau de suivi, la couverture du guide — filmés dans un décor
sombre avec profondeur de champ, parallaxe et mouvements de caméra.

## Ce que produit le dossier

| Fichier | Rôle |
| --- | --- |
| `sortie/0e-premier-client-tiktok.mp4` | le film, muet |
| `sous-titres.srt` | à téléverser dans TikTok si vous en voulez |
| `voix-off.json` | script de voix-off proposé + minutages, calé sur les coupes |

## Refabriquer

```
node rendu.mjs                          # 900 images, puis encodage H.264
APERCU="2.7,9.8,18.6,25.9" node rendu.mjs   # quelques images, pour juger
SOUS_TITRES=1 node rendu.mjs            # produit aussi la variante sous-titrée
INCRUSTER_SEUL=1 node rendu.mjs         # refait les sous-titres seuls
```

Il faut Playwright (local ou `npm i -g playwright`) et ffmpeg — à défaut
`pip install imageio-ffmpeg`, que `rendu.mjs` sait trouver seul.

Le rendu ne lit **aucune horloge réelle** et n'appelle **aucun `Math.random`** :
`scene.js` crée toutes les animations en pause, la poussière vient d'un
générateur à graine, et `rendre(t)` place la scène à la seconde demandée. Deux
rendus donnent le même fichier, et n'importe quel instant s'inspecte seul.

## Le montage

Dix-sept plans, une rupture visuelle toutes les 1,3 à 2,2 s.

| Temps | Plan | Ce qu'on voit |
| --- | --- | --- |
| 0,0 – 1,7 | poussée avant | un portable, une page d'offre soignée |
| 1,7 – 3,1 | travelling | le compteur : 0 vente, la courbe est plate |
| 3,1 – 4,6 | bascule | trois messages envoyés, trois « Vu » |
| 4,6 – 6,1 | poussée | une recherche qui défile sans fin |
| 6,1 – 7,4 | rapprochement | le curseur frôle le bouton… et s'en va |
| 7,4 – 8,2 | respiration | « Le problème n'est pas ton idée. » |
| 8,2 – 10,4 | survol plongeant | une audience immense, un seul visage s'allume |
| 10,4 – 12,6 | dérive | l'offre se brouille : la promesse ne se lit plus |
| 12,6 – 15,1 | bascule | le même message, collé six fois |
| 15,1 – 17,1 | montée | quatre étapes se mettent en place |
| 17,1 – 19,1 | mise au point | la page d'offre revient au net |
| 19,1 – 21,1 | bascule | le message change, la réponse arrive |
| 21,1 – 23,1 | recul | le suivi est rangé, une fiche passe en « Client » |
| 23,1 – 26,2 | rotation | la couverture du guide entre dans la lumière |
| 26,2 – 30,0 | fixe | le titre, ce qu'il contient, « Découvre la méthode. » |

L'accroche ne donne pas la réponse : elle installe une contradiction — l'idée
est bonne, et rien ne se vend — puis fait attendre trois plans avant de nommer
la cause. Les écrans de la seconde moitié sont **les mêmes** que ceux de la
première, remis dans l'ordre : c'est la démonstration, pas une illustration.

## La voix-off

Elle n'est **pas** générée ici, comme demandé. `voix-off.json` propose le texte
et les minutages calés sur les coupes ; donnez `repliques` à votre moteur de
voix, puis montez l'audio de votre côté.

`python3 voix-off.py --srt` régénère `sous-titres.srt` depuis le même fichier :
texte et sous-titres ne peuvent pas diverger. `voix-off.py --voix` existe encore
mais reste inutilisé ici.

## Règles tenues

- **Aucun chiffre de résultat, aucune promesse de gain.** Le seul nombre montré
  est un zéro — celui du problème. Rien ne se lit comme un revenu attendu.
- **Aucun cliché de richesse** : ni billets, ni voiture, ni train de vie.
- **La couleur porte un sens** : le vert marque ce qui fonctionne, le corail ce
  qui coince. Rien d'autre n'est coloré.
- **Peu de texte** : deux à six mots par carton, jamais plus de deux lignes.
- **Zones sûres TikTok** : le sujet vit entre 200 px et 1400 px de haut ; le bas
  reste libre pour la légende et la colonne de boutons.

## Ce que ce dossier ne peut pas faire

Il n'y a **aucun outil de génération d'images ou de vidéo par IA** dans
l'environnement où ce film est fabriqué. Pas de plan photoréaliste, pas de
personne filmée. Les scènes sont composées par le navigateur : appareils,
interfaces, lumière et caméra. Si vous voulez insérer des plans tournés ou
générés ailleurs, ils se montent par-dessus — le film est muet et cadencé pour
accepter des inserts.

## Pièges déjà payés

Quatre défauts corrigés ici, tous invisibles sur une image fixe ou sur le code :

- Un assouplissement posé au niveau de l'**effet** déforme la progression
  **avant** l'interpolation des étapes. Dès qu'une animation porte des `offset`,
  l'effet doit rester `linear` et l'assouplissement se met par étape.
- La dernière étape doit porter `offset: 1`. Sinon Chromium synthétise une étape
  implicite à 1 avec la valeur CSS d'origine, et l'élément que vous croyiez
  effacé réapparaît après la fin de son animation.
- Sur une fenêtre plus courte que ses fondus, les `offset` cessent d'être
  croissants et `animate` refuse l'animation entière. Les fondus se bornent à la
  durée disponible.
- Un gabarit `html` dont le `reduce` part de `s[0] + s[1]` décale toutes les
  valeurs interpolées d'une position : le contenu se retrouve hors de son
  conteneur, sans la moindre erreur. La page s'affiche, simplement vide.

Et un cinquième, hérité de la version précédente : les sous-titres incrustés ne
passent pas par le filtre `subtitles` de ffmpeg, qui fixe `PlayResY` à 288 pour
un SRT — tailles et marges s'y expriment dans une autre échelle que la vidéo, et
une marge de 420 projette le texte hors cadre sans aucun message d'erreur.
Chaque carton est composé par le navigateur puis posé par un `overlay`.

## Polices

Bricolage Grotesque et Public Sans, sous-ensemble latin, servies localement
depuis `polices/`. Aucun appel réseau au rendu.
