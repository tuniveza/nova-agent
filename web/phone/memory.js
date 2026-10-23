// Nova Phone: Index, what Nova remembers (Nova Desk's Index). One-line facts, each tagged stated (said directly),
// observed (seen in bookings or behaviour) or inferred (a pattern we've noticed), kept in files by memory: the
// studio's, each staff member's, each customer's. Three screens, one tap apart:
//   Browse   the numbers (files and facts in each memory, facts waiting), one box to search or ask (typos are
//            fine; a question gets Ask Index's answer from memory, with its sources), filters, pinned and recent
//            files, gentle hints, and every file grouped by memory and owner; a file opens on its own screen to
//            add, change or remove facts, its line and other names, saved only if nobody changed it meanwhile
//            (if they did: theirs and yours side by side, yours put on top in one tap)
//   Live     memory as it grows, newest first, looked at every 20 s while it's on screen
//   Approve  facts learned from customers, waiting for a yes; admins also Tidy up (check, then remove, 30-day bin)
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, field, empty, toast } = N;
  const M = "/app/api/memory";
  const H = { "X-Nova-App": "index" };
  const get = (p) => N.api(`${M}${p}`, { headers: H, cache: "no-store" });
  const send = (p, method, body) => N.api(`${M}${p}`, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  const SCOPES = ["studio", "staff", "customer"];
  const SCOPE_NAMES = { studio: "Studio", staff: "Staff", customer: "Customers" };
  const TAGS = ["stated", "observed", "inferred"];
  const TAG_HELP = { stated: "said directly", observed: "seen in bookings or behaviour", inferred: "a pattern we've noticed" };
  const KINDS = { studio: ["studio", "public", "people", "topics", "areas"], staff: ["profile", "people", "topics", "areas", "studio"], customer: ["profile", "people", "topics"] };
  const KIND_HELP = { studio: "How the studio runs (only the team sees it)", public: "Studio facts customers may be told", profile: "About this person themselves", people: "Someone they work with or talk about", topics: "A subject: pricing, gear, a process", areas: "An ongoing piece of work, like an EP release" };
  const KIND_FILTER = [["any", "Any kind"], ["studio", "The studio"], ["public", "Public facts"], ["profile", "Profiles"], ["people", "People"], ["topics", "Topics"], ["areas", "Areas"]];
  const WHEN_FILTER = [["any", "Any time"], ["today", "Today"], ["week", "This week"], ["month", "This month"], ["old", "6+ months old"]];
  const NAMED = ["people", "topics", "areas"];
  const PLAIN_TITLES = { profile: "Profile", public: "Public facts", studio: "The studio" };

  // ---- Little helpers ----
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;
  const ms = (v) => { const d = N.asDate(v); return d ? d.getTime() : 0; };
  // "just now", "4 min ago", "3 h ago", "2 days ago", "6 Oct" (Nova Desk's Index; its times are seconds)
  function rel(v) {
    const t = ms(v);
    if (!t) return "";
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 45) return "just now";
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    if (s < 7 * 86400) return `${plural(Math.round(s / 86400), "day")} ago`;
    return new Date(t).toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" });
  }
  const keyOf = (f) => `${f.scope}\u0001${f.owner_id || ""}\u0001${f.path}`;
  // A file's address: #index/file/<memory>/<owner>/<path> (the studio's have no owner: #index/file/studio//topics/pricing)
  const hrefOf = (f) => `#index/file/${encodeURIComponent(f.scope)}/${encodeURIComponent(f.owner_id || "")}/${String(f.path).split("/").map(encodeURIComponent).join("/")}`;
  const titleOf = (f) => (!f.name || f.name === f.path ? PLAIN_TITLES[f.path] || f.path : f.name);
  function ownerLabel(scope, owner) {
    if (scope === "studio" || !owner) return "";
    if (String(owner).startsWith("chat:")) return `Website chat ${String(owner).slice(5, 13)}`;
    return owner;
  }
  const where = (f, target) => [f.scope === "customer" ? "customer" : f.scope, ownerLabel(f.scope, f.owner_id), target || f.path].filter(Boolean).join(" · ");
  const fileQuery = (f) => { const p = new URLSearchParams({ scope: f.scope, path: f.path }); if (f.scope !== "studio" && f.owner_id) p.set("owner_id", f.owner_id); return p.toString(); };
  const parseBody = (body) => String(body || "").split("\n").map((l) => l.trim().match(/^-\s*\[(stated|observed|inferred)\]\s*(.+)$/i)).filter(Boolean).map((m) => ({ tag: m[1].toLowerCase(), fact: m[2].trim() }));
  const lineOf = (l) => `- [${l.tag}] ${l.fact.replace(/\s+/g, " ").trim()}`;
  const bodyOf = (lines) => lines.filter((l) => l.fact.trim()).map(lineOf).join("\n");
  const sameLine = (l) => lineOf(l).toLowerCase();
  const aliasText = (list) => (list || []).join(", ");
  const aliasList = (text) => String(text || "").split(",").map((a) => a.trim()).filter(Boolean);
  const pill = (tag) => { const t = TAGS.includes(tag) ? tag : "stated"; return `<span class="memory-tag t-${t}" title="${esc(TAG_HELP[t])}">${t}</span>`; };
  const tagChoices = (name, value) => `<fieldset class="field"><legend>How we know it</legend><div class="seg">${TAGS.map((t) => `<label><input type="radio" name="${name}" value="${t}"${t === value ? " checked" : ""}>${t[0].toUpperCase()}${t.slice(1)}</label>`).join("")}</div><small class="memory-tag-help">Stated: said directly · Observed: seen in bookings or behaviour · Inferred: a pattern we've noticed</small></fieldset>`;
  const radio = (form, name) => [...form.querySelectorAll(`[name="${name}"]`)].find((r) => r.checked)?.value;
  // The search's words lit up (escaped first)
  function lit(text, q) {
    const words = q ? q.split(/\s+/).filter((w) => w.length > 1) : [];
    if (!words.length) return esc(text);
    const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    return String(text).split(re).map((part, i) => (i % 2 ? `<mark class="memory-mark">${esc(part)}</mark>` : esc(part))).join("");
  }
  const store = (() => { try { const s = window.localStorage; s.getItem("nova-index-shelf"); return s; } catch (e) { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; } })();

  // ---- Index's smart helpers (Nova Desk's index/smart.js, the same rules) ----
  const STOP = new Set("the and for are was were what who whom whose which when where why how does did done has have had with that this these those from into about any all our your their they them there here not but can could would should will just than then also its is am be been being of to in on at by an as or if do me my we us you he she his her him it know known tell say said get got like want much many".split(" "));
  const words = (text) => String(text || "").toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
  const stem = (w) => (w.length > 4 ? w.replace(/(?:ings|ing|ers|ies|es|ed|ly|s)$/, "") : w);
  function dist(a, b, max) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      let best = i;
      for (let j = 1; j <= b.length; j++) {
        let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        row.push(v);
        if (v < best) best = v;
      }
      if (best > max) return max + 1;
      prev2 = prev; prev = row;
    }
    return Math.min(prev[b.length], max + 1);
  }
  const allowance = (a, b) => { const longer = Math.max(a.length, b.length); return longer >= 8 ? 2 : longer >= 4 && Math.min(a.length, b.length) >= 3 ? 1 : 0; };
  const near = (a, b) => a === b || (a.length >= 4 && b.startsWith(a)) || (allowance(a, b) > 0 && dist(a, b, allowance(a, b)) <= allowance(a, b));
  const alike = (a, b) => near(a, b) || near(stem(a), stem(b));
  function fuzzyHas(hay, q) {
    const want = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
    const text = String(hay || "").toLowerCase();
    let have = null;
    return want.every((w) => text.includes(w) || (w.length >= 3 && (have = have || words(text)).some((h) => alike(w, h))));
  }
  const lineHit = (line, q) => { const text = String(line || "").toLowerCase(); return String(q || "").toLowerCase().split(/\s+/).filter((w) => w.length > 1).some((w) => text.includes(w) || (w.length >= 3 && words(text).some((h) => alike(w, h)))); };
  function suggest(q, known) {
    let changed = false;
    const out = String(q || "").toLowerCase().split(/\s+/).filter(Boolean).map((w) => {
      if (known.has(w) || w.length < 3) return w;
      let best = null, bestD = 3;
      for (const k of known) { if (Math.abs(k.length - w.length) > 2) continue; const d = dist(w, k, 2); if (d < bestD) { best = k; bestD = d; } }
      if (best && bestD <= Math.max(1, allowance(w, best))) { changed = true; return best; }
      return w;
    });
    return changed ? out.join(" ") : null;
  }
  const vocabulary = (files) => { const out = new Set(); for (const f of files) for (const w of words([f.name, f.description, f.path, aliasText(f.aliases), f.owner_id, bodyFor(f)].join(" "))) if (w.length >= 3) out.add(w); return out; };
  const ASKING = /^(who|what|whats|what's|when|where|why|how|which|does|do|did|is|are|was|were|can|could|should|has|have|tell me|remind me)\b/i;
  const looksLikeQuestion = (q) => { const t = String(q || "").trim(); return t.length >= 6 && (/\?$/.test(t) || (ASKING.test(t) && t.split(/\s+/).length >= 3)); };
  const about = (f, body) => new Set(words([f.name, f.description, String(f.path || "").replace(/\//g, " "), aliasText(f.aliases), body || ""].join(" ")).filter((w) => w.length >= 3 && !STOP.has(w)).map(stem));
  const namesOf = (f) => [f.name, ...(f.aliases || []), String(f.path || "").split("/").pop()].filter((n) => n && n.length >= 3).map((n) => String(n).toLowerCase().replace(/-/g, " "));
  function related(file, max = 4) {
    const mine = about(file, bodyFor(file)), myText = [file.description, bodyFor(file)].join(" ").toLowerCase();
    const out = [];
    for (const f of state.files) {
      if (keyOf(f) === keyOf(file)) continue;
      const theirs = about(f, bodyFor(f));
      let score = 0;
      for (const w of mine) if (theirs.has(w)) score += 1;
      if (namesOf(f).some((n) => myText.includes(n))) score += 3;
      if (namesOf(file).some((n) => [f.description, bodyFor(f)].join(" ").toLowerCase().includes(n))) score += 3;
      if (f.owner_id && f.owner_id === file.owner_id) score += 1;
      if (score >= 2) out.push({ f, score });
    }
    return out.sort((a, b) => b.score - a.score || ms(b.f.updated_at) - ms(a.f.updated_at)).slice(0, max).map((r) => r.f);
  }
  function lookAlikes(files, max = 3) {
    const kind = (f) => String(f.path || "").split("/")[0];
    const named = files.filter((f) => String(f.path || "").includes("/"));
    const plain = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const out = [];
    for (let i = 0; i < named.length && out.length < max; i++) for (let j = i + 1; j < named.length && out.length < max; j++) {
      const a = named[i], b = named[j];
      if (a.scope !== b.scope || (a.owner_id || "") !== (b.owner_id || "") || kind(a) !== kind(b)) continue;
      const an = plain(String(a.path).split("/").pop()), bn = plain(String(b.path).split("/").pop());
      const aNames = new Set([an, plain(a.name), ...(a.aliases || []).map(plain)].filter(Boolean));
      const bNames = new Set([bn, plain(b.name), ...(b.aliases || []).map(plain)].filter(Boolean));
      if ([...aNames].some((x) => bNames.has(x)) || (an.length >= 4 && bn.length >= 4 && dist(an, bn, 1) <= 1) || (an.length >= 3 && bn.length >= 3 && (bn.split(" ")[0] === an || an.split(" ")[0] === bn))) out.push([a, b]);
    }
    return out;
  }
  // The "Changed" filter (the listing's times are seconds: made milliseconds first)
  function changedWithin(updatedAt, range, now = Date.now()) {
    const at = ms(updatedAt);
    if (!range || range === "any") return true;
    if (range === "today") { const m = new Date(now); m.setHours(0, 0, 0, 0); return at >= m.getTime(); }
    if (range === "week") return at >= now - 7 * 864e5;
    if (range === "month") return at >= now - 30 * 864e5;
    if (range === "old") return at < now - 182 * 864e5;
    return true;
  }
  // Pinned files and recently opened ones: this phone's (the same list as Nova Desk's Index in this browser)
  const shelf = (() => {
    let data = { pins: [], recent: [] };
    try { const saved = JSON.parse(store.getItem("nova-index-shelf") || "null"); if (saved && Array.isArray(saved.pins) && Array.isArray(saved.recent)) data = saved; } catch (e) { /* (a fresh shelf) */ }
    const save = () => { try { store.setItem("nova-index-shelf", JSON.stringify(data)); } catch (e) { /* (kept for this visit) */ } };
    return {
      pins: () => data.pins.slice(),
      isPinned: (k) => data.pins.includes(k),
      toggle(k) { data.pins = data.pins.includes(k) ? data.pins.filter((p) => p !== k) : [k, ...data.pins].slice(0, 24); save(); return data.pins.includes(k); },
      touch(k, now = Date.now()) { const had = data.recent.find((r) => r.k === k); data.recent = [{ k, at: now, n: (had ? had.n : 0) + 1 }, ...data.recent.filter((r) => r.k !== k)].slice(0, 30); save(); },
      top: (max = 6, now = Date.now()) => data.recent.map((r) => ({ k: r.k, score: r.n / (1 + (now - r.at) / (7 * 864e5)) + (now - r.at < 3.6e6 ? 1 : 0) })).sort((a, b) => b.score - a.score).slice(0, max).map((r) => r.k),
    };
  })();
  const hintsOff = () => { try { return new Set(JSON.parse(store.getItem("nova-index-hints-off") || "[]")); } catch (e) { return new Set(); } };
  const putHintAway = (id) => { const off = hintsOff(); off.add(id); try { store.setItem("nova-index-hints-off", JSON.stringify([...off].slice(-50))); } catch (e) { /* (for this visit) */ } };

  // ---- What Index knows (kept while Nova Phone is open) ----
  const state = {
    files: [], stats: null, pending: [], locked: false, admin: false, loadedAt: 0,
    bodies: new Map(), drafts: new Map(), searchHits: null,
    scope: "all", query: "", kind: "any", when: "any", pinnedOnly: false, ask: null,
    known: null, changes: new Map(), startFacts: null, lastCheck: 0,
  };
  const bodyFor = (f) => (state.bodies.get(keyOf(f)) || {}).body || "";
  const fileFor = (key) => state.files.find((x) => keyOf(x) === key);
  async function loadIndex() {
    const r = await get("/index");
    const files = Array.isArray(r.files) ? r.files : [];
    files.sort((a, b) => ms(b.updated_at) - ms(a.updated_at));
    noticeChanges(files);
    for (const f of files) { const k = keyOf(f), had = state.bodies.get(k); if (had && had.version !== f.version && !state.drafts.has(k)) state.bodies.delete(k); }
    state.files = files;
    state.admin = state.admin || r.admin === true;
    state.lastCheck = Date.now();
  }
  async function loadStats() {
    state.stats = await get("/stats");
    state.admin = state.stats.admin === true;
    if (state.stats.locked) state.locked = true;
    N.badge("index", state.admin ? Number(state.stats.pending) || 0 : 0);
  }
  async function loadAll(force) {
    if (!force && state.loadedAt && Date.now() - state.loadedAt < 15000) return;
    await Promise.all([loadIndex(), loadStats()]);
    state.loadedAt = Date.now();
  }
  // Which files changed since Index was first opened (for Live's "learned 2 facts")
  function noticeChanges(files) {
    const total = files.reduce((n, f) => n + (f.facts || 0), 0);
    if (!state.known) { state.known = new Map(files.map((f) => [f.id, { version: f.version, facts: f.facts || 0 }])); state.startFacts = total; return; }
    for (const f of files) {
      const was = state.known.get(f.id);
      if (!was || was.version !== f.version) { state.changes.set(f.id, { delta: (f.facts || 0) - (was ? was.facts : 0), isNew: !was, at: Date.now() }); state.known.set(f.id, { version: f.version, facts: f.facts || 0 }); }
    }
  }
  const tabs = (on) => `<div class="seg memory-tabs" role="tablist">${[["browse", "Browse", "#index"], ["live", "Live", "#index/live"], ["approve", "Approve", "#index/approve"]].map(([t, l, h]) => `<a role="tab" class="seg-a" href="${h}" aria-selected="${t === on}"><span>${l}${t === "approve" && !state.locked && Number(state.stats?.pending) ? ` <span class="memory-n">${Number(state.stats.pending) > 99 ? "99+" : Number(state.stats.pending)}</span>` : ""}</span></a>`).join("")}</div>`;

  let liveTimer = 0;
  N.section({
    id: "index", name: "Index", tile: "index",
    async draw(box, [part, a, b, ...more], ui) {
      await N.css("memory.css");
      clearInterval(liveTimer);
      // Opened from someone's Portal profile ("Open my Index"): #index/scope/staff/eric
      if (part === "scope") { if (SCOPES.includes(a)) state.scope = a; state.query = b || ""; state.ask = null; location.replace("#index"); return; }
      if (part === "file") {
        // #index/file/<memory>/<owner>/<path, slashes and all>, or a file's key as JSON ([memory, owner, path]),
        // encoded twice or once (then the address arrives cut at its slashes: put back together first)
        const rest = [a, b, ...more].filter((x) => x !== undefined).join("/");
        if (/^(\[|%5B)/i.test(rest)) {
          let k = null;
          try { k = JSON.parse(/^%5B/i.test(rest) ? decodeURIComponent(rest) : rest); } catch (e) { /* (not a key) */ }
          return Array.isArray(k) ? drawFile(box, k[0], k[1] || "", String(k[2] || ""), ui) : drawFile(box, "", "", "", ui);
        }
        return drawFile(box, a, b, more.join("/"), ui);
      }
      if (part === "approve") return drawApprove(box, ui);
      if (part === "new") return drawNew(box, ui);
      if (part === "live") return drawLive(box, ui);
      if (part === "tidy") return drawTidy(box, ui);
      return drawBrowse(box, ui);
    },
  });

  // ===== Browse =====
  const filtering = () => state.kind !== "any" || state.when !== "any" || state.pinnedOnly;
  const kindOf = (f) => String(f.path || "").split("/")[0];
  function matches(f, q) {
    if (!q) return true;
    const hits = state.searchHits && state.searchHits.q === q ? (state.searchHits.map.get(keyOf(f)) || []).join("\n") : "";
    return fuzzyHas([f.name, f.path, f.description, aliasText(f.aliases), f.owner_id, ownerLabel(f.scope, f.owner_id), f.source_app, bodyFor(f), hits].join("\n").toLowerCase(), q);
  }
  function factHit(f, q) {
    if (!q) return null;
    const hits = state.searchHits && state.searchHits.q === q ? state.searchHits.map.get(keyOf(f)) : null;
    const body = bodyFor(f) || (hits ? hits.join("\n") : "");
    return body ? parseBody(body).find((l) => lineHit(l.fact, q)) || null : null;
  }
  const passes = (f) => (state.kind === "any" || kindOf(f) === state.kind) && changedWithin(f.updated_at, state.when) && (!state.pinnedOnly || shelf.isPinned(keyOf(f)));
  async function drawBrowse(box, ui) {
    await loadAll();
    ui.action({ icon: "plus", label: "New file", href: "#index/new" });
    const s = state.stats || {};
    const strip = SCOPES.map((sc) => {
      const listed = state.files.filter((f) => f.scope === sc);
      const row = (s.scopes || []).find((x) => x.scope === sc) || {};
      const files = state.files.length ? listed.length : row.files || 0, facts = state.files.length ? listed.reduce((n, f) => n + (f.facts || 0), 0) : row.facts || 0;
      return `<button type="button" class="sum memory-sum" data-scope="${sc}" aria-pressed="${state.scope === sc}" aria-label="${SCOPE_NAMES[sc]}: ${plural(files, "file")}, ${plural(facts, "fact")}. Show only these."><span class="memory-sum-top"><b>${files}</b> <span class="memory-sum-name">${SCOPE_NAMES[sc]}</span></span><span>${plural(facts, "fact")}</span></button>`;
    }).join("");
    const waiting = state.locked ? 0 : Number(s.pending) || 0;
    box.innerHTML = `${tabs("browse")}
      <div class="sums memory-sums">${strip}<a class="sum memory-sum${waiting ? " has" : ""}" href="#index/approve" aria-label="${plural(waiting, "fact")} waiting to approve"><span class="memory-sum-top"><b>${state.locked ? "–" : waiting}</b> <span class="memory-sum-name">Waiting</span></span><span>to approve</span></a></div>
      <form class="memory-search" data-search role="search"><label class="field"><span class="sr">Search, or ask a question</span><input class="input" type="search" name="q" value="${esc(state.query)}" placeholder="Search, or ask a question" autocomplete="off" enterkeyhint="search"></label></form>
      <div class="chips memory-filters">${state.scope !== "all" ? `<button type="button" class="chip" data-all aria-pressed="true">${esc(SCOPE_NAMES[state.scope])} only · Show all</button>` : ""}<button type="button" class="chip" data-filters aria-pressed="${state.kind !== "any" || state.when !== "any"}">${icon("cog")} Filters${state.kind !== "any" || state.when !== "any" ? ` · ${[state.kind !== "any" ? KIND_FILTER.find(([k]) => k === state.kind)[1] : "", state.when !== "any" ? WHEN_FILTER.find(([k]) => k === state.when)[1] : ""].filter(Boolean).join(", ")}` : ""}</button><button type="button" class="chip" data-pinned aria-pressed="${state.pinnedOnly}">★ Pinned</button>${filtering() ? `<button type="button" class="chip" data-clear>Clear filters</button>` : ""}</div>
      <div class="memory-body" data-body></div>
      ${state.admin ? `<a class="btn wide quiet" href="#index/tidy">${icon("refresh")} Tidy up Index</a>` : ""}`;
    const input = box.querySelector("[name=q]");
    let timer = 0;
    input.addEventListener("input", () => {
      state.query = input.value;
      if (state.ask && state.ask.q !== state.query.trim()) state.ask = null;
      clearTimeout(timer);
      timer = setTimeout(() => { renderBody(box); if (state.query.trim().length >= 2) loadHits(box); }, 120);
    });
    box.querySelector("[data-search]").addEventListener("submit", (e) => {
      e.preventDefault();
      state.query = input.value;
      if (looksLikeQuestion(state.query)) askIndex(box);
      else input.blur();
    });
    box.querySelectorAll("[data-scope]").forEach((x) => x.addEventListener("click", () => { state.scope = state.scope === x.dataset.scope ? "all" : x.dataset.scope; N.show(); }));
    box.querySelector("[data-all]")?.addEventListener("click", () => { state.scope = "all"; N.show(); });
    box.querySelector("[data-pinned]").addEventListener("click", () => { state.pinnedOnly = !state.pinnedOnly; N.show(); });
    box.querySelector("[data-clear]")?.addEventListener("click", clearFilters);
    box.querySelector("[data-filters]").addEventListener("click", openFilters);
    renderBody(box);
    if (state.query.trim().length >= 2 && !(state.searchHits && state.searchHits.q === state.query.trim().toLowerCase())) loadHits(box);
  }
  const clearFilters = () => { state.kind = "any"; state.when = "any"; state.pinnedOnly = false; N.show(); };
  async function openFilters() {
    const v = await N.form(`<h2 class="sheet-title">Filters</h2><form class="form" data-f>${field({ label: "Kind of file", name: "kind", type: "select", value: state.kind, options: KIND_FILTER })}${field({ label: "When it last changed", name: "when", type: "select", value: state.when, options: WHEN_FILTER })}${N.toggle({ label: "Pinned files only", name: "pinned", checked: state.pinnedOnly })}<div class="btns"><button class="btn main wide" type="submit">Show them</button><button type="button" class="btn wide" data-clear>Clear filters</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
      (el, done) => { el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); const x = ev.target.elements; done({ kind: x.kind.value, when: x.when.value, pinnedOnly: x.pinned.checked }); }; el.querySelector("[data-clear]").onclick = () => done({ kind: "any", when: "any", pinnedOnly: false }); el.querySelector("[data-no]").onclick = () => done(null); });
    if (!v) return;
    Object.assign(state, v);
    N.show();
  }
  // Searching also looks inside the facts: the server searches every file and says which lines matched
  let searchSeq = 0;
  async function loadHits(box) {
    const q = state.query.trim().toLowerCase(), mine = ++searchSeq;
    try {
      const r = await get(`/index?q=${encodeURIComponent(q)}`);
      if (mine !== searchSeq) return;
      const map = new Map();
      for (const f of r.files || []) map.set(keyOf(f), f.matches && f.matches.length ? f.matches : [""]);
      state.searchHits = { q, map };
      if (state.query.trim().toLowerCase() === q && box.isConnected) renderBody(box);
    } catch (e) { /* (the names and lines already here still match) */ }
  }
  // Everything under the search box: the count, Ask Index, the shelf, hints and the files (drawn again as you type)
  function renderBody(box) {
    const body = box.querySelector("[data-body]");
    if (!body) return;
    const q = state.query.trim().toLowerCase();
    const inScope = state.files.filter((f) => state.scope === "all" || f.scope === state.scope);
    const shown = inScope.filter((f) => passes(f) && matches(f, q));
    let html = q || filtering() ? `<p class="muted small memory-count" role="status">${shown.length} of ${plural(inScope.length, "file")}</p>` : "";
    html += askHtml(q);
    if (!q && !filtering()) html += shelfHtml() + hintsHtml(inScope);
    if (!shown.length) {
      if (!state.files.length) html += empty({ icon: "book", title: "Memory is empty", text: "As Nova Agent and Nova Bot talk to people, the facts worth keeping land here. You can add one yourself too.", action: `<a class="btn main" href="#index/new">${icon("plus")} New file</a>` });
      else if (q && (state.ask || looksLikeQuestion(q))) { /* (a question: Ask Index above is the answer) */ }
      else if (q) {
        const better = suggest(q, vocabulary(state.files));
        html += empty({ icon: "search", title: "Nothing matches", text: `No file mentions “${state.query.trim()}”${state.scope === "all" ? "" : ` in ${SCOPE_NAMES[state.scope]}`}${filtering() ? " with these filters" : ""}.`, action: `${better ? `<button type="button" class="btn" data-mean="${esc(better)}">Did you mean “${esc(better)}”?</button>` : ""}${filtering() ? `<button type="button" class="btn quiet" data-clear2>Clear filters</button>` : ""}` });
      } else if (filtering()) html += empty({ icon: "search", title: "Nothing with these filters", text: "Try another kind or time, or clear them.", action: `<button type="button" class="btn" data-clear2>Clear filters</button>` });
      else html += empty({ icon: "book", title: "Nothing here yet", text: `No ${SCOPE_NAMES[state.scope].toLowerCase()} files yet.` });
    } else {
      for (const sc of SCOPES) {
        const fs = shown.filter((f) => f.scope === sc);
        if (!fs.length) continue;
        html += `<section class="memory-group"><h3 class="h memory-group-head"><span>${SCOPE_NAMES[sc]}</span><span>${plural(fs.length, "file")}</span></h3>`;
        if (sc === "studio") html += N.list(fs.map((f) => fileRow(f, q)));
        else {
          const owners = [];
          for (const f of fs) if (!owners.includes(f.owner_id)) owners.push(f.owner_id);
          for (const o of owners) html += `<p class="memory-owner"><span>${sc === "staff" ? "Staff member" : o && String(o).startsWith("chat:") ? "Not yet known" : "Client"}</span> ${esc(ownerLabel(sc, o))}</p>${N.list(fs.filter((f) => f.owner_id === o).map((f) => fileRow(f, q)))}`;
        }
        html += `</section>`;
      }
    }
    body.innerHTML = html;
    body.querySelectorAll("[data-mean]").forEach((x) => x.addEventListener("click", () => searchFor(box, x.dataset.mean)));
    body.querySelectorAll("[data-clear2]").forEach((x) => x.addEventListener("click", clearFilters));
    body.querySelector("[data-ask-go]")?.addEventListener("click", () => askIndex(box));
    body.querySelector("[data-ask-again]")?.addEventListener("click", () => askIndex(box));
    body.querySelector("[data-ask-close]")?.addEventListener("click", () => { state.ask = null; renderBody(box); });
    body.querySelectorAll("[data-hint-off]").forEach((x) => x.addEventListener("click", () => { putHintAway(x.dataset.hintOff); renderBody(box); }));
    body.querySelector("[data-old]")?.addEventListener("click", () => { state.when = "old"; N.show(); });
  }
  function searchFor(box, text) {
    const input = box.querySelector("[name=q]");
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function fileRow(f, q) {
    const hit = factHit(f, q);
    const k = keyOf(f), d = state.drafts.get(k);
    const meta = [plural(f.facts || 0, "fact"), f.aliases && f.aliases.length ? `aka ${aliasText(f.aliases)}` : "", `${f.source_app || "Someone"} · updated ${rel(f.updated_at)}`].filter(Boolean).map(esc).join(" · ");
    return `<li><a class="row memory-file" href="${hrefOf(f)}"><span class="row-lead">${shelf.isPinned(k) ? `<span class="memory-star" aria-label="Pinned">★</span>` : window.NovaTile ? window.NovaTile("index") : icon("book")}</span><span class="row-main"><small class="memory-path">${esc(f.path)}</small><b>${lit(titleOf(f), q)}</b>${f.description ? `<span>${lit(f.description, q)}</span>` : ""}${hit ? `<span class="memory-hit">${pill(hit.tag)} ${lit(hit.fact, q)}</span>` : ""}<span class="memory-meta">${meta}${d && dirty(d) ? ` · <b class="memory-unsaved">Unsaved edits</b>` : ""}</span></span><span class="row-end">${icon("next")}</span></a></li>`;
  }
  function shelfHtml() {
    const pins = shelf.pins().map(fileFor).filter(Boolean);
    const recent = shelf.top(8).filter((k) => !shelf.isPinned(k)).map(fileFor).filter(Boolean).slice(0, 6);
    if (!pins.length && !recent.length) return "";
    const chip = (f) => `<a class="chip memory-chip" href="${hrefOf(f)}"><span>${esc(titleOf(f))}</span>${(f.owner_id ? ownerLabel(f.scope, f.owner_id) : f.path) !== titleOf(f) ? `<small>${esc(f.owner_id ? ownerLabel(f.scope, f.owner_id) : f.path)}</small>` : ""}</a>`;
    return `<nav class="memory-shelf" aria-label="Pinned and recent files">${pins.length ? `<p class="kicker">★ Pinned</p><div class="chips">${pins.map(chip).join("")}</div>` : ""}${recent.length ? `<p class="kicker">Recent</p><div class="chips">${recent.map(chip).join("")}</div>` : ""}</nav>`;
  }
  function hintsHtml(visible) {
    const off = hintsOff(), items = [];
    const chip = (f) => `<a class="chip memory-chip" href="${hrefOf(f)}"><span>${esc(titleOf(f))}</span><small>${esc(f.path)}</small></a>`;
    for (const [a, b] of lookAlikes(visible)) {
      const id = [keyOf(a), keyOf(b)].sort().join("|");
      if (off.has(id)) continue;
      items.push(`<div class="card memory-hint"><p>These might be the same:</p><div class="chips">${chip(a)}${chip(b)}</div><button type="button" class="btn quiet" data-hint-off="${esc(id)}">Not the same: hide this</button></div>`);
      if (items.length >= 2) break;
    }
    const old = visible.filter((f) => changedWithin(f.updated_at, "old")).length;
    if (old && !off.has(`old:${old}`)) items.push(`<div class="card memory-hint"><p>${plural(old, "file")} ${old === 1 ? "hasn't" : "haven't"} changed in 6 months.</p><div class="btns two"><button type="button" class="btn" data-old>Show them</button><button type="button" class="btn quiet" data-hint-off="old:${old}">Hide this hint</button></div></div>`);
    return items.join("");
  }

  // ----- Ask Index: answered only from memory, with the facts it came from -----
  async function askIndex(box) {
    const q = state.query.trim();
    if (q.length < 3) return;
    state.ask = { q, loading: true };
    renderBody(box);
    try {
      const data = await send("/ask", "POST", { q });
      if (state.ask && state.ask.q === q) state.ask = { q, result: data };
    } catch (err) {
      if (err.signIn) throw err;
      if (state.ask && state.ask.q === q) state.ask = { q, error: err.message };
    }
    if (box.isConnected) renderBody(box);
  }
  const factHref = (f) => hrefOf({ scope: f.scope, owner_id: f.owner_id, path: f.path });
  function askHtml(q) {
    const a = state.ask;
    if (!a) return looksLikeQuestion(q) ? `<div class="card memory-ask"><button type="button" class="btn main wide" data-ask-go>✦ Ask Index</button><p class="muted small">“${esc(state.query.trim())}”: or press Search. It answers only from what's remembered.</p></div>` : "";
    let html = `<section class="card memory-ask" aria-live="polite"><div class="memory-ask-head"><p class="kicker">Ask Index</p><button type="button" class="icon-btn" data-ask-close aria-label="Close the answer">✕</button></div><p class="memory-ask-q">${esc(a.q)}</p>`;
    if (a.loading) html += `<p class="muted">Looking through memory…</p>`;
    else if (a.error) html += `<p class="bad">${esc(a.error)}</p><button type="button" class="btn" data-ask-again>${icon("refresh")} Try again</button>`;
    else if (a.result) {
      const r = a.result, facts = r.facts || [], byN = new Map(facts.map((f) => [f.n, f]));
      if (r.answer) html += `<p class="memory-answer">${String(r.answer).split(/(\[\d+\])/).map((part) => { const n = Number((part.match(/^\[(\d+)\]$/) || [])[1]); const f = n && byN.get(n); return f ? `<a class="memory-ref" href="${factHref(f)}" aria-label="Source ${n}: ${esc(f.name || f.path)} (open it)">${n}</a>` : esc(part); }).join("")}</p>`;
      else html += `<p class="muted">${esc(r.note || "Index doesn't remember anything about that yet.")}</p>`;
      if (facts.length) {
        const used = new Set(r.used || []);
        html += `<p class="kicker memory-from">${r.answer ? "From what Index remembers" : "What Index remembers that matches"}</p><ol class="memory-facts">${[...facts].sort((x, y) => Number(used.has(y.n)) - Number(used.has(x.n)) || x.n - y.n).slice(0, 8).map((f) => `<li class="${used.has(f.n) ? "used" : ""}"><span class="memory-fn">${f.n}</span><span class="memory-ft">${pill(f.tag)} ${esc(f.fact)}</span><a class="chip memory-chip" href="${factHref(f)}">${esc(f.name || f.path)}</a></li>`).join("")}</ol>`;
      }
      html += `<p class="muted small">Answered only from memory. Nothing is sent or saved.</p>`;
    }
    return `${html}</section>`;
  }

  // ===== A file =====
  function newDraft(file) {
    return { file, lines: parseBody(file.body).map((l) => ({ ...l, was: sameLine(l) })), description: file.description || "", aliases: aliasText(file.aliases), conflict: null, error: "", saving: false };
  }
  const dirty = (d) => !!d && (bodyOf(d.lines) !== bodyOf(parseBody(d.file.body)) || d.description.trim() !== (d.file.description || "").trim() || aliasText(aliasList(d.aliases)) !== aliasText(d.file.aliases));
  async function drawFile(box, sc, owner, path, ui) {
    ui.back("#index");
    if (!SCOPES.includes(sc) || !path) { box.innerHTML = empty({ icon: "book", title: "That file isn't there any more", action: `<a class="btn" href="#index">Back to Index</a>` }); return; }
    owner = owner || "";
    const key = keyOf({ scope: sc, owner_id: owner, path });
    if (!state.files.length) await loadAll().catch((err) => { if (err.signIn) throw err; });
    let d = state.drafts.get(key);
    if (!d) {
      let file = null;
      try { file = (await get(`/file?${fileQuery({ scope: sc, owner_id: owner, path })}`)).file; } catch (err) { if (err.signIn) throw err; if (err.status !== 404) throw err; }
      if (!file) { box.innerHTML = empty({ icon: "book", title: "That file isn't there any more", action: `<a class="btn" href="#index">Back to Index</a>` }); return; }
      state.bodies.set(key, file);
      d = newDraft(file);
      state.drafts.set(key, d);
    }
    shelf.touch(key);
    ui.title(titleOf(d.file));
    const listed = fileFor(key);
    const editable = (listed ? listed.editable : d.file.editable) !== false;
    const render = (focus) => {
      const f = d.file, isDirty = dirty(d), pinned = shelf.isPinned(key);
      const rel2 = related(f);
      const head = `<div class="card memory-head"><p class="kicker">${esc(where(f))}</p><h2 class="card-title">${esc(titleOf(f))}</h2>${f.description ? `<p class="muted">${esc(f.description)}</p>` : ""}<p class="muted small">Last written by ${esc(f.source_app || "someone")} · ${esc(rel(f.updated_at))}</p><button type="button" class="chip" data-pin aria-pressed="${pinned}">${pinned ? "★ Pinned" : "☆ Pin"}</button></div>`;
      const foot = `${rel2.length ? `<div class="memory-related"><p class="kicker">Related</p><div class="chips">${rel2.map((r) => `<a class="chip memory-chip" href="${hrefOf(r)}"><span>${esc(titleOf(r))}</span>${r.owner_id ? `<small>${esc(ownerLabel(r.scope, r.owner_id))}</small>` : ""}</a>`).join("")}</div></div>` : ""}`;
      const legend = `<p class="muted small memory-tag-help">${TAGS.map((t) => `${pill(t)} ${esc(TAG_HELP[t])}`).join(" · ")}</p>`;
      if (!editable) {
        box.innerHTML = `${head}${d.lines.length ? N.list(d.lines.map((l) => `<li><div class="row memory-fact">${pill(l.tag)}<span>${esc(l.fact)}</span></div></li>`)) : empty({ icon: "book", title: "No facts yet" })}<p class="card muted small">${f.scope === "studio" ? "Studio-wide memory: only an admin can change it." : "Only its owner or an admin can change this."}</p>${legend}${foot}`;
        wirePin();
        return;
      }
      box.innerHTML = `${head}${d.conflict ? conflictHtml(d) : ""}${d.error ? `<p class="card bad">${esc(d.error)}</p>` : ""}
        ${d.lines.length ? N.list(d.lines.map((l, i) => { const ch = l.was === undefined ? "added" : l.was !== sameLine(l) ? "changed" : ""; return `<li><button type="button" class="row memory-fact${ch ? ` ${ch}` : ""}" data-fact="${i}">${pill(l.tag)}<span>${esc(l.fact)}${ch ? ` <span class="pill ok">${ch}</span>` : ""}</span>${icon("edit")}</button></li>`; })) : `<p class="muted memory-none">No facts yet. Add the first one below.</p>`}
        <form class="card form" data-add>${field({ label: "Add a fact", name: "fact", placeholder: "e.g. prefers evening sessions", attrs: 'maxlength="240" autocomplete="off" enterkeyhint="done"' })}${tagChoices("tag", "stated")}<button class="btn wide" type="submit">${icon("plus")} Add</button></form>
        <form class="card form" data-meta>${field({ label: "What's in it (the index line)", name: "description", value: d.description, attrs: 'maxlength="200" autocomplete="off"' })}${field({ label: "Also known as", name: "aliases", value: d.aliases, placeholder: "Other names, with commas", attrs: 'autocomplete="off"' })}</form>
        <div class="memory-save" data-save-box${isDirty ? "" : " hidden"}><p class="memory-unsaved" role="status">Unsaved changes</p><div class="btns two"><button type="button" class="btn main" data-save${d.saving ? " disabled" : ""}>${icon("check")} ${d.saving ? "Saving…" : "Save"}</button><button type="button" class="btn" data-discard>Discard changes</button></div></div>
        <p class="muted small" data-clean${isDirty ? " hidden" : ""}>Changes here are kept only when you press Save.</p>
        <button type="button" class="btn danger wide" data-delete>${icon("trash")} Delete file</button>${foot}`;
      wirePin();
      box.querySelectorAll("[data-fact]").forEach((x) => x.addEventListener("click", () => editFact(Number(x.dataset.fact))));
      const add = box.querySelector("[data-add]");
      add.addEventListener("submit", (e) => {
        e.preventDefault();
        const fact = add.elements.fact.value.trim();
        if (!fact) return add.elements.fact.focus();
        d.lines.push({ tag: radio(add, "tag") || "stated", fact });
        render("[data-add] [name=fact]");
      });
      const meta = box.querySelector("[data-meta]");
      meta.addEventListener("submit", (e) => e.preventDefault());
      meta.addEventListener("input", () => { d.description = meta.elements.description.value; d.aliases = meta.elements.aliases.value; showSave(); });
      box.querySelector("[data-save]").addEventListener("click", save);
      box.querySelector("[data-discard]").addEventListener("click", () => { d = newDraft(d.file); state.drafts.set(key, d); render(); });
      box.querySelector("[data-delete]").addEventListener("click", del);
      box.querySelector("[data-reapply]")?.addEventListener("click", reapply);
      box.querySelector("[data-theirs]")?.addEventListener("click", () => { state.bodies.set(key, d.conflict); d = newDraft(d.conflict); state.drafts.set(key, d); state.loadedAt = 0; render(); });
      if (focus) box.querySelector(focus)?.focus();
    };
    const wirePin = () => box.querySelector("[data-pin]").addEventListener("click", () => { toast(shelf.toggle(key) ? "Pinned: it stays at the top of Browse." : "Unpinned."); render(); });
    // Typing in the line or its names: Save shows without drawing again (so the keyboard stays put)
    const showSave = () => { const on = dirty(d); box.querySelector("[data-save-box]").hidden = !on; box.querySelector("[data-clean]").hidden = on; };
    async function editFact(i) {
      const l = d.lines[i];
      const v = await N.form(`<h2 class="sheet-title">Change the fact</h2><form class="form" data-f>${field({ label: "The fact", name: "fact", value: l.fact, attrs: 'maxlength="240" autocomplete="off"' })}${tagChoices("tag", l.tag)}<div class="btns"><button class="btn main wide" type="submit" value="done">${icon("check")} Done</button><button class="btn danger wide" type="submit" value="remove">Remove this fact</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div><p class="muted small">Nothing is kept until you press Save.</p></form>`,
        (el, done) => { const f = el.querySelector("[data-f]"); f.onsubmit = (ev) => { ev.preventDefault(); done({ how: ev.submitter?.value || "done", fact: f.elements.fact.value.trim(), tag: radio(f, "tag") || l.tag }); }; el.querySelector("[data-no]").onclick = () => done(null); });
      if (!v) return;
      if (v.how === "remove" || !v.fact) d.lines.splice(i, 1);
      else d.lines[i] = { ...l, tag: v.tag, fact: v.fact };
      render();
    }
    async function save() {
      if (d.saving) return;
      const f = d.file, sent = d.lines.filter((l) => l.fact.trim()).length;
      d.saving = true; d.error = ""; render();
      try {
        const r = await send("/file", "PUT", { scope: f.scope, owner_id: f.scope === "studio" ? null : f.owner_id, path: f.path, name: f.name, description: d.description.trim(), aliases: aliasList(d.aliases), body: bodyOf(d.lines), if_version: f.version });
        const kept = parseBody(r.file.body).length;
        state.bodies.set(key, r.file);
        d = newDraft(r.file);
        state.drafts.set(key, d);
        if (state.known) state.known.set(r.file.id, { version: r.file.version, facts: r.file.facts || kept });
        // (the server says which lines it left out and why: junk, repeats, card or bank numbers)
        if (kept < sent || r.dropped) toast(r.note ? `Saved. ${r.note}` : `Saved. ${plural(Math.max(sent - kept, Number(r.dropped) || 0), "line")} wasn't kept: memory never stores junk, repeats, or card, bank or ID numbers.`, true);
        else toast("Saved");
        state.loadedAt = 0;
        loadAll(true).catch(() => {});
      } catch (err) {
        if (err.signIn) throw err;
        d.saving = false;
        if (err.status === 409 && err.data && err.data.current) d.conflict = err.data.current;
        else if (err.status === 409) d.error = "This file was deleted by someone else. Copy anything you need, then go back.";
        else d.error = err.message || "That didn't save. Try again.";
      }
      render();
    }
    // My changes (added, removed or reworded since opening) put onto their latest version, then saved
    function reapply() {
      const theirs = d.conflict, base = parseBody(d.file.body), baseSet = new Set(base.map(sameLine));
      const mine = d.lines.filter((l) => l.fact.trim()), mineSet = new Set(mine.map(sameLine));
      const gone = new Set(base.filter((l) => !mineSet.has(sameLine(l))).map(sameLine));
      const merged = parseBody(theirs.body).filter((l) => !gone.has(sameLine(l)));
      const have = new Set(merged.map(sameLine));
      for (const l of mine.filter((x) => !baseSet.has(sameLine(x)))) if (!have.has(sameLine(l))) merged.push(l);
      const theirSet = new Set(parseBody(theirs.body).map(sameLine));
      const next = newDraft(theirs);
      next.lines = merged.map((l) => ({ tag: l.tag, fact: l.fact, was: theirSet.has(sameLine(l)) ? sameLine(l) : undefined }));
      next.description = d.description.trim() !== (d.file.description || "").trim() ? d.description : theirs.description || "";
      next.aliases = aliasText(aliasList(d.aliases)) !== aliasText(d.file.aliases) ? d.aliases : aliasText(theirs.aliases);
      d = next;
      state.drafts.set(key, d);
      state.bodies.set(key, theirs);
      save();
    }
    async function del() {
      const f = d.file, who = ownerLabel(f.scope, f.owner_id);
      if (!(await N.confirm({ title: `Delete ${f.path}${who ? ` for ${who}` : ""} and its ${plural(parseBody(f.body).length, "fact")}?`, text: "An admin can put it back from the bin for 30 days.", ok: "Delete file", danger: true }))) return;
      try {
        await send(`/file?${fileQuery(f)}`, "DELETE");
        state.drafts.delete(key); state.bodies.delete(key); state.loadedAt = 0;
        toast(`Deleted ${f.path}`);
        location.hash = "#index";
      } catch (err) { if (err.signIn) throw err; d.error = err.message; render(); }
    }
    render();
  }
  // "Changed since you opened it": theirs and yours side by side
  function conflictHtml(d) {
    const theirs = d.conflict, base = parseBody(d.file.body), baseSet = new Set(base.map(sameLine));
    const mine = d.lines.filter((l) => l.fact.trim()), mineSet = new Set(mine.map(sameLine));
    const li = (l, cls) => `<li class="${cls}">${pill(l.tag)} ${esc(l.fact)}</li>`;
    const theirLines = parseBody(theirs.body).map((l) => li(l, baseSet.has(sameLine(l)) ? "" : "new-line")).join("") || `<li>(no facts)</li>`;
    const yours = [...mine.map((l) => li(l, baseSet.has(sameLine(l)) ? "" : "new-line")), ...base.filter((l) => !mineSet.has(sameLine(l))).map((l) => li(l, "gone-line"))].join("") || `<li>(no facts)</li>`;
    return `<section class="card memory-conflict"><p class="kicker">This file changed since you opened it</p><p>${esc(theirs.source_app || "Someone")} saved it ${esc(rel(theirs.updated_at))}. Nothing of yours is lost: put your edit on top of their version in one tap.</p><p class="memory-side">Now (theirs)</p><ul class="memory-lines">${theirLines}</ul><p class="memory-side">Your edit</p><ul class="memory-lines">${yours}</ul><div class="btns"><button type="button" class="btn main wide" data-reapply>Use the latest and re-apply my edit</button><button type="button" class="btn wide" data-theirs>Keep theirs, drop mine</button></div></section>`;
  }

  // ===== A new file =====
  let me = null;
  async function drawNew(box, ui) {
    ui.back("#index");
    ui.title("New file");
    if (!state.files.length) await loadAll().catch((err) => { if (err.signIn) throw err; });
    me ||= await N.api("/auth/me").then((r) => r.staff || null).catch(() => null);
    const v = { scope: "studio", kind: "studio", owner: "", name: "", description: "", fact: "", tag: "stated" };
    const render = () => {
      if (!KINDS[v.scope].includes(v.kind)) v.kind = KINDS[v.scope][0];
      const owners = [...new Set(state.files.filter((f) => f.scope === v.scope && f.owner_id).map((f) => f.owner_id))];
      box.innerHTML = `<form class="form" data-new novalidate>
        <fieldset class="field"><legend>Memory</legend><div class="seg">${[["studio", "Studio"], ["staff", "Staff"], ["customer", "Customer"]].map(([s, l]) => `<label><input type="radio" name="scope" value="${s}"${s === v.scope ? " checked" : ""}>${l}</label>`).join("")}</div></fieldset>
        ${v.scope === "studio" ? "" : field({ label: v.scope === "staff" ? "Which staff member" : "Which client (their email)", name: "owner", value: v.owner, placeholder: v.scope === "staff" ? "e.g. eric" : "e.g. kai@example.com", attrs: `list="memory-owners" autocomplete="off" autocapitalize="off" spellcheck="false"${v.scope === "customer" ? ' inputmode="email"' : ""}` })}<datalist id="memory-owners">${owners.map((o) => `<option value="${esc(o)}"></option>`).join("")}</datalist>
        ${field({ label: "Kind", name: "kind", type: "select", value: v.kind, options: KINDS[v.scope].map((k) => [k, NAMED.includes(k) ? `${k}/…` : k]), hint: KIND_HELP[v.kind] })}
        ${NAMED.includes(v.kind) ? field({ label: "Name", name: "name", value: v.name, placeholder: { people: "e.g. Kai", topics: "e.g. pricing", areas: "e.g. ep-release" }[v.kind], attrs: 'autocomplete="off"' }) : ""}
        ${field({ label: "What's in it (one line)", name: "description", value: v.description, placeholder: "e.g. Kai: producer, books evening sessions", attrs: 'maxlength="200" autocomplete="off"' })}
        ${field({ label: "First fact", name: "fact", value: v.fact, placeholder: "e.g. prefers evening sessions", attrs: 'maxlength="240" autocomplete="off"' })}
        ${tagChoices("tag", v.tag)}
        <p class="form-said" data-said role="alert"></p>
        <button class="btn main wide" type="submit">${icon("check")} Create file</button></form>`;
      const f = box.querySelector("[data-new]");
      const keep = () => { const x = f.elements; v.scope = radio(f, "scope") || v.scope; v.kind = x.kind.value; v.owner = x.owner ? x.owner.value : v.owner; v.name = x.name ? x.name.value : v.name; v.description = x.description.value; v.fact = x.fact.value; v.tag = radio(f, "tag") || v.tag; };
      f.querySelectorAll("[name=scope]").forEach((r) => r.addEventListener("change", () => { keep(); if (v.scope === "staff" && !v.owner && me) v.owner = String(me.id || "").toLowerCase(); render(); }));
      f.elements.kind.addEventListener("change", () => { keep(); render(); });
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        keep();
        const said = box.querySelector("[data-said]");
        const bad = (t, el) => { said.textContent = t; said.classList.add("bad"); el?.focus(); };
        const owner = v.owner.trim().toLowerCase(), name = v.name.trim(), fact = v.fact.trim();
        if (v.scope !== "studio" && !owner) return bad(v.scope === "staff" ? "Which staff member is it for?" : "Which client is it for? Their email works best.", f.elements.owner);
        if (NAMED.includes(v.kind) && !name) return bad("Give it a name, like Kai or pricing.", f.elements.name);
        // (an empty file is junk, which Tidy up would remove, so a new file starts with a fact)
        if (!fact) return bad("Add its first fact, so the file isn't empty.", f.elements.fact);
        const slug = name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
        const path = NAMED.includes(v.kind) ? `${v.kind}/${slug}` : v.kind;
        await N.busy(f.querySelector("[type=submit]"), "Creating…", async () => {
          try {
            const r = await send("/file", "PUT", { scope: v.scope, owner_id: v.scope === "studio" ? null : owner, path, name: NAMED.includes(v.kind) ? name : "", description: v.description.trim(), aliases: [], body: `- [${v.tag}] ${fact}`, if_version: "new" });
            if (state.known) state.known.set(r.file.id, { version: r.file.version, facts: r.file.facts || 1 });
            state.bodies.set(keyOf(r.file), r.file);
            state.loadedAt = 0;
            toast(`Created ${r.file.path}`);
            location.hash = hrefOf(r.file);
          } catch (err) {
            if (err.signIn) throw err;
            // It's already there: open that one instead
            if (err.status === 409 && err.data && err.data.current) { state.loadedAt = 0; toast("That file already exists, so it's open for you."); location.hash = hrefOf(err.data.current); return; }
            bad(err.message || "That didn't work. Try again.");
          }
        });
      });
    };
    render();
  }

  // ===== Live: memory as it grows =====
  async function drawLive(box, ui) {
    await loadAll(true);
    const sourceTile = (app) => { const a = String(app || "").toLowerCase(); return a.includes("agent") ? "chat" : a.includes("portal") ? "portal" : a.includes("bot") || a.includes("website") ? "portal" : "index"; };
    const paint = () => {
      const total = state.files.reduce((n, f) => n + (f.facts || 0), 0);
      const grown = state.startFacts === null ? 0 : total - state.startFacts;
      const t = new Date(state.lastCheck || Date.now()).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      const rows = state.files.slice(0, 40).map((f) => {
        const change = state.changes.get(f.id), who = f.source_app || "Someone", n = f.facts || 0;
        let verb, after = "";
        if (change && change.delta > 0) verb = `learned ${plural(change.delta, change.isNew ? "fact" : "new fact")} in`;
        else if (change && change.delta < 0) { verb = "tidied"; after = ` (${plural(n, "fact")} now)`; }
        else if (change) verb = "updated";
        else verb = n ? `learned ${plural(n, "fact")} in` : "started";
        return `<li><a class="row memory-feed${change && Date.now() - change.at < 60000 ? " fresh" : ""}" href="${hrefOf(f)}"><span class="row-lead">${window.NovaTile ? window.NovaTile(sourceTile(who)) : icon("book")}</span><span class="row-main"><span class="memory-feed-text"><b>${esc(who)}</b> ${esc(verb)} <span class="memory-where">${esc(where(f))}</span>${esc(after)}</span>${f.description ? `<span>${esc(f.description)}</span>` : ""}</span><span class="row-end">${esc(rel(f.updated_at))}</span></a></li>`;
      });
      box.innerHTML = `${tabs("live")}<div class="card memory-live"><p class="memory-live-num">${total}</p><p class="kicker">facts the suite knows</p><p class="muted small">${grown > 0 ? `+${plural(grown, "fact")} since you opened Index` : state.files.length ? `in ${plural(state.files.length, "file")}` : ""}</p><p class="small memory-listening">${document.hidden ? "Paused" : `Listening · last checked ${t} · every 20 s`}</p></div>
        ${rows.length ? `<ol class="list memory-feeds">${rows.join("")}</ol>` : empty({ icon: "book", title: "Quiet so far", text: "When Nova Agent or Nova Bot learns something, it shows up here." })}`;
    };
    paint();
    // (every 20 s, only while Live is on screen and the phone's looking at it)
    liveTimer = setInterval(async () => {
      if (location.hash !== "#index/live") return clearInterval(liveTimer);
      if (document.hidden) return;
      try { await loadAll(true); if (location.hash === "#index/live") paint(); } catch (e) { /* (tried again in 20 s) */ }
    }, 20000);
  }
  document.addEventListener("visibilitychange", () => {
    const p = document.querySelector(".memory-listening");
    if (p) p.textContent = document.hidden ? "Paused" : "Listening · every 20 s";
  });

  // ===== Approve: facts learned from customers wait here for a yes =====
  async function drawApprove(box) {
    await loadAll().catch((err) => { if (err.signIn) throw err; });
    const r = await get("/pending");
    state.pending = Array.isArray(r.pending) ? r.pending : [];
    state.locked = r.locked === true;
    const intro = `<p class="muted small">Facts learned from customer chats wait here. Nothing is remembered until someone says yes.</p>`;
    if (state.locked) {
      box.innerHTML = `${tabs("approve")}${intro}<div class="empty">${icon("user")}<b>Approvals need a sign-in</b><span>Customers' facts and the approval queue need a Portal sign-in, so they aren't shown until you sign in.</span><a class="btn main" href="/portal/?app=1&next=${encodeURIComponent("/phone/#index/approve")}">Sign in</a></div>`;
      return;
    }
    if (state.stats) state.stats.pending = state.pending.length;
    N.badge("index", state.admin ? state.pending.length : 0);
    const editing = new Set();
    const render = () => {
      box.innerHTML = `${tabs("approve")}${intro}${state.pending.length ? state.pending.map((p) => {
        const ref = String(p.source_ref || "").replace(/^chat[-:_]?/i, "");
        const from = [p.source_app ? `From ${p.source_app}` : "", ref ? `chat ${ref.slice(0, 8)}` : "", rel(p.created_at)].filter(Boolean).join(" · ");
        const ed = editing.has(String(p.id));
        return `<article class="card memory-pending" data-p="${esc(p.id)}"><p class="kicker">${esc(where({ scope: p.scope, owner_id: p.owner_id }, p.target))}</p>
          ${ed ? `<form class="form" data-edit>${field({ label: "The fact, to edit before approving", name: "fact", type: "textarea", rows: 2, value: p.edited ?? p.fact, attrs: 'maxlength="240"' })}</form>` : `<p class="memory-pfact">${pill(p.tag)} ${esc(p.edited ?? p.fact)}</p>`}
          <p class="muted small">${esc(from)}</p>${p.source_app === "NovaBot" && p.source_ref ? `<a class="btn wide quiet" href="#inbox/chat/${encodeURIComponent(p.source_ref)}">${icon("chat")} Open the chat</a>` : ""}
          <div class="btns two"><button type="button" class="btn main" data-a="approve">${icon("check")} ${ed ? "Approve edited" : "Approve"}</button>${ed ? `<button type="button" class="btn" data-a="cancel">Cancel</button>` : `<button type="button" class="btn" data-a="edit">${icon("edit")} Edit</button>`}<button type="button" class="btn danger" data-a="reject">✕ Reject</button></div></article>`;
      }).join("") : empty({ icon: "check", title: "Nothing waiting", text: "New facts from customer chats will appear here for a yes or no." })}`;
      box.querySelectorAll("[data-p]").forEach((card) => {
        const p = state.pending.find((x) => String(x.id) === card.dataset.p);
        card.querySelector("[data-edit] textarea")?.addEventListener("input", (e) => (p.edited = e.target.value));
        card.querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", () => {
          const a = b.dataset.a;
          if (a === "edit") { editing.add(String(p.id)); render(); box.querySelector(`[data-p="${CSS.escape(String(p.id))}"] textarea`)?.focus(); return; }
          if (a === "cancel") { editing.delete(String(p.id)); delete p.edited; render(); return; }
          decide(p, a, card);
        }));
      });
    };
    async function decide(p, action, card) {
      const buttons = card.querySelectorAll("button");
      const body = { action };
      if (action === "approve" && p.edited !== undefined && !p.edited.trim()) return toast("The fact is empty. Write it, or reject it.", true);
      if (action === "approve" && p.edited !== undefined && p.edited.trim() !== p.fact) body.fact = p.edited.trim();
      buttons.forEach((b) => (b.disabled = true));
      const gone = () => { state.pending = state.pending.filter((x) => x.id !== p.id); editing.delete(String(p.id)); if (state.stats) state.stats.pending = state.pending.length; N.badge("index", state.admin ? state.pending.length : 0); render(); };
      try {
        await send(`/pending/${encodeURIComponent(p.id)}`, "POST", body);
        gone();
        if (action === "approve") state.loadedAt = 0;
        toast(action === "approve" ? `Remembered in ${where({ scope: p.scope, owner_id: p.owner_id }, p.target)}` : "Rejected. It won't be remembered.");
      } catch (err) {
        if (err.signIn) throw err;
        if (err.status === 404) { toast("Someone already dealt with that one."); gone(); return; }
        if (err.status && err.status < 500) { toast(`${err.message || "That didn't work"}. It was dropped, not remembered.`, true); gone(); return; }
        // (no answer at all: still waiting, try again)
        toast(err.message, true);
        buttons.forEach((b) => (b.disabled = false));
      }
    }
    render();
  }

  // ===== Tidy up (admins): check first, then remove exactly what the check listed; the 30-day bin =====
  const TIDY_KINDS = [["empty-file", "Empty files", "no facts in them"], ["junk-file", "Files of nothing but junk", "every fact in them is junk"], ["junk-line", "Junk facts", "placeholders, punctuation, cut-off lines"], ["repeat-line", "Repeated facts", "the first copy in the file stays"], ["junk-pending", "Junk waiting for approval", "never worth approving"], ["repeat-pending", "Repeats waiting for approval", "the oldest stays, or it's already remembered"]];
  const whereText = (i) => [SCOPE_NAMES[i.scope] || i.scope, ownerLabel(i.scope, i.owner_id), i.path].filter(Boolean).join(" · ");
  const tidy = { report: null, result: null, busy: false, bin: null, error: "" };
  async function drawTidy(box, ui) {
    ui.back("#index");
    ui.title("Tidy up");
    if (!state.stats) await loadAll().catch((err) => { if (err.signIn) throw err; });
    if (!state.admin) { box.innerHTML = empty({ icon: "user", title: "Tidy up is for admins", text: "Cleaning up Index is for admins, signed in to Portal.", action: `<a class="btn" href="#index">Back to Index</a>` }); return; }
    tidy.report = null; tidy.result = null; tidy.error = "";
    const item = (i) => `<li><p class="memory-tidy-text">${esc(i.text || "(empty)")}</p><p class="muted small">${esc(whereText(i))} · ${esc(i.reason)}${i.kept ? ` · keeps “${esc(String(i.kept).replace(/^- \[\w+\] /, ""))}”` : ""}</p></li>`;
    const render = () => {
      const r = tidy.report;
      let html = tidy.error ? `<p class="card bad">${esc(tidy.error)}</p>` : "";
      if (tidy.busy) html += `<div class="card"><p class="muted">${r ? "Removing…" : "Checking every file and every fact waiting for approval…"}</p></div>`;
      else if (r && r.counts.total) {
        html += `<section class="card"><p class="card-title">${plural(r.counts.total, "entry", "entries")} would be removed</p>${r.keeps ? `<p class="muted small">${esc(r.keeps)}</p>` : ""}`;
        for (const [kind, title, help] of TIDY_KINDS) {
          const items = r.items.filter((i) => i.kind === kind);
          if (!items.length) continue;
          html += `<p class="kicker memory-tidy-head">${items.length} ${esc(title)} <span class="muted">· ${esc(help)}</span></p><ul class="memory-tidy">${items.slice(0, 4).map(item).join("")}</ul>${items.length > 4 ? `<details class="memory-more"><summary>${items.length - 4} more</summary><ul class="memory-tidy">${items.slice(4).map(item).join("")}</ul></details>` : ""}`;
        }
        if (r.more) html += `<p class="muted small">${r.more} more weren't listed: check again after this.</p>`;
        html += `</section><section class="card"><p><b>Remove these ${plural(r.counts.total, "entry", "entries")}?</b></p><p class="muted small">Only what's listed above. Anything that's changed since the check stays. Each one can be put back for 30 days.</p><div class="btns"><button type="button" class="btn danger wide" data-t="apply">Remove them</button><button type="button" class="btn quiet wide" data-t="cancel">Not now</button></div></section>`;
      } else if (r) html += `<div class="card"><p class="card-title">All tidy</p><p class="muted">No empty files, junk or repeats right now.</p><button type="button" class="btn wide" data-t="check">Check again</button></div>`;
      else {
        html += `<div class="card">${tidy.result ? `<p class="card-title">Removed ${plural(tidy.result.removed, "entry", "entries")}</p>${(tidy.result.skipped || []).length ? `<p class="muted small">${plural(tidy.result.skipped.length, "entry", "entries")} stayed: ${esc(tidy.result.skipped[0].why)}${tidy.result.skipped.length > 1 ? ", and others" : ""}.</p>` : ""}` : `<p class="muted">Looks through every file and every fact waiting for approval for empty files, junk (placeholders like “n/a”, lines of punctuation, cut-off sentences) and repeats in the same file. You'll see the list first.</p>`}<button type="button" class="btn main wide" data-t="check">${tidy.result ? "Check again" : "Check now"}</button></div>`;
      }
      const bin = tidy.bin;
      html += `<h3 class="h">The bin · 30 days</h3>`;
      if (!bin) html += N.skeleton(1);
      else {
        if (bin.error) html += `<p class="bad">${esc(bin.error)}</p>`;
        const waiting = bin.removed || [];
        html += waiting.length ? N.list(waiting.slice(0, 40).map((b) => `<li><div class="row memory-bin"><span class="row-main"><b>${esc(b.text || "(empty)")}</b><span>${esc(`${b.kind === "file" ? "File" : b.kind === "pending" ? "Waiting fact" : "Fact"} · ${whereText(b)} · ${b.reason} · removed by ${b.removed_by} ${rel(b.removed_at)}`)}</span></span><span class="row-end">${b.restored_at ? `<span class="small">Put back by ${esc(b.restored_by)}</span>` : `<button type="button" class="btn" data-back="${esc(b.id)}">Put back</button>`}</span></div></li>`)) + (waiting.length > 40 ? `<p class="muted small">and ${waiting.length - 40} more</p>` : "") : `<p class="muted">Nothing removed in the last 30 days.</p>`;
        const runs = (bin.runs || []).filter((x) => x.applied_at);
        if (runs.length) html += `<h3 class="h">Cleanups</h3><ul class="list memory-runs">${runs.map((x) => `<li class="row"><span class="row-main"><span>${esc(`${x.applied_by} removed ${plural(x.removed, "entry", "entries")} ${rel(x.applied_at)}${x.skipped ? ` (${x.skipped} skipped)` : ""} · checked by ${x.checked_by}`)}</span></span></li>`).join("")}</ul>`;
      }
      box.innerHTML = html;
      box.querySelectorAll("[data-t]").forEach((b) => b.addEventListener("click", () => ({ check: runCheck, apply: applyTidy, cancel: () => { tidy.report = null; render(); } })[b.dataset.t]()));
      box.querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", () => putBack(b.dataset.back, b)));
    };
    async function runCheck() {
      tidy.busy = true; tidy.error = ""; tidy.result = null; render();
      try { tidy.report = (await send("/cleanup/check", "POST", {})).report; } catch (err) { if (err.signIn) throw err; tidy.error = err.message; }
      tidy.busy = false; render();
    }
    async function applyTidy() {
      const r = tidy.report;
      if (!r || tidy.busy) return;
      tidy.busy = true; render();
      try {
        tidy.result = await send("/cleanup/apply", "POST", { report_id: r.id, ids: r.items.map((i) => i.id) });
        tidy.report = null;
        toast(`Removed ${plural(tidy.result.removed, "entry", "entries")}. They're in the bin for 30 days.`);
        state.bodies.clear();
        for (const [k, dd] of state.drafts) if (!dirty(dd)) state.drafts.delete(k);
        state.loadedAt = 0;
        await loadBin();
      } catch (err) { if (err.signIn) throw err; tidy.error = err.message; }
      tidy.busy = false; render();
    }
    async function loadBin() {
      try { tidy.bin = await get("/cleanup/removed"); } catch (err) { if (err.signIn) throw err; tidy.bin = { removed: [], runs: [], error: err.message }; }
    }
    async function putBack(id, b) {
      b.disabled = true;
      try {
        await send(`/cleanup/removed/${encodeURIComponent(id)}/restore`, "POST", {});
        toast("Put back");
        state.bodies.clear(); state.loadedAt = 0;
        await loadBin();
        render();
      } catch (err) { if (err.signIn) throw err; b.disabled = false; toast(err.message, true); }
    }
    render();
    loadBin().then(() => { if (box.isConnected || location.hash === "#index/tidy") render(); });
  }
})();
