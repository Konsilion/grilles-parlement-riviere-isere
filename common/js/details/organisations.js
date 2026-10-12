/* =========================================================
   GrilleDetail — définition « organisations »

   Le pop-up de détail d'une organisation, consommé par :
   - l'app Organisations elle-même (clic sur une carte) ;
   - toute autre app qui l'ouvre à distance (ex. Actualités,
     lien « Voir l'organisation ») via GrilleDetail.openFrom().

   Le contrat de remplissage = le contrat data/organisations.json :
   { id, nom, description, lieu, lien, email, telephone,
     categories, date_ajout }.
   Aucun style propre : la modale n'utilise QUE les blocs
   structurels du socle (common/css/modal.css).
   ========================================================= */
window.GrilleDetail && window.GrilleDetail.register("organisations", {
  html: `
    <div class="modal" data-gd-root="organisations" aria-hidden="true" role="dialog" aria-modal="true">
      <div class="modal-backdrop" data-close></div>
      <div class="modal-content" role="document">
        <button class="modal-close" type="button" data-close aria-label="Fermer">×</button>
        <h2 class="modal-title" data-gd="title"></h2>
        <p class="modal-meta-line" data-gd="meta"></p>
        <div class="modal-tags" data-gd="cats"></div>
        <div class="modal-section" data-gd="desc-section">
          <h3>Description</h3>
          <p class="modal-description" data-gd="description"></p>
        </div>
        <div class="modal-section" data-gd="coords-section">
          <h3>Coordonnées</h3>
          <ul class="modal-coords" data-gd="coords"></ul>
        </div>
      </div>
    </div>`,

  fill(root, item) {
    const esc = window.GrilleDom.esc;
    const formatDate = window.GrilleDom.formatDate;
    const q = (n) => root.querySelector('[data-gd="' + n + '"]');

    q("title").textContent = item.nom || "(sans nom)";

    // Ligne meta : lieu · Ajouté le
    const segs = [];
    if (item.lieu) segs.push(item.lieu);
    if (item.date_ajout) segs.push("Ajouté le " + formatDate(item.date_ajout));
    q("meta").textContent = segs.join(" · ");

    q("cats").innerHTML = (item.categories || [])
      .map((c) => `<span class="card-tag">${esc(c)}</span>`)
      .join("");

    if (item.description && item.description.trim()) {
      q("desc-section").style.display = "";
      q("description").textContent = item.description;
    } else {
      q("desc-section").style.display = "none";
    }

    // Coordonnées : email (mailto:), téléphone (tel:), lien externe http/s
    const coords = q("coords");
    coords.innerHTML = "";
    const addCoord = (label, value, href, external) => {
      const li = document.createElement("li");
      li.className = "coord";
      const lab = document.createElement("span");
      lab.className = "coord-label";
      lab.textContent = label;
      li.append(lab);
      const a = document.createElement("a");
      a.href = href;
      if (external) {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
      a.textContent = value;
      li.appendChild(a);
      coords.appendChild(li);
    };
    if (item.email) addCoord("Email", item.email, "mailto:" + item.email, false);
    if (item.telephone) {
      addCoord("Téléphone", item.telephone, "tel:" + item.telephone.replace(/\s+/g, ""), false);
    }
    if (item.lien && /^https?:\/\//i.test(item.lien)) {
      addCoord("Lien", item.lien, item.lien, true);
    }
    q("coords-section").style.display = coords.children.length ? "" : "none";
  },
});
