// Nova on a phone: More. Every other place in Nova (each opens its phone section, or the computer version
// until it has one), and the settings: the theme, and the computer version.
(() => {
  "use strict";
  const { section, esc, icon, computerLink } = window.NovaPhone;
  // Every place in the computer's Nova Agent, in its order (phone: the section here that does it, if any)
  const PLACES = [
    { name: "Invoicer", place: "/invoicer/", phone: "money" },
    { name: "Portal", place: "/portal/", phone: "today" },
    { name: "Agent", place: "/agent/", phone: "agent" },
    { name: "Calendar", place: "/calendar/", phone: "calendar" },
    { name: "Notes", place: "/notes/", phone: "notes" },
    { name: "Board", place: "/board/" },
    { name: "Index", place: "/app/memory/" },
    { name: "Quests", place: "/quests/", phone: "quests" },
    { name: "Fixer", place: "/fixer/" },
    { name: "Computer", place: "/computer/" },
    { name: "Observatory", place: "/observatory/" },
    { name: "Console", place: "/console/" },
    { name: "Lossless", place: "/lossless/" },
  ];
  // (which app this phone opens: shared/which-app.js reads it on Nova Agent's page)
  const always = () => { try { return localStorage.getItem("nova-app") === "computer"; } catch (e) { return false; } };
  section({
    id: "more",
    name: "More",
    title: "More",
    draw(page) {
      const built = (p) => p.phone && window.NovaPhone.has(p.phone);
      const rows = PLACES.map((p) => built(p)
        ? `<li><a class="row" href="#${p.phone}"><span class="row-lead">${icon(p.phone)}</span><span class="row-main"><strong>${esc(p.name)}</strong></span><span class="row-end">${icon("next")}</span></a></li>`
        : `<li><a class="row" href="${computerLink(p.place)}"><span class="row-lead">${icon("open")}</span><span class="row-main"><strong>${esc(p.name)}</strong><small>Opens in the computer version</small></span></a></li>`).join("");
      const themes = (window.NovaThemes?.list || []).map((t) => `<button type="button" class="swatch" data-theme-id="${esc(t.id)}" aria-pressed="${t.id === window.NovaThemes.current()}"><span class="swatch-dot" data-swatch="${esc(t.id)}"></span>${esc(t.name)}</button>`).join("");
      page.innerHTML = `<h2 class="h">Everything in Nova</h2><ul class="rows">${rows}</ul>
        <h2 class="h">Theme</h2><div class="swatches">${themes}</div>
        <h2 class="h">This app</h2>
        <div class="card"><p>This is Nova for phones. The computer version has everything, laid out for a big screen.</p>
          ${always() ? `<p><strong>This phone is set to open the computer version.</strong></p>` : ""}</div>
        <div class="stack">
          <a class="btn wide" href="${computerLink()}">${icon("open")} Computer version</a>
          ${always() ? `<button type="button" class="btn main wide" data-app="phone">Always use this phone app</button>` : `<button type="button" class="btn wide" data-app="computer">Always use the computer version</button>`}
        </div>`;
      // (each swatch shows its theme's colours: set here, the page's rules allow no style written inside it)
      for (const t of window.NovaThemes?.list || []) {
        const dot = page.querySelector(`[data-swatch="${CSS.escape(t.id)}"]`);
        if (dot) dot.style.setProperty("background", t.preview);
      }
    },
  });
  document.addEventListener("click", (e) => {
    const pick = e.target.closest("button[data-app]");
    if (pick) {
      try {
        if (pick.dataset.app === "computer") { localStorage.setItem("nova-app", "computer"); location.href = computerLink(); }
        else { localStorage.removeItem("nova-app"); sessionStorage.removeItem("nova-app"); window.NovaPhone.show(); }
      } catch (err) { /* (no storage: nothing to remember) */ }
      return;
    }
    const sw = e.target.closest(".swatch[data-theme-id]");
    if (!sw) return;
    window.NovaThemes.set(sw.dataset.themeId);
    for (const b of document.querySelectorAll(".swatch[data-theme-id]")) b.setAttribute("aria-pressed", String(b === sw));
  });
})();
