#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""valider_contribution.py — modération des propositions (issues GitHub).

Parcours « esprit Datami » des applications (parlement de la rivière
Isère) : un·e visiteur remplit la modale « Proposer … » → une issue
GitHub pré-remplie (étiquette `contribution`) est soumise → l'équipe
vérifie → CE script valide la proposition :

    1. lit l'issue (bloc ```json-contribution + champ « app ») ;
    2. vérifie les doublons dans la collection Zotero cible ;
    3. crée l'item Zotero dans la BONNE collection avec le mapping
       EXACT de l'app (registre APPS ci-dessous) ;
    4. ferme l'issue avec un commentaire de remerciement ;
    5. rappelle le déploiement : `bash scripts/deploy.sh` régénère
       les data/*.json (fetch Zotero horaire).

Apps supportées (champ « app » du bloc JSON, préfixe du titre
d'issue) :

    mediatheque  titre, auteur·e·s, type (liste fermée), année, lien,
                 résumé → collection « Médiathèque » (MCKNJI9M) ;
    actualites   titre, type fermé (evenement|media_publie|outil_publie|
                 information|contact|projet|organisation|lieu|question|
                 idee — lot 5 : 10 types ; les 4 anciens types restent
                 acceptés comme alias legacy, normalisés avant écriture),
                 date_debut, date_fin, lieu, lien, description →
                 « Actualités » (U4HFDR68) — contrat valider.py/
                 fetch_actualites.py ; les 6 formes des autres apps sont
                 BI-COLLECTION (Actualités + collection de l'app source,
                 calque des constructeurs APPS, citationKey A000N) ;
    contacts     nom, organisation, lieu, email, telephone, role,
                 description, url → « Contacts » (JI7JP8AZ) — mapping
                 C2 (extra Email:/Telephone:/Role:, citationKey C000N) ;
    projets      titre, porteur, lieu, dates facultatives (sans date →
                 « En construction » côté front), description (requise),
                 url → « Projets » (RPZFWI9M) — mapping P3 (statut DÉDUIT
                 des dates si absent, citationKey P000N) ;
    organisations nom, lieu, email, telephone, description, url →
                 « Organisations » (9DZCCXQE) — mapping (extra
                 Email:/Telephone: renseignés + Source, citationKey
                 O000N) ;
    outiltheque  nom, categorie, lieu, description, url →
                 « Outilthèque » (3Z7QJHRU) — mapping (extra
                 Categorie:/Disponibilite: + Source, citationKey
                 U000N) ;
    lieux        nom, adresse, description, url → « Lieux »
                 (UMMXNXDJ) — mapping (extra Source, citationKey
                 L000N) ;
    questions    titre, question, description, url → « Questions »
                 (6IEE7MF2) — mapping (abstractNote=description,
                 extra « Question: … » + Source, citationKey Q000N) ;
    idees        titre, description, url → « Idées » (99X4HHIB) —
                 mapping (extra Source, citationKey I000N).

Usage (interface inchangée depuis la médiathèque) :
    python3 scripts/valider_contribution.py --liste        # propositions en attente (toutes apps)
    python3 scripts/valider_contribution.py 12            # valide l'issue n° 12
    python3 scripts/valider_contribution.py 12 15         # valide plusieurs issues
    python3 scripts/valider_contribution.py 12 --refuser "hors sujet"  # ferme sans ajout

Les issues sans champ « app » (anciennes contributions médiathèque)
restent traitées comme mediatheque — rétrocompatible.

Accès :
- GitHub : CLI `gh` (déjà authentifiée sur le VPS, compte Konsilion) ;
- Zotero : clé d'écriture du coffre ~/sys_admin/secrets/client/zotero.key (jamais affichée).

Aucune invention : les champs viennent tels quels du formulaire. Les
types/statuts fermés sont revalidés ; une valeur inconnue est refusée.
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
JSON_FENCE = "json-contribution"


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

    Le front (médiathèque comme socle commun contribution.js) pousse un
    bloc de données délimité :
        ```json-contribution
        {"app": …, champs propres à l'app…}
        ```
    Sans « app » (anciennes issues médiathèque) : app = mediatheque.
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
    data.setdefault("app", "mediatheque")
    return data


# ---------------------------------------------------------------- registre APPS
# Une app = une fiche : collection cible (nom + clé attendue, contrôle
# comme partout dans les scripts), champs obligatoires, mapping vers
# item Zotero (calques stricts des scripts ajouter_* / valider.py de
# chaque app), citationKey auto (scan max+1), libellés du --liste,
# remerciement de fermeture d'issue.

MEDIATHEQUE_NAME = "Médiathèque"
EXPECTED_MEDIATHEQUE_KEY = "MCKNJI9M"
# Collections cibles de la bi-collection actualités (contrat 3 formes,
# CEO 12/10/26) : un item média/outil créé via la grille Actualités est
# membre des DEUX collections — même fiche servie par les deux grilles.
# Lot 5 (10 types) : idem pour les 6 nouvelles formes, calque du
# précédent media_publie/outil_publie — l'item Actualités de type T est
# aussi membre de la collection de T.
OUTILTHEQUE_KEY = "3Z7QJHRU"
CONTACTS_COLLECTION_KEY = "JI7JP8AZ"
PROJETS_COLLECTION_KEY = "RPZFWI9M"
ORGANISATIONS_COLLECTION_KEY = "9DZCCXQE"
LIEUX_COLLECTION_KEY = "UMMXNXDJ"
QUESTIONS_COLLECTION_KEY = "6IEE7MF2"
IDEES_COLLECTION_KEY = "99X4HHIB"

# Types proposés par la modale médiathèque (liste fermée — cf.
# mediatheque/index.html <select>) et leur itemType Zotero (inverse
# de TYPE_FR_MAP de fetch_zotero.py pour les types réellement proposés).
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

# Types fermés de la modale Actualités (contrat fetch_actualites.py /
# valider.py — extra « Type: », CEO 12/10/26). Lot 5 : la modale propose
# désormais 10 types — les 4 historiques + les 6 formes des autres apps
# (contact, projet, organisation, lieu, question, idee), toutes
# itemType « document » (calque des constructeurs des apps sources).
ACTUALITES_TYPES = {
    "evenement": "presentation",
    "media_publie": "report",
    "outil_publie": "document",
    "information": "document",
    "contact": "document",
    "projet": "document",
    "organisation": "document",
    "lieu": "document",
    "question": "document",
    "idee": "document",
}

# Alias legacy des actualités : anciens types acceptés en entrée
# (issues GitHub déjà ouvertes) et NORMALISÉS vers le nouveau type
# avant toute écriture — l'item Zotero porte toujours le type nouveau.
ACTUALITES_TYPE_ALIASES = {
    "evenement_a_venir": "evenement",
    "evenement_passe": "evenement",
    "ressource_publiee": "media_publie",
    "information_parlement": "information",
}


def normalize_actualites_type(typ):
    """Type actualités brut → type du contrat (None si inconnu).

    Les 4 anciens types restent acceptés et sont renvoyés normalisés ;
    un type inconnu des deux mondes (nouveau + alias) retourne None.
    """
    if typ in ACTUALITES_TYPES:
        return typ
    return ACTUALITES_TYPE_ALIASES.get(typ)

# Statuts fermés de la modale Projets (mapping P3 — extra « Statut: »).
PROJETS_STATUTS = {"En cours", "À venir", "Terminé"}

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CITATION_RE = re.compile(r"^([ACPOULQI])(\d{4,})$")   # A/C/P/O/U/L/Q/I0001… (tolère > 9999)


def _s(v):
    """Valeur → chaîne trimée ('' si vide/absente)."""
    return str(v or "").strip()


def next_citation_key(items, prefix):
    """Prochain C000N/P000N : max des citationKeys de la collection + 1.

    (C0001 si vide — calque ajouter_contact.py/ajouter_projet.py.)
    """
    nums = []
    for it in items:
        m = CITATION_RE.match((it.get("data") or {}).get("citationKey") or "")
        if m and m.group(1) == prefix:
            nums.append(int(m.group(2)))
    return f"{prefix}{(max(nums) + 1) if nums else 1:04d}"


def build_creators(authors_str):
    """« Nom1, Nom2 » → liste creators Zotero (médiathèque).

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


def build_item_mediatheque(prop, collection_key, items):
    """proposition médiathèque → item Zotero (calque d'origine)."""
    itype = TYPE_TO_ITEMTYPE.get(prop["type"] or "")
    if not itype:
        raise ZoteroError(f"type inconnu « {prop['type']} » (liste fermée de la modale)")
    today = datetime.date.today().isoformat()
    item = {
        "itemType": itype,
        "title": prop["title"],
        "creators": build_creators(prop["authors"]),
        "collections": [collection_key],
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


def build_item_actualites(prop, collection_key, items):
    """proposition actualités → item Zotero (calque valider.py, mapping K3).

    Le type est NORMALISÉ (alias legacy acceptés) : c'est le type
    normalisé qui part dans « Type: » et qui choisit l'itemType.
    extra → « Type: <type normalisé> » + « Source: contribution » ;
    date → début seul ou « début/fin » (intervalle natif, OPTION B) ;
    citationKey A000N.

    Contrat 3 formes (CEO 12/10/26 « un seul et même enregistrement ») :
    - evenement / information : forme actualités (dates, lieu, lien) ;
    - media_publie : forme MÉDIATHÈQUE (authors, year, doc_type, url,
      abstract) — l'item porte l'itemType du doc_type et devient membre
      des DEUX collections (Actualités + Médiathèque) : la même fiche
      est servie par la grille Actualités (extra Type:) ET par la
      médiathèque (itemType + creators + year) ;
    - outil_publie : forme OUTILTHÈQUE (nom, categorie, lieu,
      description, url) — itemType document, extra Categorie:, membre
      des DEUX collections (Actualités + Outilthèque).

    Lot 5 — 6 nouvelles formes (CEO 12/10/26, calque EXACT du
    précédent media_publie/outil_publie) : contact, projet,
    organisation, lieu, question, idee. Chaque forme est le CALQUE du
    constructeur de son app source (mêmes champs, mêmes libellés extra
    anglais) avec DEUX différences : les collections (Actualités +
    collection de T) et la 1re ligne d'extra « Type: T » (lue par le
    fetch actualités comme type fermé). citationKey A000N : l'item
    vit dans la collection Actualités, c'est elle qui attribue la clé.
    """
    typ = normalize_actualites_type(prop["type"] or "")
    if not typ:
        raise ZoteroError(f"type inconnu « {prop['type']} » (liste fermée de la modale actualités)")
    today = datetime.date.today().isoformat()
    source_line = "Source: contribution actualités (issue GitHub)"

    # --- Forme média (calque build_item_mediatheque + bi-collection) ---
    if typ == "media_publie":
        itype = TYPE_TO_ITEMTYPE.get(prop.get("doc_type") or "")
        if not itype:
            raise ZoteroError(f"type de document inconnu « {prop.get('doc_type')} »")
        item = {
            "itemType": itype,
            "citationKey": next_citation_key(items, "A"),
            "title": prop["titre"],
            "creators": build_creators(prop.get("authors") or ""),
            "collections": [collection_key, EXPECTED_MEDIATHEQUE_KEY],
            "tags": [],
            "extra": f"Type: {typ}\n{source_line}",
            "dateAdded": f"{today}T00:00:00Z",
            "dateModified": f"{today}T00:00:00Z",
        }
        if prop.get("year"):
            item["date"] = prop["year"]
        if prop.get("url"):
            item["url"] = prop["url"]
        if prop.get("abstract"):
            item["abstractNote"] = prop["abstract"]
        return item

    # --- Forme outil (calque build_item_outiltheque + bi-collection) ---
    if typ == "outil_publie":
        extra_lines = [f"Type: {typ}"]
        if prop.get("categorie"):
            extra_lines.append(f"Categorie: {prop['categorie']}")
        extra_lines.append(source_line)
        return {
            "itemType": "document",
            "citationKey": next_citation_key(items, "A"),
            "title": prop["nom"],
            "abstractNote": prop.get("description") or "",
            "place": prop.get("lieu") or "",
            "url": prop.get("url") or "",
            "extra": "\n".join(extra_lines),
            "collections": [collection_key, OUTILTHEQUE_KEY],
            "tags": [],
            "dateAdded": f"{today}T00:00:00Z",
            "dateModified": f"{today}T00:00:00Z",
        }

    # --- Forme contact (calque build_item_contacts + bi-collection) ---
    if typ == "contact":
        extra_lines = [f"Type: {typ}"]
        if prop.get("email"):
            extra_lines.append(f"Email: {prop['email']}")
        if prop.get("telephone"):
            extra_lines.append(f"Telephone: {prop['telephone']}")
        if prop.get("role"):
            extra_lines.append(f"Role: {prop['role']}")
        extra_lines.append(source_line)
        return {
            "itemType": "document",
            "citationKey": next_citation_key(items, "A"),
            "title": prop["nom"],
            "abstractNote": prop.get("description") or "",
            "publisher": prop.get("organisation") or "",
            "place": prop.get("lieu") or "",
            "url": prop.get("url") or "",
            "extra": "\n".join(extra_lines),
            "collections": [collection_key, CONTACTS_COLLECTION_KEY],
            "tags": [],
            "dateAdded": f"{today}T00:00:00Z",
            "dateModified": f"{today}T00:00:00Z",
        }

    # --- Forme projet (calque build_item_projets + bi-collection) ---
    if typ == "projet":
        item = {
            "itemType": "document",
            "citationKey": next_citation_key(items, "A"),
            "title": prop["titre"],
            "abstractNote": prop.get("description") or "",
            "publisher": prop.get("porteur") or "",
            "place": prop.get("lieu") or "",
            "extra": f"Type: {typ}",
            "collections": [collection_key, PROJETS_COLLECTION_KEY],
            "tags": [],
            "dateAdded": f"{today}T00:00:00Z",
            "dateModified": f"{today}T00:00:00Z",
        }
        d1, d2 = prop.get("date_debut"), prop.get("date_fin")
        if d1 and d2:
            item["date"] = f"{d1}/{d2}"
        elif d1:
            item["date"] = d1
        if prop.get("url"):
            item["url"] = prop["url"]
        if prop.get("statut"):
            item["extra"] = f"Type: {typ}\nStatut: {prop['statut']}\n{source_line}"
        else:
            item["extra"] = f"Type: {typ}\n{source_line}"
        return item

    # --- Forme organisation (calque build_item_organisations +
    #     bi-collection) ---
    if typ == "organisation":
        extra_lines = [f"Type: {typ}"]
        if prop.get("email"):
            extra_lines.append(f"Email: {prop['email']}")
        if prop.get("telephone"):
            extra_lines.append(f"Telephone: {prop['telephone']}")
        extra_lines.append(source_line)
        return {
            "itemType": "document",
            "citationKey": next_citation_key(items, "A"),
            "title": prop["nom"],
            "abstractNote": prop.get("description") or "",
            "place": prop.get("lieu") or "",
            "url": prop.get("url") or "",
            "extra": "\n".join(extra_lines),
            "collections": [collection_key, ORGANISATIONS_COLLECTION_KEY],
            "tags": [],
            "dateAdded": f"{today}T00:00:00Z",
            "dateModified": f"{today}T00:00:00Z",
        }

    # --- Forme lieu (calque build_item_lieux + bi-collection) ---
    if typ == "lieu":
        return {
            "itemType": "document",
            "citationKey": next_citation_key(items, "A"),
            "title": prop["nom"],
            "abstractNote": prop.get("description") or "",
            "place": prop.get("adresse") or "",
            "url": prop.get("url") or "",
            "extra": f"Type: {typ}\n{source_line}",
            "collections": [collection_key, LIEUX_COLLECTION_KEY],
            "tags": [],
            "dateAdded": f"{today}T00:00:00Z",
            "dateModified": f"{today}T00:00:00Z",
        }

    # --- Forme question (calque build_item_questions + bi-collection) ---
    if typ == "question":
        extra_lines = [f"Type: {typ}"]
        extra_lines.append(f"Question: {prop['question']}")
        if prop.get("deposant"):
            extra_lines.append(f"Deposant: {prop['deposant']}")
        extra_lines.append(source_line)
        return {
            "itemType": "document",
            "citationKey": next_citation_key(items, "A"),
            "title": prop["titre"],
            "abstractNote": prop.get("description") or "",
            "url": prop.get("url") or "",
            "extra": "\n".join(extra_lines),
            "collections": [collection_key, QUESTIONS_COLLECTION_KEY],
            "tags": [],
            "dateAdded": f"{today}T00:00:00Z",
            "dateModified": f"{today}T00:00:00Z",
        }

    # --- Forme idée (calque build_item_idees + bi-collection) ---
    if typ == "idee":
        extra_lines = [f"Type: {typ}"]
        if prop.get("auteur"):
            extra_lines.append(f"Auteur: {prop['auteur']}")
        extra_lines.append(source_line)
        return {
            "itemType": "document",
            "citationKey": next_citation_key(items, "A"),
            "title": prop["titre"],
            "abstractNote": prop.get("description") or "",
            "url": prop.get("url") or "",
            "extra": "\n".join(extra_lines),
            "collections": [collection_key, IDEES_COLLECTION_KEY],
            "tags": [],
            "dateAdded": f"{today}T00:00:00Z",
            "dateModified": f"{today}T00:00:00Z",
        }

    # --- Forme actualités (evenement / information) : calque d'origine ---
    itype = ACTUALITES_TYPES.get(typ)
    if not itype:
        raise ZoteroError(f"type inconnu « {prop['type']} » (liste fermée de la modale actualités)")
    d1, d2 = prop["date_debut"], prop["date_fin"]
    if not d1:
        raise ZoteroError("date_debut vide")
    date = d1 if not d2 else f"{d1}/{d2}"
    return {
        "itemType": itype,
        "citationKey": next_citation_key(items, "A"),
        "title": prop["titre"],
        "abstractNote": prop["description"] or "",
        "date": date,
        "place": prop["lieu"] or "",
        "url": prop["lien"] or "",
        "extra": f"Type: {typ}\n{source_line}",
        "collections": [collection_key],
        "tags": [],
        "dateAdded": f"{today}T00:00:00Z",
        "dateModified": f"{today}T00:00:00Z",
    }


def build_item_contacts(prop, collection_key, items):
    """proposition contact → item Zotero (mapping C2, calque ajouter_contact.py).

    title=nom, abstractNote=description, publisher=organisation, place=lieu,
    url=lien, extra=lignes « Email: »/« Telephone: »/« Role: » (seulement les
    renseignées) + « Source: contribution » ; citationKey C000N. Pas de
    champ date posé (aucune invention : la date_contact reste au CEO).
    """
    extra_lines = []
    if prop["email"]:
        extra_lines.append(f"Email: {prop['email']}")
    if prop["telephone"]:
        extra_lines.append(f"Telephone: {prop['telephone']}")
    if prop["role"]:
        extra_lines.append(f"Role: {prop['role']}")
    extra_lines.append("Source: contribution contacts (issue GitHub)")
    today = datetime.date.today().isoformat()
    item = {
        "itemType": "document",
        "title": prop["nom"],
        "citationKey": next_citation_key(items, "C"),
        "collections": [collection_key],
        "tags": [],
        "abstractNote": prop["description"] or "",
        "publisher": prop["organisation"] or "",
        "place": prop["lieu"] or "",
        "url": prop["url"] or "",
        "extra": "\n".join(extra_lines),
        "dateAdded": f"{today}T00:00:00Z",
        "dateModified": f"{today}T00:00:00Z",
    }
    return item


def build_item_projets(prop, collection_key, items):
    """proposition projet → item Zotero (mapping P3, calque ajouter_projet.py).

    title=titre, abstractNote=description, publisher=porteur, place=lieu,
    date=« début/fin » si les deux (OPTION B) sinon début, url=lien,
    extra=ligne « Statut: … » (seulement si renseigné), citationKey P000N.
    """
    today = datetime.date.today().isoformat()
    item = {
        "itemType": "document",
        "title": prop["titre"],
        "citationKey": next_citation_key(items, "P"),
        "collections": [collection_key],
        "tags": [],
        "abstractNote": prop["description"] or "",
        "publisher": prop["porteur"] or "",
        "place": prop["lieu"] or "",
        "dateAdded": f"{today}T00:00:00Z",
        "dateModified": f"{today}T00:00:00Z",
    }
    d1, d2 = prop["date_debut"], prop["date_fin"]
    if d1 and d2:
        item["date"] = f"{d1}/{d2}"
    elif d1:
        item["date"] = d1
    if prop["url"]:
        item["url"] = prop["url"]
    if prop["statut"]:
        item["extra"] = f"Statut: {prop['statut']}"
    return item


def build_item_organisations(prop, collection_key, items):
    """proposition organisation → item Zotero (mapping contrats 5-9).

    title=nom, abstractNote=description, place=lieu, url=url,
    extra=lignes « Email: »/« Telephone: » (seulement les renseignées)
    + « Source: contribution organisations (issue GitHub) »,
    citationKey O000N. Aucun champ publisher (pas de champ
    organisation dans la modale).
    """
    extra_lines = []
    if prop["email"]:
        extra_lines.append(f"Email: {prop['email']}")
    if prop["telephone"]:
        extra_lines.append(f"Telephone: {prop['telephone']}")
    extra_lines.append("Source: contribution organisations (issue GitHub)")
    today = datetime.date.today().isoformat()
    return {
        "itemType": "document",
        "title": prop["nom"],
        "citationKey": next_citation_key(items, "O"),
        "collections": [collection_key],
        "tags": [],
        "abstractNote": prop["description"] or "",
        "place": prop["lieu"] or "",
        "url": prop["url"] or "",
        "extra": "\n".join(extra_lines),
        "dateAdded": f"{today}T00:00:00Z",
        "dateModified": f"{today}T00:00:00Z",
    }


def build_item_outiltheque(prop, collection_key, items):
    """proposition outil → item Zotero (mapping contrat Outilthèque).

    title=nom, abstractNote=description, place=lieu, url=url,
    extra=lignes « Categorie: »/« Disponibilite: » (seulement si
    renseignées — la modale ne propose pas de disponibilité, la ligne
    n'apparaît que si le champ existe) + « Source: contribution
    outilthèque (issue GitHub) », citationKey U000N.
    """
    extra_lines = []
    if prop.get("categorie"):
        extra_lines.append(f"Categorie: {prop['categorie']}")
    if prop.get("disponibilite"):
        extra_lines.append(f"Disponibilite: {prop['disponibilite']}")
    extra_lines.append("Source: contribution outilthèque (issue GitHub)")
    today = datetime.date.today().isoformat()
    return {
        "itemType": "document",
        "title": prop["nom"],
        "citationKey": next_citation_key(items, "U"),
        "collections": [collection_key],
        "tags": [],
        "abstractNote": prop["description"] or "",
        "place": prop["lieu"] or "",
        "url": prop["url"] or "",
        "extra": "\n".join(extra_lines),
        "dateAdded": f"{today}T00:00:00Z",
        "dateModified": f"{today}T00:00:00Z",
    }


def build_item_lieux(prop, collection_key, items):
    """proposition lieu → item Zotero (mapping contrat Lieux).

    title=nom, abstractNote=description, place=adresse, url=url,
    extra=« Source: contribution lieux (issue GitHub) »,
    citationKey L000N.
    """
    today = datetime.date.today().isoformat()
    return {
        "itemType": "document",
        "title": prop["nom"],
        "citationKey": next_citation_key(items, "L"),
        "collections": [collection_key],
        "tags": [],
        "abstractNote": prop["description"] or "",
        "place": prop["adresse"] or "",
        "url": prop["url"] or "",
        "extra": "Source: contribution lieux (issue GitHub)",
        "dateAdded": f"{today}T00:00:00Z",
        "dateModified": f"{today}T00:00:00Z",
    }


def build_item_questions(prop, collection_key, items):
    """proposition question → item Zotero (mapping contrat Questions).

    title=titre, abstractNote=description (la QUESTION vit dans extra,
    ligne « Question: … »), url=url, extra=« Question: … » +
    « Source: contribution questions (issue GitHub) »,
    citationKey Q000N.
    """
    today = datetime.date.today().isoformat()
    return {
        "itemType": "document",
        "title": prop["titre"],
        "citationKey": next_citation_key(items, "Q"),
        "collections": [collection_key],
        "tags": [],
        "abstractNote": prop["description"] or "",
        "url": prop["url"] or "",
        "extra": "\n".join(
            [
                f"Question: {prop['question']}",
                "Source: contribution questions (issue GitHub)",
            ]
        ),
        "dateAdded": f"{today}T00:00:00Z",
        "dateModified": f"{today}T00:00:00Z",
    }


def build_item_idees(prop, collection_key, items):
    """proposition idée → item Zotero (mapping contrat Idées).

    title=titre, abstractNote=description, url=url,
    extra=« Source: contribution idées (issue GitHub) »,
    citationKey I000N.
    """
    today = datetime.date.today().isoformat()
    return {
        "itemType": "document",
        "title": prop["titre"],
        "citationKey": next_citation_key(items, "I"),
        "collections": [collection_key],
        "tags": [],
        "abstractNote": prop["description"] or "",
        "url": prop["url"] or "",
        "extra": "Source: contribution idées (issue GitHub)",
        "dateAdded": f"{today}T00:00:00Z",
        "dateModified": f"{today}T00:00:00Z",
    }


def clean_mediatheque(data):
    def s(k):
        v = str(data.get(k) or "").strip()
        return v or None
    return {
        "title": s("title"), "authors": s("authors"), "type": s("type"),
        "year": s("year"), "url": s("url"), "abstract": s("abstract"),
    }


def clean_actualites(data):
    def s(k):
        v = str(data.get(k) or "").strip()
        return v or None
    # Contrat 3 formes + lot 5 (6 nouvelles formes) : les champs des
    # formes média/outil/contact/projet/organisation/lieu/question/idee
    # sont conservés (nettoyés, absents → None) et vivront côté build ;
    # les champs de la forme actualités restent inchangés
    # (rétrocompatibilité issues legacy et pipeline mail valider.py).
    return {
        "titre": s("titre"), "type": s("type"),
        "date_debut": s("date_debut"), "date_fin": s("date_fin"),
        "lieu": s("lieu"), "lien": s("lien"), "description": s("description"),
        # forme média (calque médiathèque)
        "authors": s("authors"), "year": s("year"), "doc_type": s("doc_type"),
        "url": s("url"), "abstract": s("abstract"),
        # forme outil (calque outilthèque)
        "nom": s("nom"), "categorie": s("categorie"),
        # forme contact (calque contacts)
        "organisation": s("organisation"), "email": s("email"),
        "telephone": s("telephone"), "role": s("role"),
        # forme projet (calque projets)
        "porteur": s("porteur"), "statut": s("statut"),
        # forme lieu (calque lieux)
        "adresse": s("adresse"),
        # forme question (calque questions)
        "question": s("question"), "deposant": s("deposant"),
        # forme idée (calque idées)
        "auteur": s("auteur"),
    }


def clean_contacts(data):
    def s(k):
        v = str(data.get(k) or "").strip()
        return v or None
    return {
        "nom": s("nom"), "organisation": s("organisation"), "lieu": s("lieu"),
        "email": s("email"), "telephone": s("telephone"), "role": s("role"),
        "description": s("description"), "url": s("url"),
    }


def clean_projets(data):
    def s(k):
        v = str(data.get(k) or "").strip()
        return v or None
    return {
        "titre": s("titre"), "porteur": s("porteur"), "lieu": s("lieu"),
        "date_debut": s("date_debut"), "date_fin": s("date_fin"),
        "statut": s("statut"), "description": s("description"), "url": s("url"),
    }


def clean_organisations(data):
    def s(k):
        v = str(data.get(k) or "").strip()
        return v or None
    return {
        "nom": s("nom"), "lieu": s("lieu"), "email": s("email"),
        "telephone": s("telephone"), "description": s("description"),
        "url": s("url"),
    }


def clean_outiltheque(data):
    def s(k):
        v = str(data.get(k) or "").strip()
        return v or None
    return {
        "nom": s("nom"), "categorie": s("categorie"), "lieu": s("lieu"),
        "description": s("description"), "url": s("url"),
    }


def clean_lieux(data):
    def s(k):
        v = str(data.get(k) or "").strip()
        return v or None
    return {
        "nom": s("nom"), "adresse": s("adresse"),
        "description": s("description"), "url": s("url"),
    }


def clean_questions(data):
    def s(k):
        v = str(data.get(k) or "").strip()
        return v or None
    return {
        "titre": s("titre"), "question": s("question"),
        "description": s("description"), "url": s("url"),
    }


def clean_idees(data):
    def s(k):
        v = str(data.get(k) or "").strip()
        return v or None
    return {
        "titre": s("titre"), "description": s("description"), "url": s("url"),
    }


# Fiche par app : collection cible, nettoyage, champs obligatoires,
# constructeur d'item, aperçu --liste [(clé, valeur)], remerciement.
APPS = {
    "mediatheque": {
        "collection": (MEDIATHEQUE_NAME, EXPECTED_MEDIATHEQUE_KEY),
        "clean": clean_mediatheque,
        "required": ("title", "url"),
        "checks": ("check_mediatheque",),
        "build": build_item_mediatheque,
        "list_fields": (
            ("titre", "title"), ("auteur·e·s", "authors"), ("type", "type"),
            ("année", "year"), ("lien", "url"), ("résumé", "abstract"),
        ),
        "phrase": "Le document",
        "pronom": "Il",
        "publie": "la médiathèque",
    },
    "actualites": {
        "collection": ("Actualités", "U4HFDR68"),
        "clean": clean_actualites,
        # Champs obligatoires PAR FORME (contrat 3 formes, CEO 12/10/26)
        # : une fonction résout la liste selon le type — le registre
        # ne peut plus porter un tuple figé unique.
        "required": None,           # remplacé par required_fn ci-dessous
        "required_fn": lambda prop: (
            ("titre", "type", "doc_type", "url") if normalize_actualites_type(prop.get("type") or "") == "media_publie"
            else ("nom", "type") if normalize_actualites_type(prop.get("type") or "") == "outil_publie"
            else ("nom", "type") if normalize_actualites_type(prop.get("type") or "") == "contact"
            else ("titre", "type", "description") if normalize_actualites_type(prop.get("type") or "") == "projet"
            else ("nom", "type") if normalize_actualites_type(prop.get("type") or "") == "organisation"
            else ("nom", "type") if normalize_actualites_type(prop.get("type") or "") == "lieu"
            else ("titre", "type", "question") if normalize_actualites_type(prop.get("type") or "") == "question"
            else ("titre", "type") if normalize_actualites_type(prop.get("type") or "") == "idee"
            else ("titre", "type", "date_debut", "lien")
        ),
        "checks": ("check_actualites",),
        "build": build_item_actualites,
        # Aperçu --liste PAR FORME (mêmes champs que la table d'issue).
        "list_fields": None,        # remplacé par list_fields_fn ci-dessous
        "list_fields_fn": lambda prop: (
            [("titre", "titre"), ("type", "type"), ("auteur·e·s", "authors"),
             ("doc", "doc_type"), ("année", "year"), ("lien", "url"),
             ("résumé", "abstract")]
            if normalize_actualites_type(prop.get("type") or "") == "media_publie"
            else [("titre", "nom"), ("type", "type"), ("catégorie", "categorie"),
                  ("lieu", "lieu"), ("lien", "url"), ("résumé", "description")]
            if normalize_actualites_type(prop.get("type") or "") == "outil_publie"
            else [("titre", "nom"), ("type", "type"), ("organisation", "organisation"),
                  ("lieu", "lieu"), ("e-mail", "email"), ("téléphone", "telephone"),
                  ("rôle", "role"), ("description", "description"), ("lien", "url")]
            if normalize_actualites_type(prop.get("type") or "") == "contact"
            else [("titre", "titre"), ("type", "type"), ("porteur", "porteur"),
                  ("lieu", "lieu"), ("dates", "dates"), ("statut", "statut"),
                  ("description", "description"), ("lien", "url")]
            if normalize_actualites_type(prop.get("type") or "") == "projet"
            else [("titre", "nom"), ("type", "type"), ("lieu", "lieu"),
                  ("e-mail", "email"), ("téléphone", "telephone"),
                  ("description", "description"), ("lien", "url")]
            if normalize_actualites_type(prop.get("type") or "") == "organisation"
            else [("titre", "nom"), ("type", "type"), ("adresse", "adresse"),
                  ("description", "description"), ("lien", "url")]
            if normalize_actualites_type(prop.get("type") or "") == "lieu"
            else [("titre", "titre"), ("type", "type"), ("question", "question"),
                  ("deposant", "deposant"), ("description", "description"), ("lien", "url")]
            if normalize_actualites_type(prop.get("type") or "") == "question"
            else [("titre", "titre"), ("type", "type"), ("auteur", "auteur"),
                  ("description", "description"), ("lien", "url")]
            if normalize_actualites_type(prop.get("type") or "") == "idee"
            else [("titre", "titre"), ("type", "type"),
                  ("dates", "dates"), ("lieu", "lieu"), ("lien", "lien"),
                  ("résumé", "description")]
        ),
        "phrase": "L'actualité",
        "pronom": "Elle",
        "publie": "la grille Actualités (et la médiathèque pour les médias, l'outilthèque pour les outils)",
    },
    "contacts": {
        "collection": ("Contacts", "JI7JP8AZ"),
        "clean": clean_contacts,
        "required": ("nom",),
        "checks": ("check_contacts",),
        "build": build_item_contacts,
        "list_fields": (
            ("nom", "nom"), ("organisation", "organisation"),
            ("lieu", "lieu"), ("e-mail", "email"), ("téléphone", "telephone"),
            ("rôle", "role"), ("description", "description"), ("lien", "url"),
        ),
        "phrase": "Le contact",
        "pronom": "Il",
        "publie": "le répertoire Contacts",
    },
    "projets": {
        "collection": ("Projets", "RPZFWI9M"),
        "clean": clean_projets,
        "required": ("titre", "porteur", "description"),
        "checks": ("check_projets",),
        "build": build_item_projets,
        "list_fields": (
            ("titre", "titre"), ("porteur", "porteur"), ("lieu", "lieu"),
            ("dates", "dates"), ("statut", "statut"),
            ("description", "description"), ("lien", "url"),
        ),
        "phrase": "Le projet",
        "pronom": "Il",
        "publie": "la grille Projets",
    },
    "organisations": {
        "collection": ("Organisations", "9DZCCXQE"),
        "clean": clean_organisations,
        "required": ("nom",),
        "checks": ("check_organisations",),
        "build": build_item_organisations,
        "list_fields": (
            ("nom", "nom"), ("lieu", "lieu"), ("e-mail", "email"),
            ("téléphone", "telephone"), ("description", "description"),
            ("lien", "url"),
        ),
        "phrase": "L'organisation",
        "pronom": "Elle",
        "publie": "la grille Organisations",
    },
    "outiltheque": {
        "collection": ("Outilthèque", "3Z7QJHRU"),
        "clean": clean_outiltheque,
        "required": ("nom",),
        "checks": ("check_outiltheque",),
        "build": build_item_outiltheque,
        "list_fields": (
            ("nom", "nom"), ("categorie", "categorie"), ("lieu", "lieu"),
            ("description", "description"), ("lien", "url"),
        ),
        "phrase": "L'outil",
        "pronom": "Il",
        "publie": "la grille Outilthèque",
    },
    "lieux": {
        "collection": ("Lieux", "UMMXNXDJ"),
        "clean": clean_lieux,
        "required": ("nom",),
        "checks": ("check_lieux",),
        "build": build_item_lieux,
        "list_fields": (
            ("nom", "nom"), ("adresse", "adresse"),
            ("description", "description"), ("lien", "url"),
        ),
        "phrase": "Le lieu",
        "pronom": "Il",
        "publie": "la grille Lieux",
    },
    "questions": {
        "collection": ("Questions", "6IEE7MF2"),
        "clean": clean_questions,
        "required": ("titre",),
        "checks": ("check_questions",),
        "build": build_item_questions,
        "list_fields": (
            ("titre", "titre"), ("question", "question"),
            ("description", "description"), ("lien", "url"),
        ),
        "phrase": "La question",
        "pronom": "Elle",
        "publie": "la grille Questions",
    },
    "idees": {
        "collection": ("Idées", "99X4HHIB"),
        "clean": clean_idees,
        "required": ("titre",),
        "checks": ("check_idees",),
        "build": build_item_idees,
        "list_fields": (
            ("titre", "titre"), ("description", "description"), ("lien", "url"),
        ),
        "phrase": "L'idée",
        "pronom": "Elle",
        "publie": "la grille Idées",
    },
}


# ---------------------------------------------------------------- contrôles

def check_mediatheque(prop):
    """Type fermé + année 4 chiffres. Retourne motif de refus ou None."""
    if not TYPE_TO_ITEMTYPE.get(prop["type"] or ""):
        return f"type inconnu « {prop['type']} »"
    if prop["year"] and not re.fullmatch(r"\d{4}", prop["year"]):
        return f"année invalide « {prop['year']} »"
    return None


def check_actualites(prop):
    """Type fermé (alias legacy acceptés) + garde-fous PAR FORME
    (contrat 3 formes, CEO 12/10/26 + lot 5 : 6 nouvelles formes).

    - evenement/information : dates AAAA-MM-JJ + fin ≥ début + lien ;
    - media_publie : doc_type fermé médiathèque + année 4 chiffres +
      url http/s ;
    - outil_publie : nom ≥ 3 + url http/s facultative ;
    - contact : calque check_contacts (email/téléphone/url si fournis) ;
    - projet : calque check_projets (dates facultatives AAAA-MM-JJ,
      fin ≥ début, statut fermé, url http/s) ;
    - organisation : calque check_organisations (email/téléphone/url) ;
    - lieu/question/idee : url http/s facultative (calque des checks
      sources — aucun autre champ exigé).
    Les 6 nouvelles formes n'exigent RIEN de plus que leur required.
    Retourne motif de refus ou None.
    """
    typ = normalize_actualites_type(prop["type"] or "")
    if not typ:
        return f"type inconnu « {prop['type']} »"

    if typ == "media_publie":
        if not TYPE_TO_ITEMTYPE.get(prop.get("doc_type") or ""):
            return f"type de document inconnu « {prop.get('doc_type')} »"
        if prop.get("year") and not re.fullmatch(r"\d{4}", prop["year"]):
            return f"année invalide « {prop['year']} »"
        if prop.get("url") and not re.match(r"^https?://", prop["url"]):
            return "lien invalide (http/https attendu)"
        return None

    if typ == "outil_publie":
        if not prop.get("nom") or len(prop["nom"]) < 3:
            return "nom trop court"
        if prop.get("url") and not re.match(r"^https?://", prop["url"]):
            return "lien invalide (http/https attendu)"
        return None

    # --- lot 5 : calques des checks des apps sources (champs tous
    #     facultatifs — la modération reste permissive) ---
    if typ == "contact":
        return check_contacts(prop)

    if typ == "projet":
        return check_projets(prop)

    if typ == "organisation":
        return check_organisations(prop)

    if typ == "lieu":
        return check_lieux(prop)

    if typ == "question":
        return check_questions(prop)

    if typ == "idee":
        return check_idees(prop)

    # evenement / information (forme actualités, inchangée)
    if not DATE_RE.match(prop["date_debut"] or ""):
        return f"date_debut invalide « {prop['date_debut']} »"
    if prop["date_fin"] and not DATE_RE.match(prop["date_fin"]):
        return f"date_fin invalide « {prop['date_fin']} »"
    if prop["date_fin"] and prop["date_fin"] < prop["date_debut"]:
        return "date_fin antérieure à date_debut"
    if prop["lien"] and not re.match(r"^https?://", prop["lien"]):
        return "lien invalide (http/https attendu)"
    return None


def check_contacts(prop):
    """Email/téléphone simples, aucun champ obligation hors nom. Retourne motif ou None."""
    if prop["email"] and not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", prop["email"]):
        return f"e-mail invalide « {prop['email']} »"
    if prop["telephone"] and len(re.sub(r"[^\d+]", "", prop["telephone"])) < 6:
        return "téléphone invalide"
    if prop["url"] and not re.match(r"^https?://", prop["url"]):
        return "lien invalide (http/https attendu)"
    return None


def check_projets(prop):
    """Dates facultatives AAAA-MM-JJ + fin ≥ début + statut fermé
    (compat anciennes issues) + url http/s. Retourne motif ou None."""
    if prop["date_debut"] and not DATE_RE.match(prop["date_debut"]):
        return f"date_debut invalide « {prop['date_debut']} »"
    if prop["date_fin"] and not DATE_RE.match(prop["date_fin"]):
        return f"date_fin invalide « {prop['date_fin']} »"
    if (prop["date_debut"] and prop["date_fin"]
            and prop["date_fin"] < prop["date_debut"]):
        return "date_fin antérieure à date_debut"
    if prop["statut"] and prop["statut"] not in PROJETS_STATUTS:
        return f"statut inconnu « {prop['statut']} »"
    if prop["url"] and not re.match(r"^https?://", prop["url"]):
        return "lien invalide (http/https attendu)"
    return None


def check_organisations(prop):
    """Email/téléphone simples + url http/s. Retourne motif ou None.

    Calque check_contacts (mêmes règles) : email regex, téléphone
    ≥ 6 chiffres, url http/s — aucun champ obligatoire hors nom.
    """
    if prop["email"] and not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", prop["email"]):
        return f"e-mail invalide « {prop['email']} »"
    if prop["telephone"] and len(re.sub(r"[^\d+]", "", prop["telephone"])) < 6:
        return "téléphone invalide"
    if prop["url"] and not re.match(r"^https?://", prop["url"]):
        return "lien invalide (http/https attendu)"
    return None


def check_outiltheque(prop):
    """Url http/s. Retourne motif ou None."""
    if prop["url"] and not re.match(r"^https?://", prop["url"]):
        return "lien invalide (http/https attendu)"
    return None


def check_lieux(prop):
    """Url http/s. Retourne motif ou None."""
    if prop["url"] and not re.match(r"^https?://", prop["url"]):
        return "lien invalide (http/https attendu)"
    return None


def check_questions(prop):
    """Url http/s. Retourne motif ou None."""
    if prop["url"] and not re.match(r"^https?://", prop["url"]):
        return "lien invalide (http/https attendu)"
    return None


def check_idees(prop):
    """Url http/s. Retourne motif ou None."""
    if prop["url"] and not re.match(r"^https?://", prop["url"]):
        return "lien invalide (http/https attendu)"
    return None


CHECKS = {
    "check_mediatheque": check_mediatheque,
    "check_actualites": check_actualites,
    "check_contacts": check_contacts,
    "check_projets": check_projets,
    "check_organisations": check_organisations,
    "check_outiltheque": check_outiltheque,
    "check_lieux": check_lieux,
    "check_questions": check_questions,
    "check_idees": check_idees,
}


# ---------------------------------------------------------------- --liste

def list_value(prop, key):
    """Valeur d'affichage --liste (champ direct ou « dates » combiné)."""
    if key == "dates":
        d1 = prop.get("date_debut") or "—"
        d2 = prop.get("date_fin")
        return d1 if not d2 else f"{d1} → {d2}"
    v = prop.get(key)
    return v if v else "—"


def do_list():
    issues = list_open_contributions()
    if not issues:
        print(f"Aucune proposition en attente (issues ouvertes étiquetée « {LABEL} »).")
        return 0
    print(f"{len(issues)} proposition(s) en attente :")
    for i in issues:
        raw = parse_contribution(i["body"]) or {}
        app = raw.get("app", "mediatheque")
        fiche = APPS.get(app)
        prop = fiche["clean"](raw) if fiche else {}
        print(f"\n  n°{i['number']}  {i['title']}")
        print(f"     auteur issue : {i['author']['login']}  ({i['url']})")
        if not fiche:
            print(f"     ⚠️ app inconnue « {app} » — traiter à la main")
            continue
        print(f"     app          : {app}  →  collection « {fiche['collection'][0]} »")
        req_list = fiche.get("required_fn") or fiche["required"]
        if callable(req_list):
            req_list = req_list(prop)
        if prop.get(req_list[0]):
            list_fields = fiche.get("list_fields_fn") or fiche["list_fields"]
            if callable(list_fields):
                list_fields = list_fields(prop)
            for label, key in list_fields:
                val = list_value(prop, key)
                if len(str(val)) > 120:
                    val = str(val)[:120] + "…"
                print(f"     {label:<12} : {val}")
        else:
            print("     ⚠️ corps illisible : issue hors parcours modale → traiter à la main")
    return 0


# ---------------------------------------------------------------- validation

def close_issue_thanks(number, cite_title, fiche):
    """Ferme l'issue avec un commentaire de remerciement public."""
    comment = (
        "Merci pour cette proposition ! 📚\n\n"
        f"{fiche['phrase']} « {cite_title} » a été vérifié·e et ajouté·e à la bibliothèque Zotero. "
        f"{fiche['pronom']} apparaîtra sur {fiche['publie']} du Parlement de la rivière Isère lors du "
        "prochain déploiement (généralement sous une heure).\n\n"
        "— L'équipe du Parlement de la rivière Isère"
    )
    gh("issue", "close", str(number), "--comment", comment)


def close_issue_refused(number, reason):
    """Ferme l'issue refusée avec motif."""
    comment = (
        "Merci pour cette proposition.\n\n"
        "Après examen, l'équipe ne retient pas cette contribution :\n\n"
        f"> {reason}\n\n"
        "Les propositions d'ajouts restent les bienvenues !\n\n"
        "— L'équipe du Parlement de la rivière Isère"
    )
    gh("issue", "close", str(number), "--comment", comment)


def collection_items(client, fiche):
    """Clé de collection (contrôle de cohérence) + items top (périmètre app)."""
    name, expected = fiche["collection"]
    ckey = client.find_collection(name)
    if ckey != expected:
        raise ZoteroError(
            f"collection « {name} » trouvée sous la clé {ckey}, "
            f"{expected} attendue"
        )
    return ckey, client.collection_items_top(ckey)


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

    # Périmètre par app (collection + items, chargé UNE fois par app
    # réellement présente dans les numéros à valider).
    raws = {}
    scopes = {}
    for n in numbers:
        raw = parse_contribution(issues[n]["body"]) or {}
        raws[n] = raw
        app = raw.get("app", "mediatheque")
        if app in APPS and app not in scopes:
            ckey, items = collection_items(client, APPS[app])
            titles = {
                ((it.get("data") or {}).get("title") or "").strip()
                for it in items
            }
            scopes[app] = (ckey, items, titles)
            print(f"[OK] collection « {APPS[app]['collection'][0]} » ({ckey}) : "
                  f"{len(items)} items top")

    validated, rejected = [], []
    for n in numbers:
        raw = raws[n]
        app = raw.get("app", "mediatheque")
        fiche = APPS.get(app)
        if not fiche:
            rejected.append((n, f"app inconnue « {app} » — traiter à la main"))
            continue
        ckey, items, titles = scopes[app]
        prop = fiche["clean"](raw)

        # champs obligatoires (statique, ou résolus par forme)
        req = fiche.get("required_fn") or fiche["required"]
        if callable(req):
            req = req(prop)
        manque = [k for k in req if not prop.get(k)]
        if manque:
            rejected.append((n, f"issue malformée ({'/'.join(manque)} manquant) — traiter à la main"))
            continue
        # contrôles fermés (types/statuts/dates)
        motif = CHECKS[fiche["checks"][0]](prop)
        if motif:
            rejected.append((n, motif))
            continue
        # anti-doublon par titre exact dans la collection cible
        titre = prop.get("title") or prop.get("nom") or prop.get("titre")
        if titre in titles:
            rejected.append((n, f"titre déjà présent : « {titre} »"))
            continue

        item = fiche["build"](prop, ckey, items)
        successful, failed = client.post_items([item])
        if failed:
            rejected.append((n, f"échec POST Zotero : {failed}"))
            continue
        if not successful:
            rejected.append((n, "POST Zotero : réponse inattendue (aucun item créé)"))
            continue
        # Médiathèque : pas de citationKey posé → l'unique item de la
        # réponse est le nôtre. Autres apps : citationKey A/C/P000N porté
        # par l'item → présent dans successful.
        ck = item.get("citationKey")
        if ck:
            if ck not in successful:
                rejected.append((n, f"POST : {ck} absent de la réponse successful"))
                continue
            zkey = successful[ck]
        else:
            zkey = next(iter(successful.values()))
        if not zkey:
            rejected.append((n, "POST Zotero : réponse inattendue (aucune clé d'item)"))
            continue
        # re-fetch de contrôle (calque ajouter_projet.py) : l'item doit
        # être dans la collection cible après création.
        try:
            items_after = client.collection_items_top(ckey)
        except ZoteroError as e:
            rejected.append((n, f"re-fetch de contrôle impossible : {e}"))
            continue
        if not any(it.get("key") == zkey for it in items_after):
            rejected.append((n, f"vérification : item {zkey} introuvable dans la collection après création"))
            continue
        titles.add(titre)

        cite = item.get("citationKey") or zkey
        close_issue_thanks(n, titre, fiche)
        validated.append((n, zkey, titre))
        if cite != zkey:
            print(f"[VALIDÉ] issue n°{n} [{app}] → item Zotero {zkey} "
                  f"(citationKey {cite}, « {titre} »), issue fermée")
        else:
            print(f"[VALIDÉ] issue n°{n} [{app}] → item Zotero {zkey} "
                  f"(« {titre} »), issue fermée")

    if rejected:
        print("")
        for n, msg in rejected:
            print(f"[REFUSÉ] issue n°{n} : {msg}")

    if validated:
        print("")
        print("Prochaine étape : publier —")
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
