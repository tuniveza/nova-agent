// Nova Phone: the Backend (the user, 23 Oct 2026: "put fixer, computer, observatory, console, manual and index
// into it backend area that can be accessed by a little trick motion of the nova agent as it won't be needed for
// the main nova suite"). Nova's own workings, out of the way of the main places: reached by pressing and holding
// the Agent tile (Nova Agent) for a moment (phone.js). Each opens as before, at its own address.
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, row, list } = N;
  // [address, name, tile, what it's for]
  const PLACES = [
    // Fixer off (24 Oct 2026, the user: "just disable it entirely in all aspects for now"): back with FIXER_ON=1
    // ["fixer", "Fixer", "fixer", "Every screen checked against the four rules"],
    ["computer", "Computer", "computer", "The server live: its sessions, files, programs and how busy it is"],
    ["observatory", "Observatory", "observatory", "Every project, its lines of code and pictures"],
    ["console", "Console", "console", "Type commands for all of Nova"],
    ["help", "Manual", "manual", "How everything in Nova works"],
    ["index", "Index", "index", "Everything Nova Agent remembers: browse, edit, approve"],
  ];
  N.section({
    id: "backend",
    name: "Backend",
    tile: "console",
    async draw(box) {
      await N.css("backend.css");
      box.innerHTML = `<p class="muted backend-say">Nova's own workings, kept out of the way. Press and hold the Agent tile to come back here.</p>
        <div class="tiles backend-tiles">${PLACES.map(([to, name, p]) => `<a class="tile" href="#${esc(to)}">${window.NovaTile ? window.NovaTile(p) : ""}<span>${esc(name)}</span></a>`).join("")}</div>
        <h3 class="h">What each is for</h3>
        ${list(PLACES.map(([to, name, p, what]) => row({ href: `#${to}`, lead: window.NovaTile ? window.NovaTile(p) : "", title: name, text: what })))}`;
    },
  });
})();
