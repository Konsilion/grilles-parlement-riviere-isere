/* =========================================================
   Grilles de carte — définitions de formulaires MUTUALISÉS
   (12/10/26, demande CEO « média/outil identiques à ces
   applications, donc communs »).

   Deux définitions, calques EXACTS des formulaires en prod :
   - GrilleForms.media : formulaire « Proposer un document » de la
     MÉDIATHÈQUE (mediatheque/index.html + validate de son app.js) ;
   - GrilleForms.outil : formulaire « Proposer un outil » de
     L'OUTILTHÈQUE (outiltheque/index.html + validate de son app.js).

   Chaque définition est autoportante :
   - html()          : le HTML des champs (ids et libellés IDENTIQUES
                       à l'app d'origine — une seule forme dans le DOM
                       à la fois, aucune collision d'ids) ;
   - get()           : collecte des valeurs saisies ;
   - validate(setErr): calque du validate() de l'app d'origine
                       (setErr = GrilleContribution.setFieldError) ;
   - payload(d)      : champs du corps envoyé (sans le type
                       d'actualité — c'est l'app hôte qui l'ajoute) ;
   - table(d)        : lignes du tableau lisible de l'issue GitHub ;
   - titleOf(d)      : titre de l'issue.

   L'app qui héberge le parcours (Actualités) fournit le type
   d'actualité (media_publie / outil_publie), le relais et la
   validation Zotero ; les CHAMPS restent ceux de l'app d'origine.
   ========================================================= */
window.GrilleForms = (() => {
  "use strict";

  // Types fermés du select médiathèque (14 valeurs, ordre identique).
  const DOC_TYPES = [
    "Rapport", "Article de presse", "Document", "Newsletter",
    "Article de magazine", "Article de revue", "Page web", "Thèse",
    "Livre", "Texte de loi", "Lettre", "Carte", "Audio", "Présentation",
  ];

  const $ = (id) => document.getElementById(id);
  const val = (id) => ($(id) ? $(id).value.trim() : "");

  function isHttpUrl(u) {
    try {
      const parsed = new URL(u);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch { return false; }
  }

  /* ---------- Formulaire MÉDIA (calque médiathèque) ---------- */

  const media = {
    label: "Média publié",
    firstFieldId: "c-title",

    html() {
      const options = DOC_TYPES
        .map((t) => `<option value="${t}">${t}</option>`)
        .join("");
      return `
        <div class="form-row">
          <label for="c-title">Titre du document <span class="req">*</span></label>
          <input type="text" id="c-title" name="title" required maxlength="300" autocomplete="off"
                 placeholder="Ex. : Étude sur la qualité de l'eau du Drac" />
        </div>

        <div class="form-row">
          <label for="c-authors">Auteur·e·s ou organisation</label>
          <input type="text" id="c-authors" name="authors" maxlength="300" autocomplete="off"
                 placeholder="Ex. : Office français de la biodiversité" />
        </div>

        <div class="form-row form-row-2">
          <div>
            <label for="c-year">Année</label>
            <input type="number" id="c-year" name="year" min="1400" max="2100" inputmode="numeric"
                   placeholder="Ex. : 2024" />
          </div>
          <div>
            <label for="c-type">Type de document</label>
            <select id="c-type" name="type">${options}</select>
          </div>
        </div>

        <div class="form-row">
          <label for="c-url">Lien vers le document <span class="req">*</span></label>
          <input type="url" id="c-url" name="url" required maxlength="2000" autocomplete="off"
                 placeholder="https://…" />
          <p class="field-hint">Collez l'adresse web (https://…) où l'on peut consulter ou télécharger le document.</p>
        </div>

        <div class="form-row">
          <label for="c-abstract">Résumé (facultatif)</label>
          <textarea id="c-abstract" name="abstract" rows="4" maxlength="3000"
                    placeholder="En une ou deux phrases : de quoi parle ce document ?"></textarea>
        </div>`;
    },

    get() {
      return {
        titre: val("c-title"),
        authors: val("c-authors"),
        year: val("c-year"),
        doc_type: $("c-type") ? $("c-type").value : DOC_TYPES[0],
        url: val("c-url"),
        abstract: val("c-abstract"),
      };
    },

    // Calque exact du validateContribution() de la médiathèque.
    validate(setErr) {
      let ok = true;
      const titre = val("c-title");
      const url = val("c-url");
      const year = val("c-year");

      if (!titre) {
        setErr($("c-title"), "Le titre est nécessaire pour que l'équipe vérifie le document.");
        ok = false;
      } else if (titre.length < 3) {
        setErr($("c-title"), "Le titre paraît trop court — quelques mots suffisent.");
        ok = false;
      } else {
        setErr($("c-title"), null);
      }

      if (!isHttpUrl(url)) {
        setErr($("c-url"), "Collez une adresse web complète commençant par https:// (ou http://).");
        ok = false;
      } else {
        setErr($("c-url"), null);
      }

      if (year && !/^\d{4}$/.test(year)) {
        setErr($("c-year"), "L'année est un nombre à 4 chiffres (ex. 2024) — ou laissez vide.");
        ok = false;
      } else {
        setErr($("c-year"), null);
      }

      return ok;
    },

    payload(d) {
      return {
        titre: d.titre,
        authors: d.authors,
        year: d.year,
        doc_type: d.doc_type,
        url: d.url,
        abstract: d.abstract,
      };
    },

    table(d) {
      const rows = [["Titre", d.titre]];
      if (d.authors) rows.push(["Auteur·e·s / organisation", d.authors]);
      rows.push(["Type de document", d.doc_type]);
      if (d.year) rows.push(["Année", d.year]);
      rows.push(["Lien", d.url]);
      if (d.abstract) rows.push(["Résumé", d.abstract]);
      return rows;
    },

    titleOf(d) { return d.titre; },
  };

  /* ---------- Formulaire OUTIL (calque outilthèque) ---------- */

  const outil = {
    label: "Outil publié",
    firstFieldId: "c-nom",

    html() {
      return `
        <div class="form-row">
          <label for="c-nom">Nom de l'outil <span class="req">*</span></label>
          <input type="text" id="c-nom" name="nom" required maxlength="300" autocomplete="off"
                 placeholder="Ex. : tableau blanc géant, jeu de rôle, vidéo-projecteur…" />
        </div>

        <div class="form-row form-row-2">
          <div>
            <label for="c-categorie">Catégorie</label>
            <input type="text" id="c-categorie" name="categorie" maxlength="300" autocomplete="off"
                   placeholder="Ex. : Jeu sérieux, Vidéoprojecteur…" />
          </div>
          <div>
            <label for="c-lieu">Lieu</label>
            <input type="text" id="c-lieu" name="lieu" maxlength="300" autocomplete="off"
                   placeholder="Ex. : Grenoble, en ligne…" />
          </div>
        </div>

        <div class="form-row">
          <label for="c-description">Description (facultatif)</label>
          <textarea id="c-description" name="description" rows="4" maxlength="3000"
                    placeholder="En une ou deux phrases : que fait cet outil, quel lien avec la rivière Isère ?"></textarea>
        </div>

        <div class="form-row">
          <label for="c-url">Lien (facultatif)</label>
          <input type="url" id="c-url" name="url" maxlength="2000" autocomplete="off"
                 placeholder="https://…" />
          <p class="field-hint">Site officiel, page de présentation…</p>
        </div>`;
    },

    get() {
      return {
        nom: val("c-nom"),
        categorie: val("c-categorie"),
        lieu: val("c-lieu"),
        description: val("c-description"),
        url: val("c-url"),
      };
    },

    // Calque exact du validate() de l'app outilthèque.
    validate(setErr) {
      let ok = true;
      const nom = val("c-nom");

      if (!nom) {
        setErr($("c-nom"), "Le nom est nécessaire pour que l'équipe vérifie l'outil.");
        ok = false;
      } else if (nom.length < 3) {
        setErr($("c-nom"), "Le nom paraît trop court — quelques mots suffisent.");
        ok = false;
      } else {
        setErr($("c-nom"), null);
      }

      const url = val("c-url");
      if (url) {
        if (!isHttpUrl(url)) {
          setErr($("c-url"), "Collez une adresse web complète commençant par https:// (ou http://).");
          ok = false;
        } else {
          setErr($("c-url"), null);
        }
      }

      return ok;
    },

    payload(d) {
      return {
        nom: d.nom,
        categorie: d.categorie,
        lieu: d.lieu,
        description: d.description,
        url: d.url,
      };
    },

    table(d) {
      const rows = [["Nom", d.nom]];
      if (d.categorie) rows.push(["Catégorie", d.categorie]);
      if (d.lieu) rows.push(["Lieu", d.lieu]);
      if (d.description) rows.push(["Description", d.description]);
      rows.push(["Lien", d.url || "—"]);
      return rows;
    },

    titleOf(d) { return d.nom; },
  };

  return { media, outil };
})();
