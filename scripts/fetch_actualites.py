#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fetch_actualites.py — génère actualites/data/actualites.json depuis Zotero.

Carte K4 : l'app Actualités consomme désormais data/actualites.json (fin du
CSV). Ce script lit la collection « Actualités » du groupe Zotero 6610185 et
restitue chaque item avec les noms de champs IDENTIQUES aux colonnes du CSV
historique (contrat de données K5) :

  id (citationKey), type (extra « Type: »), titre (title),
  description (abstractNote), date_debut/date_fin (champ date : split « / »),
  lieu (place), lien (url), date_ajout (dateAdded coupé AAAA-MM-JJ),
  source_message_id (extra « Source message id: »)

Le champ date Zotero encode l'intervalle OPTION B du CEO :
« AAAA-MM-JJ » seul, sinon « AAAA-MM-JJ/AAAA-MM-JJ » (split sur « / »).

items/top de la collection ne remonte PAS les sous-collections — sans objet
ici : les items actualités sont tous directement dans la collection (prouvé
K1/K3, aucune sous-collection).

Ordre : aucun (le front trie). UTF-8.

Usage :
  python3 scripts/fetch_actualites.py            # écrit actualites/data/actualites.json
  python3 scripts/fetch_actualites.py --compare-csv <chemin>
      # en plus : compare champ par champ avec le CSV historique et imprime
      # le relevé (écart = ligne par ligne, champ par champ)

Clé : lecture seule (coffre ~/sys_admin/secrets/client/zotero.key, sinon config de la
vitrine). Clé d'écriture jamais nécessaire ici. stdlib uniquement.
"""

import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from zotero_api import DEFAULT_GROUP_ID, ZoteroClient, ZoteroError, load_key, strip_accents

REPO = Path(__file__).resolve().parent.parent
OUT_PATH = REPO / "actualites" / "data" / "actualites.json"

GROUP_ID = DEFAULT_GROUP_ID
ACTUALITES_NAME = "Actualités"
EXPECTED_COLLECTION_KEY = "U4HFDR68"   # attendu (K1/K3) — contrôle, pas source

CSV_FIELDS = [
    "id", "type", "titre", "description",
    "date_debut", "date_fin", "lieu", "lien",
    "date_ajout", "source_message_id",
]


# ---------------------------------------------------------------- mapping inverse

def parse_extra(extra):
    """extra multi-lignes -> {label: valeur} pour « Type: » et
    « Source message id: »."""
    out = {}
    for line in (extra or "").split("\n"):
        line = line.strip()
        if ":" in line:
            label, _, val = line.partition(":")
            out[label.strip()] = val.strip()
    return out


def parse_date(date_field):
    """date Zotero -> (date_debut, date_fin). Split sur « / » (OPTION B).

    « 2026-09-23 »            -> ("2026-09-23", "")
    « 2026-07-05/2026-11-08 » -> ("2026-07-05", "2026-11-08")
    """
    s = (date_field or "").strip()
    if not s:
        return "", ""
    if "/" in s:
        parts = s.split("/", 1)
        return parts[0].strip(), parts[1].strip()
    return s, ""


def item_to_record(item):
    """item Zotero -> dict aux clés du CSV historique."""
    data = item.get("data") or {}
    extra = parse_extra(data.get("extra"))
    debut, fin = parse_date(data.get("date"))
    return {
        "id": (data.get("citationKey") or "").strip(),
        "type": extra.get("Type", "").strip(),
        "titre": (data.get("title") or "").strip(),
        "description": (data.get("abstractNote") or "").strip(),
        "date_debut": debut,
        "date_fin": fin,
        "lieu": (data.get("place") or "").strip(),
        "lien": (data.get("url") or "").strip(),
        "date_ajout": (data.get("dateAdded") or "")[:10],
        "source_message_id": extra.get("Source message id", "").strip(),
    }


def find_actualites_key(client):
    """Clé de la collection Actualités par nom + contrôle de cohérence."""
    key = client.find_collection(ACTUALITES_NAME)
    if key != EXPECTED_COLLECTION_KEY:
        raise ZoteroError(
            f"collection « {ACTUALITES_NAME} » trouvée sous la clé {key}, "
            f"{EXPECTED_COLLECTION_KEY} attendue"
        )
    return key


# ---------------------------------------------------------------- comparaison CSV

def compare_with_csv(records, csv_path):
    """Compare les records JSON avec le CSV historique champ par champ.

    Retourne la liste des écarts [(id, champ, valeur_json, valeur_csv)].
    """
    with open(csv_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    by_id = {r["id"]: r for r in records}
    diffs = []
    for row in rows:
        rid = row["id"]
        rec = by_id.get(rid)
        if rec is None:
            diffs.append((rid, "(item absent du JSON)", None, row.get("titre")))
            continue
        for field in CSV_FIELDS:
            csv_val = (row.get(field) or "").strip()
            json_val = (rec.get(field) or "").strip()
            if csv_val != json_val:
                diffs.append((rid, field, json_val, csv_val))
    extra_ids = [r["id"] for r in records if r["id"] not in {row["id"] for row in rows}]
    for rid in extra_ids:
        diffs.append((rid, "(item absent du CSV)", "présent dans Zotero", ""))
    return diffs


# ---------------------------------------------------------------- main

def main():
    compare_csv = None
    args = sys.argv[1:]
    if "--compare-csv" in args:
        i = args.index("--compare-csv")
        if i + 1 >= len(args):
            print("ERREUR : --compare-csv attend un chemin de CSV", file=sys.stderr)
            return 2
        compare_csv = Path(args[i + 1]).expanduser()

    key = load_key(mode="read")
    client = ZoteroClient(key, GROUP_ID)

    ckey = find_actualites_key(client)
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
        if not rec["type"]:
            raise ZoteroError(
                f"item {rec['id']} : ligne « Type: » absente de extra "
                f"({item.get('key')})"
            )
        records.append(rec)

    # Ordre : tri déterministe par id (le front trie de toute façon ; un ordre
    # stable rend la sortie reproductible et les diffs lisibles).
    records.sort(key=lambda r: r["id"])

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    # relevé
    print(f"[OK] collection « {ACTUALITES_NAME} » ({ckey}) : {len(items)} items top")
    print(f"[OK] écrit {OUT_PATH} ({OUT_PATH.stat().st_size} octets, UTF-8)")
    types = {}
    for r in records:
        types[r["type"]] = types.get(r["type"], 0) + 1
    print(f"[OK] {len(records)} items -> types : "
          + ", ".join(f"{k}={v}" for k, v in sorted(types.items())))
    for r in records:
        dates = r["date_debut"] + (f" → {r['date_fin']}" if r["date_fin"] else "")
        print(f"  {r['id']} | {r['type']} | {dates} | {r['titre'][:70]}"
              + ("…" if len(r["titre"]) > 70 else ""))

    if compare_csv:
        print(f"\n=== COMPARAISON avec {compare_csv} (champ par champ) ===")
        diffs = compare_with_csv(records, compare_csv)
        if not diffs:
            print(f"[OK] AUCUN ÉCART : les {len(records)} items JSON sont "
                  f"conformes au CSV, champ par champ.")
        else:
            print(f"[ÉCARTS] {len(diffs)} :")
            for rid, field, jv, cv in diffs:
                print(f"  {rid} | {field} | JSON={jv!r} | CSV={cv!r}")
        return 1 if diffs else 0

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ZoteroError as e:
        print(f"ECHEC : {e}", file=sys.stderr)
        sys.exit(1)
