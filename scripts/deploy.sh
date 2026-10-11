#!/usr/bin/env bash
# deploy.sh — synchronise Zotero (médiathèque + actualités), commit et push.
#
# Étendu (K4) : les DEUX fetchs —
#   1. scripts/fetch_zotero.py      -> mediatheque/data/collection.json
#   2. scripts/fetch_actualites.py  -> actualites/data/actualites.json
# puis commit des deux data/ et push vers GitHub Pages.
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

echo "══════════════════════════════════════════════════"
echo "  Grilles Parlement — déploiement GitHub Pages"
echo "  (médiathèque + actualités)"
echo "══════════════════════════════════════════════════"

# 1. Vérifier config.py (clé lecture pour fetch_zotero.py — jamais commitée)
if [ ! -f scripts/config.py ]; then
    echo "✗ scripts/config.py introuvable. Lance d'abord : cp scripts/config.example.py scripts/config.py"
    exit 1
fi

# 2. Vérifier requests (fetch_zotero.py en dépend ; fetch_actualites.py est stdlib)
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
    echo "  1. python3 scripts/fetch_zotero.py      -> mediatheque/data/collection.json"
    echo "  2. python3 scripts/fetch_actualites.py  -> actualites/data/actualites.json"
    echo "  3. git add mediatheque/data/collection.json actualites/data/actualites.json"
    echo "  4. git commit + push origin main"
    exit 0
fi

# 3. Les DEUX fetchs Zotero
echo ""
echo "→ Fetch médiathèque (fetch_zotero.py)…"
python3 scripts/fetch_zotero.py

echo ""
echo "→ Fetch actualités (fetch_actualites.py)…"
python3 scripts/fetch_actualites.py

# 4. Commit + push des deux data/
echo ""
echo "→ Mise à jour du dépôt Git…"
git add mediatheque/data/collection.json actualites/data/actualites.json
git commit -m "Mise à jour Zotero (médiathèque + actualités) ($(date '+%Y-%m-%d %H:%M'))" || {
    echo "  Aucun changement à committer (données inchangées)."
    exit 0
}
git push origin main

echo ""
echo "✓ Déploié ! GitHub Pages se met à jour dans 1-2 minutes."
echo "  URL: https://konsilion.github.io/grilles-parlement-riviere-isere/"
