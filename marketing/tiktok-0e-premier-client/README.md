# « 0 € → Premier client » — vidéo TikTok 9:16

Vidéo de contenu de 30 s, verticale 1080 × 1920, sans visage, entièrement
générée à partir du brief : aucun rush, aucune banque d'images, aucune photo.
Le montage est du motion design typographique rendu par un navigateur, image
par image.

## Ce que produit le dossier

| Fichier | Rôle |
| --- | --- |
| `sortie/0e-premier-client-tiktok.mp4` | le master, sans son |
| `sortie/0e-premier-client-tiktok-sous-titres.mp4` | le même, sous-titres incrustés |
| `sous-titres.srt` | à téléverser tel quel dans TikTok |
| `voix-off.json` | source unique du texte dit et des minutages |

## Refabriquer

```
node rendu.mjs                      # 900 images + encodage H.264
APERCU="5.3,12.4,25.6" node rendu.mjs   # quelques images seulement, pour juger
```

Il faut Playwright (local ou `npm i -g playwright`) et ffmpeg — à défaut
`pip install imageio-ffmpeg`, que `rendu.mjs` sait trouver seul.

Le rendu ne lit **aucune horloge réelle** : `scene.js` crée toutes les
animations en pause, et `rendre(t)` les positionne à la seconde demandée. Deux
rendus successifs donnent le même fichier, et n'importe quel instant est
inspectable isolément.

## Ajouter la voix-off

Elle n'est pas dans le master : le service de voix neurale n'est pas joignable
depuis l'environnement où la vidéo a été fabriquée. Depuis votre machine :

```
pip install edge-tts imageio-ffmpeg
python3 voix-off.py --voix
```

Chaque réplique est synthétisée séparément puis posée à sa seconde exacte, et
le script signale toute phrase qui déborde de son créneau. Résultat :
`sortie/0e-premier-client-tiktok-voix.mp4`.

Modifier un texte ou un minutage se fait dans `voix-off.json`, puis
`python3 voix-off.py --srt` régénère les sous-titres. Les deux sorties ne
peuvent pas diverger.

## Structure de la scène

| Temps | Section | Texte porteur |
| --- | --- | --- |
| 0 – 3 s | accroche | « Tu pars de 0 € et tu veux ton premier client ? » puis « Évite ces 3 erreurs. » |
| 3 – 10 s | erreur 1 | Vouloir vendre à tout le monde |
| 10 – 17 s | erreur 2 | Créer avant de vérifier |
| 17 – 24 s | erreur 3 | Attendre d'être prêt |
| 24 – 30 s | fin | 0 € → Premier client · 30 jours • Scripts • Templates • Toolkit · « Découvre le guide. » |

Chaque erreur est démontrée, pas seulement énoncée : une cible qui se resserre
d'une grille entière à un point unique ; deux enchaînements d'étapes dont un
seul tient ; un repère « prêt » qui recule à chaque fois qu'on s'en approche,
puis la boucle lancer → retours → ajuster.

## Règles tenues

- **Aucun chiffre de résultat, aucune promesse de gain.** La vidéo ne parle que
  de méthode. Rien à l'écran ne peut se lire comme un revenu attendu.
- **Aucun cliché de richesse** : ni billets, ni voiture, ni train de vie.
- **La couleur porte un sens** : le vert marque ce qui fonctionne, le corail ce
  qui coince. Rien d'autre n'est coloré.
- **Zones sûres TikTok** : tout le contenu tient entre 210 px et 1450 px de
  haut ; le bas de l'écran reste libre pour la légende et la colonne de boutons.
- Corps de texte à 33 px minimum sur 1080 de large, lisible sur téléphone.

## Points d'attention si vous modifiez `scene.js`

Deux pièges déjà payés, tous deux invisibles sur une image fixe :

- Un assouplissement posé au niveau de l'**effet** déforme la progression
  **avant** l'interpolation des étapes. Dès qu'une animation porte des `offset`,
  l'effet doit rester `linear` et l'assouplissement se met par étape.
- La dernière étape doit porter `offset: 1`. Sinon Chromium synthétise une étape
  implicite à 1 avec la valeur CSS d'origine, et l'élément que vous croyiez
  effacé réapparaît après la fin de son animation.

## Polices

Bricolage Grotesque et Public Sans (mêmes familles que le produit), sous-ensemble
latin uniquement, servies localement depuis `polices/`. Aucun appel réseau au
rendu.
