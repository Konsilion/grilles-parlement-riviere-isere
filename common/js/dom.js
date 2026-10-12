/* =========================================================
   Grilles de carte — utilitaires DOM & dates communs
   Consommé par les 9 apps (chargé avant app.js :
   window.GrilleDom doit exister).
   ========================================================= */
window.GrilleDom = (() => {
  "use strict";

  // Échappement HTML (titres, descriptions, URLs… avant injection).
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  // Date ISO (AAAA-MM-JJ) → objet Date local (null si invalide).
  function parseISO(iso) {
    const parts = (iso || "").trim().split("-");
    if (parts.length !== 3) return null;
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return isNaN(d) ? null : d;
  }

  // Date ISO → « 27 novembre 2026 » (locale fr-FR).
  function formatDate(iso) {
    const parts = (iso || "").split("-");
    if (parts.length !== 3) return iso || "";
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(d)) return iso;
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  }

  /* ---------- Cartes interactives (règle CEO 13/10/26) ----------

     Dans TOUTES les grilles, un clic N'IMPORTE OÙ sur une carte ouvre
     son pop-up de détail (socle GrilleDetail) — même logique partout,
     plus de bouton « Voir le X » / « En savoir plus » sous les cartes.
     Le bloc « clic + Enter/Espace » vit ICI, UNE seule fois, au lieu
     d'être recopié par chaque app (dom.js est chargé par les 9).

     - attachCardClick(grid, { cardSelector, findItem, open })
         grid         : conteneur des cartes (els.grid)
         cardSelector : sélecteur des cartes, ex. ".contact-card",
                        ".projet-card", ".card"…
         findItem(card) → l'objet fiche associé (ou null : le clic
                        est ignoré) ; typiquement par data-id ou
                        data-key dans state.items.
         open(item, card) : ouvre le pop-up de détail.
                        card (2e argument) sert de triggerEl au
                        socle GrilleDetail (ancrage du pop-up en
                        mode intégré iframe — médiathèque).
     La grille est re-balayée à CHAQUE appel (les cartes sont
     recréées par innerHTML à chaque rendu, jamais réutilisées) :
     appeler attachCardClick après chaque rendu de la grille.
  */
  function attachCardClick(grid, cfg) {
    if (!grid || !cfg || typeof cfg.open !== "function") return;
    const selector = cfg.cardSelector || ".card";
    grid.querySelectorAll(selector).forEach((card) => {
      card.addEventListener("click", () => {
        const item = cfg.findItem ? cfg.findItem(card) : null;
        if (item) cfg.open(item, card);
      });
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          card.click();
        }
      });
    });
  }

  return { esc, parseISO, formatDate, attachCardClick };
})();
