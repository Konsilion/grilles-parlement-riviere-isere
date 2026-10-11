/* =========================================================
   Projets — Parlement de la rivière Isère (P1/P3)
   Grille des démarches propres au Parlement de la rivière
   Isère. Lit data/projets.json (contrat fetch_projets.py :
   id, titre, description, porteur, lieu, date_debut, date_fin,
   lien, statut, categories, date_ajout).
   Socles communs : GrilleSearch (recherche floue),
   GrillePagination (9/18/36/Tout), GrilleDropdown (filtres
   Statut + Catégories), GrilleDom (esc/dates). Zéro dépendance.
   ========================================================= */
"use strict";

const DATA_URL = "data/projets.json";

const { esc } = window.GrilleDom;
const { parseISO, formatDate } = window.GrilleDom;
const GS = window.GrilleSearch;
const { paginate: paginateItems, renderPagination } = window.GrillePagination;
const { makeDropdown } = window.GrilleDropdown;

/* ---------- Statuts ----------
   Les trois statuts conseillés (ajouter_projet.py) portent une
   vignette colorée (palette claire existante de la médiathèque) ;
   tout autre statut s'affiche tel quel sur la vignette neutre.
   Sans statut renseigné : déduction depuis les dates (Terminé si
   date de fin passée, À venir si début futur, En cours sinon). */
const STATUTS = {
  "En cours": "en-cours",
  "À venir": "a-venir",
  "Terminé": "termine",
};

/* ---------- Mode intégré (?mode=integre) ----------
   Calque contacts : aucune iframe prévue aujourd'hui, le mode est
   hérité pour l'avenir (fond transparent si un jour embarquée). */
const EMBED_MODE =
  new URLSearchParams(location.search).get("mode") === "integre";
if (EMBED_MODE) document.documentElement.setAttribute("data-embed", "1");

/* ---------- État ---------- */
const state = {
  items: [],
  searchText: "",
  selectedStatuts: new Set(), // statuts cochés (vide = tous)
  selectedCats: new Set(),     // catégories cochées (vide = toutes)
  sortMode: "recent",          // "recent" (défaut) | "nom" | "fin"
  pageSize: "9",               // "9" | "18" | "36" | "all" (calque contacts)
  currentPage: 0,               // index 0-based
};

/* ---------- Références DOM ---------- */
const els = {
  grid: null,
  count: null,
  search: null,
  pagination: null,
  paginationTop: null,
  pageSizeSelect: null,
  sortSelect: null,
  statutDropdown: null,
  statutToggle: null,
  statutPill: null,
  statutMenu: null,
  catDropdown: null,
  catToggle: null,
  catPill: null,
  catMenu: null,
  modal: null,
  modalStatut: null,
  modalTitle: null,
  modalMetaLine: null,
  modalCats: null,
  modalDescSection: null,
  modalDescription: null,
  modalSource: null,
};

function grabEls() {
  els.grid = document.getElementById("grid");
  els.count = document.getElementById("result-count");
  els.search = document.getElementById("search");
  els.pagination = document.getElementById("pagination");
  els.paginationTop = document.getElementById("pagination-top");
  els.pageSizeSelect = document.getElementById("page-size-select");
  els.sortSelect = document.getElementById("sort-select");
  els.statutDropdown = document.getElementById("statut-dropdown");
  els.statutToggle = document.getElementById("statut-toggle");
  els.statutPill = document.getElementById("statut-pill");
  els.statutMenu = document.getElementById("statut-menu");
  els.catDropdown = document.getElementById("cat-dropdown");
  els.catToggle = document.getElementById("cat-toggle");
  els.catPill = document.getElementById("cat-pill");
  els.catMenu = document.getElementById("cat-menu");
  els.modal = document.getElementById("modal");
  els.modalStatut = document.getElementById("modal-statut");
  els.modalTitle = document.getElementById("modal-title");
  els.modalMetaLine = document.getElementById("modal-meta-line");
  els.modalCats = document.getElementById("modal-cats");
  els.modalDescSection = document.getElementById("modal-desc-section");
  els.modalDescription = document.getElementById("modal-description");
  els.modalSource = document.getElementById("modal-source");
}

/* ---------- Normalisation (contrat P3, valeurs absentes → "") ---------- */
function normalizeItems(raw) {
  return raw.map((o) => ({
    id: String(o?.id ?? ""),
    titre: String(o?.titre ?? ""),
    description: String(o?.description ?? ""),
    porteur: String(o?.porteur ?? ""),
    lieu: String(o?.lieu ?? ""),
    date_debut: String(o?.date_debut ?? "").trim(),
    date_fin: String(o?.date_fin ?? "").trim(),
    lien: String(o?.lien ?? "").trim(),
    statut: String(o?.statut ?? "").trim(),
    categories: Array.isArray(o?.categories) ? o.categories.map(String) : [],
    date_ajout: String(o?.date_ajout ?? "").trim(),
  }));
}

/* ---------- Statut effectif (renseigné sinon déduit des dates) ---------- */
function statutOf(item) {
  if (item.statut) return item.statut;
  const today = new Date();
  const debut = parseISO(item.date_debut);
  const fin = parseISO(item.date_fin);
  if (fin && fin < today) return "Terminé";
  if (debut && debut > today) return "À venir";
  return "En cours"; // y compris sans aucune date (défaut neutre)
}

function statutSlug(statut) {
  return STATUTS[statut] || "autre";
}

/* ---------- Tri ---------- */
function sortTie(a, b) {
  // Départage des items sans la date qui trie : début le plus récent
  // d'abord, puis date d'ajout desc, puis titre.
  const tsDebut = (c) => parseISO(c.date_debut || "")?.getTime() || 0;
  const da = tsDebut(a), db = tsDebut(b);
  if (da !== db) return db - da;
  if (a.date_ajout !== b.date_ajout) return a.date_ajout < b.date_ajout ? 1 : -1;
  return a.titre.localeCompare(b.titre, "fr", { sensitivity: "base" }) || a.id.localeCompare(b.id);
}

function sortItems(items) {
  const byTitle = (a, b) =>
    a.titre.localeCompare(b.titre, "fr", { sensitivity: "base" }) ||
    a.id.localeCompare(b.id);
  const tsDebut = (c) => parseISO(c.date_debut || "")?.getTime() || 0;
  const tsFin = (c) => parseISO(c.date_fin || "")?.getTime() || 0;

  if (state.sortMode === "nom") {
    return items.slice().sort(byTitle); // titre A-Z
  }
  if (state.sortMode === "fin") {
    // Fin de projet : la fin la plus proche d'abord ; sans date de fin
    // (projet en cours indéterminé) → fin de liste, départagée par
    // début le plus récent puis titre.
    return items.slice().sort((a, b) => {
      const ta = tsFin(a), tb = tsFin(b);
      if (ta && tb) return ta - tb;
      if (ta) return -1;
      if (tb) return 1;
      return sortTie(a, b);
    });
  }
  // Défaut "recent" : début le plus récent d'abord ; sans date de début
  // → fin de liste, départagée par date d'ajout puis titre.
  return items.slice().sort((a, b) => {
    const ta = tsDebut(a), tb = tsDebut(b);
    if (ta && tb) return tb - ta;
    if (ta) return -1;
    if (tb) return 1;
    return sortTie(a, b);
  });
}

/* ---------- Recherche floue (haystack : titre + porteur + description + lieu + statut) ---------- */
const getSearchIndex = GS.makeSearchCache(
  (item) => item.id,
  (item) =>
    [item.titre, item.porteur, item.description, item.lieu, statutOf(item)].join(" ")
);

/* ---------- Période affichée ---------- */
function formatPeriode(item) {
  const de = (item.date_debut || "").trim();
  const fi = (item.date_fin || "").trim();
  if (de && fi && de !== fi) return `Du ${formatDate(de)} au ${formatDate(fi)}`;
  if (de) return `À partir du ${formatDate(de)}`;
  if (fi) return `Jusqu'au ${formatDate(fi)}`;
  return "";
}

/* ---------- Filtrage combiné (recherche ∧ statut ∧ catégories) ---------- */
function getFilteredItems() {
  const qNorm = GS.searchNormalize(state.searchText.trim());
  const qWords = qNorm ? qNorm.split(/[^a-z0-9]+/).filter((w) => w.length >= 2) : [];

  return state.items.filter((it) => {
    if (qNorm && !GS.matchesQuery(getSearchIndex(it), qNorm, qWords)) return false;
    if (state.selectedStatuts.size > 0 && !state.selectedStatuts.has(statutOf(it))) {
      return false;
    }
    if (state.selectedCats.size > 0 && !it.categories.some((c) => state.selectedCats.has(c))) {
      return false;
    }
    return true;
  });
}

/* ---------- Rendu d'une carte ---------- */
function renderCard(item) {
  const statut = statutOf(item);
  const cats = item.categories
    .map((c) => `<span class="card-tag">${esc(c)}</span>`)
    .join("");

  const metaSegs = [];
  const periode = formatPeriode(item);
  if (periode) metaSegs.push(periode);
  if (item.lieu) metaSegs.push(item.lieu);

  return `
    <article class="card projet-card" data-id="${esc(item.id)}" tabindex="0" role="button" aria-label="Voir le détail de ${esc(item.titre)}">
      <span class="card-type statut-${statutSlug(statut)}">${esc(statut)}</span>
      <h2 class="card-title">${esc(item.titre)}</h2>
      ${item.porteur ? `<p class="card-porteur">${esc(item.porteur)}</p>` : ""}
      ${metaSegs.length ? `<p class="card-meta">${esc(metaSegs.join(" · "))}</p>` : ""}
      ${cats ? `<div class="card-tags">${cats}</div>` : ""}
    </article>
  `;
}

/* ---------- Rendu de la page courante ---------- */
function renderGrid() {
  if (!els.grid) return;
  els.grid.innerHTML = "";

  // Tri appliqué à CHAQUE rendu (copie triée, pas de mutation) :
  // changer le select de tri sans recharger la page doit réordonner.
  const items = sortItems(getFilteredItems());
  const { totalPages, pageRows } = paginateItems(state, items);
  renderPagination(state, totalPages, [els.pagination, els.paginationTop], () => {
    renderGrid();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  if (!items.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent =
      state.searchText.trim() || state.selectedStatuts.size || state.selectedCats.size
        ? "Aucun projet ne correspond à ces filtres."
        : "Aucun projet pour le moment.";
    els.grid.appendChild(p);
    updateCount(0);
    return;
  }

  els.grid.innerHTML = pageRows.map(renderCard).join("");

  els.grid.querySelectorAll(".projet-card").forEach((card) => {
    card.addEventListener("click", () => {
      const item = state.items.find((i) => i.id === card.dataset.id);
      if (item) openModal(item);
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        card.click();
      }
    });
  });
  updateCount(items.length);
}

function updateCount(n) {
  if (!els.count) return;
  els.count.textContent = n === 0 ? "aucun projet" : `${n} projet${n > 1 ? "s" : ""}`;
}

/* ---------- Modale détail (calque médiathèque) ---------- */
function openModal(item) {
  const statut = statutOf(item);

  els.modalStatut.className = `card-type modal-type statut-${statutSlug(statut)}`;
  els.modalStatut.textContent = statut;
  els.modalTitle.textContent = item.titre || "(sans titre)";

  // Ligne meta : porteur · période · lieu · ajouté le
  const segs = [];
  if (item.porteur) segs.push(item.porteur);
  const periode = formatPeriode(item);
  if (periode) segs.push(periode);
  if (item.lieu) segs.push(item.lieu);
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

  // Lien du projet : masqué si absent/non-http
  if (item.lien && /^https?:\/\//i.test(item.lien)) {
    els.modalSource.style.display = "";
    els.modalSource.href = item.lien;
  } else {
    els.modalSource.style.display = "none";
  }

  els.modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeModal() {
  els.modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

/* ---------- Menus Statut + Catégories (dropdowns communs) ---------- */
function buildStatutMenu() {
  const statuts = new Set();
  for (const it of state.items) statuts.add(statutOf(it));
  statutDD.fill(
    [...statuts].sort((a, b) => a.localeCompare(b, "fr")).map((s) => ({ value: s, label: s })),
    () => onFilterChange(statutDD)
  );
}

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
  renderGrid();
}

/* ---------- Chargement initial ---------- */
async function load() {
  let raw = [];
  try {
    const resp = await fetch(DATA_URL, { cache: "no-cache" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    raw = Array.isArray(data) ? data : data.items || [];
  } catch (err) {
    console.error("Erreur de chargement des projets :", err);
    if (els.grid) {
      els.grid.innerHTML = `<p class="empty">Impossible de charger les projets.</p>`;
    }
    return;
  }
  state.items = normalizeItems(raw);
  state.currentPage = 0;
  buildStatutMenu();
  buildCatMenu();
  renderGrid();
}

/* ---------- Écouteurs ---------- */
function attachListeners() {
  let searchTimer = null;
  els.search.addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.searchText = e.target.value;
      state.currentPage = 0; // tout filtre ramène à la page 1
      renderGrid();
    }, 150);
  });

  if (els.pageSizeSelect) {
    els.pageSizeSelect.addEventListener("change", (e) => {
      state.pageSize = e.target.value;
      state.currentPage = 0; // changement de taille de page → retour page 1
      renderGrid();
    });
  }

  if (els.sortSelect) {
    els.sortSelect.addEventListener("change", (e) => {
      state.sortMode = e.target.value;
      state.currentPage = 0;
      renderGrid();
    });
  }

  els.modal.querySelectorAll("[data-close]").forEach((el) => {
    el.addEventListener("click", closeModal);
  });
  // Échap : les dropdowns communs ferment les menus en premier ;
  // la modale ne se ferme que si aucun menu n'est ouvert.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (els.statutMenu.classList.contains("open")) return;
    if (els.catMenu.classList.contains("open")) return;
    if (els.modal.getAttribute("aria-hidden") === "false") closeModal();
  });
}

/* ---------- Contribution (esprit Datami) ----------
   Calque médiathèque, socle commun common/js/contribution.js :
   envoi silencieux au relais VPS → issue GitHub étiquetée
   « contribution » ; repli manuel si le relais échoue. Les champs
   suivent le mapping P3 de scripts/fetch_projets.py /
   valider_contribution.py (extra « Statut: … », citationKey P000N,
   date = début seul ou « début/fin » OPTION B). */
(function initContribution() {
  const GC = window.GrilleContribution;
  if (!GC) return;

  const f = {
    titre: () => document.getElementById("c-titre"),
    porteur: () => document.getElementById("c-porteur"),
    lieu: () => document.getElementById("c-lieu"),
    dateDebut: () => document.getElementById("c-date-debut"),
    dateFin: () => document.getElementById("c-date-fin"),
    statut: () => document.getElementById("c-statut"),
    description: () => document.getElementById("c-description"),
    url: () => document.getElementById("c-url"),
  };

  function closeDetailModal() {
    if (els.modal && els.modal.getAttribute("aria-hidden") === "false") {
      closeModal();
    }
  }

  function validate() {
    let ok = true;
    const titre = f.titre().value.trim();
    const porteur = f.porteur().value.trim();
    const debut = f.dateDebut().value.trim();
    const fin = f.dateFin().value.trim();
    const url = f.url().value.trim();

    if (!titre) {
      GC.setFieldError(f.titre(), "Le titre est nécessaire pour que l'équipe vérifie le projet.");
      ok = false;
    } else if (titre.length < 3) {
      GC.setFieldError(f.titre(), "Le titre paraît trop court — quelques mots suffisent.");
      ok = false;
    } else {
      GC.setFieldError(f.titre(), null);
    }

    if (!porteur) {
      GC.setFieldError(f.porteur(), "Le porteur (organisation) est nécessaire.");
      ok = false;
    } else {
      GC.setFieldError(f.porteur(), null);
    }

    if (!debut) {
      GC.setFieldError(f.dateDebut(), "La date de début est nécessaire.");
      ok = false;
    } else {
      GC.setFieldError(f.dateDebut(), null);
    }

    if (fin && debut && fin < debut) {
      GC.setFieldError(f.dateFin(), "La date de fin doit suivre la date de début.");
      ok = false;
    } else {
      GC.setFieldError(f.dateFin(), null);
    }

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
    app: "projets",
    firstFieldId: "c-titre",
    onOpen: closeDetailModal,
    titleOf: (d) => d.titre,
    collect: () => ({
      titre: f.titre().value.trim(),
      porteur: f.porteur().value.trim(),
      lieu: f.lieu().value.trim(),
      date_debut: f.dateDebut().value.trim(),
      date_fin: f.dateFin().value.trim(),
      statut: f.statut().value,
      description: f.description().value.trim(),
      url: f.url().value.trim(),
    }),
    validate,
    payload: (d) => d,
    table: (d) => [
      ["Titre", d.titre],
      ["Porteur", d.porteur],
      ["Lieu", d.lieu || "—"],
      ["Date de début", d.date_debut || "—"],
      ["Date de fin", d.date_fin || "—"],
      ["Statut", d.statut || "—"],
      ["Description", d.description || "—"],
      ["Lien", d.url || "—"],
    ],
    issueTexts: {
      heading: "Proposition de projet",
      intro:
        "Un·e visiteur de la grille Projets propose d'ajouter ce projet.",
      closing:
        "La validation crée l'item Zotero (collection « Projets », mapping P3 : " +
        "extra « Statut: … », citationKey P000N), ferme cette issue et le prochain " +
        "`deploy.sh` publie le projet.",
    },
  });
})();

/* ---------- Boot ---------- */
grabEls();
const statutDD = makeDropdown({
  dropdown: els.statutDropdown,
  toggle: els.statutToggle,
  pill: els.statutPill,
  menu: els.statutMenu,
  set: state.selectedStatuts,
  allLabel: "Tous les statuts",
  unitWord: "statuts",
  labelOf: (v) => v,
});
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
attachListeners();
document.addEventListener("DOMContentLoaded", load);
