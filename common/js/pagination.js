/* =========================================================
   Grilles de carte — pagination commune (K5)
   Calque strict de la mécanique vitrine/alpas (09/10/26) :
   - paginate(filtered) : calcule la tranche courante + borne
     currentPage (clamp si la page a disparu) ;
   - renderPagination : barres ‹ / numéros / ›, haut et bas,
     même HTML, synchronisées. Tous les numéros si ≤ 6 pages,
     sinon fenêtre [première, dernière, courant±1] + « … ».
   Chaque changement de filtre ramène à la page 1 (comportement
   géré par l'app : tout filtre → currentPage = 0).
   ========================================================= */
window.GrillePagination = (() => {
  "use strict";

  // state : { pageSize: "9"|"12"|…|"all", currentPage } (index 0-based),
  // muté par clamp. Rend { totalPages, pageRows }.
  function paginate(state, filtered) {
    const pageSizeNum = state.pageSize === "all" ? filtered.length : parseInt(state.pageSize, 10);
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSizeNum));
    if (state.currentPage >= totalPages) state.currentPage = totalPages - 1;
    if (state.currentPage < 0) state.currentPage = 0;
    const startIdx = state.currentPage * pageSizeNum;
    return {
      totalPages,
      pageRows: filtered.slice(startIdx, startIdx + pageSizeNum),
    };
  }

  // navs : conteneurs nav haut + bas (éléments DOM, null filtrés
  // par l'app). onChange(page) : appelé quand l'utilisateur clique
  // un numéro/‹/› — l'app met à jour state.currentPage et
  // re-rend (le re-rendu synchronise les DEUX barres).
  function renderPagination(state, totalPages, navs, onChange) {
    navs = navs.filter(Boolean);
    if (state.pageSize === "all" || totalPages <= 1) {
      navs.forEach((nav) => (nav.innerHTML = ""));
      return;
    }

    let html = `<button type="button" class="page-btn" data-page="prev" ${state.currentPage === 0 ? "disabled" : ""} aria-label="Page précédente">‹</button>`;

    if (totalPages <= 6) {
      for (let i = 0; i < totalPages; i++) {
        html += `<button type="button" class="page-num${i === state.currentPage ? " active" : ""}" data-page="${i}">${i + 1}</button>`;
      }
    } else {
      const pages = new Set([0, totalPages - 1, state.currentPage, state.currentPage - 1, state.currentPage + 1]);
      let prevShown = -1;
      for (let i = 0; i < totalPages; i++) {
        if (pages.has(i)) {
          html += `<button type="button" class="page-num${i === state.currentPage ? " active" : ""}" data-page="${i}">${i + 1}</button>`;
          prevShown = i;
        } else if (prevShown !== -2) {
          html += `<span class="page-ellipsis">…</span>`;
          prevShown = -2;
        }
      }
    }

    html += `<button type="button" class="page-btn" data-page="next" ${state.currentPage >= totalPages - 1 ? "disabled" : ""} aria-label="Page suivante">›</button>`;

    navs.forEach((nav) => {
      nav.innerHTML = html;
      nav.querySelectorAll("button[data-page]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const p = btn.dataset.page;
          const prev = state.currentPage;
          if (p === "prev") state.currentPage = Math.max(0, state.currentPage - 1);
          else if (p === "next") state.currentPage = state.currentPage + 1;
          else state.currentPage = parseInt(p, 10);
          if (state.currentPage !== prev) onChange(state.currentPage);
        });
      });
    });
  }

  return { paginate, renderPagination };
})();
