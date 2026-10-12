/* =========================================================
   GrilleDetail — définition « actualites »

   Le pop-up de détail d'une actualité NATIVE (type evenement
   ou information, source_app vide), consommé par :
   - l'app Actualités elle-même (clic n'importe où sur la
     carte — règle CEO 13/10/26) ;
   - toute autre app qui l'ouvre à distance via
     GrilleDetail.openFrom().

   Le contrat de remplissage = le contrat data/actualites.json
   (fiche native) : { id, type, titre, description, date_debut,
   date_fin, lieu, lien, date_ajout, source_message_id,
   zotero_key, date_modif, source_app }.

   Les fiches AGRÉGÉES (source_app non vide : un média, un
   contact, un projet…) ne passent PAS par ici : le clic sur
   leur carte ouvre le pop-up de L'APP CIBLE (GrilleDetail.
   openFrom — socle detail.js), qui remplit avec le contrat
   riche de l'app cible.

   Aucun style propre : badge (.card-type), blocs structurels
   (titre, meta, section, coordonnées) et fermetures viennent
   des socles communs (base.css + modal.css + actualites/
   css/style.css, déjà chargés par la page).
   ========================================================= */
window.GrilleDetail && window.GrilleDetail.register("actualites", {
  html: `
    <div class="modal" data-gd-root="actualites" aria-hidden="true" role="dialog" aria-modal="true">
      <div class="modal-backdrop" data-close></div>
      <div class="modal-content" role="document">
        <button class="modal-close" type="button" data-close aria-label="Fermer">×</button>
        <span class="card-type" data-gd="type"></span>
        <h2 class="modal-title" data-gd="title"></h2>
        <p class="modal-meta-line" data-gd="meta"></p>
        <div class="modal-section" data-gd="desc-section">
          <h3>Description</h3>
          <p class="modal-description" data-gd="description"></p>
        </div>
        <div class="modal-section" data-gd="coords-section">
          <h3>En savoir plus</h3>
          <ul class="modal-coords" data-gd="coords"></ul>
        </div>
      </div>
    </div>`,

  // Libellés des 10 types + slug de couleur : registre TYPES de
  // l'app, exposé par actualites/js/app.js en window.ACTUALITES_TYPES
  // (le const local n'est PAS visible depuis ce fichier).
  helpers: {},

  fill(root, item) {
    const esc = window.GrilleDom.esc;
    const formatDate = window.GrilleDom.formatDate;
    const q = (n) => root.querySelector('[data-gd="' + n + '"]');

    // Badge type coloré (calque carte : .card-type.type-<slug>,
    // palette définie dans actualites/css/style.css).
    const t = (window.ACTUALITES_TYPES && window.ACTUALITES_TYPES[item.type]) || {
      label: item.type || "Actualité",
      slug: "autre",
    };
    const typeEl = q("type");
    typeEl.textContent = t.label;
    typeEl.className = "card-type type-" + (t.slug || "autre");

    q("title").textContent = item.titre || "(sans titre)";

    // Ligne meta : période · lieu · Ajouté le
    const segs = [];
    const de = (item.date_debut || "").trim();
    const fi = (item.date_fin || "").trim();
    if (de && fi && de !== fi) segs.push(`Du ${formatDate(de)} au ${formatDate(fi)}`);
    else if (de) segs.push(`Le ${formatDate(de)}`);
    if (item.lieu) segs.push(item.lieu);
    if (item.date_ajout) segs.push(`Ajouté le ${formatDate(item.date_ajout)}`);
    q("meta").textContent = segs.join(" · ");

    // Description
    if (item.description && item.description.trim()) {
      q("desc-section").style.display = "";
      q("description").textContent = item.description;
    } else {
      q("desc-section").style.display = "none";
    }

    // Coordonnées : lien externe http/s SEUL
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
