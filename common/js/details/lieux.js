/* =========================================================
   GrilleDetail — définition « lieux »

   Le pop-up de détail d'un lieu, consommé par :
   - l'app Lieux elle-même (clic sur une carte) ;
   - toute autre app qui l'ouvre à distance (ex. Actualités,
     lien « Voir le lieu ») via GrilleDetail.openFrom().

   Le contrat de remplissage = le contrat data/lieux.json :
   { id, nom, description, adresse, lien, categories,
     date_ajout }.
   Aucun style propre : la modale n'utilise QUE les blocs
   structurels du socle (common/css/modal.css).
   ========================================================= */
window.GrilleDetail && window.GrilleDetail.register("lieux", {
  html: `
    <div class="modal" data-gd-root="lieux" aria-hidden="true" role="dialog" aria-modal="true">
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

    // Ligne meta : adresse · Ajouté le
    const segs = [];
    if (item.adresse) segs.push(item.adresse);
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

    // Coordonnées : lien externe http/s SEUL (pas d'email ni de
    // téléphone dans le contrat Lieux)
    const coords = q("coords");
    coords.innerHTML = "";
    if (item.lien && /^https?:\/\//i.test(item.lien)) {
      const li = document.createElement("li");
      li.className = "coord";
      const lab = document.createElement("span");
      lab.className = "coord-label";
      lab.textContent = "Lien";
      const a = document.createElement("a");
      a.href = item.lien;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = item.lien;
      li.append(lab, a);
      coords.appendChild(li);
    }
    q("coords-section").style.display = coords.children.length ? "" : "none";
  },
});
