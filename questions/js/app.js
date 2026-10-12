/* =========================================================
   Questions — Parlement de la rivière Isère
   Grille des questions posées au Parlement de la rivière Isère.
   Lit data/questions.json (contrat fetch_questions.py :
   id, titre, question, description, lien, deposant,
   categories, date_ajout).

   Intention CEO : une question est posée par quelqu'un (deposant),
   les réponses viendront plus tard par le fil GitHub de l'issue
   (parcours normal de contribution) — la fiche affiche le titre
   (formulation courte), la question complète et qui la dépose.

   Bâtie sur window.GrilleApp (common/js/app-core.js) : tout le
   générique (état, chargement, rendu de grille, pagination,
   compteur, recherche/taille/tri, modale) vient du socle — ce
   fichier ne garde QUE le spécifique.

   Autres socles : GrilleSearch (recherche floue),
   GrilleDropdown (filtre catégories), GrilleDom (esc/dates),
   GrilleContribution (parcours de contribution). Zéro dépendance.
   ========================================================= */
"use strict";

const DATA_URL = "data/questions.json";

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
  modalQuestionSection: null,
  modalQuestion: null,
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
  els.modalQuestionSection = document.getElementById("modal-question-section");
  els.modalQuestion = document.getElementById("modal-question");
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
    question: String(o?.question ?? ""),
    description: String(o?.description ?? ""),
    lien: String(o?.lien ?? "").trim(),
    deposant: String(o?.deposant ?? "").trim(),
    categories: Array.isArray(o?.categories) ? o.categories.map(String) : [],
    date_ajout: String(o?.date_ajout ?? "").trim(),
  }));
}

/* ---------- Tri (titre A-Z défaut ; « recent » = date_ajout desc) ---------- */
function sortItems(items) {
  const byTitre = (a, b) =>
    a.titre.localeCompare(b.titre, "fr", { sensitivity: "base" }) ||
    a.id.localeCompare(b.id);
  if (state.sortMode === "recent") {
    // Ajout le plus récent d'abord : date_ajout desc, puis titre A-Z.
    return items.slice().sort((a, b) => {
      if (a.date_ajout !== b.date_ajout)
        return a.date_ajout < b.date_ajout ? 1 : -1;
      return byTitre(a, b);
    });
  }
  return items.slice().sort(byTitre); // défaut : titre A-Z
}

/* ---------- Recherche floue (haystack : titre + question + description + deposant) ---------- */
const getSearchIndex = GS.makeSearchCache(
  (item) => item.id,
  (item) => [item.titre, item.question, item.description, item.deposant].join(" ")
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

  const meta = item.deposant
    ? `<p class="card-meta">Posée par ${esc(item.deposant)}</p>`
    : "";

  return `
    <article class="card question-card" data-id="${esc(item.id)}" tabindex="0" role="button" aria-label="Voir le détail de ${esc(item.titre)}">
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
    noun: { zero: "aucune question", one: "question", many: "questions" },
    cardClass: "question-card",
    renderCard,
    onCardClick: openModal,
    getVisibleItems: () => sortItems(getFilteredItems()),
    paginationNavs: [els.pagination, els.paginationTop],
    hasActiveFilters: () => Boolean(state.searchText.trim() || state.selectedCats.size),
    emptyFilteredMsg: "Aucune question ne correspond à ces filtres.",
    emptyMsg: "Aucune question pour le moment.",
  });
}

/* ---------- Modale détail (calque organisations + section Question) ---------- */
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

  // Ligne meta : posée par <deposant> · Ajouté le
  const segs = [];
  if (item.deposant) segs.push(`Posée par ${item.deposant}`);
  if (item.date_ajout) segs.push(`Ajouté le ${formatDate(item.date_ajout)}`);
  els.modalMetaLine.textContent = segs.join(" · ");

  els.modalCats.innerHTML = item.categories
    .map((c) => `<span class="card-tag">${esc(c)}</span>`)
    .join("");

  // SECTION Question (bloc visuel distinct, style .modal-question)
  if (item.question && item.question.trim()) {
    els.modalQuestionSection.style.display = "";
    els.modalQuestion.textContent = item.question;
  } else {
    els.modalQuestionSection.style.display = "none";
  }

  // Description (contexte)
  if (item.description && item.description.trim()) {
    els.modalDescSection.style.display = "";
    els.modalDescription.textContent = item.description;
  } else {
    els.modalDescSection.style.display = "none";
  }

  // Coordonnées : lien http/s seul
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
   suivent le mapping fetch_questions.py / ajouter_question.py
   (labels extra ANGLAIS sans accents : Question:/Deposant:,
   citationKey Q000N). */
(function initContribution() {
  const GC = window.GrilleContribution;
  if (!GC) return;

  const f = {
    titre: () => document.getElementById("c-titre"),
    question: () => document.getElementById("c-question"),
    deposant: () => document.getElementById("c-deposant"),
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

    if (!titre) {
      GC.setFieldError(f.titre(), "Le titre est nécessaire pour que l'équipe retrouve votre question.");
      ok = false;
    } else if (titre.length < 3) {
      GC.setFieldError(f.titre(), "Le titre paraît trop court — quelques mots suffisent.");
      ok = false;
    } else {
      GC.setFieldError(f.titre(), null);
    }

    const question = f.question().value.trim();
    if (!question) {
      GC.setFieldError(f.question(), "Posez votre question — c'est elle qui sera publiée.");
      ok = false;
    } else if (question.length < 10) {
      GC.setFieldError(f.question(), "La question paraît trop courte — formulez-la en une phrase complète.");
      ok = false;
    } else {
      GC.setFieldError(f.question(), null);
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
    app: "questions",
    firstFieldId: "c-titre",
    onOpen: closeDetailModal,
    titleOf: (d) => d.titre,
    collect: () => ({
      titre: f.titre().value.trim(),
      question: f.question().value.trim(),
      deposant: f.deposant().value.trim(),
      description: f.description().value.trim(),
      url: f.url().value.trim(),
    }),
    validate,
    payload: (d) => d,
    table: (d) => [
      ["Titre", d.titre],
      ["Question", d.question],
      ["Déposant", d.deposant || "—"],
      ["Description", d.description || "—"],
      ["Lien", d.url || "—"],
    ],
    issueTexts: {
      heading: "Question posée",
      intro:
        "Un·e visiteur de la grille Questions dépose cette question.",
      closing:
        "La validation crée l'item Zotero (collection « Questions », mapping : " +
        "extra Question:/Deposant:, citationKey Q000N), ferme cette issue et le prochain " +
        "`deploy.sh` publie la question.",
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
