#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ajouter_contact.py — crée un contact dans la collection Zotero « Contacts ».

Outil de saisie pour le CEO (carte C2) : le dossier personnes est SA matière
— cet outil permet de créer l'item SANS jamais toucher à l'API à la main.

L'item (itemType document) est créé dans la collection « Contacts »
(JI7JP8AZ, racine du groupe 6610185) :

  title=nom, abstractNote=description, publisher=organisation, place=lieu,
  date=date_contact, url=lien, extra=lignes « Email: »/« Telephone: »/
  « Role: » (seulement les lignes renseignées), tags=categories,
  citationKey=prochain C000N (scan des citationKeys existants, max+1),
  dateAdded/dateModified=maintenant (ISO 8601 Z).

La clé API (écriture, coffre ~/secrets/client/zotero.key) n'est JAMAIS
affichée ni loguée. stdlib uniquement.

Usage (depuis la racine du repo) :
  python3 scripts/ajouter_contact.py --nom "Marie Dupont" [options]
"""

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from zotero_api import ZoteroClient, ZoteroError, load_key

CONTACTS_NAME = "Contacts"
EXPECTED_COLLECTION_KEY = "JI7JP8AZ"   # attendu (C1) — contrôle, pas source
CITATION_RE = re.compile(r"^C(\d{4,})$")   # C0001, C0012, … (tolère > 9999)


# ---------------------------------------------------------------- arguments

def build_parser():
    p = argparse.ArgumentParser(
        prog="ajouter_contact.py",
        description=(
            "Ajoute un contact au répertoire public (collection Zotero "
            "« Contacts »). Le contact est visible sur la grille après le "
            "prochain fetch (deploy.sh ou tir horaire)."
        ),
        epilog=(
            "Exemples :\n"
            '  python3 scripts/ajouter_contact.py --nom "Marie Dupont" '
            '--organisation "Conseil départemental" --lieu "Grenoble" '
            "--email marie@example.fr --role Élue --categorie institution\n"
            '  python3 scripts/ajouter_contact.py --nom "Paul Martin" '
            "--date-contact 2026-10-11 --categorie presse --categorie eau"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--nom", required=True, metavar="NOM",
                   help="nom complet de la personne (obligatoire)")
    p.add_argument("--organisation", default="", metavar="TEXTE",
                   help="organisation (ex. Conseil départemental)")
    p.add_argument("--lieu", default="", metavar="TEXTE",
                   help="lieu (ex. Grenoble)")
    p.add_argument("--date-contact", default="", metavar="AAAA-MM-JJ",
                   help="date du dernier contact")
    p.add_argument("--email", default="", metavar="ADRESSE",
                   help="adresse e-mail")
    p.add_argument("--telephone", default="", metavar="NUMÉRO",
                   help="numéro de téléphone")
    p.add_argument("--role", default="", metavar="TEXTE",
                   help="rôle (ex. Élue)")
    p.add_argument("--lien", default="", metavar="URL",
                   help="lien web (profil, site, article…)")
    p.add_argument("--description", default="", metavar="TEXTE",
                   help="description / notes")
    p.add_argument("--categorie", action="append", default=[],
                   metavar="CATÉGORIE", dest="categories",
                   help="catégorie (répétable : --categorie presse "
                        "--categorie institution)")
    return p


def validate_args(args):
    """Refuse --nom absent/vide et --date-contact mal formé."""
    if not (args.nom or "").strip():
        print("ERREUR : --nom est obligatoire (nom de la personne).",
              file=sys.stderr)
        return False
    if args.date_contact and not re.match(r"^\d{4}-\d{2}-\d{2}$",
                                          args.date_contact):
        print(f"ERREUR : --date-contact attend AAAA-MM-JJ "
              f"(reçu : « {args.date_contact} »).", file=sys.stderr)
        return False
    return True


# ---------------------------------------------------------------- item

def next_citation_key(client, ckey):
    """Prochain C000N : max des citationKeys existants + 1 (C0001 si vide)."""
    keys = client.collection_citation_keys(ckey)
    nums = []
    for k in keys:
        m = CITATION_RE.match(k)
        if m:
            nums.append(int(m.group(1)))
    return f"C{(max(nums) + 1) if nums else 1:04d}"


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
    # champs optionnels : seulement les lignes renseignées
    if args.description.strip():
        item["abstractNote"] = args.description.strip()
    if args.organisation.strip():
        item["publisher"] = args.organisation.strip()
    if args.lieu.strip():
        item["place"] = args.lieu.strip()
    if args.date_contact:
        item["date"] = args.date_contact
    if args.lien.strip():
        item["url"] = args.lien.strip()
    extra_lines = []
    if args.email.strip():
        extra_lines.append(f"Email: {args.email.strip()}")
    if args.telephone.strip():
        extra_lines.append(f"Telephone: {args.telephone.strip()}")
    if args.role.strip():
        extra_lines.append(f"Role: {args.role.strip()}")
    if extra_lines:
        item["extra"] = "\n".join(extra_lines)
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

    ckey = client.find_collection(CONTACTS_NAME)
    if ckey != EXPECTED_COLLECTION_KEY:
        raise ZoteroError(
            f"collection « {CONTACTS_NAME} » trouvée sous la clé {ckey}, "
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

    print(f"CONTACT {citation_key} -> {args.nom.strip()}"
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
    print(f"[OK] vérification : collection « {CONTACTS_NAME} » = "
          f"{len(items)} item(s), {citation_key} présent")

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ZoteroError as e:
        print(f"ECHEC : {e}", file=sys.stderr)
        sys.exit(1)
