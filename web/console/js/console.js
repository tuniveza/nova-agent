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
let fontSize = Math.min(26, Math.max(12, Number(store.get(FONT_KEY, 16)) || 16));
const tabs = []; // { id, kind, title, term, fit, screen, tabEl, ... }
let current = null;

function makeTerminal(screen) {
  const box = document.createElement("div");
  box.className = "term";
  screen.append(box);
  const term = new window.Terminal({
    fontFamily: '"Source Code Pro", ui-monospace, Menlo, Consolas, monospace',
    fontSize,
    lineHeight: 1.35,
    // (the weights the page loads, so bold letters are exactly as wide as the rest)
    fontWeight: "400",
    fontWeightBold: "600",
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
  term.open(box);
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
  showQuick();
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
// Everything Nova prints sits in the middle: a block of text is wrapped to a comfortable width
// and centred as a block (so short lines are centred, and longer ones stay easy to read), tables
// and lists are centred as blocks, and headings stand out in the theme's colours.
const C = { reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m", ok: "\x1b[32m", warn: "\x1b[33m", err: "\x1b[31m", hi: "\x1b[35m", soft: "\x1b[36m", lilac: "\x1b[34m", gold: "\x1b[93m", white: "\x1b[97m" };
const lines = (t) => String(t).split(/\r?\n/);
const ANSI = /\x1b\[[0-9;]*m/g;
// How many columns a piece of text takes (emoji and wide letters take two, joiners none)
export function widthOf(text) {
  let w = 0;
  for (const ch of String(text).replace(ANSI, "")) {
    if (/[̀-ͯ​-‏︎️]/.test(ch)) continue;
    w += /\p{Extended_Pictographic}|[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u.test(ch) ? 2 : 1;
  }
  return w;
}
// Cut plain text to fit n columns
function fitTo(text, n) {
  const s = String(text ?? "");
  if (widthOf(s) <= n) return s + " ".repeat(n - widthOf(s));
  let out = "";
  for (const ch of s) {
    if (widthOf(out + ch) > n - 1) break;
    out += ch;
  }
  return out + "…" + " ".repeat(Math.max(0, n - widthOf(out) - 1));
}
// Wrap plain text to n columns, at spaces where possible
function wrap(text, n) {
  const out = [];
  for (const para of lines(text)) {
    if (widthOf(para) <= n) {
      out.push(para);
      continue;
    }
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      if (widthOf(line + word) <= n) line += word;
      else if (widthOf(word) > n) {
        if (line.trim()) out.push(line.trimEnd());
        let rest = word;
        while (widthOf(rest) > n) {
          let cut = "";
          for (const ch of rest) {
            if (widthOf(cut + ch) > n) break;
            cut += ch;
          }
          out.push(cut);
          rest = rest.slice(cut.length);
        }
        line = rest;
      } else {
        if (line.trim()) out.push(line.trimEnd());
        line = word.trimStart();
      }
    }
    if (line.trim()) out.push(line.trimEnd());
  }
  return out;
}
// Everything a terminal's writer prints is remembered, so when the width changes (the window, the
// text size, or the first fit after the welcome was written) it is all laid out again, centred for
// the new width. One writer per terminal.
const writers = new WeakMap();
function writer(term) {
  if (!writers.has(term)) writers.set(term, rememberAll(term, layout(term)));
  return writers.get(term);
}
function rememberAll(term, methods) {
  const log = [];
  let depth = 0;
  let replaying = false;
  const remember = (fn) => {
    if (replaying) return;
    log.push(fn);
    if (log.length > 600) log.splice(0, log.length - 600);
  };
  const out = {};
  for (const [k, fn] of Object.entries(methods))
    out[k] = (...args) => {
      if (!depth) remember(() => out[k](...args));
      depth++;
      try {
        return fn.apply(out, args);
      } finally {
        depth--;
      }
    };
  // Something already on screen, to be drawn again (by fn) after a change of width
  out.remember = remember;
  // Plain text written now and again after a change of width
  out.raw = (text) => {
    remember(() => term.write(text));
    term.write(text);
  };
  out.forget = () => void (log.length = 0);
  out.relayout = () => {
    replaying = true;
    // (in the stream, not term.reset(): that runs at once, before writing still queued, which then lands on the cleared screen)
    term.write("\x1bc\x1b[3J");
    try {
      for (const fn of log) fn();
    } finally {
      replaying = false;
    }
  };
  return out;
}
function layout(term) {
  const cols = () => Math.max(20, term.cols);
  const readable = () => Math.min(cols() - 4, 92);
  // A block of already-coloured lines, centred as a block
  const block = (rows) => {
    const w = Math.max(0, ...rows.map(widthOf));
    const pad = " ".repeat(Math.max(0, Math.floor((cols() - w) / 2)));
    for (const r of rows) term.write(`${pad}${r}${C.reset}\r\n`);
  };
  const say = (text, colour = "") => block(wrap(text, readable()).map((l) => `${colour}${l}`));
  return {
    print: (t) => say(t),
    ok: (t) => say(`✓ ${t}`, C.ok),
    warn: (t) => say(t, C.warn),
    error: (t) => say(`✗ ${t}`, C.err),
    dim: (t) => say(t, C.dim),
    // A title with a soft line under it
    heading(t) {
      const title = String(t);
      const rule = "─".repeat(Math.min(readable(), Math.max(12, widthOf(title) + 8)));
      term.write("\r\n");
      block([`${C.bold}${C.hi}${title}`, `${C.dim}${rule}`]);
    },
    // Two lined-up columns: what it is, and its value (wrapped under itself)
    kv(rows) {
      const list = rows.filter((r) => r && r[1] !== undefined && r[1] !== null && r[1] !== "");
      if (!list.length) return say("(nothing)", C.dim);
      const lw = Math.min(18, Math.max(...list.map(([k]) => widthOf(k))));
      const vw = Math.max(16, readable() - lw - 3);
      const out = [];
      for (const [k, v] of list) {
        const parts = wrap(String(v), vw);
        out.push(`${C.lilac}${fitTo(k, lw)}${C.reset}   ${C.white}${parts[0] || ""}`);
        for (const more of parts.slice(1)) out.push(`${" ".repeat(lw)}   ${C.white}${more}`);
      }
      block(out);
    },
    // A table with a coloured header; colours per column if given
    table(rows, cols2, colours = {}) {
      if (!rows.length) return say("(nothing)", C.dim);
      const avail = readable();
      const w = cols2.map((c) => Math.min(Math.max(widthOf(c), ...rows.map((r) => widthOf(r[c] ?? ""))), 52));
      while (w.reduce((a, b) => a + b + 3, -3) > avail) {
        const i = w.indexOf(Math.max(...w));
        if (w[i] <= 6) break;
        w[i]--;
      }
      const out = [cols2.map((c, i) => `${C.bold}${C.soft}${fitTo(c.toUpperCase(), w[i])}${C.reset}`).join("   ")];
      out.push(`${C.dim}${"─".repeat(w.reduce((a, b) => a + b + 3, -3))}`);
      for (const r of rows) out.push(cols2.map((c, i) => `${colours[c] || ""}${fitTo(r[c], w[i])}${C.reset}`).join("   "));
      block(out);
    },
    // help: each group under its own heading; one shared set of columns for all of them (the
    // command, what it does (wrapped, never cut), and an example), lined up and centred as a block
    help(groups) {
      const all = groups.flatMap((g) => g.rows);
      const nw = Math.max(...all.map((r) => widthOf(r.name)));
      const ew = Math.min(30, Math.max(...all.map((r) => widthOf(r.example || ""))));
      const ww = Math.max(18, Math.min(52, readable() - nw - ew - 6));
      const total = nw + ww + ew + 6;
      // Narrow (a phone): each command on its own line with its example, what it does under it
      if (total > cols() - 2 || ww < 24) {
        const w = Math.min(cols() - 2, 60);
        const lp = " ".repeat(Math.max(0, Math.floor((cols() - w) / 2)));
        for (const g of groups) {
          if (!g.rows.length) continue;
          this.heading(g.title);
          for (const r of g.rows) {
            const ex = r.example && r.example !== r.name ? r.example : "";
            term.write(`${lp}${C.bold}${C.hi}${r.name}${C.reset}${ex && widthOf(r.name) + widthOf(ex) + 3 <= w ? `   ${C.ok}${ex}` : ""}${C.reset}\r\n`);
            for (const l of wrap(r.what, w - 2)) term.write(`${lp}  ${C.white}${l}${C.reset}\r\n`);
          }
        }
        term.write("\r\n");
        return;
      }
      const pad = " ".repeat(Math.max(0, Math.floor((cols() - total) / 2)));
      const row = (a, b, c) => term.write(`${pad}${a}   ${b}   ${c}${C.reset}\r\n`);
      for (const g of groups) {
        if (!g.rows.length) continue;
        this.heading(g.title);
        for (const r of g.rows) {
          const what = wrap(r.what, ww);
          row(`${C.bold}${C.hi}${fitTo(r.name, nw)}${C.reset}`, `${C.white}${fitTo(what[0] || "", ww)}${C.reset}`, `${C.ok}${fitTo(r.example || "", ew)}`);
          for (const more of what.slice(1)) row(" ".repeat(nw), `${C.white}${fitTo(more, ww)}${C.reset}`, " ".repeat(ew));
        }
      }
      term.write("\r\n");
    },
  };
}

// ---- The Nova tab: a line to type commands into ----
const PROMPT = `${C.bold}${C.hi}nova ›${C.reset} `;
const PROMPT_LEN = 7;
function novaTab(me) {
  const tab = addTab({ id: "nova", title: "Nova", closable: false, kind: "nova" });
  const term = tab.term;
  const out = writer(term);
  // The prompt lines up with the left edge of the centred text above it
  const indent = () => {
    const c = Math.max(20, term.cols);
    return " ".repeat(Math.max(0, Math.floor((c - Math.min(c - 4, 92)) / 2)));
  };
  const history = store.get("nova-console-history", []).slice(-200);
  let line = "";
  let cursor = 0;
  let hIndex = history.length;
  let busy = false;
  let asking = null; // { resolve, prompt }

  const promptOf = (a) => indent() + (a ? a.prompt : PROMPT);
  const prompt = () => promptOf(asking);
  const promptLen = () => indent().length + (asking ? asking.len : PROMPT_LEN);
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
  // A fresh prompt on a new line
  function freshPrompt() {
    line = "";
    cursor = 0;
    drawnAt = 0;
    redraw();
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
    clear: () => {
      out.forget();
      term.clear();
    },
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
    const was = asking;
    out.remember(() => term.write(`${promptOf(was)}${text}\r\n`));
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
    if (!asking) freshPrompt();
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
      if (data === "\x03") out.raw(`${C.dim}^C (it carries on in the background)${C.reset}\r\n`);
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
        out.forget();
        term.clear();
        return redraw();
      case "\x03": {
        const a = asking;
        const text = line;
        out.remember(() => term.write(`${promptOf(a)}${text}${C.dim}^C${C.reset}\r\n`));
        term.write(`${C.dim}^C${C.reset}\r\n`);
        if (asking) {
          asking = null;
          line = "";
          cursor = 0;
          a.resolve("");
          return;
        }
        return freshPrompt();
      }
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

  out.heading("Console");
  out.print("Everything in Nova Agent, typed.");
  out.dim(`Signed in as ${me.name} (${me.role})${me.online ? " · online" : " · on the studio computer"}`);
  out.dim("Type help · or tap a command above · try: today · quests · enquiries · computer");
  out.raw("\r\n");
  freshPrompt();
  // A new width (the first fit, the window, the text size): everything again, centred for it
  let laidOutFor = term.cols;
  tab.onResize = (cols) => {
    if (cols === laidOutFor) return;
    laidOutFor = cols;
    out.relayout();
    if (!busy || asking) {
      drawnAt = 0;
      redraw();
    }
  };
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
  fontSize = Math.min(26, Math.max(12, n));
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

// ---- Quick commands: tap one to run it (the Nova tab) ----
// (in groups, from commands.js; hovering one says what it does)
function quickRow() {
  const row = $("quick");
  if (!row) return;
  row.replaceChildren(...Nova.QUICK.map(([title, buttons]) => quickGroup(title, buttons)));
}
function quickGroup(title, buttons) {
  const g = document.createElement("div");
  g.className = "qg";
  g.setAttribute("role", "group");
  g.setAttribute("aria-label", title);
  const label = document.createElement("span");
  label.className = "qg-t";
  label.textContent = title;
  label.setAttribute("aria-hidden", "true");
  g.append(
    label,
    ...buttons.map(([label, cmd]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "q";
      b.textContent = label;
      const what = Nova.COMMANDS[Nova.resolveName(cmd.trim().split(" ")[0])]?.help;
      b.title = what ? `${what} (types: ${cmd.trim()})` : cmd.trim();
      b.addEventListener("click", () => {
        const nova = tabs.find((t) => t.kind === "nova");
        if (!nova) return;
        show(nova);
        // (anything half-typed is cleared first; a command ending in a space waits for the rest)
        nova.input("\x15");
        nova.input(cmd.endsWith(" ") ? cmd : cmd + "\r");
        nova.term.focus();
      });
      return b;
    })
  );
  return g;
}
const showQuick = () => {
  const row = $("quick");
  if (row) row.hidden = !(current && current.kind === "nova");
};

// Online, terminals don't open: a clear way to open Console on the studio computer itself
function hereButton(why, url) {
  const box = $("note");
  box.replaceChildren();
  const p = document.createElement("span");
  p.textContent = `${why} `;
  box.append(p);
  if (url && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    const a = document.createElement("a");
    a.className = "here";
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    const server = state && state.where === "server";
    a.textContent = server ? "Open Console on the server" : "Open Console on this computer";
    a.title = server ? "Works once the ssh tunnel is open on this computer" : "Works when this browser is on the studio computer itself";
    box.append(a);
    const small = document.createElement("small");
    // Nova Agent on the server: its terminals open through an ssh tunnel from an admin's computer
    small.textContent = server && state.tunnel ? ` (first, in a terminal on this computer: ${state.tunnel})` : " (only on the studio computer itself)";
    box.append(small);
  }
  box.hidden = false;
}

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
  if (!state.terminals && state.why) hereButton(`Terminals: ${state.why}`, state.localUrl);
  quickRow();
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
