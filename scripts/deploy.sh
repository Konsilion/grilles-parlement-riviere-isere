#!/usr/bin/env bash
# deploy.sh — synchronise Zotero, commit et push vers GitHub Pages.
# Usage: bash deploy.sh
set -euo pipefail

cd "$(dirname "$0")"

echo "══════════════════════════════════════════════════"
echo "  Zotero Vitrine — déploiement GitHub Pages"
echo "══════════════════════════════════════════════════"

# 1. Vérifier config.py
if [ ! -f scripts/config.py ]; then
    echo "✗ config.py introuvable. Lance d'abord : cp scripts/config.example.py scripts/config.py"
    exit 1
fi

# 2. Vérifier requests
if ! python3 -c "import requests" 2>/dev/null; then
    echo "→ Installation de requests…"
    pip install requests -q
fi

# 3. Synchroniser Zotero
echo ""
echo "→ Synchronisation avec Zotero…"
python3 scripts/fetch_zotero.py

# 4. Commit + push
echo ""
echo "→ Mise à jour du dépôt Git…"
git add data/collection.json
git commit -m "Mise à jour collection Zotero ($(date '+%Y-%m-%d %H:%M'))" || {
    echo "  Aucun changement à committer (collection inchangée)."
    exit 0
}
git push origin main

echo ""
echo "✓ Déploié ! GitHub Pages se met à jour dans 1-2 minutes."
echo "  URL: https://konsilion.github.io/zotero-parlement-riviere-isere/"