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
   (même logique, vers l'Outilthèque).
   Lot 3 (agrégation) : 6 types pour les fiches des autres apps —
   contact, projet, organisation, lieu, question, idee (médiathèque
   et outilthèque agrégées arrivent en media_publie / outil_publie). */
const TYPES = {
  evenement: { label: "Événement", slug: "evenement" },
  media_publie: { label: "Média publié", slug: "media-publie" },
  outil_publie: { label: "Outil publié", slug: "outil-publie" },
  information: { label: "Information", slug: "information" },
  contact: { label: "Contact", slug: "contact" },
  projet: { label: "Projet", slug: "projet" },
  organisation: { label: "Organisation", slug: "organisation" },
  lieu: { label: "Lieu", slug: "lieu" },
  question: { label: "Question", slug: "question" },
  idee: { label: "Idée", slug: "idee" },
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

/* ---------- Normalisation des items JSON ---------- */
/* Contrat K4 : liste d'objets aux champs identiques au CSV
   (id, type, titre, description, date_debut, date_fin, lieu,
   lien, date_ajout, source_message_id) + 3 champs additifs du lot 3
   (agrégation) : zotero_key, date_modif, source_app — une fiche
   native les a vides, une fiche externe porte l'app d'origine.
   Les valeurs absentes peuvent être null (Zotero) → chaîne vide
   partout, comme l'ancien parse CSV. */
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
    zotero_key: String(o?.zotero_key ?? ""),
    date_modif: String(o?.date_modif ?? "").trim(),
    source_app: String(o?.source_app ?? "").trim(),
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

  // Horizon = date d'ajout OU de modification, la plus récente des
  // deux (règle CEO pour les fiches des autres apps : la nouveauté
  // d'abord). null si aucune des deux dates n'est présente.
  function itemHorizon(it) {
    const dm = parseISO(it.date_modif || "");
    const da = parseISO(it.date_ajout || "");
    if (dm && da) return dm > da ? dm : da;
    return dm || da;
  }

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
    // Lot 3 (agrégation) : le tie-break FINAL devient horizon
    // décroissant puis id décroissant — c'est lui qui départage les
    // fiches sans date_debut ni fin (toutes les externes + les
    // natives « information » sans dates) : la nouveauté d'abord
    // (règle CEO). Les compartiments À VENIR et PASSÉ ne changent pas.
    const fa = fi(a);
    const fb = fi(b);
    if (!!fa !== !!fb) return fa ? -1 : 1;
    if (fa && fb && fa !== fb) return fa - fb;
    const da = de(a);
    const db = de(b);
    if (da && db && da !== db) return da - db;
    if (!!da !== !!db) return da ? -1 : 1;
    const ha = itemHorizon(a);
    const hb = itemHorizon(b);
    if (!!ha !== !!hb) return ha ? -1 : 1;
    if (ha && hb && ha !== hb) return hb - ha;
    return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
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
  // Fiches des autres apps (lot 3) : premier segment de la ligne meta,
  // « Ajouté le … » — ou « Mis à jour le … » si la date_modif est PLUS
  // RÉCENTE que la date d'ajout (la plus fraîche des deux gagne).
  // NON-RÉGRESSION : une fiche native (source_app vide) n'affiche
  // JAMAIS ce segment — cartes natives au pixel près identiques.
  if (item.source_app) {
    const da = (item.date_ajout || "").trim();
    const dm = (item.date_modif || "").trim();
    if (dm && (!da || dm > da)) {
      segs.push(`Mis à jour le ${formatDate(dm)}`);
    } else if (da) {
      segs.push(`Ajouté le ${formatDate(da)}`);
    } // aucune date → pas de segment (fallback silencieux)
  }
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

/* ---------- Ligne commune des pastilles + bouton Réinitialiser (CEO 12/10/26 soir) ----------
   Les pastilles Année/Mois/Type partagent UNE ligne (#pills-row) et
   le bouton « Réinitialiser » vit à droite des filtres. L'un comme
   l'autre n'existent QUE si au moins un filtre est actif (CEO
   12/10/26 soir) — police normale et aucun bouton quand rien n'est
   sélectionné. Appelée à CHAQUE renderGrid : aucun chemin de
   changement ne peut désynchroniser l'état. */
function syncFilterUI() {
  const active =
    state.selectedYears.size > 0 ||
    state.selectedMonths.size > 0 ||
    state.selectedTypes.size > 0;
  if (els.pillsRow) els.pillsRow.hidden = !active;
  if (els.resetBtn) els.resetBtn.hidden = !active;
}

/* ---------- Rendu de la page courante ---------- */
function renderGrid() {
  if (!els.grid) return;
  els.grid.innerHTML = "";
  renderYearPills();
  renderMonthPills();
  renderTypePills();
  syncFilterUI();

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
   Modale en 2 étapes (CEO 12/10/26) :
   1) choix du type d'actualité — 10 types depuis le lot 4 (CEO
      12/10/26 soir) : evenement / media_publie / outil_publie /
      information + contact / projet / organisation / lieu /
      question / idee ;
   2) formulaire selon le type — événement et information partagent le
      formulaire propre à Actualités (dates, lieu, lien, résumé) ;
      média publié et outil publié affichent les calques des
      formulaires Médiathèque / Outilthèque (common/js/
      contribution-forms.js — une seule forme dans le DOM à la fois,
      aucune collision d'ids) ; les 6 types agrégés affichent les
      calques des apps sources (même socle, ids préfixés c-a-<type>-).

   Derrière, le socle commun contribution.js (envoi silencieux au
   relais VPS → issue GitHub, repli manuel). Le type choisi part dans
   le payload (« type ») : c'est LUI qui décide de la forme des champs
   attendus par le relais et du traitement Zotero à la validation
   (item unique membre des collections Actualités + collection du
   type — décision CEO 12/10/26 « un seul et même enregistrement »). */
(function initContribution() {
  const GC = window.GrilleContribution;
  const GF = window.GrilleForms;
  if (!GC || !GF) return;

  const els2 = {
    step: () => document.getElementById("c-type-step"),
    form: () => document.getElementById("contribute-form"),
    back: () => document.getElementById("c-back-btn"),
    badge: () => document.getElementById("c-type-badge"),
    actu: () => document.getElementById("c-form-actu"),
    media: () => document.getElementById("c-form-media"),
    outil: () => document.getElementById("c-form-outil"),
    choices: () => document.querySelectorAll("#c-type-choices .c-type-choice"),
  };

  // Lot 4 : les 6 types agrégés calquent les apps sources. Un variant
  // par type, injecté à la demande dans son conteneur dédié.
  const AGGREGATE_TYPES = ["contact", "projet", "organisation", "lieu", "question", "idee"];
  const elsAgg = {};
  for (const t of AGGREGATE_TYPES) {
    elsAgg[t] = () => document.getElementById(`c-form-${t}`);
  }

  // Type d'actualité choisi à l'étape 1 (null = étape 1 affichée).
  let currentType = null;

  const TYPE_LABELS = {
    evenement: "Événement",
    media_publie: "Média publié",
    outil_publie: "Outil publié",
    information: "Information",
    contact: "Contact",
    projet: "Projet",
    organisation: "Organisation",
    lieu: "Lieu",
    question: "Question",
    idee: "Idée",
  };

  // ---------- Étape 1 : choix du type ----------
  function showStep1() {
    currentType = null;
    els2.step().hidden = false;
    els2.form().hidden = true;
    GC.setFieldError(document.getElementById("c-titre"), null);
  }

  function showStep2(type) {
    currentType = type;
    // PIÈGE ids partagés : les calques média/outil réutilisent les ids
    // des apps d'origine (c-url, c-lieu…) — si les DEUX variants étaient
    // injectés, getElementById lirait toujours le premier du DOM (celui
    // du média), pas le champ affiché. On purge donc le variant non
    // choisi : un SEUL formulaire mutualisé existe dans le DOM à la
    // fois, ses ids sont uniques.
    if (type === "media_publie") {
      els2.outil().innerHTML = "";
      delete els2.outil().dataset.injected;
      if (!els2.media().dataset.injected) {
        els2.media().innerHTML = GF.media.html();
        els2.media().dataset.injected = "1";
      }
    } else if (type === "outil_publie") {
      els2.media().innerHTML = "";
      delete els2.media().dataset.injected;
      if (!els2.outil().dataset.injected) {
        els2.outil().innerHTML = GF.outil.html();
        els2.outil().dataset.injected = "1";
      }
    } else if (GF[type]) {
      // Lot 4 : types agrégés (contact, projet, organisation, lieu,
      // question, idée). Les ids du calque sont préfixés c-a-<type>-
      // (UNIQUES par champ) : les 6 variants peuvent donc rester
      // injectés ensemble sans aucune collision — pas de purge.
      // Injection paresseuse au premier passage vers ce type.
      const box = elsAgg[type]();
      if (!box.dataset.injected) {
        box.innerHTML = GF[type].html();
        box.dataset.injected = "1";
      }
    }

    // Badge du type en tête du formulaire (couleur du contrat).
    const badge = els2.badge();
    badge.innerHTML = "";
    const dot = document.createElement("span");
    dot.className = `c-type-dot type-${type}`;
    const label = document.createElement("span");
    label.textContent = TYPE_LABELS[type] || type;
    badge.appendChild(dot);
    badge.appendChild(label);

    // Un seul variant visible.
    els2.actu().hidden = type === "media_publie" || type === "outil_publie" || !!GF[type];
    els2.media().hidden = type !== "media_publie";
    els2.outil().hidden = type !== "outil_publie";
    for (const t of AGGREGATE_TYPES) {
      elsAgg[t]().hidden = type !== t;
    }

    els2.step().hidden = true;
    els2.form().hidden = false;
    let first;
    if (type === "media_publie") first = document.getElementById(GF.media.firstFieldId);
    else if (type === "outil_publie") first = document.getElementById(GF.outil.firstFieldId);
    else if (GF[type]) first = document.getElementById(GF[type].firstFieldId);
    else first = document.getElementById("c-titre");
    setTimeout(() => first && first.focus(), 50);
  }

  // ---------- Collecte / validation selon le type ----------
  const isMedia = () => currentType === "media_publie";
  const isOutil = () => currentType === "outil_publie";
  const isAgg = () => !!GF[currentType];
  const isActu = () => currentType === "evenement" || currentType === "information";

  function collect() {
    if (isMedia()) return Object.assign({ type: currentType }, GF.media.get());
    if (isOutil()) return Object.assign({ type: currentType }, GF.outil.get());
    if (isAgg()) return Object.assign({ type: currentType }, GF[currentType].get());
    return {
      type: currentType,
      titre: document.getElementById("c-titre").value.trim(),
      date: document.getElementById("c-date").value.trim(),
      date_fin: document.getElementById("c-date-fin").value.trim(),
      lieu: document.getElementById("c-a-lieu").value.trim(),
      lien: document.getElementById("c-a-url").value.trim(),
      description: document.getElementById("c-a-description").value.trim(),
    };
  }

  function validate() {
    // Garde : pas d'envoi possible sans type choisi (étape 1).
    if (!currentType) return false;
    if (isMedia()) return GF.media.validate(GC.setFieldError);
    if (isOutil()) return GF.outil.validate(GC.setFieldError);
    if (isAgg()) return GF[currentType].validate(GC.setFieldError);
    // Formulaire actu : calque de l'existant (ids c-a-* propres à
    // l'app pour ne pas entrer en collision avec les ids des formulaires
    // mutualisés média/outil).
    let ok = true;
    const titre = document.getElementById("c-titre").value.trim();
    const url = document.getElementById("c-a-url").value.trim();
    const date = document.getElementById("c-date").value.trim();

    if (!titre) {
      GC.setFieldError(document.getElementById("c-titre"), "Le titre est nécessaire pour que l'équipe vérifie l'actualité.");
      ok = false;
    } else if (titre.length < 3) {
      GC.setFieldError(document.getElementById("c-titre"), "Le titre paraît trop court — quelques mots suffisent.");
      ok = false;
    } else {
      GC.setFieldError(document.getElementById("c-titre"), null);
    }

    let urlOk = false;
    try {
      const u = new URL(url);
      urlOk = u.protocol === "http:" || u.protocol === "https:";
    } catch { /* invalide */ }
    if (!urlOk) {
      GC.setFieldError(document.getElementById("c-a-url"), "Collez une adresse web complète commençant par https:// (ou http://).");
      ok = false;
    } else {
      GC.setFieldError(document.getElementById("c-a-url"), null);
    }

    if (!date) {
      GC.setFieldError(document.getElementById("c-date"), "La date est nécessaire (jour de début de l'actualité).");
      ok = false;
    } else {
      GC.setFieldError(document.getElementById("c-date"), null);
    }

    const df = document.getElementById("c-date-fin").value.trim();
    if (df && date && df < date) {
      GC.setFieldError(document.getElementById("c-date-fin"), "La date de fin doit suivre la date de début.");
      ok = false;
    } else {
      GC.setFieldError(document.getElementById("c-date-fin"), null);
    }

    return ok;
  }

  // ---------- Payload / table / issue selon le type ----------
  function payloadOf(d) {
    if (isMedia()) return Object.assign({ type: d.type }, GF.media.payload(d));
    if (isOutil()) return Object.assign({ type: d.type }, GF.outil.payload(d));
    if (isAgg()) return Object.assign({ type: d.type }, GF[d.type].payload(d));
    return {
      type: d.type,
      titre: d.titre,
      date_debut: d.date,
      date_fin: d.date_fin,
      lieu: d.lieu,
      lien: d.lien,
      description: d.description,
    };
  }

  function tableOf(d) {
    if (isMedia()) {
      const rows = [["Type d'actualité", "Média publié"]];
      return rows.concat(GF.media.table(d));
    }
    if (isOutil()) {
      const rows = [["Type d'actualité", "Outil publié"]];
      return rows.concat(GF.outil.table(d));
    }
    if (isAgg()) {
      const rows = [["Type d'actualité", GF[d.type].label || TYPE_LABELS[d.type] || d.type]];
      return rows.concat(GF[d.type].table(d));
    }
    return [
      ["Titre", d.titre],
      ["Type", TYPE_LABELS[d.type] || d.type],
      ["Date", d.date + (d.date_fin ? ` → ${d.date_fin}` : "")],
      ["Lieu", d.lieu || "—"],
      ["Lien", d.lien],
      ["Résumé", d.description || "—"],
    ];
  }

  function titleOf(d) {
    if (isMedia()) return GF.media.titleOf(d);
    if (isOutil()) return GF.outil.titleOf(d);
    if (isAgg()) return GF[d.type].titleOf(d);
    return d.titre;
  }

  // ---------- Ouverture de la modale : retour à l'étape 1 ----------
  // Marqueur « reset » : le socle contribution.js laisse l'app gérer
  // la réinitialisation (étape 1 visible, formulaire masqué) au lieu
  // de son comportement standard (form.hidden = false + reset()).
  function contributionOnOpen() {
    showStep1();
    const form = els2.form();
    form.reset(); // vide TOUS les champs (actu + variants injectés)
    // Nettoyage des erreurs (calque du socle, non exposé par lui) :
    // erreurs de champ + message global de refus de modération.
    form.querySelectorAll(".field-error").forEach((e) => e.remove());
    form.querySelectorAll(".invalid").forEach((i) => i.classList.remove("invalid"));
  }
  contributionOnOpen.reset = true;

  // Initialisation du socle (bouton, modale, envoi, repli).
  GC.init({
    app: "actualites",
    firstFieldId: "c-titre",
    onOpen: contributionOnOpen,
    titleOf: (d) => titleOf(d),
    collect: () => collect(),
    validate: () => validate(),
    payload: (d) => payloadOf(d),
    table: (d) => tableOf(d),
    issueTexts: {
      heading: "Proposition d'actualité",
      intro:
        "Un·e visiteur de la grille Actualités propose d'ajouter cette actualité.",
      closing:
        "La validation crée l'item Zotero membre des collections « Actualités » " +
        "et de l'app du type choisi (Médiathèque, Outilthèque, Contacts, " +
        "Projets, Organisations, Lieux, Questions ou Idées — un seul et même " +
        "enregistrement, citationKey A000N), ferme cette issue et le prochain " +
        "`deploy.sh` publie l'actualité.",
    },
  });

  // Étape 1 : clic sur une carte de type → étape 2.
  els2.choices().forEach((btn) => {
    btn.addEventListener("click", () => showStep2(btn.dataset.actutype));
  });

  // Retour à l'étape 1 (les valeurs saisies sont conservées par type :
  // les champs du variant restent dans le DOM, masqués).
  els2.back().addEventListener("click", showStep1);
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
