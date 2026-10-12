#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fetch_questions.py — génère questions/data/questions.json depuis Zotero.

Application « Questions » : le front questions/ consomme
questions/data/questions.json. Ce script lit la collection
« Questions » du groupe Zotero 6610185 et restitue chaque item
selon le contrat FIXE consommé par le front :

  id (citationKey Q000N), titre (title), question (ligne
  « Question: » du champ extra, libellé ANGLAIS sans accents ;
  absente = chaîne vide), description (abstractNote), lien (url),
  deposant (ligne « Deposant: » du champ extra ; absente = chaîne
  vide), categories (tags), date_ajout (dateAdded coupé AAAA-MM-JJ)

itemType document, collection racine du groupe (aucune
sous-collection : items/top suffit, calque organisations/contacts).

Spécificité métier : une question est posée par quelqu'un
(deposant) ; les réponses vivront dans le fil de l'issue GitHub du
parcours contribution, pas dans la fiche.

Ordre : tri déterministe par id (le front trie de toute façon ; un ordre
stable rend la sortie reproductible et les diffs lisibles — même choix
que fetch_organisations.py). UTF-8, liste JSON plate.

Usage :
  python3 scripts/fetch_questions.py    # écrit questions/data/questions.json

Clé : lecture seule (coffre ~/sys_admin/secrets/client/zotero.key, sinon config de
la vitrine). Clé d'écriture jamais nécessaire ici. stdlib uniquement.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from zotero_api import DEFAULT_GROUP_ID, ZoteroClient, ZoteroError, load_key

REPO = Path(__file__).resolve().parent.parent
OUT_PATH = REPO / "questions" / "data" / "questions.json"

GROUP_ID = DEFAULT_GROUP_ID
QUESTIONS_NAME = "Questions"
EXPECTED_COLLECTION_KEY = "6IEE7MF2"   # attendu — contrôle, pas source

# Lignes du champ extra -> clés du contrat (absentes = chaîne vide)
EXTRA_LABELS = {
    "question": "Question",
    "deposant": "Deposant",
}


# ---------------------------------------------------------------- mapping

def parse_extra(extra):
    """extra multi-lignes -> {label: valeur} pour les lignes
    « Question: » et « Deposant: »."""
    out = {}
    for line in (extra or "").split("\n"):
        line = line.strip()
        if ":" in line:
            label, _, val = line.partition(":")
            out[label.strip()] = val.strip()
    return out


def item_to_record(item):
    """item Zotero (itemType document) -> dict du contrat Questions."""
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
    return rec


def find_questions_key(client):
    """Clé de la collection Questions par nom + contrôle de cohérence."""
    key = client.find_collection(QUESTIONS_NAME)
    if key != EXPECTED_COLLECTION_KEY:
        raise ZoteroError(
            f"collection « {QUESTIONS_NAME} » trouvée sous la clé {key}, "
            f"{EXPECTED_COLLECTION_KEY} attendue"
        )
    return key


# ---------------------------------------------------------------- main

def main():
    key = load_key(mode="read")
    client = ZoteroClient(key, GROUP_ID)

    ckey = find_questions_key(client)
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
        if not rec["question"]:
            raise ZoteroError(
                f"item {rec['id']} sans ligne « Question: » dans extra : "
                f"{item.get('key')}"
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
    print(f"[OK] collection « {QUESTIONS_NAME} » ({ckey}) : {len(items)} items top")
    print(f"[OK] écrit {OUT_PATH} ({OUT_PATH.stat().st_size} octets, UTF-8)")
    if not records:
        print("[OK] collection vide -> questions.json = []")
    for r in records:
        cats = ", ".join(r["categories"]) if r["categories"] else "—"
        print(f"  {r['id']} | {r['titre']} | {r['deposant'] or '—'} | {cats}")

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ZoteroError as e:
        print(f"ECHEC : {e}", file=sys.stderr)
        sys.exit(1)
