/* =========================================================
   GrilleDetail — définition « mediatheque » (bibliothèque Zotero)

   Le pop-up de détail d'un document, consommé par :
   - l'app Médiathèque elle-même (clic sur une carte) ;
   - toute autre app qui l'ouvre à distance (ex. Actualités)
     via GrilleDetail.openFrom().

   Contrat de remplissage = contrat de data/collection.json :
   { key, title, authors, year, type, abstract, url, doi, tags, dateAdded }.

   Spécifique médiathèque : badge type coloré (TYPE_CLASS_MAP), ligne
   meta « Par : … · 📅 … · Ajouté le … » (segments absents omis), résumé
   pre-wrap, bouton source (url | doi.org/<doi>), copie BibTeX et
   ancrage du mode intégré. Les utilitaires (typeClass, formatAuthors,
   formatAuthorsShort, buildBibtex, copyToClipboard) vivent ICI et
   sont exposés via helpers — l'app les consomme pour ses cartes.
   ========================================================= */
(() => {
  "use strict";

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

  // ---------- Auteurs ----------
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

  // Ligne meta compacte : « Par : <auteurs> · 📅 <année> · Ajouté le <date> ».
  // Chaque segment absent de l'item est omis ; seuls les segments présents
  // sont séparés par « · ». Les auteurs absents restent « Auteur inconnu »
  // (comportement formatAuthors conservé).
  function renderMetaLine(lineEl, item) {
    const segments = [];
    const authors = formatAuthors(item.authors);
    if (authors) segments.push(`Par : ${authors}`);
    if (item.year) segments.push(`📅 ${item.year}`);
    if (item.dateAdded) segments.push(`Ajouté le ${item.dateAdded}`);
    lineEl.textContent = "";
    segments.forEach((seg, i) => {
      if (i > 0) lineEl.append(" · ");
      if (seg.startsWith("Par : ")) {
        const span = document.createElement("span");
        span.className = "modal-meta-authors";
        span.textContent = seg;
        lineEl.append(span);
      } else {
        lineEl.append(seg);
      }
    });
  }

  window.GrilleDetail && window.GrilleDetail.register("mediatheque", {
    css: "css/details/mediatheque.css",

    html: `
      <div class="modal" data-gd-root="mediatheque" aria-hidden="true" role="dialog" aria-modal="true">
        <div class="modal-backdrop" data-close></div>
        <div class="modal-content" role="document">
          <button class="modal-close" type="button" data-close aria-label="Fermer">×</button>
          <span class="modal-type" data-gd="type"></span>
          <h2 class="modal-title" data-gd="title"></h2>
          <p class="modal-meta-line" data-gd="meta"></p>
          <div class="modal-tags" data-gd="tags"></div>
          <div class="modal-section">
            <h3>Résumé</h3>
            <p class="modal-abstract" data-gd="abstract"></p>
          </div>
          <div class="modal-actions">
            <a class="btn btn-primary" data-gd="source" href="#" target="_blank" rel="noopener">
              Ouvrir la source
            </a>
            <button type="button" class="btn btn-secondary" data-gd="bibtex">
              Copier la citation BibTeX
            </button>
          </div>
          <p class="copied-msg" data-gd="copied" aria-live="polite"></p>
        </div>
      </div>`,

    fill(root, item) {
      const esc = window.GrilleDom.esc;
      const q = (n) => root.querySelector('[data-gd="' + n + '"]');

      // Badge type coloré + titre
      const typeEl = q("type");
      typeEl.textContent = item.type || "Document";
      typeEl.className = "modal-type " + typeClass(item.type);
      q("title").textContent = item.title;

      // Ligne meta (segments absents omis)
      renderMetaLine(q("meta"), item);

      // Tags (conservés en modale)
      q("tags").innerHTML = (item.tags || [])
        .map((t) => `<span class="card-tag">${esc(t)}</span>`)
        .join("");

      // Résumé pre-wrap ; absent → mention atténuée
      const abstractEl = q("abstract");
      if (item.abstract && item.abstract.trim()) {
        abstractEl.textContent = item.abstract;
        abstractEl.classList.remove("empty");
      } else {
        abstractEl.textContent = "Pas de résumé disponible.";
        abstractEl.classList.add("empty");
      }

      // Bouton source : url | doi.org/<doi>, sinon désactivé
      const sourceEl = q("source");
      const sourceUrl = item.url || (item.doi ? `https://doi.org/${item.doi}` : null);
      if (sourceUrl) {
        sourceEl.href = sourceUrl;
        sourceEl.classList.remove("disabled");
        sourceEl.textContent = "Ouvrir la source";
      } else {
        sourceEl.removeAttribute("href");
        sourceEl.classList.add("disabled");
        sourceEl.textContent = "Pas de lien disponible";
      }

      // Copie BibTeX : onclick (propriété, ré-affectée à chaque
      // remplissage — aucun empilement de listeners).
      const bibtexEl = q("bibtex");
      bibtexEl.dataset.key = item.key;
      bibtexEl.onclick = async () => {
        const bib = buildBibtex(item);
        const ok = await copyToClipboard(bib);
        q("copied").textContent = ok
          ? "✓ Citation BibTeX copiée !"
          : "⚠️ Copie impossible — sélectionne manuellement.";
      };
      q("copied").textContent = "";
    },

    helpers: { typeClass, formatAuthors, formatAuthorsShort, buildBibtex, copyToClipboard },

    // Mode intégré (?mode=integre, iframe parlement-isere.org) : l'iframe
    // est haute comme son contenu, sans défilement propre — un placement
    // « fixed » centrerait la modale hors du champ visible. On l'ancre sur
    // la carte cliquée (top = carte - 16px), le voile couvre tout le
    // document, puis on centre la modale dans le champ.
    onOpen(root, triggerEl) {
      if (document.documentElement.getAttribute("data-embed") !== "1") return;
      const backdrop = root.querySelector(".modal-backdrop");
      const content = root.querySelector(".modal-content");
      const top = triggerEl
        ? Math.max(8, Math.round(triggerEl.getBoundingClientRect().top) - 16)
        : 16;
      root.style.top = top + "px";
      backdrop.style.top = -top + "px";
      backdrop.style.height = document.documentElement.scrollHeight + "px";
      requestAnimationFrame(() => {
        content.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    },

    // Reset de l'ancrage embed (l'engine gère aria-hidden + scroll-lock).
    onClose(root) {
      if (document.documentElement.getAttribute("data-embed") !== "1") return;
      const backdrop = root.querySelector(".modal-backdrop");
      root.style.top = "";
      backdrop.style.top = "";
      backdrop.style.height = "";
    },
  });
})();
