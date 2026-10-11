#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""zotero_api.py — module commun d'accès à l'API Zotero (stdlib, urllib).

Utilisé par fetch_actualites.py et valider.py (carte K4).

Clé API (jamais affichée ni loguée) :
- mode "write" : coffre ~/sys_admin/secrets/client/zotero.key — obligatoire ;
- mode "read"  : coffre si présent, sinon ZOTERO_API_KEY du config.py
                 de la vitrine (~/github/zotero-vitrine/scripts/config.py).

PIÈGE prouvé en K3 : un POST batch renvoie HTTP 200 MÊME SI des items
échouent — post_items() parse donc toujours successful/failed/unchanged et
retourne les deux, le caller décide.

Autres pièges couverts :
- PATCH et DELETE exigent le header If-Unmodified-Since-Version ;
- la clé du coffre suit l'ancien schéma access.groups.all.write (pas de clé
  par groupe) : check_write_access() accepte les deux schémas ;
- items/top d'une collection ne remonte PAS les sous-collections (aucune
  sous-collection dans « Actualités », prouvé K1/K3).
"""

import json
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

API_BASE = "https://api.zotero.org"
API_VERSION = "3"
DEFAULT_GROUP_ID = "6610185"
DEFAULT_TIMEOUT = 90

WRITE_KEY_PATH = Path.home() / "sys_admin" / "secrets" / "client" / "zotero.key"
VITRINE_CONFIG = Path.home() / "github" / "zotero-vitrine" / "scripts" / "config.py"


class ZoteroError(Exception):
    """Erreur API Zotero (message affichable — jamais la clé)."""


# ---------------------------------------------------------------- Clé API

def load_key(mode="write"):
    """Charge la clé API sans jamais l'afficher.

    mode="write" : coffre ~/sys_admin/secrets/client/zotero.key — requis, échec sinon.
    mode="read"  : coffre si présent, sinon config.py de la vitrine.
    """
    if WRITE_KEY_PATH.exists():
        key = WRITE_KEY_PATH.read_text(encoding="utf-8").strip()
        if key:
            return key
        raise ZoteroError(f"coffre présent mais vide : {WRITE_KEY_PATH}")
    if mode == "read" and VITRINE_CONFIG.exists():
        for line in VITRINE_CONFIG.read_text(encoding="utf-8").splitlines():
            s = line.strip()
            if s.startswith("ZOTERO_API_KEY") and "=" in s:
                key = s.split("=", 1)[1].strip().strip("\"'")
                if key:
                    return key
        raise ZoteroError(f"ZOTERO_API_KEY introuvable dans {VITRINE_CONFIG}")
    raise ZoteroError(
        f"clé absente : {WRITE_KEY_PATH}"
        + (f" (et {VITRINE_CONFIG} illisible)" if mode == "read" else "")
    )


def strip_accents(s):
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c)
    ).lower()


# ---------------------------------------------------------------- Client

class ZoteroClient:
    def __init__(self, key, group_id=DEFAULT_GROUP_ID):
        self.key = key
        self.group_id = str(group_id)

    # --- bas niveau

    def request(self, method, path, payload=None, headers=None, allow_404=False):
        """Un appel API. Retourne (status, corps JSON ou None).

        path commence par « / ». Lève ZoteroError sur erreur HTTP (sauf 404
        si allow_404), corps vide inattendu, ou erreur réseau.
        """
        url = f"{API_BASE}{path}"
        all_headers = {
            "Zotero-API-Key": self.key,
            "Zotero-API-Version": API_VERSION,
        }
        data = None
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            all_headers["Content-Type"] = "application/json"
        if headers:
            all_headers.update(headers)
        req = urllib.request.Request(url, data=data, headers=all_headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=DEFAULT_TIMEOUT) as resp:
                body = resp.read().decode("utf-8")
                return resp.status, (json.loads(body) if body else None)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:800]
            if e.code == 404 and allow_404:
                return 404, None
            raise ZoteroError(f"HTTP {e.code} sur {method} {path}\n{detail}")
        except urllib.error.URLError as e:
            raise ZoteroError(f"réseau : {method} {path} : {e.reason}")

    def get(self, path, allow_404=False):
        return self.request("GET", path, allow_404=allow_404)

    def get_all(self, path, limit=100):
        """GET paginé — path SANS query string ; retourne la liste complète."""
        out, start = [], 0
        while True:
            sep = "&" if "?" in path else "?"
            _, page = self.get(f"{path}{sep}limit={limit}&start={start}")
            if not page:
                break
            out.extend(page)
            if len(page) < limit:
                break
            start += limit
        return out

    # --- écriture

    def post_items(self, items):
        """POST batch /groups/<gid>/items.

        Retourne (successful, failed) :
        - successful : {citationKey: clé d'item Zotero}
        - failed      : {index: message d'erreur Zotero}

        PIÈGE : HTTP 200 même en cas d'échec partiel — on ne se fie JAMAIS au
        seul statut, on parse toujours le corps.
        """
        if not items:
            return {}, {}
        status, resp = self.request(
            "POST", f"/groups/{self.group_id}/items", payload=items
        )
        if status != 200 or resp is None:
            raise ZoteroError(f"POST renvoie {status}")
        successful, failed = resp.get("successful") or {}, resp.get("failed") or {}
        unchanged = resp.get("unchanged") or {}
        if unchanged:
            raise ZoteroError(f"POST : {len(unchanged)} items unchanged : {unchanged}")
        out = {}
        for _, obj in successful.items():
            ck = (obj.get("data") or {}).get("citationKey")
            out[ck] = obj.get("key")
        return out, failed

    def patch_item(self, item_key, version, data):
        """PATCH un item avec If-Unmodified-Since-Version (obligatoire)."""
        status, resp = self.request(
            "PATCH",
            f"/groups/{self.group_id}/items/{item_key}",
            payload=data,
            headers={"If-Unmodified-Since-Version": str(version)},
        )
        if status != 204:
            raise ZoteroError(f"PATCH {item_key} renvoie {status}")
        return resp

    def delete_item(self, item_key, version):
        """DELETE un item (header de version obligatoire). Status attendu 204."""
        status, _ = self.request(
            "DELETE",
            f"/groups/{self.group_id}/items/{item_key}",
            headers={"If-Unmodified-Since-Version": str(version)},
        )
        if status != 204:
            raise ZoteroError(f"DELETE {item_key} renvoie {status} (204 attendu)")
        return status

    # --- collections & items

    def find_collection(self, name):
        """Retrouve la clé d'une collection du groupe par son nom
        (comparaison exacte puis accents/casse insensible)."""
        cols = self.get_all(f"/groups/{self.group_id}/collections", limit=50)
        wanted = strip_accents(name)
        for c in cols:
            cname = (c.get("data") or {}).get("name", "")
            if cname == name or strip_accents(cname) == wanted:
                return c["key"]
        raise ZoteroError(
            f"collection « {name} » introuvable ({len(cols)} collections scannées)"
        )

    def collection_items_top(self, collection_key):
        """items/top d'une collection — ne remonte PAS les sous-collections."""
        return self.get_all(
            f"/groups/{self.group_id}/collections/{collection_key}/items/top"
        )

    def collection_citation_keys(self, collection_key):
        """Ensemble des citationKeys des items top d'une collection."""
        keys = set()
        for it in self.collection_items_top(collection_key):
            ck = (it.get("data") or {}).get("citationKey")
            if ck:
                keys.add(ck)
        return keys

    # --- identité & droits

    def key_info(self):
        _, info = self.get("/keys/current")
        if not isinstance(info, dict):
            raise ZoteroError("/keys/current : réponse inattendue (dict attendu)")
        return info

    def check_write_access(self):
        """Prouve l'identité de la clé et son droit write sur le groupe.

        Deux schémas possibles (piège K3) :
        - nouveau : access.groups.<id>.write = true
        - ancien  : access.groups.all.write = true (clé du coffre).
        """
        info = self.key_info()
        access = info.get("access") or {}
        groups = access.get("groups") or {}
        g = groups.get(self.group_id)
        if isinstance(g, bool):
            g_write = g
        else:
            g_write = bool((g or {}).get("write")) or bool(
                (groups.get("all") or {}).get("write")
            )
        if not g_write:
            raise ZoteroError(
                f"la clé n'a pas le droit write sur le groupe {self.group_id}"
            )
        return info
