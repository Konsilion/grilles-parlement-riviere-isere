"""
Fetch médiathèque en PÉRIMÈTRE EXPLICITE : balaye l'arbre de la collection
« Médiathèque » (MCKNJI9M) et écrit mediatheque/data/collection.json.

Fonctionnement (garde-fou anti-fuite, 12/10/26) :
- liste les collections du groupe (/collections, clé→nom + parentCollection)
  puis construit par DFS l'arbre complet sous Médiathèque (racine + toutes
  ses sous-collections, à toute profondeur) ;
- récupère les items/top de CHAQUE collection de l'arbre et fait l'union
  dédupliquée par clé d'item ;
- PIÈGE API : /collections/MCKNJI9M/items/top NE REMONTE PAS les
  sous-collections — le balayage collection par collection est obligatoire ;
- une collection ou un item HORS de l'arbre Médiathèque ne peut pas fuiter
  dans le JSON, quel que soit son nom ou sa date de création (les arbres
  Actualités U4HFDR68, Contacts JI7JP8AZ et Projets RPZFWI9M vivent hors
  arbre et sont servis par leurs propres fetchs).

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
        "→ puis renseigne ZOTERO_GROUP_ID, ZOTERO_API_KEY"
    )

ZOTERO_GROUP_ID = config.ZOTERO_GROUP_ID
ZOTERO_API_KEY = config.ZOTERO_API_KEY

# Racine de l'arbre médiathèque : PÉRIMÈTRE EXPLICITE du fetch.
MEDIATHEQUE_COLLECTION_ID = "MCKNJI9M"

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


def fetch_json(url, api_key, params=None):
    """GET paginé sur l' API Zotero, retourne la liste complète des pages."""
    headers = {"Zotero-API-Key": api_key, "Zotero-API-Version": "3"}
    out = []
    start = 0
    limit = 100
    params = dict(params or {})
    while True:
        params.update({"format": "json", "start": start, "limit": limit})
        resp = requests.get(url, headers=headers, params=params, timeout=30)
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        out.extend(batch)
        if len(batch) < limit:
            break
        start += limit
    return out


def fetch_tree_collection_keys(group_id, root_key, api_key):
    """Périmètre explicite : DFS sous la collection racine → liste des clés
    de collections (racine incluse, toute profondeur).

    Basé sur parentCollection de /groups/<gid>/collections — l'arbre complet
    est recalculé à chaque tir, aucune sous-collection nouvelle ne peut être
    manquée (ni fuiter).
    """
    collections = fetch_json(
        f"{API_BASE}/groups/{group_id}/collections", api_key
    )
    children_of = {}
    for c in collections:
        parent = c["data"].get("parentCollection") or None
        children_of.setdefault(parent, []).append(c["key"])
    tree, queue = [root_key], list(children_of.get(root_key, []))
    while queue:
        k = queue.pop(0)
        if k not in tree:
            tree.append(k)
            queue.extend(children_of.get(k, []))
    return tree


def fetch_items(group_id, api_key):
    """Union dédupliquée par clé d'item des items/top de CHAQUE collection
    de l'arbre Médiathèque (périmètre explicite)."""
    keys = fetch_tree_collection_keys(group_id, MEDIATHEQUE_COLLECTION_ID, api_key)
    print(f"  Arbre « Médiathèque » {MEDIATHEQUE_COLLECTION_ID} : {len(keys)} collections")
    union = {}
    for ck in keys:
        items = fetch_json(
            f"{API_BASE}/groups/{group_id}/collections/{ck}/items/top", api_key
        )
        for it in items:
            union.setdefault(it["key"], it)
        print(f"    {ck}: {len(items)} items top")
    print(f"  Union dédupliquée : {len(union)} items")
    return list(union.values())


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
    raw_items = fetch_items(ZOTERO_GROUP_ID, ZOTERO_API_KEY)
    print(f"  {len(raw_items)} items bruts récupérés")

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
        "collection_id": MEDIATHEQUE_COLLECTION_ID,
        "count": len(formatted),
        "items": formatted,
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  ✓ Écrit : {out_path} ({out_path.stat().st_size} octets)")


if __name__ == "__main__":
    main()
