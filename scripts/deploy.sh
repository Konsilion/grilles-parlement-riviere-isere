#!/usr/bin/env bash
# deploy.sh — synchronise Zotero (les NEUF apps), commit et push.
#
# Étendu (5e grille, 12/10/26) : les NEUF fetchs —
#   1. scripts/fetch_zotero.py           -> mediatheque/data/collection.json
#   2. scripts/fetch_contacts.py         -> contacts/data/contacts.json
#   3. scripts/fetch_projets.py          -> projets/data/projets.json
#   4. scripts/fetch_organisations.py    -> organisations/data/organisations.json
#   5. scripts/fetch_outils.py           -> outiltheque/data/outils.json
#   6. scripts/fetch_lieux.py            -> lieux/data/lieux.json
#   7. scripts/fetch_questions.py        -> questions/data/questions.json
#   8. scripts/fetch_idees.py            -> idees/data/idees.json
#   9. scripts/fetch_actualites.py       -> actualites/data/actualites.json
#      (EN DERNIER : il agrège les 8 data/*.json fraîchement régénérés)
# puis commit des neuf data/ et push vers GitHub Pages.
#
# Usage:
#   bash scripts/deploy.sh             # exécution réelle
#   bash scripts/deploy.sh --dry-run   # affiche les étapes sans rien exécuter
set -euo pipefail

cd "$(dirname "$0")/.."
DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then
    DRY_RUN=1
elif [ $# -gt 0 ]; then
    echo "Usage : bash scripts/deploy.sh [--dry-run]" >&2
    exit 2
fi

echo "══════════════════════════════════════════════"
echo "  Grilles Parlement — déploiement GitHub Pages"
echo "  (les 9 applications)"
echo "══════════════════════════════════════════════"

# 1. Vérifier config.py (clé lecture pour fetch_zotero.py — jamais commitée)
if [ ! -f scripts/config.py ]; then
    echo "✗ scripts/config.py introuvable. Lance d'abord : cp scripts/config.example.py scripts/config.py"
    exit 1
fi

# 2. Vérifier requests (fetch_zotero.py en dépend ; les autres fetchs sont stdlib)
if ! python3 -c "import requests" 2>/dev/null; then
    if [ "$DRY_RUN" = "1" ]; then
        echo "✗ requests absent (nécessaire à fetch_zotero.py) : pip install requests"
        exit 1
    fi
    echo "→ Installation de requests…"
    python3 -m pip install --user requests -q
fi

if [ "$DRY_RUN" = "1" ]; then
    echo ""
    echo "[DRY-RUN] Étapes qui seraient exécutées :"
    echo "  1-8. les HUIT fetchs sources (fetch_zotero, fetch_contacts,"
    echo "        fetch_projets, fetch_organisations, fetch_outils, fetch_lieux,"
    echo "        fetch_questions, fetch_idees) — chaque script présent est exécuté"
    echo "  9. fetch_actualites.py EN DERNIER (agrège les 8 data/*.json"
    echo "        fraîchement régénérés) — script présent exécuté"
    echo "  10. git add des data/*.json présents + commit + push origin main"
    exit 0
fi

# 3. Les NEUF fetchs Zotero (fetch_actualites EN DERNIER : il agrège
#    les 8 data/*.json fraîchement régénérés par les fetchs précédents)
run_fetch() {
    # $1 = nom du script, $2 = libellé
    if [ -f "scripts/$1" ]; then
        echo ""
        echo "→ Fetch $2 (scripts/$1)…"
        python3 "scripts/$1"
    else
        echo ""
        echo "→ Fetch $2 (scripts/$1) absent — ignoré (app non déployée)"
    fi
}

run_fetch fetch_zotero.py "médiathèque"
run_fetch fetch_contacts.py "contacts"
run_fetch fetch_projets.py "projets"
run_fetch fetch_organisations.py "organisations"
run_fetch fetch_outils.py "outilthèque"
run_fetch fetch_lieux.py "lieux"
run_fetch fetch_questions.py "questions"
run_fetch fetch_idees.py "idées"
run_fetch fetch_actualites.py "actualités (agrégation des 8 autres apps)"

# 4. Commit + push des data/ présents (le timer horaire ne pousse JAMAIS
#    les pending_proposals.json — règle anti-fuite message-ids)
echo ""
echo "→ Mise à jour du dépôt Git…"
DATA_FILES=()
for f in mediatheque/data/collection.json actualites/data/actualites.json \
         contacts/data/contacts.json projets/data/projets.json \
         organisations/data/organisations.json outiltheque/data/outils.json \
         lieux/data/lieux.json questions/data/questions.json idees/data/idees.json; do
    [ -f "$f" ] && DATA_FILES+=("$f")
done
git add "${DATA_FILES[@]}"
git commit -m "Mise à jour Zotero (les 9 applications) ($(date '+%Y-%m-%d %H:%M'))" || {
    echo "  Aucun changement à committer (données inchangées)."
    exit 0
}
git push origin main

echo ""
echo "✓ Déploié ! GitHub Pages se met à jour dans 1-2 minutes."
echo "  URL: https://konsilion.github.io/grilles-parlement-riviere-isere/"
