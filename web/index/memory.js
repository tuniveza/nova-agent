// Nova Index: the browsable face of the Nova suite's shared memory.
//
// Every Nova app feeds conversations in; a small set of one-line, tagged facts comes out,
// kept in little files by subject ("- [stated] prefers evening sessions"). This page lets the
// studio team see all of it, watch it grow, fix a line, and say yes or no to facts learned
// from customers before they're remembered.
//
// Everything comes from /app/api/memory/ (Nova Hub's sign-in; the cookie is sent by itself).
// The three screens:
//   Browse   every file, grouped by scope (studio, staff, customers) and owner; tap one to open it
//   Live     the most recently changed files, newest first, refreshed every 20 seconds
//   Approve  facts waiting for a person to approve them
// The site's security rules allow no scripts or styles written inside the page, so it's all here.
(() => {
  "use strict";

  const API = "/app/api/memory";
  const SCOPES = ["studio", "staff", "customer"];
  const SCOPE_NAMES = { studio: "Studio", staff: "Staff", customer: "Customers" };
  const SCOPE_ONE = { studio: "studio", staff: "staff", customer: "customer" };
  const TAGS = ["stated", "observed", "inferred"];
  const TAG_HELP = { stated: "said directly", observed: "seen in bookings or behaviour", inferred: "a pattern we've noticed" };
  // The kinds of file each memory can hold (a kind with a slash needs a name: people/kai)
  const KINDS = {
    studio: ["studio", "public", "people", "topics", "areas"],
    staff: ["profile", "people", "topics", "areas", "studio"],
    customer: ["profile", "people", "topics"],
  };
  const KIND_HELP = {
    studio: "How the studio runs (only the team sees it)",
    public: "Studio facts customers may be told",
    profile: "About this person themselves",
    people: "Someone they work with or talk about",
    topics: "A subject: pricing, gear, a process",
    areas: "An ongoing piece of work, like an EP release",
  };
  const NAMED = ["people", "topics", "areas"];
  const LIVE_EVERY = 20_000;

  const $ = (id) => document.getElementById(id);
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.getAttribute("data-motion") === "calm";
  const sfx = (name) => window.NovaSfx && window.NovaSfx.play(name);

  // What the page knows
  const state = {
    files: [], // the listing (no bodies), newest first
    stats: null,
    pending: [],
    bodies: new Map(), // key -> the whole file (with its body), once it's been opened or searched
    drafts: new Map(), // key -> what's being edited in an opened file
    open: null, // key of the file that's open
    scope: "all",
    query: "",
    tab: "browse",
    known: null, // file id -> { version, facts } as last seen (so Live can tell what's new)
    changes: new Map(), // file id -> { delta, at } for files that changed while the page was open
    startFacts: null,
    lastCheck: 0,
    newScope: "studio",
    newKind: "studio",
    editingPending: new Set(),
    signedIn: false,
  };

  // A file's key: which memory, whose, and which file
  const keyOf = (f) => `${f.scope}\u0001${f.owner_id || ""}\u0001${f.path}`;

  // ===== Little helpers =====

  // Make an element: el("p", "class", "text") or el("div", "class", [children])
  function el(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (Array.isArray(content)) node.append(...content.filter((c) => c !== null && c !== undefined && c !== false));
    else if (content !== undefined && content !== null && content !== "") node.textContent = String(content);
    return node;
  }
  function button(className, text, onClick, extra = {}) {
    const b = el("button", className, text);
    b.type = "button";
    for (const [k, v] of Object.entries(extra)) b.setAttribute(k, v);
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }
  // A small line icon (the paths are drawn on a 24×24 grid)
  function icon(paths) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    for (const d of [].concat(paths)) {
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", d);
      svg.append(p);
    }
    return svg;
  }
  const ICONS = {
    edit: ["M4 20h4L19 9l-4-4L4 16z", "M13.5 6.5l4 4"],
    del: ["M6 6l12 12", "M18 6 6 18"],
    chevron: ["M6 9l6 6 6-6"],
  };
  // One of the suite's cosmic marks (from the sprite at the top of the page)
  function mark(id, className) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 512 512");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", className);
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#" + id);
    svg.append(use);
    return svg;
  }
  function tagPill(tag) {
    const t = TAGS.includes(tag) ? tag : "stated";
    const pill = el("span", "tag " + t, t);
    pill.title = TAG_HELP[t];
    return pill;
  }
  function tagSelect(value, label) {
    const s = el("select");
    s.setAttribute("aria-label", label || "How we know it");
    for (const t of TAGS) {
      const o = el("option", "", t);
      o.value = t;
      o.title = TAG_HELP[t];
      s.append(o);
    }
    s.value = TAGS.includes(value) ? value : "stated";
    return s;
  }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;

  // "just now", "4 min ago", "3 h ago", "2 days ago", "6 Oct"
  function ago(when) {
    let ms = Number(when) || 0;
    if (ms && ms < 1e12) ms *= 1000; // seconds, not milliseconds
    if (!ms) return "";
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 45) return "just now";
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    if (s < 7 * 86400) return plural(Math.round(s / 86400), "day") + " ago";
    return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }

  // Whose memory: an email, a staff id, or a website chat not yet tied to an email
  function ownerLabel(scope, owner) {
    if (scope === "studio" || !owner) return "";
    if (owner.startsWith("chat:")) return "Website chat " + owner.slice(5, 13);
    return owner;
  }
  function where(f, target) {
    const parts = [SCOPE_ONE[f.scope] || f.scope];
    const who = ownerLabel(f.scope, f.owner_id);
    if (who) parts.push(who);
    parts.push(target || f.path);
    return parts.join(" · ");
  }

  // A file's lines: [{ tag, fact }]
  function parseBody(body) {
    const out = [];
    for (const raw of String(body || "").split("\n")) {
      const m = raw.trim().match(/^-\s*\[(stated|observed|inferred)\]\s*(.+)$/i);
      if (m) out.push({ tag: m[1].toLowerCase(), fact: m[2].trim() });
    }
    return out;
  }
  const lineOf = (l) => `- [${l.tag}] ${l.fact.replace(/\s+/g, " ").trim()}`;
  const bodyOf = (lines) => lines.filter((l) => l.fact.trim()).map(lineOf).join("\n");
  const sameLine = (l) => lineOf(l).toLowerCase();
  const aliasText = (list) => (list || []).join(", ");
  const aliasList = (text) => String(text || "").split(",").map((a) => a.trim()).filter(Boolean);

  // A short message at the bottom of the screen
  let toastTimer = 0;
  function toast(message, bad = false) {
    const t = $("toast");
    t.textContent = message;
    t.classList.toggle("bad", bad);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), bad ? 4200 : 2600);
    if (bad) sfx("error");
  }

  // ===== Talking to the server =====

  class Problem extends Error {}

  // Every request: same site, JSON, and saying it's Nova Index. A 401 means signed out.
  async function api(path, { method = "GET", body } = {}) {
    const headers = { "X-Nova-App": "index", Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res;
    try {
      res = await fetch(path, { method, credentials: "same-origin", headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (err) {
      throw new Problem("Can't reach Nova Index. Check the connection and try again.");
    }
    let data = {};
    try {
      data = await res.json();
    } catch (err) {}
    if (res.status === 401 && path !== "/app/api/login") {
      showLogin();
      throw new Problem("Please sign in again.");
    }
    return { status: res.status, ok: res.ok, data: data || {} };
  }
  // The same, but anything other than success becomes a friendly error
  async function must(path, options) {
    const r = await api(path, options);
    if (!r.ok) throw new Problem(r.data.error || `That didn't work (error ${r.status}). Try again.`);
    return r.data;
  }
  const fileQuery = (f) => {
    const p = new URLSearchParams({ scope: f.scope, path: f.path });
    if (f.scope !== "studio" && f.owner_id) p.set("owner_id", f.owner_id);
    return p.toString();
  };

  // ===== Signing in =====

  function showLogin() {
    state.signedIn = false;
    $("app").hidden = true;
    $("login").hidden = false;
    document.querySelectorAll(".sheet").forEach((s) => (s.hidden = true));
    setTimeout(() => $("password").focus(), 50);
  }
  function showApp() {
    state.signedIn = true;
    $("login").hidden = true;
    $("app").hidden = false;
  }

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const go = e.submitter || $("login-form").querySelector("button");
    const error = $("login-error");
    error.textContent = "";
    go.disabled = true;
    try {
      const r = await api("/app/api/login", { method: "POST", body: { password: $("password").value } });
      if (!r.ok) {
        error.textContent = r.data.error || "That didn't work. Try again.";
        sfx("error");
        return;
      }
      $("password").value = "";
      sfx("done");
      showApp();
      await loadAll();
    } catch (err) {
      error.textContent = err.message;
    } finally {
      go.disabled = false;
    }
  });

  // ===== Loading =====

  async function loadIndex() {
    const data = await must(API + "/index");
    const files = Array.isArray(data.files) ? data.files : [];
    files.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    noticeChanges(files);
    // A file changed somewhere else: its cached body is out of date (unless it's being edited)
    for (const f of files) {
      const k = keyOf(f);
      const had = state.bodies.get(k);
      if (had && had.version !== f.version && !state.drafts.has(k)) state.bodies.delete(k);
    }
    state.files = files;
    state.lastCheck = Date.now();
  }
  async function loadStats() {
    state.stats = await must(API + "/stats");
  }
  async function loadPending() {
    const data = await must(API + "/pending");
    state.pending = Array.isArray(data.pending) ? data.pending : [];
    // Inside Nova Agent, customers' facts and approvals stay behind Nova Hub's sign-in
    state.pendingLocked = data.locked === true;
  }

  // Everything at once (on opening, after signing in, and on "Refresh")
  async function loadAll() {
    try {
      await Promise.all([loadIndex(), loadStats(), loadPending()]);
      renderAll();
    } catch (err) {
      if (state.signedIn) toast(err.message, true);
    }
  }

  // Which files changed since the page last looked (for Live's "learned 2 facts" and its glow)
  function noticeChanges(files) {
    const total = files.reduce((n, f) => n + (f.facts || 0), 0);
    if (!state.known) {
      state.known = new Map(files.map((f) => [f.id, { version: f.version, facts: f.facts || 0 }]));
      state.startFacts = total;
      return 0;
    }
    let arrivals = 0;
    for (const f of files) {
      const was = state.known.get(f.id);
      if (!was || was.version !== f.version) {
        state.changes.set(f.id, { delta: (f.facts || 0) - (was ? was.facts : 0), isNew: !was, at: Date.now(), fresh: true });
        state.known.set(f.id, { version: f.version, facts: f.facts || 0 });
        arrivals++;
      }
    }
    if (arrivals && state.tab === "live") {
      const orb = document.querySelector(".orb");
      if (orb) {
        orb.classList.add("surge");
        setTimeout(() => orb.classList.remove("surge"), 3600);
      }
      sfx("message");
    }
    return arrivals;
  }

  function renderAll() {
    renderStats();
    renderBrowse(true);
    renderLive();
    renderPending(true);
  }

  // ===== The stats strip =====

  function renderStats() {
    const s = state.stats || { scopes: [], pending: state.pending.length };
    for (const scope of SCOPES) {
      const row = (s.scopes || []).find((x) => x.scope === scope) || { files: 0, facts: 0 };
      // The stats count an empty file as one line, so the listing's own counts are used when they're there
      const listed = state.files.filter((f) => f.scope === scope);
      const files = state.files.length || !state.stats ? listed.length : row.files || 0;
      const facts = state.files.length ? listed.reduce((n, f) => n + (f.facts || 0), 0) : row.facts || 0;
      setNum($("stat-" + scope), files);
      $("stat-" + scope + "-facts").textContent = plural(facts, "fact");
      $("stat-" + scope).parentElement.setAttribute("aria-label", `${SCOPE_NAMES[scope]}: ${plural(files, "file")}, ${plural(facts, "fact")}`);
    }
    const waiting = Number(s.pending ?? state.pending.length) || 0;
    setNum($("stat-pending"), waiting);
    $("stat-pending").parentElement.classList.toggle("has", waiting > 0);
    $("stat-pending").parentElement.setAttribute("aria-label", `${plural(waiting, "fact")} waiting to approve`);
    const badge = $("pending-badge");
    badge.hidden = !waiting;
    badge.textContent = waiting > 99 ? "99+" : String(waiting);
  }
  // A number that gives a little bounce when it changes
  function setNum(node, n) {
    const text = String(n);
    if (node.textContent === text) return;
    const first = node.textContent === "–";
    node.textContent = text;
    if (!first && !still()) {
      const tile = node.parentElement;
      tile.classList.remove("bump");
      void tile.offsetWidth;
      tile.classList.add("bump");
    }
  }

  // ===== Browse =====

  // Does a file match the search? (name, aliases, description, owner, path, and its facts once loaded)
  function matches(f, q) {
    if (!q) return true;
    const loaded = state.bodies.get(keyOf(f));
    // The server's search looks inside every file's facts (see loadBodiesForSearch)
    const hits = state.searchHits && state.searchHits.q === q ? (state.searchHits.map.get(keyOf(f)) || []).join("\n") : "";
    const hay = [f.name, f.path, f.description, aliasText(f.aliases), f.owner_id, ownerLabel(f.scope, f.owner_id), f.source_app, loaded ? loaded.body : "", hits].join("\n").toLowerCase();
    return q.split(/\s+/).every((word) => hay.includes(word));
  }
  // The first fact line that matches the search (shown on the card so you can see why it matched)
  function factHit(f, q) {
    if (!q) return null;
    const loaded = state.bodies.get(keyOf(f));
    const hits = state.searchHits && state.searchHits.q === q ? state.searchHits.map.get(keyOf(f)) : null;
    const body = loaded ? loaded.body : hits ? hits.join("\n") : "";
    if (!body) return null;
    const words = q.split(/\s+/);
    return parseBody(body).find((l) => words.some((w) => l.fact.toLowerCase().includes(w))) || null;
  }
  // The search text, with the matching words lit up
  function highlighted(text, q) {
    const span = el("span");
    const words = q ? q.split(/\s+/).filter((w) => w.length > 1) : [];
    if (!words.length) {
      span.textContent = text;
      return span;
    }
    const re = new RegExp("(" + words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "gi");
    String(text).split(re).forEach((part, i) => span.append(i % 2 ? el("mark", "mark", part) : document.createTextNode(part)));
    return span;
  }

  // animate: let the cards float in (on first load, and when the filter or search changes)
  // A file's title: its name, or a friendlier one for the files whose name is just their path
  const PLAIN_TITLES = { profile: "Profile", public: "Public facts", studio: "The studio" };
  const titleOf = (f) => (!f.name || f.name === f.path ? PLAIN_TITLES[f.path] || f.path : f.name);

  function renderBrowse(animate = false) {
    const box = $("browse-list");
    box.classList.toggle("animate", animate);
    const q = state.query.trim().toLowerCase();
    const shown = state.files.filter((f) => (state.scope === "all" || f.scope === state.scope) && matches(f, q));

    if (!shown.length) {
      let message;
      if (!state.files.length) {
        message = el("div", "empty", [el("strong", "", "Memory is empty"), el("span", "", "As the Nova apps talk to people, the facts worth keeping land here. You can add one yourself too.")]);
        message.append(button("btn small", "+ New file", openNewForm, { "data-sfx": "open" }));
      } else if (q) {
        message = el("div", "empty", [el("strong", "", "Nothing matches"), el("span", "", `No file mentions “${state.query.trim()}”${state.scope === "all" ? "" : " in " + SCOPE_NAMES[state.scope]}.`)]);
      } else {
        message = el("div", "empty", [el("strong", "", "Nothing here yet"), el("span", "", `No ${SCOPE_NAMES[state.scope].toLowerCase()} files yet.`)]);
      }
      box.replaceChildren(message);
      return;
    }

    let i = 0;
    const groups = [];
    for (const scope of SCOPES) {
      const inScope = shown.filter((f) => f.scope === scope);
      if (!inScope.length) continue;
      const group = el("section", "group");
      const head = el("h3", "group-head", [el("span", "", SCOPE_NAMES[scope]), el("span", "group-count", plural(inScope.length, "file"))]);
      group.append(head);
      if (scope === "studio") {
        group.append(el("div", "cards", inScope.map((f) => fileCard(f, q, i++))));
      } else {
        // One little group per owner, the most recently updated first
        const owners = [];
        for (const f of inScope) if (!owners.includes(f.owner_id)) owners.push(f.owner_id);
        for (const owner of owners) {
          const label = ownerLabel(scope, owner);
          group.append(el("p", "owner-head", [el("span", "owner-kind", scope === "staff" ? "Staff member" : owner && owner.startsWith("chat:") ? "Not yet known" : "Client"), el("span", "", label)]));
          group.append(el("div", "cards", inScope.filter((f) => f.owner_id === owner).map((f) => fileCard(f, q, i++))));
        }
      }
      groups.push(group);
    }
    box.replaceChildren(...groups);
  }

  // One file's card (opened, it holds the editor)
  function fileCard(f, q, i) {
    const key = keyOf(f);
    const isOpen = state.open === key;
    const card = el("article", "card file" + (isOpen ? " open" : "") + (i < 24 && $("browse-list").classList.contains("animate") ? " card-in" : ""));
    card.style.setProperty("--i", String(Math.min(i, 12)));
    card.dataset.key = key;

    // The head works like a button (a real <button> can't hold a heading and paragraphs)
    const head = el("div", "file-head");
    head.setAttribute("role", "button");
    head.tabIndex = 0;
    head.setAttribute("aria-expanded", String(isOpen));
    head.setAttribute("data-sfx", isOpen ? "close" : "open");
    head.append(el("span", "file-path", f.path));
    head.append(el("h4", "file-name", [highlighted(titleOf(f), q)]));
    head.setAttribute("aria-label", `${titleOf(f)} (${f.path}), ${plural(f.facts || 0, "fact")}. ${isOpen ? "Close" : "Open"} it.`);
    if (f.description) head.append(el("p", "file-desc", [highlighted(f.description, q)]));
    const hit = factHit(f, q);
    if (hit) head.append(el("p", "file-hit", [tagPill(hit.tag), highlighted(hit.fact, q)]));
    const meta = el("span", "file-meta", [
      el("span", "file-facts", plural(f.facts || 0, "fact")),
      f.aliases && f.aliases.length ? el("span", "file-aliases", "aka " + aliasText(f.aliases)) : null,
      el("span", "", [f.source_app || "Someone", " · updated ", ago(f.updated_at)].join("")),
      state.drafts.has(key) && dirty(state.drafts.get(key)) && !isOpen ? el("span", "unsaved", "Unsaved edits") : null,
    ]);
    const chevron = icon(ICONS.chevron);
    chevron.setAttribute("class", "file-chevron");
    meta.append(chevron);
    head.append(meta);
    head.addEventListener("click", () => toggleFile(f));
    head.addEventListener("keydown", (e) => {
      if (e.target === head && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        head.click();
      }
    });
    card.append(head);

    if (isOpen) card.append(editorFor(key));
    return card;
  }

  // Open (or close) a file; its body is fetched the first time
  async function toggleFile(f) {
    const key = keyOf(f);
    if (state.open === key) {
      state.open = null;
      renderBrowse();
      return;
    }
    state.open = key;
    renderBrowse();
    scrollToCard(key);
    if (state.drafts.has(key)) return;
    try {
      const file = await fetchFile(f);
      if (!file) {
        toast("That file isn't there any more.", true);
        state.open = null;
        await loadIndex();
        renderAll();
        return;
      }
      state.drafts.set(key, newDraft(file));
    } catch (err) {
      toast(err.message, true);
      state.open = null;
    }
    if (state.tab === "browse") renderBrowse();
  }
  async function fetchFile(f) {
    const key = keyOf(f);
    const listed = state.files.find((x) => keyOf(x) === key);
    const cached = state.bodies.get(key);
    if (cached && (!listed || listed.version === cached.version)) return cached;
    const r = await api(API + "/file?" + fileQuery(f));
    if (r.status === 404) return null;
    if (!r.ok) throw new Problem(r.data.error || "Couldn't open that file.");
    state.bodies.set(key, r.data.file);
    return r.data.file;
  }
  function scrollToCard(key) {
    requestAnimationFrame(() => {
      const card = [...document.querySelectorAll(".file")].find((c) => c.dataset.key === key);
      if (card) card.scrollIntoView({ behavior: still() ? "auto" : "smooth", block: "nearest" });
    });
  }

  // ===== Editing a file =====

  function newDraft(file) {
    return {
      file, // the version it was opened at
      lines: parseBody(file.body).map((l) => ({ ...l, was: sameLine(l) })),
      description: file.description || "",
      aliases: aliasText(file.aliases),
      editing: -1,
      addTag: "stated",
      addText: "",
      confirm: false,
      conflict: null,
      saving: false,
      error: "",
    };
  }
  function dirty(d) {
    if (!d) return false;
    return bodyOf(d.lines) !== bodyOf(parseBody(d.file.body)) || d.description.trim() !== (d.file.description || "").trim() || aliasText(aliasList(d.aliases)) !== aliasText(d.file.aliases);
  }
  // Redraw just the open editor (so the rest of the page doesn't jump)
  function redrawEditor(key, focusSelector) {
    const card = [...document.querySelectorAll(".file")].find((c) => c.dataset.key === key);
    if (!card) return;
    const old = card.querySelector(".editor");
    const fresh = editorFor(key);
    if (old) old.replaceWith(fresh);
    else card.append(fresh);
    if (focusSelector) {
      const target = fresh.querySelector(focusSelector);
      if (target) target.focus();
    }
  }

  function editorFor(key) {
    const d = state.drafts.get(key);
    const box = el("div", "editor");
    if (!d) {
      box.append(el("p", "editor-loading", "Opening…"));
      return box;
    }
    const f = d.file;

    // "Someone changed it since you opened it"
    if (d.conflict) box.append(conflictPanel(key, d));

    // The facts
    const list = el("ul", "facts");
    if (!d.lines.length) list.append(el("li", "facts-empty", "No facts yet. Add the first one below."));
    d.lines.forEach((line, i) => list.append(factRow(key, d, line, i)));
    box.append(list);

    // Add a fact
    const addTag = tagSelect(d.addTag, "How we know the new fact");
    addTag.addEventListener("change", () => (d.addTag = addTag.value));
    const addText = el("input");
    addText.type = "text";
    addText.className = "add-text";
    addText.placeholder = "Add a fact, e.g. prefers evening sessions";
    addText.maxLength = 240;
    addText.value = d.addText;
    addText.setAttribute("aria-label", "A new fact");
    addText.addEventListener("input", () => (d.addText = addText.value));
    const add = () => {
      const fact = addText.value.trim();
      if (!fact) {
        addText.focus();
        return;
      }
      d.lines.push({ tag: addTag.value, fact });
      d.addText = "";
      redrawEditor(key, ".add-text");
    };
    addText.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        sfx("send");
        add();
      }
    });
    box.append(el("div", "fact-add-row", [addTag, addText, button("btn small", "+ Add", add)]));

    // What the file is (the index line) and other names for it
    const desc = el("input");
    desc.type = "text";
    desc.id = "desc-" + f.id;
    desc.maxLength = 200;
    desc.value = d.description;
    desc.addEventListener("input", () => {
      d.description = desc.value;
      markDirty(key);
    });
    const aliases = el("input");
    aliases.type = "text";
    aliases.id = "aliases-" + f.id;
    aliases.value = d.aliases;
    aliases.placeholder = "Other names, with commas";
    aliases.addEventListener("input", () => {
      d.aliases = aliases.value;
      markDirty(key);
    });
    const descLabel = el("label", "field-label", "What's in it (the index line)");
    descLabel.htmlFor = desc.id;
    const aliasLabel = el("label", "field-label", "Also known as");
    aliasLabel.htmlFor = aliases.id;
    box.append(el("div", "field-row", [el("div", "field", [descLabel, desc]), el("div", "field", [aliasLabel, aliases])]));

    if (d.error) box.append(el("p", "error", d.error));

    // Delete the whole file: asked in the page, never in a pop-up
    if (d.confirm) {
      box.append(
        el("div", "confirm", [
          el("p", "", `Delete ${f.path}${ownerLabel(f.scope, f.owner_id) ? " for " + ownerLabel(f.scope, f.owner_id) : ""} and its ${plural(parseBody(f.body).length, "fact")}? This can't be undone.`),
          el("div", "actions", [
            button("btn small danger solid", "Delete file", () => removeFile(key)),
            button("btn small ghost", "Keep it", () => {
              d.confirm = false;
              redrawEditor(key);
            }, { "data-sfx": "close" }),
          ]),
        ])
      );
    }

    // Save, discard, delete
    const isDirty = dirty(d);
    const save = button("btn", d.saving ? "Saving…" : "Save", () => saveFile(key), { "data-sfx": "send" });
    save.disabled = d.saving || !isDirty;
    const actions = el("div", "actions", [save]);
    if (isDirty) actions.append(button("btn ghost", "Discard changes", () => {
      const keep = d.file;
      state.drafts.set(key, newDraft(keep));
      redrawEditor(key);
      markDirty(key);
    }));
    if (!d.confirm) actions.append(button("btn ghost danger", "Delete file", () => {
      d.confirm = true;
      redrawEditor(key);
    }, { "data-sfx": "open" }));
    box.append(el("div", "editor-foot", [actions, el("span", "unsaved" + (isDirty ? "" : " is-clean"), isDirty ? "Unsaved changes" : "")]));
    box.append(el("p", "file-info", `Last written by ${f.source_app || "someone"} · ${ago(f.updated_at)}`));
    return box;
  }

  // Typing in the description or aliases: switch Save on without redrawing (so the caret stays put)
  function markDirty(key) {
    const d = state.drafts.get(key);
    const card = [...document.querySelectorAll(".file")].find((c) => c.dataset.key === key);
    if (!card || !d) return;
    const isDirty = dirty(d);
    const save = card.querySelector(".editor-foot .btn:not(.ghost)");
    if (save) save.disabled = d.saving || !isDirty;
    const note = card.querySelector(".editor-foot .unsaved");
    if (note) note.textContent = isDirty ? "Unsaved changes" : "";
    const hasDiscard = [...card.querySelectorAll(".editor-foot .btn")].some((b) => b.textContent === "Discard changes");
    if (isDirty !== hasDiscard) redrawEditorKeepingFocus(key);
  }
  function redrawEditorKeepingFocus(key) {
    const active = document.activeElement;
    const id = active && active.id;
    const pos = active && typeof active.selectionStart === "number" ? active.selectionStart : null;
    redrawEditor(key);
    if (id) {
      const again = document.getElementById(id);
      if (again) {
        again.focus();
        if (pos !== null) again.setSelectionRange(pos, pos);
      }
    }
  }

  // One fact line: its tag and text, with edit and delete (or, being edited, a tag picker and a text box)
  function factRow(key, d, line, i) {
    const changed = line.was === undefined ? "added" : line.was !== sameLine(line) ? "changed" : "";
    if (d.editing === i) {
      const row = el("li", "fact editing");
      const tag = tagSelect(line.tag, "How we know it");
      const text = el("input");
      text.type = "text";
      text.className = "edit-text";
      text.maxLength = 240;
      text.value = line.fact;
      text.setAttribute("aria-label", "The fact");
      const done = () => {
        const fact = text.value.trim();
        if (!fact) d.lines.splice(i, 1);
        else d.lines[i] = { ...line, tag: tag.value, fact };
        d.editing = -1;
        redrawEditor(key);
      };
      text.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          sfx("done");
          done();
        } else if (e.key === "Escape") {
          d.editing = -1;
          redrawEditor(key);
        }
      });
      row.append(
        el("div", "fact-edit", [
          el("div", "fact-add", [tag, text]),
          el("div", "actions", [
            button("btn small", "✓ Done", done),
            button("btn small ghost", "Cancel", () => {
              d.editing = -1;
              redrawEditor(key);
            }),
          ]),
        ])
      );
      return row;
    }
    const row = el("li", "fact" + (changed ? " " + changed : ""));
    row.append(el("p", "fact-text", [tagPill(line.tag), document.createTextNode(line.fact)]));
    const edit = button("icon-btn", "", () => {
      d.editing = i;
      redrawEditor(key, ".edit-text");
    }, { "aria-label": "Edit this fact", title: "Edit" });
    edit.append(icon(ICONS.edit));
    const del = button("icon-btn del", "", () => {
      d.lines.splice(i, 1);
      if (d.editing > i) d.editing--;
      redrawEditor(key);
    }, { "aria-label": "Delete this fact", title: "Delete" });
    del.append(icon(ICONS.del));
    row.append(el("div", "fact-tools", [edit, del]));
    return row;
  }

  // Save: written only if nobody else changed the file since it was opened (if_version)
  async function saveFile(key) {
    const d = state.drafts.get(key);
    if (!d || d.saving) return;
    if (d.editing >= 0) {
      // A line still being edited: keep what's typed in it
      const text = document.querySelector(".fact.editing .edit-text");
      const tag = document.querySelector(".fact.editing select");
      if (text && text.value.trim()) d.lines[d.editing] = { ...d.lines[d.editing], fact: text.value.trim(), tag: tag ? tag.value : d.lines[d.editing].tag };
      d.editing = -1;
    }
    const f = d.file;
    const body = bodyOf(d.lines);
    d.saving = true;
    d.error = "";
    redrawEditor(key);
    try {
      const r = await api(API + "/file", {
        method: "PUT",
        body: { scope: f.scope, owner_id: f.scope === "studio" ? null : f.owner_id, path: f.path, name: f.name, description: d.description.trim(), aliases: aliasList(d.aliases), body, if_version: f.version },
      });
      d.saving = false;
      if (r.status === 409 && r.data.current) {
        d.conflict = r.data.current;
        sfx("error");
        redrawEditor(key);
        return;
      }
      if (r.status === 409) {
        // The file was deleted meanwhile
        d.error = "This file was deleted by someone else. Copy anything you need, then close it.";
        redrawEditor(key);
        return;
      }
      if (!r.ok) {
        d.error = r.data.error || "That didn't save. Try again.";
        sfx("error");
        redrawEditor(key);
        return;
      }
      afterSave(key, r.data.file, d.lines.filter((l) => l.fact.trim()).length);
    } catch (err) {
      d.saving = false;
      d.error = err.message;
      redrawEditor(key);
    }
  }
  async function afterSave(key, file, sent) {
    state.bodies.set(key, file);
    state.drafts.set(key, newDraft(file));
    const kept = parseBody(file.body).length;
    if (kept < sent) toast(`Saved. ${plural(sent - kept, "line")} wasn't kept: memory never stores card, bank or ID numbers, or repeats.`, true);
    else toast("Saved");
    sfx("done");
    // The page's own save shouldn't light up Live as "new"
    if (state.known) state.known.set(file.id, { version: file.version, facts: file.facts || kept });
    await refreshAfterChange();
  }
  async function refreshAfterChange() {
    try {
      await Promise.all([loadIndex(), loadStats()]);
    } catch (err) {}
    renderStats();
    renderBrowse();
    renderLive();
  }

  // "Changed since you opened it": show theirs and yours, and offer to put my edit on top of theirs
  function conflictPanel(key, d) {
    const theirs = d.conflict;
    const base = parseBody(d.file.body);
    const baseSet = new Set(base.map(sameLine));
    const mine = d.lines.filter((l) => l.fact.trim());
    const mineSet = new Set(mine.map(sameLine));
    const theirLines = parseBody(theirs.body);

    const theirsList = el("ul", "", theirLines.length ? theirLines.map((l) => el("li", baseSet.has(sameLine(l)) ? "" : "new-line", [tagPill(l.tag), " ", l.fact])) : [el("li", "", "(no facts)")]);
    const removed = base.filter((l) => !mineSet.has(sameLine(l)));
    const yoursList = el("ul", "", [
      ...mine.map((l) => el("li", baseSet.has(sameLine(l)) ? "" : "new-line", [tagPill(l.tag), " ", l.fact])),
      ...removed.map((l) => el("li", "gone-line", [tagPill(l.tag), " ", l.fact])),
    ]);
    if (!yoursList.children.length) yoursList.append(el("li", "", "(no facts)"));

    return el("div", "conflict", [
      el("p", "conflict-title", "This file changed since you opened it"),
      el("p", "conflict-sub", `${theirs.source_app || "Someone"} saved it ${ago(theirs.updated_at)}. Nothing of yours is lost: put your edit on top of their version in one tap.`),
      el("div", "conflict-sides", [
        el("div", "side", [el("span", "field-label", "Now (theirs)"), theirsList]),
        el("div", "side", [el("span", "field-label", "Your edit"), yoursList]),
      ]),
      el("div", "actions", [
        button("btn small", "Use the latest and re-apply my edit", () => reapply(key), { "data-sfx": "send" }),
        button("btn small ghost", "Keep theirs, drop mine", () => {
          state.drafts.set(key, newDraft(theirs));
          state.bodies.set(key, theirs);
          redrawEditor(key);
          refreshAfterChange();
        }, { "data-sfx": "close" }),
      ]),
    ]);
  }

  // My changes (what I added, removed or reworded since opening) put onto their latest version, then saved
  function reapply(key) {
    const d = state.drafts.get(key);
    const theirs = d.conflict;
    const base = parseBody(d.file.body);
    const baseSet = new Set(base.map(sameLine));
    const mine = d.lines.filter((l) => l.fact.trim());
    const mineSet = new Set(mine.map(sameLine));
    const gone = new Set(base.filter((l) => !mineSet.has(sameLine(l))).map(sameLine));
    const added = mine.filter((l) => !baseSet.has(sameLine(l)));
    const merged = parseBody(theirs.body).filter((l) => !gone.has(sameLine(l)));
    const have = new Set(merged.map(sameLine));
    for (const l of added) if (!have.has(sameLine(l))) merged.push(l);
    // The description and aliases: mine if I changed them, otherwise theirs
    const myDesc = d.description.trim() !== (d.file.description || "").trim() ? d.description : theirs.description || "";
    const myAliases = aliasText(aliasList(d.aliases)) !== aliasText(d.file.aliases) ? d.aliases : aliasText(theirs.aliases);
    const next = newDraft(theirs);
    next.lines = merged.map((l) => ({ ...l, was: baseOrTheirs(l, theirs) }));
    next.description = myDesc;
    next.aliases = myAliases;
    state.drafts.set(key, next);
    state.bodies.set(key, theirs);
    saveFile(key);
  }
  // Lines that are in their version count as "unchanged"; the rest show as mine
  function baseOrTheirs(l, theirs) {
    return parseBody(theirs.body).some((t) => sameLine(t) === sameLine(l)) ? sameLine(l) : undefined;
  }

  async function removeFile(key) {
    const d = state.drafts.get(key);
    if (!d) return;
    try {
      await must(API + "/file?" + fileQuery(d.file), { method: "DELETE" });
      state.drafts.delete(key);
      state.bodies.delete(key);
      state.open = null;
      toast(`Deleted ${d.file.path}`);
      await refreshAfterChange();
    } catch (err) {
      d.error = err.message;
      redrawEditor(key);
    }
  }

  // ===== A new file =====

  function openNewForm() {
    const form = $("new-form");
    form.hidden = false;
    setTab("browse");
    $("new-error").textContent = "";
    drawNewForm();
    form.scrollIntoView({ behavior: still() ? "auto" : "smooth", block: "start" });
    setTimeout(() => (state.newScope === "studio" ? $("new-desc") : $("new-owner")).focus({ preventScroll: true }), 50);
  }
  function closeNewForm() {
    $("new-form").hidden = true;
    $("new-form").reset();
  }
  function drawNewForm() {
    const scope = state.newScope;
    for (const b of $("new-scope").querySelectorAll(".chip")) {
      const on = b.dataset.value === scope;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    }
    $("new-owner-field").hidden = scope === "studio";
    $("new-owner-label").textContent = scope === "staff" ? "Which staff member" : "Which client (their email)";
    $("new-owner").placeholder = scope === "staff" ? "e.g. eric" : "e.g. kai@example.com";
    // The owners already known, to pick from
    const owners = [...new Set(state.files.filter((f) => f.scope === scope && f.owner_id).map((f) => f.owner_id))];
    $("owner-list").replaceChildren(...owners.map((o) => Object.assign(document.createElement("option"), { value: o })));
    if (!KINDS[scope].includes(state.newKind)) state.newKind = KINDS[scope][0];
    $("new-kind").replaceChildren(
      ...KINDS[scope].map((kind) => {
        const b = button("chip" + (kind === state.newKind ? " active" : ""), NAMED.includes(kind) ? kind + "/…" : kind, () => {
          state.newKind = kind;
          drawNewForm();
        }, { "aria-pressed": String(kind === state.newKind) });
        return b;
      })
    );
    $("new-kind-help").textContent = KIND_HELP[state.newKind] || "";
    $("new-name-field").hidden = !NAMED.includes(state.newKind);
    $("new-name").placeholder = { people: "e.g. Kai", topics: "e.g. pricing", areas: "e.g. ep-release" }[state.newKind] || "";
  }
  $("new-scope").addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    state.newScope = b.dataset.value;
    drawNewForm();
  });
  $("new-file").addEventListener("click", () => ($("new-form").hidden ? openNewForm() : closeNewForm()));
  $("new-cancel").addEventListener("click", closeNewForm);
  $("new-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const error = $("new-error");
    error.textContent = "";
    const scope = state.newScope;
    const owner = $("new-owner").value.trim().toLowerCase();
    const kind = state.newKind;
    const name = $("new-name").value.trim();
    if (scope !== "studio" && !owner) {
      error.textContent = scope === "staff" ? "Which staff member is it for?" : "Which client is it for? Their email works best.";
      $("new-owner").focus();
      return;
    }
    if (NAMED.includes(kind) && !name) {
      error.textContent = "Give it a name, like Kai or pricing.";
      $("new-name").focus();
      return;
    }
    const slug = name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    const path = NAMED.includes(kind) ? `${kind}/${slug}` : kind;
    const fact = $("new-fact").value.trim();
    const body = fact ? `- [${$("new-tag").value}] ${fact}` : "";
    const go = e.submitter || $("new-form").querySelector('button[type="submit"]');
    go.disabled = true;
    try {
      const r = await api(API + "/file", {
        method: "PUT",
        body: { scope, owner_id: scope === "studio" ? null : owner, path, name: NAMED.includes(kind) ? name : "", description: $("new-desc").value.trim(), aliases: [], body, if_version: "new" },
      });
      if (r.status === 409 && r.data.current) {
        // It's already there: open that one instead
        closeNewForm();
        await refreshAfterChange();
        openByKey(keyOf(r.data.current));
        toast("That file already exists, so it's open for you.");
        return;
      }
      if (!r.ok) {
        error.textContent = r.data.error || "That didn't work. Try again.";
        sfx("error");
        return;
      }
      closeNewForm();
      sfx("done");
      toast(`Created ${r.data.file.path}`);
      if (state.known) state.known.set(r.data.file.id, { version: r.data.file.version, facts: r.data.file.facts || 0 });
      state.bodies.set(keyOf(r.data.file), r.data.file);
      await refreshAfterChange();
      openByKey(keyOf(r.data.file));
    } catch (err) {
      error.textContent = err.message;
    } finally {
      go.disabled = false;
    }
  });

  // Show one file in Browse, opened (from Live, or after creating it)
  function openByKey(key) {
    const f = state.files.find((x) => keyOf(x) === key);
    if (!f) return;
    setTab("browse");
    if (state.scope !== "all" && state.scope !== f.scope) setScope("all");
    if (state.query && !matches(f, state.query.trim().toLowerCase())) {
      state.query = "";
      $("search").value = "";
    }
    if (state.open === key) {
      renderBrowse();
      scrollToCard(key);
    } else toggleFile(f);
  }

  // ===== Filter and search =====

  function setScope(scope) {
    state.scope = scope;
    for (const b of $("scope-chips").querySelectorAll(".chip")) {
      const on = b.dataset.scope === scope;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    }
    renderBrowse(true);
  }
  $("scope-chips").addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (b) setScope(b.dataset.scope);
  });

  let searchTimer = 0;
  $("search").addEventListener("input", () => {
    state.query = $("search").value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      renderBrowse(true);
      if (state.query.trim().length >= 2) loadBodiesForSearch();
    }, 120);
  });
  // Searching also looks inside the facts: the server searches every file and says which lines matched
  let searchSeq = 0;
  async function loadBodiesForSearch() {
    const q = state.query.trim().toLowerCase();
    const mine = ++searchSeq;
    try {
      const r = await api(API + "/index?q=" + encodeURIComponent(q));
      if (mine !== searchSeq || !r.ok) return;
      const map = new Map();
      for (const f of r.data.files || []) map.set(keyOf(f), f.matches && f.matches.length ? f.matches : [""]);
      state.searchHits = { q, map };
      if (state.query.trim().toLowerCase() === q) renderBrowse();
    } catch (err) {}
  }

  // ===== Live =====

  // Which app's mark goes with a source
  function sourceMark(app) {
    const a = String(app || "").toLowerCase();
    if (a.includes("agent")) return "i-mark-a";
    if (a.includes("hub")) return "i-mark-h";
    if (a.includes("bot") || a.includes("website")) return "i-mark-bot";
    return "i-mark-i";
  }

  function renderLive() {
    const total = state.files.reduce((n, f) => n + (f.facts || 0), 0);
    $("live-total").textContent = String(total);
    const grown = state.startFacts === null ? 0 : total - state.startFacts;
    $("live-since").textContent = grown > 0 ? `+${plural(grown, "fact")} since you opened this` : state.files.length ? `in ${plural(state.files.length, "file")}` : "";
    renderLiveChecked();

    const feed = $("live-feed");
    const rows = state.files.slice(0, 40);
    if (!rows.length) {
      feed.replaceChildren(el("li", "empty", [el("strong", "", "Quiet so far"), el("span", "", "When a Nova app learns something, it shows up here.")]));
      return;
    }
    feed.replaceChildren(
      ...rows.map((f) => {
        const change = state.changes.get(f.id);
        const who = f.source_app || "Someone";
        const n = f.facts || 0;
        let verb;
        let after = "";
        if (change && change.delta > 0) verb = `learned ${plural(change.delta, change.isNew ? "fact" : "new fact")} in`;
        else if (change && change.delta < 0) [verb, after] = ["tidied", ` (${plural(n, "fact")} now)`];
        else if (change) verb = "updated";
        else verb = n ? `learned ${plural(n, "fact")} in` : "started";
        const text = el("span", "feed-text", [el("strong", "", who), ` ${verb} `, el("span", "feed-where", where(f)), after, f.description ? el("span", "feed-desc", f.description) : null, el("span", "feed-when", ago(f.updated_at))]);
        const row = el("button", "feed-row" + (change && change.fresh ? " fresh" : ""), [mark(sourceMark(who), "feed-mark"), text]);
        row.type = "button";
        row.setAttribute("aria-label", `${who} ${verb} ${where(f)}${after}, ${ago(f.updated_at)}. Open it.`);
        row.addEventListener("click", () => openByKey(keyOf(f)));
        if (change) change.fresh = false; // glows once
        return el("li", "", [row]);
      })
    );
  }
  function renderLiveChecked() {
    const status = $("live-status");
    const paused = document.visibilityState !== "visible";
    status.classList.toggle("paused", paused);
    if (paused) $("live-checked").textContent = "Paused";
    else if (!state.lastCheck) $("live-checked").textContent = "Listening";
    else {
      const s = Math.round((Date.now() - state.lastCheck) / 1000);
      $("live-checked").textContent = s < 5 ? "Listening · just checked" : `Listening · checked ${s} s ago`;
    }
  }

  // Every 20 seconds while Live is on screen: look for new memory
  let liveBusy = false;
  async function liveTick() {
    if (!state.signedIn || state.tab !== "live" || document.visibilityState !== "visible" || liveBusy) return;
    liveBusy = true;
    try {
      await Promise.all([loadIndex(), loadStats()]);
      renderStats();
      renderLive();
      if (!state.open) renderBrowse();
    } catch (err) {}
    liveBusy = false;
  }
  setInterval(liveTick, LIVE_EVERY);
  setInterval(() => state.tab === "live" && renderLiveChecked(), 5000);
  document.addEventListener("visibilitychange", () => {
    renderLiveChecked();
    if (document.visibilityState === "visible" && Date.now() - state.lastCheck > LIVE_EVERY) liveTick();
  });

  // ===== Approve =====

  function renderPending(animate = false) {
    const box = $("pending-list");
    if (state.pendingLocked) {
      const note = el("div", "empty", [el("strong", "", "Approvals are in Nova Hub"), el("span", "", "Customers' facts and the approval queue need Nova Hub's sign-in, so they aren't shown inside Nova Agent.")]);
      const go = el("a", "btn", "Open Nova Index in Nova Hub ↗");
      go.href = "https://novacane-worker.novacane-studio.workers.dev/app/memory/";
      go.target = "_blank";
      go.rel = "noopener";
      note.appendChild(go);
      return box.replaceChildren(note);
    }
    box.classList.toggle("animate", animate);
    if (!state.pending.length) {
      box.replaceChildren(el("div", "empty", [el("strong", "", "Nothing waiting"), el("span", "", "New facts from customer chats will appear here for a yes or no.")]));
      return;
    }
    box.replaceChildren(...state.pending.map((p, i) => pendingCard(p, i)));
  }

  function pendingCard(p, i) {
    const card = el("article", "card pending" + (i < 20 && $("pending-list").classList.contains("animate") ? " card-in" : ""));
    card.style.setProperty("--i", String(Math.min(i, 12)));
    const editing = state.editingPending.has(p.id);
    card.append(el("span", "pending-where", where({ scope: p.scope, owner_id: p.owner_id }, p.target)));
    let input = null;
    if (editing) {
      input = el("textarea", "pending-edit");
      input.rows = 2;
      input.maxLength = 240;
      input.value = p.edited ?? p.fact;
      input.setAttribute("aria-label", "The fact, to edit before approving");
      input.addEventListener("input", () => (p.edited = input.value));
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          decide(p, "approve", card);
        }
      });
      card.append(el("div", "", [tagPill(p.tag)]), input);
    } else {
      card.append(el("p", "pending-fact", [tagPill(p.tag), document.createTextNode(" " + (p.edited ?? p.fact))]));
    }
    const ref = String(p.source_ref || "").replace(/^chat[-:_]?/i, "");
    const from = [p.source_app ? "From " + p.source_app : "", ref ? "chat " + ref.slice(0, 8) : "", ago(p.created_at)].filter(Boolean).join(" · ");
    card.append(el("p", "pending-meta", from));

    const approve = button("btn small ok", editing ? "✓ Approve edited" : "✓ Approve", () => decide(p, "approve", card), { "data-sfx": "done" });
    const edit = editing
      ? button("btn small ghost", "Cancel", () => {
          state.editingPending.delete(p.id);
          delete p.edited;
          renderPending();
        }, { "data-sfx": "close" })
      : button("btn small ghost", "✎ Edit", () => {
          state.editingPending.add(p.id);
          renderPending();
          const again = $("pending-list").querySelector(".pending-edit");
          if (again) {
            again.focus();
            again.setSelectionRange(again.value.length, again.value.length);
          }
        }, { "data-sfx": "open" });
    const reject = button("btn small ghost danger", "✕ Reject", () => decide(p, "reject", card), { "data-sfx": "remove" });
    card.append(el("div", "actions", [approve, edit, reject]));
    return card;
  }

  // Approve (with the edited words, if any) or reject, then the card slides away
  async function decide(p, action, card) {
    const buttons = card.querySelectorAll("button");
    buttons.forEach((b) => (b.disabled = true));
    const body = { action };
    if (action === "approve" && p.edited !== undefined && p.edited.trim() && p.edited.trim() !== p.fact) body.fact = p.edited.trim();
    if (action === "approve" && p.edited !== undefined && !p.edited.trim()) {
      toast("The fact is empty. Write it, or reject it.", true);
      buttons.forEach((b) => (b.disabled = false));
      return;
    }
    try {
      const r = await api(API + "/pending/" + encodeURIComponent(p.id), { method: "POST", body });
      const gone = () => {
        state.pending = state.pending.filter((x) => x.id !== p.id);
        state.editingPending.delete(p.id);
        if (state.stats) state.stats.pending = state.pending.length;
        renderPending();
        renderStats();
      };
      if (r.status === 404) {
        toast("Someone already dealt with that one.");
        gone();
        return;
      }
      if (!r.ok) {
        // The server has already taken it off the queue, so it's gone either way
        toast((r.data.error || "That didn't work") + ". It was dropped, not remembered.", true);
        gone();
        return;
      }
      const leave = () => {
        gone();
        if (action === "approve") refreshAfterChange();
      };
      if (still()) leave();
      else {
        card.classList.add("going");
        if (action === "reject") card.classList.add("rejected");
        setTimeout(leave, 340);
      }
      toast(action === "approve" ? `Remembered in ${where({ scope: p.scope, owner_id: p.owner_id }, p.target)}` : "Rejected. It won't be remembered.");
    } catch (err) {
      toast(err.message, true);
      buttons.forEach((b) => (b.disabled = false));
    }
  }

  // ===== Tabs =====

  function setTab(tab) {
    if (state.tab === tab) return;
    state.tab = tab;
    for (const b of document.querySelectorAll(".tab")) {
      const on = b.dataset.tab === tab;
      b.classList.toggle("active", on);
      if (on) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    }
    $("view-browse").hidden = tab !== "browse";
    $("view-live").hidden = tab !== "live";
    $("view-approve").hidden = tab !== "approve";
    window.scrollTo({ top: 0 });
    if (tab === "live") {
      renderLive();
      liveTick();
    }
    if (tab === "approve") {
      loadPending()
        .then(() => {
          renderPending(true);
          renderStats();
        })
        .catch(() => {});
    }
  }
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

  // The stats tiles take you to what they count
  document.querySelectorAll(".stat").forEach((b) =>
    b.addEventListener("click", () => {
      const what = b.dataset.stat;
      if (what === "pending") setTab("approve");
      else {
        setTab("browse");
        setScope(state.scope === what ? "all" : what);
      }
    })
  );

  $("brand").addEventListener("click", () => window.scrollTo({ top: 0, behavior: still() ? "auto" : "smooth" }));

  // ===== Options =====

  const sheet = $("options-sheet");
  const sfxSwitch = $("sfx-switch");
  function openOptions() {
    sfxSwitch.checked = window.NovaSfx ? window.NovaSfx.enabled() : false;
    sfxSwitch.disabled = !window.NovaSfx;
    sheet.hidden = false;
    $("options-close").focus();
  }
  function closeOptions() {
    if (sheet.hidden) return;
    sheet.hidden = true;
    $("options").focus();
  }
  $("options").addEventListener("click", openOptions);
  $("options-close").addEventListener("click", closeOptions);
  sheet.addEventListener("click", (e) => e.target === sheet && closeOptions());
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeOptions());
  sfxSwitch.addEventListener("change", () => window.NovaSfx && window.NovaSfx.setEnabled(sfxSwitch.checked));
  $("refresh").addEventListener("click", async () => {
    closeOptions();
    await loadAll();
    toast("Up to date");
  });
  $("logout").addEventListener("click", async () => {
    closeOptions();
    try {
      await api("/app/api/logout", { method: "POST", body: {} });
    } catch (err) {}
    state.known = null;
    state.changes.clear();
    state.bodies.clear();
    state.drafts.clear();
    state.open = null;
    showLogin();
  });

  // ===== A soft ripple where buttons are pressed =====
  document.addEventListener("pointerdown", (e) => {
    const b = e.target.closest(".btn, .chip, .tab, .icon-btn, .stat");
    if (!b || b.disabled || still()) return;
    const r = b.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2;
    const dot = el("span", "ripple");
    dot.style.width = dot.style.height = size + "px";
    dot.style.left = e.clientX - r.left - size / 2 + "px";
    dot.style.top = e.clientY - r.top - size / 2 + "px";
    b.append(dot);
    setTimeout(() => dot.remove(), 600);
  });

  // ===== Start: signed in already (Nova Hub's cookie)? =====
  (async () => {
    try {
      const r = await api(API + "/stats");
      if (!r.ok) throw new Problem(r.data.error || "Nova Index couldn't load.");
      state.stats = r.data;
      showApp();
      await loadAll();
      // Opened from someone's Nova Portal profile ("Open my Nova Index"): show just theirs
      const params = new URLSearchParams(location.search);
      if (["studio", "staff", "customer"].includes(params.get("scope"))) setScope(params.get("scope"));
      if (params.get("owner")) {
        $("search").value = params.get("owner");
        $("search").dispatchEvent(new Event("input"));
      }
    } catch (err) {
      // A 401 has already shown the sign-in card; anything else is worth saying
      if (state.signedIn || !$("login").hidden) return;
      showApp();
      toast(err.message, true);
    }
  })();
})();
