#!/usr/bin/env python3
"""ajouter_media.py — création d'un item Médiathèque (collection Hermes) depuis le pending.

CEO 14/10/26 : les items issus des mails vivent dans la sous-collection
« Hermes » (3QCPPFIF) de la Médiathèque (MCKNJI9M) du groupe 6610185.

RÈGLE ABSOLUE : AUCUN FICHIER — enregistrement + métadonnées uniquement.
Si l'item a une URL publique (issue du mail), elle va dans le champ `url`.
Jamais d'upload, jamais de pièce jointe Zotero.

Usage :
    python3 scripts/ajouter_media.py --titre "…" --type "Article de presse" \
        [--url …] [--date AAAA-MM-JJ] [--resume "…"] [--auteur "Nom" …] \
        [--tag "…" …] [--numero N] [--source-message-id "…"]

--numero N = numéro de la proposition dans mediatheque/data/pending_proposals.json :
le script lit la proposition N du pending et pré-remplit tout (les autres
options surchargent). C'est la voie de saisie du flux « Tri Mail ».

Vérification intégrée : re-fetch de l'item créé (clé + collections + titre).
"""
import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
from scripts.zotero_api import ZoteroClient, load_key  # noqa: E402

GROUP = "6610185"
HERMES_KEY = "3QCPPFIF"          # sous-collection Hermes, parent MCKNJI9M
PENDING = REPO / "mediatheque" / "data" / "pending_proposals.json"

# Libellés du pending → (itemType Zotero, libellé FR affiché)
TYPE_MAP = {
    "Article de presse": "newspaperArticle",
    "Article de magazine": "magazineArticle",
    "Article de revue": "journalArticle",
    "Livre": "book",
    "Document": "document",
    "Page web": "webpage",
    "Lettre": "letter",
    "Rapport": "report",
    "Texte de loi": "statute",
    "Vidéo": "videoRecording",
    "Présentation": "presentation",
    "Audio": "audioRecording",
    "Thèse": "thesis",
    "Newsletter": "email",
    "Carte": "map",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--titre", required=True)
    ap.add_argument("--type", required=True, help="libellé du pending (Article de presse, …)")
    ap.add_argument("--url")
    ap.add_argument("--date")
    ap.add_argument("--resume")
    ap.add_argument("--auteur", action="append", default=[])
    ap.add_argument("--tag", action="append", default=[])
    ap.add_argument("--numero", type=int)
    ap.add_argument("--source-message-id")
    args = ap.parse_args()

    # pré-remplissage depuis le pending
    if args.numero:
        d = json.loads(PENDING.read_text(encoding="utf-8"))
        props = {int(p.get("numero", 0)): p for p in d.get("propositions", [])}
        if args.numero not in props:
            print(f"ERREUR: proposition n°{args.numero} absente du pending"); sys.exit(1)
        p = props[args.numero]
        args.titre = args.titre or p.get("titre")
        args.type = args.type or p.get("type")
        args.url = args.url if args.url is not None else p.get("url") or ""
        args.date = args.date if args.date is not None else p.get("date") or ""
        args.resume = args.resume if args.resume is not None else p.get("resume") or ""
        args.source_message_id = args.source_message_id or p.get("source_message_id") or ""
        if not args.auteur:
            args.auteur = p.get("auteurs") or []
        if not args.tag:
            args.tag = p.get("tags") or []

    item_type = TYPE_MAP.get(args.type)
    if not item_type:
        print(f"ERREUR: type inconnu « {args.type} » — mappings: {list(TYPE_MAP)}"); sys.exit(1)

    extra_lines = []
    if args.source_message_id:
        extra_lines.append(f"Source message id: {args.source_message_id}")
    extra_lines.append("Provenance: Tri mail Hermes")

    item = {
        "itemType": item_type,
        "title": args.titre,
        "abstractNote": args.resume or "",
        "url": args.url or "",
        "date": args.date or "",
        "extra": "\n".join(extra_lines),
        "tags": [{"tag": t} for t in args.tag],
        "collections": [HERMES_KEY],
        "creators": [{"creatorType": "author", "name": a} for a in args.auteur],
    }
    # champs propres à certains types
    if item_type in ("newspaperArticle", "magazineArticle", "journalArticle"):
        item["publicationTitle"] = ""

    c = ZoteroClient(load_key())
    st, body = c.request("POST", f"/groups/{GROUP}/items", [item])
    ok = (body or {}).get("success", {})
    failed = (body or {}).get("failed", {})
    if failed:
        print(f"ERREUR POST: {json.dumps(failed, ensure_ascii=False)[:300]}"); sys.exit(1)
    key = list(ok.values())[0]
    print(f"Item créé : {key}")

    # vérification : re-fetch
    st2, item2 = c.get(f"/groups/{GROUP}/items/{key}")
    data = (item2 or {}).get("data", {})
    print(f"Vérification : {data.get('title','')[:60]} | type={data.get('itemType')} "
          f"| collections={data.get('collections')} | url={data.get('url','')[:50]}")
    if HERMES_KEY not in (data.get("collections") or []):
        print("ERREUR: item PAS dans la collection Hermes"); sys.exit(1)
    print("OK")


if __name__ == "__main__":
    main()
