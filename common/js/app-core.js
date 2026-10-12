/* =========================================================
   Grilles de carte — socle applicatif commun (window.GrilleApp)

   Extrait des parties communes de contacts/js/app.js et
   projets/js/app.js (audit 11/10/26 : ~177 lignes JS dupliquées
   — modale + grille + compteur + écouteurs, convention CEO
   « 5e grille : extraire le socle AVANT de bâtir »).
   Les NOUVELLES grilles programment contre CETTE API ; les 4
   apps existantes ne sont PAS migrées (elles continuent de
   fonctionner telles quelles).

   Dépendances (chargées AVANT ce fichier) :
   - window.GrillePagination (common/js/pagination.js)
   - window.GrilleDom (common/js/dom.js — clic carte → pop-up)

   API publique (FROZEN — les apps de la vague 1 programment
   contre ces noms) :

   - makeState(overrides)
       → { items: [], searchText: "", sortMode: "nom",
           pageSize: "9", currentPage: 0, ...overrides }
       L'app étend l'état avec ses filtres propres, p. ex.
       GrilleApp.makeState({ selectedCats: new Set() }).

   - async load({ dataUrl, grid, normalize, afterLoad })
       fetch JSON (cache: "no-cache") ; data = tableau OU
       { items: [...] } ; normalize(raw) (facultatif) puis
       callback afterLoad(items). Sur échec : message
       « Impossible de charger les données. » (classe .empty)
       dans grid + console.error, afterLoad NON appelé.

   - renderGrid({ state, grid, count, noun, nounPlural,
       cardClass, renderCard, onCardClick, getVisibleItems,
       paginationNavs, hasActiveFilters, emptyFilteredMsg,
       emptyMsg })
       Pagine via GrillePagination (les DEUX navs de
       paginationNavs, re-rendu + scroll top smooth au
       changement de page), rend les cartes .${cardClass} via
       innerHTML, attache clic + Enter/Espace sur chaque carte
       (délègue à onCardClick(item, card) — card = élément déclencheur,
       utile pour l'ancrage du pop-up en mode intégré), item retrouvé
       par data-id dans state.items), état vide (classe .empty : texte
       emptyFilteredMsg si hasActiveFilters() sinon emptyMsg),
       compteur via updateCount. getVisibleItems() rend la
       liste DÉJÀ filtrée et triée par l'app.

   - updateCount(el, n, noun, nounPlural)
       « aucun <nom> » / « 1 <nom> » / « N <nomPlural> ».
       noun peut être une chaîne OU un objet { zero, one, many }
       pour les accords irréguliers — ex. féminins :
       { zero: "aucune organisation", one: "organisation",
         many: "organisations" }.

   - attachSearch(inputEl, state, render)
       Debounce 150 ms : met state.searchText, ramène page 1,
       re-render.

   - attachPageSize(selectEl, state, render)
       Change state.pageSize, ramène page 1, re-render.

   - attachSort(selectEl, state, render)
       Change state.sortMode, ramène page 1, re-render.

   - openModal(modalEl) / closeModal(modalEl)
       aria-hidden + classe body.modal-open.

   - attachModalClose(modalEl, openMenus)
       Écouteurs [data-close] ; Échap ferme la modale
       SEULEMENT si aucun des éléments de openMenus (liste des
       menus .dd-menu susceptibles d'être ouverts) n'est ouvert.

   Ordre de chargement dans les apps : dom, search, pagination,
   dropdown, app-core, contribution, app.js.
   ========================================================= */
window.GrilleApp = (() => {
  "use strict";

  const { paginate, renderPagination } = window.GrillePagination;

  /* ---------- État ---------- */

  function makeState(overrides) {
    return Object.assign(
      {
        items: [],
        searchText: "",
        sortMode: "nom", // clé de tri, sémantique à l'app
        pageSize: "9",   // "9" | "18" | "36" | "all" (calque apps)
        currentPage: 0,  // index 0-based
      },
      overrides || {}
    );
  }

  /* ---------- Chargement initial ---------- */

  async function load({ dataUrl, grid, normalize, afterLoad }) {
    let raw = [];
    try {
      const resp = await fetch(dataUrl, { cache: "no-cache" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      raw = Array.isArray(data) ? data : data.items || [];
    } catch (err) {
      console.error(`Erreur de chargement (${dataUrl}) :`, err);
      if (grid) {
        grid.innerHTML = `<p class="empty">Impossible de charger les données.</p>`;
      }
      return;
    }
    const items = normalize ? normalize(raw) : raw;
    if (afterLoad) afterLoad(items);
  }

  /* ---------- Compteur ---------- */

  function updateCount(el, n, noun, nounPlural) {
    if (!el) return;
    let zero, one, many;
    if (noun && typeof noun === "object") {
      // Accord irrégulier explicite : { zero, one, many }.
      zero = noun.zero;
      one = noun.one;
      many = noun.many;
    } else {
      one = String(noun || "");
      many = nounPlural || (one.endsWith("s") ? one : `${one}s`);
      zero = `aucun ${one}`;
    }
    el.textContent = n === 0 ? zero : n === 1 ? `1 ${one}` : `${n} ${many}`;
  }

  /* ---------- Rendu de la page courante ---------- */

  // Rend la grille UNE fois à partir de cfg ; un changement de
  // page (pagination) re-appelle draw() (les DEUX barres se
  // resynchronisent) puis remonte en haut de page (smooth).
  function renderGrid(cfg) {
    if (!cfg || !cfg.grid) return;

    function draw() {
      const grid = cfg.grid;
      grid.innerHTML = "";

      // Liste DÉJÀ filtrée + triée par l'app (copie triée,
      // pas de mutation : changer le tri sans recharger doit
      // réordonner).
      const items = cfg.getVisibleItems ? cfg.getVisibleItems() : [];
      const { totalPages, pageRows } = paginate(cfg.state, items);
      renderPagination(
        cfg.state,
        totalPages,
        (cfg.paginationNavs || []).filter(Boolean),
        () => {
          draw();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      );

      if (!items.length) {
        const p = document.createElement("p");
        p.className = "empty";
        p.textContent =
          cfg.hasActiveFilters && cfg.hasActiveFilters()
            ? cfg.emptyFilteredMsg
            : cfg.emptyMsg;
        grid.appendChild(p);
        updateCount(cfg.count, 0, cfg.noun, cfg.nounPlural);
        return;
      }

      grid.innerHTML = pageRows.map(cfg.renderCard).join("");

      // Clic n'importe où sur la carte → pop-up (règle CEO 13/10/26) :
      // mécanique mutualisée dans dom.js (chargé avant app-core).
      window.GrilleDom.attachCardClick(grid, {
        cardSelector: `.${cfg.cardClass}`,
        findItem: (card) => cfg.state.items.find((i) => i.id === card.dataset.id) || null,
        open: (item, card) => {
          if (cfg.onCardClick) cfg.onCardClick(item, card);
        },
      });
      updateCount(cfg.count, items.length, cfg.noun, cfg.nounPlural);
    }

    draw();
  }

  /* ---------- Écouteurs génériques ---------- */

  // Recherche : debounce 150 ms, page 1, re-render.
  function attachSearch(inputEl, state, render) {
    if (!inputEl) return;
    let timer = null;
    inputEl.addEventListener("input", (e) => {
      clearTimeout(timer);
      const value = e.target.value;
      timer = setTimeout(() => {
        state.searchText = value;
        state.currentPage = 0; // tout filtre ramène à la page 1
        render();
      }, 150);
    });
  }

  // Taille de page : change pageSize, page 1, re-render.
  function attachPageSize(selectEl, state, render) {
    if (!selectEl) return;
    selectEl.addEventListener("change", (e) => {
      state.pageSize = e.target.value;
      state.currentPage = 0; // changement de taille → retour page 1
      render();
    });
  }

  // Tri : change sortMode, page 1, re-render.
  function attachSort(selectEl, state, render) {
    if (!selectEl) return;
    selectEl.addEventListener("change", (e) => {
      state.sortMode = e.target.value;
      state.currentPage = 0; // tout tri ramène à la page 1
      render();
    });
  }

  /* ---------- Modale détail ---------- */

  function openModal(modalEl) {
    if (!modalEl) return;
    modalEl.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
  }

  function closeModal(modalEl) {
    if (!modalEl) return;
    modalEl.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
  }

  // [data-close] (bouton + voile) + Échap. openMenus : liste
  // des menus .dd-menu susceptibles d'être ouverts — Échap ne
  // ferme la modale que si AUCUN n'est ouvert (le dropdown
  // ferme son menu en premier et rend le focus au bouton,
  // comportement calque médiathèque/contacts).
  function attachModalClose(modalEl, openMenus) {
    if (!modalEl) return;
    modalEl.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", () => closeModal(modalEl));
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const menus = openMenus || [];
      if (menus.some((m) => m && m.classList.contains("open"))) return;
      if (modalEl.getAttribute("aria-hidden") === "false") closeModal(modalEl);
    });
  }

  return {
    makeState,
    load,
    renderGrid,
    updateCount,
    attachSearch,
    attachPageSize,
    attachSort,
    openModal,
    closeModal,
    attachModalClose,
  };
})();
