// Nova Phone: More. Every place in Nova as its Nova tile (the same tiles as Nova Desk's dock), grouped as the
// studio knows them, and the look (themes). A place not yet made for the phone shows its tile faded,
// "Coming next" under it, and isn't a link (never a link to nowhere).
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc } = N;
  // [address, name, tile]
  const GROUPS = [
    ["Studio", [["inbox", "Inbox", "portal"], ["inbox/approvals", "Approvals", "portal"], ["calendar", "Calendar", "calendar"], ["clients", "Clients", "portal"], ["money", "Money", "invoicer"]]],
    ["Outreach", [["outreach", "Campaigns", "portal"], ["outreach/one", "One-to-one", "portal"], ["outreach/social", "Social", "portal"], ["outreach/funnel", "Funnel", "portal"]]],
    ["Plans", [["agent", "Agent", "chat"], ["agent/plan", "Today's plan", "missions"], ["agent/missions", "Missions", "missions"], ["quests", "Quests", "quests"], ["notes", "Notes", "notes"], ["board", "Board", "board"], ["index", "Index", "index"]]],
    ["Helpers", [["observatory", "Observatory", "observatory"], ["console", "Console", "console"], ["lossless", "Lossless", "lossless"], ["help", "Manual", "manual"], ["visualizer", "Nova", "visualizer"]]],
    ["You", [["you", "Your profile", "portal"], ["inbox/alert/phone", "Notifications", "portal"]]],
    ["Admin", [["crew", "The crew", "portal"], ["google", "Google", "portal"], ["computer", "Computer", "computer"], ["tests", "Test stuff", "portal"], ["fixer", "Fixer", "fixer"]]],
  ];
  N.section({
    id: "more",
    name: "More",
    draw(box) {
      const tile = ([to, name, p]) => (N.has(to.split("/")[0])
        ? `<a class="tile" href="#${to}">${window.NovaTile(p)}<span>${esc(name)}</span></a>`
        : `<div class="tile soon" aria-label="${esc(name)}: coming next">${window.NovaTile(p)}<span>${esc(name)}</span><small>Coming next</small></div>`);
      const groups = GROUPS.map(([g, items]) => `<h3 class="h">${g}</h3><div class="tiles">${items.map(tile).join("")}</div>`).join("");
      const themes = (window.NovaThemes?.list || []).map((t) => `<button type="button" class="swatch" data-theme-id="${esc(t.id)}" aria-pressed="${t.id === window.NovaThemes.current()}"><i data-swatch="${esc(t.id)}"></i>${esc(t.name)}</button>`).join("");
      box.innerHTML = `${groups}<h3 class="h">Look</h3><div class="swatch-grid">${themes}</div>
        <p class="muted small">Nova Phone. Add it to your Home Screen for notifications and a full-screen app: on an iPhone, Share → Add to Home Screen; on Android, ⋮ → Add to Home screen.</p>`;
      for (const t of window.NovaThemes?.list || []) box.querySelector(`[data-swatch="${CSS.escape(t.id)}"]`)?.style.setProperty("background", t.preview);
    },
  });
  document.addEventListener("click", (e) => {
    const sw = e.target.closest(".swatch[data-theme-id]");
    if (!sw) return;
    window.NovaThemes.set(sw.dataset.themeId);
    for (const b of document.querySelectorAll(".swatch[data-theme-id]")) b.setAttribute("aria-pressed", String(b === sw));
  });
})();
