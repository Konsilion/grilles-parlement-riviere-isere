/* =========================================================
   GrilleDetail — définition « projets »

   Le pop-up de détail d'un projet, consommé par :
   - l'app Projets elle-même (clic sur une carte) ;
   - toute autre app qui l'ouvre à distance (ex. Actualités,
     lien « Voir le projet ») via GrilleDetail.openFrom().

   Le contrat de remplissage = le contrat de data/projets.json :
   { id, titre, description, porteur, lieu, date_debut, date_fin,
     lien, statut, categories, date_ajout }.

   Conteneur et blocs structurels (.modal, .modal-content,
   .btn/.btn-primary…) : socle commun common/css/modal.css.
   Vignettes de statut de la modale (.modal-type.statut-*) :
   common/css/details/projets.css.
   ========================================================= */

/* Statut effectif : renseigné, sinon déduit des dates (Terminé si
   fin passée, À venir si début futur, En cours sinon, En
   construction sans aucune date). */
function gdStatutOf(item) {
  if (item.statut) return item.statut;
  const parseISO = window.GrilleDom.parseISO;
  const today = new Date();
  const debut = parseISO(item.date_debut || "");
  const fin = parseISO(item.date_fin || "");
  if (!debut && !fin) return "En construction";
  if (fin && fin < today) return "Terminé";
  if (debut && debut > today) return "À venir";
  return "En cours";
}

function gdStatutSlug(statut) {
  const STATUTS = {
    "En cours": "en-cours",
    "À venir": "a-venir",
    "Terminé": "termine",
    "En construction": "en-construction",
  };
  return STATUTS[statut] || "autre";
}

/* Période affichée : « Du … au … » / « À partir du … » / « Jusqu'au … » */
function gdFormatPeriode(item) {
  const formatDate = window.GrilleDom.formatDate;
  const de = (item.date_debut || "").trim();
  const fi = (item.date_fin || "").trim();
  if (de && fi && de !== fi) return `Du ${formatDate(de)} au ${formatDate(fi)}`;
  if (de) return `À partir du ${formatDate(de)}`;
  if (fi) return `Jusqu'au ${formatDate(fi)}`;
  return "";
}

window.GrilleDetail && window.GrilleDetail.register("projets", {
  css: "css/details/projets.css",

  html: `
    <div class="modal" data-gd-root="projets" aria-hidden="true" role="dialog" aria-modal="true">
      <div class="modal-backdrop" data-close></div>
      <div class="modal-content" role="document">
        <button class="modal-close" type="button" data-close aria-label="Fermer">×</button>
        <span class="card-type modal-type" data-gd="statut"></span>
        <h2 class="modal-title" data-gd="title"></h2>
        <p class="modal-meta-line" data-gd="meta"></p>
        <div class="modal-tags" data-gd="cats"></div>
        <div class="modal-section" data-gd="desc-section">
          <h3>Description</h3>
          <p class="modal-description" data-gd="description"></p>
        </div>
        <div class="modal-actions">
          <a class="btn btn-primary" data-gd="source" href="#" target="_blank" rel="noopener noreferrer">
            Ouvrir le lien du projet
          </a>
        </div>
      </div>
    </div>`,

  fill(root, item) {
    const esc = window.GrilleDom.esc;
    const formatDate = window.GrilleDom.formatDate;
    const q = (n) => root.querySelector('[data-gd="' + n + '"]');

    q("title").textContent = item.titre || "(sans titre)";

    // Ligne meta : porteur · période · lieu · ajouté le
    const segs = [];
    if (item.porteur) segs.push(item.porteur);
    const periode = gdFormatPeriode(item);
    if (periode) segs.push(periode);
    if (item.lieu) segs.push(item.lieu);
    if (item.date_ajout) segs.push("Ajouté le " + formatDate(item.date_ajout));
    q("meta").textContent = segs.join(" · ");

    // Vignette statut colorée (statut renseigné sinon déduit des dates)
    const statut = gdStatutOf(item);
    q("statut").className = "card-type modal-type statut-" + gdStatutSlug(statut);
    q("statut").textContent = statut;

    q("cats").innerHTML = (item.categories || [])
      .map((c) => `<span class="card-tag">${esc(c)}</span>`)
      .join("");

    if (item.description && item.description.trim()) {
      q("desc-section").style.display = "";
      q("description").textContent = item.description;
    } else {
      q("desc-section").style.display = "none";
    }

    // Lien du projet : masqué si absent/non-http
    const src = q("source");
    if (item.lien && /^https?:\/\//i.test(item.lien)) {
      src.style.display = "";
      src.href = item.lien;
    } else {
      src.style.display = "none";
    }
  },

  helpers: {
    statutOf: gdStatutOf,
    statutSlug: gdStatutSlug,
    formatPeriode: gdFormatPeriode,
  },
});
