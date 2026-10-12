/* =========================================================
   Grilles de carte — socle des modales détail (GrilleDetail)

   UNE SEULE source pour le pop-up de détail de chaque app :
   - l'app elle-même l'ouvre (clic sur une carte) ;
   - une AUTRE app (ex. Actualités, liens « Voir le X ») ouvre le
     MÊME pop-up — même HTML, mêmes styles, même remplissage.

   Mécanique :
   - chaque app enregistre sa DÉFINITION (common/js/details/<app>.js)
     : { html, fill(root, item), css?, helpers?, onOpen?, onClose? } ;
   - le HTML de la définition n'utilise JAMAIS d'id : les nœuds
     portent data-gd="<nom>" et l'engine leur pose des ids uniques
     (gd-<app>-<nom>) — deux modales montées en même temps ne se
     marchent jamais dessus ;
   - l'engine monte la modale dans le document à la demande
     (idempotent), injecte son CSS (common/css/details/<app>.css),
     branche la fermeture (×, voile, Échap) et gère le scroll-lock
     body.modal-open partagé avec la modale de contribution ;
   - Échap ferme la modale détail la plus récemment ouverte, SAUF si
     un menu déroulant .dd-menu est ouvert (priorité au dropdown,
     comportement historique des apps).

   Contrat d'une définition (FROZEN) :
     GrilleDetail.register("<app>", {
       css: "css/details/<app>.css",        // optionnel, chemin RELATIF à common/
       html: `<div class="modal" data-gd-root="<app>" aria-hidden="true"
               role="dialog" aria-modal="true"> …data-gd="…"… </div>`,
       fill(root, item) { … },              // remplit depuis item, textContent,
                                            // esc() pour tout innerHTML
       helpers: { … },                      // optionnel, exposé à l'app hôte
       onOpen(root, triggerEl) { … },       // optionnel (ex. ancrage embed)
       onClose(root) { … },                 // optionnel
     });

   API publique :
     open(app, item, { triggerEl? })   — monte + remplit + affiche
     close(app) / closeTop()           — ferme (une app / la plus récente)
     isOpen(app)                       — true si affichée
     openFrom(app, src, item, opts)    — async : charge le script de la
                                         définition à la demande puis open
                                         (chemin du <app>.js, ex. ../common/
                                         js/details/idees.js)
   ========================================================= */
window.GrilleDetail = (() => {
  "use strict";

  const registry = {};   // app -> définition
  const mounted = {};    // app -> { root, z }
  let zTop = 0;

  // Dossier common/ — déduit de l'emplacement de CE script, la page
  // hôte peut être n'importe quelle app du site.
  const BASE = (document.currentScript && document.currentScript.src
    ? document.currentScript.src.replace(/js\/detail\.js$/, "")
    : "../common/");

  function register(app, def) {
    if (!app || !def || typeof def.html !== "string" || typeof def.fill !== "function") {
      throw new Error("GrilleDetail.register : définition invalide pour « " + app + " »");
    }
    registry[app] = def;
  }

  function get(app) {
    return registry[app] || null;
  }

  function helpers(app) {
    const def = registry[app];
    return def ? (def.helpers || null) : null;
  }

  // Monte la modale de l'app dans le document (une seule fois),
  // injecte son CSS, branche la fermeture ×/voile.
  function ensure(app) {
    if (mounted[app]) return mounted[app];
    const def = registry[app];
    if (!def) {
      throw new Error("GrilleDetail : définition non enregistrée « " + app + " »");
    }
    if (def.css) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = BASE + def.css;   // chemin relatif à common/
      link.dataset.gd = app;
      document.head.appendChild(link);
    }
    const holder = document.createElement("div");
    holder.innerHTML = def.html.trim();
    const root = holder.firstElementChild;
    if (!root || root.getAttribute("data-gd-root") !== app) {
      throw new Error("GrilleDetail : html de « " + app + " » sans racine data-gd-root");
    }
    root.classList.add("gd-modal");
    root.id = "gd-modal-" + app;
    // ids uniques pour les nœuds nommés (pas de collision entre apps)
    root.querySelectorAll("[data-gd]").forEach((el) => {
      el.id = "gd-" + app + "-" + el.dataset.gd;
    });
    const title = root.querySelector('[data-gd="title"]');
    if (title) root.setAttribute("aria-labelledby", title.id);
    root.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", () => close(app));
    });
    document.body.appendChild(root);
    mounted[app] = { app, root, z: 0 };
    return mounted[app];
  }

  function open(app, item, opts) {
    const m = ensure(app);
    const def = registry[app];
    m.z = ++zTop;
    def.fill(m.root, item);
    m.root.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    if (def.onOpen) def.onOpen(m.root, (opts && opts.triggerEl) || null);
    return m.root;
  }

  function close(app) {
    const m = mounted[app];
    if (!m || m.root.getAttribute("aria-hidden") !== "false") return;
    m.root.setAttribute("aria-hidden", "true");
    // scroll-lock relâché seulement si PLUS AUCUNE modale n'est
    // ouverte (détail d'une autre app ou contribution).
    if (!document.querySelector('.modal[aria-hidden="false"]')) {
      document.body.classList.remove("modal-open");
    }
    const def = registry[app];
    if (def.onClose) def.onClose(m.root);
  }

  function isOpen(app) {
    const m = mounted[app];
    return Boolean(m && m.root.getAttribute("aria-hidden") === "false");
  }

  function openTop() {
    let top = null;
    for (const m of Object.values(mounted)) {
      if (m.root.getAttribute("aria-hidden") === "false" && (!top || m.z > top.z)) {
        top = m;
      }
    }
    return top;
  }

  function closeTop() {
    const t = openTop();
    if (t) close(t.app);
  }

  // Échap : priorité aux menus déroulants ouverts (le dropdown
  // ferme son menu et rend le focus), puis fermeture de la modale
  // détail la plus récente.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (document.querySelector(".dd-menu.open")) return;
    closeTop();
  });

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("GrilleDetail : impossible de charger " + src));
      document.head.appendChild(s);
    });
  }

  // Charge la définition à la demande (une app qui ouvre le pop-up
  // d'une AUTRE app n'embarque pas ses scripts au chargement).
  async function openFrom(app, src, item, opts) {
    if (!registry[app]) await loadScript(src);
    return open(app, item, opts);
  }

  return { BASE, register, get, helpers, ensure, open, close, isOpen, closeTop, openFrom };
})();
