/* =========================================================
   Grilles de carte — utilitaires DOM & dates communs
   Consommé par mediatheque/js/app.js et actualites/js/app.js
   (chargé avant eux : window.GrilleDom doit exister).
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

  return { esc, parseISO, formatDate };
})();
