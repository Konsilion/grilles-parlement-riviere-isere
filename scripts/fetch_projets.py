#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fetch_projets.py — génère projets/data/projets.json depuis Zotero.

Application « Projets » (P1) : le front projets/ consomme
projets/data/projets.json. Ce script lit la collection « Projets » du
groupe Zotero 6610185 et restitue chaque item selon le contrat FIXE
consommé par le front :

  id (citationKey P000N), titre (title), description (abstractNote),
  porteur (publisher), lieu (place),
  date_debut/date_fin (champ date : split « / », OPTION B — calque
  fetch_actualites.py), lien (url), statut (ligne « Statut: » du champ
  extra ; absente = chaîne vide, le front déduit alors des dates),
  categories (tags), date_ajout (dateAdded coupé AAAA-MM-JJ)

itemType document, collection racine du groupe (aucune
sous-collection : items/top suffit, calque contacts).

Ordre : tri déterministe par id (le front trie de toute façon ; un ordre
stable rend la sortie reproductible et les diffs lisibles — même choix
que fetch_contacts.py). UTF-8, liste JSON plate.

Usage :
  python3 scripts/fetch_projets.py    # écrit projets/data/projets.json

Clé : lecture seule (coffre ~/sys_admin/secrets/client/zotero.key, sinon config de
la vitrine). Clé d'écriture jamais nécessaire ici. stdlib uniquement.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from zotero_api import DEFAULT_GROUP_ID, ZoteroClient, ZoteroError, load_key

REPO = Path(__file__).resolve().parent.parent
OUT_PATH = REPO / "projets" / "data" / "projets.json"

GROUP_ID = DEFAULT_GROUP_ID
PROJETS_NAME = "Projets"
EXPECTED_COLLECTION_KEY = "RPZFWI9M"   # attendu (P1) — contrôle, pas source

# Lignes du champ extra -> clés du contrat (absentes = chaîne vide)
EXTRA_LABELS = {
    "statut": "Statut",
}


# ---------------------------------------------------------------- mapping

def parse_extra(extra):
    """extra multi-lignes -> {label: valeur} pour la ligne « Statut: »."""
    out = {}
    for line in (extra or "").split("\n"):
        line = line.strip()
        if ":" in line:
            label, _, val = line.partition(":")
            out[label.strip()] = val.strip()
    return out


def parse_date(date_field):
    """date Zotero -> (date_debut, date_fin). Split sur « / » (OPTION B).

    « 2026-09-01 »                    -> ("2026-09-01", "")
    « 2026-09-01/2027-06-30 »         -> ("2026-09-01", "2027-06-30")
    """
    s = (date_field or "").strip()
    if not s:
        return "", ""
    if "/" in s:
        parts = s.split("/", 1)
        return parts[0].strip(), parts[1].strip()
    return s, ""


def item_to_record(item):
    """item Zotero (itemType document) -> dict du contrat P3."""
    data = item.get("data") or {}
    extra = parse_extra(data.get("extra"))
    debut, fin = parse_date(data.get("date"))
    tags = data.get("tags") or item.get("tags") or []
    categories = []
    for t in tags:
        label = (t.get("tag") or "").strip() if isinstance(t, dict) else ""
        if label:
            categories.append(label)
    rec = {
        "id": (data.get("citationKey") or "").strip(),
        "titre": (data.get("title") or "").strip(),
        "description": (data.get("abstractNote") or "").strip(),
        "porteur": (data.get("publisher") or "").strip(),
        "lieu": (data.get("place") or "").strip(),
        "date_debut": debut,
        "date_fin": fin,
        "lien": (data.get("url") or "").strip(),
    }
    for field, label in EXTRA_LABELS.items():
        rec[field] = extra.get(label, "").strip()
    rec["categories"] = categories
    rec["date_ajout"] = (data.get("dateAdded") or "")[:10]
    return rec


def find_projets_key(client):
    """Clé de la collection Projets par nom + contrôle de cohérence."""
    key = client.find_collection(PROJETS_NAME)
    if key != EXPECTED_COLLECTION_KEY:
        raise ZoteroError(
            f"collection « {PROJETS_NAME} » trouvée sous la clé {key}, "
            f"{EXPECTED_COLLECTION_KEY} attendue"
        )
    return key


# ---------------------------------------------------------------- main

def main():
    key = load_key(mode="read")
    client = ZoteroClient(key, GROUP_ID)

    ckey = find_projets_key(client)
    items = client.collection_items_top(ckey)

    records = []
    seen_ids = set()
    for item in items:
        rec = item_to_record(item)
        if not rec["id"]:
            raise ZoteroError(
                f"item sans citationKey dans la collection : {item.get('key')}"
            )
        if not rec["titre"]:
            raise ZoteroError(
                f"item {rec['id']} sans titre : {item.get('key')}"
            )
        if rec["id"] in seen_ids:
            raise ZoteroError(f"citationKey dupliqué dans la collection : {rec['id']}")
        seen_ids.add(rec["id"])
        records.append(rec)

    # Ordre : tri déterministe par id (le front trie de toute façon ; un ordre
    # stable rend la sortie reproductible et les diffs lisibles).
    records.sort(key=lambda r: r["id"])

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    # relevé
    print(f"[OK] collection « {PROJETS_NAME} » ({ckey}) : {len(items)} items top")
    print(f"[OK] écrit {OUT_PATH} ({OUT_PATH.stat().st_size} octets, UTF-8)")
    if not records:
        print("[OK] collection vide -> projets.json = []")
    for r in records:
        dates = r["date_debut"] + (f" → {r['date_fin']}" if r["date_fin"] else "")
        print(f"  {r['id']} | {r['statut'] or '—'} | {dates} | {r['titre'][:60]}"
              + ("…" if len(r["titre"]) > 60 else ""))

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ZoteroError as e:
        print(f"ECHEC : {e}", file=sys.stderr)
        sys.exit(1)
