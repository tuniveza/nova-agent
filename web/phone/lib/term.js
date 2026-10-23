// Nova Phone's terminal screen (23 Oct 2026): a small VT100 / xterm-style screen drawn as plain page text, for
// the Console's terminal tabs (a shell on the studio computer or the server, ssh to the VPS).
//
// Why not xterm.js, as Nova Desk uses (web/console/vendor/xterm.js, 480 KB)? It writes <style> blocks and
// style="…" attributes into the page, and Nova Phone's page rules (CSP style-src 'self', no 'unsafe-inline') block
// both: its colours, cell sizes and scrollbar would be missing and every one reported. So the phone draws its own:
// colours by class (console.css .ct-f1…), the few made-up colours (256-colour and true colour) set through
// el.style, which the rules allow. Loaded only when a terminal opens (console.js), never at start.
//
//   const t = NovaTerm(el, { cols, rows, reply(data) })   (reply: answers the program asked for, to send back)
//   t.write(text)  t.resize(cols, rows)  t.reset()  t.focus(on)  t.modes { appCursor, bracketedPaste }  t.dispose()
//
// It does what a shell and the usual programs need: colours and styles (SGR, 16 / 256 / true colour), cursor moves,
// erasing, inserting and deleting, scroll regions, the second screen (vim, less, top), line-drawing letters,
// wide letters and emoji, tab stops, saved cursor, autowrap, and the questions programs ask (DA, DSR). What has
// scrolled off the top stays above as plain lines (the page scrolls; nothing scrolls inside it).
(() => {
  "use strict";
  const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Extended_Pictographic}/u;
  const ZERO = /[̀-ͯ​-‏⃐-⃿︎️]/;
  const LINES = { j: "┘", k: "┐", l: "┌", m: "└", n: "┼", q: "─", t: "├", u: "┤", v: "┴", w: "┬", x: "│", a: "▒", "`": "◆", f: "°", g: "±", "~": "·", o: "⎺", p: "⎻", r: "⎼", s: "⎽", y: "≤", z: "≥", "{": "π", "|": "≠", "}": "£" };
  const BACK_MAX = 1500;
  const html = (s) => s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
  // The 256 colours past the first 16: a 6×6×6 cube, then greys
  function rgb256(n) {
    if (n >= 232) { const v = 8 + (n - 232) * 10; return `rgb(${v},${v},${v})`; }
    n -= 16;
    const c = (v) => (v ? 55 + v * 40 : 0);
    return `rgb(${c(Math.floor(n / 36))},${c(Math.floor(n / 6) % 6)},${c(n % 6)})`;
  }
  // A look: fg / bg (-1 the screen's own, 0-255, or "rgb(…)"), and its flags
  const BOLD = 1, DIM = 2, ITALIC = 4, UNDER = 8, INVERSE = 16, HIDDEN = 32, STRIKE = 64;
  const look = (fg, bg, fl) => ({ fg, bg, fl, k: `${fg}|${bg}|${fl}` });
  const PLAIN = look(-1, -1, 0);

  window.NovaTerm = function NovaTerm(el, opts = {}) {
    let cols = Math.max(10, opts.cols || 80), rows = Math.max(4, opts.rows || 24);
    const reply = opts.reply || (() => {});
    el.classList.add("ct");
    el.innerHTML = '<div class="ct-back"></div><div class="ct-screen"></div>';
    const backEl = el.firstChild, screenEl = el.lastChild;
    let main, alt, buf, x, y, top, bot, wrapNext, attr, saved, tabs, charset, g, modes, focused = false, backLines = 0;
    const blank = (a = PLAIN) => ({ ch: Array(cols).fill(" "), at: Array(cols).fill(a), dirty: true });
    const screen = () => Array.from({ length: rows }, () => blank());
    function init() {
      main = screen(); alt = null; buf = main;
      x = 0; y = 0; top = 0; bot = rows - 1; wrapNext = false; attr = PLAIN; saved = null;
      tabs = new Set(); for (let i = 8; i < 400; i += 8) tabs.add(i);
      charset = ["B", "B"]; g = 0;
      modes = { autowrap: true, appCursor: false, cursor: true, bracketedPaste: false, insert: false, origin: false };
      api.modes = modes;
      backEl.replaceChildren(); backLines = 0; pendingBack = [];
      dirtyAll();
    }
    const eraseLook = () => (attr.bg === -1 ? PLAIN : look(-1, attr.bg, 0));
    function dirtyAll() { for (const r of main) r.dirty = true; if (alt) for (const r of alt) r.dirty = true; schedule(); }
    const mark = (r) => { if (buf[r]) buf[r].dirty = true; };

    // ---- Moving and scrolling ----
    let pendingBack = [];
    // (keep: a line pushed off the top by new output goes up into what scrolled off; deleted lines don't)
    function scrollUp(n = 1, t = top, b = bot, keep = false) {
      for (let i = 0; i < n; i++) {
        const gone = buf.splice(t, 1)[0];
        if (keep && buf === main && t === 0) pendingBack.push(gone);
        buf.splice(b, 0, blank(eraseLook()));
      }
      for (let r = t; r <= b; r++) mark(r);
    }
    function scrollDown(n = 1, t = top, b = bot) {
      for (let i = 0; i < n; i++) { buf.splice(b, 1); buf.splice(t, 0, blank(eraseLook())); }
      for (let r = t; r <= b; r++) mark(r);
    }
    function lineFeed() {
      wrapNext = false;
      if (y === bot) scrollUp(1, top, bot, true);
      else if (y < rows - 1) { mark(y); y++; mark(y); }
    }
    const clampX = () => { x = Math.max(0, Math.min(cols - 1, x)); };
    function moveTo(r, c) {
      mark(y);
      const t0 = modes.origin ? top : 0, b0 = modes.origin ? bot : rows - 1;
      y = Math.max(t0, Math.min(b0, r + t0)); x = c; clampX(); wrapNext = false;
      mark(y);
    }
    function erase(row, from, to) {
      const r = buf[row];
      if (!r) return;
      const a = eraseLook();
      for (let i = Math.max(0, from); i < Math.min(cols, to); i++) { r.ch[i] = " "; r.at[i] = a; }
      r.dirty = true;
    }

    // ---- Writing letters ----
    function put(ch) {
      if (charset[g] === "0" && LINES[ch]) ch = LINES[ch];
      if (ZERO.test(ch)) {
        const r = buf[y];
        let i = wrapNext ? x : x - 1;
        if (!r || i < 0) return;
        if (r.ch[i] === "" && i > 0) i--;
        r.ch[i] += ch; r.dirty = true;
        return;
      }
      const w = WIDE.test(ch) ? 2 : 1;
      if (wrapNext && modes.autowrap) { x = 0; lineFeed(); }
      wrapNext = false;
      if (w === 2 && x === cols - 1) {
        if (modes.autowrap) { erase(y, x, x + 1); x = 0; lineFeed(); } else return;
      }
      const r = buf[y];
      if (modes.insert) { for (let i = 0; i < w; i++) { r.ch.splice(x, 0, " "); r.at.splice(x, 0, attr); r.ch.length = cols; r.at.length = cols; } }
      // (writing over half of a wide letter clears its other half)
      if (r.ch[x] === "" && x > 0) r.ch[x - 1] = " ";
      if (w === 1 && r.ch[x + 1] === "") r.ch[x + 1] = " ";
      r.ch[x] = ch; r.at[x] = attr;
      if (w === 2) { r.ch[x + 1] = ""; r.at[x + 1] = attr; }
      r.dirty = true;
      if (x + w > cols - 1) { x = cols - 1; wrapNext = true; } else x += w;
    }

    // ---- Colours and styles ----
    function sgr(params) {
      let { fg, bg, fl } = attr;
      const list = params === "" ? [""] : params.split(";");
      const color = (sub, i, arr) => {
        // 38;5;n  38;2;r;g;b  (and the colon forms 38:5:n, 38:2::r:g:b)
        if (Number(arr[i + 1]) === 5) return [Math.min(255, Number(arr[i + 2]) || 0), 2];
        if (Number(arr[i + 1]) === 2) {
          const rest = arr.slice(i + 2).map(Number);
          const v = sub && rest.length >= 4 ? rest.slice(1, 4) : rest.slice(0, 3);
          return [`rgb(${v.map((n) => Math.max(0, Math.min(255, n || 0))).join(",")})`, sub ? arr.length : 4];
        }
        return [null, 0];
      };
      for (let i = 0; i < list.length; i++) {
        const seg = list[i];
        if (seg.includes(":")) {
          const sub = seg.split(":");
          const n = Number(sub[0]);
          if (n === 38 || n === 48) { const [c] = color(true, 0, sub); if (c !== null) (n === 38 ? (fg = c) : (bg = c)); }
          else if (n === 4) fl = Number(sub[1]) ? fl | UNDER : fl & ~UNDER;
          continue;
        }
        const n = seg === "" ? 0 : Number(seg);
        if (n === 0) { fg = -1; bg = -1; fl = 0; }
        else if (n === 1) fl |= BOLD; else if (n === 2) fl |= DIM; else if (n === 3) fl |= ITALIC; else if (n === 4) fl |= UNDER;
        else if (n === 7) fl |= INVERSE; else if (n === 8) fl |= HIDDEN; else if (n === 9) fl |= STRIKE;
        else if (n === 21 || n === 22) fl &= ~(BOLD | DIM); else if (n === 23) fl &= ~ITALIC; else if (n === 24) fl &= ~UNDER;
        else if (n === 27) fl &= ~INVERSE; else if (n === 28) fl &= ~HIDDEN; else if (n === 29) fl &= ~STRIKE;
        else if (n >= 30 && n <= 37) fg = n - 30; else if (n === 39) fg = -1;
        else if (n >= 40 && n <= 47) bg = n - 40; else if (n === 49) bg = -1;
        else if (n >= 90 && n <= 97) fg = n - 82; else if (n >= 100 && n <= 107) bg = n - 92;
        else if (n === 38 || n === 48) {
          const [c, used] = color(false, i, list);
          if (c !== null) { if (n === 38) fg = c; else bg = c; i += used; }
        }
      }
      attr = look(fg, bg, fl);
    }

    // ---- Modes ----
    function setMode(priv, params, on) {
      for (const p of params.split(";").map(Number)) {
        if (!priv) { if (p === 4) modes.insert = on; continue; }
        if (p === 1) modes.appCursor = on;
        else if (p === 6) { modes.origin = on; moveTo(0, 0); }
        else if (p === 7) modes.autowrap = on;
        else if (p === 25) { modes.cursor = on; mark(y); }
        else if (p === 2004) modes.bracketedPaste = on;
        else if (p === 47 || p === 1047 || p === 1049) {
          if (on && !alt) {
            if (p === 1049) saved = { x, y, attr, charset: [...charset], g };
            alt = Array.from({ length: rows }, () => blank());
            buf = alt; el.classList.add("ct-alt");
            dirtyAll();
          } else if (!on && alt) {
            alt = null; buf = main; el.classList.remove("ct-alt");
            if (p === 1049 && saved) ({ x, y, attr, g } = saved), (charset = saved.charset);
            dirtyAll();
          }
        }
      }
    }

    // ---- Reading what the program printed ----
    let state = 0, params = "", inter = "", priv = "", str = "", esc2 = "";
    const GROUND = 0, ESC = 1, CSI = 2, OSC = 3, SKIP = 4, CHARSET = 5, HASH = 6;
    function csi(final) {
      const p = params;
      const nums = p.split(";").map((v) => Number(v) || 0);
      const n = (i = 0, d = 1) => nums[i] || d;
      if (inter) return; // (DECSCUSR " q" and the like: nothing to draw)
      if (priv === ">" || priv === "=") { if (final === "c") reply("\x1b[>0;10;1c"); return; }
      switch (final) {
        case "@": { const r = buf[y]; const k = Math.min(n(), cols - x); r.ch.splice(x, 0, ...Array(k).fill(" ")); r.at.splice(x, 0, ...Array(k).fill(eraseLook())); r.ch.length = cols; r.at.length = cols; r.dirty = true; break; }
        case "A": mark(y); y = Math.max(y >= top ? top : 0, y - n()); wrapNext = false; mark(y); break;
        case "B": case "e": mark(y); y = Math.min(y <= bot ? bot : rows - 1, y + n()); wrapNext = false; mark(y); break;
        case "C": case "a": x += n(); clampX(); wrapNext = false; mark(y); break;
        case "D": x -= n(); clampX(); wrapNext = false; mark(y); break;
        case "E": mark(y); y = Math.min(bot, y + n()); x = 0; wrapNext = false; mark(y); break;
        case "F": mark(y); y = Math.max(top, y - n()); x = 0; wrapNext = false; mark(y); break;
        case "G": case "`": x = n() - 1; clampX(); wrapNext = false; mark(y); break;
        case "H": case "f": moveTo(n(0) - 1, n(1) - 1); break;
        case "I": for (let i = 0; i < n(); i++) { do x++; while (x < cols - 1 && !tabs.has(x)); } clampX(); mark(y); break;
        case "Z": for (let i = 0; i < n(); i++) { do x--; while (x > 0 && !tabs.has(x)); } clampX(); mark(y); break;
        case "J": {
          const m = nums[0] || 0;
          if (m === 0) { erase(y, x, cols); for (let r = y + 1; r < rows; r++) erase(r, 0, cols); }
          else if (m === 1) { erase(y, 0, x + 1); for (let r = 0; r < y; r++) erase(r, 0, cols); }
          else if (m === 2) for (let r = 0; r < rows; r++) erase(r, 0, cols);
          else if (m === 3 && buf === main) { backEl.replaceChildren(); backLines = 0; pendingBack = []; }
          break;
        }
        case "K": { const m = nums[0] || 0; if (m === 0) erase(y, x, cols); else if (m === 1) erase(y, 0, x + 1); else erase(y, 0, cols); break; }
        case "L": if (y >= top && y <= bot) scrollDown(n(), y, bot); break;
        case "M": if (y >= top && y <= bot) scrollUp(n(), y, bot); break;
        case "P": { const r = buf[y]; const k = Math.min(n(), cols - x); r.ch.splice(x, k); r.at.splice(x, k); while (r.ch.length < cols) { r.ch.push(" "); r.at.push(eraseLook()); } r.dirty = true; break; }
        case "S": scrollUp(n()); break;
        case "T": if (!p.includes(";")) scrollDown(n()); break;
        case "X": erase(y, x, x + n()); break;
        case "b": { const r = buf[y]; const last = x > 0 ? r.ch[x - 1] : " "; for (let i = 0; i < n(); i++) put(last); break; }
        case "c": if (!priv) reply("\x1b[?1;2c"); break;
        case "d": moveTo(n() - 1 - (modes.origin ? top : 0), x); break;
        case "g": if ((nums[0] || 0) === 0) tabs.delete(x); else if (nums[0] === 3) tabs.clear(); break;
        case "h": setMode(priv === "?", p, true); break;
        case "l": setMode(priv === "?", p, false); break;
        case "m": if (!priv) sgr(p); break;
        case "n": if (nums[0] === 5) reply("\x1b[0n"); else if (nums[0] === 6) reply(`\x1b[${y + 1};${x + 1}R`); break;
        case "r": if (!priv) { const t0 = n(0) - 1, b0 = (nums[1] || rows) - 1; if (t0 < b0 && b0 < rows) { top = t0; bot = b0; } moveTo(0, 0); } break;
        case "s": if (!priv) saved = { x, y, attr, charset: [...charset], g }; break;
        case "u": if (!priv && saved) { mark(y); ({ x, y, attr, g } = saved); charset = [...saved.charset]; wrapNext = false; mark(y); } break;
        default: break;
      }
    }
    function escFinal(ch) {
      switch (ch) {
        case "7": saved = { x, y, attr, charset: [...charset], g }; break;
        case "8": if (saved) { mark(y); ({ x, y, attr, g } = saved); charset = [...saved.charset]; wrapNext = false; mark(y); } break;
        case "D": lineFeed(); break;
        case "E": x = 0; lineFeed(); break;
        case "H": tabs.add(x); break;
        case "M": wrapNext = false; if (y === top) scrollDown(1); else if (y > 0) { mark(y); y--; mark(y); } break;
        case "c": init(); break;
        default: break; // (= > keypad modes, and the rest: nothing to draw)
      }
    }
    function feed(text) {
      for (const ch of text) {
        const c = ch.codePointAt(0);
        if (state === OSC || state === SKIP) {
          // (a title or other string: until BEL or ESC \)
          if (c === 7) { state = GROUND; str = ""; }
          else if (c === 0x1b) esc2 = "\x1b";
          else if (esc2 && ch === "\\") { state = GROUND; str = ""; esc2 = ""; }
          else { esc2 = ""; if (str.length < 4096) str += ch; }
          continue;
        }
        if (c === 0x1b) { state = ESC; params = ""; inter = ""; priv = ""; continue; }
        if (c < 0x20 || c === 0x7f) {
          // Control letters work anywhere, even inside a sequence
          if (c === 0x0d) { x = 0; wrapNext = false; mark(y); }
          else if (c === 0x0a || c === 0x0b || c === 0x0c) lineFeed();
          else if (c === 0x08) { if (wrapNext) wrapNext = false; else if (x > 0) x--; mark(y); }
          else if (c === 0x09) { do x++; while (x < cols - 1 && !tabs.has(x)); clampX(); mark(y); }
          else if (c === 0x0e) g = 1; else if (c === 0x0f) g = 0;
          else if (c === 0x18 || c === 0x1a) state = GROUND;
          continue;
        }
        if (state === GROUND) { if (c < 0x80 || c > 0x9f) put(ch); continue; }
        if (state === ESC) {
          if (ch === "[") state = CSI;
          else if (ch === "]") { state = OSC; str = ""; }
          else if (ch === "P" || ch === "_" || ch === "^" || ch === "X") { state = SKIP; str = ""; }
          else if (ch === "(" || ch === ")" || ch === "*" || ch === "+") { state = CHARSET; inter = ch; }
          else if (ch === "#") state = HASH;
          else { state = GROUND; escFinal(ch); }
          continue;
        }
        if (state === CHARSET) { if (inter === "(") charset[0] = ch; else if (inter === ")") charset[1] = ch; state = GROUND; continue; }
        if (state === HASH) { state = GROUND; continue; }
        if (state === CSI) {
          if (c >= 0x30 && c <= 0x3f) { if ("?>=<".includes(ch) && !params) priv = ch; else params += ch; }
          else if (c >= 0x20 && c <= 0x2f) inter += ch;
          else if (c >= 0x40 && c <= 0x7e) { state = GROUND; csi(ch); }
          else state = GROUND;
        }
      }
    }

    // ---- Drawing: only the rows that changed, once a frame ----
    function lineHtml(r, curAt = -1, trim = false) {
      let end = cols;
      if (trim) while (end > 0 && r.ch[end - 1] === " " && r.at[end - 1].bg === -1 && !(r.at[end - 1].fl & (INVERSE | UNDER))) end--;
      if (curAt >= end) end = Math.min(cols, curAt + 1);
      let out = "", run = "", key = null, a0 = null, cur = false;
      const flush = () => {
        if (!run) return;
        out += span(a0, run, cur);
        run = "";
      };
      for (let i = 0; i < end; i++) {
        const ch = r.ch[i];
        if (ch === "") continue;
        const a = r.at[i], isCur = i === curAt;
        if (a.k !== key || isCur || cur) { flush(); key = a.k; a0 = a; cur = isCur; }
        run += ch;
      }
      flush();
      return out;
    }
    function span(a, text, cur) {
      if (a === PLAIN && !cur) return html(text);
      let { fg, bg } = a;
      const fl = a.fl;
      if (fl & BOLD && typeof fg === "number" && fg >= 0 && fg < 8) fg += 8;
      if (fl & INVERSE) [fg, bg] = [bg === -1 ? "inv-bg" : bg, fg === -1 ? "inv-fg" : fg];
      const cls = [], data = [];
      if (fg === "inv-bg") cls.push("ct-fi"); else if (typeof fg === "number" && fg >= 0) (fg < 16 ? cls.push(`ct-f${fg}`) : data.push(`data-fg="${rgb256(fg)}"`)); else if (typeof fg === "string") data.push(`data-fg="${fg}"`);
      if (bg === "inv-fg") cls.push("ct-bi"); else if (typeof bg === "number" && bg >= 0) (bg < 16 ? cls.push(`ct-b${bg}`) : data.push(`data-bg="${rgb256(bg)}"`)); else if (typeof bg === "string") data.push(`data-bg="${bg}"`);
      if (fl & BOLD) cls.push("ct-bo"); if (fl & DIM) cls.push("ct-di"); if (fl & ITALIC) cls.push("ct-it");
      if (fl & UNDER) cls.push("ct-un"); if (fl & STRIKE) cls.push("ct-st"); if (fl & HIDDEN) cls.push("ct-hi");
      if (cur) cls.push(focused ? "ct-cur" : "ct-cur ct-cur-off");
      return `<span${cls.length ? ` class="${cls.join(" ")}"` : ""}${data.length ? ` ${data.join(" ")}` : ""}>${html(text)}</span>`;
    }
    // (made-up colours, set the way the page's rules allow)
    const colour = (root) => { for (const s of root.querySelectorAll("[data-fg],[data-bg]")) { if (s.dataset.fg) s.style.setProperty("color", s.dataset.fg); if (s.dataset.bg) s.style.setProperty("background-color", s.dataset.bg); s.removeAttribute("data-fg"); s.removeAttribute("data-bg"); } };
    let frame = 0, rowEls = [];
    function schedule() { if (!frame) frame = requestAnimationFrame(draw); }
    function draw() {
      frame = 0;
      if (pendingBack.length) {
        const add = pendingBack.map((r) => `<div class="ct-line">${lineHtml(r, -1, true) || " "}</div>`).join("");
        pendingBack = [];
        backEl.insertAdjacentHTML("beforeend", add);
        colour(backEl);
        backLines = backEl.childElementCount;
        while (backLines > BACK_MAX) { backEl.firstElementChild.remove(); backLines--; }
      }
      if (rowEls.length !== rows) {
        screenEl.replaceChildren(...Array.from({ length: rows }, () => Object.assign(document.createElement("div"), { className: "ct-row" })));
        rowEls = [...screenEl.children];
        for (const r of buf) r.dirty = true;
      }
      for (let i = 0; i < rows; i++) {
        const r = buf[i];
        if (!r || !r.dirty) continue;
        r.dirty = false;
        rowEls[i].innerHTML = lineHtml(r, modes.cursor && i === y ? x : -1, true);
        colour(rowEls[i]);
      }
      opts.drawn && opts.drawn();
    }

    // Long output in pieces, so the page never freezes (ns CLAUDE.md 2e: no task over 300 ms)
    let queue = [], working = false;
    function pump() {
      const t0 = performance.now();
      while (queue.length && performance.now() - t0 < 12) feed(queue.shift());
      schedule();
      if (queue.length) setTimeout(pump, 0);
      else working = false;
    }
    const api = {
      cols, rows, modes: null,
      write(text) {
        const s = String(text || "");
        for (let i = 0; i < s.length; i += 8192) queue.push(s.slice(i, i + 8192));
        if (!working) { working = true; pump(); }
      },
      reset() { queue = []; state = GROUND; init(); },
      focus(on) { focused = !!on; mark(y); schedule(); },
      resize(c, r) {
        c = Math.max(10, Math.min(400, c | 0)); r = Math.max(4, Math.min(200, r | 0));
        if (c === cols && r === rows) return;
        for (const b of [main, alt]) {
          if (!b) continue;
          for (const row of b) {
            if (c < cols) { row.ch.length = c; row.at.length = c; if (row.ch[c - 1] && WIDE.test(row.ch[c - 1])) row.ch[c - 1] = " "; }
            else while (row.ch.length < c) { row.ch.push(" "); row.at.push(PLAIN); }
          }
        }
        cols = c;
        // (fewer rows: the top ones go up into what scrolled off, so the cursor stays on screen)
        if (r < rows) {
          const off = Math.max(0, y - (r - 1));
          const gone = main.splice(0, buf === main ? off : 0);
          pendingBack.push(...gone);
          main.length = Math.min(main.length, r);
          if (alt) { alt.splice(0, buf === alt ? off : 0); alt.length = Math.min(alt.length, r); }
          y -= off;
        }
        for (const b of [main, alt]) if (b) while (b.length < r) b.push(blank());
        rows = r; top = 0; bot = rows - 1; wrapNext = false; clampX();
        api.cols = cols; api.rows = rows;
        rowEls = [];
        dirtyAll();
      },
      dispose() { cancelAnimationFrame(frame); queue = []; el.replaceChildren(); },
    };
    init();
    return api;
  };
})();
