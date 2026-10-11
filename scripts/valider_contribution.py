#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""valider_contribution.py — modération des propositions de documents (issues GitHub).

Parcours « esprit Datami » de la médiathèque (parlement de la rivière Isère) :
un·e visiteur remplit la modale « Proposer un document » → une issue GitHub
pré-remplie (étiquette `contribution`) est soumise → l'équipe vérifie le
document → CE script valide la proposition :

    1. lit l'issue (champs : titre, auteur·e·s, type, année, lien, résumé) ;
    2. vérifie les doublons dans le groupe Zotero (titre exact) ;
    3. crée la fiche Zotero dans la collection « Médiathèque » (MCKNJI9M) ;
    4. ferme l'issue avec un commentaire de remerciement ;
    5. rappelle le déploiement : `bash scripts/deploy.sh` publie la
       médiathèque (le fetch Zotero régénère collection.json).

Usage :
    python3 scripts/valider_contribution.py --liste        # propositions en attente
    python3 scripts/valider_contribution.py 12            # valide l'issue n° 12
    python3 scripts/valider_contribution.py 12 15         # valide plusieurs issues
    python3 scripts/valider_contribution.py 12 --refuser "hors sujet"  # ferme sans ajout

Accès :
- GitHub : CLI `gh` (déjà authentifiée sur le VPS, compte Konsilion) ;
- Zotero : clé d'écriture du coffre ~/secrets/client/zotero.key (jamais affichée).

Aucune invention : les champs viennent tels quels du formulaire. Le type est
revalidé (liste fermée) ; un type inconnu est refusé.
stdlib uniquement pour Zotero (via zotero_api.py) ; `gh` pour GitHub.
"""

import datetime
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from zotero_api import DEFAULT_GROUP_ID, ZoteroClient, ZoteroError, load_key

REPO = "Konsilion/grilles-parlement-riviere-isere"
LABEL = "contribution"
MEDIATHEQUE_NAME = "Médiathèque"
EXPECTED_COLLECTION_KEY = "MCKNJI9M"
JSON_FENCE = "json-contribution"

# Types proposés par la modale (liste fermée — cf. index.html <select>) et
# leur itemType Zotero (inverse de TYPE_FR_MAP de fetch_zotero.py pour les
# types réellement proposés).
TYPE_TO_ITEMTYPE = {
    "Rapport": "report",
    "Article de presse": "newspaperArticle",
    "Document": "document",
    "Newsletter": "email",
    "Article de magazine": "magazineArticle",
    "Article de revue": "journalArticle",
    "Page web": "webpage",
    "Thèse": "thesis",
    "Livre": "book",
    "Texte de loi": "statute",
    "Lettre": "letter",
    "Carte": "map",
    "Audio": "audioRecording",
    "Présentation": "presentation",
}


# ---------------------------------------------------------------- GitHub (gh)

def gh(*args, check=True):
    """Appel `gh` → (retour stdout, ok). Jamais de secret : gh gère son token."""
    proc = subprocess.run(
        ["gh", *args, "--repo", REPO],
        capture_output=True, text=True, timeout=60,
    )
    if check and proc.returncode != 0:
        raise RuntimeError(f"gh {' '.join(args)} a échoué : {proc.stderr.strip()}")
    return proc.stdout, proc.returncode == 0


def list_open_contributions():
    """Issues ouvertes étiquetée contribution → [{number, title, body, author, url}]."""
    out, ok = gh(
        "issue", "list",
        "--state", "open",
        "--label", LABEL,
        "--json", "number,title,body,author,url",
        "--limit", "100",
    )
    if not ok:
        raise RuntimeError("impossible de lister les issues (gh)")
    issues = json.loads(out or "[]")
    issues.sort(key=lambda i: i["number"])
    return issues


def parse_contribution(body):
    """Extrait les champs du corps d'issue. Retourne dict ou None si malformé.

    Le front pousse un bloc de données délimité :
        ```json-contribution
        {"title": …, "authors": …, "type": …, "year": …, "url": …, "abstract": …}
        ```
    """
    m = re.search(
        r"```" + JSON_FENCE + r"\s*\n(.*?)\n\s*```",
        body or "",
        flags=re.S,
    )
    if not m:
        return None
    try:
        data = json.loads(m.group(1))
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    return data


def clean(data):
    """Normalise une proposition : trims + valeurs vides → None, contrôles."""
    def s(k):
        v = str(data.get(k) or "").strip()
        return v or None

    prop = {
        "title": s("title"),
        "authors": s("authors"),
        "type": s("type"),
        "year": s("year"),
        "url": s("url"),
        "abstract": s("abstract"),
    }
    return prop


# ---------------------------------------------------------------- Zotero

def load_memoire_items(client):
    """Items top du groupe (le périmètre servi par la médiathèque) + index titres."""
    items = client.get_all(f"/groups/{DEFAULT_GROUP_ID}/items/top")
    titles = set()
    for it in items:
        d = it.get("data") or {}
        t = (d.get("title") or "").strip()
        if t:
            titles.add(t)
    return items, titles


def build_creators(authors_str):
    """« Nom1, Nom2 » → liste creators Zotero.

    Heuristique volontairement simple (les propositions viennent de néophytes) :
    chaque segment séparé par « , » ou « ; » devient un auteur. Un seul mot →
    organisation (name), plusieurs mots → personne (first/last, dernier mot
    = nom de famille).
    """
    if not authors_str:
        return []
    parts = [p.strip() for p in re.split(r"[;,]", authors_str) if p.strip()]
    creators = []
    for p in parts:
        segs = p.split()
        if len(segs) == 1:
            creators.append({"creatorType": "author", "name": p})
        else:
            creators.append({
                "creatorType": "author",
                "firstName": " ".join(segs[:-1]),
                "lastName": segs[-1],
            })
    return creators


def build_item(prop):
    """proposition nettoyée → item Zotero (collection Médiathèque)."""
    itype = TYPE_TO_ITEMTYPE.get(prop["type"] or "")
    if not itype:
        raise ZoteroError(f"type inconnu « {prop['type']} » (liste fermée de la modale)")
    today = datetime.date.today().isoformat()
    item = {
        "itemType": itype,
        "title": prop["title"],
        "creators": build_creators(prop["authors"]),
        "collections": [EXPECTED_COLLECTION_KEY],
        "tags": [],
        "extra": "Source: contribution médiathèque (issue GitHub)",
        "dateAdded": f"{today}T00:00:00Z",
        "dateModified": f"{today}T00:00:00Z",
    }
    if prop["year"]:
        item["date"] = prop["year"]
    if prop["url"]:
        item["url"] = prop["url"]
    if prop["abstract"]:
        item["abstractNote"] = prop["abstract"]
    return item


# ---------------------------------------------------------------- --liste

def do_list():
    issues = list_open_contributions()
    if not issues:
        print(f"Aucune proposition en attente (issues ouvertes étiquetée « {LABEL} »).")
        return 0
    print(f"{len(issues)} proposition(s) en attente :")
    for i in issues:
        prop = clean(parse_contribution(i["body"]) or {})
        print(f"\n  n°{i['number']}  {i['title']}")
        print(f"     auteur issue : {i['author']['login']}  ({i['url']})")
        if prop.get("title"):
            print(f"     titre        : {prop['title']}")
            print(f"     auteur·e·s   : {prop['authors'] or '—'}")
            print(f"     type         : {prop['type'] or '—'}")
            print(f"     année        : {prop['year'] or '—'}")
            print(f"     lien         : {prop['url'] or '—'}")
            print(f"     résumé       : {(prop['abstract'] or '—')[:120]}")
        else:
            print("     ⚠️ corps illisible : issue hors parcours modale → traiter à la main")
    return 0


# ---------------------------------------------------------------- validation

def close_issue_thanks(number, cite_title):
    """Ferme l'issue avec un commentaire de remerciement public."""
    comment = (
        "Merci pour cette proposition ! 📚\n\n"
        f"Le document « {cite_title} » a été vérifié et ajouté à la bibliothèque Zotero. "
        "Il apparaîtra sur la médiathèque du Parlement de la rivière Isère lors du "
        "prochain déploiement (généralement sous une heure).\n\n"
        "— L'équipe du Parlement de la rivière Isère"
    )
    gh("issue", "close", str(number), "--comment", comment)


def close_issue_refused(number, reason):
    """Ferme l'issue refusée avec motif."""
    comment = (
        "Merci pour cette proposition.\n\n"
        "Après examen, l'équipe ne retient pas ce document pour la bibliothèque :\n\n"
        f"> {reason}\n\n"
        "Les propositions d'ajouts restent les bienvenues !\n\n"
        "— L'équipe du Parlement de la rivière Isère"
    )
    gh("issue", "close", str(number), "--comment", comment)


def do_validate(numbers, reason=None):
    if reason is not None:
        mode = "refus"
    else:
        mode = "validation"
    issues = {i["number"]: i for i in list_open_contributions()}
    missing = [n for n in numbers if n not in issues]
    if missing:
        print(f"ERREUR : issue(s) inconnue(s) ou déjà fermée(s) : {missing}")
        print(f"Issues en attente : {sorted(issues)}")
        return 2

    # --- refus : rien à toucher côté Zotero
    if mode == "refus":
        for n in numbers:
            close_issue_refused(n, reason)
            print(f"[REFUSÉ] issue n°{n} fermée (motif : {reason})")
        return 0

    # --- validation : clé d'écriture Zotero + contrôles
    key = load_key(mode="write")
    client = ZoteroClient(key, DEFAULT_GROUP_ID)
    info = client.check_write_access()
    print(f"[OK] clé d'écriture : utilisateur {info.get('userID')} "
          f"({info.get('username')}), write sur groupe {DEFAULT_GROUP_ID}")

    ckey = client.find_collection(MEDIATHEQUE_NAME)
    if ckey != EXPECTED_COLLECTION_KEY:
        raise ZoteroError(
            f"collection « {MEDIATHEQUE_NAME} » trouvée sous la clé {ckey}, "
            f"{EXPECTED_COLLECTION_KEY} attendue"
        )
    print(f"[OK] collection « {MEDIATHEQUE_NAME} » ({ckey})")

    _, titles = load_memoire_items(client)
    print(f"[OK] anti-doublon : {len(titles)} titres déjà dans le groupe")

    validated, rejected = [], []
    for n in numbers:
        issue = issues[n]
        prop = clean(parse_contribution(issue["body"]) or {})
        if not prop.get("title") or not prop.get("url"):
            rejected.append((n, "issue malformée (titre/lien manquant) — traiter à la main"))
            continue
        if prop["title"] in titles:
            rejected.append((n, f"titre déjà présent : « {prop['title']} »"))
            continue
        if not TYPE_TO_ITEMTYPE.get(prop["type"] or ""):
            rejected.append((n, f"type inconnu « {prop['type']} »"))
            continue

        item = build_item(prop)
        successful, failed = client.post_items([item])
        if failed:
            rejected.append((n, f"échec POST Zotero : {failed}"))
            continue
        if not successful:
            rejected.append((n, "POST Zotero : réponse inattendue (aucun item créé)"))
            continue
        zkey = next(iter(successful.values()))
        titles.add(prop["title"])
        close_issue_thanks(n, prop["title"])
        validated.append((n, zkey, prop["title"]))
        print(f"[VALIDÉ] issue n°{n} → item Zotero {zkey} (« {prop['title']} »), issue fermée")

    if rejected:
        print("")
        for n, msg in rejected:
            print(f"[REFUSÉ] issue n°{n} : {msg}")

    if validated:
        print("")
        print("Prochaine étape : publier sur la médiathèque —")
        print("    bash scripts/deploy.sh")
        print("(ou attendre le prochain déploiement horaire, qui fetch Zotero)")
    return 0


# ---------------------------------------------------------------- main

def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    if args[0] == "--liste":
        return do_list()

    numbers, reason = [], None
    rest = list(args)
    while rest:
        a = rest.pop(0)
        if a == "--refuser":
            if not rest:
                print("ERREUR : --refuser attend un motif entre guillemets")
                return 2
            reason = rest.pop(0)
        elif a.isdigit():
            numbers.append(int(a))
        else:
            print(f"ERREUR : argument invalide {a!r}")
            return 2
    if not numbers:
        print("ERREUR : aucun numéro d'issue fourni")
        return 2
    try:
        return do_validate(numbers, reason)
    except (RuntimeError, ZoteroError) as e:
        print(f"ERREUR : {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
