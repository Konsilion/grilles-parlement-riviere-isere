#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ajouter_projet.py — crée un projet dans la collection Zotero « Projets ».

Outil de saisie pour le CEO (carte P1) : crée l'item SANS jamais toucher à
l'API à la main (calque ajouter_contact.py).

L'item (itemType document) est créé dans la collection « Projets »
(RPZFWI9M, racine du groupe 6610185) :

  title=titre, abstractNote=description, publisher=porteur, place=lieu,
  date=« AAAA-MM-JJ/AAAA-MM-JJ » si début+fin (OPTION B), sinon début seul,
  url=lien, extra=ligne « Statut: … » (seulement si renseigné),
  tags=categories, citationKey=prochain P000N (scan max+1),
  dateAdded/dateModified=maintenant (ISO 8601 Z).

Statuts conseillés : « En cours », « À venir », « Terminé » (le front
colore ces trois-là ; toute autre valeur s'affiche telle quelle).

La clé API (écriture, coffre ~/secrets/client/zotero.key) n'est JAMAIS
affichée ni loguée. stdlib uniquement.

Usage (depuis la racine du repo) :
  python3 scripts/ajouter_projet.py --titre "…" [options]
"""

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from zotero_api import ZoteroClient, ZoteroError, load_key

PROJETS_NAME = "Projets"
EXPECTED_COLLECTION_KEY = "RPZFWI9M"   # attendu (P1) — contrôle, pas source
CITATION_RE = re.compile(r"^P(\d{4,})$")   # P0001, P0012, … (tolère > 9999)

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# ---------------------------------------------------------------- arguments

def build_parser():
    p = argparse.ArgumentParser(
        prog="ajouter_projet.py",
        description=(
            "Ajoute un projet à l'application Projets (collection Zotero "
            "« Projets »). Le projet est visible sur la grille après le "
            "prochain fetch (deploy.sh ou tir horaire)."
        ),
        epilog=(
            "Exemples :\n"
            '  python3 scripts/ajouter_projet.py --titre "Où atterrir ?" '
            '--porteur "Parlement de la rivière Isère" --statut "En cours" '
            "--date-debut 2026-10-01 --categorie animation\n"
            '  python3 scripts/ajouter_projet.py --titre "Atlas des zones humides" '
            "--porteur \"CCIAG\" --statut \"À venir\" "
            "--date-debut 2027-01-15 --date-fin 2027-12-31 --categorie étude "
            "--lieu Grenoble --lien https://exemple.fr"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--titre", required=True, metavar="TITRE",
                   help="nom du projet (obligatoire)")
    p.add_argument("--description", default="", metavar="TEXTE",
                   help="description du projet")
    p.add_argument("--porteur", default="", metavar="TEXTE",
                   help="organisation porteuse (ex. Parlement de la rivière Isère)")
    p.add_argument("--lieu", default="", metavar="TEXTE",
                   help="lieu (ex. Grenoble, bassin de l'Isère)")
    p.add_argument("--date-debut", default="", metavar="AAAA-MM-JJ",
                   help="date de début du projet")
    p.add_argument("--date-fin", default="", metavar="AAAA-MM-JJ",
                   help="date de fin du projet (facultative)")
    p.add_argument("--statut", default="", metavar="TEXTE",
                   help="statut affiché — conseillé : En cours / À venir / Terminé")
    p.add_argument("--lien", default="", metavar="URL",
                   help="lien web du projet (site, page, dossier…)")
    p.add_argument("--categorie", action="append", default=[],
                   metavar="CATÉGORIE", dest="categories",
                   help="catégorie (répétable : --categorie étude "
                        "--categorie animation)")
    return p


def validate_args(args):
    """Refuse --titre absent/vide et les dates mal formées/incohérentes."""
    if not (args.titre or "").strip():
        print("ERREUR : --titre est obligatoire (nom du projet).",
              file=sys.stderr)
        return False
    for name, val in (("date-debut", args.date_debut),
                      ("date-fin", args.date_fin)):
        if val and not DATE_RE.match(val):
            print(f"ERREUR : --{name} attend AAAA-MM-JJ (reçu : « {val} »).",
                  file=sys.stderr)
            return False
    if args.date_debut and args.date_fin and args.date_fin < args.date_debut:
        print(f"ERREUR : --date-fin ({args.date_fin}) antérieure à "
              f"--date-debut ({args.date_debut}).", file=sys.stderr)
        return False
    return True


# ---------------------------------------------------------------- item

def next_citation_key(client, ckey):
    """Prochain P000N : max des citationKeys existants + 1 (P0001 si vide)."""
    keys = client.collection_citation_keys(ckey)
    nums = []
    for k in keys:
        m = CITATION_RE.match(k)
        if m:
            nums.append(int(m.group(1)))
    return f"P{(max(nums) + 1) if nums else 1:04d}"


def build_item(args, ckey, citation_key):
    """Arguments CLI -> item document au format d'écriture Zotero."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    item = {
        "itemType": "document",
        "title": args.titre.strip(),
        "citationKey": citation_key,
        "collections": [ckey],
        "tags": [],
        "dateAdded": now,
        "dateModified": now,
    }
    # champs optionnels : seulement les lignes renseignées
    if args.description.strip():
        item["abstractNote"] = args.description.strip()
    if args.porteur.strip():
        item["publisher"] = args.porteur.strip()
    if args.lieu.strip():
        item["place"] = args.lieu.strip()
    # date : intervalle natif « début/fin » (OPTION B) si les deux, sinon début
    if args.date_debut and args.date_fin:
        item["date"] = f"{args.date_debut}/{args.date_fin}"
    elif args.date_debut:
        item["date"] = args.date_debut
    if args.lien.strip():
        item["url"] = args.lien.strip()
    if args.statut.strip():
        item["extra"] = f"Statut: {args.statut.strip()}"
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

    key = load_key(mode="write")          # coffre ~/secrets/client/zotero.key
    client = ZoteroClient(key)
    client.check_write_access()

    ckey = client.find_collection(PROJETS_NAME)
    if ckey != EXPECTED_COLLECTION_KEY:
        raise ZoteroError(
            f"collection « {PROJETS_NAME} » trouvée sous la clé {ckey}, "
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

    print(f"PROJET {citation_key} -> {args.titre.strip()}"
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
    print(f"[OK] vérification : collection « {PROJETS_NAME} » = "
          f"{len(items)} item(s), {citation_key} présent")

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ZoteroError as e:
        print(f"ECHEC : {e}", file=sys.stderr)
        sys.exit(1)
