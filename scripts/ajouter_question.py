#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ajouter_question.py — crée une question dans la collection Zotero « Questions ».

Outil de saisie, calque strict de ajouter_organisation.py : crée l'item
SANS jamais toucher à l'API à la main.

L'item (itemType document) est créé dans la collection « Questions »
(6IEE7MF2, racine du groupe 6610185) :

  title=titre, abstractNote=description, url=lien,
  extra=lignes « Question: »/« Deposant: » (libellés ANGLAIS sans
  accents, seulement les lignes renseignées), tags=categories,
  citationKey=prochain Q000N (scan des citationKeys existants,
  max+1), dateAdded/dateModified=maintenant (ISO 8601 Z).

Spécificité métier : une question est posée par quelqu'un
(deposant) ; les réponses vivront dans le fil de l'issue GitHub du
parcours contribution, pas dans la fiche.

La clé API (écriture, coffre ~/sys_admin/secrets/client/zotero.key) n'est JAMAIS
affichée ni loguée. stdlib uniquement.

Usage (depuis la racine du repo) :
  python3 scripts/ajouter_question.py --titre "Formulation courte" \
      --question "La question complète ?" [--deposant "Prénom Nom"] [options]
"""

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from zotero_api import ZoteroClient, ZoteroError, load_key

QUESTIONS_NAME = "Questions"
EXPECTED_COLLECTION_KEY = "6IEE7MF2"   # attendu — contrôle, pas source
CITATION_RE = re.compile(r"^Q(\d{4,})$")   # Q0001, Q0012, … (tolère > 9999)


# ---------------------------------------------------------------- arguments

def build_parser():
    p = argparse.ArgumentParser(
        prog="ajouter_question.py",
        description=(
            "Ajoute une question à la grille publique (collection Zotero "
            "« Questions »). La question est visible sur la grille "
            "après le prochain fetch (deploy.sh ou tir horaire)."
        ),
        epilog=(
            "Exemples :\n"
            '  python3 scripts/ajouter_question.py --titre "Qualité de l\'eau" '
            '--question "Quels sont les seuils de mesure sur l\'Isère ?" '
            '--deposant "Marie Dupont"\n'
            '  python3 scripts/ajouter_question.py --titre "Accès aux berges" '
            "--question \"Où les berges sont-elles accessibles au public ?\" "
            "--categorie acces --categorie eau"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--titre", required=True, metavar="TITRE",
                   help="formulation courte de la question (obligatoire)")
    p.add_argument("--question", required=True, metavar="TEXTE",
                   help="question complète, telle qu'affichée dans la fiche (obligatoire)")
    p.add_argument("--deposant", default="", metavar="NOM",
                   help="nom de la personne qui dépose la question")
    p.add_argument("--description", default="", metavar="TEXTE",
                   help="description / contexte de la question")
    p.add_argument("--lien", default="", metavar="URL",
                   help="lien web (source, référence…)")
    p.add_argument("--categorie", action="append", default=[],
                   metavar="CATÉGORIE", dest="categories",
                   help="catégorie (répétable : --categorie eau "
                        "--categorie acces)")
    return p


def validate_args(args):
    """Refuse --titre / --question absents ou vides."""
    if not (args.titre or "").strip():
        print("ERREUR : --titre est obligatoire (formulation courte).",
              file=sys.stderr)
        return False
    if not (args.question or "").strip():
        print("ERREUR : --question est obligatoire (question complète).",
              file=sys.stderr)
        return False
    return True


# ---------------------------------------------------------------- item

def next_citation_key(client, ckey):
    """Prochain Q000N : max des citationKeys existants + 1 (Q0001 si vide)."""
    keys = client.collection_citation_keys(ckey)
    nums = []
    for k in keys:
        m = CITATION_RE.match(k)
        if m:
            nums.append(int(m.group(1)))
    return f"Q{(max(nums) + 1) if nums else 1:04d}"


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
    # champs optionnels : seulement les champs renseignés
    if args.description.strip():
        item["abstractNote"] = args.description.strip()
    if args.lien.strip():
        item["url"] = args.lien.strip()
    extra_lines = []
    if args.question.strip():
        extra_lines.append(f"Question: {args.question.strip()}")
    if args.deposant.strip():
        extra_lines.append(f"Deposant: {args.deposant.strip()}")
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

    key = load_key(mode="write")          # coffre ~/sys_admin/secrets/client/zotero.key
    client = ZoteroClient(key)
    client.check_write_access()

    ckey = client.find_collection(QUESTIONS_NAME)
    if ckey != EXPECTED_COLLECTION_KEY:
        raise ZoteroError(
            f"collection « {QUESTIONS_NAME} » trouvée sous la clé {ckey}, "
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

    print(f"QUESTION {citation_key} -> {args.titre.strip()}"
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
    print(f"[OK] vérification : collection « {QUESTIONS_NAME} » = "
          f"{len(items)} item(s), {citation_key} présent")

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ZoteroError as e:
        print(f"ECHEC : {e}", file=sys.stderr)
        sys.exit(1)
