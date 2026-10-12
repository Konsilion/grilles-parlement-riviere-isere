/* =========================================================
   Contacts — Parlement de la rivière Isère (C3)
   Répertoire public de cartes contact. Lit data/contacts.json
   (contrat C2 : id, nom, description, organisation, lieu,
   date_contact, lien, email, telephone, role, categories,
   date_ajout — le fichier commis est une FIXTURE de dev,
   écrasée à la production par le deploy C2).
   Socles communs : GrilleSearch (recherche floue),
   GrillePagination (9/18/36/Tout), GrilleDropdown (filtre
   catégories), GrilleDom (esc/dates). Zéro dépendance.
   ========================================================= */
"use strict";

const DATA_URL = "data/contacts.json";

const { esc } = window.GrilleDom;
const GS = window.GrilleSearch;
const { paginate: paginateItems, renderPagination } = window.GrillePagination;
const { makeDropdown } = window.GrilleDropdown;

/* ---------- Mode intégré (?mode=integre) ----------
   Calque médiathèque : aucune iframe n'est prévue aujourd'hui,
   mais le mode est hérité — bannière/fond s'adaptent si l'app
   est un jour embarquée (même sans postMessage de hauteur,
   aucun hôte n'étant câblé). */
const EMBED_MODE =
  new URLSearchParams(location.search).get("mode") === "integre";
if (EMBED_MODE) document.documentElement.setAttribute("data-embed", "1");

/* ---------- État ---------- */
const state = {
  items: [],
  searchText: "",
  selectedCats: new Set(), // catégories cochées (vide = toutes)
  sortMode: "nom", // "nom" (A-Z, défaut) | "recent" (contact le plus récent)
  pageSize: "9", // "9" | "18" | "36" | "all" (calque actualités)
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
  sortSelect: null,
  catDropdown: null,
  catToggle: null,
  catPill: null,
  catMenu: null,
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

/* ---------- Normalisation (contrat C2, valeurs absentes → "") ---------- */
function normalizeItems(raw) {
  return raw.map((o) => ({
    id: String(o?.id ?? ""),
    nom: String(o?.nom ?? ""),
    description: String(o?.description ?? ""),
    organisation: String(o?.organisation ?? ""),
    lieu: String(o?.lieu ?? ""),
    date_contact: String(o?.date_contact ?? "").trim(),
    lien: String(o?.lien ?? "").trim(),
    email: String(o?.email ?? "").trim(),
    telephone: String(o?.telephone ?? "").trim(),
    role: String(o?.role ?? ""),
    categories: Array.isArray(o?.categories) ? o.categories.map(String) : [],
    date_ajout: String(o?.date_ajout ?? "").trim(),
  }));
}

/* ---------- Tri ---------- */
function sortItems(items) {
  const byName = (a, b) =>
    a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }) ||
    a.id.localeCompare(b.id);
  if (state.sortMode === "recent") {
    // Contact le plus récent d'abord (date_contact desc ; sans date
    // → fin de liste, départagée par date_ajout desc puis nom).
    const ts = (c) => (c.date_contact ? window.GrilleDom.parseISO(c.date_contact)?.getTime() || 0 : 0);
    return items.slice().sort((a, b) => {
      const ta = ts(a), tb = ts(b);
      if (ta !== tb) return tb - ta;
      if (a.date_contact && !b.date_contact) return -1;
      if (!a.date_contact && b.date_contact) return 1;
      return a.date_ajout < b.date_ajout ? 1 : a.date_ajout > b.date_ajout ? -1 : byName(a, b);
    });
  }
  return items.slice().sort(byName); // défaut : nom A-Z
}

/* ---------- Recherche floue (haystack : nom + organisation + description + rôle) ---------- */
const getSearchIndex = GS.makeSearchCache(
  (item) => item.id,
  (item) => [item.nom, item.organisation, item.description, item.role].join(" ")
);

/* ---------- Initiales de l'avatar (2 max, bande de nom) ---------- */
function initialsOf(nom) {
  const parts = String(nom || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

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

/* ---------- Rendu d'une carte (répertoire) ---------- */
function renderCard(item) {
  const cats = item.categories
    .map((c) => `<span class="card-tag">${esc(c)}</span>`)
    .join("");

  const metaSegs = [item.lieu, item.role].filter(Boolean);

  return `
    <article class="card contact-card" data-id="${esc(item.id)}" tabindex="0" role="button" aria-label="Voir le détail de ${esc(item.nom)}">
      <div class="card-head">
        <span class="avatar" aria-hidden="true">${esc(initialsOf(item.nom))}</span>
        <div class="card-id-block">
          <h2 class="card-title">${esc(item.nom)}</h2>
          ${item.organisation ? `<p class="card-org">${esc(item.organisation)}</p>` : ""}
        </div>
      </div>
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
      state.searchText.trim() || state.selectedCats.size
        ? "Aucun contact ne correspond à ces filtres."
        : "Aucun contact pour le moment.";
    els.grid.appendChild(p);
    updateCount(0);
    return;
  }

  els.grid.innerHTML = pageRows.map(renderCard).join("");

  // Clic n'importe où sur la carte → pop-up (règle CEO 13/10/26) :
  // mécanique mutualisée dans dom.js. La carte passe en triggerEl —
  // en mode intégré (?mode=integre), le pop-up s'ancre sur elle.
  window.GrilleDom.attachCardClick(els.grid, {
    cardSelector: ".contact-card",
    findItem: (card) => state.items.find((i) => i.id === card.dataset.id) || null,
    open: (item, card) => openModal(item, card),
  });
  updateCount(items.length);
}

function updateCount(n) {
  if (!els.count) return;
  els.count.textContent = n === 0 ? "aucun contact" : `${n} contact${n > 1 ? "s" : ""}`;
}

/* ---------- Modale détail (définition « contacts » du socle GrilleDetail,
   common/js/details/contacts.js — aucune duplication : le conteneur et
   les blocs structurels viennent du socle commun modal.css, l'avatar
   et la tête de modale de common/css/details/contacts.css). ---------- */
const GD = window.GrilleDetail;

/* ---------- Modale détail : consommation du socle GrilleDetail ---------- */
function openModal(item, triggerEl) {
  GD.open("contacts", item, { triggerEl });
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
    console.error("Erreur de chargement des contacts :", err);
    if (els.grid) {
      els.grid.innerHTML = `<p class="empty">Impossible de charger les contacts.</p>`;
    }
    return;
  }
  state.items = sortItems(normalizeItems(raw));
  state.currentPage = 0;
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

  // Fermeture de la modale détail (×, voile, Échap) : l'engine
  // GrilleDetail gère tout — plus d'écouteur dédié ici (Échap
  // rend d'abord la priorité au menu Catégories ouvert, puis
  // ferme la modale détail la plus récente).
}

/* ---------- Contribution (esprit Datami) ----------
   Calque médiathèque, socle commun common/js/contribution.js :
   envoi silencieux au relais VPS → issue GitHub étiquetée
   « contribution » ; repli manuel si le relais échoue. Les champs
   suivent le mapping C2 de scripts/fetch_contacts.py /
   valider_contribution.py (labels extra ANGLAIS sans accents :
   Email:/Telephone:/Role:). */
(function initContribution() {
  const GC = window.GrilleContribution;
  if (!GC) return;

  const f = {
    nom: () => document.getElementById("c-nom"),
    organisation: () => document.getElementById("c-organisation"),
    lieu: () => document.getElementById("c-lieu"),
    email: () => document.getElementById("c-email"),
    telephone: () => document.getElementById("c-telephone"),
    role: () => document.getElementById("c-role"),
    description: () => document.getElementById("c-description"),
    url: () => document.getElementById("c-url"),
  };

  function closeDetailModal() {
    if (GD.isOpen("contacts")) GD.close("contacts");
  }

  function validate() {
    let ok = true;
    const nom = f.nom().value.trim();
    const email = f.email().value.trim();

    if (!nom) {
      GC.setFieldError(f.nom(), "Le nom est nécessaire pour que l'équipe vérifie le contact.");
      ok = false;
    } else if (nom.length < 3) {
      GC.setFieldError(f.nom(), "Le nom paraît trop court — prénom et nom suffisent.");
      ok = false;
    } else {
      GC.setFieldError(f.nom(), null);
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      GC.setFieldError(f.email(), "Cette adresse e-mail ne semble pas valide.");
      ok = false;
    } else {
      GC.setFieldError(f.email(), null);
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
    app: "contacts",
    firstFieldId: "c-nom",
    onOpen: closeDetailModal,
    titleOf: (d) => d.nom,
    collect: () => ({
      nom: f.nom().value.trim(),
      organisation: f.organisation().value.trim(),
      lieu: f.lieu().value.trim(),
      email: f.email().value.trim(),
      telephone: f.telephone().value.trim(),
      role: f.role().value.trim(),
      description: f.description().value.trim(),
      url: f.url().value.trim(),
    }),
    validate,
    payload: (d) => d,
    table: (d) => [
      ["Nom", d.nom],
      ["Organisation", d.organisation || "—"],
      ["Lieu", d.lieu || "—"],
      ["E-mail", d.email || "—"],
      ["Téléphone", d.telephone || "—"],
      ["Rôle", d.role || "—"],
      ["Description", d.description || "—"],
      ["Lien", d.url || "—"],
    ],
    issueTexts: {
      heading: "Proposition de contact",
      intro:
        "Un·e visiteur du répertoire Contacts propose d'ajouter ce contact. " +
        "⚠ Coordonnées personnelles : vérifier le consentement avant validation.",
      closing:
        "La validation crée l'item Zotero (collection « Contacts », mapping C2 : " +
        "extra Email:/Telephone:/Role:, citationKey C000N), ferme cette issue et le prochain " +
        "`deploy.sh` publie le contact.",
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
attachListeners();
document.addEventListener("DOMContentLoaded", load);
