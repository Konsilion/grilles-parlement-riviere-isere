#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""K3 : migre les 12 cartes du CSV actualites vers des items Zotero.

Source de verite : ~/actualites-parlement/data/actualites.csv (lecture seule ;
le CSV et l'ancien repo ~/actualites-parlement ne sont JAMAIS modifies).

Cible : collection « Actualites » du groupe Zotero 6610185 — cle retrouvee
dynamiquement par recherche du nom (valeur attendue U4HFDR68, prouvee en K1 ;
contrôle de cohérence, pas source de vérité).

Mapping (prouve lors de l'evaluation) :
- id (A000N)          -> citationKey
- titre               -> title
- description         -> abstractNote
- type                -> itemType + extra « Type: <type> »
                        evenement_a_venir|evenement_passe -> presentation
                        ressource_publiee                 -> report
                        information_parlement             -> document
- date_debut/date_fin -> date "AAAA-MM-JJ" seul, sinon "AAAA-MM-JJ/AAAA-MM-JJ"
                        (intervalle natif Zotero, OPTION B du CEO)
- lieu                -> place (validite verifiee par GET /itemTypeFields)
- lien                -> url
- source_message_id   -> extra « Source message id: <id> » (si non vide)
- date_ajout          -> dateAdded force "<date_ajout>T00:00:00Z" (+ dateModified)
- collections         -> [cle collection Actualites] UNIQUEMENT, tags -> []

PIEGES couverts :
- POST batch Zotero : HTTP 200 MEME SI des items echouent -> on parse toujours
  "failed" et on compte "successful", puis on re-fetch tout.
- Idempotence : les citationKeys existants sont scans avant ; un re-run ne
  cree que les items manquants, jamais de doublon.
- Echec = exit 1 avec message ; succes = exit 0 apres verification complete.

Usage :
  python3 scripts/migrate_csv_to_zotero.py --dry-run   # verifie sans ecrire
  python3 scripts/migrate_csv_to_zotero.py              # execution reelle

Cle d'ecriture : ~/secrets/client/zotero.key (jamais affichee).
stdlib uniquement (urllib).
"""

import csv
import json
import sys
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

GROUP_ID = "6610185"
API_BASE = "https://api.zotero.org"
CSV_PATH = Path.home() / "actualites-parlement" / "data" / "actualites.csv"
WRITE_KEY_PATH = Path.home() / "secrets" / "client" / "zotero.key"
EXPECTED_ACTUALITES_NAME = "Actualités"      # nom stocke byte-exact (K1)
EXPECTED_ACTUALITES_KEY = "U4HFDR68"         # attendu, retrouve par nom
MEDIATHEQUE_KEY = "MCKNJI9M"                 # interdit dans les items crees

TYPE_TO_ITEMTYPE = {
    "evenement_a_venir": "presentation",
    "evenement_passe": "presentation",
    "ressource_publiee": "report",
    "information_parlement": "document",
}

DRY_RUN = "--dry-run" in sys.argv

# ---------------------------------------------------------------- HTTP (stdlib)

KEY = None


def api(method, path, payload=None):
    """Appel API Zotero. Retourne (status, corps JSON decode)."""
    url = f"{API_BASE}{path}"
    headers = {
        "Zotero-API-Key": KEY,
        "Zotero-API-Version": "3",
    }
    data = None
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            body = resp.read().decode("utf-8")
            status = resp.status
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:800]
        raise SystemExit(f"ERREUR HTTP {e.code} sur {method} {path}\n{detail}")
    if not body:
        fail(f"{method} {path} : corps vide alors qu'un JSON etait attendu")
    return status, json.loads(body)


def strip_accents(s):
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c)
    ).lower()


def fetch_all_pages(path, limit=100):
    """GET pagine : retourne la liste complete des objets de la reponse."""
    out, start = [], 0
    while True:
        _, page = api("GET", f"{path}?limit={limit}&start={start}")
        if not page:
            break
        out.extend(page)
        if len(page) < limit:
            break
        start += limit
    return out


def fail(msg):
    raise SystemExit(f"ECHEC : {msg}")


# ---------------------------------------------------------------- Controles prealables

def check_write_key():
    """GET /keys/current : prouve l'identite et le droit d'ecriture (sans afficher la cle)."""
    _, info = api("GET", "/keys/current")
    access = info.get("access", {}) or {}
    groups = access.get("groups", {}) or {}
    g = groups.get(GROUP_ID)
    # Nouveau schema : access.groups.<id>.write ; ancien : groups.all.write (tous groupes)
    if isinstance(g, bool):
        g_write = g
    else:
        g_write = bool((g or {}).get("write")) or bool((groups.get("all") or {}).get("write"))
    if not g_write:
        fail(f"la cle n'a pas le droit write sur le groupe {GROUP_ID} (access={json.dumps(access)})")
    print(f"[OK] Cle d'ecriture : utilisateur {info.get('userID')} "
          f"({info.get('username')}), write=true sur groupe {GROUP_ID}")


def find_actualites_key():
    """Retrouve la cle de la collection Actualites par son nom."""
    cols = fetch_all_pages(f"/groups/{GROUP_ID}/collections", limit=50)
    wanted = strip_accents(EXPECTED_ACTUALITES_NAME)
    found = None
    for c in cols:
        name = c.get("data", {}).get("name", "")
        if name == EXPECTED_ACTUALITES_NAME or strip_accents(name) == wanted:
            found = c
            break
    if not found:
        fail(f"collection « {EXPECTED_ACTUALITES_NAME} » introuvable "
             f"({len(cols)} collections scannees)")
    key = found["key"]
    if key != EXPECTED_ACTUALITES_KEY:
        fail(f"collection trouvee sous la cle {key}, attendu {EXPECTED_ACTUALITES_KEY}")
    print(f"[OK] Collection « {found['data']['name']} » : cle {key} "
          f"(attendue {EXPECTED_ACTUALITES_KEY}, conforme)")
    return key


def check_item_type_fields():
    """Verifie que place est un champ valide pour chaque itemType utilise."""
    for itype in sorted(set(TYPE_TO_ITEMTYPE.values())):
        _, fields = api("GET", f"/itemTypeFields?itemType={itype}")
        names = {f.get("field") for f in fields}
        for needed in ("title", "abstractNote", "date", "place", "url"):
            if needed not in names:
                fail(f"champ {needed} invalide pour itemType {itype}")
        print(f"[OK] itemType {itype} : champs title/abstractNote/date/place/url valides "
              f"({len(fields)} champs)")


def existing_citation_keys():
    """Scan tous les items du groupe, retourne l'ensemble des citationKeys."""
    items = fetch_all_pages(f"/groups/{GROUP_ID}/items")
    keys = set()
    for it in items:
        ck = it.get("data", {}).get("citationKey")
        if ck:
            keys.add(ck)
    print(f"[OK] citationKeys existants dans le groupe : {len(keys)} "
          f"({len(items)} items au total, attachements inclus)")
    return keys


def group_items_top_count():
    items = fetch_all_pages(f"/groups/{GROUP_ID}/items/top")
    return len(items)


# ---------------------------------------------------------------- CSV -> items

def read_csv_rows():
    rows = []
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rows.append(row)
    if len(rows) != 12:
        fail(f"CSV : {len(rows)} lignes lues, 12 attendues")
    ids = [r["id"] for r in rows]
    if len(set(ids)) != 12:
        fail(f"CSV : ids non uniques : {ids}")
    print(f"[OK] CSV {CSV_PATH} : 12 lignes, ids {ids[0]}..{ids[-1]}")
    return rows


def build_extra(row):
    extra = f"Type: {row['type']}"
    if row.get("source_message_id", "").strip():
        extra += f"\nSource message id: {row['source_message_id']}"
    return extra


def build_date(row):
    d1 = row["date_debut"].strip()
    d2 = row["date_fin"].strip()
    if not d1:
        fail(f"ligne {row['id']} : date_debut vide")
    return d1 if not d2 else f"{d1}/{d2}"


def build_item(row, collection_key):
    itype = TYPE_TO_ITEMTYPE.get(row["type"])
    if not itype:
        fail(f"ligne {row['id']} : type CSV inconnu « {row['type']} »")
    added = f"{row['date_ajout']}T00:00:00Z"
    return {
        "itemType": itype,
        "citationKey": row["id"],
        "title": row["titre"],
        "abstractNote": row["description"],
        "date": build_date(row),
        "place": row["lieu"],
        "url": row["lien"],
        "extra": build_extra(row),
        "collections": [collection_key],
        "tags": [],
        "dateAdded": added,
        "dateModified": added,
    }


def expected_fields(row):
    """Ce qui doit etre relu par item apres creation."""
    added = f"{row['date_ajout']}T00:00:00Z"
    return {
        "citationKey": row["id"],
        "title": row["titre"],
        "abstractNote": row["description"],
        "date": build_date(row),
        "place": row["lieu"],
        "url": row["lien"],
        "extra": build_extra(row),
        "itemType": TYPE_TO_ITEMTYPE[row["type"]],
        "collections": None,  # remplace par la cle dynamique
        "dateAdded": added,
        "dateModified": added,
    }


# ---------------------------------------------------------------- Execution

def main():
    global KEY
    if not WRITE_KEY_PATH.exists():
        fail(f"cle d'ecriture absente : {WRITE_KEY_PATH}")
    KEY = WRITE_KEY_PATH.read_text(encoding="utf-8").strip()
    if not KEY:
        fail("fichier de cle vide")

    print(f"=== K3 : migration CSV -> items Zotero (groupe {GROUP_ID}) "
          f"{'DRY-RUN' if DRY_RUN else 'EXECUTION REELLE'} ===\n")

    # 0. Prealables
    check_write_key()
    collection_key = find_actualites_key()
    check_item_type_fields()
    existing = existing_citation_keys()

    # 1. CSV -> items a creer (idempotence)
    rows = read_csv_rows()
    to_create, skipped = [], []
    for row in rows:
        if row["id"] in existing:
            skipped.append(row["id"])
        else:
            to_create.append((row, build_item(row, collection_key)))
    expected_top_before = 92 + len(skipped)
    top_before = group_items_top_count()
    if top_before != expected_top_before:
        fail(f"items/top du groupe avant migration : {top_before}, "
             f"{expected_top_before} attendus (92 mediatheque + {len(skipped)} deja migres)")
    print(f"[OK] items/top du groupe avant migration : {top_before} "
          f"(92 mediatheque + {len(skipped)} deja migres)")
    print(f"[OK] a creer : {len(to_create)}, deja presents (idempotence) : {len(skipped)} {skipped}\n")

    print("--- Items a creer (mapping) ---")
    for row, item in to_create:
        print(f"  {item['citationKey']} | {item['itemType']} | date={item['date']} | "
              f"place={item['place'][:60]}")
        print(f"    title  : {item['title']}")
        print(f"    extra  : {item['extra'].replace(chr(10), ' / ')}")
        print(f"    ajout  : {item['dateAdded']} | collections={item['collections']} | tags=[]")
    print()

    if DRY_RUN:
        print("DRY-RUN : controle prealable OK, rien n'a ete ecrit.")
        return

    # 2. POST batch (200 peut masquer des echecs -> on parse tout)
    created_keys = {}
    if to_create:
        payload = [item for _, item in to_create]
        status, resp = api("POST", f"/groups/{GROUP_ID}/items", payload)
        if status != 200:
            fail(f"POST renvoie {status}")
        successful = resp.get("successful", {}) or {}
        failed = resp.get("failed", {}) or {}
        unchanged = resp.get("unchanged", {}) or {}
        if failed:
            fail(f"POST : {len(failed)} items en echec (HTTP 200 quand meme) : "
                f"{json.dumps(failed, ensure_ascii=False)}")
        if unchanged:
            fail(f"POST : {len(unchanged)} items unchanged : {unchanged}")
        if len(successful) != len(payload):
            fail(f"POST : {len(successful)} items crees, {len(payload)} envoyes")
        for idx, obj in successful.items():
            ck = (obj.get("data") or {}).get("citationKey")
            created_keys[ck] = obj.get("key")
        print(f"[OK] POST : {len(successful)}/{len(payload)} items crees, 0 failed "
              f"(status HTTP {status})\n")

    # 3. Verification par re-fetch
    top_collection = fetch_all_pages(
        f"/groups/{GROUP_ID}/collections/{collection_key}/items/top")
    if len(top_collection) != 12:
        fail(f"re-fetch items/top de la collection : {len(top_collection)}, 12 attendus")

    # 4. GET individuel + releve (donnees RELUES, pas envoyees)
    by_ck = {}
    for it in top_collection:
        by_ck[(it.get("data") or {}).get("citationKey")] = it
    missing = [row["id"] for row in rows if row["id"] not in by_ck]
    if missing:
        fail(f"citationKeys absents de la collection apres migration : {missing}")
    print(f"[OK] re-fetch items/top collection {collection_key} : "
          f"{len(top_collection)} items, les 12 citationKeys du CSV presents\n")

    print("--- RELEVE : verification individuelle (donnees relues via GET) ---")
    problems = []
    records = []
    for row in rows:
        ck = row["id"]
        item_key = created_keys.get(ck) or by_ck[ck]["key"]
        _, fetched = api("GET", f"/groups/{GROUP_ID}/items/{item_key}")
        data = fetched.get("data", {}) or {}
        exp = expected_fields(row)
        exp["collections"] = [collection_key]
        checks = {}
        for field in ("citationKey", "title", "abstractNote", "date", "place",
                      "url", "extra", "itemType", "collections",
                      "dateAdded", "dateModified"):
            checks[field] = data.get(field) == exp[field]
        bad = [f for f, ok in checks.items() if not ok]
        if bad:
            problems.append((ck, bad, {f: (data.get(f), exp[f]) for f in bad}))
        if MEDIATHEQUE_KEY in (data.get("collections") or []):
            problems.append((ck, ["collection_mediatheque"], {}))
        records.append({
            "key": item_key,
            "citationKey": data.get("citationKey"),
            "title": data.get("title"),
            "itemType": data.get("itemType"),
            "date": data.get("date"),
            "place": data.get("place"),
            "extra": data.get("extra"),
            "url": data.get("url"),
            "dateAdded": data.get("dateAdded"),
            "dateModified": data.get("dateModified"),
            "collections": data.get("collections"),
            "parsedDate": (fetched.get("meta") or {}).get("parsedDate"),
            "verifie": not bad,
        })
        print(f"\n* {data.get('citationKey')} (cle item {item_key})")
        print(f"  title     : {data.get('title')}")
        print(f"  itemType  : {data.get('itemType')}")
        print(f"  date      : {data.get('date')}  (parsedDate={records[-1]['parsedDate']})")
        print(f"  place     : {data.get('place')}")
        print(f"  url       : {data.get('url')}")
        print(f"  dateAdded : {data.get('dateAdded')}  (dateModified={data.get('dateModified')})")
        print(f"  collections : {data.get('collections')}  tags={data.get('tags')}")
        print("  extra     :")
        for line in (data.get("extra") or "").split("\n"):
            print(f"    | {line}")
        if data.get("abstractNote"):
            print(f"  abstract  : {data['abstractNote'][:80]}…")
        print(f"  VERIF     : {'OK' if not bad else 'ECARTS ' + ', '.join(bad)}")

    # 5. Controle final du groupe
    top_after = group_items_top_count()
    print(f"\n[{'OK' if top_after == 104 else 'ECART'}] items/top du groupe apres migration : "
          f"{top_after} (attendu 92 + 12 = 104)")
    if top_after != 104:
        problems.append(("GROUPE", [f"items/top={top_after}"], {}))

    if problems:
        print("\n=== PROBLEMES DETECTES ===")
        for ck, bad, detail in problems:
            print(f"  {ck} : {bad} -> {json.dumps(detail, ensure_ascii=False)}")
        fail("verification incomplete")

    print("\n=== MIGRATION OK : 12/12 items crees et verifies dans la collection "
          f"« {EXPECTED_ACTUALITES_NAME} » ({collection_key}), groupe a {top_after} items top, "
          "0 failed, aucun item mediatheque touche ===")
    print(json.dumps(records, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
