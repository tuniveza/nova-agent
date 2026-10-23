// Nova on a phone: the frame. Sections register themselves (NovaPhone.section) and are drawn one at a time
// into the page, by the address's #name (so Back and Forward work as on any site, and a section can be
// linked to). The bar at the bottom holds the main sections; More holds the rest, and settings.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const page = $("page"), bar = $("bar"), title = $("title");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // The icons (24px line drawings, drawn in the text's colour)
  const ICONS = {
    agent: '<path d="M12 3a7 7 0 0 1 7 7c0 3.9-3.1 7-7 7H7l-4 3V10a7 7 0 0 1 7-7z"/><path d="M8.5 10h.01M12 10h.01M15.5 10h.01"/>',
    today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    notes: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>',
    money: '<rect x="3" y="6" width="18" height="12" rx="3"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 9.5v.01M17.5 14.5v.01"/>',
    quests: '<path d="M4 6l2 2 4-4M4 14l2 2 4-4"/><path d="M13 7h7M13 15h7"/>',
    more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    next: '<path d="m9 18 6-6-6-6"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;

  // The sections, in the bar's order; each fills the page when it's chosen
  const sections = new Map();
  const BAR = ["agent", "today", "calendar", "notes", "money", "more"];
  function section(def) {
    sections.set(def.id, def);
    drawBar();
    if (current().id === def.id) show();
  }
  function drawBar() {
    bar.innerHTML = BAR.filter((id) => sections.has(id)).map((id) => {
      const s = sections.get(id);
      return `<a href="#${id}" data-id="${id}">${icon(s.icon || id)}<span>${esc(s.short || s.name)}</span></a>`;
    }).join("");
    mark();
  }
  // Where we are: #calendar, #calendar/2026-10-23 (a section and what's after the slash)
  function current() {
    const [id, ...rest] = decodeURIComponent(location.hash.slice(1)).split("/");
    // (no section named, or one not here: Today, or whichever came first)
    const home = sections.has("today") ? "today" : sections.keys().next().value;
    return sections.has(id) ? { id, rest } : { id: home, rest: [] };
  }
  function mark() {
    const { id } = current();
    for (const a of bar.querySelectorAll("a")) {
      if (a.dataset.id === id) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
  }
  // Each draw goes into a box of its own, shown only if it's still the newest when it's ready: a slow one
  // (the week, loading) finishing after a quick one (the card tapped meanwhile) never covers it
  let drawn = "", drawing = 0;
  async function show() {
    const { id, rest } = current();
    const s = sections.get(id);
    mark();
    if (!s) { page.innerHTML = '<p class="note">Loading…</p>'; return; }
    const key = `${id}/${rest.join("/")}`;
    const fresh = key.split("/")[0] !== drawn.split("/")[0];
    drawn = key;
    const token = ++drawing;
    title.textContent = s.title || s.name;
    document.title = `${s.title || s.name} · Nova`;
    const box = document.createElement("div");
    box.className = "page-in";
    try {
      await s.draw(box, rest, { fresh });
    } catch (err) {
      if (err.signIn) signInCard(box, `${id}${rest.length ? `/${rest.join("/")}` : ""}`);
      else {
        console.warn("Nova phone:", err);
        box.innerHTML = `<p class="note bad">That didn't load (${esc(err.message || err)}).</p><button type="button" class="btn wide" data-again>Try again</button>`;
      }
    }
    if (token !== drawing) return;
    page.replaceChildren(box);
    // (a new section from its top; a conversation from its latest words; the same page where it was)
    if (s.bottom) page.scrollTop = page.scrollHeight;
    else if (fresh) page.scrollTop = 0;
    box.querySelector("[data-autofocus]")?.focus();
  }
  addEventListener("hashchange", show);
  page.addEventListener("click", (e) => { if (e.target.closest("[data-again]")) show(); });

  // ---- Talking to the server: the same addresses and sign-in as the computer's Nova Agent ----
  async function api(path, opts = {}) {
    const { headers, ...rest } = opts;
    const res = await fetch(path, { credentials: "same-origin", ...rest, headers: { Accept: "application/json", ...(typeof rest.body === "string" ? { "Content-Type": "application/json" } : {}), ...(headers || {}) } });
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error("Sign in first"), { signIn: true });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`.trim());
    return res.headers.get("content-type")?.includes("json") ? res.json() : res.text();
  }

  // ---- The computer version of a place, for what the phone doesn't have yet (and the switch in More) ----
  // (Nova Agent opening that place, as NovaInvoicer.open does: /agent/?open=/calendar/; app=computer says it
  // was asked for on purpose, so a phone isn't sent back here)
  const computerLink = (place = "") => `/agent/?app=computer${place && place !== "/agent/" ? `&open=${encodeURIComponent(place)}` : ""}`;
  // A section not built for the phone yet: says so, and opens it on the computer version (never a dead end)
  function notYet(name, place) {
    return {
      draw(p) {
        p.innerHTML = `<div class="card"><p><strong>${esc(name)}</strong> isn't in the phone app yet.</p><p class="muted">It's coming. Until then, it opens in the computer version of Nova, which works on a phone too.</p></div>
          <p><a class="btn main wide" href="${computerLink(place)}">${icon("open")} Open ${esc(name)} in the computer version</a></p>`;
      },
    };
  }

  // ---- Days and times, on this phone's clock: "2026-10-23", "2026-10-23T14:30" ----
  const pad = (n) => String(n).padStart(2, "0");
  const localStamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const today = () => localStamp(new Date()).slice(0, 10);

  // Signed out: a card to sign in (Portal's sign-in, which comes back here after)
  function signInCard(p, back = "") {
    const next = `/phone/${back ? `#${back}` : ""}`;
    p.innerHTML = `<div class="card"><p><strong>Sign in to see this.</strong></p><p class="muted">Nova's sign-in is the same on the phone and the computer.</p></div>
      <p><a class="btn main wide" href="/portal/?app=1&next=${encodeURIComponent(next)}">Sign in</a></p>`;
  }

  // Nova's files kept on the phone between visits (the same helper as Nova Agent's: /sw.js keeps each file by
  // its fingerprint in /nova-build.json, so a visit after a change fetches only what changed)
  if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {}));

  window.NovaPhone = { section, today, localStamp, signInCard, has: (id) => sections.has(id), api, esc, icon, show, notYet, computerLink };
})();
