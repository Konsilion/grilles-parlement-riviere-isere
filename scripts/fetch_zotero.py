"""
Récupère les items d'un groupe Zotero via l'API et écrit mediatheque/data/collection.json.

Si ZOTERO_COLLECTION_ID est renseigné : récupère les items de cette collection.
Si ZOTERO_COLLECTION_ID est vide      : récupère tous les items top-level du groupe.
Si ZOTERO_EXCLUDE_COLLECTIONS est renseigné (liste de clés) : exclut les items
de ces collections (filtre anti-fuite — les items « Actualités » et « Contacts »
vivent dans leurs collections dédiées, servies par leurs propres fetchs, pas ici).
L'ancienne forme scalaire ZOTERO_EXCLUDE_COLLECTION reste acceptée (transition).

Usage:
    python scripts/fetch_zotero.py
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

# Charger la config locale (jamais commitée)
sys.path.insert(0, str(Path(__file__).parent))
try:
    import config
except ImportError:
    sys.exit(
        "Fichier config.py introuvable.\n"
        "→ cp scripts/config.example.py scripts/config.py\n"
        "→ puis renseigne ZOTERO_GROUP_ID, ZOTERO_API_KEY, ZOTERO_COLLECTION_ID\n"
        "→ (optionnel) ZOTERO_EXCLUDE_COLLECTIONS : clés des collections à exclure"
    )

ZOTERO_GROUP_ID = config.ZOTERO_GROUP_ID
ZOTERO_API_KEY = config.ZOTERO_API_KEY
ZOTERO_COLLECTION_ID = config.ZOTERO_COLLECTION_ID

# Filtre anti-fuite : collections exclues du fetch médiathèque.
# Forme de référence : ZOTERO_EXCLUDE_COLLECTIONS (liste).
# Ancienne forme acceptée pendant la transition : scalaire ZOTERO_EXCLUDE_COLLECTION.
ZOTERO_EXCLUDE_COLLECTIONS = getattr(config, "ZOTERO_EXCLUDE_COLLECTIONS", None)
if ZOTERO_EXCLUDE_COLLECTIONS is None:
    ZOTERO_EXCLUDE_COLLECTIONS = getattr(config, "ZOTERO_EXCLUDE_COLLECTION", "") or []
if isinstance(ZOTERO_EXCLUDE_COLLECTIONS, str):
    ZOTERO_EXCLUDE_COLLECTIONS = (
        [ZOTERO_EXCLUDE_COLLECTIONS] if ZOTERO_EXCLUDE_COLLECTIONS else []
    )
ZOTERO_EXCLUDE_COLLECTIONS = [c for c in ZOTERO_EXCLUDE_COLLECTIONS if c]

# Valider que la config est remplie
missing = [
    name for name, val in [
        ("ZOTERO_GROUP_ID", ZOTERO_GROUP_ID),
        ("ZOTERO_API_KEY", ZOTERO_API_KEY),
    ] if not val
]
if missing:
    sys.exit(f"Valeurs manquantes dans config.py : {', '.join(missing)}")

API_BASE = "https://api.zotero.org"


def fetch_items(group_id, collection_id, api_key):
    """Récupère tous les items top-level d'un groupe (ou d'une collection du groupe)."""
    items = []
    start = 0
    limit = 100
    headers = {"Zotero-API-Key": api_key, "Zotero-API-Version": "3"}

    if collection_id:
        base_url = f"{API_BASE}/groups/{group_id}/collections/{collection_id}/items/top"
        label = f"collection {collection_id}"
    else:
        base_url = f"{API_BASE}/groups/{group_id}/items/top"
        label = "toutes les collections (racine du groupe)"

    print(f"  Endpoint: {label}")

    while True:
        url = f"{base_url}?format=json&start={start}&limit={limit}"
        resp = requests.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        items.extend(batch)
        if len(batch) < limit:
            break
        start += limit

    return items


def fetch_collections(group_id, api_key):
    """Récupère toutes les collections du groupe et renvoie {clé: nom}."""
    collections = {}
    start = 0
    limit = 100
    headers = {"Zotero-API-Key": api_key, "Zotero-API-Version": "3"}
    while True:
        url = f"{API_BASE}/groups/{group_id}/collections?format=json&start={start}&limit={limit}"
        resp = requests.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        for c in batch:
            collections[c["key"]] = (c["data"].get("name") or "").strip()
        if len(batch) < limit:
            break
        start += limit
    return collections


def format_item(raw, collection_map=None):
    """Convertit un item brut Zotero en dictionnaire léger pour le front."""
    data = raw.get("data", {})
    # champ de titre selon le type : email→subject, statute→nameOfAct, sinon title
    title = (data.get("title") or data.get("subject") or data.get("nameOfAct") or "").strip()
    if not title:
        return None

    item_type = data.get("itemType", "")
    type_fr = TYPE_FR_MAP.get(item_type, item_type or "Document")

    authors = []
    for c in data.get("creators", []):
        if c.get("name"):
            authors.append(c["name"])
        else:
            first = c.get("firstName", "").strip()
            last = c.get("lastName", "").strip()
            full = f"{first} {last}".strip()
            if full:
                authors.append(full)

    year = None
    for date_field in ("date", "dateAdded", "issued"):
        val = data.get(date_field, "")
        if val and len(val) >= 4 and val[:4].isdigit():
            year = val[:4]
            break

    tags = [t.get("tag", "").strip() for t in data.get("tags", []) if t.get("tag")]

    # Tags dérivés des collections Zotero réelles de l'item (le groupe est
    # structuré par collections, presque pas de tags manuels : la sidebar
    # « Tags » de la vitrine doit refléter cette organisation réelle).
    if collection_map:
        for ckey in data.get("collections", []):
            cname = collection_map.get(ckey)
            if cname and cname not in tags:
                tags.append(cname)
    doi = (data.get("DOI") or "").strip() or None
    url = (data.get("url") or "").strip() or None

    return {
        "key": raw.get("key"),
        "title": title,
        "authors": authors,
        "year": year,
        "type": type_fr,
        "abstract": (data.get("abstractNote") or "").strip(),
        "tags": tags,
        "doi": doi,
        "url": url,
        "dateAdded": data.get("dateAdded", "")[:10] if data.get("dateAdded") else None,
    }


TYPE_FR_MAP = {
    "book": "Livre",
    "bookSection": "Chapitre de livre",
    "journalArticle": "Article de revue",
    "magazineArticle": "Article de magazine",
    "newspaperArticle": "Article de presse",
    "thesis": "Thèse",
    "report": "Rapport",
    "conferencePaper": "Communication",
    "document": "Document",
    "webpage": "Page web",
    "manuscript": "Manuscrit",
    "dataset": "Jeu de données",
    "preprint": "Pré-publication",
    "encyclopediaArticle": "Article d'encyclopédie",
    "dictionaryEntry": "Entrée de dictionnaire",
    "presentation": "Présentation",
    "videoRecording": "Vidéo",
    "audioRecording": "Audio",
    "radioBroadcast": "Audio",
    "podcast": "Audio",
    "reportSeries": "Série de rapports",
    "email": "Newsletter",
    "letter": "Lettre",
    "map": "Carte",
    "statute": "Texte de loi",
}


def main():
    print(f"→ Récupération depuis le groupe {ZOTERO_GROUP_ID}…")
    collection_map = fetch_collections(ZOTERO_GROUP_ID, ZOTERO_API_KEY)
    print(f"  {len(collection_map)} collections récupérées")
    raw_items = fetch_items(ZOTERO_GROUP_ID, ZOTERO_COLLECTION_ID, ZOTERO_API_KEY)
    print(f"  {len(raw_items)} items bruts récupérés")

    # Filtre anti-fuite : exclure les items des collections configurées
    # (ex. Actualités, Contacts) — le scoping par collection dans l'API ne
    # remonte pas les sous-collections, on filtre donc côté script après le
    # fetch complet.
    if ZOTERO_EXCLUDE_COLLECTIONS:
        exclude = set(ZOTERO_EXCLUDE_COLLECTIONS)
        raw_items = [
            r for r in raw_items
            if not exclude & set(r.get("data", {}).get("collections", []))
        ]
        print(f"  {len(raw_items)} items après exclusion des collections "
              f"{', '.join(sorted(exclude))}")

    formatted = [
        it for it in (format_item(r, collection_map) for r in raw_items) if it is not None
    ]
    print(f"  {len(formatted)} items retenus (avec titre)")

    out_path = (
        Path(__file__).resolve().parent.parent / "mediatheque" / "data" / "collection.json"
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "collection_id": ZOTERO_COLLECTION_ID or "all",
        "count": len(formatted),
        "items": formatted,
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  ✓ Écrit : {out_path} ({out_path.stat().st_size} octets)")


if __name__ == "__main__":
    main()