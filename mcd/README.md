# mcd/ — modèle conceptuel des données des grilles

Ce dossier porte le **modèle conceptuel des données (MCD)** des quatre
applications « Grilles de carte » du Parlement de la rivière Isère, de leur
pipeline Zotero → JSON et du parcours contribution. Il répond à la demande
CEO du 11/10/26 : inscrire la logique des données dans un modèle explicite —
non dans la mémoire d'un agent — et fournir un protocole de modification /
ajout / suppression par entité.

## Contenu

| Fichier | Rôle |
|---|---|
| [`MODELE.md`](MODELE.md) | modèle complet : entités, associations, règles de gestion (traçables), mapping par entité, protocole d'écriture |
| [`contribution.md`](contribution.md) | MCD du parcours contribution : entité Proposition, correspondance des champs, états, garde-fous |
| [`dictionnaire-donnees.csv`](dictionnaire-donnees.csv) | dictionnaire de données — une ligne par champ (`entite,champ,type,obligatoire,source,regle,exemple`) |
| [`mcd.svg`](mcd.svg) | schéma d'ensemble : source Zotero → dérivés JSON → applications + parcours contribution |

## Principes à retenir

- **Zotero est la source de vérité unique** (groupe Konsilion `6610185`) ;
  les `data/*.json` du dépôt sont des dérivés régénérés à chaque tir horaire —
  on ne les édite jamais à la main.
- **Chaque entité a son outil d'écriture** dans `scripts/` (ajouter, valider,
  enrichir) ; la suppression d'item reste une décision CEO.
- Les labels `extra` sont en **anglais sans accents** ; les citationKey
  suivent `A000N` (actualités), `C000N` (contacts), `P000N` (projets).

## Maintenir ce modèle à jour

À chaque évolution d'une application ou du pipeline :

1. Faire évoluer la **source** (Zotero) ou les **scripts** — jamais un dérivé.
2. Mettre à jour `MODELE.md` : règles, mapping, protocole si un outil change.
3. Mettre à jour `dictionnaire-donnees.csv` : tout champ nouveau, renommé ou
   supprimé = une ligne à jour.
4. Si le parcours contribution évolue (champ de modale, type, relais),
   mettre à jour `contribution.md` et `mcd.svg`.
5. Vérifier que chaque règle citée pointe toujours vers le fichier qui
   l'applique (docstring, `EXTRA_LABELS`, mapping) — pas vers la mémoire.
6. Committer le dossier `mcd/` avec l'évolution concernée.
