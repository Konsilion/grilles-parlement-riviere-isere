#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""valider.py — validation des actualités proposées : pending → items Zotero.

K4 — NOUVELLE VERSION : remplace l'écriture de lignes CSV par la création
d'items Zotero dans la collection « Actualités » (U4HFDR68). La source de
vérité du site devient actualites/data/actualites.json, régénéré par
scripts/fetch_actualites.py après validation.

Usage (interface inchangée) :
    python3 scripts/valider.py 1 3        # valide les propositions n° 1 et 3
    python3 scripts/valider.py --liste   # affiche les propositions en attente

Comportement :
- lit actualites/data/pending_proposals.json (format inchangé : propositions
  numérotées avec titre, type, dates, lieu, lien, resume, confiance_pct,
  source_message_id),
- pour chaque numéro validé : détermine le prochain id A000N (scan des
  citationKeys de la collection Actualités, max + 1), crée l'item Zotero
  selon le contrat des types (CEO 12/10/26 + lot 5 : 10 types) :
    type → itemType   evenement     -> presentation
                        media_publie -> report
                        outil_publie  -> document
                        information   -> document
                        contact/projet/organisation/lieu/
                        question/idee -> document (lot 5, bi-collection)
    Alias legacy ACCEPTÉS en entrée et NORMALISÉS avant écriture
    (l'item Zotero porte TOUJOURS le type nouveau dans « Type: ») :
        evenement_a_venir, evenement_passe -> evenement
        ressource_publiee                  -> media_publie
        information_parlement              -> information
    (« evenement_passe » n'existe plus : c'est les dates qui font foi
    pour le caractère passé.)
    Lot 5 — les 6 nouvelles formes (contact, projet, organisation,
    lieu, question, idee) sont BI-COLLECTION (Actualités + collection
    de l'app source : calque du précédent media_publie → Médiathèque,
    outil_publie → Outilthèque) et SANS date obligatoire (projet :
    dates OPTION B si fournies ; les autres : sans date le champ
    date reste absent — aucune invention).
    date  → « AAAA-MM-JJ » seul, sinon « AAAA-MM-JJ/AAAA-MM-JJ »
            (intervalle natif Zotero, OPTION B du CEO)
    extra → « Type: <type normalisé> » + « Source message id: <id> »
            (si non vide)
    dateAdded/dateModified → date du jour T00:00:00Z
    citationKey = id, collections=[Actualités (+ app source lot 5)],
    tags=[]
- refuse les doublons : source_message_id, lien ou titre déjà existant dans
  la collection (scan des items),
- retire les propositions validées du pending (même mécanique que l'ancienne
  version),
- NE FAIT AUCUN git commit/push (la bascule K6 décide du pipeline) —
  imprime « VALIDÉ n°X -> citationKey A000N » par succès.

Aucune invention : les champs viennent tels quels du pending.
Clé d'écriture : coffre ~/sys_admin/secrets/client/zotero.key (jamais affichée).
stdlib uniquement (urllib) via zotero_api.py.
"""

import datetime
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from zotero_api import DEFAULT_GROUP_ID, ZoteroClient, ZoteroError, load_key

REPO = Path(__file__).resolve().parent.parent
PENDING = REPO / "actualites" / "data" / "pending_proposals.json"

GROUP_ID = DEFAULT_GROUP_ID
ACTUALITES_NAME = "Actualités"
EXPECTED_COLLECTION_KEY = "U4HFDR68"
# Collections cibles de la bi-collection (contrat 3 formes, CEO 12/10/26
# « un seul et même enregistrement ») : un média publié validé via le
# pipeline mail est aussi membre de la Médiathèque, un outil publié de
# l'Outilthèque — la même fiche est servie par les deux grilles.
MEDIATHEQUE_COLLECTION_KEY = "MCKNJI9M"
OUTILTHEQUE_COLLECTION_KEY = "3Z7QJHRU"
# Lot 5 — collections bi-cibles des 6 nouvelles formes (CEO 12/10/26) :
# un item actualités de type T est aussi membre de la collection de T —
# même fiche servie par les deux grilles (calque media_publie/outil_publie).
CONTACTS_COLLECTION_KEY = "JI7JP8AZ"
PROJETS_COLLECTION_KEY = "RPZFWI9M"
ORGANISATIONS_COLLECTION_KEY = "9DZCCXQE"
LIEUX_COLLECTION_KEY = "UMMXNXDJ"
QUESTIONS_COLLECTION_KEY = "6IEE7MF2"
IDEES_COLLECTION_KEY = "99X4HHIB"

TYPE_TO_ITEMTYPE = {
    "evenement": "presentation",
    "media_publie": "report",
    "outil_publie": "document",
    "information": "document",
    # Lot 5 — 6 nouvelles formes (calque des constructeurs des apps
    # sources, itemType document)
    "contact": "document",
    "projet": "document",
    "organisation": "document",
    "lieu": "document",
    "question": "document",
    "idee": "document",
}

# Seconde collection par type (bi-collection) — absent = Actualités seule.
# Lot 5 : les 6 nouvelles formes sont bi-collection, calque du
# précédent media_publie → Médiathèque / outil_publie → Outilthèque.
BICOLLECTION_KEYS = {
    "media_publie": MEDIATHEQUE_COLLECTION_KEY,
    "outil_publie": OUTILTHEQUE_COLLECTION_KEY,
    "contact": CONTACTS_COLLECTION_KEY,
    "projet": PROJETS_COLLECTION_KEY,
    "organisation": ORGANISATIONS_COLLECTION_KEY,
    "lieu": LIEUX_COLLECTION_KEY,
    "question": QUESTIONS_COLLECTION_KEY,
    "idee": IDEES_COLLECTION_KEY,
}

# Types du lot 5 : formes des autres apps, SANS contrainte de date
# (le pipeline mail ne les remplit pas forcément ; projet porte ses
# dates en OPTION B si fournies, calque check_projets).
LOT5_TYPES = {"contact", "projet", "organisation", "lieu", "question", "idee"}

# Alias legacy : anciens types des actualités, ACCEPTÉS en entrée
# (propositions en vol, issues GitHub déjà ouvertes) et NORMALISÉS vers
# le nouveau type AVANT toute écriture. « evenement_passe » n'existe
# plus — c'est les dates qui font foi.
TYPE_ALIASES = {
    "evenement_a_venir": "evenement",
    "evenement_passe": "evenement",
    "ressource_publiee": "media_publie",
    "information_parlement": "information",
}


def normalize_type(typ):
    """Type brut d'une proposition → type du contrat (ou None si inconnu).

    Les 4 anciens types restent acceptés et sont renvoyés normalisés ;
    un type inconnu des deux mondes (nouveau + alias) retourne None.
    """
    if typ in TYPE_TO_ITEMTYPE:
        return typ
    return TYPE_ALIASES.get(typ)


# ---------------------------------------------------------------- pending

def read_pending():
    with open(PENDING, encoding="utf-8") as f:
        return json.load(f)


def write_pending(pending):
    with open(PENDING, "w", encoding="utf-8") as f:
        json.dump(pending, f, ensure_ascii=False, indent=2)
        f.write("\n")


def normalize_mid(mid):
    mid = (mid or "").strip()
    if mid.startswith("<") and mid.endswith(">"):
        mid = mid[1:-1]
    return mid.strip()


# ---------------------------------------------------------------- collection

def load_collection(client):
    """Clé de collection + items top + index anti-doublon."""
    ckey = client.find_collection(ACTUALITES_NAME)
    if ckey != EXPECTED_COLLECTION_KEY:
        raise ZoteroError(
            f"collection « {ACTUALITES_NAME} » trouvée sous la clé {ckey}, "
            f"{EXPECTED_COLLECTION_KEY} attendue"
        )
    items = client.collection_items_top(ckey)
    return ckey, items


def next_id(items):
    """Prochain id A000N : scan des citationKeys, max + 1 (12 existants -> A0013)."""
    nums = []
    for it in items:
        m = re.match(r"A(\d+)$", (it.get("data") or {}).get("citationKey") or "")
        if m:
            nums.append(int(m.group(1)))
    return f"A{(max(nums) + 1) if nums else 1:04d}"


def existing_indexes(items):
    """(citationKeys, mids, liens, titres) déjà présents dans la collection."""
    keys, mids, links, titles = set(), set(), set(), set()
    for it in items:
        data = it.get("data") or {}
        ck = (data.get("citationKey") or "").strip()
        if ck:
            keys.add(ck)
        for line in (data.get("extra") or "").split("\n"):
            line = line.strip()
            if line.startswith("Source message id:"):
                mid = line.split(":", 1)[1].strip()
                if mid:
                    mids.add(normalize_mid(mid))
        link = (data.get("url") or "").strip()
        if link:
            links.add(link)
        title = (data.get("title") or "").strip()
        if title:
            titles.add(title)
    return keys, mids, links, titles


def build_extra(typ, mid):
    extra = f"Type: {typ}"
    if mid:
        extra += f"\nSource message id: {mid}"
    return extra


def build_item(prop, new_id, collection_key):
    """proposition pending -> item Zotero (mapping K3, dateAdded = jour).

    Le type est NORMALISÉ (alias legacy acceptés) : c'est le type
    normalisé qui part dans « Type: » et qui choisit l'itemType.

    Contrat 3 formes (CEO 12/10/26 « un seul et même enregistrement ») :
    un média publié est aussi membre de la collection Médiathèque, un
    outil publié de la collection Outilthèque — la même fiche est servie
    par les deux grilles (le fetch de chaque app lit ses propres
    champs). Le pipeline mail ne collecte pas les champs propres aux
    formulaires médiathèque/outilthèque (auteur·e·s, catégorie) : rien
    n'est inventé, l'item garde les champs actualités du mail.

    Lot 5 — 6 nouvelles formes (contact, projet, organisation, lieu,
    question, idee), calque EXACT du précédent : membre des DEUX
    collections (Actualités + collection de T via BICOLLECTION_KEYS).
    AUCUNE contrainte de date pour ces formes (le pipeline mail ne les
    remplit pas) SAUF projet : dates OPTION B « d1/d2 » si fournies,
    d1 seul sinon (calque build_item_projets — sans date, le front
    affiche « En construction »). citationKey A000N : l'item vit dans
    la collection Actualités, c'est elle qui attribue la clé.
    """
    typ = normalize_type((prop.get("type") or "").strip())
    itype = TYPE_TO_ITEMTYPE.get(typ) if typ else None
    if not itype:
        raise ZoteroError(f"proposition : type inconnu « {prop.get('type')} »")
    d1 = (prop.get("date_debut") or "").strip()
    d2 = (prop.get("date_fin") or "").strip()
    added = f"{datetime.date.today().isoformat()}T00:00:00Z"
    collections = [collection_key]
    second = BICOLLECTION_KEYS.get(typ or "")
    if second:
        collections.append(second)

    # --- lot 5 : forme projet (dates OPTION B FACULTATIVES, calque
    #     build_item_projets — sans aucune date : pas de champ date) ---
    if typ == "projet":
        item = {
            "itemType": itype,
            "citationKey": new_id,
            "title": (prop.get("titre") or "").strip(),
            "abstractNote": (prop.get("resume") or "").strip(),
            "place": (prop.get("lieu") or "").strip(),
            "url": (prop.get("lien") or "").strip(),
            "extra": build_extra(typ, normalize_mid(prop.get("source_message_id", ""))),
            "collections": collections,
            "tags": [],
            "dateAdded": added,
            "dateModified": added,
        }
        if d1 and d2:
            item["date"] = f"{d1}/{d2}"
        elif d1:
            item["date"] = d1
        return item

    # --- lot 5 : formes sans date (contact, organisation, lieu,
    #     question, idee) : AUCUNE contrainte de date — l'item est
    #     posé sans champ date si le mail n'en fournit pas ---
    if typ in LOT5_TYPES:
        item = {
            "itemType": itype,
            "citationKey": new_id,
            "title": (prop.get("titre") or "").strip(),
            "abstractNote": (prop.get("resume") or "").strip(),
            "place": (prop.get("lieu") or "").strip(),
            "url": (prop.get("lien") or "").strip(),
            "extra": build_extra(typ, normalize_mid(prop.get("source_message_id", ""))),
            "collections": collections,
            "tags": [],
            "dateAdded": added,
            "dateModified": added,
        }
        if d1:
            item["date"] = d1 if not d2 else f"{d1}/{d2}"
        return item

    # --- 4 formes historiques : date_debut OBLIGATOIRE (comportement
    #     inchangé, rétrocompatible) ---
    if not d1:
        raise ZoteroError(f"proposition : date_debut vide")
    date = d1 if not d2 else f"{d1}/{d2}"
    return {
        "itemType": itype,
        "citationKey": new_id,
        "title": (prop.get("titre") or "").strip(),
        "abstractNote": (prop.get("resume") or "").strip(),
        "date": date,
        "place": (prop.get("lieu") or "").strip(),
        "url": (prop.get("lien") or "").strip(),
        "extra": build_extra(typ, normalize_mid(prop.get("source_message_id", ""))),
        "collections": collections,
        "tags": [],
        "dateAdded": added,
        "dateModified": added,
    }


# ---------------------------------------------------------------- --liste

def do_list():
    pending = read_pending()
    props = pending.get("propositions", [])
    if not props:
        print("Aucune proposition en attente.")
        return 0
    print(f"{len(props)} proposition(s) en attente "
          f"(actualites/data/pending_proposals.json) :")
    for p in props:
        print(f"\n  {p.get('numero')}. {p.get('titre')}")
        print(f"     type        : {p.get('type')}")
        dates = p.get("date_debut") or "—"
        if p.get("date_fin"):
            dates += f" → {p.get('date_fin')}"
        print(f"     dates       : {dates} {p.get('heure', '')}")
        print(f"     lieu        : {p.get('lieu') or '—'}")
        print(f"     lien        : {p.get('lien') or '—'}")
        print(f"     confiance   : {p.get('confiance_pct')} %")
        print(f"     résumé      : {p.get('resume')}")
    return 0


# ---------------------------------------------------------------- main

def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    if args[0] == "--liste":
        return do_list()

    numbers = []
    ignored = []
    for a in args:
        if a == "--no-push":
            # No-op conservé pour compatibilité : cette version ne fait
            # AUCUN git commit/push (la bascule K6 décide du pipeline).
            ignored.append(a)
            continue
        if not a.isdigit():
            print(f"ERREUR : argument invalide {a!r} (numéros attendus)")
            return 2
        numbers.append(int(a))
    if ignored:
        print("(--no-push ignoré : cette version ne fait aucun push)")

    pending = read_pending()
    props = pending.get("propositions", [])
    by_num = {p.get("numero"): p for p in props}

    missing = [n for n in numbers if n not in by_num]
    if missing:
        print(f"ERREUR : numéro(s) absent(s) du pending : {missing}")
        print(f"Numéros disponibles : {sorted(by_num)}")
        return 2

    key = load_key(mode="write")
    client = ZoteroClient(key, GROUP_ID)
    info = client.check_write_access()
    print(f"[OK] clé d'écriture : utilisateur {info.get('userID')} "
          f"({info.get('username')}), write sur groupe {GROUP_ID}")

    ckey, items = load_collection(client)
    print(f"[OK] collection « {ACTUALITES_NAME} » ({ckey}) : {len(items)} items top")
    keys, mids, links, titles = existing_indexes(items)

    validated, rejected = [], []
    for n in numbers:
        p = by_num[n]
        mid = normalize_mid(p.get("source_message_id", ""))
        lien = (p.get("lien") or "").strip()
        titre = (p.get("titre") or "").strip()
        # Contrôle du type : alias legacy acceptés (normalisés avant
        # écriture dans build_item) ; un type inconnu des deux mondes
        # reste refusé.
        typ = normalize_type((p.get("type") or "").strip())
        if not typ:
            rejected.append((n, f"type inconnu « {p.get('type')} »"))
            continue
        if mid and mid in mids:
            rejected.append((n, "message_id déjà dans la collection"))
            continue
        if lien and lien in links:
            rejected.append((n, "lien déjà dans la collection"))
            continue
        if titre and titre in titles:
            rejected.append((n, "titre déjà dans la collection"))
            continue

        new_id = next_id(items)
        item = build_item(p, new_id, ckey)
        successful, failed = client.post_items([item])
        if failed or new_id not in successful:
            rejected.append((n, f"échec POST : {failed or 'réponse inattendue'}"))
            continue
        items.append({  # les index doublons voient le nouvel item
            "key": successful[new_id],
            "version": None,
            "data": item,
        })
        keys.add(new_id)
        if mid:
            mids.add(mid)
        if lien:
            links.add(lien)
        if titre:
            titles.add(titre)
        validated.append((n, new_id, titre))

    # retrait des propositions validées du pending
    if validated:
        removed_nums = {n for n, _, _ in validated}
        pending["propositions"] = [
            p for p in props if p.get("numero") not in removed_nums
        ]
        write_pending(pending)

    for n, new_id, titre in validated:
        print(f"VALIDÉ n°{n} -> citationKey {new_id} : {titre}")
    for n, r in rejected:
        print(f"REFUSÉ n°{n} : {r}")

    if not validated:
        print("Aucune actualité validée.")
        return 1 if rejected else 0
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ZoteroError as e:
        print(f"ECHEC : {e}", file=sys.stderr)
        sys.exit(1)
