/* =========================================================
   Actualités Parlement de la rivière Isère — application
   Lit data/actualites.json (généré par scripts/fetch_actualites.py
   depuis Zotero, cf. K4 ; fixture = conversion du CSV historique),
   rend une grille de cartes avec pagination (socle commun
   GrillePagination), filtres multi-choix Année + Mois + Type
   (dropdowns custom GrilleDropdown) et recherche floue
   (GrilleSearch). Zéro dépendance, zéro build.
   ========================================================= */
"use strict";

const DATA_URL = "data/actualites.json";

const { parseISO, formatDate } = window.GrilleDom;
const GS = window.GrilleSearch;
const { paginate: paginateItems, renderPagination } = window.GrillePagination;
const { makeDropdown } = window.GrilleDropdown;

/* ---------- Constantes ---------- */
/* Contrat des types (CEO 12/10/26) : ce sont les DATES qui font foi,
   plus de distinction à venir/passé dans le type. evenement_a_venir
   et evenement_passe fusionnent en evenement ; ressource_publiee
   devient media_publie (renvoi vers la Médiathèque) ;
   information_parlement devient information ; NOUVEAU outil_publie
   (même logique, vers l'Outilthèque). */
const TYPES = {
  evenement: { label: "Événement", slug: "evenement" },
  media_publie: { label: "Média publié", slug: "media-publie" },
  outil_publie: { label: "Outil publié", slug: "outil-publie" },
  information: { label: "Information", slug: "information" },
};

/* Libellé du lien des cartes selon le type (CEO 12/10/26) :
   médias → Médiathèque, outils → Outilthèque, le reste inchangé. */
const LINK_LABELS = {
  media_publie: "Voir le média",
  outil_publie: "Voir l'outil",
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
  selectedMonths: new Set(), // numéros de mois "01"-""12" cochés (vide = tous)
  selectedTypes: new Set(), // types d'actualité cochés (vide = tous)
  pageSize: "12", // fixe 12 (CEO 12/10/26 soir : filtre « Afficher » retiré)
  currentPage: 0, // index 0-based
};

/* ---------- Références DOM ---------- */
const els = {
  grid: null,
  count: null,
  search: null,
  pagination: null,
  paginationTop: null,
  yearDropdown: null,
  yearToggle: null,
  yearPill: null,
  yearMenu: null,
  monthDropdown: null,
  monthToggle: null,
  monthPill: null,
  monthMenu: null,
  monthPills: null,
  pillsRow: null,
  resetBtn: null,
  typeDropdown: null,
  typeToggle: null,
  typePill: null,
  typeMenu: null,
  typePills: null,
};

function grabEls() {
  els.grid = document.getElementById("grid");
  els.count = document.getElementById("result-count");
  els.search = document.getElementById("search");
  els.pagination = document.getElementById("pagination");
  els.paginationTop = document.getElementById("pagination-top");
  els.yearDropdown = document.getElementById("year-dropdown");
  els.yearToggle = document.getElementById("year-toggle");
  els.yearPill = document.getElementById("year-pill");
  els.yearMenu = document.getElementById("year-menu");
  els.yearPills = document.getElementById("year-pills");
  els.monthDropdown = document.getElementById("month-dropdown");
  els.monthToggle = document.getElementById("month-toggle");
  els.monthPill = document.getElementById("month-pill");
  els.monthMenu = document.getElementById("month-menu");
  els.monthPills = document.getElementById("month-pills");
  els.pillsRow = document.getElementById("pills-row");
  els.resetBtn = document.getElementById("reset-btn");
  els.typeDropdown = document.getElementById("type-dropdown");
  els.typeToggle = document.getElementById("type-toggle");
  els.typePill = document.getElementById("type-pill");
  els.typeMenu = document.getElementById("type-menu");
  els.typePills = document.getElementById("type-pills");
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

/* ---------- Tri : EN COURS → À VENIR → PASSÉ (CEO 12/10/26) ----------
   Un enregistrement EN COURS (début passé, fin non atteinte) doit
   apparaître en premier — ex. l'arrêté sécheresse en tête de grille.
   - EN COURS (0) : période commencée et non terminée (date_debut ≤
     aujourd'hui ET fin effective non passée). Fin effective =
     date_fin, sinon (type evenement sans fin) date_debut. Un item
     sans aucune date reste dans ce compartiment (une information ou
     une ressource sans fin reste d'actualité). Ordre interne : fin
     effective croissante (échéance la plus proche d'abord), items
     sans fin EN DERNIER, puis date_debut croissante, puis id.
   - À VENIR (1) : date_debut > aujourd'hui. Ordre : date_debut
     croissante, puis id croissant.
   - PASSÉ (2) : fin effective < aujourd'hui. Ordre : plus récent
     d'abord (fin effective décroissante, puis date_debut
     décroissante, puis id décroissant). */
function todayMidnight() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// Fin effective d'une actualité (null = pas de fin, reste d'actualité).
function effectiveEnd(item) {
  const fi = (item.date_fin || "").trim();
  if (fi) return parseISO(fi);
  // Un événement sans date_fin se termine le jour de sa date_debut.
  if (item.type.startsWith("evenement")) return parseISO(item.date_debut || "");
  return null;
}

function sortItems(items) {
  const today = todayMidnight();
  const de = (it) => parseISO(it.date_debut || "");
  const fi = (it) => effectiveEnd(it);

  // 0 = EN COURS, 1 = À VENIR, 2 = PASSÉ.
  function compartment(it) {
    const start = de(it);
    if (start && start > today) return 1;
    const end = fi(it);
    if (end && end < today) return 2;
    return 0;
  }

  const idAsc = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  return items.slice().sort((a, b) => {
    const ca = compartment(a);
    const cb = compartment(b);
    if (ca !== cb) return ca - cb;

    if (ca === 1) {
      // À VENIR : date_debut croissante (sans date en dernier), puis id.
      const da = de(a);
      const db = de(b);
      if (da && db && da !== db) return da - db;
      if (!!da !== !!db) return da ? -1 : 1;
      return idAsc(a, b);
    }

    if (ca === 2) {
      // PASSÉ : plus récent d'abord — fin effective décroissante,
      // puis date_debut décroissante, puis id décroissant.
      const fa = fi(a);
      const fb = fi(b);
      if (fa && fb && fa !== fb) return fb - fa;
      const da = de(a);
      const db = de(b);
      if (da && db && da !== db) return db - da;
      return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
    }

    // EN COURS : fin effective croissante, items sans fin EN DERNIER,
    // puis date_debut croissante, puis id croissant.
    const fa = fi(a);
    const fb = fi(b);
    if (!!fa !== !!fb) return fa ? -1 : 1;
    if (fa && fb && fa !== fb) return fa - fb;
    const da = de(a);
    const db = de(b);
    if (da && db && da !== db) return da - db;
    if (!!da !== !!db) return da ? -1 : 1;
    return idAsc(a, b);
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
    // Libellé du lien selon le type (CEO 12/10/26) : médias →
    // « Voir le média », outils → « Voir l'outil », sinon inchangé.
    a.textContent = LINK_LABELS[item.type] || "En savoir plus";
    linkWrap.appendChild(a);
    card.appendChild(linkWrap);
  }

  // Pastille rouge « Passé(e) » en bas à droite (période terminée) — CEO 12/10/26
  if (isPastItem(item)) {
    const past = document.createElement("span");
    past.className = "card-passe";
    past.textContent = "Passé(e)";
    card.appendChild(past);
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

/* ---------- Filtrage combiné (recherche ∧ année ∧ mois ∧ type) ---------- */
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
    // Intersection stricte : un item n'a qu'un type.
    if (state.selectedTypes.size > 0 && !state.selectedTypes.has(it.type)) return false;
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

  // Les 4 types canoniques, TOUJOURS dans l'ordre de TYPES — même
  // « Outil publié » qui a 0 item aujourd'hui (le CEO veut que le
  // type existe visuellement).
  typeDD.fill(
    Object.keys(TYPES).map((k) => ({ value: k, label: TYPES[k].label })),
    () => onFilterChange(typeDD)
  );
}

// Tout changement de filtre (dropdown) : retour page 1 + re-rendu.
function onFilterChange(dd) {
  state.currentPage = 0; // tout filtre ramène à la page 1 (calque vitrine)
  dd.syncUI();
  renderGrid();
}

/* ---------- Actualité « passée » (CEO 12/10/26) ----------
   Période terminée → pastille rouge « Passé(e) » en bas à droite.
   - Avec date_fin : pastille dès que date_fin < aujourd'hui
     (couvre l'événement d'un jour, où date_fin = date_debut).
   - Sans date_fin : seuls les types « événement » peuvent être
     passés (l'événement d'une date passée est terminé) ; une
     ressource ou une information sans fin reste d'actualité
     (ex. programme en cours) — pas de pastille. */
function isPastItem(item) {
  const fi = (item.date_fin || "").trim();
  const end = parseISO(fi || (item.type.startsWith("evenement") ? item.date_debut : "") || "");
  if (!end) return false;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return end < today;
}

/* ---------- Pastilles des années sélectionnées (CEO 12/10/26 soir) ----------
   Calque strict de renderMonthPills : une pastille par année cochée,
   croix × pour la retirer, synchronisée à CHAQUE renderGrid. L'ordre
   suit celui du menu (desc, cf. buildFilterMenus). */
function renderYearPills() {
  if (!els.yearPills) return;
  els.yearPills.innerHTML = "";

  // Ligne entière + libellé « Année : » uniquement si sélection
  // (CEO 12/10/26 soir) : vide, le conteneur est masqué par le
  // socle commun (.filter-pills:empty → display:none).
  const years = [...state.selectedYears].sort((a, b) => b.localeCompare(a));
  if (!years.length) return;

  const caption = document.createElement("span");
  caption.className = "pills-label";
  caption.textContent = "Année :";
  els.yearPills.appendChild(caption);

  for (const y of years) {
    const pill = document.createElement("span");
    pill.className = "filter-pill";

    const label = document.createElement("span");
    label.textContent = y;
    pill.appendChild(label);

    const x = document.createElement("button");
    x.type = "button";
    x.className = "filter-pill-x";
    x.setAttribute("aria-label", "Retirer le filtre " + y);
    x.textContent = "×";
    x.addEventListener("click", () => {
      state.selectedYears.delete(y);
      state.currentPage = 0; // tout changement de filtre ramène à la page 1
      yearDD.syncUI();
      renderGrid();
    });
    pill.appendChild(x);

    els.yearPills.appendChild(pill);
  }
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
  // Ligne entière + libellé « Mois : » uniquement si sélection
  // (CEO 12/10/26 soir) : vide, le conteneur est masqué par le
  // socle commun (.filter-pills:empty → display:none).
  if (!months.length) return;

  const caption = document.createElement("span");
  caption.className = "pills-label";
  caption.textContent = "Mois :";
  els.monthPills.appendChild(caption);

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

/* ---------- Pastilles des types sélectionnés (CEO 12/10/26) ----------
   Calque strict de renderMonthPills : une pastille par type coché,
   croix × pour le retirer, synchronisée à CHAQUE renderGrid (les
   deux sens : pastille → menu, menu → pastille). L'ordre suit
   l'ordre canonique de TYPES, comme le menu. */
function renderTypePills() {
  if (!els.typePills) return;
  els.typePills.innerHTML = "";

  // Ligne entière + libellé « Type : » uniquement si sélection
  // (CEO 12/10/26 soir) : vide, le conteneur est masqué par le
  // socle commun (.filter-pills:empty → display:none).
  const selected = Object.keys(TYPES).filter((k) => state.selectedTypes.has(k));
  if (!selected.length) return;

  const caption = document.createElement("span");
  caption.className = "pills-label";
  caption.textContent = "Type :";
  els.typePills.appendChild(caption);

  for (const key of selected) {
    const pill = document.createElement("span");
    pill.className = "filter-pill";

    const label = document.createElement("span");
    label.textContent = TYPES[key].label;
    pill.appendChild(label);

    const x = document.createElement("button");
    x.type = "button";
    x.className = "filter-pill-x";
    x.setAttribute("aria-label", "Retirer le filtre " + TYPES[key].label);
    x.textContent = "×";
    x.addEventListener("click", () => {
      state.selectedTypes.delete(key);
      state.currentPage = 0; // tout changement de filtre ramène à la page 1
      typeDD.syncUI();
      renderGrid();
    });
    pill.appendChild(x);

    els.typePills.appendChild(pill);
  }
}

/* ---------- Ligne commune des pastilles (CEO 12/10/26 soir) ----------
   Les pastilles Année/Mois/Type partagent UNE ligne (#pills-row).
   Elle n'existe que si au moins un filtre est actif — le socle ne
   masque plus les groupes (display:contents les expose tous), c'est
   ce contrôle qui tient la visibilité de la ligne entière. */
function syncPillsRow() {
  if (!els.pillsRow) return;
  const active =
    state.selectedYears.size > 0 ||
    state.selectedMonths.size > 0 ||
    state.selectedTypes.size > 0;
  els.pillsRow.hidden = !active;
}

/* ---------- Rendu de la page courante ---------- */
function renderGrid() {
  if (!els.grid) return;
  els.grid.innerHTML = "";
  renderYearPills();
  renderMonthPills();
  renderTypePills();
  syncPillsRow();

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
      state.searchText.trim() || state.selectedYears.size || state.selectedMonths.size ||
        state.selectedTypes.size
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
  // AUCUN filtre coché par défaut (CEO 12/10/26, inverse la règle du
  // 11/10) : les actualités passées sont TOUJOURS affichées ; les
  // filtres Année/Mois/Type suffisent pour naviguer, et la pastille
  // rouge « Passé(e) » marque les périodes terminées.
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

  // Filtre « Afficher » retiré (CEO 12/10/26 soir) : pageSize fixe 12.

  // « Réinitialiser » (CEO 12/10/26 soir) : décoche Année/Mois/Type,
  // vide la recherche, retour page 1. Même chemin qu'un changement
  // de filtre : les trois dropdowns resynchronisent leur UI.
  if (els.resetBtn) {
    els.resetBtn.addEventListener("click", () => {
      state.selectedYears.clear();
      state.selectedMonths.clear();
      state.selectedTypes.clear();
      state.searchText = "";
      if (els.search) els.search.value = "";
      state.currentPage = 0; // retour page 1
      yearDD.syncUI();
      monthDD.syncUI();
      typeDD.syncUI();
      renderGrid();
    });
  }
}

/* ---------- Contribution (esprit Datami) ----------
   Calque médiathèque, socle commun common/js/contribution.js :
   envoi silencieux au relais VPS → issue GitHub étiquetée
   « contribution » ; repli manuel si le relais échoue. Les champs
   (titre, type fermé, dates, lieu, lien, résumé) suivent le contrat
   de scripts/fetch_actualites.py / valider_contribution.py
   (labels extra ANGLAIS sans accents). */
(function initContribution() {
  const GC = window.GrilleContribution;
  if (!GC) return;

  const f = {
    titre: () => document.getElementById("c-titre"),
    type: () => document.getElementById("c-type"),
    date: () => document.getElementById("c-date"),
    dateFin: () => document.getElementById("c-date-fin"),
    lieu: () => document.getElementById("c-lieu"),
    url: () => document.getElementById("c-url"),
    description: () => document.getElementById("c-description"),
  };

  // Calque de l'existant : sans accents (contrat valider_contribution.py).
  const TYPE_LABELS = {
    evenement: "Evenement",
    media_publie: "Media publie",
    outil_publie: "Outil publie",
    information: "Information",
  };

  function validate() {
    let ok = true;
    const titre = f.titre().value.trim();
    const url = f.url().value.trim();
    const date = f.date().value.trim();

    if (!titre) {
      GC.setFieldError(f.titre(), "Le titre est nécessaire pour que l'équipe vérifie l'actualité.");
      ok = false;
    } else if (titre.length < 3) {
      GC.setFieldError(f.titre(), "Le titre paraît trop court — quelques mots suffisent.");
      ok = false;
    } else {
      GC.setFieldError(f.titre(), null);
    }

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

    if (!date) {
      GC.setFieldError(f.date(), "La date est nécessaire (jour de début de l'actualité).");
      ok = false;
    } else {
      GC.setFieldError(f.date(), null);
    }

    const df = f.dateFin().value.trim();
    if (df && date && df < date) {
      GC.setFieldError(f.dateFin(), "La date de fin doit suivre la date de début.");
      ok = false;
    } else {
      GC.setFieldError(f.dateFin(), null);
    }

    return ok;
  }

  GC.init({
    app: "actualites",
    firstFieldId: "c-titre",
    titleOf: (d) => d.titre,
    collect: () => ({
      titre: f.titre().value.trim(),
      type: f.type().value,
      date: f.date().value.trim(),
      date_fin: f.dateFin().value.trim(),
      lieu: f.lieu().value.trim(),
      lien: f.url().value.trim(),
      description: f.description().value.trim(),
    }),
    validate,
    payload: (d) => ({
      titre: d.titre,
      type: d.type,
      date_debut: d.date,
      date_fin: d.date_fin,
      lieu: d.lieu,
      lien: d.lien,
      description: d.description,
    }),
    table: (d) => [
      ["Titre", d.titre],
      ["Type", TYPE_LABELS[d.type] || d.type],
      ["Date", d.date + (d.date_fin ? ` → ${d.date_fin}` : "")],
      ["Lieu", d.lieu || "—"],
      ["Lien", d.lien],
      ["Résumé", d.description || "—"],
    ],
    issueTexts: {
      heading: "Proposition d'actualité",
      intro:
        "Un·e visiteur de la grille Actualités propose d'ajouter cette actualité.",
      closing:
        "La validation crée l'item Zotero (collection « Actualités », citationKey A000N), " +
        "ferme cette issue et le prochain `deploy.sh` publie l'actualité.",
    },
  });
})();

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
const typeDD = makeDropdown({
  dropdown: els.typeDropdown,
  toggle: els.typeToggle,
  pill: els.typePill,
  menu: els.typeMenu,
  set: state.selectedTypes,
  allLabel: "Tous les types",
  unitWord: "types",
  labelOf: (v) => TYPES[v]?.label || v,
});
attachListeners();
document.addEventListener("DOMContentLoaded", load);
