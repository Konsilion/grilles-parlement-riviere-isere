# Template de configuration.
# Copie ce fichier en `config.py` (même dossier) et remplis les 3 valeurs.
# `config.py` est dans .gitignore : ne JAMAIS le commiter.

ZOTERO_USER_ID = ""           # ton user ID numérique (zotero.org/settings)
ZOTERO_API_KEY = ""           # une API key avec accès lecture
ZOTERO_COLLECTION_ID = ""     # l'ID de la collection à afficher (chiffre)
# Clés des collections à EXCLURE du fetch médiathèque (filtre anti-fuite).
# Valeurs attendues : ["U4HFDR68", "JI7JP8AZ"] (Actualités, Contacts).
# L'ancienne forme scalaire ZOTERO_EXCLUDE_COLLECTION reste acceptée
# pendant la transition ; la liste est la forme de référence.
ZOTERO_EXCLUDE_COLLECTIONS = []
