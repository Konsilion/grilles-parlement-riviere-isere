/* =========================================================
   Grilles de carte — définitions de formulaires MUTUALISÉS
   (12/10/26, demande CEO « média/outil identiques à ces
   applications, donc communs » ; lot 4 soir : les 6 types des
   autres apps, même esprit « un seul et même enregistrement »).

   Huit définitions, calques EXACTS des formulaires en prod :
   - GrilleForms.media : formulaire « Proposer un document » de la
     MÉDIATHÈQUE (mediatheque/index.html + validate de son app.js) ;
   - GrilleForms.outil : formulaire « Proposer un outil » de
     L'OUTILTHÈQUE (outiltheque/index.html + validate de son app.js) ;
   - Lot 4 — GrilleForms.personne / projet / organisation / lieu /
     question / idee : calques des formulaires des apps SOURCES
     (personnes/, projets/, organisations/, lieux/, questions/,
     idees/ — index.html + collect/validate/table de leur app.js).
     Leurs ids sont préfixés c-a-<type>- : UNIQUES, aucune collision
     entre formes ni avec les formulaires natifs de l'app hôte →
     AUCUNE purge à l'injection (contrairement aux ids partagés c-*
     de média/outil, qui restent soumis au piège documenté plus bas).

   Chaque définition est autoportante :
   - html()          : le HTML des champs (libellés IDENTIQUES à
                       l'app d'origine) ;
   - get()           : collecte des valeurs saisies ;
   - validate(setErr): calque du validate() de l'app d'origine
                       (setErr = GrilleContribution.setFieldError) ;
   - payload(d)      : champs du corps envoyé (sans le type
                       d'actualité — c'est l'app hôte qui l'ajoute) ;
   - table(d)        : lignes du tableau lisible de l'issue GitHub ;
   - titleOf(d)      : titre de l'issue.

   L'app qui héberge le parcours (Actualités) fournit le type
   d'actualité (media_publie / outil_publie / personne / projet…), le
   relais et la validation Zotero ; les CHAMPS restent ceux de
   l'app d'origine.
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

  /* ---------- Formulaire PERSONNE (calque app Personnes) ---------- */

  const personne = {
    label: "Personne",
    firstFieldId: "c-a-personne-nom",

    html() {
      return `
        <div class="form-row">
          <label for="c-a-personne-nom">Nom et prénom <span class="req">*</span></label>
          <input type="text" id="c-a-personne-nom" name="nom" required maxlength="300" autocomplete="off"
                 placeholder="Ex. : Marie Dupont" />
        </div>

        <div class="form-row form-row-2">
          <div>
            <label for="c-a-personne-organisation">Organisation</label>
            <input type="text" id="c-a-personne-organisation" name="organisation" maxlength="300" autocomplete="off"
                   placeholder="Ex. : Conseil départemental" />
          </div>
          <div>
            <label for="c-a-personne-lieu">Lieu</label>
            <input type="text" id="c-a-personne-lieu" name="lieu" maxlength="300" autocomplete="off"
                   placeholder="Ex. : Grenoble" />
          </div>
        </div>

        <div class="form-row form-row-2">
          <div>
            <label for="c-a-personne-email">E-mail professionnel</label>
            <input type="email" id="c-a-personne-email" name="email" maxlength="300" autocomplete="off"
                   placeholder="marie@example.fr" />
          </div>
          <div>
            <label for="c-a-personne-telephone">Téléphone professionnel</label>
            <input type="tel" id="c-a-personne-telephone" name="telephone" maxlength="50" autocomplete="off"
                   placeholder="Ex. : 04 76 00 00 00" />
          </div>
        </div>

        <div class="form-row">
          <label for="c-a-personne-role">Rôle</label>
          <input type="text" id="c-a-personne-role" name="role" maxlength="300" autocomplete="off"
                 placeholder="Ex. : Élue, chargée de mission…" />
        </div>

        <div class="form-row">
          <label for="c-a-personne-description">Description (facultatif)</label>
          <textarea id="c-a-personne-description" name="description" rows="4" maxlength="3000"
                    placeholder="En une ou deux phrases : qui est cette personne, sur quoi travaille-t-elle ?"></textarea>
        </div>

        <div class="form-row">
          <label for="c-a-personne-url">Lien (facultatif)</label>
          <input type="url" id="c-a-personne-url" name="url" maxlength="2000" autocomplete="off"
                 placeholder="https://…" />
          <p class="field-hint">Profil, site, page de l'organisation…</p>
        </div>`;
    },

    get() {
      return {
        nom: val("c-a-personne-nom"),
        organisation: val("c-a-personne-organisation"),
        lieu: val("c-a-personne-lieu"),
        email: val("c-a-personne-email"),
        telephone: val("c-a-personne-telephone"),
        role: val("c-a-personne-role"),
        description: val("c-a-personne-description"),
        url: val("c-a-personne-url"),
      };
    },

    // Calque exact du validate() de l'app Personnes.
    validate(setErr) {
      let ok = true;
      const nom = val("c-a-personne-nom");
      const email = val("c-a-personne-email");

      if (!nom) {
        setErr($("c-a-personne-nom"), "Le nom est nécessaire pour que l'équipe vérifie la personne.");
        ok = false;
      } else if (nom.length < 3) {
        setErr($("c-a-personne-nom"), "Le nom paraît trop court — prénom et nom suffisent.");
        ok = false;
      } else {
        setErr($("c-a-personne-nom"), null);
      }

      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setErr($("c-a-personne-email"), "Cette adresse e-mail ne semble pas valide.");
        ok = false;
      } else {
        setErr($("c-a-personne-email"), null);
      }

      const url = val("c-a-personne-url");
      if (url) {
        if (!isHttpUrl(url)) {
          setErr($("c-a-personne-url"), "Collez une adresse web complète commençant par https:// (ou http://).");
          ok = false;
        } else {
          setErr($("c-a-personne-url"), null);
        }
      }

      return ok;
    },

    payload(d) {
      return {
        nom: d.nom,
        organisation: d.organisation,
        lieu: d.lieu,
        email: d.email,
        telephone: d.telephone,
        role: d.role,
        description: d.description,
        url: d.url,
      };
    },

    table(d) {
      return [
        ["Nom", d.nom],
        ["Organisation", d.organisation || "—"],
        ["Lieu", d.lieu || "—"],
        ["E-mail", d.email || "—"],
        ["Téléphone", d.telephone || "—"],
        ["Rôle", d.role || "—"],
        ["Description", d.description || "—"],
        ["Lien", d.url || "—"],
      ];
    },

    titleOf(d) { return d.nom; },
  };

  /* ---------- Formulaire PROJET (calque app Projets) ---------- */

  const projet = {
    label: "Projet",
    firstFieldId: "c-a-projet-titre",

    html() {
      return `
        <div class="form-row">
          <label for="c-a-projet-titre">Titre du projet <span class="req">*</span></label>
          <input type="text" id="c-a-projet-titre" name="titre" required maxlength="300" autocomplete="off"
                 placeholder="Ex. : Atlas des zones humides de l'Isère" />
        </div>

        <div class="form-row">
          <label for="c-a-projet-porteur">Porteur <span class="req">*</span></label>
          <input type="text" id="c-a-projet-porteur" name="porteur" required maxlength="300" autocomplete="off"
                 placeholder="Ex. : Parlement de la rivière Isère" />
        </div>

        <div class="form-row">
          <label for="c-a-projet-lieu">Lieu (facultatif)</label>
          <input type="text" id="c-a-projet-lieu" name="lieu" maxlength="300" autocomplete="off"
                 placeholder="Ex. : Grenoble, bassin de l'Isère" />
        </div>

        <div class="form-row form-row-2">
          <div>
            <label for="c-a-projet-date-debut">Date de début (facultatif)</label>
            <input type="date" id="c-a-projet-date-debut" name="date_debut" />
          </div>
          <div>
            <label for="c-a-projet-date-fin">Date de fin (facultatif)</label>
            <input type="date" id="c-a-projet-date-fin" name="date_fin" />
          </div>
        </div>
        <p class="field-hint">Pas encore de dates ? Le projet s'affichera « En construction ».</p>

        <div class="form-row">
          <label for="c-a-projet-description">Description <span class="req">*</span></label>
          <textarea id="c-a-projet-description" name="description" rows="4" maxlength="3000" required
                    placeholder="Ex. : ce que fait le projet, où il se déroule, avec qui…"></textarea>
        </div>

        <div class="form-row">
          <label for="c-a-projet-url">Lien (facultatif)</label>
          <input type="url" id="c-a-projet-url" name="url" maxlength="2000" autocomplete="off"
                 placeholder="https://…" />
          <p class="field-hint">Site du projet, page de présentation, dossier…</p>
        </div>`;
    },

    get() {
      return {
        titre: val("c-a-projet-titre"),
        porteur: val("c-a-projet-porteur"),
        lieu: val("c-a-projet-lieu"),
        date_debut: val("c-a-projet-date-debut"),
        date_fin: val("c-a-projet-date-fin"),
        description: val("c-a-projet-description"),
        url: val("c-a-projet-url"),
      };
    },

    // Calque exact du validate() de l'app projets.
    validate(setErr) {
      let ok = true;
      const titre = val("c-a-projet-titre");
      const porteur = val("c-a-projet-porteur");
      const debut = val("c-a-projet-date-debut");
      const fin = val("c-a-projet-date-fin");
      const description = val("c-a-projet-description");
      const url = val("c-a-projet-url");

      if (!titre) {
        setErr($("c-a-projet-titre"), "Le titre est nécessaire pour que l'équipe vérifie le projet.");
        ok = false;
      } else if (titre.length < 3) {
        setErr($("c-a-projet-titre"), "Le titre paraît trop court — quelques mots suffisent.");
        ok = false;
      } else {
        setErr($("c-a-projet-titre"), null);
      }

      if (!porteur) {
        setErr($("c-a-projet-porteur"), "Le porteur (organisation) est nécessaire.");
        ok = false;
      } else {
        setErr($("c-a-projet-porteur"), null);
      }

      setErr($("c-a-projet-date-debut"), null);

      if (fin && debut && fin < debut) {
        setErr($("c-a-projet-date-fin"), "La date de fin doit suivre la date de début.");
        ok = false;
      } else {
        setErr($("c-a-projet-date-fin"), null);
      }

      if (!description) {
        setErr($("c-a-projet-description"), "La description est nécessaire pour que l'équipe comprenne le projet.");
        ok = false;
      } else {
        setErr($("c-a-projet-description"), null);
      }

      if (url) {
        if (!isHttpUrl(url)) {
          setErr($("c-a-projet-url"), "Collez une adresse web complète commençant par https:// (ou http://).");
          ok = false;
        } else {
          setErr($("c-a-projet-url"), null);
        }
      }

      return ok;
    },

    payload(d) {
      return {
        titre: d.titre,
        porteur: d.porteur,
        lieu: d.lieu,
        date_debut: d.date_debut,
        date_fin: d.date_fin,
        description: d.description,
        url: d.url,
      };
    },

    table(d) {
      return [
        ["Titre", d.titre],
        ["Porteur", d.porteur],
        ["Lieu", d.lieu || "—"],
        ["Date de début", d.date_debut || "—"],
        ["Date de fin", d.date_fin || "—"],
        ["Description", d.description || "—"],
        ["Lien", d.url || "—"],
      ];
    },

    titleOf(d) { return d.titre; },
  };

  /* ---------- Formulaire ORGANISATION (calque app Organisations) ---------- */

  const organisation = {
    label: "Organisation",
    firstFieldId: "c-a-organisation-nom",

    html() {
      return `
        <div class="form-row">
          <label for="c-a-organisation-nom">Nom de l'organisation <span class="req">*</span></label>
          <input type="text" id="c-a-organisation-nom" name="nom" required maxlength="300" autocomplete="off"
                 placeholder="Ex. : Fédération départementale de pêche" />
        </div>

        <div class="form-row">
          <label for="c-a-organisation-lieu">Lieu</label>
          <input type="text" id="c-a-organisation-lieu" name="lieu" maxlength="300" autocomplete="off"
                 placeholder="Ex. : Grenoble" />
        </div>

        <div class="form-row form-row-2">
          <div>
            <label for="c-a-organisation-email">E-mail</label>
            <input type="email" id="c-a-organisation-email" name="email" maxlength="300" autocomplete="off"
                   placeholder="marie@example.fr" />
          </div>
          <div>
            <label for="c-a-organisation-telephone">Téléphone</label>
            <input type="tel" id="c-a-organisation-telephone" name="telephone" maxlength="50" autocomplete="off"
                   placeholder="Ex. : 04 76 00 00 00" />
          </div>
        </div>

        <div class="form-row">
          <label for="c-a-organisation-description">Description (facultatif)</label>
          <textarea id="c-a-organisation-description" name="description" rows="4" maxlength="3000"
                    placeholder="En une ou deux phrases : que fait cette organisation, quel lien avec la rivière Isère ?"></textarea>
        </div>

        <div class="form-row">
          <label for="c-a-organisation-url">Lien (facultatif)</label>
          <input type="url" id="c-a-organisation-url" name="url" maxlength="2000" autocomplete="off"
                 placeholder="https://…" />
          <p class="field-hint">Site officiel, page de présentation…</p>
        </div>`;
    },

    get() {
      return {
        nom: val("c-a-organisation-nom"),
        lieu: val("c-a-organisation-lieu"),
        email: val("c-a-organisation-email"),
        telephone: val("c-a-organisation-telephone"),
        description: val("c-a-organisation-description"),
        url: val("c-a-organisation-url"),
      };
    },

    // Calque exact du validate() de l'app organisations.
    validate(setErr) {
      let ok = true;
      const nom = val("c-a-organisation-nom");
      const email = val("c-a-organisation-email");

      if (!nom) {
        setErr($("c-a-organisation-nom"), "Le nom est nécessaire pour que l'équipe vérifie l'organisation.");
        ok = false;
      } else if (nom.length < 3) {
        setErr($("c-a-organisation-nom"), "Le nom paraît trop court — quelques mots suffisent.");
        ok = false;
      } else {
        setErr($("c-a-organisation-nom"), null);
      }

      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setErr($("c-a-organisation-email"), "Cette adresse e-mail ne semble pas valide.");
        ok = false;
      } else {
        setErr($("c-a-organisation-email"), null);
      }

      const url = val("c-a-organisation-url");
      if (url) {
        if (!isHttpUrl(url)) {
          setErr($("c-a-organisation-url"), "Collez une adresse web complète commençant par https:// (ou http://).");
          ok = false;
        } else {
          setErr($("c-a-organisation-url"), null);
        }
      }

      return ok;
    },

    payload(d) {
      return {
        nom: d.nom,
        lieu: d.lieu,
        email: d.email,
        telephone: d.telephone,
        description: d.description,
        url: d.url,
      };
    },

    table(d) {
      return [
        ["Nom", d.nom],
        ["Lieu", d.lieu || "—"],
        ["E-mail", d.email || "—"],
        ["Téléphone", d.telephone || "—"],
        ["Description", d.description || "—"],
        ["Lien", d.url || "—"],
      ];
    },

    titleOf(d) { return d.nom; },
  };

  /* ---------- Formulaire LIEU (calque app Lieux) ---------- */

  const lieu = {
    label: "Lieu",
    firstFieldId: "c-a-lieu-nom",

    html() {
      return `
        <div class="form-row">
          <label for="c-a-lieu-nom">Nom du lieu <span class="req">*</span></label>
          <input type="text" id="c-a-lieu-nom" name="nom" required maxlength="300" autocomplete="off"
                 placeholder="Ex. : Maison du Parlement de la rivière" />
        </div>

        <div class="form-row">
          <label for="c-a-lieu-adresse">Adresse</label>
          <input type="text" id="c-a-lieu-adresse" name="adresse" maxlength="300" autocomplete="off"
                 placeholder="Ex. : 5 rue de la République, Grenoble" />
        </div>

        <div class="form-row">
          <label for="c-a-lieu-description">Description (facultatif)</label>
          <textarea id="c-a-lieu-description" name="description" rows="4" maxlength="3000"
                    placeholder="En une ou deux phrases : qu'est-ce que ce lieu, quel lien avec la rivière Isère ?"></textarea>
        </div>

        <div class="form-row">
          <label for="c-a-lieu-url">Lien (facultatif)</label>
          <input type="url" id="c-a-lieu-url" name="url" maxlength="2000" autocomplete="off"
                 placeholder="https://…" />
          <p class="field-hint">Site officiel, page de présentation…</p>
        </div>`;
    },

    get() {
      return {
        nom: val("c-a-lieu-nom"),
        adresse: val("c-a-lieu-adresse"),
        description: val("c-a-lieu-description"),
        url: val("c-a-lieu-url"),
      };
    },

    // Calque exact du validate() de l'app lieux.
    validate(setErr) {
      let ok = true;
      const nom = val("c-a-lieu-nom");

      if (!nom) {
        setErr($("c-a-lieu-nom"), "Le nom est nécessaire pour que l'équipe vérifie le lieu.");
        ok = false;
      } else if (nom.length < 3) {
        setErr($("c-a-lieu-nom"), "Le nom paraît trop court — quelques mots suffisent.");
        ok = false;
      } else {
        setErr($("c-a-lieu-nom"), null);
      }

      const url = val("c-a-lieu-url");
      if (url) {
        if (!isHttpUrl(url)) {
          setErr($("c-a-lieu-url"), "Collez une adresse web complète commençant par https:// (ou http://).");
          ok = false;
        } else {
          setErr($("c-a-lieu-url"), null);
        }
      }

      return ok;
    },

    payload(d) {
      return {
        nom: d.nom,
        adresse: d.adresse,
        description: d.description,
        url: d.url,
      };
    },

    table(d) {
      return [
        ["Nom", d.nom],
        ["Adresse", d.adresse || "—"],
        ["Description", d.description || "—"],
        ["Lien", d.url || "—"],
      ];
    },

    titleOf(d) { return d.nom; },
  };

  /* ---------- Formulaire QUESTION (calque app Questions) ---------- */

  const question = {
    label: "Question",
    firstFieldId: "c-a-question-titre",

    html() {
      return `
        <div class="form-row">
          <label for="c-a-question-titre">Titre de la question <span class="req">*</span></label>
          <input type="text" id="c-a-question-titre" name="titre" required maxlength="300" autocomplete="off"
                 placeholder="Ex. : Qualité de l'eau de l'Isère" />
        </div>

        <div class="form-row">
          <label for="c-a-question-question">Votre question <span class="req">*</span></label>
          <textarea id="c-a-question-question" name="question" rows="5" maxlength="3000" required
                    placeholder="Posez votre question complète — elle sera publiée telle quelle, et les réponses viendront dans le fil de discussion."></textarea>
        </div>

        <div class="form-row">
          <label for="c-a-question-deposant">Votre nom (facultatif)</label>
          <input type="text" id="c-a-question-deposant" name="deposant" maxlength="300" autocomplete="off"
                 placeholder="Ex. : Marie Dupont" />
        </div>

        <div class="form-row">
          <label for="c-a-question-description">Contexte (facultatif)</label>
          <textarea id="c-a-question-description" name="description" rows="4" maxlength="3000"
                    placeholder="En une ou deux phrases : le contexte de votre question, ce qui motive votre demande…"></textarea>
        </div>

        <div class="form-row">
          <label for="c-a-question-url">Lien (facultatif)</label>
          <input type="url" id="c-a-question-url" name="url" maxlength="2000" autocomplete="off"
                 placeholder="https://…" />
          <p class="field-hint">Source, référence, page en rapport avec la question…</p>
        </div>`;
    },

    get() {
      return {
        titre: val("c-a-question-titre"),
        question: val("c-a-question-question"),
        deposant: val("c-a-question-deposant"),
        description: val("c-a-question-description"),
        url: val("c-a-question-url"),
      };
    },

    // Calque exact du validate() de l'app questions.
    validate(setErr) {
      let ok = true;
      const titre = val("c-a-question-titre");

      if (!titre) {
        setErr($("c-a-question-titre"), "Le titre est nécessaire pour que l'équipe retrouve votre question.");
        ok = false;
      } else if (titre.length < 3) {
        setErr($("c-a-question-titre"), "Le titre paraît trop court — quelques mots suffisent.");
        ok = false;
      } else {
        setErr($("c-a-question-titre"), null);
      }

      const question = val("c-a-question-question");
      if (!question) {
        setErr($("c-a-question-question"), "Posez votre question — c'est elle qui sera publiée.");
        ok = false;
      } else if (question.length < 10) {
        setErr($("c-a-question-question"), "La question paraît trop courte — formulez-la en une phrase complète.");
        ok = false;
      } else {
        setErr($("c-a-question-question"), null);
      }

      const url = val("c-a-question-url");
      if (url) {
        if (!isHttpUrl(url)) {
          setErr($("c-a-question-url"), "Collez une adresse web complète commençant par https:// (ou http://).");
          ok = false;
        } else {
          setErr($("c-a-question-url"), null);
        }
      }

      return ok;
    },

    payload(d) {
      return {
        titre: d.titre,
        question: d.question,
        deposant: d.deposant,
        description: d.description,
        url: d.url,
      };
    },

    table(d) {
      return [
        ["Titre", d.titre],
        ["Question", d.question],
        ["Déposant", d.deposant || "—"],
        ["Description", d.description || "—"],
        ["Lien", d.url || "—"],
      ];
    },

    titleOf(d) { return d.titre; },
  };

  /* ---------- Formulaire IDÉE (calque app Idées) ---------- */

  const idee = {
    label: "Idée",
    firstFieldId: "c-a-idee-titre",

    html() {
      return `
        <div class="form-row">
          <label for="c-a-idee-titre">Titre de l'idée <span class="req">*</span></label>
          <input type="text" id="c-a-idee-titre" name="titre" required maxlength="300" autocomplete="off"
                 placeholder="Ex. : Sentier pédagogique le long de la rivière" />
        </div>

        <div class="form-row">
          <label for="c-a-idee-auteur">Qui propose cette idée&nbsp;?</label>
          <input type="text" id="c-a-idee-auteur" name="auteur" maxlength="300" autocomplete="off"
                 placeholder="Votre nom, collectif, association… (facultatif)" />
        </div>

        <div class="form-row">
          <label for="c-a-idee-description">Description <span class="req">*</span></label>
          <textarea id="c-a-idee-description" name="description" rows="4" maxlength="3000"
                    placeholder="En une ou deux phrases : votre idée, ce qu'elle apporterait à la rivière Isère ?"></textarea>
        </div>

        <div class="form-row">
          <label for="c-a-idee-url">Lien (facultatif)</label>
          <input type="url" id="c-a-idee-url" name="url" maxlength="2000" autocomplete="off"
                 placeholder="https://…" />
          <p class="field-hint">Article, pétition, page de présentation…</p>
        </div>`;
    },

    get() {
      return {
        titre: val("c-a-idee-titre"),
        auteur: val("c-a-idee-auteur"),
        description: val("c-a-idee-description"),
        url: val("c-a-idee-url"),
      };
    },

    // Calque exact du validate() de l'app idees.
    validate(setErr) {
      let ok = true;
      const titre = val("c-a-idee-titre");
      const description = val("c-a-idee-description");

      if (!titre) {
        setErr($("c-a-idee-titre"), "Le titre est nécessaire pour que l'équipe examine l'idée.");
        ok = false;
      } else if (titre.length < 3) {
        setErr($("c-a-idee-titre"), "Le titre paraît trop court — quelques mots suffisent.");
        ok = false;
      } else {
        setErr($("c-a-idee-titre"), null);
      }

      if (!description) {
        setErr($("c-a-idee-description"), "La description est nécessaire : elle explique l'idée à l'équipe.");
        ok = false;
      } else if (description.length < 20) {
        setErr($("c-a-idee-description"), "Décrivez l'idée un peu plus longuement (au moins 20 caractères).");
        ok = false;
      } else {
        setErr($("c-a-idee-description"), null);
      }

      const url = val("c-a-idee-url");
      if (url) {
        if (!isHttpUrl(url)) {
          setErr($("c-a-idee-url"), "Collez une adresse web complète commençant par https:// (ou http://).");
          ok = false;
        } else {
          setErr($("c-a-idee-url"), null);
        }
      }

      return ok;
    },

    payload(d) {
      return {
        titre: d.titre,
        auteur: d.auteur,
        description: d.description,
        url: d.url,
      };
    },

    table(d) {
      return [
        ["Titre", d.titre],
        ["Auteur", d.auteur || "—"],
        ["Description", d.description || "—"],
        ["Lien", d.url || "—"],
      ];
    },

    titleOf(d) { return d.titre; },
  };

  return { media, outil, personne, projet, organisation, lieu, question, idee };
})();
