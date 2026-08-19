---
name: audit-ecommerce-senior
description: Expertise e-commerce senior pour le MOTEUR D'AUDIT d'EcomPilot. À charger quand la tâche consiste à concevoir, réviser ou améliorer ce qui PRODUIT un diagnostic — règles déterministes, seuils, croisements de sources, entonnoir, priorisation, chiffrage d'impact, formulation d'un constat, prompt d'analyse — ou à juger si un diagnostic rendu tient debout. NE PAS charger pour l'interface, l'infrastructure, les connecteurs, l'authentification, le déploiement, ni pour une réparation de test sans rapport avec le contenu du diagnostic.
---

# Audit e-commerce senior

Ce document apporte le JUGEMENT MÉTIER. Il ne décrit ni l'architecture, ni les
conventions, ni l'état du projet — c'est le rôle de `CLAUDE.md`, qui reste la
référence pour tout ce qui touche au code, aux règles de rédaction et aux
contraintes de sécurité.

La question à laquelle il répond : **qu'est-ce qui distingue le constat d'un
consultant payé cher d'une checklist Shopify gratuite ?**

---

## 1. L'ordre d'investigation

Un consultant senior ne commence jamais par la fiche produit. Il cherche
**où l'argent disparaît en volume**, puis remonte à la cause.

1. **Combien entre, combien sort.** Localiser la marche du tunnel qui perd le
   plus grand VOLUME absolu — pas le pire taux. Perdre 40 % de mille visiteurs
   coûte plus que perdre 90 % de dix.
2. **Le trafic ou la boutique ?** C'est la bifurcation la plus importante, et la
   plus souvent ratée. Une conversion faible peut venir d'un trafic mal ciblé,
   pas d'une boutique défaillante. Recommander de refondre des fiches produit à
   quelqu'un dont le problème est le ciblage publicitaire lui fait perdre des
   semaines.
3. **La promesse est-elle lisible ?** Si un inconnu ne peut pas dire en cinq
   secondes ce qui est vendu, à qui, et pourquoi ici plutôt qu'ailleurs, tout ce
   qui suit est secondaire : optimiser un tunnel qui vend une chose
   incompréhensible ne donne rien.
4. **Ensuite seulement** : merchandising, fiches, réassurance, prix.

Si les données ne permettent pas l'étape 1, le dire — et ne pas passer
directement à l'étape 4 en faisant comme si l'ordre n'existait pas.

---

## 2. L'échelle épistémique

Quatre niveaux, jamais confondus. Un constat porte le sien.

| Niveau | Ce que c'est | Formulation |
|---|---|---|
| **Fait** | Mesuré, avec sa source et sa période | « 412 paniers, 107 commandes payées, 30 j » |
| **Observation** | Constaté sur la boutique, non chiffré | « aucun montant de livraison sur les fiches » |
| **Déduction** | Deux faits qui, ensemble, désignent une cause | « la perte est après le clic, pas avant » |
| **Hypothèse** | Explication plausible, non vérifiée | « probablement le montant découvert tard » |

Une déduction ne devient jamais un fait parce qu'elle est convaincante. Une
hypothèse énoncée sans être nommée comme telle est un mensonge poli.

**Ce qu'on ne sait pas se dit au même endroit que ce qu'on sait.** Un constat qui
ne liste que ses appuis paraît plus solide qu'il ne l'est.

---

## 3. Volume, période, dénominateur

- Un taux sur un dénominateur trop faible **n'existe pas** ; il n'est pas
  imprécis. Une commande de plus le ferait passer de 0 % à 8 %.
- Un compte à zéro **est** une mesure et se publie. « Zéro session » est un fait
  important. « Pas de donnée de session » est autre chose.
- Une variation sur une période courte peut être saisonnière, promotionnelle ou
  due à une rupture de stock. Sans période de comparaison, une hausse n'est pas
  une tendance.
- Une moyenne cache sa distribution. Un panier moyen de 172 € peut être trois
  commandes à 1 000 € et cent à 40 €. Ne pas construire un conseil de pricing
  sur une moyenne seule.

---

## 4. Cause racine, pas inventaire de symptômes

La faute la plus visible d'un audit médiocre : lister douze problèmes de même
poids. Un audit senior les **relie**.

Chaînes causales fréquentes — à reconnaître, pas à appliquer mécaniquement :

- promesse illisible → trafic non qualifié → taux d'ajout au panier faible ;
- frais de livraison découverts tard → abandon en caisse ;
- absence d'avis / de politique de retour → hésitation → abandon ;
- fiche sans dimensions ni matière → retours élevés → marge érodée ;
- navigation profonde → produits jamais vus → catalogue « mort » ;
- annonces qui promettent autre chose que la page d'arrivée → rebond immédiat.

Règle : **une cause passe toujours avant ce qu'elle provoque**. Un symptôme dont
la cause n'est pas traitée revient. Le dire explicitement — « corriger ceci sans
cela ne donnera rien » — vaut mieux que d'aligner les deux.

---

## 5. Priorisation

Ordonner par, dans cet ordre :

1. **Impact** — volume perdu × valeur unitaire. En monnaie, jamais en score.
2. **Certitude** — un impact déduit passe après un impact mesuré, à montant égal.
3. **Dépendance** — ce qui débloque autre chose passe devant.
4. **Effort** — départage seulement à impact et certitude comparables.

Trois actions maximum en tête de liste. Au-delà, personne n'agit.

Un constat **non chiffrable** ne se classe pas au milieu des autres avec un
montant inventé : il se range à part, en disant ce qu'il faudrait mesurer pour
le chiffrer.

---

## 6. Repères par domaine

### Proposition de valeur
Le premier écran doit répondre : quoi, pour qui, pourquoi vous. Un titre comme
« Collection » ou « Bienvenue » ne répond à aucune des trois. Le prix et la
promesse de livraison font partie de la proposition.

### Navigation et collections
Un produit à plus de trois clics de l'accueil est un produit qui ne se vend pas.
Une collection sans filtres au-delà de ~30 articles devient inutilisable. Les
collections vides ou à un seul produit détruisent la confiance. La page de
collection — pas la fiche — est l'actif principal.

### Fiche produit
Ce qui décide, dans l'ordre où l'œil arrive : ce que c'est, prix **et** coût de
livraison, disponibilité, photos réelles en contexte, ce qui répond à
l'objection propre à la catégorie (taille, matière, compatibilité, délai),
politique de retour, avis — près du bouton, pas en bas de page.

### CTA
Un seul CTA principal par écran. Verbe + résultat, jamais « Envoyer ». Deux
boutons de poids égal font hésiter au lieu de choisir.

### Réassurance
Elle agit à l'endroit du doute, pas dans le pied de page. Retours, délai réel,
paiement, contact humain, provenance. Une accumulation de badges génériques
signale l'inverse de ce qu'elle vise.

### Prix et offre
Leviers d'AOV, du plus au moins fiable : seuil de livraison offerte, lots,
recommandations pertinentes, montée en gamme. Une remise généralisée achète du
volume en détruisant la marge — ne jamais la recommander sans connaître le coût
produit.

### Tunnel
Quatre marches : visite → panier → caisse → paiement. Chaque chute a ses causes
typiques. Visite→panier : promesse, prix, photos. Panier→caisse : frais
découverts, doute sur le retour. Caisse→paiement : friction du formulaire,
moyens de paiement, coût final.

### Acquisition et analytics
L'attribution ment, surtout au dernier clic. Une régie s'attribue des ventes que
l'organique aurait faites. **Ne jamais recommander un déplacement de budget sur
une attribution mince.** Croiser dépense publicitaire et commandes réelles dit
davantage qu'un ROAS déclaré par la plateforme qui le facture.

### SEO e-commerce
Les collections portent l'intention d'achat ; les fiches produisent du contenu
mince et dupliqué. Une navigation à facettes non maîtrisée crée des milliers
d'URL équivalentes. Les descriptions fournisseur recopiées ne se positionnent
pas. Le SEO est un levier à effet différé : ne jamais le proposer comme réponse
à une urgence de trésorerie.

### Performance et Core Web Vitals
**Uniquement si réellement mesurés** sur un rendu. LCP, CLS et INP ne se
déduisent pas d'un HTML. Sans mesure : dire que ce n'est pas mesuré. Une
lenteur constatée est en revanche un fait, et elle coûte du trafic.

### Mobile
**Uniquement si réellement rendu.** L'essentiel du trafic e-commerce est mobile,
donc un défaut mobile pèse plus qu'un défaut bureau — mais un thème rendu par
JavaScript échappe à une lecture du HTML servi. Ne rien affirmer d'un affichage
qu'on n'a pas vu.

### Qualité des données
Avant tout constat : la source a-t-elle répondu, sur quelle période, avec quel
volume ? Une source muette ne produit pas des compteurs à zéro. Un catalogue lu
partiellement donne des taux qui ne portent que sur l'échantillon, et cela se
dit.

---

## 7. Ce qui invalide un constat

Relire chaque constat contre cette liste. Un seul « oui » = à réécrire.

- Le montant vient-il d'un calcul, ou d'une fourchette confortable ?
- Le taux repose-t-il sur un dénominateur trop mince ?
- Est-ce un symptôme dont la cause est ailleurs dans la même liste ?
- L'action demandée est-elle réalisable par un marchand, seul, sans développeur ?
- Le constat tiendrait-il si on retirait la phrase de preuve ?
- Dirait-on la même chose de n'importe quelle boutique ? Alors ce n'est pas un
  diagnostic, c'est un lieu commun.

---

## 8. Refus

- **Aucun benchmark inventé.** Pas de « le taux moyen du secteur est de X % »
  sans source. Un ordre de grandeur peut servir de repère s'il est annoncé
  comme tel — jamais comme une norme que la boutique « raterait ».
- **Aucune étude invoquée** qu'on ne peut pas citer.
- **Aucune promesse de gain** en pourcentage après correction. On énonce le
  volume aujourd'hui perdu et ce qu'il vaudrait s'il était récupéré, avec
  l'hypothèse rendue visible.
- **Aucune métrique fabriquée** pour combler un trou. Absent ≠ nul.
- **Aucun conseil générique** présenté comme un constat : « ajoutez des avis »
  n'est un diagnostic que si l'absence d'avis a été constatée ET rattachée à une
  perte.
