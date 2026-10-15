#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fetch_actualites.py — génère actualites/data/actualites.json depuis Zotero
+ AGRÈGE les 8 autres applications du repo (règle CEO 12/10/26 : tout nouvel
ajout d'une app doit apparaître dans « Actualités », tri d'affichage par
date d'ajout/modification).

Deux périmètres :

1. FICHES NATIVES — collection « Actualités » (U4HFDR68) du groupe Zotero
   6610185, items/top, noms de champs IDENTIQUES aux colonnes du CSV
   historique (contrat de données K5) + 3 champs additifs :
     zotero_key       = clé d'item Zotero (racine de l'item API)
     date_modif       = data.dateModified coupé au « T » ("" si absent)
     source_app       = "" (les natives n'ont pas d'app d'origine)

2. AGRÉGATION — les 8 autres apps du repo sont relues dans le REPO (chemins
   relatifs à la racine) et chaque fiche devient une fiche au CONTRAT
   ACTUALITÉS + extensions :
     source_app      fichier                              structure
     mediatheque     mediatheque/data/collection.json     dict {items: [...]}
     personnes       personnes/data/personnes.json         liste
     projets         projets/data/projets.json            liste
     organisations   organisations/data/organisations.json liste
     outiltheque     outiltheque/data/outils.json         liste
     lieux           lieux/data/lieux.json                liste
     questions       questions/data/questions.json        liste
     idees           idees/data/idees.json                liste
   Mapping FIGÉ par app (contrat — ne pas inventer) :
     id          = id de la fiche source (médiathèque : la « key » Zotero)
     type        = media_publie | personne | projet | organisation |
                   outil_publie | lieu | question | idee (fermé)
     titre       = title (médiathèque) | nom (personnes/organisations/
                   outiltheque/lieux) | titre (projets/questions/idees)
     description = abstract (médiathèque) | description (autres)
     date_debut / date_fin = TOUJOURS "" (règle CEO : le tri d'affichage se
                   fait par date d'ajout — même les projets qui ont des dates)
     lieu        = lieu (personnes/projets/organisations/outiltheque) |
                   adresse (lieux) | "" (médiathèque/questions/idees)
     lien        = « lien » de la source ; médiathèque : « url »
     date_ajout  = « date_ajout » de la source ; médiathèque : « dateAdded »
     source_message_id = "" (propre aux natives)
     zotero_key  = « zotero_key » de la source si présent, sinon "" (les
                   fetchs des autres apps l'ajoutent en parallèle ; la
                   médiathèque porte déjà sa clé dans « key »)
     date_modif  = « date_modif » de la source si présent, sinon ""
     source_app  = nom de l'app d'origine
   Tolérance : fichier absent/vide/illisible ou dict inattendu →
   avertissement imprimé, app SAUTÉE (jamais de crash, jamais de null :
   tout champ absent → chaîne vide ; titre/description vides → fiche
   quand même, le front gère).

Dédoublonnage PAR CLÉS ZOTERO uniquement (JAMAIS par titre ni sous-chaîne —
piège vécu, faux positifs garantis) : l'ensemble des zotero_key des fiches
NATIVES est construit ; une fiche EXTERNE dont la zotero_key est non vide
ET déjà portée par une native est ÉLIMINÉE (la native prime : elle porte
les dates d'événement et le message-id source). Une fiche externe SANS
zotero_key est conservée (pas dédoublonnable — avertissement compté). Les
fiches natives ne sont JAMAIS éliminées.

Ordre de sortie : AUCUN tri — le front trie. Les natives d'abord (compor-
tement historique inchangé : tri déterministe par id), puis les externes
dans l'ordre des apps du tableau ci-dessus, dans l'ordre du fichier de
chaque app. UTF-8, ensure_ascii=False, indentation 2.

items/top de la collection ne remonte PAS les sous-collections — sans objet
ici : les items actualités sont tous directement dans la collection (prouvé
K1/K3, aucune sous-collection).

Usage :
  python3 scripts/fetch_actualites.py            # écrit actualites/data/actualites.json
  python3 scripts/fetch_actualites.py --compare-csv <chemin>
      # en plus : compare les FICHES NATIVES champ par champ avec le CSV
      # historique et imprime le relevé (écart = ligne par ligne, champ
      # par champ)

Clé : lecture seule (coffre ~/sys_admin/secrets/client/zotero.key, sinon config de la
vitrine). Clé d'écriture jamais nécessaire ici — fetch en LECTURE SEULE,
aucune écriture Zotero (pas de POST/PATCH). stdlib uniquement.
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

# ------------------------------------------------------------- agrégation

# Mapping FIGÉ par app (contrat lot 2 — ne pas inventer d'autre mapping) :
# (source_app, chemin du JSON depuis la racine du repo, type fermé,
#  clé titre, clé description, clé lieu (None → ""), clé lien, clé date_ajout)
EXTERNAL_APPS = [
    ("mediatheque", "mediatheque/data/collection.json",
     "media_publie", "title", "abstract", None, "url", "dateAdded"),
    ("personnes", "personnes/data/personnes.json",
     "personne", "nom", "description", "lieu", "lien", "date_ajout"),
    ("projets", "projets/data/projets.json",
     "projet", "titre", "description", "lieu", "lien", "date_ajout"),
    ("organisations", "organisations/data/organisations.json",
     "organisation", "nom", "description", "lieu", "lien", "date_ajout"),
    ("outiltheque", "outiltheque/data/outils.json",
     "outil_publie", "nom", "description", "lieu", "lien", "date_ajout"),
    ("lieux", "lieux/data/lieux.json",
     "lieu", "nom", "description", "adresse", "lien", "date_ajout"),
    ("questions", "questions/data/questions.json",
     "question", "titre", "description", None, "lien", "date_ajout"),
    ("idees", "idees/data/idees.json",
     "idee", "titre", "description", None, "lien", "date_ajout"),
]

# Champs du contrat fiche externe (ordre de sérialisation, calque natif).
EXTERNAL_FIELDS = [
    "id", "type", "titre", "description",
    "date_debut", "date_fin", "lieu", "lien",
    "date_ajout", "source_message_id",
    "zotero_key", "date_modif", "source_app",
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


# --------------------------------------------- intégrité référentielle natives

# Contrat de type (CEO 12/10/26 « un seul et même enregistrement ») : une
# native media_publie/outil_publie/personne/projet/organisation/lieu/
# question/idee EST un item bi-collection (Actualités + collection de
# l'app source). Ces 8 types sont des RÉFÉRENCES vers une fiche de l'app
# cible — une native qui n'est pas bi-collection est une RÉFÉRENCE
# PENDANTE (une FK sans cible, en termes de BDD) : le lien « Voir le X »
# du front ne peut pas résoudre (SOURCE_APPS n'atteint l'app cible que
# par la fiche agrégée, jamais par une native isolée).
#
# SOURCE UNIQUE DE VÉRITÉ : le registre BICOLLECTION_KEYS de valider.py
# (celui qui pilote la CRÉATION des items bi-collection) — un type ajouté
# au registre de création est automatiquement couvert par ce contrôle.
# Les noms d'app viennent d'EXTERNAL_APPS (mapping type → app ci-dessus).
from valider import BICOLLECTION_KEYS

_APP_BY_TYPE = {spec[2]: spec[0] for spec in EXTERNAL_APPS}


def check_native_integrity(records):
    """Contrôle d'intégrité référentielle des fiches natives.

    Retourne la liste des références pendantes [{id, type, titre,
    source_app}] : une native d'un type référentiel qui n'est PAS
    bi-collection avec la collection de son app source. Le fetch ne
    bloque PAS (les données restent servies) mais chaque pendante est
    imprimée en [INCOHERENCE] — visible dans les logs du deploy, dans
    la sortie de tout fetch manuel, et le code de sortie reste 0.
    """
    pendantes = []
    for rec in records:
        coll_key = BICOLLECTION_KEYS.get(rec["type"])
        if coll_key is None:
            continue
        if coll_key not in rec["_collections"]:
            pendantes.append(
                {"id": rec["id"], "type": rec["type"], "titre": rec["titre"],
                 "source_app": _APP_BY_TYPE.get(rec["type"], rec["type"])}
            )
    return pendantes


def item_to_record(item):
    """item Zotero -> dict aux clés du CSV historique + 3 champs additifs
    (zotero_key, date_modif, source_app)."""
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
        "zotero_key": (item.get("key") or "").strip(),
        "date_modif": (data.get("dateModified") or "").split("T")[0].strip(),
        "source_app": "",
        # Interne (jamais sérialisé — retiré avant l'écriture) : collections
        # Zotero de l'item, pour le contrôle d'intégrité référentielle.
        "_collections": data.get("collections") or [],
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


# ---------------------------------------------------------------- agrégation

def _clean(value):
    """Nettoyage contrat externe : jamais null — tout champ absent ou None
    devient chaîne vide."""
    if value is None:
        return ""
    return str(value).strip()


def load_app_items(source_app, rel_path):
    """Charge le JSON d'une app agrégée. Retourne la liste des fiches, ou
    None si l'app doit être SAUTÉE (fichier absent/vide/illisible, dict
    inattendu) — tolérant : avertissement imprimé, jamais de crash."""
    path = REPO / rel_path
    if not path.exists():
        print(f"[ATTENTION] {source_app} : {rel_path} introuvable — app sautée")
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"[ATTENTION] {source_app} : {rel_path} illisible ({e}) — app sautée")
        return None
    if isinstance(raw, dict):
        items = raw.get("items")
        if not isinstance(items, list):
            print(f"[ATTENTION] {source_app} : {rel_path} est un dict inattendu "
                  f"(pas de liste « items ») — app sautée")
            return None
        return items
    if isinstance(raw, list):
        return raw
    print(f"[ATTENTION] {source_app} : {rel_path} : type inattendu "
          f"({type(raw).__name__}) — app sautée")
    return None


def external_record(spec, src):
    """Fiche d'une app externe -> contrat actualités + extensions
    (mapping FIGÉ, voir EXTERNAL_APPS)."""
    source_app, _rel, type_value, tkey, dkey, pkey, lkey, akey = spec
    if source_app == "mediatheque":
        rec_id = _clean(src.get("key"))            # id = clé Zotero (médiathèque)
        zotero_key = _clean(src.get("zotero_key")) or _clean(src.get("key"))
    else:
        rec_id = _clean(src.get("id"))
        zotero_key = _clean(src.get("zotero_key"))
    rec = {
        "id": rec_id,
        "type": type_value,
        "titre": _clean(src.get(tkey)),
        "description": _clean(src.get(dkey)),
        "date_debut": "",                          # règle CEO : tri par date d'ajout
        "date_fin": "",                            # idem — même pour les projets
        "lieu": _clean(src.get(pkey)) if pkey else "",
        "lien": _clean(src.get(lkey)),
        "date_ajout": _clean(src.get(akey)),
        "source_message_id": "",
        "zotero_key": zotero_key,
        "date_modif": _clean(src.get("date_modif")),
        "source_app": source_app,
    }
    return {k: rec[k] for k in EXTERNAL_FIELDS}


def aggregate_externals(records):
    """Agrège les 8 apps du repo -> (fiches externes, détail du run).

    Détoublonnage PAR CLÉS Zotero : une externe dont la zotero_key est déjà
    portée par une NATIVE est éliminée (la native prime). Retourne
    (externals, per_app, duplicates, no_key, skipped).
    """
    native_keys = {r["zotero_key"] for r in records if r["zotero_key"]}
    native_by_key = {r["zotero_key"]: r for r in records if r["zotero_key"]}

    externals = []
    per_app = []        # [(source_app, fiches conservées)] des apps traitées
    duplicates = []     # [(source_app, id externe, zotero_key, id natif)]
    no_key = {}         # source_app -> nb de fiches sans zotero_key
    skipped = []        # apps sautées (fichier absent/illisible)

    for spec in EXTERNAL_APPS:
        source_app, rel_path = spec[0], spec[1]
        src_items = load_app_items(source_app, rel_path)
        if src_items is None:
            skipped.append(source_app)
            continue
        kept = 0
        for src in src_items:
            if not isinstance(src, dict):
                print(f"[ATTENTION] {source_app} : fiche non-dict ignorée : "
                      f"{type(src).__name__}")
                continue
            rec = external_record(spec, src)
            zk = rec["zotero_key"]
            if zk and zk in native_keys:
                duplicates.append(
                    (source_app, rec["id"], zk, native_by_key[zk]["id"])
                )
                continue
            if not zk:
                no_key[source_app] = no_key.get(source_app, 0) + 1
            externals.append(rec)
            kept += 1
        per_app.append((source_app, kept))

    return externals, per_app, duplicates, no_key, skipped


# ---------------------------------------------------------------- comparaison CSV

def compare_with_csv(records, csv_path):
    """Compare les records JSON avec le CSV historique champ par champ.

    (Comparaison limitée aux FICHES NATIVES : le CSV historique précède
    l'agrégation.) Retourne la liste des écarts [(id, champ, valeur_json,
    valeur_csv)].
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

    # Ordre natif : tri déterministe par id (le front trie de toute façon ; un ordre
    # stable rend la sortie reproductible et les diffs lisibles).
    records.sort(key=lambda r: r["id"])

    # ---------------------------------------------------------- agrégation
    # Ordre global : AUCUN tri — le front trie. Natives d'abord (ordre
    # inchangé ci-dessus), puis externes dans l'ordre des apps du tableau,
    # dans l'ordre du fichier de chaque app.
    externals, per_app, duplicates, no_key, skipped = aggregate_externals(records)
    all_records = records + externals

    # Contrôle d'intégrité référentielle (garde-fou structurel) : une
    # native media_publie/outil_publie DOIT être bi-collection. Une
    # référence pendante est une incohérence de contrat, pas un crash :
    # imprimée en [INCOHERENCE], le JSON est quand même servi.
    pendantes = check_native_integrity(records)
    for ref in pendantes:
        print(f"[INCOHERENCE] {ref['id']} ({ref['type']}) : absente de la "
              f"collection {ref['source_app']} — référence pendante, "
              f"retyper la fiche (evenement/information) ou la mettre "
              f"bi-collection")

    # Le champ interne _collections ne sort JAMAIS dans le JSON servi.
    for rec in all_records:
        rec.pop("_collections", None)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(all_records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    # relevé
    print(f"[OK] collection « {ACTUALITES_NAME} » ({ckey}) : {len(items)} items top")
    print(f"[OK] écrit {OUT_PATH} ({OUT_PATH.stat().st_size} octets, UTF-8)")
    types = {}
    for r in all_records:
        types[r["type"]] = types.get(r["type"], 0) + 1
    print(f"[OK] {len(all_records)} fiches -> types : "
          + ", ".join(f"{k}={v}" for k, v in sorted(types.items())))
    for r in records:
        dates = r["date_debut"] + (f" → {r['date_fin']}" if r["date_fin"] else "")
        print(f"  {r['id']} | {r['type']} | {dates} | {r['titre'][:70]}"
              + ("…" if len(r["titre"]) > 70 else ""))

    if duplicates:
        print(f"[ATTENTION] {len(duplicates)} doublon(s) éliminé(s) — "
              f"clé Zotero déjà portée par une native :")
        for source_app, ext_id, zk, nat_id in duplicates:
            print(f"  {source_app}/{ext_id} : clé {zk} déjà portée par la native {nat_id}")
    if no_key:
        detail = ", ".join(f"{k}={v}" for k, v in no_key.items())
        print(f"[ATTENTION] {sum(no_key.values())} fiche(s) externe(s) sans "
              f"zotero_key (non dédoublonnables) : {detail}")
    if skipped:
        print(f"[ATTENTION] apps sautées (fichier absent/illisible) : "
              + ", ".join(skipped))

    parts = [f"{len(records)} natives"] + [f"{kept} {label}" for label, kept in per_app]
    dup_txt = f"{len(duplicates)} doublon" + ("s" if len(duplicates) != 1 else "")
    print(f"Actualités : {' + '.join(parts)} = {len(all_records)} fiches "
          f"({dup_txt} éliminé" + ("s" if len(duplicates) != 1 else "") + ")")

    if compare_csv:
        print(f"\n=== COMPARAISON avec {compare_csv} (champ par champ, natives) ===")
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
