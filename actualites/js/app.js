/* =========================================================
   Actualités Parlement de la rivière Isère — application
   Lit data/actualites.json (généré par scripts/fetch_actualites.py
   depuis Zotero, cf. K4 ; fixture = conversion du CSV historique),
   rend une grille de cartes avec pagination (socle commun
   GrillePagination), filtres multi-choix Année + Mois (dropdowns
   custom GrilleDropdown) et recherche floue (GrilleSearch).
   Zéro dépendance, zéro build.
   ========================================================= */
"use strict";

const DATA_URL = "data/actualites.json";

const { parseISO, formatDate } = window.GrilleDom;
const GS = window.GrilleSearch;
const { paginate: paginateItems, renderPagination } = window.GrillePagination;
const { makeDropdown } = window.GrilleDropdown;

/* ---------- Constantes ---------- */
const TYPES = {
  evenement_a_venir: { label: "Événement à venir", slug: "evenement-avenir" },
  ressource_publiee: { label: "Ressource publiée", slug: "ressource-publiee" },
  evenement_passe: { label: "Événement passé", slug: "evenement-passe" },
  information_parlement: { label: "Information du parlement", slug: "information-parlement" },
};

const MONTHS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

/* ---------- État ---------- */
const state = {
  items: [],
  searchText: "",
  selectedYears: new Set(), // années cochées (vide = toutes)
  selectedMonths: new Set(), // numéros de mois "01"-"12" cochés (vide = tous)
  pageSize: "9", // "9" | "18" | "36" | "all" (calque vitrine Zotero)
  currentPage: 0, // index 0-based
};

/* ---------- Références DOM ---------- */
const els = {
  grid: null,
  count: null,
  search: null,
  pagination: null,
  paginationTop: null,
  pageSizeSelect: null,
  yearDropdown: null,
  yearToggle: null,
  yearPill: null,
  yearMenu: null,
  monthDropdown: null,
  monthToggle: null,
  monthPill: null,
  monthMenu: null,
  monthPills: null,
};

function grabEls() {
  els.grid = document.getElementById("grid");
  els.count = document.getElementById("result-count");
  els.search = document.getElementById("search");
  els.pagination = document.getElementById("pagination");
  els.paginationTop = document.getElementById("pagination-top");
  els.pageSizeSelect = document.getElementById("page-size-select");
  els.yearDropdown = document.getElementById("year-dropdown");
  els.yearToggle = document.getElementById("year-toggle");
  els.yearPill = document.getElementById("year-pill");
  els.yearMenu = document.getElementById("year-menu");
  els.monthDropdown = document.getElementById("month-dropdown");
  els.monthToggle = document.getElementById("month-toggle");
  els.monthPill = document.getElementById("month-pill");
  els.monthMenu = document.getElementById("month-menu");
  els.monthPills = document.getElementById("month-pills");
}

/* ---------- Normalisation des items JSON ----------
   Contrat K4 : liste d'objets aux champs identiques au CSV
   (id, type, titre, description, date_debut, date_fin, lieu,
   lien, date_ajout, source_message_id). Les valeurs absentes
   peuvent être null (Zotero) → chaîne vide partout, comme
   l'ancien parse CSV. */
function normalizeItems(raw) {
  return raw.map((o) => ({
    id: String(o?.id ?? ""),
    type: String(o?.type ?? "").trim(),
    titre: String(o?.titre ?? ""),
    description: String(o?.description ?? ""),
    date_debut: String(o?.date_debut ?? "").trim(),
    date_fin: String(o?.date_fin ?? "").trim(),
    lieu: String(o?.lieu ?? ""),
    lien: String(o?.lien ?? "").trim(),
    date_ajout: String(o?.date_ajout ?? "").trim(),
    source_message_id: String(o?.source_message_id ?? ""),
  }));
}

/* ---------- Tri : événements à venir d'abord, puis par date ---------- */
function sortItems(items) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ts = (a) => parseISO(a.date_debut || a.date_ajout || "");

  return items.slice().sort((a, b) => {
    const ta = ts(a) || today;
    const tb = ts(b) || today;
    const aUpcoming = a.type === "evenement_a_venir" && (ta ? ta >= today : false);
    const bUpcoming = b.type === "evenement_a_venir" && (tb ? tb >= today : false);
    // Événements à venir (proches en premier), puis le reste par date desc.
    if (aUpcoming && bUpcoming) return ta - tb;
    if (aUpcoming) return -1;
    if (bUpcoming) return 1;
    return tb - ta;
  });
}

function formatDates(item) {
  const de = (item.date_debut || "").trim();
  const fi = (item.date_fin || "").trim();
  if (de && fi && de !== fi) return `Du ${formatDate(de)} au ${formatDate(fi)}`;
  if (de) return `Le ${formatDate(de)}`;
  return "";
}

/* ---------- Index de recherche (haystack actus) ----------
   Titre + description + lieu + libellé du type (les dates
   restent dans le filtre mois, pas la recherche). */
const getSearchIndex = GS.makeSearchCache(
  (item) => item.id,
  (item) =>
    [item.titre, item.description, item.lieu, TYPES[item.type]?.label || item.type || ""].join(" ")
);

/* ---------- Rendu d'une carte ---------- */
function renderCard(item) {
  const type = TYPES[item.type] || { label: item.type || "Actualité", slug: "autre" };
  const card = document.createElement("article");
  card.className = "card";

  const badge = document.createElement("span");
  badge.className = `card-type type-${type.slug}`;
  badge.textContent = type.label;
  card.appendChild(badge);

  const title = document.createElement("h2");
  title.className = "card-title";
  title.textContent = item.titre || "(sans titre)";
  card.appendChild(title);

  const desc = document.createElement("p");
  desc.className = "card-description";
  desc.textContent = item.description || "";
  card.appendChild(desc);

  const meta = document.createElement("p");
  meta.className = "card-meta";
  const segs = [];
  const d = formatDates(item);
  if (d) segs.push(d);
  if (item.lieu) segs.push(item.lieu);
  meta.textContent = segs.join(" · ");
  if (segs.length) card.appendChild(meta);

  if (item.lien && /^https?:\/\//i.test(item.lien)) {
    const linkWrap = document.createElement("p");
    linkWrap.className = "card-link";
    const a = document.createElement("a");
    a.href = item.lien;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "En savoir plus";
    linkWrap.appendChild(a);
    card.appendChild(linkWrap);
  }

  return card;
}

/* ---------- Mois / années couverts par une actualité ----------
   Une actualité appartient à tous les mois couverts par sa
   période (date_debut → date_fin, ou date_debut/date_ajout
   seul si pas de fin) : une exposition de juillet à novembre
   apparaît dans chacun de ces mois. */
function itemMonths(item) {
  const de = parseISO(item.date_debut || item.date_ajout || "");
  const fi = parseISO(item.date_fin || item.date_debut || item.date_ajout || "");
  const months = [];
  if (!de || !fi) return months;
  let cur = new Date(de.getFullYear(), de.getMonth(), 1);
  const end = new Date(fi.getFullYear(), fi.getMonth(), 1);
  // Garde-fou : 24 mois max par item (données corrompues → pas de boucle folle)
  while (cur <= end && months.length < 24) {
    months.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`);
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return months;
}

function itemYears(item) {
  const years = new Set();
  for (const m of itemMonths(item)) years.add(m.slice(0, 4));
  return years;
}

/* ---------- Filtrage combiné (recherche ∧ année ∧ mois) ---------- */
function getFilteredItems() {
  const qNorm = GS.searchNormalize(state.searchText.trim());
  const qWords = qNorm ? qNorm.split(/[^a-z0-9]+/).filter((w) => w.length >= 2) : [];

  return state.items.filter((it) => {
    if (qNorm && !GS.matchesQuery(getSearchIndex(it), qNorm, qWords)) return false;
    if (state.selectedYears.size > 0 && !hasIntersection(itemYears(it), state.selectedYears)) {
      return false;
    }
    if (state.selectedMonths.size > 0) {
      // Mois génériques "01"-"12" : l'année est portée par le filtre Année.
      const months = new Set(itemMonths(it).map((k) => k.slice(5)));
      if (!hasIntersection(months, state.selectedMonths)) return false;
    }
    return true;
  });
}

function hasIntersection(a, b) {
  for (const v of a) if (b.has(v)) return true;
  return false;
}

function monthLabel(num) {
  // Numéro "01"-"12" → nom du mois seul (l'année vit dans le filtre Année).
  return MONTHS_FR[Number(num) - 1];
}

/* ---------- Remplissage des menus (dropdowns communs) ---------- */
function buildFilterMenus() {
  // Années distinctes couvertes, triées desc.
  const years = new Set();
  for (const it of state.items) for (const y of itemYears(it)) years.add(y);
  yearDD.fill(
    [...years].sort((a, b) => b.localeCompare(a)).map((y) => ({ value: y, label: y })),
    () => onFilterChange(yearDD)
  );

  // Mois distincts couverts (numéro générique "01"-"12", sans année),
  // dans l'ordre chronologique du calendrier — pas par récence.
  const keys = new Set();
  for (const it of state.items) for (const m of itemMonths(it)) keys.add(m.slice(5));
  monthDD.fill(
    [...keys].sort((a, b) => a.localeCompare(b)).map((k) => ({ value: k, label: monthLabel(k) })),
    () => onFilterChange(monthDD)
  );
}

// Tout changement de filtre (dropdown) : retour page 1 + re-rendu.
function onFilterChange(dd) {
  state.currentPage = 0; // tout filtre ramène à la page 1 (calque vitrine)
  dd.syncUI();
  renderGrid();
}

/* ---------- Filtres cochés par défaut (CEO 11/10/26) ----------
   À l'ouverture : année en cours + mois en cours et mois à venir
   cochés — la page démarre sur l'actualité du moment, l'archive
   reste accessible en décochant. En décembre, le mois à venir
   est janvier de l'année suivante : on coche aussi l'année
   suivante, sinon les items du mois à venir seraient filtrés.
   `now` est paramétrable pour tester le passage d'année. */
function applyDefaultFilters(now = new Date()) {
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const nextMonth = now.getMonth() === 11 ? "01" : String(now.getMonth() + 2).padStart(2, "0");
  state.selectedYears.add(year);
  state.selectedMonths.add(month);
  state.selectedMonths.add(nextMonth);
  if (nextMonth === "01") state.selectedYears.add(String(now.getFullYear() + 1));
}

/* ---------- Pastilles des mois sélectionnés (CEO 11/10/26) ----------
   Une pastille par mois coché, à droite du filtre Mois ; la croix
   retire le mois (menu, pill du filtre et grille resynchronisés).
   Appelée à chaque renderGrid : aucun chemin de changement ne peut
   désynchroniser les pastilles du menu. */
function renderMonthPills() {
  if (!els.monthPills) return;
  els.monthPills.innerHTML = "";

  const months = [...state.selectedMonths].sort((a, b) => a.localeCompare(b));
  for (const m of months) {
    const pill = document.createElement("span");
    pill.className = "filter-pill";

    const label = document.createElement("span");
    label.textContent = monthLabel(m);
    pill.appendChild(label);

    const x = document.createElement("button");
    x.type = "button";
    x.className = "filter-pill-x";
    x.setAttribute("aria-label", "Retirer le filtre " + monthLabel(m));
    x.textContent = "×";
    x.addEventListener("click", () => {
      state.selectedMonths.delete(m);
      state.currentPage = 0; // tout changement de filtre ramène à la page 1
      monthDD.syncUI();
      renderGrid();
    });
    pill.appendChild(x);

    els.monthPills.appendChild(pill);
  }
}

/* ---------- Rendu de la page courante ---------- */
function renderGrid() {
  if (!els.grid) return;
  els.grid.innerHTML = "";
  renderMonthPills();

  const items = getFilteredItems();
  const { totalPages, pageRows } = paginateItems(state, items);
  renderPagination(state, totalPages, [els.pagination, els.paginationTop], () => {
    renderGrid();
    scrollToTop();
  });

  if (!items.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent =
      state.searchText.trim() || state.selectedYears.size || state.selectedMonths.size
        ? "Aucune actualité ne correspond à ces filtres."
        : "Aucune actualité pour le moment.";
    els.grid.appendChild(p);
    updateCount(0);
    return;
  }

  for (const item of pageRows) {
    els.grid.appendChild(renderCard(item));
  }
  updateCount(items.length);
}

function updateCount(n) {
  if (!els.count) return;
  els.count.textContent = n === 0 ? "aucune actualité" : `${n} actualité${n > 1 ? "s" : ""}`;
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- Chargement initial ---------- */
async function load() {
  try {
    const resp = await fetch(DATA_URL, { cache: "no-cache" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    // Contrat K4 : liste d'objets. Tolérance défensive à une
    // enveloppe { items: [...] } sans changement de comportement.
    const raw = Array.isArray(data) ? data : data.items || [];
    state.items = sortItems(normalizeItems(raw));
  } catch (err) {
    console.error("Erreur de chargement des actualités :", err);
    if (els.grid) {
      els.grid.innerHTML = "";
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "Impossible de charger les actualités.";
      els.grid.appendChild(p);
    }
    return;
  }
  state.currentPage = 0;
  applyDefaultFilters(); // année en cours + mois en cours/à venir cochés (CEO 11/10/26)
  buildFilterMenus();
  renderGrid();
}

/* ---------- Écouteurs ---------- */
function attachListeners() {
  let searchTimer = null;
  els.search.addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.searchText = e.target.value;
      state.currentPage = 0; // tout filtre ramène à la page 1 (calque vitrine)
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
}

/* ---------- Boot ---------- */
grabEls();
const yearDD = makeDropdown({
  dropdown: els.yearDropdown,
  toggle: els.yearToggle,
  pill: els.yearPill,
  menu: els.yearMenu,
  set: state.selectedYears,
  allLabel: "Toutes les années",
  unitWord: "années",
  labelOf: (v) => v,
});
const monthDD = makeDropdown({
  dropdown: els.monthDropdown,
  toggle: els.monthToggle,
  pill: els.monthPill,
  menu: els.monthMenu,
  set: state.selectedMonths,
  allLabel: "Tous les mois",
  unitWord: "mois",
  labelOf: monthLabel,
});
attachListeners();
document.addEventListener("DOMContentLoaded", load);
