/* =========================================================
   Grilles de carte — recherche floue commune (K5)
   Insensible casse/accents + tolérance aux petites fautes
   (« ~95 % de correspondance », calibrage vitrine 10/10/26).
   Deux étapes :
     1. sous-chaîne sur le texte NORMALISÉ (casse, accents,
        œ, ’) — une requête multi-mots adjacents reste une
        sous-chaîne ;
     2. mode flou par mot : chaque mot significatif (≥ 2 car.)
        de la requête doit se trouver dans la fiche, exact ou
        à ~1-2 fautes près (Damerau-Levenshtein borné).
   Calibrage : 95 % STRICT n'autoriserait aucune faute sur un
   mot de moins de 20 lettres (1 lettre sur 8 = 12 % d'écart) —
   budget retenu : 0 faute ≤ 5 car., 1 faute 6-12, 2 fautes
   13-20, floor(n/10) au-delà (≥ ~85 % par mot).
   ========================================================= */
window.GrilleSearch = (() => {
  "use strict";

  const FOLD_MAP = { "œ": "oe", "æ": "ae", "Œ": "oe", "Æ": "ae", "’": "'", "‘": "'" };

  const searchNormalize = (s) =>
    String(s ?? "")
      .replace(/[œæŒÆ]/g, (m) => FOLD_MAP[m])
      .replace(/[’‘]/g, "'")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

  const searchSplitWords = (s) =>
    searchNormalize(s).split(/[^a-z0-9]+/).filter(Boolean);

  // Distance de Damerau-Levenshtein restreinte (substitution,
  // insertion, suppression, transposition adjacente), bornée par
  // max : renvoie max+1 dès que la distance excède max (coupe
  // précoce, mots courts).
  function boundedEditDistance(a, b, max) {
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    if (la === 0) return lb > max ? max + 1 : lb;
    let dPrev2 = new Int32Array(lb + 1);
    let dPrev = new Int32Array(lb + 1);
    let dCur = new Int32Array(lb + 1);
    for (let j = 0; j <= lb; j++) dPrev[j] = j;
    for (let i = 1; i <= la; i++) {
      dCur[0] = i;
      let rowMin = i;
      const ca = a.charCodeAt(i - 1);
      for (let j = 1; j <= lb; j++) {
        const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
        let v = Math.min(dCur[j - 1] + 1, dPrev[j] + 1, dPrev[j - 1] + cost);
        if (
          i > 1 && j > 1 &&
          ca === b.charCodeAt(j - 2) &&
          a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
        ) {
          v = Math.min(v, dPrev2[j - 2] + 1);
        }
        dCur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      const t = dPrev2; dPrev2 = dPrev; dPrev = dCur; dCur = t;
    }
    return dPrev[lb] > max ? max + 1 : dPrev[lb];
  }

  // Nombre de fautes tolérées pour un mot de la requête.
  const typoBudget = (w) =>
    w.length <= 5 ? 0 : w.length <= 12 ? 1 : w.length <= 20 ? 2 : Math.floor(w.length / 10);

  // Un mot de requête correspond-il ? Exact d'abord (Set), sinon
  // flou borné sur les seuls mots de longueur comparable.
  function wordMatches(qWord, index) {
    if (index.set.has(qWord)) return true;
    const budget = typoBudget(qWord);
    if (budget === 0) return false;
    for (const w of index.words) {
      if (w.length < qWord.length - budget || w.length > qWord.length + budget) continue;
      if (boundedEditDistance(qWord, w, budget) <= budget) return true;
    }
    return false;
  }

  // Une requête matche-t-elle une fiche ? 1) sous-chaîne
  // normalisée ; 2) sinon chaque mot significatif doit matcher
  // indépendamment (ET) — mots non adjacents retrouvés, ordre
  // libre. qWords = mots ≥ 2 car. de la requête normalisée.
  function matchesQuery(index, qNorm, qWords) {
    if (index.norm.includes(qNorm)) return true;
    if (qWords.length === 0) return false;
    return qWords.every((w) => wordMatches(w, index));
  }

  // Fabrique l'accès index+cache par item. Le haystack dépend
  // de l'app (fiches Zotero vs actualités) : getKey(item)
  // identifie l'item (clé de cache), getHaystack(item) rend le
  // texte à indexer. L'index est calculé une fois puis mis en
  // cache (les données ne changent pas sans recharger la page).
  function makeSearchCache(getKey, getHaystack) {
    const cache = new Map();
    return function getSearchIndex(item) {
      let index = cache.get(getKey(item));
      if (!index) {
        const norm = searchNormalize(getHaystack(item));
        const words = searchSplitWords(norm);
        index = { norm, words, set: new Set(words) };
        cache.set(getKey(item), index);
      }
      return index;
    };
  }

  return {
    searchNormalize,
    searchSplitWords,
    boundedEditDistance,
    typoBudget,
    wordMatches,
    matchesQuery,
    makeSearchCache,
  };
})();
