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
│   └── data/actualites.csv     # source de vérité actuelle (→ JSON après migration)
│       data/pending_proposals.json
├── common/                 # code mutualisé des deux apps (populé par K5)
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
année/mois, recherche floue, pagination.

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
