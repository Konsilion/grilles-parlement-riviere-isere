/* =========================================================
   Grilles de carte — socle commun du parcours de contribution
   (esprit Datami). Calque du bloc contribution de la médiathèque
   (11/10/26), mutualisé pour les apps qui n'ont pas de code
   contribution dédié : actualites, contacts, projets.

   Mécanique identique à la médiathèque :
   - bouton #propose-btn → modale #contribute-modal ;
   - honeypot #c-gotcha invisible (rempli = faux succès) ;
   - envoi silencieux au relais VPS (hermes.konsilion.fr) ;
   - si le relais échoue (4xx/5xx/réseau) : repli automatique
     sur l'issue GitHub pré-remplie (le visiteur ne voit GitHub
     qu'à ce moment, et n'a besoin d'aucun compte pour remplir
     le formulaire) ;
   - corps d'issue : tableau lisible + bloc ```json-contribution
     (avec le champ "app") parsé par scripts/valider_contribution.py.

   Les CHAMPS du formulaire restent propres à chaque app : chaque
   app.js appelle GrilleContribution.init({...}) avec ses
   collect/validate/payload/table. Le socle ne connaît que les
   ids standard du composant.

   Chargé AVANT js/app.js de l'app (comme les autres socles).
   ========================================================= */
window.GrilleContribution = (() => {
  "use strict";

  const CONTRIB_REPO_URL = "https://github.com/Konsilion/grilles-parlement-riviere-isere";
  // Rappel de cohérence : l'URL du dépôt ci-dessus doit rester celle du site
  // servi (github.io → dépôt Konsilion/grilles-parlement-riviere-isere).
  const CONTRIB_RELAY_URL = "https://hermes.konsilion.fr/api/contribution";
  const JSON_FENCE = "json-contribution";
  const ISSUE_LABEL = "contribution";

  // Ids standard du composant (calque médiathèque).
  const IDS = {
    btn: "propose-btn",
    modal: "contribute-modal",
    form: "contribute-form",
    success: "contribute-success",
    fallback: "contribute-fallback",
    link: "contribute-link",
    submit: "contribute-submit",
    gotcha: "c-gotcha",
  };

  let cfg = null;
  const elsC = {};

  function grabEls() {
    for (const [k, id] of Object.entries(IDS)) elsC[k] = document.getElementById(id);
  }

  // Message d'erreur sous un champ (un seul à la fois par champ).
  function setFieldError(input, msg) {
    if (!input) return;
    let err = input.parentElement.querySelector(".field-error");
    if (msg) {
      input.classList.add("invalid");
      if (!err) {
        err = document.createElement("p");
        err.className = "field-error";
        input.parentElement.appendChild(err);
      }
      err.textContent = msg;
    } else {
      input.classList.remove("invalid");
      if (err) err.remove();
    }
  }

  function clearAllFieldErrors() {
    if (!elsC.form) return;
    elsC.form.querySelectorAll(".field-error").forEach((e) => e.remove());
    elsC.form.querySelectorAll(".invalid").forEach((i) => i.classList.remove("invalid"));
  }

  function openModal() {
    if (!elsC.modal) return;
    // Sécurité : une seule modale à la fois — l'app peut fermer sa
    // modale détail via cfg.onOpen (calque médiathèque).
    if (typeof cfg.onOpen === "function") cfg.onOpen();
    // Réinitialisation : formulaire visible, confirmations masquées.
    elsC.form.hidden = false;
    elsC.success.hidden = true;
    elsC.fallback.hidden = true;
    elsC.form.reset();
    clearAllFieldErrors();
    elsC.modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    const first = cfg.firstFieldId ? document.getElementById(cfg.firstFieldId) : null;
    setTimeout(() => first && first.focus(), 50);
  }

  function closeModal() {
    if (!elsC.modal) return;
    elsC.modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
  }

  // Corps de l'issue : partie lisible (néophyte + modération humaine)
  // + bloc technique délimité, parsé par scripts/valider_contribution.py.
  function buildIssueBody(d) {
    const t = cfg.issueTexts || {};
    const lines = [
      `## ${t.heading || "Proposition"}`,
      "",
      t.intro || "Un·e visiteur propose cette contribution au Parlement de la rivière Isère.",
      "",
      "| Champ | Valeur |",
      "| --- | --- |",
    ];
    for (const [label, value] of cfg.table(d)) lines.push(`| ${label} | ${value} |`);
    lines.push(
      "",
      "```" + JSON_FENCE,
      JSON.stringify(Object.assign({ app: cfg.app }, cfg.payload(d))),
      "```",
      "",
      "### Modération (équipe)",
      "",
      t.check || "Une fois la proposition vérifiée (pertinence, pas de doublon) :",
      "",
      "```bash",
      "python3 scripts/valider_contribution.py --liste",
      "python3 scripts/valider_contribution.py <n° de l'issue>",
      "```",
      "",
      t.closing ||
        "La validation crée la fiche Zotero, ferme cette issue et le prochain " +
        "`deploy.sh` publie la contribution.",
    );
    return lines.join("\n");
  }

  function buildIssueUrl(d) {
    const params = new URLSearchParams();
    params.set("title", `[${cfg.app}] Contribution : ${cfg.titleOf(d)}`);
    params.set("body", buildIssueBody(d));
    params.set("labels", ISSUE_LABEL);
    return `${CONTRIB_REPO_URL}/issues/new?${params.toString()}`;
  }

  function showFallback(d) {
    elsC.link.href = buildIssueUrl(d);
    elsC.form.hidden = true;
    elsC.success.hidden = true;
    elsC.fallback.hidden = false;
    window.open(elsC.link.href, "_blank", "noopener");
  }

  function showSuccess() {
    elsC.form.hidden = true;
    elsC.fallback.hidden = true;
    elsC.success.hidden = false;
  }

  // Envoi silencieux au relais VPS → le service crée l'issue GitHub
  // avec le jeton du robot. En cas d'échec (service ou réseau) :
  // repli sur le parcours GitHub manuel (calque médiathèque).
  async function sendSilent(d) {
    const btn = elsC.submit;
    const prev = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = "Envoi en cours…"; }
    const restore = () => { if (btn) { btn.disabled = false; btn.textContent = prev; } };
    const body = Object.assign(
      { gotcha: elsC.gotcha ? elsC.gotcha.value : "" },
      cfg.payload(d)
    );
    body.app = cfg.app;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const resp = await fetch(CONTRIB_RELAY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (resp.ok) {
        restore();
        showSuccess();
        return;
      }
      // 429/4xx/5xx du relais → repli GitHub.
    } catch { /* réseau/timeout → repli GitHub */ }
    restore();
    showFallback(d);
  }

  function submit() {
    // Piège à robots : rempli → ignore silencieux en faux succès.
    if (elsC.gotcha && elsC.gotcha.value) { showSuccess(); return; }
    const d = cfg.collect();
    if (!cfg.validate(d)) return;
    sendSilent(d);
  }

  function init(config) {
    cfg = config;
    grabEls();
    if (!elsC.btn || !elsC.modal || !elsC.form) return; // app sans bloc contribution
    elsC.btn.addEventListener("click", openModal);
    elsC.modal.querySelectorAll("[data-cclose]").forEach((el) => {
      el.addEventListener("click", closeModal);
    });
    elsC.form.addEventListener("submit", (e) => {
      e.preventDefault();
      submit();
    });
    // Échap : les dropdowns communs ferment leurs menus en premier
    // (ils rendent le focus au bouton) ; la modale ne se ferme que
    // si aucun menu n'est ouvert (comportement des apps).
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (document.querySelector(".dd-menu.open")) return;
      if (elsC.modal.getAttribute("aria-hidden") === "false") closeModal();
    });
  }

  return { init, setFieldError };
})();
