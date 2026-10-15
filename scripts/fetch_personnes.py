#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fetch_personnes.py — génère personnes/data/personnes.json depuis Zotero.

Carte C2 : l'app Personnes (front C3, ex-Contacts, renommée 15/10/26) consomme
personnes/data/personnes.json. Ce script lit la collection « Contacts » du
groupe Zotero 6610185 et restitue chaque item selon le contrat FIXE
consommé par le front :

  id (citationKey), nom (title), description (abstractNote),
  organisation (publisher), lieu (place), date_contact (date), lien (url),
  email / telephone / role (lignes « Email: », « Telephone: », « Role: » du
  champ extra ; absentes = chaîne vide), categories (tags),
  date_ajout (dateAdded coupé AAAA-MM-JJ)

items/top de la collection ne remonte PAS les sous-collections — sans objet
ici : la collection « Contacts » est racine du groupe, aucune
sous-collection (C1).

Ordre : tri déterministe par id (le front trie de toute façon ; un ordre
stable rend la sortie reproductible et les diffs lisibles — même choix que
fetch_actualites.py). UTF-8, liste JSON plate.

Usage :
  python3 scripts/fetch_personnes.py   # écrit personnes/data/personnes.json

Clé : lecture seule (coffre ~/sys_admin/secrets/client/zotero.key, sinon config de la
vitrine). Clé d'écriture jamais nécessaire ici. stdlib uniquement.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from zotero_api import DEFAULT_GROUP_ID, ZoteroClient, ZoteroError, load_key

REPO = Path(__file__).resolve().parent.parent
OUT_PATH = REPO / "personnes" / "data" / "personnes.json"

GROUP_ID = DEFAULT_GROUP_ID
CONTACTS_NAME = "Contacts"
EXPECTED_COLLECTION_KEY = "JI7JP8AZ"   # attendu (C1) — contrôle, pas source

# Lignes du champ extra -> clés du contrat (absentes = chaîne vide)
EXTRA_LABELS = {
    "email": "Email",
    "telephone": "Telephone",
    "role": "Role",
}


# ---------------------------------------------------------------- mapping

def parse_extra(extra):
    """extra multi-lignes -> {label: valeur} pour les lignes
    « Email: », « Telephone: », « Role: »."""
    out = {}
    for line in (extra or "").split("\n"):
        line = line.strip()
        if ":" in line:
            label, _, val = line.partition(":")
            out[label.strip()] = val.strip()
    return out


def item_to_record(item):
    """item Zotero (itemType document) -> dict du contrat C3."""
    data = item.get("data") or {}
    extra = parse_extra(data.get("extra"))
    tags = data.get("tags") or item.get("tags") or []
    categories = []
    for t in tags:
        label = (t.get("tag") or "").strip() if isinstance(t, dict) else ""
        if label:
            categories.append(label)
    rec = {
        "id": (data.get("citationKey") or "").strip(),
        "nom": (data.get("title") or "").strip(),
        "description": (data.get("abstractNote") or "").strip(),
        "organisation": (data.get("publisher") or "").strip(),
        "lieu": (data.get("place") or "").strip(),
        "date_contact": (data.get("date") or "").strip(),
        "lien": (data.get("url") or "").strip(),
    }
    for field, label in EXTRA_LABELS.items():
        rec[field] = extra.get(label, "").strip()
    rec["categories"] = categories
    rec["date_ajout"] = (data.get("dateAdded") or "")[:10]
    # Champs additifs pour l'agrégateur « Actualités » (dédoublonnage
    # inter-apps par zotero_key + tri par date de modification).
    rec["zotero_key"] = (item.get("key") or "").strip()
    rec["date_modif"] = (data.get("dateModified") or "")[:10]
    return rec


def find_contacts_key(client):
    """Clé de la collection Contacts par nom + contrôle de cohérence."""
    key = client.find_collection(CONTACTS_NAME)
    if key != EXPECTED_COLLECTION_KEY:
        raise ZoteroError(
            f"collection « {CONTACTS_NAME} » trouvée sous la clé {key}, "
            f"{EXPECTED_COLLECTION_KEY} attendue"
        )
    return key


# ---------------------------------------------------------------- main

def main():
    key = load_key(mode="read")
    client = ZoteroClient(key, GROUP_ID)

    ckey = find_contacts_key(client)
    items = client.collection_items_top(ckey)

    records = []
    seen_ids = set()
    for item in items:
        rec = item_to_record(item)
        if not rec["id"]:
            raise ZoteroError(
                f"item sans citationKey dans la collection : {item.get('key')}"
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
    print(f"[OK] collection « {CONTACTS_NAME} » ({ckey}) : {len(items)} items top")
    print(f"[OK] écrit {OUT_PATH} ({OUT_PATH.stat().st_size} octets, UTF-8)")
    if not records:
        print("[OK] collection vide -> personnes.json = []")
    for r in records:
        cats = ", ".join(r["categories"]) if r["categories"] else "—"
        print(f"  {r['id']} | {r['nom']} | {r['organisation'] or '—'} | {cats}")

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ZoteroError as e:
        print(f"ECHEC : {e}", file=sys.stderr)
        sys.exit(1)
