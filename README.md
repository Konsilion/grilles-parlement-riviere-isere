# Grilles de carte — Parlement de la rivière Isère

Repo unique portant les **quatre applications « Grilles de carte »** du
Parlement de la rivière Isère (décision CEO 11/10/26) — sites statiques
(HTML/CSS/JS vanilla), zéro build, zéro dépendance, servis par
**GitHub Pages** depuis la branche `main` à la racine.

**URL publique :** https://konsilion.github.io/grilles-parlement-riviere-isere/

Les anciens repos `zotero-parlement-riviere-isere` (médiathèque) et
`actualites-parlement-riviere-isere` (actualités) restent en prod
jusqu'à la bascule finale — ce repo les remplace à terme.

## Structure

```
grilles-parlement-riviere-isere/
├── index.html              # accueil : 4 liens vers les quatre apps
├── mediatheque/            # ex-vitrine Zotero (git mv — historique conservé)
│   ├── index.html, js/app.js, css/style.css
│   └── data/collection.json    # généré par scripts/fetch_zotero.py
├── actualites/             # ex-app actualités (copie — historique dans l'ancien repo)
│   ├── index.html, js/app.js, css/style.css
│   └── data/actualites.json    # généré par scripts/fetch_actualites.py (K4)
│       data/actualites.csv      # historique (migration Zotero en cours)
│       data/pending_proposals.json
├── contacts/               # répertoire de contacts (C3)
│   ├── index.html, js/app.js, css/style.css
│   └── data/contacts.json      # généré par scripts/fetch_contacts.py (C2)
├── projets/                # démarches du Parlement (P3)
│   ├── index.html, js/app.js, css/style.css
│   └── data/projets.json       # généré par scripts/fetch_projets.py (P1)
├── common/                 # code mutualisé des trois apps (K5)
│   ├── css/base.css         # tokens, thème clair unique, pagination, dropdowns, pastilles
│   └── js/                  # dom.js (esc/dates), search.js (fuzzy), pagination.js, dropdown.js
├── scripts/
│   ├── fetch_zotero.py     # médiathèque : API Zotero → mediatheque/data/collection.json
│   ├── fetch_actualites.py # actualités : collection « Actualités » → actualites/data/actualites.json
│   ├── fetch_contacts.py   # contacts : collection « Contacts » → contacts/data/contacts.json (C2)
│   ├── ajouter_contact.py  # contacts : saisie d'un contact (CEO) dans Zotero (C2)
│   ├── fetch_projets.py    # projets : collection « Projets » → projets/data/projets.json (P1)
│   ├── ajouter_projet.py   # projets : saisie d'un projet (CEO) dans Zotero (P1)
│   ├── config.example.py   # template de credentials (config.py = .gitignore, JAMAIS commité)
│   ├── deploy.sh           # 4 fetchs + commit + push (timer grilles-parlement-sync)
│   ├── valider.py          # actualités : validation CEO par numéros
│   └── lister.py           # actualités : affichage des propositions / actualités
├── README.md
├── .gitignore              # DOIT couvrir scripts/config.py (clé API — push = incident)
└── .nojekyll
```

## Les quatre applications

**Médiathèque** (`/mediatheque/`) — collection du groupe Zotero
Konsilion (6610185) en cartes type e-commerce : recherche floue,
filtres type/année/tags, pagination, modale de détail.

**Actualités** (`/actualites/`) — grille des actualités du Parlement
(événements à venir/passés, ressources, informations), filtres
année/mois, recherche floue, pagination. Les données viennent de
`data/actualites.json`, généré depuis la collection Zotero
« Actualités » par `scripts/fetch_actualites.py`.

**Contacts** (`/contacts/`) — répertoire public de cartes contact :
pastille avatar (initiales), recherche floue (nom, organisation,
description, rôle), filtre Catégories multi-choix, tri nom A-Z /
contact le plus récent, pagination, modale détail (email `mailto:`,
téléphone `tel:`, lien externe `_blank`). Les données viennent de
`data/contacts.json` (contrat C2 : `id`, `nom`, `description`,
`organisation`, `lieu`, `date_contact`, `lien`, `email`, `telephone`,
`role`, `categories`, `date_ajout`).

**Projets** (`/projets/`) — grille des démarches propres au Parlement
de la rivière Isère : carte par projet avec vignette de statut (En
cours / À venir / Terminé, déduit des dates si absent), recherche
floue (titre, porteur, description, lieu), filtres Statut +
Catégories multi-choix, tri (début le plus récent / titre A-Z / fin de
projet), pagination, modale détail (période, porteur, lien). Les
données viennent de `data/projets.json` (contrat P3 : `id`, `titre`,
`description`, `porteur`, `lieu`, `date_debut`, `date_fin`, `lien`,
`statut`, `categories`, `date_ajout`).

## Mutualisation (K5)

Les deux apps partagent un socle unique dans `common/`, référencé
par chemin relatif (`../common/...`) — même origine sur GitHub
Pages, aucun build :

- `common/js/search.js` — recherche floue (normalisation
  casse/accents + Damerau-Levenshtein borné, calibrage vitrine
  10/10/26) : `GrilleSearch.matchesQuery`, index par item via
  `makeSearchCache(getKey, getHaystack)` (le haystack dépend de
  l'app : fiches Zotero vs actualités).
- `common/js/pagination.js` — `GrillePagination.paginate(state,
  filtered)` + `renderPagination(state, totalPages, navs,
  onChange)` : barres ‹ numéros › haut + bas synchronisées.
- `common/js/dropdown.js` — `GrilleDropdown.makeDropdown` :
  dropdowns custom multi-choix (le `<select>` natif refuse le
  multi — ne jamais y revenir), clic-dehors/Échap, option
  « Tous… » qui décoche tout.
- `common/js/dom.js` — `GrilleDom` : `esc` (échappement HTML),
  `parseISO`, `formatDate`.
- `common/css/base.css` — tokens (`--accent: #0b4387`…), thème
  clair unique (`:root { color-scheme: light }`, PAS de
  prefers-color-scheme), base 16.5px (tout en rem), `.card`
  + halo bleu au survol, `.pagination/.page-*`,
  `.dropdown/.dd-*`, `.filter-pill(s)`, `.search-input`.

Chaque app ne garde que ses styles et logiques propres
(sidebar + modale médiathèque, toolbar + pastilles mois actus).

## Contacts — mécanique (C2)

**Source de vérité :** collection Zotero « Contacts » (clé `JI7JP8AZ`,
racine du groupe Konsilion 6610185) — itemType `document`. La donnée
du repo est un dérivé régénéré par le pipeline.

**Mapping Zotero → contrat du front (12 clés) :**

| Contrat | Zotero |
|---|---|
| `id` | `citationKey` (C000N, attribué automatiquement) |
| `nom` | `title` |
| `description` | `abstractNote` |
| `organisation` | `publisher` |
| `lieu` | `place` |
| `date_contact` | `date` |
| `lien` | `url` |
| `email` | `extra`, ligne « Email: … » |
| `telephone` | `extra`, ligne « Telephone: … » |
| `role` | `extra`, ligne « Role: … » |
| `categories` | `tags` |
| `date_ajout` | `dateAdded` (AAAA-MM-JJ) |

**Fetch :** `scripts/fetch_contacts.py` lit la collection et écrit
`contacts/data/contacts.json` (tri déterministe par id ; collection
vide → `[]`, l'app affiche « Aucun contact pour le moment. »).

**Saisie (CEO) :** `scripts/ajouter_contact.py` crée l'item Zotero
sans toucher l'API à la main — citationKey C000N auto (scan max+1),
POST en échec vérifié, re-fetch de contrôle :

```bash
python3 scripts/ajouter_contact.py --nom "Marie Dupont" \
  --organisation "Conseil départemental" --lieu "Grenoble" \
  --email marie@example.fr --role "Élue" \
  --categorie institution --categorie eau
```

Autres options : `--description`, `--telephone`, `--lien`,
`--date-contact AAAA-MM-JJ`. Le contact est visible sur la grille
après le prochain fetch (deploy.sh ou tir horaire du timer).

⚠ **La grille est publique** : n'y saisir que des coordonnées
destinées à être publiées (email/téléphone professionnels).

### Fixture `actualites/data/actualites.json`

Le fichier commis est une **fixture de développement** générée
une fois depuis le CSV historique (12 items, mêmes noms de
champs) pour que le front fonctionne avant la bascule. En
production, il est **régénéré** par `scripts/fetch_actualites.py`
(K4) depuis la collection Zotero « Actualités » — le deploy
écrase la fixture à chaque sync.

## Projets — mécanique (P1)

**Source de vérité :** collection Zotero « Projets » (clé `RPZFWI9M`,
racine du groupe Konsilion 6610185, créée 11/10/26) — itemType
`document`. La donnée du repo est un dérivé régénéré par le pipeline.
La collection est dans `ZOTERO_EXCLUDE_COLLECTIONS` (anti-fuite
médiathèque, cf. `scripts/config.py`).

**Mapping Zotero → contrat du front (11 clés) :**

| Contrat | Zotero |
|---|---|
| `id` | `citationKey` (P000N, attribué automatiquement) |
| `titre` | `title` |
| `description` | `abstractNote` |
| `porteur` | `publisher` |
| `lieu` | `place` |
| `date_debut` / `date_fin` | `date` (split « / », OPTION B) |
| `lien` | `url` |
| `statut` | `extra`, ligne « Statut: … » |
| `categories` | `tags` |
| `date_ajout` | `dateAdded` (AAAA-MM-JJ) |

**Fetch :** `scripts/fetch_projets.py` lit la collection et écrit
`projets/data/projets.json` (tri déterministe par id ; collection
vide → `[]`, l'app affiche « Aucun projet pour le moment. »).

**Saisie (CEO) :** `scripts/ajouter_projet.py` crée l'item Zotero
sans toucher l'API à la main — citationKey P000N auto (scan max+1),
POST en échec vérifié, re-fetch de contrôle :

```bash
python3 scripts/ajouter_projet.py --titre "Où atterrir ?" \
  --porteur "Parlement de la rivière Isère" --statut "En cours" \
  --date-debut 2026-10-01 --categorie animation
```

Autres options : `--description`, `--lieu`, `--date-fin AAAA-MM-JJ`,
`--lien`, `--categorie` (répétable). Statuts conseillés :
« En cours », « À venir », « Terminé » (le front colore ces trois-là ;
sans statut, il déduit depuis les dates). Le projet est visible sur la
grille après le prochain fetch (deploy.sh ou tir horaire du timer).

## Déploiement

Depuis la racine du repo :

```bash
bash scripts/deploy.sh
# 1. fetch_zotero.py     -> mediatheque/data/collection.json
# 2. fetch_actualites.py -> actualites/data/actualites.json
# 3. fetch_contacts.py   -> contacts/data/contacts.json
# 4. fetch_projets.py    -> projets/data/projets.json
# puis commit des 4 data/ + push origin main
```

GitHub Pages resert en 1-2 minutes.

## Cron

- **Les 4 apps** : timer systemd user `grilles-parlement-sync`
  (horaire, :07) — exécute `scripts/deploy.sh` (4 fetchs + commit
  + push) sur ce repo.
- **Actualités** : cron Hermes quotidien 08:15 « Actualités du
  Parlement (grille) » — monitor du dossier mail + propositions
  numérotées au CEO sur Telegram ; validation par
  `python3 scripts/valider.py <numeros>`.

## Test local

```bash
python3 -m http.server 8125 --bind 127.0.0.1 --directory ~/grilles-parlement
# ARRÊTER le serveur après test — le bind 127.0.0.1 est OBLIGATOIRE
```

## Sécurité

- `scripts/config.py` (clé API Zotero) est dans `.gitignore` —
  **ne jamais le commiter** ; vérifier `git status -- scripts/config.py`
  avant chaque push.
- Aucune donnée privée dans le repo : métadonnées Zotero publiques
  et actualités validées uniquement.
