#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fetch_lieux.py — génère lieux/data/lieux.json depuis Zotero.

Application « Lieux » : le front lieux/ consomme
lieux/data/lieux.json. Ce script lit la collection
« Lieux » du groupe Zotero 6610185 et restitue chaque item
selon le contrat FIXE consommé par le front :

  id (citationKey L000N), nom (title), description (abstractNote),
  adresse (place), lien (url), categories (tags),
  date_ajout (dateAdded coupé AAAA-MM-JJ), zotero_key (clé racine de
  l'item Zotero), date_modif (dateModified coupé AAAA-MM-JJ) — ces deux
  derniers additifs, pour l'agrégateur « Actualités »

itemType document, collection racine du groupe (aucune
sous-collection : items/top suffit, calque contacts/projets).
AUCUN champ extra : le contrat Lieux n'en a pas (nul besoin
d'EXTRA_LABELS ni de parseur).

Ordre : tri déterministe par id (le front trie de toute façon ; un ordre
stable rend la sortie reproductible et les diffs lisibles — même choix
que fetch_contacts.py/fetch_projets.py). UTF-8, liste JSON plate.

Usage :
  python3 scripts/fetch_lieux.py    # écrit lieux/data/lieux.json

Clé : lecture seule (coffre ~/sys_admin/secrets/client/zotero.key, sinon config de
la vitrine). Clé d'écriture jamais nécessaire ici. stdlib uniquement.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from zotero_api import DEFAULT_GROUP_ID, ZoteroClient, ZoteroError, load_key

REPO = Path(__file__).resolve().parent.parent
OUT_PATH = REPO / "lieux" / "data" / "lieux.json"

GROUP_ID = DEFAULT_GROUP_ID
LIEUX_NAME = "Lieux"
EXPECTED_COLLECTION_KEY = "UMMXNXDJ"   # attendu — contrôle, pas source


# ---------------------------------------------------------------- mapping

def item_to_record(item):
    """item Zotero (itemType document) -> dict du contrat Lieux."""
    data = item.get("data") or {}
    tags = data.get("tags") or item.get("tags") or []
    categories = []
    for t in tags:
        label = (t.get("tag") or "").strip() if isinstance(t, dict) else ""
        if label:
            categories.append(label)
    return {
        "id": (data.get("citationKey") or "").strip(),
        "nom": (data.get("title") or "").strip(),
        "description": (data.get("abstractNote") or "").strip(),
        "adresse": (data.get("place") or "").strip(),
        "lien": (data.get("url") or "").strip(),
        "categories": categories,
        "date_ajout": (data.get("dateAdded") or "")[:10],
        # Champs additifs pour l'agrégateur « Actualités » (dédoublonnage
        # inter-apps par zotero_key + tri par date de modification).
        "zotero_key": (item.get("key") or "").strip(),
        "date_modif": (data.get("dateModified") or "")[:10],
    }


def find_lieux_key(client):
    """Clé de la collection Lieux par nom + contrôle de cohérence."""
    key = client.find_collection(LIEUX_NAME)
    if key != EXPECTED_COLLECTION_KEY:
        raise ZoteroError(
            f"collection « {LIEUX_NAME} » trouvée sous la clé {key}, "
            f"{EXPECTED_COLLECTION_KEY} attendue"
        )
    return key


# ---------------------------------------------------------------- main

def main():
    key = load_key(mode="read")
    client = ZoteroClient(key, GROUP_ID)

    ckey = find_lieux_key(client)
    items = client.collection_items_top(ckey)

    records = []
    seen_ids = set()
    for item in items:
        rec = item_to_record(item)
        if not rec["id"]:
            raise ZoteroError(
                f"item sans citationKey dans la collection : {item.get('key')}"
            )
        if not rec["nom"]:
            raise ZoteroError(
                f"item {rec['id']} sans nom : {item.get('key')}"
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
    print(f"[OK] collection « {LIEUX_NAME} » ({ckey}) : {len(items)} items top")
    print(f"[OK] écrit {OUT_PATH} ({OUT_PATH.stat().st_size} octets, UTF-8)")
    if not records:
        print("[OK] collection vide -> lieux.json = []")
    for r in records:
        cats = ", ".join(r["categories"]) if r["categories"] else "—"
        print(f"  {r['id']} | {r['nom']} | {r['adresse'] or '—'} | {cats}")

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ZoteroError as e:
        print(f"ECHEC : {e}", file=sys.stderr)
        sys.exit(1)
