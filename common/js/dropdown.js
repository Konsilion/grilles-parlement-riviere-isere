/* =========================================================
   Grilles de carte — dropdowns custom communs (K5)
   Le <select> natif ne permet PAS le multi-choix : dropdown
   custom — bouton pill + menu checkboxes, clic-dehors et
   Échap ferment, l'option « Tous… » décoche tout d'un clic
   (mécanique actus 11/10/26, généralisée aux deux apps).
   HTML attendu (cf. index.html des apps) :
     <div class="dropdown" id="…-dropdown">
       <button class="dd-toggle" id="…-toggle" aria-expanded="false" aria-haspopup="listbox">
         <span class="dd-pill" id="…-pill">…</span><span class="dd-caret">▾</span>
       </button>
       <div class="dd-menu" id="…-menu" role="listbox" aria-multiselectable="true"></div>
     </div>
   Les classes .dropdown/.dd-toggle/.dd-pill/.dd-caret/.dd-menu/
   .dd-option/.dd-option-name sont stylées dans common/css/base.css.
   ========================================================= */
window.GrilleDropdown = (() => {
  "use strict";

  // Une ligne d'option : checkbox + libellé.
  // cfg : { value, label, checked, isAll, onChange }
  function buildOption(cfg) {
    const row = document.createElement("label");
    row.className = "dd-option" + (cfg.isAll ? " dd-all" : "");
    row.dataset.value = cfg.value;
    row.setAttribute("role", "option");

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = cfg.checked;
    box.addEventListener("change", () => cfg.onChange(box.checked));

    const name = document.createElement("span");
    name.className = "dd-option-name";
    name.textContent = cfg.label;

    row.append(box, name);
    return row;
  }

  // Fabrique un dropdown multi-choix générique.
  //   set       : Set des valeurs cochées (vite = toutes) ;
  //   allLabel  : « Toutes les années » / « Tous les mois » ;
  //   unitWord  : « années » / « mois » (pill « N mois ») ;
  //   labelOf   : valeur → libellé du pill en sélection simple.
  // Rend { setOpen, syncUI, fill } — fill est appelé par l'app
  // pour (re)construire les options (entries [{value,label}]),
  // chaque changement d'option appelle cfg.onChange(value,
  // checked) ; le retour page 1 / re-rendu restent à l'app.
  function makeDropdown({ dropdown, toggle, pill, menu, set, allLabel, unitWord, labelOf }) {
    const isOpen = () => menu.classList.contains("open");
    const setOpen = (open) => {
      dropdown.classList.toggle("open", open);
      menu.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    };

    function pillLabel() {
      const n = set.size;
      if (n === 0) return allLabel;
      if (n === 1) return labelOf([...set][0]);
      return `${n} ${unitWord}`;
    }

    function syncUI() {
      menu.querySelectorAll(".dd-option").forEach((row) => {
        const value = row.dataset.value;
        const checked = value === "" ? set.size === 0 : set.has(value);
        row.querySelector("input").checked = checked;
        row.classList.toggle("active", checked);
        row.setAttribute("aria-selected", checked ? "true" : "false");
      });
      pill.textContent = pillLabel();
      toggle.classList.toggle("active", set.size > 0);
    }

    // (Re)construit les options du menu. onChange(value, checked)
    // est appelé à chaque (dé)coche ; l'option « Tous… » (value
    // vide) appelle onChange("", false) après avoir vidé le set.
    function fill(entries, onChange) {
      menu.innerHTML = "";
      menu.appendChild(
        buildOption({
          value: "",
          label: allLabel,
          checked: set.size === 0,
          isAll: true,
          onChange: () => {
            set.clear();
            onChange("", false);
          },
        })
      );
      for (const en of entries) {
        menu.appendChild(
          buildOption({
            value: en.value,
            label: en.label,
            checked: set.has(en.value),
            isAll: false,
            onChange: (checked) => {
              if (checked) set.add(en.value);
              else set.delete(en.value);
              onChange(en.value, checked);
            },
          })
        );
      }
      syncUI();
    }

    toggle.addEventListener("click", () => setOpen(!isOpen()));
    document.addEventListener("click", (e) => {
      if (isOpen() && !dropdown.contains(e.target)) setOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen()) {
        setOpen(false);
        toggle.focus();
      }
    });

    return { setOpen, syncUI, fill };
  }

  return { makeDropdown };
})();
