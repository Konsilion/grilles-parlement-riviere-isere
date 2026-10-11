/* =========================================================
   Zotero Vitrine — logique front
   - Fetch collection.json
   - Rendu des cartes (sans tags depuis 09/10/26 — décision CEO)
   - Filtres (recherche floue insensible casse/accents + année multi-choix + type multi-choix)
   - Types dynamiques : compteurs recalculés à chaque filtre, types à 0 masqués
   - Modale détail + copie BibTeX (tags conservés en modale)
   ========================================================= */

(() => {
  "use strict";

  // ---------- Mode intégré (iframe hôte, ?mode=integre) ----------
  // La vitrine embarquée n'a PAS de défilement propre : l'iframe est
  // redimensionnée par la page hôte. À chaque changement de hauteur on
  // l'annonce à l'hôte (postMessage) → une seule barre de défilement,
  // celle de la page hôte, et aucun fond imposé (transparence totale).
  const EMBED_MODE = new URLSearchParams(location.search).get("mode") === "integre";
  if (EMBED_MODE) document.documentElement.setAttribute("data-embed", "1");

  const notifyHost = (msg) => {
    if (!EMBED_MODE) return;
    // Origine non restreinte : le message ne transporte qu'un nombre,
    // aucune donnée sensible.
    if (window.parent !== window) parent.postMessage(msg, "*");
  };
  const notifyHeight = () => {
    // Modale ouverte → la hauteur du document varie (ancrage absolu) :
    // ne pas notifier l'hôte, pour éviter un cercle de redimensionnements.
    if (els.modal && els.modal.getAttribute("aria-hidden") === "false") return;
    notifyHost({ type: "zotero-vitrine:height", height: document.documentElement.scrollHeight });
  };

  // ---------- État global ----------
  const state = {
    items: [],            // items de la collection
    meta: {},             // generated_at, count, ...
    searchText: "",
    selectedYears: new Set(), // filtre Année multi-choix — menu déroulant (CEO 10/10/26)
    selectedTypes: new Set(), // filtre Type multi-choix (CEO 09/10/26)
    pageSize: "12",       // "12" | "24" | "48" | "all" (calque alpas)
    currentPage: 0,       // index 0-based
  };

  // ---------- DOM ----------
  const els = {
    search: document.getElementById("search"),
    yearDropdown: document.getElementById("year-dropdown"),
    yearToggle: document.getElementById("year-toggle"),
    yearPill: document.getElementById("year-pill"),
    yearMenu: document.getElementById("year-menu"),
    typeList: document.getElementById("type-list"),
    resetBtn: document.getElementById("reset-filters"),
    grid: document.getElementById("grid"),
    resultCount: document.getElementById("result-count"),
    pageSizeSelect: document.getElementById("page-size-select"),
    pagination: document.getElementById("pagination"),
    paginationTop: document.getElementById("pagination-top"),
    modal: document.getElementById("modal"),
    modalType: document.getElementById("modal-type"),
    modalTitle: document.getElementById("modal-title"),
    modalMetaLine: document.getElementById("modal-meta-line"),
    modalTags: document.getElementById("modal-tags"),
    modalAbstract: document.getElementById("modal-abstract"),
    modalSource: document.getElementById("modal-source"),
    modalBibtex: document.getElementById("modal-bibtex"),
    modalCopied: document.getElementById("modal-copied"),
    modalContent: document.querySelector(".modal-content"),
    modalBackdrop: document.querySelector(".modal-backdrop"),
  };

  // ---------- Utils ----------
  const escapeHtml = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const formatAuthors = (authors) => {
    if (!authors || authors.length === 0) return "Auteur inconnu";
    if (authors.length === 1) return authors[0];
    if (authors.length === 2) return authors.join(" & ");
    if (authors.length <= 5) return authors.slice(0, -1).join(", ") + " & " + authors.at(-1);
    return authors.slice(0, 3).join(", ") + ", et al.";
  };

  const formatAuthorsShort = (authors) => {
    if (!authors || authors.length === 0) return "Auteur inconnu";
    if (authors.length === 1) return authors[0];
    if (authors.length === 2) return authors.join(", ");
    return authors[0] + " et al.";
  };

  // ---------- Recherche : normalisation + fuzzy (10/10/26, demande CEO) ----------
  // La recherche doit être insensible à la casse, aux accents et tolérante
  // aux petites fautes de frappe (« ~95 % de correspondance »). Deux étapes :
  //   1. sous-chaîne sur le texte NORMALISÉ (casse, accents, œ, ’) ;
  //   2. mode flou par mot : chaque mot significatif de la requête doit se
  //      trouver dans la fiche, exact ou à ~1-2 fautes près (Damerau-
  //      Levenshtein borné). Calibrage : 95 % STRICT n'autoriserait aucune
  //      faute sur un mot de moins de 20 lettres (1 lettre sur 8 = 12 %
  //      d'écart) — le fuzzy serait inutile. Budget retenu : 0 faute ≤ 5
  //      car., 1 faute 6-12 car., 2 fautes 13-20 car. (≥ ~85 % par mot).

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

  // Distance de Damerau-Levenshtein restreinte (substitution, insertion,
  // suppression, transposition adjacente), bornée par max : renvoie max+1
  // dès que la distance excède max (coupe précoce, mots courts).
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

  // Un mot de requête correspond-il ? Exact d'abord (Set), sinon flou borné
  // sur les seuls mots de longueur comparable.
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

  // Index de recherche par item, calculé une fois puis mis en cache (le JSON
  // ne change pas sans re-fetch de la page).
  const searchIndexCache = new Map(); // item.key → { norm, words, set }
  function getSearchIndex(it) {
    let index = searchIndexCache.get(it.key);
    if (!index) {
      const norm = searchNormalize(
        [it.title, ...(it.authors || []), it.abstract || "", ...(it.tags || [])].join(" ")
      );
      const words = searchSplitWords(norm);
      index = { norm, words, set: new Set(words) };
      searchIndexCache.set(it.key, index);
    }
    return index;
  }

  // ---------- Fetch initial ----------
  async function loadCollection() {
    try {
      const resp = await fetch("data/collection.json", { cache: "no-store" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      state.items = data.items || [];
      state.meta = data;

      buildFilterOptions();
      render();
    } catch (err) {
      els.grid.innerHTML = `<p class="empty">
        ⚠️ Impossible de charger <code>data/collection.json</code>.<br>
        <small>${escapeHtml(err.message)}</small><br><br>
        <small>Avez-vous lancé <code>python scripts/fetch_zotero.py</code> ?</small>
      </p>`;
      console.error(err);
      notifyHeight();
    }
  }

  // ---------- Construction des options de filtres (une seule fois) ----------
  function buildFilterOptions() {
    const years = new Set();
    for (const it of state.items) {
      if (it.year) years.add(it.year);
    }

    // Menu Année multi-choix : « Toutes les années » en tête (décoche tout
    // d'un clic), puis les années distinctes par ordre décroissant.
    els.yearMenu.innerHTML = "";
    els.yearMenu.appendChild(buildYearOption("", "Toutes les années"));
    [...years].sort((a, b) => b.localeCompare(a)).forEach((y) => {
      els.yearMenu.appendChild(buildYearOption(y, y));
    });
    updateYearDropdownUI();
  }

  // Une ligne du menu Année : checkbox + libellé. value vide = « Toutes les
  // années » → vide la sélection d'un clic.
  function buildYearOption(value, label) {
    const row = document.createElement("label");
    row.className = "year-option" + (value === "" ? " year-all" : "");
    row.dataset.value = value;
    row.setAttribute("role", "option");

    const box = document.createElement("input");
    box.type = "checkbox";
    box.addEventListener("change", () => {
      if (value === "") {
        state.selectedYears.clear(); // tout décocher d'un clic
      } else if (box.checked) {
        state.selectedYears.add(value);
      } else {
        state.selectedYears.delete(value);
      }
      state.currentPage = 0; // tout filtre ramène à la page 1 (calque alpas)
      updateYearDropdownUI();
      render();
    });

    const name = document.createElement("span");
    name.className = "year-option-name";
    name.textContent = label;

    row.append(box, name);
    return row;
  }

  // Libellé du bouton pill : « Toutes les années » (aucune) | l'année | « N années ».
  function yearPillLabel() {
    const n = state.selectedYears.size;
    if (n === 0) return "Toutes les années";
    if (n === 1) return [...state.selectedYears][0];
    return `${n} années`;
  }

  // Resynchronise menu (cases cochées, .active, aria-selected) et pill après
  // chaque changement de sélection (ou reset). Classe de sélection = .active,
  // convention du site (cf. filtre Type).
  function updateYearDropdownUI() {
    els.yearMenu.querySelectorAll(".year-option").forEach((row) => {
      const value = row.dataset.value;
      const checked = value === ""
        ? state.selectedYears.size === 0
        : state.selectedYears.has(value);
      row.querySelector("input").checked = checked;
      row.classList.toggle("active", checked);
      row.setAttribute("aria-selected", checked ? "true" : "false");
    });
    els.yearPill.textContent = yearPillLabel();
    els.yearToggle.classList.toggle("active", state.selectedYears.size > 0);
  }

  // ---------- Ouverture/fermeture du menu Année ----------
  function setYearMenuOpen(open) {
    els.yearDropdown.classList.toggle("open", open);
    els.yearMenu.classList.toggle("open", open);
    els.yearToggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  const isYearMenuOpen = () => els.yearMenu.classList.contains("open");

  // ---------- Filtrage ----------
  // ignoreTypes: calcule le filtrage SANS la condition de type — utilisé pour
  // les compteurs de la sidebar : les types restent tous visibles et cochables
  // même quand des types sont déjà sélectionnés (sinon le multi-choix casserait).
  function getFilteredItems({ ignoreTypes = false } = {}) {
    const qNorm = searchNormalize(state.searchText.trim());
    // Mots significatifs (≥ 2 car.) pour le mode flou ; les mots de 1 car.
    // (« l » de « l'eau ») ne portent pas de sens de recherche.
    const qWords = qNorm ? qNorm.split(/[^a-z0-9]+/).filter((w) => w.length >= 2) : [];
    return state.items.filter((it) => {
      if (qNorm) {
        const index = getSearchIndex(it);
        // 1) sous-chaîne normalisée : casse/accents/apostrophes ignorés,
        //    expressions multi-mots conservées telles quelles ;
        if (!index.norm.includes(qNorm)) {
          // 2) mode flou : chaque mot de la requête doit être trouvé dans la
          //    fiche, exact ou à ~1-2 fautes près. Une requête sans aucun
          //    mot significatif ne peut pas être rattrapée.
          if (qWords.length === 0 || !qWords.every((w) => wordMatches(w, index))) return false;
        }
      }
      if (state.selectedYears.size > 0 && !state.selectedYears.has(it.year)) return false;
      if (!ignoreTypes && state.selectedTypes.size > 0 && !state.selectedTypes.has(it.type)) return false;
      return true;
    });
  }

  // ---------- Rendu des types dynamiques (multi-choix) ----------
  function renderTypes(scopedItems) {
    // Compter les types parmi les items filtrés par recherche + année SANS le
    // filtre type : un item a un seul type, la combinaison de types cochés est
    // donc une union — les compteurs restent exacts même à plusieurs cochés.
    const typeCounts = new Map();
    for (const it of scopedItems) {
      if (it.type) typeCounts.set(it.type, (typeCounts.get(it.type) || 0) + 1);
    }

    // Types déjà sélectionnés qui ne sont plus dans le périmètre → gardés
    // visibles (cochés, compteur 0) pour pouvoir les décocher.
    for (const t of state.selectedTypes) {
      if (!typeCounts.has(t)) typeCounts.set(t, 0);
    }

    // Tri : types sélectionnés en premier, puis par fréquence décroissante
    const sortedTypes = [...typeCounts.entries()].sort((a, b) => {
      const aSelected = state.selectedTypes.has(a[0]);
      const bSelected = state.selectedTypes.has(b[0]);
      if (aSelected && !bSelected) return -1;
      if (!aSelected && bSelected) return 1;
      return b[1] - a[1];
    });

    // Masquer les types à 0 (sauf les sélectionnés)
    const visibleTypes = sortedTypes.filter(([type, count]) => count > 0 || state.selectedTypes.has(type));

    if (visibleTypes.length === 0) {
      els.typeList.innerHTML = `<p class="muted">Aucun type disponible</p>`;
      return;
    }

    els.typeList.innerHTML = "";
    for (const [type, count] of visibleTypes) {
      const label = document.createElement("label");
      label.className = "type-check";
      if (state.selectedTypes.has(type)) label.classList.add("active");

      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = state.selectedTypes.has(type);
      box.addEventListener("change", () => {
        if (box.checked) state.selectedTypes.add(type);
        else state.selectedTypes.delete(type);
        state.currentPage = 0; // tout filtre ramène à la page 1 (calque alpas)
        render();
      });

      const name = document.createElement("span");
      name.className = "type-check-name";
      name.textContent = type;

      const cnt = document.createElement("span");
      cnt.className = "type-count";
      cnt.textContent = count;

      label.append(box, name, cnt);
      els.typeList.appendChild(label);
    }
  }

  // ---------- Rendu ----------

  // Calcule la tranche courante + borne currentPage (calque alpas).
  function paginate(filtered) {
    const pageSizeNum = (state.pageSize === "all") ? filtered.length : parseInt(state.pageSize, 10);
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSizeNum));
    if (state.currentPage >= totalPages) state.currentPage = totalPages - 1;
    if (state.currentPage < 0) state.currentPage = 0;
    const startIdx = state.currentPage * pageSizeNum;
    return {
      totalPages,
      pageRows: filtered.slice(startIdx, startIdx + pageSizeNum),
    };
  }

  // Barres de pagination (haut + bas, synchronisées) : ‹ / numéros / › (tous
  // si ≤ 6 pages, sinon fenêtre [première, dernière, courant±1] avec « … »).
  // Chaque changement de filtre ramène à la page 1 (comme alpas).
  function renderPagination(totalPages) {
    const navs = [els.pagination, els.paginationTop].filter(Boolean);

    if (state.pageSize === "all" || totalPages <= 1) {
      navs.forEach((nav) => (nav.innerHTML = ""));
      return;
    }

    let html = `<button class="page-btn" data-page="prev" ${state.currentPage === 0 ? "disabled" : ""} aria-label="Page précédente">‹</button>`;

    if (totalPages <= 6) {
      for (let i = 0; i < totalPages; i++) {
        html += `<button class="page-num${i === state.currentPage ? " active" : ""}" data-page="${i}">${i + 1}</button>`;
      }
    } else {
      const pages = new Set([0, totalPages - 1, state.currentPage, state.currentPage - 1, state.currentPage + 1]);
      let prevShown = -1;
      for (let i = 0; i < totalPages; i++) {
        if (pages.has(i)) {
          html += `<button class="page-num${i === state.currentPage ? " active" : ""}" data-page="${i}">${i + 1}</button>`;
          prevShown = i;
        } else if (prevShown !== -2) {
          html += `<span class="page-ellipsis">…</span>`;
          prevShown = -2;
        }
      }
    }

    html += `<button class="page-btn" data-page="next" ${state.currentPage >= totalPages - 1 ? "disabled" : ""} aria-label="Page suivante">›</button>`;

    navs.forEach((nav) => {
      nav.innerHTML = html;
      nav.querySelectorAll("button[data-page]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const p = btn.dataset.page;
          if (p === "prev") state.currentPage = Math.max(0, state.currentPage - 1);
          else if (p === "next") state.currentPage = state.currentPage + 1;
          else state.currentPage = parseInt(p, 10);
          render();
        });
      });
    });
  }

  function render() {
    const filtered = getFilteredItems();
    els.resultCount.textContent = `${filtered.length} résultat${filtered.length > 1 ? "s" : ""}`;

    // Rendu des types dynamiques (sur le périmètre recherche + année, sans le
    // filtre type, pour que tous les types restent cochables en multi-choix)
    renderTypes(getFilteredItems({ ignoreTypes: true }));

    const { totalPages, pageRows } = paginate(filtered);
    renderPagination(totalPages);

    if (filtered.length === 0) {
      els.grid.innerHTML = `<p class="empty">Aucun document ne correspond aux filtres.</p>`;
      notifyHeight();
      return;
    }

    els.grid.innerHTML = pageRows.map((it) => renderCard(it)).join("");

    els.grid.querySelectorAll(".card").forEach((card) => {
      card.addEventListener("click", () => {
        const key = card.dataset.key;
        const item = state.items.find((i) => i.key === key);
        if (item) openModal(item, card);
      });
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          card.click();
        }
      });
    });
    notifyHeight();
  }

  // ---------- Vignettes de type (classe CSS par type) ----------
  const TYPE_CLASS_MAP = {
    "Rapport": "rapport",
    "Document": "document",
    "Présentation": "presentation",
    "Audio": "audio",
    "Article de revue": "article",
    "Newsletter": "newsletter",
  };

  const typeClass = (type) => "type-" + (TYPE_CLASS_MAP[type] || "autre");

  function renderCard(it) {
    return `
      <article class="card" data-key="${escapeHtml(it.key)}" tabindex="0" role="button" aria-label="Voir le détail de ${escapeHtml(it.title)}">
        <span class="card-type ${typeClass(it.type)}">${escapeHtml(it.type || "Document")}</span>
        <h2 class="card-title">${escapeHtml(it.title)}</h2>
        <p class="card-authors">${escapeHtml(formatAuthorsShort(it.authors))}</p>
        <p class="card-meta">${it.year ? escapeHtml(it.year) : "Année inconnue"}</p>
      </article>
    `;
  }

  // ---------- Modale ----------
  // Ligne meta compacte : « Par : <auteurs> · 📅 <année> · Ajouté le <date> ».
  // Chaque segment absent de l'item est omis ; seuls les segments présents
  // sont séparés par « · ». Les auteurs absents restent « Auteur inconnu »
  // (comportement formatAuthors conservé).
  function buildMetaSegments(item) {
    const segments = [];
    const authors = formatAuthors(item.authors);
    if (authors) segments.push(`Par : ${authors}`);
    if (item.year) segments.push(`📅 ${item.year}`);
    if (item.dateAdded) segments.push(`Ajouté le ${item.dateAdded}`);
    return segments;
  }

  function renderMetaLine(item) {
    const segments = buildMetaSegments(item);
    els.modalMetaLine.textContent = "";
    segments.forEach((seg, i) => {
      if (i > 0) els.modalMetaLine.append(" · ");
      if (seg.startsWith("Par : ")) {
        const span = document.createElement("span");
        span.className = "modal-meta-authors";
        span.textContent = seg;
        els.modalMetaLine.append(span);
      } else {
        els.modalMetaLine.append(seg);
      }
    });
  }

  function openModal(item, triggerEl) {
    els.modalType.textContent = item.type || "Document";
    els.modalType.className = "modal-type " + typeClass(item.type);
    els.modalTitle.textContent = item.title;
    renderMetaLine(item);

    els.modalTags.innerHTML = (item.tags || [])
      .map((t) => `<span class="card-tag">${escapeHtml(t)}</span>`)
      .join("");

    if (item.abstract && item.abstract.trim()) {
      els.modalAbstract.textContent = item.abstract;
      els.modalAbstract.classList.remove("empty");
    } else {
      els.modalAbstract.textContent = "Pas de résumé disponible.";
      els.modalAbstract.classList.add("empty");
    }

    const sourceUrl = item.url || (item.doi ? `https://doi.org/${item.doi}` : null);
    if (sourceUrl) {
      els.modalSource.href = sourceUrl;
      els.modalSource.classList.remove("disabled");
      els.modalSource.textContent = "Ouvrir la source";
    } else {
      els.modalSource.removeAttribute("href");
      els.modalSource.classList.add("disabled");
      els.modalSource.textContent = "Pas de lien disponible";
    }

    els.modalBibtex.dataset.key = item.key;
    els.modalCopied.textContent = "";

    els.modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    if (EMBED_MODE) positionEmbedModal(triggerEl);
  }

  // En mode intégré, l'iframe est haute comme son contenu : un placement
  // « fixed » centrerait la modale hors du champ visible. On l'ancre donc
  // sur la carte cliquée — visible par définition — et le voile couvre
  // tout le document.
  function positionEmbedModal(triggerEl) {
    const top = triggerEl
      ? Math.max(8, Math.round(triggerEl.getBoundingClientRect().top) - 16)
      : 16;
    els.modal.style.top = top + "px";
    els.modalBackdrop.style.top = -top + "px";
    els.modalBackdrop.style.height = document.documentElement.scrollHeight + "px";
    requestAnimationFrame(() => {
      els.modalContent.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  function closeModal() {
    els.modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    if (EMBED_MODE) {
      els.modal.style.top = "";
      els.modalBackdrop.style.top = "";
      els.modalBackdrop.style.height = "";
    }
  }

  // ---------- BibTeX ----------
  function buildBibtex(item) {
    const FR_TO_BIBTEX = {
      "Livre": "book",
      "Chapitre de livre": "incollection",
      "Article de revue": "article",
      "Article de magazine": "article",
      "Article de presse": "article",
      "Thèse": "phdthesis",
      "Rapport": "techreport",
      "Communication": "inproceedings",
      "Manuscrit": "unpublished",
      "Page web": "misc",
      "Pré-publication": "article",
    };
    const type = FR_TO_BIBTEX[item.type] || "misc";

    const firstAuthor = (item.authors && item.authors[0]) || "inconnu";
    const lastName = firstAuthor.split(" ").pop().toLowerCase().replace(/[^a-z]/g, "");
    const year = item.year || "nodate";
    const citeKey = `${lastName}${year}_${(item.key || "").slice(-4)}`;

    const bibAuthors = (item.authors || [])
      .map((a) => {
        const parts = a.trim().split(/\s+/);
        if (parts.length === 1) return parts[0];
        const last = parts[0];
        const first = parts.slice(1).join(" ");
        return `${last}, ${first}`;
      })
      .join(" and ");

    const fields = [];
    fields.push(`  title = {${item.title || ""}}`);
    if (bibAuthors) fields.push(`  author = {${bibAuthors}}`);
    if (item.year) fields.push(`  year = {${item.year}}`);
    if (item.doi) fields.push(`  doi = {${item.doi}}`);
    if (item.url) fields.push(`  url = {${item.url}}`);
    if (item.abstract) fields.push(`  abstract = {${item.abstract.replace(/[{}]/g, "")}}`);
    if (item.dateAdded) fields.push(`  note = {Ajouté à Zotero le ${item.dateAdded}}`);

    return `@${type}{${citeKey},\n${fields.join(",\n")}\n}`;
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (_) { /* ignore */ }
      document.body.removeChild(ta);
      return ok;
    }
  }

  // ---------- Listeners globaux ----------
  function attachListeners() {
    let searchTimer = null;
    els.search.addEventListener("input", (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.searchText = e.target.value;
        state.currentPage = 0; // tout filtre ramène à la page 1 (calque alpas)
        render();
      }, 150);
    });

    // Filtre Année : menu déroulant multi-choix — clic bouton → ouvre/ferme
    els.yearToggle.addEventListener("click", () => {
      setYearMenuOpen(!isYearMenuOpen());
    });

    // Clic hors menu → ferme (les clics sur les options restent dedans)
    document.addEventListener("click", (e) => {
      if (isYearMenuOpen() && !els.yearDropdown.contains(e.target)) setYearMenuOpen(false);
    });

    if (els.pageSizeSelect) {
      els.pageSizeSelect.addEventListener("change", (e) => {
        state.pageSize = e.target.value;
        state.currentPage = 0; // changement de taille de page → retour page 1
        render();
      });
    }

    els.resetBtn.addEventListener("click", () => {
      state.searchText = "";
      state.selectedYears.clear();
      state.selectedTypes.clear();
      state.currentPage = 0;
      els.search.value = "";
      updateYearDropdownUI(); // cases décochées + pill « Toutes les années »
      setYearMenuOpen(false);
      render();
    });

    els.modal.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", closeModal);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (isYearMenuOpen()) {
        setYearMenuOpen(false); // Échap ferme le menu Année
        els.yearToggle.focus();
        return;
      }
      if (els.modal.getAttribute("aria-hidden") === "false") {
        closeModal();
      }
    });

    els.modalBibtex.addEventListener("click", async () => {
      const key = els.modalBibtex.dataset.key;
      const item = state.items.find((i) => i.key === key);
      if (!item) return;
      const bib = buildBibtex(item);
      const ok = await copyToClipboard(bib);
      els.modalCopied.textContent = ok ? "✓ Citation BibTeX copiée !" : "⚠️ Copie impossible — sélectionne manuellement.";
    });
  }

  // ---------- Boot ----------
  document.addEventListener("DOMContentLoaded", () => {
    attachListeners();
    loadCollection();
    if (EMBED_MODE) {
      // Hauteur initiale + suivi continu (grille, filtres, resize du navigateur)
      notifyHeight();
      window.addEventListener("load", notifyHeight);
      if ("ResizeObserver" in window) {
        new ResizeObserver(() => notifyHeight()).observe(document.body);
      }
    }
  });
})();
