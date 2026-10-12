#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ajouter_lieu.py — crée un lieu dans la collection Zotero « Lieux ».

Outil de saisie, calque strict de ajouter_organisation.py : crée l'item
SANS jamais toucher à l'API à la main.

L'item (itemType document) est créé dans la collection « Lieux »
(UMMXNXDJ, racine du groupe 6610185) :

  title=nom, abstractNote=description, place=adresse, url=lien,
  tags=categories, citationKey=prochain L000N (scan des
  citationKeys existants, max+1), dateAdded/dateModified=maintenant
  (ISO 8601 Z). AUCUN champ extra (le contrat Lieux n'en a pas).

La clé API (écriture, coffre ~/sys_admin/secrets/client/zotero.key) n'est JAMAIS
affichée ni loguée. stdlib uniquement.

Usage (depuis la racine du repo) :
  python3 scripts/ajouter_lieu.py --nom "Nom du lieu" [options]
"""

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from zotero_api import ZoteroClient, ZoteroError, load_key

LIEUX_NAME = "Lieux"
EXPECTED_COLLECTION_KEY = "UMMXNXDJ"   # attendu — contrôle, pas source
CITATION_RE = re.compile(r"^L(\d{4,})$")   # L0001, L0012, … (tolère > 9999)


# ---------------------------------------------------------------- arguments

def build_parser():
    p = argparse.ArgumentParser(
        prog="ajouter_lieu.py",
        description=(
            "Ajoute un lieu à la grille publique (collection Zotero "
            "« Lieux »). Le lieu est visible sur la grille "
            "après le prochain fetch (deploy.sh ou tir horaire)."
        ),
        epilog=(
            "Exemples :\n"
            '  python3 scripts/ajouter_lieu.py --nom "Maison du Parlement" '
            '--adresse "1 rue du Test, Grenoble" --categorie mairie\n'
            '  python3 scripts/ajouter_lieu.py --nom "Berge aménagée" '
            "--description \"Espace de promenade\" --categorie berge"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--nom", required=True, metavar="NOM",
                   help="nom du lieu (obligatoire)")
    p.add_argument("--description", default="", metavar="TEXTE",
                   help="description / notes")
    p.add_argument("--adresse", default="", metavar="TEXTE",
                   help="adresse (ex. 5 rue de la République, Grenoble)")
    p.add_argument("--lien", default="", metavar="URL",
                   help="lien web (site, page de présentation…)")
    p.add_argument("--categorie", action="append", default=[],
                   metavar="CATÉGORIE", dest="categories",
                   help="catégorie (répétable : --categorie mairie "
                        "--categorie berge)")
    return p


def validate_args(args):
    """Refuse --nom absent/vide."""
    if not (args.nom or "").strip():
        print("ERREUR : --nom est obligatoire (nom du lieu).",
              file=sys.stderr)
        return False
    return True


# ---------------------------------------------------------------- item

def next_citation_key(client, ckey):
    """Prochain L000N : max des citationKeys existants + 1 (L0001 si vide)."""
    keys = client.collection_citation_keys(ckey)
    nums = []
    for k in keys:
        m = CITATION_RE.match(k)
        if m:
            nums.append(int(m.group(1)))
    return f"L{(max(nums) + 1) if nums else 1:04d}"


def build_item(args, ckey, citation_key):
    """Arguments CLI -> item document au format d'écriture Zotero."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    item = {
        "itemType": "document",
        "title": args.nom.strip(),
        "citationKey": citation_key,
        "collections": [ckey],
        "tags": [],
        "dateAdded": now,
        "dateModified": now,
    }
    # champs optionnels : seulement les champs renseignés
    if args.description.strip():
        item["abstractNote"] = args.description.strip()
    if args.adresse.strip():
        item["place"] = args.adresse.strip()
    if args.lien.strip():
        item["url"] = args.lien.strip()
    cats, seen = [], set()
    for c in args.categories:
        c = c.strip()
        if c and c not in seen:
            seen.add(c)
            cats.append(c)
    item["tags"] = [{"tag": c} for c in cats]
    return item


# ---------------------------------------------------------------- main

def main():
    args = build_parser().parse_args()
    if not validate_args(args):
        return 2

    key = load_key(mode="write")          # coffre ~/sys_admin/secrets/client/zotero.key
    client = ZoteroClient(key)
    client.check_write_access()

    ckey = client.find_collection(LIEUX_NAME)
    if ckey != EXPECTED_COLLECTION_KEY:
        raise ZoteroError(
            f"collection « {LIEUX_NAME} » trouvée sous la clé {ckey}, "
            f"{EXPECTED_COLLECTION_KEY} attendue"
        )

    citation_key = next_citation_key(client, ckey)
    item = build_item(args, ckey, citation_key)

    successful, failed = client.post_items([item])
    if failed:
        # PIÈGE (prouvé K3) : POST renvoie 200 même en échec — on vérifie
        # TOUJOURS failed avant de parler de succès.
        raise ZoteroError(
            "Zotero a refusé l'item : "
            + json.dumps(failed, ensure_ascii=False)[:600]
        )
    if citation_key not in successful:
        raise ZoteroError(
            f"POST : {citation_key} absent de la réponse successful — item "
            "peut-être créé sous une autre clé, À VÉRIFIER dans Zotero"
        )
    item_key = successful[citation_key]

    print(f"LIEU {citation_key} -> {args.nom.strip()}"
          f"  (item Zotero {item_key})")

    # vérification : re-fetch de la collection
    items = client.collection_items_top(ckey)
    present = any(
        (it.get("data") or {}).get("citationKey") == citation_key
        for it in items
    )
    if not present:
        raise ZoteroError(
            f"vérification : {citation_key} introuvable dans la collection "
            f"après création ({len(items)} items)"
        )
    print(f"[OK] vérification : collection « {LIEUX_NAME} » = "
          f"{len(items)} item(s), {citation_key} présent")

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ZoteroError as e:
        print(f"ECHEC : {e}", file=sys.stderr)
        sys.exit(1)
