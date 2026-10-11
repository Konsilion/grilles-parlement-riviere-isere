/* =========================================================
   Zotero Vitrine — logique front
   - Fetch collection.json
   - Rendu des cartes (sans tags depuis 09/10/26 — décision CEO)
   - Filtres (recherche floue insensible casse/accents + année
     multi-choix via dropdown commun + type multi-choix)
   - Types dynamiques : compteurs recalculés à chaque filtre,
     types à 0 masqués
   - Modale détail + copie BibTeX (tags conservés en modale)
   - Recherche floue / pagination / dropdown : socles communs
     (../common/js/*) partagés avec l'app actualités (K5).
   ========================================================= */

(() => {
  "use strict";

  const { esc: escapeHtml } = window.GrilleDom;
  const GS = window.GrilleSearch;
  const { paginate: paginateItems, renderPagination } = window.GrillePagination;
  const { makeDropdown } = window.GrilleDropdown;

  // ---------- Mode intégré (iframe hôte, ?mode=integre) ----------
  // La vitrine embarquée n'a PAS de défilement propre : l'iframe est
  // redimensionnée par la page hôte. À chaque changement de hauteur on
  // l'annonce à l'hôte (postMessage) → une seule barre de défilement,
  // celle de la page hôte, et aucun fond imposé (transparence totale).
  const EMBED_MODE = new URLSearchParams(location.search).get("mode") === "integre";
  if (EMBED_MODE) document.documentElement.setAttribute("data-embed", "1");

  const notifyHost = (msg) => {
    if (!EMBED_MODE) return;
    // Origine non restreinte : le message ne transporte qu'un nombre,
    // aucune donnée sensible.
    if (window.parent !== window) parent.postMessage(msg, "*");
  };
  const notifyHeight = () => {
    // Modale ouverte (détail OU contribution) → la hauteur du document varie
    // (ancrage absolu) : ne pas notifier l'hôte, pour éviter un cercle de
    // redimensionnements.
    if (document.querySelector('.modal[aria-hidden="false"]')) return;
    notifyHost({ type: "zotero-vitrine:height", height: document.documentElement.scrollHeight });
  };

  // ---------- État global ----------
  const state = {
    items: [],            // items de la collection
    meta: {},             // generated_at, count, ...
    searchText: "",
    selectedYears: new Set(), // filtre Année multi-choix — menu déroulant (CEO 10/10/26)
    selectedTypes: new Set(), // filtre Type multi-choix (CEO 09/10/26)
    pageSize: "12",       // "12" | "24" | "48" | "all" (calque alpas)
    currentPage: 0,       // index 0-based
  };

  // ---------- DOM ----------
  const els = {
    search: document.getElementById("search"),
    yearDropdown: document.getElementById("year-dropdown"),
    yearToggle: document.getElementById("year-toggle"),
    yearPill: document.getElementById("year-pill"),
    yearMenu: document.getElementById("year-menu"),
    typeList: document.getElementById("type-list"),
    resetBtn: document.getElementById("reset-filters"),
    grid: document.getElementById("grid"),
    resultCount: document.getElementById("result-count"),
    pageSizeSelect: document.getElementById("page-size-select"),
    pagination: document.getElementById("pagination"),
    paginationTop: document.getElementById("pagination-top"),
    modal: document.getElementById("modal"),
    modalType: document.getElementById("modal-type"),
    modalTitle: document.getElementById("modal-title"),
    modalMetaLine: document.getElementById("modal-meta-line"),
    modalTags: document.getElementById("modal-tags"),
    modalAbstract: document.getElementById("modal-abstract"),
    modalSource: document.getElementById("modal-source"),
    modalBibtex: document.getElementById("modal-bibtex"),
    modalCopied: document.getElementById("modal-copied"),
    modalContent: document.querySelector(".modal-content"),
    modalBackdrop: document.querySelector(".modal-backdrop"),
  };

  // ---------- Utils ----------
  const formatAuthors = (authors) => {
    if (!authors || authors.length === 0) return "Auteur inconnu";
    if (authors.length === 1) return authors[0];
    if (authors.length === 2) return authors.join(" & ");
    if (authors.length <= 5) return authors.slice(0, -1).join(", ") + " & " + authors.at(-1);
    return authors.slice(0, 3).join(", ") + ", et al.";
  };

  const formatAuthorsShort = (authors) => {
    if (!authors || authors.length === 0) return "Auteur inconnu";
    if (authors.length === 1) return authors[0];
    if (authors.length === 2) return authors.join(", ");
    return authors[0] + " et al.";
  };

  // ---------- Index de recherche (haystack médiathèque) ----------
  // Titre + auteurs + résumé + tags (calque vitrine 10/10/26).
  const getSearchIndex = GS.makeSearchCache(
    (it) => it.key,
    (it) => [it.title, ...(it.authors || []), it.abstract || "", ...(it.tags || [])].join(" ")
  );

  // ---------- Fetch initial ----------
  async function loadCollection() {
    try {
      const resp = await fetch("data/collection.json", { cache: "no-store" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      state.items = data.items || [];
      state.meta = data;

      buildFilterOptions();
      render();
    } catch (err) {
      els.grid.innerHTML = `<p class="empty">
        ⚠️ Impossible de charger <code>data/collection.json</code>.<br>
        <small>${escapeHtml(err.message)}</small><br><br>
        <small>Avez-vous lancé <code>python scripts/fetch_zotero.py</code> ?</small>
      </p>`;
      console.error(err);
      notifyHeight();
    }
  }

  // ---------- Construction des options de filtres (une seule fois) ----------
  function buildFilterOptions() {
    const years = new Set();
    for (const it of state.items) {
      if (it.year) years.add(it.year);
    }

    // Menu Année multi-choix (dropdown commun) : « Toutes les années »
    // en tête (décoche tout d'un clic), puis les années distinctes par
    // ordre décroissant.
    yearDD.fill(
      [...years].sort((a, b) => b.localeCompare(a)).map((y) => ({ value: y, label: y })),
      onYearChange
    );
  }

  // Tout changement du dropdown Année : retour page 1 + re-rendu.
  function onYearChange() {
    state.currentPage = 0; // tout filtre ramène à la page 1 (calque alpas)
    yearDD.syncUI();
    render();
  }

  // ---------- Filtrage ----------
  // ignoreTypes: calcule le filtrage SANS la condition de type — utilisé pour
  // les compteurs de la sidebar : les types restent tous visibles et cochables
  // même quand des types sont déjà sélectionnés (sinon le multi-choix casserait).
  function getFilteredItems({ ignoreTypes = false } = {}) {
    const qNorm = GS.searchNormalize(state.searchText.trim());
    // Mots significatifs (≥ 2 car.) pour le mode flou ; les mots de 1 car.
    // (« l » de « l'eau ») ne portent pas de sens de recherche.
    const qWords = qNorm ? qNorm.split(/[^a-z0-9]+/).filter((w) => w.length >= 2) : [];
    return state.items.filter((it) => {
      if (qNorm) {
        const index = getSearchIndex(it);
        if (!GS.matchesQuery(index, qNorm, qWords)) return false;
      }
      if (state.selectedYears.size > 0 && !state.selectedYears.has(it.year)) return false;
      if (!ignoreTypes && state.selectedTypes.size > 0 && !state.selectedTypes.has(it.type)) return false;
      return true;
    });
  }

  // ---------- Rendu des types dynamiques (multi-choix) ----------
  function renderTypes(scopedItems) {
    // Compter les types parmi les items filtrés par recherche + année SANS le
    // filtre type : un item a un seul type, la combinaison de types cochés est
    // donc une union — les compteurs restent exacts même à plusieurs cochés.
    const typeCounts = new Map();
    for (const it of scopedItems) {
      if (it.type) typeCounts.set(it.type, (typeCounts.get(it.type) || 0) + 1);
    }

    // Types déjà sélectionnés qui ne sont plus dans le périmètre → gardés
    // visibles (cochés, compteur 0) pour pouvoir les décocher.
    for (const t of state.selectedTypes) {
      if (!typeCounts.has(t)) typeCounts.set(t, 0);
    }

    // Tri : types sélectionnés en premier, puis par fréquence décroissante
    const sortedTypes = [...typeCounts.entries()].sort((a, b) => {
      const aSelected = state.selectedTypes.has(a[0]);
      const bSelected = state.selectedTypes.has(b[0]);
      if (aSelected && !bSelected) return -1;
      if (!aSelected && bSelected) return 1;
      return b[1] - a[1];
    });

    // Masquer les types à 0 (sauf les sélectionnés)
    const visibleTypes = sortedTypes.filter(([type, count]) => count > 0 || state.selectedTypes.has(type));

    if (visibleTypes.length === 0) {
      els.typeList.innerHTML = `<p class="muted">Aucun type disponible</p>`;
      return;
    }

    els.typeList.innerHTML = "";
    for (const [type, count] of visibleTypes) {
      const label = document.createElement("label");
      label.className = "type-check";
      if (state.selectedTypes.has(type)) label.classList.add("active");

      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = state.selectedTypes.has(type);
      box.addEventListener("change", () => {
        if (box.checked) state.selectedTypes.add(type);
        else state.selectedTypes.delete(type);
        state.currentPage = 0; // tout filtre ramène à la page 1 (calque alpas)
        render();
      });

      const name = document.createElement("span");
      name.className = "type-check-name";
      name.textContent = type;

      const cnt = document.createElement("span");
      cnt.className = "type-count";
      cnt.textContent = count;

      label.append(box, name, cnt);
      els.typeList.appendChild(label);
    }
  }

  // ---------- Rendu ----------
  function render() {
    const filtered = getFilteredItems();
    els.resultCount.textContent = `${filtered.length} résultat${filtered.length > 1 ? "s" : ""}`;

    // Rendu des types dynamiques (sur le périmètre recherche + année, sans le
    // filtre type, pour que tous les types restent cochables en multi-choix)
    renderTypes(getFilteredItems({ ignoreTypes: true }));

    const { totalPages, pageRows } = paginateItems(state, filtered);
    renderPagination(state, totalPages, [els.pagination, els.paginationTop], render);

    if (filtered.length === 0) {
      els.grid.innerHTML = `<p class="empty">Aucun document ne correspond aux filtres.</p>`;
      notifyHeight();
      return;
    }

    els.grid.innerHTML = pageRows.map((it) => renderCard(it)).join("");

    els.grid.querySelectorAll(".card").forEach((card) => {
      card.addEventListener("click", () => {
        const key = card.dataset.key;
        const item = state.items.find((i) => i.key === key);
        if (item) openModal(item, card);
      });
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          card.click();
        }
      });
    });
    notifyHeight();
  }

  // ---------- Vignettes de type (classe CSS par type) ----------
  const TYPE_CLASS_MAP = {
    "Rapport": "rapport",
    "Document": "document",
    "Présentation": "presentation",
    "Audio": "audio",
    "Article de revue": "article",
    "Newsletter": "newsletter",
  };

  const typeClass = (type) => "type-" + (TYPE_CLASS_MAP[type] || "autre");

  function renderCard(it) {
    return `
      <article class="card" data-key="${escapeHtml(it.key)}" tabindex="0" role="button" aria-label="Voir le détail de ${escapeHtml(it.title)}">
        <span class="card-type ${typeClass(it.type)}">${escapeHtml(it.type || "Document")}</span>
        <h2 class="card-title">${escapeHtml(it.title)}</h2>
        <p class="card-authors">${escapeHtml(formatAuthorsShort(it.authors))}</p>
        <p class="card-meta">${it.year ? escapeHtml(it.year) : "Année inconnue"}</p>
      </article>
    `;
  }

  // ---------- Modale ----------
  // Ligne meta compacte : « Par : <auteurs> · 📅 <année> · Ajouté le <date> ».
  // Chaque segment absent de l'item est omis ; seuls les segments présents
  // sont séparés par « · ». Les auteurs absents restent « Auteur inconnu »
  // (comportement formatAuthors conservé).
  function buildMetaSegments(item) {
    const segments = [];
    const authors = formatAuthors(item.authors);
    if (authors) segments.push(`Par : ${authors}`);
    if (item.year) segments.push(`📅 ${item.year}`);
    if (item.dateAdded) segments.push(`Ajouté le ${item.dateAdded}`);
    return segments;
  }

  function renderMetaLine(item) {
    const segments = buildMetaSegments(item);
    els.modalMetaLine.textContent = "";
    segments.forEach((seg, i) => {
      if (i > 0) els.modalMetaLine.append(" · ");
      if (seg.startsWith("Par : ")) {
        const span = document.createElement("span");
        span.className = "modal-meta-authors";
        span.textContent = seg;
        els.modalMetaLine.append(span);
      } else {
        els.modalMetaLine.append(seg);
      }
    });
  }

  function openModal(item, triggerEl) {
    els.modalType.textContent = item.type || "Document";
    els.modalType.className = "modal-type " + typeClass(item.type);
    els.modalTitle.textContent = item.title;
    renderMetaLine(item);

    els.modalTags.innerHTML = (item.tags || [])
      .map((t) => `<span class="card-tag">${escapeHtml(t)}</span>`)
      .join("");

    if (item.abstract && item.abstract.trim()) {
      els.modalAbstract.textContent = item.abstract;
      els.modalAbstract.classList.remove("empty");
    } else {
      els.modalAbstract.textContent = "Pas de résumé disponible.";
      els.modalAbstract.classList.add("empty");
    }

    const sourceUrl = item.url || (item.doi ? `https://doi.org/${item.doi}` : null);
    if (sourceUrl) {
      els.modalSource.href = sourceUrl;
      els.modalSource.classList.remove("disabled");
      els.modalSource.textContent = "Ouvrir la source";
    } else {
      els.modalSource.removeAttribute("href");
      els.modalSource.classList.add("disabled");
      els.modalSource.textContent = "Pas de lien disponible";
    }

    els.modalBibtex.dataset.key = item.key;
    els.modalCopied.textContent = "";

    els.modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    if (EMBED_MODE) positionEmbedModal(triggerEl);
  }

  // En mode intégré, l'iframe est haute comme son contenu : un placement
  // « fixed » centrerait la modale hors du champ visible. On l'ancre donc
  // sur la carte cliquée — visible par définition — et le voile couvre
  // tout le document. Généralisée aux DEUX modales (détail + contribution).
  function positionEmbedModal(triggerEl, modal = els.modal, backdrop = els.modalBackdrop, content = els.modalContent) {
    const top = triggerEl
      ? Math.max(8, Math.round(triggerEl.getBoundingClientRect().top) - 16)
      : 16;
    modal.style.top = top + "px";
    backdrop.style.top = -top + "px";
    backdrop.style.height = document.documentElement.scrollHeight + "px";
    requestAnimationFrame(() => {
      content.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  function closeModal() {
    els.modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    if (EMBED_MODE) {
      els.modal.style.top = "";
      els.modalBackdrop.style.top = "";
      els.modalBackdrop.style.height = "";
    }
  }

  // ---------- BibTeX ----------
  function buildBibtex(item) {
    const FR_TO_BIBTEX = {
      "Livre": "book",
      "Chapitre de livre": "incollection",
      "Article de revue": "article",
      "Article de magazine": "article",
      "Article de presse": "article",
      "Thèse": "phdthesis",
      "Rapport": "techreport",
      "Communication": "inproceedings",
      "Manuscrit": "unpublished",
      "Page web": "misc",
      "Pré-publication": "article",
    };
    const type = FR_TO_BIBTEX[item.type] || "misc";

    const firstAuthor = (item.authors && item.authors[0]) || "inconnu";
    const lastName = firstAuthor.split(" ").pop().toLowerCase().replace(/[^a-z]/g, "");
    const year = item.year || "nodate";
    const citeKey = `${lastName}${year}_${(item.key || "").slice(-4)}`;

    const bibAuthors = (item.authors || [])
      .map((a) => {
        const parts = a.trim().split(/\s+/);
        if (parts.length === 1) return parts[0];
        const last = parts[0];
        const first = parts.slice(1).join(" ");
        return `${last}, ${first}`;
      })
      .join(" and ");

    const fields = [];
    fields.push(`  title = {${item.title || ""}}`);
    if (bibAuthors) fields.push(`  author = {${bibAuthors}}`);
    if (item.year) fields.push(`  year = {${item.year}}`);
    if (item.doi) fields.push(`  doi = {${item.doi}}`);
    if (item.url) fields.push(`  url = {${item.url}}`);
    if (item.abstract) fields.push(`  abstract = {${item.abstract.replace(/[{}]/g, "")}}`);
    if (item.dateAdded) fields.push(`  note = {Ajouté à Zotero le ${item.dateAdded}}`);

    return `@${type}{${citeKey},\n${fields.join(",\n")}\n}`;
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (_) { /* ignore */ }
      document.body.removeChild(ta);
      return ok;
    }
  }

  // ---------- Contribution (esprit Datami) ----------
  // Parcours néophyte : modale → issue GitHub pré-remplie → validation
  // équipe. Aucun backend, aucun compte requis pour REMPLIR le formulaire ;
  // GitHub demandera juste une connexion pour POSTER l'issue (compte gratuit).
  const CONTRIB_REPO_URL = "https://github.com/Konsilion/grilles-parlement-riviere-isere";
  // Rappel de cohérence : l'URL du dépôt ci-dessus doit rester celle du site
  // servi (github.io → dépôt Konsilion/grilles-parlement-riviere-isere).

  const elsC = {
    btn: document.getElementById("propose-btn"),
    modal: document.getElementById("contribute-modal"),
    form: document.getElementById("contribute-form"),
    success: document.getElementById("contribute-success"),
    link: document.getElementById("contribute-link"),
    title: document.getElementById("c-title"),
    authors: document.getElementById("c-authors"),
    year: document.getElementById("c-year"),
    type: document.getElementById("c-type"),
    url: document.getElementById("c-url"),
    abstract: document.getElementById("c-abstract"),
    gotcha: document.getElementById("c-gotcha"),
  };

  // Message d'erreur sous un champ (un seul à la fois par champ).
  function setFieldError(input, msg) {
    if (!input) return;
    let err = input.parentElement.querySelector(".field-error");
    if (msg) {
      input.classList.add("invalid");
      if (!err) {
        err = document.createElement("p");
        err.className = "field-error";
        input.parentElement.appendChild(err);
      }
      err.textContent = msg;
    } else {
      input.classList.remove("invalid");
      if (err) err.remove();
    }
  }

  function openContributeModal() {
    // Sécurité : une seule modale à la fois (referme la modale détail).
    if (els.modal.getAttribute("aria-hidden") === "false") closeModal();
    // Réinitialisation : formulaire visible, confirmation masquée
    elsC.form.hidden = false;
    elsC.success.hidden = true;
    elsC.form.reset();
    [elsC.title, elsC.url, elsC.year].forEach((i) => setFieldError(i, null));
    elsC.modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    if (EMBED_MODE) positionEmbedModal(elsC.btn, elsC.modal, elsC.modal.querySelector(".modal-backdrop"), elsC.modal.querySelector(".modal-content"));
    setTimeout(() => elsC.title.focus(), 50);
  }

  function closeContributeModal() {
    elsC.modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    if (EMBED_MODE) {
      elsC.modal.style.top = "";
      elsC.modal.querySelector(".modal-backdrop").style.top = "";
      elsC.modal.querySelector(".modal-backdrop").style.height = "";
    }
  }

  // Validation légère, messages en français simple.
  function validateContribution() {
    let ok = true;
    const title = elsC.title.value.trim();
    const url = elsC.url.value.trim();
    const year = elsC.year.value.trim();

    if (!title) {
      setFieldError(elsC.title, "Le titre est nécessaire pour que l'équipe vérifie le document.");
      ok = false;
    } else if (title.length < 3) {
      setFieldError(elsC.title, "Le titre paraît trop court — quelques mots suffisent.");
      ok = false;
    } else {
      setFieldError(elsC.title, null);
    }

    let urlOk = false;
    try {
      const u = new URL(url);
      urlOk = u.protocol === "http:" || u.protocol === "https:";
    } catch { /* invalide */ }
    if (!urlOk) {
      setFieldError(elsC.url, "Collez une adresse web complète commençant par https:// (ou http://).");
      ok = false;
    } else {
      setFieldError(elsC.url, null);
    }

    if (year && !/^\d{4}$/.test(year)) {
      setFieldError(elsC.year, "L'année est un nombre à 4 chiffres (ex. 2024) — ou laissez vide.");
      ok = false;
    } else {
      setFieldError(elsC.year, null);
    }

    return ok;
  }

  // Corps de l'issue : partie lisible (pour le néophyte et la modération
  // humaine) + bloc technique délimité, parsé par scripts/valider_contribution.py.
  function buildIssueBody(d) {
    const typ = d.type || "Document";
    const lines = [
      "## Proposition de document",
      "",
      "Un·e visiteur de la médiathèque propose d'ajouter ce document à la bibliothèque.",
      "",
      "| Champ | Valeur |",
      "| --- | --- |",
      `| Titre | ${d.title} |`,
    ];
    if (d.authors) lines.push(`| Auteur·e·s / organisation | ${d.authors} |`);
    lines.push(`| Type | ${typ} |`);
    if (d.year) lines.push(`| Année | ${d.year} |`);
    lines.push(`| Lien | ${d.url} |`);
    if (d.abstract) lines.push(`| Résumé | ${d.abstract} |`);

    // Données brutes pour la modération (la modale ne propose que des types
    // connus du front ; le script de modération revalide et refuse l'inconnu).
    const payload = {
      title: d.title, authors: d.authors, type: typ, year: d.year,
      url: d.url, abstract: d.abstract,
    };
    lines.push("", "```json-contribution", JSON.stringify(payload), "```", "");
    lines.push("### Modération (équipe)", "",
      "Une fois le document vérifié (lien accessible, pertinence, pas de doublon) :",
      "",
      "```bash",
      "python3 scripts/valider_contribution.py --liste",
      "python3 scripts/valider_contribution.py <n° de l'issue>",
      "```",
      "",
      "La validation crée la fiche Zotero, ferme cette issue et le prochain",
      "`deploy.sh` publie le document sur la médiathèque.");
    return lines.join("\n");
  }

  function buildIssueUrl(d) {
    const params = new URLSearchParams();
    params.set("title", `Contribution : ${d.title}`);
    params.set("body", buildIssueBody(d));
    params.set("labels", "contribution");
    return `${CONTRIB_REPO_URL}/issues/new?${params.toString()}`;
  }

  function submitContribution() {
    // Piège à robots rempli → on fait semblant de réussir sans rien envoyer.
    if (elsC.gotcha && elsC.gotcha.value) return showContributeSuccess();
    if (!validateContribution()) return;

    const d = {
      title: elsC.title.value.trim(),
      authors: elsC.authors.value.trim(),
      year: elsC.year.value.trim(),
      type: elsC.type.value,
      url: elsC.url.value.trim(),
      abstract: elsC.abstract.value.trim(),
    };
    const issueUrl = buildIssueUrl(d);
    elsC.link.href = issueUrl;
    showContributeSuccess();
    window.open(issueUrl, "_blank", "noopener");
  }

  function showContributeSuccess() {
    elsC.form.hidden = true;
    elsC.success.hidden = false;
  }

  // ---------- Listeners globaux ----------
  function attachListeners() {
    let searchTimer = null;
    els.search.addEventListener("input", (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.searchText = e.target.value;
        state.currentPage = 0; // tout filtre ramène à la page 1 (calque alpas)
        render();
      }, 150);
    });

    // Filtre Année : le dropdown commun gère le clic bouton, le clic-dehors
    // et Échap (focus rendu au bouton) — aucun listener doublé ici.

    if (els.pageSizeSelect) {
      els.pageSizeSelect.addEventListener("change", (e) => {
        state.pageSize = e.target.value;
        state.currentPage = 0; // changement de taille de page → retour page 1
        render();
      });
    }

    els.resetBtn.addEventListener("click", () => {
      state.searchText = "";
      state.selectedYears.clear();
      state.selectedTypes.clear();
      state.currentPage = 0;
      els.search.value = "";
      yearDD.syncUI(); // cases décochées + pill « Toutes les années »
      yearDD.setOpen(false);
      render();
    });

    els.modal.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", closeModal);
    });
    // Échap : priorité au menu Année (fermé par le dropdown commun, qui
    // rend le focus au bouton) — la modale ne se ferme que si le menu
    // était déjà fermé (comportement d'origine).
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (els.yearMenu.classList.contains("open")) return;
      if (els.modal.getAttribute("aria-hidden") === "false") {
        closeModal();
      }
    });

    els.modalBibtex.addEventListener("click", async () => {
      const key = els.modalBibtex.dataset.key;
      const item = state.items.find((i) => i.key === key);
      if (!item) return;
      const bib = buildBibtex(item);
      const ok = await copyToClipboard(bib);
      els.modalCopied.textContent = ok ? "✓ Citation BibTeX copiée !" : "⚠️ Copie impossible — sélectionne manuellement.";
    });

    // ----- Modale contribution -----
    if (elsC.btn && elsC.modal) {
      elsC.btn.addEventListener("click", openContributeModal);
      elsC.modal.querySelectorAll("[data-cclose]").forEach((el) => {
        el.addEventListener("click", closeContributeModal);
      });
      elsC.form.addEventListener("submit", (e) => {
        e.preventDefault();
        submitContribution();
      });
      // Échap : referme la modale contribution (le handler global Échap
      // ne connaît que la modale détail — priorité contribution ouverte).
      document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (elsC.modal.getAttribute("aria-hidden") === "false") {
          if (els.yearMenu.classList.contains("open")) return; // menu Année prioritaire
          closeContributeModal();
        }
      });
    }
  }

  // ---------- Boot ----------
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

  document.addEventListener("DOMContentLoaded", () => {
    attachListeners();
    loadCollection();
    if (EMBED_MODE) {
      // Hauteur initiale + suivi continu (grille, filtres, resize du navigateur)
      notifyHeight();
      window.addEventListener("load", notifyHeight);
      if ("ResizeObserver" in window) {
        new ResizeObserver(() => notifyHeight()).observe(document.body);
      }
    }
  });
})();
