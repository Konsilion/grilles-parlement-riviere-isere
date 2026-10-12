/* =========================================================
   Idées — Parlement de la rivière Isère
   Grille des idées adressées au Parlement de la rivière Isère.
   Lit data/idees.json (contrat fetch_idees.py :
   id, titre, description, auteur, lien, categories, date_ajout).

   Bâtie sur window.GrilleApp (common/js/app-core.js), calque
   strict de organisations/js/app.js : tout le générique (état,
   chargement, rendu de grille, pagination, compteur,
   recherche/taille/tri, modale) vient du socle — ce fichier ne
   garde QUE le spécifique.

   Autres socles : GrilleSearch (recherche floue),
   GrilleDropdown (filtre catégories), GrilleDom (esc/dates),
   GrilleContribution (parcours de contribution). Zéro dépendance.
   ========================================================= */
"use strict";

const DATA_URL = "data/idees.json";

const GA = window.GrilleApp;
const { esc } = window.GrilleDom;
const { formatDate } = window.GrilleDom;
const GS = window.GrilleSearch;
const { makeDropdown } = window.GrilleDropdown;

/* ---------- Mode intégré (?mode=integre) ----------
   Calque organisations : aucune iframe prévue aujourd'hui, le mode est
   hérité pour l'avenir (fond transparent si un jour embarquée). */
const EMBED_MODE =
  new URLSearchParams(location.search).get("mode") === "integre";
if (EMBED_MODE) document.documentElement.setAttribute("data-embed", "1");

/* ---------- État (fabrication du socle + filtres propres) ---------- */
const state = GA.makeState({
  selectedCats: new Set(), // catégories cochées (vide = toutes)
});

/* ---------- Références DOM ---------- */
const els = {
  grid: null,
  count: null,
  search: null,
  pagination: null,
  paginationTop: null,
  pageSizeSelect: null,
  sortSelect: null,
  catDropdown: null,
  catToggle: null,
  catPill: null,
  catMenu: null,
  modal: null,
  modalTitle: null,
  modalMetaLine: null,
  modalCats: null,
  modalDescSection: null,
  modalDescription: null,
  modalCoordsSection: null,
  modalCoords: null,
};

function grabEls() {
  els.grid = document.getElementById("grid");
  els.count = document.getElementById("result-count");
  els.search = document.getElementById("search");
  els.pagination = document.getElementById("pagination");
  els.paginationTop = document.getElementById("pagination-top");
  els.pageSizeSelect = document.getElementById("page-size-select");
  els.sortSelect = document.getElementById("sort-select");
  els.catDropdown = document.getElementById("cat-dropdown");
  els.catToggle = document.getElementById("cat-toggle");
  els.catPill = document.getElementById("cat-pill");
  els.catMenu = document.getElementById("cat-menu");
  els.modal = document.getElementById("modal");
  els.modalTitle = document.getElementById("modal-title");
  els.modalMetaLine = document.getElementById("modal-meta-line");
  els.modalCats = document.getElementById("modal-cats");
  els.modalDescSection = document.getElementById("modal-desc-section");
  els.modalDescription = document.getElementById("modal-description");
  els.modalCoordsSection = document.getElementById("modal-coords-section");
  els.modalCoords = document.getElementById("modal-coords");
}

/* ---------- Normalisation (contrat FROZEN, absents → "") ---------- */
function normalizeItems(raw) {
  return raw.map((o) => ({
    id: String(o?.id ?? ""),
    titre: String(o?.titre ?? ""),
    description: String(o?.description ?? ""),
    auteur: String(o?.auteur ?? "").trim(),
    lien: String(o?.lien ?? "").trim(),
    categories: Array.isArray(o?.categories) ? o.categories.map(String) : [],
    date_ajout: String(o?.date_ajout ?? "").trim(),
  }));
}

/* ---------- Tri (titre A-Z défaut ; « recent » = date_ajout desc) ---------- */
function sortItems(items) {
  const byTitle = (a, b) =>
    a.titre.localeCompare(b.titre, "fr", { sensitivity: "base" }) ||
    a.id.localeCompare(b.id);
  if (state.sortMode === "recent") {
    // Ajout le plus récent d'abord : date_ajout desc, puis titre A-Z.
    return items.slice().sort((a, b) => {
      if (a.date_ajout !== b.date_ajout)
        return a.date_ajout < b.date_ajout ? 1 : -1;
      return byTitle(a, b);
    });
  }
  return items.slice().sort(byTitle); // défaut : titre A-Z
}

/* ---------- Recherche floue (haystack : titre + description + auteur) ---------- */
const getSearchIndex = GS.makeSearchCache(
  (item) => item.id,
  (item) => [item.titre, item.description, item.auteur].join(" ")
);

/* ---------- Filtrage combiné (recherche ∧ catégories) ---------- */
function getFilteredItems() {
  const qNorm = GS.searchNormalize(state.searchText.trim());
  const qWords = qNorm ? qNorm.split(/[^a-z0-9]+/).filter((w) => w.length >= 2) : [];

  return state.items.filter((it) => {
    if (qNorm && !GS.matchesQuery(getSearchIndex(it), qNorm, qWords)) return false;
    if (state.selectedCats.size > 0 && !it.categories.some((c) => state.selectedCats.has(c))) {
      return false;
    }
    return true;
  });
}

/* ---------- Rendu d'une carte ---------- */
function renderCard(item) {
  const cats = item.categories
    .map((c) => `<span class="card-tag">${esc(c)}</span>`)
    .join("");

  // Meta : « proposée par X » (l'idée est ADRESSÉE au Parlement)
  const meta = item.auteur
    ? `<p class="card-meta">proposée par ${esc(item.auteur)}</p>`
    : "";

  return `
    <article class="card idee-card" data-id="${esc(item.id)}" tabindex="0" role="button" aria-label="Voir le détail de ${esc(item.titre)}">
      <h2 class="card-title">${esc(item.titre)}</h2>
      ${meta}
      ${cats ? `<div class="card-tags">${cats}</div>` : ""}
    </article>
  `;
}

/* ---------- Rendu de la page courante (via le socle GrilleApp) ---------- */
function render() {
  GA.renderGrid({
    state,
    grid: els.grid,
    count: els.count,
    noun: { zero: "aucune idée", one: "idée", many: "idées" },
    cardClass: "idee-card",
    renderCard,
    onCardClick: openModal,
    getVisibleItems: () => sortItems(getFilteredItems()),
    paginationNavs: [els.pagination, els.paginationTop],
    hasActiveFilters: () => Boolean(state.searchText.trim() || state.selectedCats.size),
    emptyFilteredMsg: "Aucune idée ne correspond à ces filtres.",
    emptyMsg: "Aucune idée pour le moment.",
  });
}

/* ---------- Modale détail (calque organisations, sans avatar) ---------- */
function addCoord(list, label, value, href, external) {
  const li = document.createElement("li");
  li.className = "coord";
  const lab = document.createElement("span");
  lab.className = "coord-label";
  lab.textContent = label;
  li.appendChild(lab);
  const a = document.createElement("a");
  a.href = href;
  if (external) {
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  }
  a.textContent = value;
  li.appendChild(a);
  list.appendChild(li);
}

function openModal(item) {
  els.modalTitle.textContent = item.titre || "(sans titre)";

  // Ligne meta : proposée par <auteur> · Ajouté le
  const segs = [];
  if (item.auteur) segs.push(`proposée par ${item.auteur}`);
  if (item.date_ajout) segs.push(`Ajouté le ${formatDate(item.date_ajout)}`);
  els.modalMetaLine.textContent = segs.join(" · ");

  els.modalCats.innerHTML = item.categories
    .map((c) => `<span class="card-tag">${esc(c)}</span>`)
    .join("");

  if (item.description && item.description.trim()) {
    els.modalDescSection.style.display = "";
    els.modalDescription.textContent = item.description;
  } else {
    els.modalDescSection.style.display = "none";
  }

  // Coordonnées : lien externe http/s SEUL (pas d'email/téléphone)
  els.modalCoords.innerHTML = "";
  if (item.lien && /^https?:\/\//i.test(item.lien)) {
    addCoord(els.modalCoords, "Lien", item.lien, item.lien, true);
  }
  els.modalCoordsSection.style.display = els.modalCoords.children.length ? "" : "none";

  GA.openModal(els.modal);
}

/* ---------- Menu Catégories (dropdown commun) ---------- */
function buildCatMenu() {
  const cats = new Set();
  for (const it of state.items) for (const c of it.categories) cats.add(c);
  catDD.fill(
    [...cats].sort((a, b) => a.localeCompare(b, "fr")).map((c) => ({ value: c, label: c })),
    () => onFilterChange(catDD)
  );
}

function onFilterChange(dd) {
  state.currentPage = 0; // tout filtre ramène à la page 1
  dd.syncUI();
  render();
}

/* ---------- Contribution (esprit Datami) ----------
   Calque organisations, socle commun common/js/contribution.js :
   envoi silencieux au relais VPS → issue GitHub étiquetée
   « contribution » ; repli manuel si le relais échoue. Les champs
   suivent le mapping fetch_idees.py / ajouter_idee.py
   (label extra SANS accents « Auteur: », citationKey I000N). */
(function initContribution() {
  const GC = window.GrilleContribution;
  if (!GC) return;

  const f = {
    titre: () => document.getElementById("c-titre"),
    auteur: () => document.getElementById("c-auteur"),
    description: () => document.getElementById("c-description"),
    url: () => document.getElementById("c-url"),
  };

  function closeDetailModal() {
    if (els.modal && els.modal.getAttribute("aria-hidden") === "false") {
      GA.closeModal(els.modal);
    }
  }

  function validate() {
    let ok = true;
    const titre = f.titre().value.trim();
    const description = f.description().value.trim();

    if (!titre) {
      GC.setFieldError(f.titre(), "Le titre est nécessaire pour que l'équipe examine l'idée.");
      ok = false;
    } else if (titre.length < 3) {
      GC.setFieldError(f.titre(), "Le titre paraît trop court — quelques mots suffisent.");
      ok = false;
    } else {
      GC.setFieldError(f.titre(), null);
    }

    if (!description) {
      GC.setFieldError(f.description(), "La description est nécessaire : elle explique l'idée à l'équipe.");
      ok = false;
    } else if (description.length < 20) {
      GC.setFieldError(f.description(), "Décrivez l'idée un peu plus longuement (au moins 20 caractères).");
      ok = false;
    } else {
      GC.setFieldError(f.description(), null);
    }

    const url = f.url().value.trim();
    if (url) {
      let urlOk = false;
      try {
        const u = new URL(url);
        urlOk = u.protocol === "http:" || u.protocol === "https:";
      } catch { /* invalide */ }
      if (!urlOk) {
        GC.setFieldError(f.url(), "Collez une adresse web complète commençant par https:// (ou http://).");
        ok = false;
      } else {
        GC.setFieldError(f.url(), null);
      }
    }

    return ok;
  }

  GC.init({
    app: "idees",
    firstFieldId: "c-titre",
    onOpen: closeDetailModal,
    titleOf: (d) => d.titre,
    collect: () => ({
      titre: f.titre().value.trim(),
      auteur: f.auteur().value.trim(),
      description: f.description().value.trim(),
      url: f.url().value.trim(),
    }),
    validate,
    payload: (d) => d,
    table: (d) => [
      ["Titre", d.titre],
      ["Auteur", d.auteur || "—"],
      ["Description", d.description || "—"],
      ["Lien", d.url || "—"],
    ],
    issueTexts: {
      heading: "Proposition d'idée",
      intro:
        "Un·e visiteur de la grille Idées propose cette idée au Parlement de la rivière Isère.",
      closing:
        "La validation crée l'item Zotero (collection « Idées », mapping : " +
        "extra Auteur:, citationKey I000N), ferme cette issue et le prochain " +
        "`deploy.sh` publie l'idée.",
    },
  });
})();

/* ---------- Boot ---------- */
grabEls();
const catDD = makeDropdown({
  dropdown: els.catDropdown,
  toggle: els.catToggle,
  pill: els.catPill,
  menu: els.catMenu,
  set: state.selectedCats,
  allLabel: "Toutes les catégories",
  unitWord: "catégories",
  labelOf: (v) => v,
});
GA.attachSearch(els.search, state, render);
GA.attachPageSize(els.pageSizeSelect, state, render);
GA.attachSort(els.sortSelect, state, render);
GA.attachModalClose(els.modal, [els.catMenu]);
document.addEventListener("DOMContentLoaded", () => {
  GA.load({
    dataUrl: DATA_URL,
    grid: els.grid,
    normalize: normalizeItems,
    afterLoad: (items) => {
      state.items = items;
      state.currentPage = 0;
      buildCatMenu();
      render();
    },
  });
});
