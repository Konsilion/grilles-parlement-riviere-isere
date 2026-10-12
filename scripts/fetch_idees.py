#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fetch_idees.py — génère idees/data/idees.json depuis Zotero.

Application « Idées » : le front idees/ consomme
idees/data/idees.json. Ce script lit la collection
« Idées » du groupe Zotero 6610185 et restitue chaque item
selon le contrat FIXE consommé par le front :

  id (citationKey I000N), titre (title), description (abstractNote),
  auteur (ligne « Auteur: » du champ extra, libellé SANS accents,
  exactement « Auteur: » ; absente = chaîne vide),
  lien (url), categories (tags),
  date_ajout (dateAdded coupé AAAA-MM-JJ), zotero_key (clé racine de
  l'item Zotero), date_modif (dateModified coupé AAAA-MM-JJ) — ces deux
  derniers additifs, pour l'agrégateur « Actualités »

itemType document, collection racine du groupe (aucune
sous-collection : items/top suffit, calque organisations).

Spécificité métier (intention CEO) : les idées sont des
propositions ADRESSÉES au Parlement de la rivière Isère (pas des
projets internes déjà lancés — ça c'est Projets).

Ordre : tri déterministe par id (le front trie de toute façon ; un ordre
stable rend la sortie reproductible et les diffs lisibles — même choix
que fetch_organisations.py). UTF-8, liste JSON plate.

Usage :
  python3 scripts/fetch_idees.py    # écrit idees/data/idees.json

Clé : lecture seule (coffre ~/sys_admin/secrets/client/zotero.key, sinon config de
la vitrine). Clé d'écriture jamais nécessaire ici. stdlib uniquement.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from zotero_api import DEFAULT_GROUP_ID, ZoteroClient, ZoteroError, load_key

REPO = Path(__file__).resolve().parent.parent
OUT_PATH = REPO / "idees" / "data" / "idees.json"

GROUP_ID = DEFAULT_GROUP_ID
IDEES_NAME = "Idées"
EXPECTED_COLLECTION_KEY = "99X4HHIB"   # attendu — contrôle, pas source

# Lignes du champ extra -> clés du contrat (absentes = chaîne vide)
EXTRA_LABELS = {
    "auteur": "Auteur",
}


# ---------------------------------------------------------------- mapping

def parse_extra(extra):
    """extra multi-lignes -> {label: valeur} pour la ligne « Auteur: »."""
    out = {}
    for line in (extra or "").split("\n"):
        line = line.strip()
        if ":" in line:
            label, _, val = line.partition(":")
            out[label.strip()] = val.strip()
    return out


def item_to_record(item):
    """item Zotero (itemType document) -> dict du contrat Idées."""
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
        "titre": (data.get("title") or "").strip(),
        "description": (data.get("abstractNote") or "").strip(),
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


def find_idees_key(client):
    """Clé de la collection Idées par nom + contrôle de cohérence."""
    key = client.find_collection(IDEES_NAME)
    if key != EXPECTED_COLLECTION_KEY:
        raise ZoteroError(
            f"collection « {IDEES_NAME} » trouvée sous la clé {key}, "
            f"{EXPECTED_COLLECTION_KEY} attendue"
        )
    return key


# ---------------------------------------------------------------- main

def main():
    key = load_key(mode="read")
    client = ZoteroClient(key, GROUP_ID)

    ckey = find_idees_key(client)
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
    print(f"[OK] collection « {IDEES_NAME} » ({ckey}) : {len(items)} items top")
    print(f"[OK] écrit {OUT_PATH} ({OUT_PATH.stat().st_size} octets, UTF-8)")
    if not records:
        print("[OK] collection vide -> idees.json = []")
    for r in records:
        cats = ", ".join(r["categories"]) if r["categories"] else "—"
        print(f"  {r['id']} | {r['titre']} | {r['auteur'] or '—'} | {cats}")

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ZoteroError as e:
        print(f"ECHEC : {e}", file=sys.stderr)
        sys.exit(1)
