/* =========================================================
   GrilleDetail — définition « personnes »

   Le pop-up de détail d'une fiche personne, consommé par :
   - l'app Personnes elle-même (clic sur une carte) ;
   - toute autre app qui l'ouvre à distance (ex. Actualités,
     fiche personne) via GrilleDetail.openFrom().

   Contrat de remplissage = le contrat C2 de data/personnes.json :
   { id, nom, description, organisation, lieu, date_contact,
     lien, email, telephone, role, categories, date_ajout }.

   Styles propres (avatar, tête de modale) : common/css/details/
   personnes.css, scopés .gd-modal (auto-injecté par l'engine).
   ========================================================= */
window.GrilleDetail && window.GrilleDetail.register("personnes", {
  css: "css/details/personnes.css",

  html: `
    <div class="modal" data-gd-root="personnes" aria-hidden="true" role="dialog" aria-modal="true">
      <div class="modal-backdrop" data-close></div>
      <div class="modal-content" role="document">
        <button class="modal-close" type="button" data-close aria-label="Fermer">×</button>
        <div class="modal-head">
          <span class="avatar" data-gd="avatar" aria-hidden="true"></span>
          <div class="modal-title-block">
            <h2 class="modal-title" data-gd="title"></h2>
            <p class="modal-org" data-gd="org"></p>
          </div>
        </div>
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

  helpers: {
    // Initiales de l'avatar (2 max) — même règle que les cartes
    // de l'app Personnes ; exposée pour un futur usage distant.
    initialsOf(nom) {
      const parts = String(nom || "").trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return "?";
      return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join("");
    },
  },

  fill(root, item) {
    const esc = window.GrilleDom.esc;
    const formatDate = window.GrilleDom.formatDate;
    const q = (n) => root.querySelector('[data-gd="' + n + '"]');

    // Tête de modale : avatar initiales + nom + organisation
    // (organisation masquée si absente).
    q("avatar").textContent = this.helpers.initialsOf(item.nom);
    q("title").textContent = item.nom || "(sans nom)";

    const org = q("org");
    if (item.organisation) {
      org.textContent = item.organisation;
      org.style.display = "";
    } else {
      org.textContent = "";
      org.style.display = "none";
    }

    // Ligne meta : rôle · lieu · « Rencontrée le : … » · « Ajouté le … »
    const segs = [];
    if (item.role) segs.push(item.role);
    if (item.lieu) segs.push(item.lieu);
    if (item.date_contact) segs.push("Rencontrée le : " + formatDate(item.date_contact));
    if (item.date_ajout) segs.push("Ajouté le " + formatDate(item.date_ajout));
    q("meta").textContent = segs.join(" · ");

    // Catégories en pastilles
    q("cats").innerHTML = (item.categories || [])
      .map((c) => `<span class="card-tag">${esc(c)}</span>`)
      .join("");

    // Description (section masquée si vide)
    if (item.description && item.description.trim()) {
      q("desc-section").style.display = "";
      q("description").textContent = item.description;
    } else {
      q("desc-section").style.display = "none";
    }

    // Coordonnées : email (mailto:), téléphone (tel:, espaces
    // retirés), lien externe (http/s, _blank) — seules les
    // coordonnées présentes ; section masquée si aucune.
    const coords = q("coords");
    coords.innerHTML = "";
    const addCoord = (label, value, href, external) => {
      const li = document.createElement("li");
      li.className = "coord";
      const lab = document.createElement("span");
      lab.className = "coord-label";
      lab.textContent = label;
      const a = document.createElement("a");
      a.href = href;
      if (external) {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
      a.textContent = value;
      li.append(lab, a);
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
