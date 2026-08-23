---
name: copy-ecompilot
description: Voix éditoriale d'EcomPilot pour tout TEXTE LU PAR UN MARCHAND — écrans, boutons, états vides, erreurs, notifications, titres de constats, libellés de certitude et de priorité, et les consignes envoyées au modèle qui rédige le rapport. À charger quand la tâche consiste à écrire, réécrire ou juger une formulation destinée à l'utilisateur. NE PAS charger pour du code sans texte visible, pour l'infrastructure, les connecteurs, les tests techniques, ni pour décider CE QUI est vrai — c'est le rôle du moteur et de la skill audit-ecommerce-senior.
---

# Le copy d'EcomPilot

Ce document ne dit pas ce qui est vrai — `audit-ecommerce-senior` juge le
diagnostic, `CLAUDE.md` porte les règles du code et de la sécurité. Il dit
comment une chose vraie se formule pour la personne qui la lit.

**La question à laquelle il répond : à quoi reconnaît-on qu'un texte a été
écrit pour un marchand, et pas pour un développeur, un débutant ou un moteur
de recherche ?**

---

## 1. Qui lit

Une personne qui possède une boutique en ligne, souvent seule. Elle connaît ses
produits, pas le CRO ni l'analytics. Elle a déjà investi du temps et de
l'argent. Elle sait que quelque chose ne convertit pas ; elle ignore quoi, et
dans quel ordre s'y prendre.

Ce qu'elle attend d'un texte : **savoir ce qui a été trouvé chez elle, ce qui
est établi, ce qui ne l'est pas, et par quoi commencer.**

Ce qu'elle rejette immédiatement : le conseil qui vaudrait pour n'importe
quelle boutique. Elle en a déjà lu des centaines.

---

## 2. Le test qui tranche

Avant de garder une phrase, la relire ainsi :

> **Cette phrase serait-elle vraie mot pour mot d'une autre boutique ?**

Si oui, ce n'est pas un diagnostic : c'est un lieu commun, et il coûte de la
crédibilité au reste du rapport. Une phrase spécifique cite ce qui a été lu —
un titre, une adresse, un compte, une période.

Second test, pour les textes d'interface :

> **Le lecteur sait-il quoi faire, ou seulement ce qui ne va pas ?**

---

## 3. Ce qu'un texte n'a jamais le droit de faire

Ces interdits ne sont pas stylistiques. Chacun correspond à une affirmation que
les données ne portent pas.

**Prêter une conduite à des gens que personne n'a observés.** Nous lisons des
pages et des chiffres de vente ; nous ne voyons aucun visiteur. Donc jamais
« les visiteurs quittent le site », « l'acheteur repart », « vos clients
hésitent », « cela fait fuir ».

**Décréter une conséquence non mesurée.** Jamais « provoque le refus de vos
publicités », « vous fait perdre X % », « bloque vos ventes ». Aucun refus,
aucun départ, aucune hésitation n'est mesuré.

**Dire ce qu'un manque DÉCLENCHE plutôt que ce qu'il EMPÊCHE.** C'est la
reformulation qui sauve presque tous les cas :

> ✗ « Votre page d'accueil est muette, vos visiteurs ne savent pas quoi faire. »
> ✓ « La page d'accueil ne porte aucun titre permettant d'identifier l'offre.
> Un visiteur qui découvre la boutique doit donc comprendre seul ce qu'elle
> vend. Nous ne disposons pas des données de trafic permettant de mesurer
> combien de personnes sont concernées. »

**Dramatiser.** Une boutique n'est jamais « muette », « invisible », « morte »,
« impossible à visiter ». Ce sont des images ; une image n'est pas un constat.

**Élargir la portée par élégance.** Cinq fiches inspectées ne sont pas « votre
catalogue ». Trois adresses vérifiées ne sont pas « toutes vos pages ». Sans
mesure de trafic, il n'y a pas « vos visiteurs ». Une formulation plus fluide
qui élargit la portée est un mensonge.

**Culpabiliser.** « Ce que vous devez faire » se dit « ce que vous pouvez
faire ». Le marchand n'a pas échoué : il n'avait pas l'information.

---

## 4. Les formules vides, et par quoi les remplacer

Elles ne sont fausses nulle part — c'est ce qui les rend invisibles à un test de
vérité, et interchangeables d'une boutique à l'autre.

| À bannir | Ce qu'il faut à la place |
|---|---|
| « Il est important de… » | le constat, puis sa conséquence commerciale |
| « Pensez à… » | l'action, à l'impératif ou à l'infinitif, avec son endroit |
| « Optimisez votre boutique » | quoi, sur quelle page, pourquoi celle-là |
| « Améliorez votre conversion » | à quelle marche, et sur quelle mesure |
| « Ajoutez des avis » | ce qui a été constaté, puis l'objection que cela laisse ouverte |
| « Cela peut faire fuir les visiteurs » | ce que l'absence empêche de comprendre |
| « Votre boutique n'est pas optimisée » | rien — cette phrase ne dit rien |

---

## 5. Le diagnostic d'abord, la technique ensuite

Un titre et une cause parlent commerce. Le détail technique appartient à la
preuve, où il est vérifiable et à sa place.

> ✗ Titre : « Aucun H1 dans le document HTML »
> ✓ Titre : « Votre offre n'est pas identifiable dès l'arrivée sur la boutique »
> ✓ Preuve : « Aucun titre de niveau 1 relevé sur la page d'accueil inspectée »

Cet ordre vaut partout : le marchand doit pouvoir s'arrêter après la première
phrase et avoir compris l'essentiel. La preuve sert à qui veut vérifier.

---

## 6. Les deux axes qui ne se confondent jamais

**Priorité** — critique, importante, opportunité, secondaire : ce que cela
coûte. **Certitude** — mesuré, observé, déduit, hypothèse, donnée manquante :
ce que nous savons.

Un constat peut être critique et hypothétique, ou secondaire et mesuré. Les
nommer tous les deux à l'écran empêche le lecteur pressé de les additionner.

Le vocabulaire de certitude s'écrit en langage naturel — « déduit des éléments
observés » — jamais en termes de moteur : ni « déduction forte », ni « piste »,
ni « niveau épistémique ». La distinction reste entière ; c'est sa présentation
qui change.

---

## 7. Une donnée manquante n'est pas une fin de phrase

Ne jamais afficher « Donnée manquante » seul. Quatre éléments, dans cet ordre,
et aussi courts que possible :

1. ce que nous ne pouvons pas mesurer ;
2. ce que cela empêche de conclure ;
3. ce qui reste observable malgré tout ;
4. comment obtenir la donnée.

Une absence de mesure n'est jamais un problème critique, et ne se chiffre
jamais.

---

## 8. Les boutons promettent exactement ce qu'ils font

Un intitulé est un engagement. « Corriger à ma place » sur un constat
qu'aucun outil ne sait écrire coûte plus qu'un bouton absent.

- l'outil écrit vraiment → « Corriger automatiquement »
- l'outil prépare, le marchand confirme → « Préparer la correction »
- rien n'est automatisable ici → « Voir comment corriger »
- cela ouvre l'administration → « Ouvrir dans Shopify »
- cela copie un texte → « Copier le texte proposé »

Aucun bouton décoratif. Si l'action n'existe pas, retirer le bouton et dire ce
qui reste possible.

---

## 9. Le vocabulaire est stable

Un synonyme par écran donne l'impression d'un logiciel assemblé par plusieurs
mains. Un terme, un sens :

**diagnostic** (le travail) · **constat** (ce qui a été trouvé) · **preuve** (ce
sur quoi il repose) · **cause racine** (ce qui en explique plusieurs) ·
**priorité** · **certitude** · **correction** (le geste) · **boutique** ·
**catalogue** · **fiche produit**.

Ne pas alterner problème / anomalie / point faible / opportunité pour désigner
la même chose. Et ne jamais simplifier « preuve », « observation », « mesure »,
« hypothèse » au point de leur faire perdre leur sens méthodologique.

---

## 10. Vouvoiement, et une seule voix

**Vous** partout, sans exception, y compris dans les consignes envoyées au
modèle — c'est le texte le plus lu du produit.

Le produit se désigne par **nous** : une équipe qui répond de ce qu'elle écrit
et de ce qu'elle modifie. Le **je** n'engage personne.

Le ton : expert, calme, direct. Un consultant ne s'enthousiasme pas, il
constate. Pas de félicitation de politesse, pas d'encouragement, pas de
métaphore, pas de superlatif.

---

## 11. La conversion vient de la précision

Un texte peut chercher à faire agir. Il ne peut pas y arriver en exagérant.

Interdits : pourcentage de gain inventé, chiffre d'affaires perdu sans mesure,
promesse de conversion, moyenne de marché non citable, étude invoquée sans
source.

Ce qui convainc réellement un marchand : un constat qu'il peut vérifier lui-même
en trente secondes sur sa propre boutique. C'est la seule preuve qu'il ne
soupçonnera pas.
