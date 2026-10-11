#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Affiche les actualités validées (data/actualites.json) — contrôle rapide.

Depuis la bascule K6 (11/10/26) : la source affichée par la grille est
actualites/data/actualites.json, régénéré depuis la collection Zotero
« Actualités » par scripts/fetch_actualites.py (l'ancien
data/actualites.csv reste dans le repo à titre historique).
Interface inchangée : python3 scripts/lister.py
"""
import json
import sys
from pathlib import Path

JSON_PATH = Path(__file__).resolve().parent.parent / "actualites" / "data" / "actualites.json"

TYPE_LABELS = {
    "evenement_a_venir": "Événement à venir",
    "ressource_publiee": "Ressource publiée",
    "evenement_passe": "Événement passé",
    "information_parlement": "Information du parlement",
}


def main():
    if not JSON_PATH.exists():
        print("Fichier absent :", JSON_PATH)
        return 1
    items = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    if not items:
        print("Aucune actualité validée (JSON vide).")
        return 0
    print(f"{len(items)} actualité(s) validée(s) :")
    for r in items:
        typ = TYPE_LABELS.get(r.get("type", ""), r.get("type", ""))
        print(f"\n  [{r['id']}] {r['titre']}")
        dates = r.get("date_debut") or "—"
        if r.get("date_fin"):
            dates += f" → {r['date_fin']}"
        print(f"      dates      : {dates} · lieu : {r.get('lieu') or '—'}")
        print(f"      lien       : {r.get('lien') or '—'}")
        print(f"      ajouté le  : {r.get('date_ajout') or '—'} · type : {typ}")
        print(f"      résumé     : {r.get('description') or ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
