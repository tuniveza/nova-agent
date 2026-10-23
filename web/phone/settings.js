// Nova Phone: Settings (Nova Desk's settings, Panels window and status line, and Portal's Options, made for the
// phone: agent-shell.md 47-80, portal.md G4, G8-G11). One screen, the page scrolls:
//   the status line (version and build, what's new for where you were, here since, last left, the date and time;
//   Lately and your visits a tap away), settings for the place you were in, the look (every theme of Nova Desk's,
//   Custom from one hue, colour from my planet, text size, animations, the starfield), sounds, music (on or off,
//   volume, the same music for a visit, a day, a week or always, its variation code), where Nova Phone opens, the
//   battery saver, voice commands, the places you've been, and Refresh everything, Install, Apps and links, Reset.
//   #settings/status  Lately, your visits, what's new everywhere
//   #settings/links   Apps and links (Nova Desk's All links, with the live check, what's changed, what it can do)
//   #settings/install Install Nova Phone, or remove it from this phone
// Theme, sounds, music, text size, animations, starfield and battery saver are the same settings as Nova Desk's
// (nova-look, nova-sfx, nova-music, nova-options), so both apps agree on one device.
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, row, list, field, toggle, choices, empty, api, toast, confirm } = N;
  const read = (k) => { try { return localStorage.getItem(k); } catch (err) { return null; } };
  const write = (k, v) => { try { localStorage.setItem(k, v); } catch (err) {} };
  const json = (k, d) => { try { return JSON.parse(read(k)) ?? d; } catch (err) { return d; } };
  const UK = { timeZone: "Europe/London" };
  const time12 = (d) => d.toLocaleTimeString("en-GB", { ...UK, hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s?([ap]m)$/i, (m, x) => " " + x.toLowerCase());
  const sameDay = (a, b) => a.toLocaleDateString("en-GB", UK) === b.toLocaleDateString("en-GB", UK);
  const when = (t) => { const d = new Date(t); return sameDay(d, new Date()) ? time12(d) : `${d.toLocaleDateString("en-GB", { ...UK, weekday: "short" })} ${time12(d)}`; };
  const opts = () => (window.NovaOptions ? window.NovaOptions.get() : { size: "normal", motion: true, stars: true, volume: 40, saver: "auto" });
  const setOpt = (o) => window.NovaOptions && window.NovaOptions.set(o);
  // The part of Nova Desk's "What's new" for each place (status-data.js names Nova Desk's panels)
  const PANEL = { agent: "chat", today: "portal", inbox: "portal", clients: "portal", outreach: "portal", you: "portal", crew: "portal", google: "portal", tests: "portal", money: "portal", calendar: "calendar", notes: "notes", board: "board", console: "console", index: "index", quests: "quests", lossless: "lossless", visualizer: "visualizer", observatory: "observatory", help: "manual" };
  // Settings that belong to one place, for "For the place you were in"
  const OWN = { agent: ["#agent/rhythm", "Your rhythm", "When your day starts and ends, for Agent's plan"], money: ["#money/settings", "Invoice settings", "The studio's details, bank, numbering, reminders"], inbox: ["#inbox/saved", "Saved replies", "Answers you send often"], today: ["#inbox/saved", "Saved replies", "Answers you send often"] };
  const status = () => (window.NOVA_STATUS ? Promise.resolve(window.NOVA_STATUS) : N.script(N.asset("/shared/status-data.js")).then(() => window.NOVA_STATUS).catch(() => null));
  const amb = () => (window.NovaAmbient && window.NovaAmbient.seed ? window.NovaAmbient : null);
  const loadMusic = () => (amb() ? Promise.resolve(amb()) : N.script(N.asset("/shared/ambient.js")).then(amb));
  // Where you were before Settings (the newest place that isn't Settings or More)
  const before = () => N.history().find((h) => !/^(settings|more)(\/|$)/.test(h.to)) || null;
  const placeName = (h) => (h ? h.title || h.to : "");
  const sessions = () => (window.NovaPhoneShell ? window.NovaPhoneShell.sessions() : json("nova-phone-sessions", []));
  const hereSince = () => (window.NovaPhoneShell ? window.NovaPhoneShell.here() : (sessions().slice(-1)[0] || {}).on);
  const lastLeft = () => (window.NovaPhoneShell ? window.NovaPhoneShell.lastLeft() : (sessions().slice(-2)[0] || {}).off);

  let clock = 0;
  N.section({
    id: "settings",
    name: "Settings",
    async draw(box, [part], ui) {
      await N.css("settings.css");
      clearInterval(clock);
      if (part === "status") return drawStatus(box, ui);
      if (part === "links") return drawLinks(box, ui);
      if (part === "install") return drawInstall(box, ui);
      ui.back("#more");
      const [data, themes] = await Promise.all([status(), N.look ? N.look.list().catch(() => N.look.base) : Promise.resolve([])]);
      const o = opts(), look = N.look ? N.look.get() : { theme: "novacane", planet: false };
      const was = before(), news = data && was ? (data.panels[PANEL[was.to.split("/")[0]] || "chat"] || []).slice(0, 2) : [];
      const own = was && OWN[was.to.split("/")[0]];
      const left = lastLeft();
      const sfxOn = read("nova-sfx") !== "off", extraOn = read("nova-sfx-extra") === "on";
      const musicOn = read("nova-music") === "on";
      const keepMode = (() => { if (read("nova-music-seed")) return "always"; const r = json("nova-music-keep", null); return r && ["day", "week"].includes(r.mode) ? r.mode : "visit"; })();
      const canVoice = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
      const recent = N.history().filter((h) => !/^(settings|more)(\/|$)/.test(h.to)).slice(0, 8);
      const saverNow = document.documentElement.classList.contains("nova-saver");
      box.innerHTML = `
        <div class="card settings-status" data-s-status>
          <p class="settings-line">${data ? `<span>${icon("star")}v${esc(data.version)} · build ${esc(data.build)}</span>` : ""}<span>${icon("out")}Here since ${esc(time12(new Date(hereSince() || Date.now())))}</span>${left ? `<span>${icon("moon")}Last left ${esc(when(left))}</span>` : ""}<span data-s-clock>${icon("clock")}${esc(clockText())}</span></p>
          ${news.length ? `<p class="settings-news"><b>What's new${was ? ` in ${esc(placeName(was))}` : ""}:</b> ${news.map(esc).join(" · ")}</p>` : ""}
          <a class="btn quiet settings-more" href="#settings/status">Lately and your visits ${icon("next")}</a>
        </div>
        ${was ? `<h3 class="h">For ${esc(placeName(was))}</h3>${list([...(own ? [row({ href: own[0], lead: icon("cog"), title: own[1], text: own[2] })] : []), ...(N.has("help") && !was.to.startsWith("help") ? [row({ href: `#help/for/${encodeURIComponent(was.to.split("/")[0])}`, lead: icon("book"), title: `Help for ${placeName(was)}`, text: "How it works, in the Manual" })] : [])])}` : ""}

        <h3 class="h">Look</h3>
        <div class="card settings-look">
          <p class="small muted">One theme for Nova Phone and Nova Desk on this phone.</p>
          <div class="settings-orbs" role="radiogroup" aria-label="Theme">${themes.filter((t) => t.id !== "custom").map((t) => orb(t, look)).join("")}</div>
          ${themes.some((t) => t.id === "custom") ? `<div class="settings-custom">${orb(themes.find((t) => t.id === "custom"), look)}<div class="settings-sliders">
            <label class="settings-slider"><span>Hue</span><input type="range" min="0" max="359" step="1" name="hue" data-sfx="none" aria-label="Custom theme: hue"></label>
            <label class="settings-slider"><span>Vividness</span><input type="range" min="0" max="100" step="1" name="vivid" data-sfx="none" aria-label="Custom theme: vividness"></label></div></div>` : ""}
          ${toggle({ label: "Colour everything from my planet", name: "planet", checked: look.planet })}
        </div>
        ${choices({ label: "Text size", name: "size", value: o.size === "large" ? "large" : "normal", options: [["normal", "Normal"], ["large", "Large"]] })}
        <div class="btns settings-switches">${toggle({ label: "Animations", name: "motion", checked: o.motion !== false })}${toggle({ label: "Starfield", name: "stars", checked: o.stars !== false })}</div>

        <h3 class="h">Sound</h3>
        <div class="btns settings-switches">
          ${toggle({ label: "Sound effects", name: "sfx", checked: sfxOn })}
          ${toggle({ label: "Quiet extras", name: "extra", checked: extraOn })}
        </div>
        <p class="small muted settings-hint">Calm tones when something's saved, sent, deleted or goes wrong, each place in its own colour. The extras: a sheet opening and closing, a switch.</p>

        <h3 class="h">Music</h3>
        <div class="card settings-music">
          ${toggle({ label: "Background music", name: "music", checked: musicOn })}
          <label class="settings-slider settings-volume"><span>Volume <output data-s-vol>${Number(o.volume ?? 40)}</output></span><input type="range" min="0" max="100" step="1" name="volume" value="${Number(o.volume ?? 40)}" data-sfx="none" aria-label="Music volume"></label>
          ${choices({ label: "The same music for each", name: "keep", value: keepMode, options: [["visit", "Visit"], ["day", "Day"], ["week", "Week"], ["always", "Always"]] })}
          <div class="settings-seed"><span class="small muted">This variation</span><b data-s-seed>—</b><span class="small muted" data-s-piece></span></div>
          <div class="btns two"><button type="button" class="btn" data-s="newseed">✦ New variation</button></div>
          <form class="settings-code" data-s-code>${field({ label: "Play a variation again", name: "code", placeholder: "e.g. K7M2QX", attrs: 'autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="12"' })}<button type="submit" class="btn wide">${icon("play")} Play it</button></form>
          <p class="small muted" data-s-music-note></p>
        </div>
        ${list([row({ href: "#music", lead: icon("music"), title: "Today in music", text: "The Top 10, genres, budget gear, the song of the day, a quote" })])}

        <h3 class="h">Opening</h3>
        ${choices({ label: "Nova Phone opens on", name: "start", value: N.options().start, options: [["last", "Where I left off"], ["today", "Today"]] })}

        <h3 class="h">Battery</h3>
        ${choices({ label: "Battery saver", name: "saver", value: o.saver || "auto", options: [["auto", "Auto"], ["on", "On"], ["off", "Off"]] })}
        <p class="small muted settings-hint" data-s-saver>${saverNow ? "On now" : "Off now"}: the starfield rests and the tiles' numbers are checked every 15 minutes instead of 5. Auto: on when the battery is low, data saver is on or the phone asks for less motion.</p>

        ${canVoice ? `<h3 class="h">Voice</h3><button type="button" class="btn wide" data-s="voice">${icon("mic")} Say what to do</button>` : ""}

        ${recent.length ? `<h3 class="h">Recent places</h3>${list(recent.map((h) => row({ href: `#${h.to}`, lead: h.tile && window.NovaTile ? window.NovaTile(h.tile) : icon("clock"), title: h.title || h.to, end: esc(when(h.t)) })))}` : ""}

        <h3 class="h">Nova Phone</h3>
        <button type="button" class="btn main wide" data-s="refresh">${icon("refresh")} Refresh everything</button>
        ${list([
          row({ href: "#settings/install", lead: icon("download"), title: "Install or remove Nova Phone", text: "On your Home Screen, full screen, with notifications" }),
          row({ href: "#settings/links", lead: icon("link"), title: "Apps and links", text: "Every place, every address and its check, what's changed" }),
          row({ href: "#help", lead: icon("book"), title: "Manual", text: "How everything works" }),
        ])}
        <button type="button" class="btn quiet wide" data-s="reset">Reset these settings</button>`;
      for (const b of box.querySelectorAll("[data-orb]")) paintOrb(b.querySelector(".settings-orb-dot"), themes.find((t) => t.id === b.dataset.orb)?.palette);
      wire(box);
      // (the clock, once a minute, only while Settings is on screen)
      clock = setInterval(() => {
        const c = box.querySelector("[data-s-clock]");
        if (!c || !c.isConnected) return clearInterval(clock);
        if (!document.hidden) c.innerHTML = `${icon("clock")}${esc(clockText())}`;
      }, 30000);
      if (canVoice) N.script("voice.js").catch(() => {});
    },
  });
  const clockText = () => `${new Date().toLocaleDateString("en-GB", { ...UK, weekday: "short", day: "numeric", month: "short" })} · ${time12(new Date())}`;
  addEventListener("hashchange", () => { if (!location.hash.startsWith("#settings")) clearInterval(clock); });

  // ---- The theme picker: round orbs in each theme's colours, its name under it ----
  const orb = (t, look) => `<button type="button" class="settings-orb" role="radio" data-orb="${esc(t.id)}" aria-checked="${t.id === (look.theme || "")}" aria-label="${esc(t.name)}${t.tag ? `: ${esc(t.tag)}` : ""}"><span class="settings-orb-dot" aria-hidden="true"></span><span class="settings-orb-name">${esc(t.name)}</span></button>`;
  function paintOrb(el, p) {
    if (!el || !p) return;
    el.style.setProperty("--oa", p.accent); el.style.setProperty("--ob", p.hi); el.style.setProperty("--oc", p.accent3); el.style.setProperty("--od", p.void);
  }
  function markOrbs(box) {
    const { theme } = N.look.get();
    for (const b of box.querySelectorAll("[data-orb]")) b.setAttribute("aria-checked", String(b.dataset.orb === theme));
  }

  // ---- Every control on the screen ----
  function wire(box) {
    const look = N.look;
    box.addEventListener("click", async (e) => {
      const o = e.target.closest("[data-orb]");
      if (o && look) {
        look.set(o.dataset.orb);
        markOrbs(box);
        N.sound("theme");
        N.activity(`Theme: ${look.name(o.dataset.orb)}`);
        return;
      }
      const b = e.target.closest("[data-s]");
      if (!b) return;
      const what = b.dataset.s;
      if (what === "refresh") return N.busy(b, "Refreshing…", () => N.refresh());
      if (what === "voice") return N.voice();
      if (what === "newseed") { const a = await loadMusic(); if (a) { a.newSeed(); showMusic(box); toast(`A new variation: ${a.seed()}`); } return; }
      if (what === "reset") {
        if (!(await confirm({ title: "Reset these settings?", text: "Text size, animations, starfield, battery saver, sounds, music volume and where Nova Phone opens go back to how they started. Your theme stays.", ok: "Reset" }))) return;
        setOpt({ size: "normal", motion: true, stars: true, saver: "auto", volume: 40 });
        write("nova-sfx", "on"); write("nova-sfx-extra", "off");
        if (window.NovaPhoneSound) window.dispatchEvent(new CustomEvent("novasfxchange", { detail: { on: true } }));
        amb() && amb().setVolume(0.4);
        N.setOption("start", "last");
        toast("Settings reset");
        return N.show();
      }
    });
    box.addEventListener("change", async (e) => {
      const t = e.target;
      const n = t.name;
      if (n === "planet" && look) { look.setPlanet(t.checked); N.activity(t.checked ? "Planet colours" : "Planet colours off"); return; }
      if (n === "size") return setOpt({ size: t.value });
      if (n === "motion") return setOpt({ motion: t.checked });
      if (n === "stars") return setOpt({ stars: t.checked });
      if (n === "saver") { setOpt({ saver: t.value }); const on = window.NovaPhoneShell ? window.NovaPhoneShell.saver() : false; const s = box.querySelector("[data-s-saver]"); if (s) s.firstChild.textContent = on ? "On now" : "Off now"; return; }
      if (n === "start") { N.setOption("start", t.value); return toast(t.value === "last" ? "Nova Phone opens where you left off" : "Nova Phone opens on Today"); }
      if (n === "sfx") {
        const s = window.NovaPhoneSound || (t.checked ? await N.script("sound.js").then(() => window.NovaPhoneSound).catch(() => null) : null);
        if (s) s.setEnabled(t.checked); else { write("nova-sfx", t.checked ? "on" : "off"); window.dispatchEvent(new CustomEvent("novasfxchange", { detail: { on: t.checked } })); }
        return;
      }
      if (n === "extra") {
        const s = window.NovaPhoneSound || (await N.script("sound.js").then(() => window.NovaPhoneSound).catch(() => null));
        if (s) s.setExtra(t.checked); else write("nova-sfx-extra", t.checked ? "on" : "off");
        if (t.checked && read("nova-sfx") === "off") toast("Quiet extras play once Sound effects are on too");
        return;
      }
      if (n === "music") {
        const note = box.querySelector("[data-s-music-note]");
        if (!t.checked) { write("nova-music", "off"); if (amb()) amb().stop(); showMusic(box); return; }
        write("nova-music", "on");
        if (note) note.textContent = "Starting…";
        const a = await loadMusic().catch(() => null);
        if (!a) { if (note) note.textContent = "The music didn't load. Check the connection and try again."; return; }
        a.setVolume((opts().volume ?? 40) / 100);
        await a.start();
        showMusic(box);
        return;
      }
      if (n === "keep") { const a = await loadMusic().catch(() => null); if (a) { a.keepFor(t.value); showMusic(box); } return; }
    });
    // Sliders as they move: the Custom colour (chooses Custom) and the music's volume
    let frame = 0;
    box.addEventListener("input", (e) => {
      const t = e.target;
      if (t.name === "volume") {
        box.querySelector("[data-s-vol]").textContent = t.value;
        setOpt({ volume: Number(t.value) });
        if (amb()) amb().setVolume(Number(t.value) / 100);
        return;
      }
      if ((t.name === "hue" || t.name === "vivid") && look && !frame) {
        frame = requestAnimationFrame(async () => {
          frame = 0;
          const c = await look.setCustom({ hue: box.querySelector('[name="hue"]').value, vivid: box.querySelector('[name="vivid"]').value });
          if (look.get().theme !== "custom") look.set("custom");
          paintCustom(box, c);
          markOrbs(box);
        });
      }
    });
    box.querySelector("[data-s-code]").addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = e.target.elements.code.value.trim();
      if (!code) return;
      const a = await loadMusic().catch(() => null);
      if (!a) return toast("The music didn't load", true);
      const s = a.setSeed(code);
      e.target.elements.code.value = "";
      e.target.classList.remove("dirty");
      if (read("nova-music") !== "on") { await a.start(); }
      showMusic(box);
      toast(`Playing variation ${s}`);
    });
    // Custom's sliders where its colour is now
    if (window.NovaSpectrum) paintCustom(box, window.NovaSpectrum.getCustom(), true);
    showMusic(box);
    const follow = () => { if (box.isConnected) showMusic(box); };
    addEventListener("novaambientseed", follow);
    addEventListener("novaambientchange", follow);
  }
  function paintCustom(box, c, setValues) {
    const S = window.NovaSpectrum;
    if (!S || !c) return;
    const hue = box.querySelector('[name="hue"]'), vivid = box.querySelector('[name="vivid"]');
    if (!hue) return;
    if (setValues) { hue.value = String(c.hue); vivid.value = String(c.vivid); }
    const stops = [];
    for (let h = 0; h <= 360; h += 30) stops.push(S.fromHue(h, Math.max(c.vivid, 35)).accent);
    hue.style.setProperty("--track", `linear-gradient(90deg, ${stops.join(", ")})`);
    vivid.style.setProperty("--track", `linear-gradient(90deg, ${S.fromHue(c.hue, 0).accent}, ${S.fromHue(c.hue, 100).accent})`);
    paintOrb(box.querySelector('[data-orb="custom"] .settings-orb-dot'), S.custom(c));
  }
  function showMusic(box) {
    const a = amb(), seed = box.querySelector("[data-s-seed]"), piece = box.querySelector("[data-s-piece]"), note = box.querySelector("[data-s-music-note]");
    if (!seed) return;
    const s = a && a.seed();
    seed.textContent = s || read("nova-music-seed") || read("nova-music-last") || "—";
    const p = a && a.isPlaying() && a.piece();
    piece.textContent = p ? `Playing: ${p.name}` : "";
    const on = read("nova-music") === "on";
    const sw = box.querySelector('input[name="music"]');
    if (sw) sw.checked = on;
    if (note) note.textContent = on && a && !a.isPlaying() ? "Starts on your next tap (phones only play sound after a tap)." : a && a.pieces ? `Seven pieces take turns: ${a.pieces.map((x) => x.name).join(", ")}. A new variation each visit unless you keep it.` : "Made live on the phone, never the same twice: no files, nothing downloaded while it plays.";
  }

  // ---- #settings/status: Lately, your visits, what's new ----
  async function drawStatus(box, ui) {
    ui.title("Lately and your visits");
    ui.back("#settings");
    const data = await status();
    const act = N.activity().slice(0, 14), visits = sessions().slice(-6).reverse(), now = hereSince();
    const was = before(), part = was ? PANEL[was.to.split("/")[0]] || "chat" : "chat";
    box.innerHTML = `
      ${data ? `<div class="card"><p class="kicker">Nova</p><h2 class="card-title">Version ${esc(data.version)}, build ${esc(data.build)}</h2>${data.date ? `<p class="muted">Built ${esc(new Date(data.date + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }))}</p>` : ""}</div>` : ""}
      <h3 class="h">Lately</h3>
      ${act.length ? list(act.map((a) => row({ lead: icon("check"), title: a.text, text: a.where || "", end: esc(when(a.t)) }))) : empty({ icon: "clock", title: "Nothing yet", text: "What you save, send and change shows here." })}
      <h3 class="h">On and off</h3>
      ${list(visits.map((v) => row({ lead: icon("out"), title: `${new Date(v.on).toLocaleDateString("en-GB", { ...UK, weekday: "short", day: "numeric", month: "short" })} · ${time12(new Date(v.on))}`, end: v.on === now ? "now" : esc(time12(new Date(v.off))) })))}
      ${data ? `<h3 class="h">What's new${was ? ` in ${esc(placeName(was))}` : ""}</h3>${list((data.panels[part] || []).map((w) => row({ lead: icon("star"), title: w })))}
        <h3 class="h">What's new everywhere</h3>${list((data.everything || []).map((w) => row({ lead: icon("star"), title: w })))}` : ""}`;
  }

  // ---- #settings/links: Apps and links (Portal's suite.js) ----
  const KINDS = { live: "Live", machine: "Used by the apps", testing: "Testing", local: "Studio computer", planned: "Not set up yet" };
  const STATES = { up: ["●", "Up", "ok"], down: ["✕", "Down", "bad"], unchecked: ["○", "Not checked", ""] };
  // (Nova Desk's own pages aren't opened from Nova Phone: their addresses can be copied)
  const DESK = /^\/(agent|portal|invoicer|calendar|notes|board|quests|app|fixer|computer|observatory|console|lossless|visualizer|admin|missions)(\/|$|\?)/;
  const deskPage = (url) => { try { const u = new URL(url, location.origin); return u.origin === location.origin && DESK.test(u.pathname); } catch (err) { return false; } };
  async function drawLinks(box, ui, fresh = false) {
    ui.title("Apps and links");
    ui.back("#settings");
    ui.action({ icon: "refresh", label: "Check every address again", run: () => recheck(box) });
    const PLACES = [["today", "Portal", "portal", "Enquiries, conversations, bookings, alerts"], ["agent", "Agent", "chat", "The conversation with Nova Agent"], ["calendar", "Calendar", "calendar", "Note cards and day cards"], ["notes", "Notes", "notes", "Notes and documents"], ["board", "Board", "board", "Notes, pictures and links laid out"], ["index", "Index", "index", "Everything Nova Agent remembers"], ["money", "Invoicer", "invoicer", "Invoices at every stage, payments, expenses"], ["quests", "Quests", "quests", "Every quest, today first"], ["agent/missions", "Missions", "missions", "Your goals, planned into Quests"], ["fixer", "Fixer", "fixer", "Every screen checked against the four rules"], ["computer", "Computer", "computer", "The VPS live (admins)"], ["observatory", "Observatory", "observatory", "Every project and its lines of code"], ["console", "Console", "console", "Commands for all of Nova"], ["help", "Manual", "manual", "How everything works"], ["visualizer", "Nova", "visualizer", "Nova's browser helper, live"]].filter(([to]) => N.has(to.split("/")[0]));
    let data = null, problem = "";
    try { data = await api(`/app/api/links${fresh ? "?recheck=1" : ""}`); } catch (err) { if (err.signIn) throw err; problem = err.message; }
    const at = data && data.checkedAt ? new Date(data.checkedAt) : null;
    box.innerHTML = `
      <h3 class="h">Apps</h3>
      ${list(PLACES.map(([to, name, tile, text]) => row({ href: `#${to}`, lead: window.NovaTile ? window.NovaTile(tile) : "", title: name, text })))}
      <h3 class="h">All links</h3>
      <p class="small muted settings-hint" data-l-checked>${problem ? esc(problem) : at && !isNaN(at) ? `Checked ${esc(time12(at))}` : "Not checked yet"}</p>
      ${data ? (data.groups || []).map((g, i) => `<details class="card settings-links"${i === 0 ? " open" : ""}><summary>${esc(g.title || "Links")} <span class="pill">${(g.items || []).length}</span></summary>${g.note ? `<p class="small muted">${esc(g.note)}</p>` : ""}<ul class="settings-link-list">${(g.items || []).map(linkItem).join("")}</ul></details>`).join("") : ""}
      ${data && (data.changelog || []).length ? `<h3 class="h">What's changed</h3>${changes(data.changelog)}` : ""}
      ${data && (data.features || []).length ? `<h3 class="h">Everything Nova Agent can do</h3>${data.features.map((f) => `<details class="card settings-links"><summary>${esc(f.app)} <span class="pill">${(f.items || []).length}</span></summary>${f.note ? `<p class="small muted">${esc(f.note)}</p>` : ""}<ul class="settings-link-list">${(f.items || []).map((i) => `<li><b>${esc(i.name)}</b>${i.detail ? `<span class="small muted">${esc(i.detail)}</span>` : ""}</li>`).join("")}</ul></details>`).join("")}` : ""}
      <button type="button" class="btn wide" data-l="recheck">${icon("refresh")} Check every address again</button>`;
    box.querySelector('[data-l="recheck"]').addEventListener("click", () => recheck(box));
    box.addEventListener("click", async (e) => {
      const c = e.target.closest("[data-copy]");
      if (!c) return;
      try { await navigator.clipboard.writeText(c.dataset.copy); toast("Copied"); } catch (err) { toast("Couldn't copy: hold the address to copy it", true); }
    });
  }
  async function recheck(box) {
    const said = box.querySelector("[data-l-checked]");
    if (said) said.textContent = "Checking every address… (this takes a little while)";
    const btn = box.querySelector('[data-l="recheck"]');
    if (btn) btn.disabled = true;
    try {
      const fresh = document.createElement("div");
      const ui = { title() {}, back() {}, action() {} };
      await drawLinks(fresh, ui, true);
      if (box.isConnected) { box.replaceChildren(...fresh.childNodes); box.querySelector('[data-l="recheck"]')?.addEventListener("click", () => recheck(box)); toast("Checked"); }
    } catch (err) { if (said) said.textContent = err.message; if (btn) btn.disabled = false; }
  }
  function linkItem(item) {
    const kind = KINDS[item.kind] ? item.kind : "live";
    const st = STATES[(item.check || {}).state] ? item.check.state : "unchecked";
    const url = String(item.url || "");
    const open = /^https?:\/\//i.test(url) && item.kind !== "machine" && !deskPage(url);
    return `<li><div class="settings-link-top"><b>${esc(item.name)}</b><span class="pill">${esc(KINDS[kind])}</span><span class="pill ${STATES[st][2]}">${STATES[st][0]} ${esc((item.check && item.check.label) || STATES[st][1])}</span></div>
      ${item.note ? `<span class="small muted">${esc(item.note)}</span>` : ""}
      ${url ? `<div class="settings-link-url">${open ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>` : `<code>${esc(url)}</code><button type="button" class="chip" data-copy="${esc(url)}">Copy</button>`}</div>` : ""}</li>`;
  }
  function changes(log) {
    const days = new Map();
    for (const c of log) (days.get(c.date) || days.set(c.date, []).get(c.date)).push(c);
    const SIZE = { major: "★ Major", big: "◆ Big", small: "● Small" };
    return [...days.entries()].map(([date, items], i) => `<details class="card settings-links"${i === 0 ? " open" : ""}><summary>${esc(new Date(date + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }))} <span class="pill">${items.length}</span></summary>
      <ul class="settings-link-list">${items.sort((a, b) => ({ major: 0, big: 1, small: 2 })[a.size] - ({ major: 0, big: 1, small: 2 })[b.size]).map((c) => `<li><div class="settings-link-top"><span class="pill">${esc(SIZE[c.size] || c.size || "")}</span><span class="pill">${esc(c.app || "")}</span></div><b>${esc(c.title)}</b>${[["What", c.what], ["Why", c.why], ["Better because", c.benefit]].filter(([, w]) => w).map(([k, w]) => `<span class="small"><b>${k}:</b> ${esc(w)}</span>`).join("")}</li>`).join("")}</ul></details>`).join("");
  }

  // ---- #settings/install: Install Nova Phone, or remove it (Nova Desk's install.js, for this app) ----
  const ua = navigator.userAgent || "";
  const isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isApple = isIPad || /iPhone|iPod/.test(ua), isAndroid = /Android/.test(ua);
  const inSafari = isApple && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  const browser = /SamsungBrowser/.test(ua) ? "Samsung Internet" : /EdgA|EdgiOS|Edg\//.test(ua) ? "Edge" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /CriOS|Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "your browser";
  const device = isIPad ? "iPad" : /iPhone|iPod/.test(ua) ? "iPhone" : isAndroid ? (/Mobile/.test(ua) ? "Android phone" : "Android tablet") : "computer";
  const standalone = () => navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
  function steps() {
    if (isApple) return `${inSafari ? "" : "<li>Open this page in <b>Safari</b> (iPhones and iPads only add to the Home Screen from Safari).</li>"}<li>Tap <b>Share</b> (the square with an arrow) ${isIPad ? "at the top right" : "at the bottom of the screen"}.</li><li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. Nova Phone is on your Home Screen.</li>`;
    if (/Firefox/.test(ua)) return "<li>Tap the menu <b>⋮</b> in Firefox.</li><li>Tap <b>Add app to Home screen</b> (or <b>Install</b>), then <b>Add</b>.</li>";
    if (/SamsungBrowser/.test(ua)) return "<li>Tap the menu <b>≡</b> at the bottom of Samsung Internet.</li><li>Tap <b>Add page to</b>, then <b>Home screen</b>.</li>";
    if (isAndroid) return "<li>Tap the menu <b>⋮</b> at the top right of Chrome.</li><li>Tap <b>Install app</b> (or <b>Add to Home screen</b>), then <b>Install</b>.</li>";
    return "<li>In Chrome or Edge, click the install icon at the right of the address bar (or the menu <b>⋮</b> → <b>Install Nova Phone</b>).</li>";
  }
  function removeSteps() {
    if (isApple) return "<li>On your Home Screen, <b>press and hold</b> the Nova Phone icon.</li><li>Tap <b>Remove App</b>, then <b>Delete App</b>.</li>";
    if (isAndroid) return "<li>On your Home Screen, <b>press and hold</b> the Nova Phone icon.</li><li>Tap <b>Uninstall</b> (or <b>App info → Uninstall</b>), then <b>OK</b>.</li>";
    return "<li>In Nova Phone's own window, open the menu <b>⋮</b> and choose <b>Uninstall Nova Phone</b>.</li>";
  }
  async function drawInstall(box, ui) {
    ui.title("Install Nova Phone");
    ui.back("#settings");
    const offer = N.installOffer();
    const inApp = standalone();
    box.innerHTML = `
      <div class="card"><p class="kicker">${esc(device)} · ${esc(browser)}</p><h2 class="card-title">${inApp ? "Nova Phone is installed ✦" : "Nova Phone on your Home Screen"}</h2>
        <p class="muted">${inApp ? "You're using it from your Home Screen: full screen, opening where you left off." : "A full-screen app with its own icon, opening where you left off."} ${isApple ? "iPhones only allow notifications once Nova Phone is on the Home Screen." : ""}</p></div>
      ${inApp ? "" : offer ? `<button type="button" class="btn main wide" data-i="install">${icon("download")} Install Nova Phone</button>` : `<div class="card"><h3 class="card-title">How to add it</h3><ol class="settings-steps">${steps()}</ol></div>`}
      <h3 class="h">Remove it from this phone</h3>
      <div class="card"><p class="muted">No website can delete its own icon. This takes Nova Phone off this phone first: notifications off, signed out, and its saved settings and offline copy gone (Nova Desk's on this phone too: they share them). Everything online stays safe.</p>
        <button type="button" class="btn danger wide" data-i="wipe">${icon("trash")} Remove from this phone</button>
        <ol class="settings-steps" data-i-steps hidden>${removeSteps()}</ol></div>`;
    box.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-i]");
      if (!b) return;
      if (b.dataset.i === "install") {
        const o = N.installOffer();
        if (!o) return N.show();
        o.prompt();
        const r = await o.userChoice.catch(() => null);
        N.clearInstallOffer();
        toast(r && r.outcome === "accepted" ? "Nova Phone is installed ✦ Find it on your Home Screen." : "Not installed. It's here whenever you want it.");
        return N.show();
      }
      if (b.dataset.i === "wipe") {
        if (!(await confirm({ title: "Remove Nova Phone from this phone?", text: "Notifications stop, you're signed out, and its settings and offline copy are cleared. Then delete the icon.", ok: "Remove", danger: true }))) return;
        await N.busy(b, "Removing…", wipe);
        box.querySelector("[data-i-steps]").hidden = false;
        toast("Done. Now delete the icon (the steps are below).");
      }
    });
  }
  async function wipe() {
    try {
      const reg = await navigator.serviceWorker?.getRegistration("/");
      const sub = reg && reg.pushManager && (await reg.pushManager.getSubscription());
      if (sub) { await fetch("/app/api/push/unsubscribe", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
    } catch (err) {}
    await fetch("/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    try { for (const r of (await navigator.serviceWorker?.getRegistrations()) || []) await r.unregister(); } catch (err) {}
    try { for (const k of await caches.keys()) await caches.delete(k); } catch (err) {}
    try { localStorage.clear(); sessionStorage.clear(); } catch (err) {}
  }
})();
