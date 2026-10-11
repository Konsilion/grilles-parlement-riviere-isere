# Grilles de carte — Parlement de la rivière Isère

Repo unique portant les **deux applications « Grilles de carte »** du
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
├── index.html              # accueil : 2 liens vers les deux apps
├── mediatheque/            # ex-vitrine Zotero (git mv — historique conservé)
│   ├── index.html, js/app.js, css/style.css
│   └── data/collection.json    # généré par scripts/fetch_zotero.py
├── actualites/             # ex-app actualités (copie — historique dans l'ancien repo)
│   ├── index.html, js/app.js, css/style.css
│   └── data/actualites.json    # généré par scripts/fetch_actualites.py (K4)
│       data/actualites.csv      # historique (migration Zotero en cours)
│       data/pending_proposals.json
├── common/                 # code mutualisé des deux apps (K5)
│   ├── css/base.css         # tokens, thème clair unique, pagination, dropdowns, pastilles
│   └── js/                  # dom.js (esc/dates), search.js (fuzzy), pagination.js, dropdown.js
├── scripts/
│   ├── fetch_zotero.py     # médiathèque : API Zotero → mediatheque/data/collection.json
│   ├── config.example.py   # template de credentials (config.py = .gitignore, JAMAIS commité)
│   ├── deploy.sh           # médiathèque : fetch + commit + push
│   ├── valider.py          # actualités : validation CEO par numéros
│   └── lister.py           # actualités : affichage des propositions / actualités
├── README.md
├── .gitignore              # DOIT couvrir scripts/config.py (clé API — push = incident)
└── .nojekyll
```

## Les deux applications

**Médiathèque** (`/mediatheque/`) — collection du groupe Zotero
Konsilion (6610185) en cartes type e-commerce : recherche floue,
filtres type/année/tags, pagination, modale de détail.

**Actualités** (`/actualites/`) — grille des actualités du Parlement
(événements à venir/passés, ressources, informations), filtres
année/mois, recherche floue, pagination. Les données viennent de
`data/actualites.json`, généré depuis la collection Zotero
« Actualités » par `scripts/fetch_actualites.py`.

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

### Fixture `actualites/data/actualites.json`

Le fichier commis est une **fixture de développement** générée
une fois depuis le CSV historique (12 items, mêmes noms de
champs) pour que le front fonctionne avant la bascule. En
production, il est **régénéré** par `scripts/fetch_actualites.py`
(K4) depuis la collection Zotero « Actualités » — le deploy
écrase la fixture à chaque sync.

## Déploiement

Médiathèque (depuis la racine du repo) :

```bash
python3 scripts/fetch_zotero.py   # → mediatheque/data/collection.json
git add mediatheque/data/collection.json
git commit -m "Mise à jour collection Zotero"
git push origin main
```

GitHub Pages resert en 1-2 minutes.

## Cron

- **Médiathèque** : timer systemd user `zotero-vitrine-sync` (horaire,
  :07) — opère encore sur l'ancien repo `~/zotero-vitrine` jusqu'à la
  bascule ; ce repo prendra le relais à la bascule finale.
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
