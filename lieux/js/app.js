/* =========================================================
   Lieux — Parlement de la rivière Isère
   Grille des lieux du Parlement de la rivière Isère.
   Lit data/lieux.json (contrat fetch_lieux.py :
   id, nom, description, adresse, lien, categories,
   date_ajout).

   App bâtie sur window.GrilleApp (common/js/app-core.js)
   : tout le générique (état, chargement, rendu de grille,
   pagination, compteur, recherche/taille/tri, modale) vient du
   socle — ce fichier ne garde QUE le spécifique.
   Calque de organisations/js/app.js (première app GrilleApp).

   Autres socles : GrilleSearch (recherche floue),
   GrilleDropdown (filtre catégories), GrilleDom (esc/dates),
   GrilleContribution (parcours de contribution). Zéro dépendance.
   ========================================================= */
"use strict";

const DATA_URL = "data/lieux.json";

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
}

/* ---------- Normalisation (contrat FROZEN, absents → "") ---------- */
function normalizeItems(raw) {
  return raw.map((o) => ({
    id: String(o?.id ?? ""),
    nom: String(o?.nom ?? ""),
    description: String(o?.description ?? ""),
    adresse: String(o?.adresse ?? ""),
    lien: String(o?.lien ?? "").trim(),
    categories: Array.isArray(o?.categories) ? o.categories.map(String) : [],
    date_ajout: String(o?.date_ajout ?? "").trim(),
  }));
}

/* ---------- Tri (nom A-Z défaut ; « recent » = date_ajout desc) ---------- */
function sortItems(items) {
  const byName = (a, b) =>
    a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }) ||
    a.id.localeCompare(b.id);
  if (state.sortMode === "recent") {
    // Ajout le plus récent d'abord : date_ajout desc, puis nom A-Z.
    return items.slice().sort((a, b) => {
      if (a.date_ajout !== b.date_ajout)
        return a.date_ajout < b.date_ajout ? 1 : -1;
      return byName(a, b);
    });
  }
  return items.slice().sort(byName); // défaut : nom A-Z
}

/* ---------- Recherche floue (haystack : nom + description + adresse) ---------- */
const getSearchIndex = GS.makeSearchCache(
  (item) => item.id,
  (item) => [item.nom, item.description, item.adresse].join(" ")
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

  return `
    <article class="card lieu-card" data-id="${esc(item.id)}" tabindex="0" role="button" aria-label="Voir le détail de ${esc(item.nom)}">
      <h2 class="card-title">${esc(item.nom)}</h2>
      ${item.adresse ? `<p class="card-meta">${esc(item.adresse)}</p>` : ""}
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
    noun: { zero: "aucun lieu", one: "lieu", many: "lieux" },
    cardClass: "lieu-card",
    renderCard,
    onCardClick: openModal,
    getVisibleItems: () => sortItems(getFilteredItems()),
    paginationNavs: [els.pagination, els.paginationTop],
    hasActiveFilters: () => Boolean(state.searchText.trim() || state.selectedCats.size),
    emptyFilteredMsg: "Aucun lieu ne correspond à ces filtres.",
    emptyMsg: "Aucun lieu pour le moment.",
  });
}

/* ---------- Modale détail (définition « lieux » du socle
   GrilleDetail, common/js/details/lieux.js — aucune duplication :
   le conteneur et les blocs structurels viennent du socle
   commun modal.css) ---------- */
const GD = window.GrilleDetail;

/* ---------- Modale détail : consommation du socle GrilleDetail ---------- */
function openModal(item) {
  GD.open("lieux", item);
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
   suivent le mapping fetch_lieux.py / ajouter_lieu.py
   (place=adresse, citationKey L000N). */
(function initContribution() {
  const GC = window.GrilleContribution;
  if (!GC) return;

  const f = {
    nom: () => document.getElementById("c-nom"),
    adresse: () => document.getElementById("c-adresse"),
    description: () => document.getElementById("c-description"),
    url: () => document.getElementById("c-url"),
  };

  function closeDetailModal() {
    if (GD.isOpen("lieux")) GD.close("lieux");
  }

  function validate() {
    let ok = true;
    const nom = f.nom().value.trim();

    if (!nom) {
      GC.setFieldError(f.nom(), "Le nom est nécessaire pour que l'équipe vérifie le lieu.");
      ok = false;
    } else if (nom.length < 3) {
      GC.setFieldError(f.nom(), "Le nom paraît trop court — quelques mots suffisent.");
      ok = false;
    } else {
      GC.setFieldError(f.nom(), null);
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
    app: "lieux",
    firstFieldId: "c-nom",
    onOpen: closeDetailModal,
    titleOf: (d) => d.nom,
    collect: () => ({
      nom: f.nom().value.trim(),
      adresse: f.adresse().value.trim(),
      description: f.description().value.trim(),
      url: f.url().value.trim(),
    }),
    validate,
    payload: (d) => d,
    table: (d) => [
      ["Nom", d.nom],
      ["Adresse", d.adresse || "—"],
      ["Description", d.description || "—"],
      ["Lien", d.url || "—"],
    ],
    issueTexts: {
      heading: "Proposition de lieu",
      intro:
        "Un·e visiteur de la grille Lieux propose d'ajouter ce lieu.",
      closing:
        "La validation crée l'item Zotero (collection « Lieux », mapping : " +
        "place=adresse, citationKey L000N), ferme cette issue et le prochain " +
        "`deploy.sh` publie le lieu.",
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
