// Console's page: the Nova tab (commands.js, a line you type into) and terminal tabs (the studio
// computer's shell, the VPSdime server), each drawn by xterm.js in the theme's colours.
import * as Nova from "./commands.js";

const $ = (id) => document.getElementById(id);
const HDR = { "X-Nova-Visualizer": "1" };
const FONT_KEY = "nova-console-font";
const OPEN_KEY = "nova-console-open"; // this tab's terminals, so a reload finds them again
const store = {
  get: (k, d) => {
    try {
      return JSON.parse(localStorage.getItem(k)) ?? d;
    } catch {
      return d;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};
const session = {
  get: () => {
    try {
      return JSON.parse(sessionStorage.getItem(OPEN_KEY)) || [];
    } catch {
      return [];
    }
  },
  set: (v) => {
    try {
      sessionStorage.setItem(OPEN_KEY, JSON.stringify(v));
    } catch {}
  },
};

// ---- Talking to Nova Agent (the same addresses the panels use; online they go through Nova Bot) ----
async function api(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: { ...HDR, ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok || (data && data.ok === false)) {
    const message =
      (data && (data.message || data.error)) ||
      (res.status === 401 ? "Sign in with Portal first." : res.status === 503 ? "The studio computer is off or offline." : res.status === 404 ? "That isn't here (it may need a newer Nova Agent)." : `Something went wrong (${res.status}).`);
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data ?? {};
}

// ---- The theme's colours, for the terminals ----
function hex(v, d) {
  v = String(v || "").trim();
  return /^#[0-9a-f]{3,8}$/i.test(v) ? v : d;
}
function themeNow() {
  const s = getComputedStyle(document.documentElement);
  const get = (k, d) => hex(s.getPropertyValue(k), d);
  const hi = get("--hi", "#ff5fa8");
  return {
    background: get("--void", "#06040d"),
    foreground: get("--text", "#ebd3e7"),
    cursor: hi,
    cursorAccent: get("--void", "#06040d"),
    selectionBackground: hi + "55",
    black: "#1a1325",
    red: "#ff6b8b",
    green: "#7ee0b0",
    yellow: get("--gold", "#f2d9a0"),
    blue: get("--lilac", "#c7a4ff"),
    magenta: hi,
    cyan: get("--soft", "#ffd1ea"),
    white: get("--text", "#ebd3e7"),
    brightBlack: get("--muted", "#b997b5"),
    brightRed: "#ff8fa7",
    brightGreen: "#a6f0cb",
    brightYellow: "#ffe9b8",
    brightBlue: "#ddc8ff",
    brightMagenta: "#ff9cc9",
    brightCyan: "#ffe6f3",
    brightWhite: "#ffffff",
  };
}

const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
let fontSize = Math.min(24, Math.max(11, Number(store.get(FONT_KEY, 15)) || 15));
const tabs = []; // { id, kind, title, term, fit, screen, tabEl, ... }
let current = null;

function makeTerminal(screen) {
  const term = new window.Terminal({
    fontFamily: '"Source Code Pro", ui-monospace, Menlo, Consolas, monospace',
    fontSize,
    lineHeight: 1.25,
    cursorBlink: !still,
    cursorStyle: "bar",
    scrollback: 5000,
    allowProposedApi: false,
    theme: themeNow(),
    convertEol: false,
  });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new window.WebLinksAddon.WebLinksAddon((e, uri) => window.open(uri, "_blank", "noopener")));
  term.open(screen);
  return { term, fit };
}

function addTab({ id, title, closable, kind }) {
  const screen = document.createElement("div");
  screen.className = "screen";
  screen.id = `screen-${id}`;
  screen.setAttribute("role", "tabpanel");
  screen.setAttribute("aria-label", title);
  $("screens").append(screen);
  const tabEl = document.createElement("div");
  tabEl.className = "tab" + (closable ? " closable" : "");
  tabEl.setAttribute("role", "tab");
  tabEl.tabIndex = 0;
  tabEl.id = `tab-${id}`;
  tabEl.setAttribute("aria-controls", screen.id);
  tabEl.innerHTML = `<span class="dot" aria-hidden="true"></span><span class="t"></span>`;
  tabEl.querySelector(".t").textContent = title;
  if (closable) {
    const x = document.createElement("button");
    x.className = "x";
    x.type = "button";
    x.textContent = "×";
    x.setAttribute("aria-label", `Close ${title}`);
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(tab);
    });
    tabEl.append(x);
  }
  $("tabs").append(tabEl);
  const { term, fit } = makeTerminal(screen);
  const tab = { id, kind, title, term, fit, screen, tabEl };
  tabEl.addEventListener("click", () => show(tab));
  tabEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      show(tab);
    }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const i = tabs.indexOf(tab) + (e.key === "ArrowRight" ? 1 : -1);
      const next = tabs[(i + tabs.length) % tabs.length];
      show(next);
      next.tabEl.focus();
    }
  });
  tabs.push(tab);
  show(tab);
  return tab;
}

function show(tab) {
  current = tab;
  for (const t of tabs) {
    const on = t === tab;
    t.screen.hidden = !on;
    t.tabEl.setAttribute("aria-selected", String(on));
  }
  requestAnimationFrame(() => {
    fitTab(tab);
    tab.term.focus();
  });
}

function fitTab(tab) {
  try {
    tab.fit.fit();
  } catch {}
  if (tab.onResize) tab.onResize(tab.term.cols, tab.term.rows);
}

function closeTab(tab) {
  if (tab.close) tab.close();
  tab.term.dispose();
  tab.screen.remove();
  tab.tabEl.remove();
  tabs.splice(tabs.indexOf(tab), 1);
  if (current === tab && tabs.length) show(tabs[0]);
}

// ---- Writing to a terminal ----
const C = { reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m", ok: "\x1b[32m", warn: "\x1b[33m", err: "\x1b[31m", hi: "\x1b[35m", soft: "\x1b[36m" };
const lines = (t) => String(t).split(/\r?\n/);
function writer(term) {
  const put = (text, colour = "") => {
    for (const l of lines(text)) term.write(`${colour}${l}${colour ? C.reset : ""}\r\n`);
  };
  return {
    print: (t) => put(t),
    ok: (t) => put(`✓ ${t}`, C.ok),
    warn: (t) => put(t, C.warn),
    error: (t) => put(t, C.err),
    dim: (t) => put(t, C.dim),
    table(rows, cols) {
      if (!rows.length) return put("(nothing)", C.dim);
      const width = Math.max(40, term.cols - 2);
      const w = cols.map((c) => Math.min(Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)), 48));
      // Shrink the widest columns until it fits the terminal
      while (w.reduce((a, b) => a + b + 2, 0) > width) {
        const i = w.indexOf(Math.max(...w));
        if (w[i] <= 6) break;
        w[i]--;
      }
      const cell = (v, n) => {
        const s = String(v ?? "");
        return s.length > n ? s.slice(0, Math.max(1, n - 1)) + "…" : s.padEnd(n);
      };
      put(cols.map((c, i) => cell(c.toUpperCase(), w[i])).join("  "), C.soft + C.bold);
      for (const r of rows) put(cols.map((c, i) => cell(r[c], w[i])).join("  "));
    },
  };
}

// ---- The Nova tab: a line to type commands into ----
const PROMPT = `${C.hi}nova ›${C.reset} `;
const PROMPT_LEN = 7;
function novaTab(me) {
  const tab = addTab({ id: "nova", title: "Nova", closable: false, kind: "nova" });
  const term = tab.term;
  const out = writer(term);
  const history = store.get("nova-console-history", []).slice(-200);
  let line = "";
  let cursor = 0;
  let hIndex = history.length;
  let busy = false;
  let asking = null; // { resolve, prompt }

  const prompt = () => (asking ? asking.prompt : PROMPT);
  const promptLen = () => (asking ? asking.len : PROMPT_LEN);
  // Where the cursor was drawn (prompt + text before it), so a long line that wraps is redrawn whole
  let drawnAt = 0;
  function redraw() {
    const cols = Math.max(10, term.cols);
    const P = promptLen();
    // Back to where this line started, then clear everything below
    const upRows = Math.floor(drawnAt / cols);
    term.write(`\r${upRows ? `\x1b[${upRows}A` : ""}\x1b[J${prompt()}${line}`);
    // From the end of the text to the cursor
    const end = P + line.length;
    const at = P + cursor;
    const endRow = Math.floor(end / cols);
    const atRow = Math.floor(at / cols);
    if (end % cols === 0 && end > 0) term.write("\r\n"); // a full last row: step onto the next like a terminal would
    const fromRow = end % cols === 0 && end > 0 ? endRow : endRow;
    if (fromRow > atRow) term.write(`\x1b[${fromRow - atRow}A`);
    term.write(`\r${at % cols ? `\x1b[${at % cols}C` : ""}`);
    drawnAt = at;
  }
  function setLine(v) {
    line = v;
    cursor = v.length;
    redraw();
  }

  const ctx = {
    me,
    api,
    ...out,
    clear: () => term.clear(),
    history: () => history.slice(),
    ask: (question) =>
      new Promise((resolve) => {
        asking = { resolve, prompt: `${C.warn}${question}${C.reset}`, len: question.length };
        line = "";
        cursor = 0;
        drawnAt = 0;
        redraw();
      }),
    open(path) {
      try {
        const top = window.top;
        if (path.startsWith("pane:") || path === "manual") {
          const btn = top.document.querySelector(`#tabbar [data-tab="${path}"]`);
          if (btn) return void btn.click();
        }
        if (top.NovaAgent && top.NovaAgent.open(path)) return;
      } catch {}
      if (!path.startsWith("pane:")) window.open(path, "_blank", "noopener");
    },
    terminal: (kind) => openTerminal(kind),
  };
  try {
    ctx.look = window.top.NovaLook || window.NovaLook || null;
    ctx.music = window.top.NovaAmbient || null;
  } catch {
    ctx.look = window.NovaLook || null;
  }

  async function submit() {
    const text = line;
    term.write("\r\n");
    line = "";
    cursor = 0;
    drawnAt = 0;
    if (asking) {
      const a = asking;
      asking = null;
      a.resolve(text);
      return;
    }
    if (text.trim()) {
      if (history[history.length - 1] !== text) history.push(text);
      store.set("nova-console-history", history.slice(-200));
    }
    hIndex = history.length;
    busy = true;
    try {
      await Nova.run(ctx, text);
    } catch (err) {
      out.error(err.message || String(err));
    }
    busy = false;
    if (!asking) {
      term.write(PROMPT);
      drawnAt = PROMPT_LEN;
    }
  }

  function complete() {
    const before = line.slice(0, cursor);
    const options = Nova.complete(before);
    if (!options.length) return;
    const partial = /\s$/.test(before) ? "" : before.split(/\s+/).pop();
    if (options.length === 1) {
      const add = options[0].slice(partial.length) + " ";
      line = before + add + line.slice(cursor);
      cursor += add.length;
      return redraw();
    }
    // The shared start of all of them, then the list
    let common = options[0];
    for (const o of options) while (!o.startsWith(common)) common = common.slice(0, -1);
    if (common.length > partial.length) {
      const add = common.slice(partial.length);
      line = before + add + line.slice(cursor);
      cursor += add.length;
      return redraw();
    }
    term.write("\r\n" + C.dim + options.join("   ") + C.reset + "\r\n");
    drawnAt = 0;
    redraw();
  }

  tab.input = (data) => {
    if (busy && !asking) {
      if (data === "\x03") term.write(`${C.dim}^C (it carries on in the background)${C.reset}\r\n`);
      return;
    }
    switch (data) {
      case "\r":
        return void submit();
      case "\x7f":
      case "\b":
        if (cursor > 0) {
          line = line.slice(0, cursor - 1) + line.slice(cursor);
          cursor--;
          redraw();
        }
        return;
      case "\x1b[3~":
        if (cursor < line.length) {
          line = line.slice(0, cursor) + line.slice(cursor + 1);
          redraw();
        }
        return;
      case "\t":
        if (!asking) complete();
        return;
      case "\x1b[A":
        if (asking || !history.length) return;
        hIndex = Math.max(0, hIndex - 1);
        return setLine(history[hIndex] || "");
      case "\x1b[B":
        if (asking) return;
        hIndex = Math.min(history.length, hIndex + 1);
        return setLine(history[hIndex] || "");
      case "\x1b[D":
        if (cursor > 0) {
          cursor--;
          redraw();
        }
        return;
      case "\x1b[C":
        if (cursor < line.length) {
          cursor++;
          redraw();
        }
        return;
      case "\x1b[H":
      case "\x01":
        cursor = 0;
        return redraw();
      case "\x1b[F":
      case "\x05":
        cursor = line.length;
        return redraw();
      case "\x15":
        return setLine("");
      case "\x0c":
        term.clear();
        return redraw();
      case "\x03":
        term.write(`${C.dim}^C${C.reset}\r\n`);
        if (asking) {
          const a = asking;
          asking = null;
          line = "";
          cursor = 0;
          a.resolve("");
          return;
        }
        line = "";
        cursor = 0;
        drawnAt = PROMPT_LEN;
        return void term.write(PROMPT);
      case "\x1b":
        return setLine("");
    }
    // Typed or pasted text: one line at a time (a pasted line ending in Enter runs it)
    const parts = data.replace(/\r\n?/g, "\n").split("\n");
    const first = parts[0].replace(/[\x00-\x1f\x7f]/g, "");
    if (first) {
      line = line.slice(0, cursor) + first + line.slice(cursor);
      cursor += first.length;
      redraw();
    }
    if (parts.length > 1) submit();
  };
  term.onData((d) => tab.input(d));

  out.print(`${C.bold}Console${C.reset}  ${C.dim}· everything in Nova Agent, typed${C.reset}`);
  out.dim(`Signed in as ${me.name} (${me.role})${me.online ? " · online" : " · on the studio computer"}. Type help, or try: now · quests · portal enquiries · agent "what's on today?"`);
  term.write(PROMPT);
  drawnAt = PROMPT_LEN;
  return tab;
}

// ---- Terminal tabs (shell / vps / vps-key): only on the studio computer, for admins ----
let state = { terminals: false, why: "" };
async function openTerminal(kind, existing) {
  if (!state.terminals) throw new Error(state.why || "Terminals can't open here.");
  const nova = tabs.find((t) => t.kind === "nova");
  let info = existing;
  if (!info) {
    const size = nova ? { cols: nova.term.cols, rows: nova.term.rows } : { cols: 100, rows: 30 };
    info = await api("/console-api/term", { method: "POST", body: { kind, ...size } });
  }
  const tab = addTab({ id: info.id, title: info.title || kind, closable: true, kind });
  const term = tab.term;
  let queue = "";
  let sending = Promise.resolve();
  const send = (data) => {
    queue += data;
    sending = sending.then(async () => {
      if (!queue) return;
      const chunk = queue;
      queue = "";
      try {
        await api(`/console-api/term/${info.id}/input`, { method: "POST", body: { data: chunk }, headers: { "X-Console-Token": info.token } });
      } catch (err) {
        term.write(`\r\n${C.err}${err.message}${C.reset}\r\n`);
      }
    });
  };
  tab.input = send;
  term.onData(send);
  let resizeTimer = 0;
  tab.onResize = (cols, rows) => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => api(`/console-api/term/${info.id}/resize`, { method: "POST", body: { cols, rows }, headers: { "X-Console-Token": info.token } }).catch(() => {}), 120);
  };
  let opened = 0;
  const es = new EventSource(`/console-api/term/${info.id}/stream?token=${encodeURIComponent(info.token)}`);
  es.addEventListener("open", () => {
    // Reconnected: the stream starts again with what was printed so far
    if (opened++ > 0) term.reset();
  });
  es.addEventListener("out", (e) => term.write(JSON.parse(e.data)));
  es.addEventListener("exit", () => {
    tab.tabEl.classList.add("ended");
    term.write(`\r\n${C.dim}[it has ended: close this tab, or open a new one]${C.reset}\r\n`);
    es.close();
    forget(info.id);
  });
  tab.close = () => {
    es.close();
    forget(info.id);
    api(`/console-api/term/${info.id}/close`, { method: "POST", body: {}, headers: { "X-Console-Token": info.token } }).catch(() => {});
  };
  if (!existing) session.set([...session.get(), { id: info.id, token: info.token, title: info.title, kind }]);
  fitTab(tab);
  return tab;
}
const forget = (id) => session.set(session.get().filter((t) => t.id !== id));

// ---- The extra keys (touch screens) ----
let ctrl = false;
const KEYS = { tab: "\t", esc: "\x1b", left: "\x1b[D", right: "\x1b[C", up: "\x1b[A", down: "\x1b[B" };
$("keys").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-key]");
  if (!b || !current) return;
  const k = b.dataset.key;
  if (k === "ctrl") {
    ctrl = !ctrl;
    b.setAttribute("aria-pressed", String(ctrl));
    return current.term.focus();
  }
  current.input && current.input(KEYS[k] || k);
  current.term.focus();
});
// Ctrl held on the extra keys: the next letter typed becomes Ctrl+letter
document.addEventListener(
  "keydown",
  (e) => {
    if (!ctrl || e.key.length !== 1 || !/[a-z]/i.test(e.key) || !current?.input) return;
    e.preventDefault();
    e.stopPropagation();
    current.input(String.fromCharCode(e.key.toUpperCase().charCodeAt(0) - 64));
    ctrl = false;
    document.querySelector('[data-key="ctrl"]').setAttribute("aria-pressed", "false");
  },
  true
);

// ---- Text size, new terminals, resizing, the theme ----
function setFont(n) {
  fontSize = Math.min(24, Math.max(11, n));
  store.set(FONT_KEY, fontSize);
  for (const t of tabs) {
    t.term.options.fontSize = fontSize;
    fitTab(t);
  }
}
$("font-up").addEventListener("click", () => setFont(fontSize + 1));
$("font-down").addEventListener("click", () => setFont(fontSize - 1));
const note = (text) => {
  $("note").textContent = text;
  $("note").hidden = !text;
};
for (const [id, kind] of [
  ["new-shell", "shell"],
  ["new-vps", "vps"],
]) {
  $(id).addEventListener("click", () =>
    openTerminal(kind).catch((err) => {
      note(err.message);
      const nova = tabs.find((t) => t.kind === "nova");
      if (nova) writer(nova.term).error(err.message);
    })
  );
}
new ResizeObserver(() => current && fitTab(current)).observe($("screens"));
const retheme = () => {
  const theme = themeNow();
  for (const t of tabs) t.term.options.theme = theme;
};
addEventListener("novalookchange", () => setTimeout(retheme, 50));
addEventListener("novathemechange", () => setTimeout(retheme, 50));
addEventListener("storage", (e) => e.key === "nova-look" && setTimeout(retheme, 50));
new MutationObserver(() => retheme()).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-look", "style"] });

// ---- Start ----
async function start() {
  let me = { id: "", name: "you", role: "staff", online: true };
  try {
    state = await api("/console-api/state");
    me = state.me || me;
  } catch (err) {
    state = { terminals: false, why: err.message };
  }
  for (const id of ["new-shell", "new-vps"]) {
    $(id).disabled = !state.terminals;
    if (!state.terminals) $(id).title = state.why || "Terminals only open on the studio computer itself, for admins.";
  }
  if (!state.terminals && state.why) note(`Terminals: ${state.why}`);
  novaTab(me);
  // This browser tab's terminals from before a reload
  const still = new Set((state.open || []).map((t) => t.id));
  for (const t of session.get()) {
    if (still.has(t.id)) await openTerminal(t.kind, t).catch(() => forget(t.id));
    else forget(t.id);
  }
  show(tabs[0]);
  // (for checks: type a line into the Nova tab as if typed)
  window.NovaConsole = { type: (text) => tabs.find((t) => t.kind === "nova")?.input(text), tabs, openTerminal };
}
if (document.fonts && document.fonts.ready) document.fonts.ready.then(start);
else start();
