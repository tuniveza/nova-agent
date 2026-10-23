// Nova Phone: the Manual (Nova Desk's Manual, made for a phone): every app's guide, how it's built, its history
// and what's new, every web address, and a search across all of it. Its content loads only when it's opened.
//   #help                          the start: search, carry on, the apps, this week, how it all fits together
//   #help/<app>[/<tab>[/<place>]]  an app's page (tabs: guide, built, history, new), at a chapter or change
//   #help/for/<place id>           the page for a Nova Phone place (#help/for/money opens the Invoicer's page):
//                                  what each place's help button links to; N.manualFor(placeId) gives the same
//   #help/addresses                every web address, to open or copy
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, list, empty, toast } = N;
  const DAY = 864e5;
  const SEEN_KEY = "nova-manual/seen";
  const PLACE_KEY = "nova-manual/place";
  const store = {
    get(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };

  // A file of data that sets a global, loaded once when it's first needed
  const loaded = new Map();
  const loadData = (src, global) => loaded.get(src) || loaded.set(src, new Promise((resolve, reject) => {
    if (window[global]) return resolve(window[global]);
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => (window[global] ? resolve(window[global]) : reject(new Error("It didn't load")));
    s.onerror = () => { loaded.delete(src); reject(new Error("It didn't load")); };
    document.head.append(s);
  })).get(src);

  // ---- Days and times, in London (where the studio is) ----
  const LONDON = "Europe/London";
  const dayOf = (iso) => new Date(iso).toLocaleDateString("en-GB", { timeZone: LONDON, weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const shortDay = (iso) => new Date(iso).toLocaleDateString("en-GB", { timeZone: LONDON, day: "numeric", month: "short", year: "numeric" });
  const timeOf = (iso) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: LONDON, hour: "2-digit", minute: "2-digit" });
  const londonDay = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: LONDON });
  function ago(iso) {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return "";
    const d = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) / DAY);
    return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 14 ? `${d} days ago` : d < 60 ? `${Math.round(d / 7)} weeks ago` : `${Math.round(d / 30)} months ago`;
  }
  const commits = (a) => (a.history && a.history.commits) || [];
  const recent = (a, days) => commits(a).filter((c) => Date.now() - Date.parse(c.date) < days * DAY);
  const lastChange = (a) => (commits(a)[0] ? commits(a)[0].date : "");
  const who = (a) => (a.repo === "nb/novacane-worker" ? "Nova Bot & Portal" : a.name);

  const TABS = [["guide", "Guide"], ["built", "How it's built"], ["history", "History"], ["new", "What's new"]];
  const tabName = (id) => (TABS.find((t) => t[0] === id) || TABS[0])[1];

  // ---- Which Manual page goes with which Nova Phone place, and back ----
  const PLACE_APP = {
    today: "portal", inbox: "portal", clients: "portal", outreach: "portal", you: "portal", crew: "portal", google: "portal", tests: "portal", bookings: "portal",
    bot: "bot", agent: "agent", calendar: "calendar", notes: "notes", quests: "quests", board: "board", index: "index", observatory: "observatory",
    fixer: "fixer", computer: "computer", money: "invoicer", console: "console", visualizer: "nova", lossless: "lossless",
  };
  const APP_PLACE = {
    agent: ["agent", "Agent"], portal: ["today", "Portal"], calendar: ["calendar", "Calendar"], notes: ["notes", "Notes"], quests: ["quests", "Quests"], board: ["board", "Board"],
    index: ["index", "Index"], observatory: ["observatory", "the Observatory"], fixer: ["fixer", "the Fixer"], nova: ["visualizer", "Nova"], computer: ["computer", "Computer"],
    invoicer: ["money", "the Invoicer"], console: ["console", "Console"], bot: ["bot", "the website bot"], lossless: ["lossless", "Lossless"],
  };
  const manualFor = (placeId) => `#help${PLACE_APP[placeId] ? `/${PLACE_APP[placeId]}` : ""}`;
  N.manualFor = manualFor;
  // A Nova Desk address (/calendar/, https://nova.novacane.co.uk/portal/…) as the Nova Phone place that does the same
  const PATH_PLACE = [["/agent/nova", "visualizer"], ["/agent/computer", "computer"], ["/agent/invoicer", "money"], ["/agent/missions", "agent/missions"], ["/agent", "agent"], ["/portal", "today"],
    ["/calendar", "calendar"], ["/notes", "notes"], ["/quests", "quests"], ["/board", "board"], ["/app/memory", "index"], ["/console", "console"], ["/observatory", "observatory"],
    ["/lossless", "lossless"], ["/fixer", "fixer"], ["/computer", "computer"], ["/invoicer", "money"], ["/visualizer", "visualizer"]];
  const OURS = (host) => host === location.host || host === "nova.novacane.co.uk" || /novacane-worker/.test(host) || /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
  function phonePlace(href) {
    let u;
    try { u = new URL(href, location.origin); } catch (e) { return null; }
    if (!/^https?:$/.test(u.protocol) || !OURS(u.host)) return null;
    const hit = PATH_PLACE.find(([p]) => u.pathname === p || u.pathname.startsWith(`${p}/`));
    return hit && N.has(hit[1].split("/")[0]) ? `#${hit[1]}` : null;
  }
  // (a Nova Desk page with no Nova Phone place: its words stay, without the link)
  const deskPage = (href) => { try { const u = new URL(href, location.origin); return OURS(u.host) && PATH_PLACE.some(([p]) => u.pathname === p || u.pathname.startsWith(`${p}/`)); } catch (e) { return false; } };

  // ---- Lossless's page (Nova Desk's Manual has none yet): written for Nova Phone from web/lossless/README.md ----
  const LOSSLESS = {
    id: "lossless", name: "Lossless", colour: "#C7A4FF", glyph: "◉", repo: "na/web/lossless",
    where: "Online at nova.novacane.co.uk/lossless/, and in Nova Phone",
    tagline: "Two devices, one room code: audio sent at full quality, every frame exactly as the other mic made it.",
    links: [["Open Lossless", "/lossless/"]],
    shared: "Lossless's code lives inside Nova Agent's (na/web/lossless), so its changes are saved in Nova Agent's history.",
    intro: "<p>Lossless joins two devices in a room and sends raw audio between them. There's no phone-call squeeze (no Opus): every frame that arrives is the same bytes the other microphone produced. Use it to listen together at full quality, to send a take from the studio to a phone, or to record someone far away.</p>",
    guide: [
      { id: "ll-call", title: "A call, step by step", html: `<ol><li><b>Plug in headphones on both devices.</b> Echo cancellation is off on purpose, so the audio stays untouched; speakers would feed back into the microphone.</li><li>Open <b>Lossless</b>. A room code is made for you (like <code>nova-ab12</code>), or type one. Letters, numbers and dashes, up to 64.</li><li>Tap <b>Copy link</b> or <b>Share</b> and send it to the other person, or just type the same code on both devices. The link is the online address with the room in it (<code>…/lossless/#nova-ab12</code>).</li><li>Tap <b>Connect</b> on both and allow the microphone. Order doesn't matter.</li><li>The status turns green: <b>Connected: streaming lossless PCM</b>. Talk: the <b>Them</b> meter moves on the other device.</li><li>Tap <b>Disconnect</b> when you're done. The microphone switch mutes you without hanging up, and tells the other side your input is off.</li></ol>` },
      { id: "ll-choices", title: "The choices", html: `<h4>Format</h4><p><b>32-bit float</b> is exactly what the audio engine made: bit-exact. <b>16-bit</b> uses half the data and is still far beyond what a phone microphone can tell apart, but it's a rounding step, so it isn't bit-exact. Each side picks its own; the other side reads it from every frame.</p><h4>Mode</h4><p><b>Lossless</b> (the usual) plays every frame. If the next one isn't here yet, playback waits and carries on from exactly where it stopped, so the delay settles at whatever the connection needs (about 60 ms plus the network to start with). <b>Catch up</b> drops the built-up audio to bring the delay back down.</p><p><b>Low latency</b> keeps the delay short instead: a frame that's late is played as silence and counted as lost.</p><p>The mode is per device: it decides how that device plays what it receives.</p><h4>Channels, input and output</h4><p>Mono or stereo, and which microphone or interface to use (the list fills in once you've allowed the microphone). Choosing the output works on a computer in Chrome or Edge; iPhones and Safari always play through the phone's own output. Your choices are remembered on that device; if a saved device has gone, the usual one is used.</p>` },
      { id: "ll-numbers", title: "What the numbers mean", html: `<ul><li><b>Path</b>: <code>direct (LAN)</code> or <code>direct (via NAT)</code> means the two devices talk to each other. <code>relayed (TURN)</code> means the call goes through Cloudflare's relay.</li><li><b>Round trip</b>: how long a message takes there and back.</li><li><b>Sending / Receiving</b>: about 1,540 kbps for 32-bit float mono, about 780 kbps for 16-bit; stereo is double.</li><li><b>Their format</b>: should say <code>32-bit float, 48.0 kHz, mono</code>. If it says <i>resampling … (not bit-exact)</i>, the two devices ended up at different sample rates.</li><li><b>Delay</b>: how much audio is waiting to play, and what it's aiming for.</li><li><b>Lost / late</b>: frames that missed their moment to play. Ideally 0 / 0 on decent Wi-Fi.</li><li><b>Pauses / skipped</b>: the buffer ran dry and waited, or grew too deep and the oldest frame was dropped (every device's clock runs at a slightly different speed).</li></ul>` },
      { id: "ll-phone", title: "On a phone", html: `<ul><li><b>Headphones</b>, always: the phone's speaker goes straight back into its microphone.</li><li><b>iPhone</b>: if the phone stops the sound (a call comes in, or you leave the app), a <b>Tap to resume audio</b> button appears. Tap it.</li><li>While you're connected the screen stays awake, so the phone doesn't lock and pause the audio.</li><li><b>Mobile data</b>: mono 32-bit needs about 1.5 Mbps each way. On a weak signal choose <b>16-bit</b> or <b>mono</b>; if the connection can't carry it, the status says so.</li><li><b>Changing networks</b> (Wi-Fi to mobile data): the call carries on by itself. If no new route turns up within about 15 seconds, it reconnects from scratch.</li><li>If the room server's link drops for a moment, the call keeps going and the link comes back by itself. A third device in a room is told the room is full.</li><li>The microphone only works on a secure (https) address, which the online address is.</li></ul>` },
      { id: "ll-relay", title: "Anywhere in the world: the relay", html: `<p>Most home routers let two devices talk directly. Mobile networks and office or campus Wi-Fi often don't; then the call goes through <b>Cloudflare's TURN relay</b>: still the same lossless audio, just routed through Cloudflare's nearest location (over port 443 too, which gets through almost any firewall).</p><p>The relay needs setting up once, by an admin, on Nova Bot (in a terminal on the computer):</p><pre><code>cd ~/an/pj/ns/nb/novacane-worker
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_KEY_API_TOKEN</code></pre><p>The key comes from the Cloudflare dashboard, <b>Realtime → TURN Server</b>. The secrets never reach a browser: each call asks for short-lived passes (6 hours, renewed during long calls). Without them only direct calls work, and the page says the relay isn't set up when a connection fails.</p><p><b>Cost:</b> $0.05 per GB sent from the relay, after a free 1,000 GB a month. A relayed mono 32-bit call is about 1.4 GB an hour (both ways together); stereo about 2.8 GB. Direct calls cost nothing.</p><p><b>To test the relay</b> from one network, open <code>…/lossless/?relay#my-room</code> on one device: <b>Path</b> should read <code>relayed (TURN)</code>.</p>` },
      { id: "ll-logic", title: "Using it with Logic Pro (on a Mac)", html: `<p>A Mac can send from and play to any audio device, including the free BlackHole drivers, so Logic (or any DAW) can record the incoming audio and send its own mix out.</p><ol><li>Use <b>Chrome or Edge</b> on the Mac. Safari can't choose an output device.</li><li>Install <b>BlackHole 2ch</b> and <b>BlackHole 16ch</b> from <a href="https://existential.audio/blackhole/">existential.audio</a>: one per direction. With only one, the incoming audio loops straight back (Lossless warns you if input and output are the same device).</li><li>In <b>Audio MIDI Setup</b>, set both BlackHole devices to <b>48,000 Hz</b>, and run the Logic project at 48 kHz.</li><li>In Audio MIDI Setup, make a <b>Multi-Output Device</b> with your headphones and BlackHole 16ch.</li><li>In Lossless, set <b>Input: BlackHole 16ch</b>, <b>Output: BlackHole 2ch</b> and <b>Channels: Stereo</b>.</li><li>In Logic, <b>Settings → Audio → Devices</b>: <b>Input Device: BlackHole 2ch</b>, <b>Output Device: Multi-Output Device</b>.</li><li>Record the other person on a stereo track on input 1–2. To send to them, use Logic's main output.</li><li>Turn off input monitoring on the track you record them on, or their audio goes back to them as an echo.</li></ol>` },
    ],
    built: [
      { id: "ll-how", title: "How it works", html: `<pre><code>mic → capture worklet → [20-byte header + PCM] → data channel ──► other device
speakers ◄── playback worklet (jitter buffer, reorder by seq) ◄──┘

Signalling (offer, answer, routes only):
browser ⇄ WebSocket ⇄ LosslessRoom (Durable Object) ⇄ browser</code></pre><p>Audio goes over a WebRTC data channel, not a media track, so no codec ever touches it. The data channel is reliable but unordered: every packet arrives (sent again if it has to be), and one slow packet doesn't hold up the ones behind it. SCTP checksums and DTLS encryption make each frame byte-for-byte what was sent.</p>` },
      { id: "ll-files", title: "Files", html: `<div class="table"><table><thead><tr><th>File</th><th>What it does</th></tr></thead><tbody><tr><td><code>src/worker.js</code></td><td>Sends <code>/lossless/ws</code> to the room and answers <code>/lossless/ice</code> with STUN and TURN servers.</td></tr><tr><td><code>src/room.js</code></td><td>The <code>LosslessRoom</code> Durable Object: up to 2 sockets per room; passes offer, answer and routes between them.</td></tr><tr><td><code>public/lossless/app.js</code></td><td>The call: microphone, connection, data channel, signalling, framing.</td></tr><tr><td><code>capture-worklet.js</code></td><td>Cuts the microphone into 10 ms frames.</td></tr><tr><td><code>playback-worklet.js</code></td><td>The jitter buffer and playout, lossless or low latency.</td></tr><tr><td><code>test/playback.test.mjs</code></td><td>The playback buffer's tests (<code>npm test</code>).</td></tr></tbody></table></div>` },
      { id: "ll-where", title: "Where it runs", html: `<p>Nova Bot serves it at <code>https://nova.novacane.co.uk/lossless/</code> (https, which phones need before they give a page the microphone). Nova Bot's build copies <code>public/lossless/</code> into its files and the worker and room into <code>src/lossless/</code>; it sends <code>/lossless/ws</code> and <code>/lossless/ice</code> to them and holds the <code>LosslessRoom</code> binding. Nova Phone's Lossless uses the same addresses.</p><p>Nova Agent shows the page at <code>/lossless/</code> on the studio PC; signalling and the relay still come from Nova Bot, so the other device can be anywhere, and invite links point at the online address.</p>` },
      { id: "ll-design", title: "Design notes", html: `<h4>Wire format</h4><p>Each message is a 20-byte header (version, format, channels, sequence number, sample rate, timestamp, samples per channel) and then the PCM, one channel after the other. Frames are 10 ms (480 samples at 48 kHz): about 1.5 Mbps mono and 3 Mbps stereo as 32-bit float, half that as 16-bit. Mono is played on both ears.</p><h4>Sample rate</h4><p>Both sides ask for 48 kHz, so nothing is resampled. If a browser refuses (an older Firefox with a 44.1 kHz microphone), it uses its own rate, and the receiver resamples and says so.</p><h4>iPhone</h4><p>The audio is started inside the Connect tap (iPhones only allow it then), and the audio session is set to play and record (Safari 16.4 and later).</p><h4>Staying connected</h4><p>Clients ping the room every 15 s. Once the call is up the audio doesn't need the room server; if the link to it drops, the socket reconnects with backoff, and each device's own id replaces its old socket instead of counting as a third. If the audio link drops, the device that made the offer offers again. The sender only drops audio when about 40 s is stuck waiting to go out.</p>` },
      { id: "ll-next", title: "Still to come", html: `<ul><li>FLAC in the worklets: about 40–50% less data, still lossless.</li><li>More than two people in a room (one connection per person).</li><li>Recording what arrives to a WAV file.</li></ul>` },
    ],
    news: [],
    history: { total: 0, first: "", commits: [], work: [], workCount: 0, workStat: "" },
  };

  // ---- Reading the guides' words safely, and making them work on a phone ----
  // Read as a page of its own, with style attributes and blocks renamed first: Chrome holds a parsed page to Nova
  // Phone's CSP and reports every style="…" in it as blocked
  const parse = (html) => new DOMParser().parseFromString(String(html || "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[a-z][^>]*>/gi, (t) => t.replace(/\sstyle\s*=/gi, " data-style=")), "text/html");
  const textOf = (html) => parse(html).body.textContent.replace(/\s+/g, " ").trim();
  // No scripts, frames, styles or handlers; Nova Desk's addresses become the Nova Phone place; web links open
  // outside; tables read as cards (each cell with its column's name); code gets a Copy button; sub-headings get
  // their own places for "On this page"
  function prose(html, cid = "", subs = null) {
    const doc = parse(html);
    const b = doc.body;
    for (const el of b.querySelectorAll("script, style, iframe, object, embed, link, meta, form, input, button, video, audio")) el.remove();
    for (const el of b.querySelectorAll("*")) for (const a of [...el.attributes]) if (!(a.name === "href" && /^(https?:|\/|mailto:)/.test(a.value)) && !(a.name === "src" && /^(https?:|\/|data:image\/)/.test(a.value)) && a.name !== "alt") el.removeAttribute(a.name);
    for (const a of b.querySelectorAll("a[href]")) {
      const place = phonePlace(a.getAttribute("href"));
      if (place) a.setAttribute("href", place);
      else if (deskPage(a.getAttribute("href"))) a.replaceWith(...a.childNodes);
      else { a.setAttribute("target", "_blank"); a.setAttribute("rel", "noopener"); }
    }
    for (const a of b.querySelectorAll("a:not([href])")) a.replaceWith(...a.childNodes);
    for (const img of b.querySelectorAll("img")) { img.setAttribute("loading", "lazy"); img.setAttribute("decoding", "async"); }
    for (const t of b.querySelectorAll("table")) {
      const heads = [...t.querySelectorAll("thead th")].map((th) => th.textContent.trim());
      t.className = "manual-table";
      if (!heads.some(Boolean)) t.querySelector("thead")?.remove();
      for (const tr of t.querySelectorAll("tbody tr")) [...tr.children].forEach((td, i) => { if (heads[i]) td.dataset.label = heads[i]; });
      const wrap = t.closest("div");
      if (wrap && wrap !== b && wrap.childElementCount === 1) wrap.replaceWith(t);
    }
    for (const pre of b.querySelectorAll("pre")) {
      const box = doc.createElement("div");
      box.className = "manual-code";
      box.innerHTML = '<button type="button" class="manual-copy" data-copy-code>Copy</button>';
      pre.replaceWith(box);
      box.append(pre);
    }
    if (subs) b.querySelectorAll("h4").forEach((h, i) => { h.id = `${cid}--${i + 1}`; subs.push({ id: h.id, title: h.textContent.trim() }); });
    return b.innerHTML;
  }
  const idOf = (s) => `m-${String(s).replace(/[^\w-]/g, "-")}`;

  // ---- The parts of a page ----
  const glyph = (a, cls = "") => `<span class="manual-glyph${cls}" data-c="${esc(a.colour || "var(--hi)")}" aria-hidden="true">${esc(a.glyph || "✦")}</span>`;
  // Manual › Calendar › Guide, each step back a link
  function crumbs(steps) {
    return `<nav class="manual-crumbs" aria-label="Where you are">${steps.map(([label, href], i) => (i ? '<span aria-hidden="true">›</span>' : "") + (href ? `<a href="${esc(href)}">${esc(label)}</a>` : `<b aria-current="page">${esc(label)}</b>`)).join("")}</nav>`;
  }
  // One chapter: a card of its own, its place on the page given for "On this page"
  function chapter(c, toc) {
    const subs = [];
    const id = idOf(c.id);
    const html = prose(c.html, id, subs);
    toc.push({ id, title: c.title, subs });
    return `<section class="card manual-chapter" id="${id}"><h3>${esc(c.title)}</h3><div class="prose manual-prose">${html}</div></section>`;
  }
  function chapters(items, intro, toc) {
    if (!items.length && !intro) return empty({ icon: "book", title: "Nothing written about this yet" });
    return `${intro ? `<div class="card prose manual-prose">${prose(intro)}</div>` : ""}${items.map((c) => chapter(c, toc)).join("")}`;
  }
  // Changes by day (London time): what changed, when, its short id, and more about it when there's more
  function timeline(items, showApp) {
    let out = "", day = "";
    for (const { c, a } of items) {
      const d = londonDay(c.date);
      if (d !== day) {
        if (day) out += "</ul>";
        day = d;
        out += `<h3 class="h manual-day">${esc(dayOf(c.date))}</h3><ul class="list manual-line">`;
      }
      out += `<li class="manual-commit" id="c-${esc(c.hash)}" data-c="${esc(a.colour || "var(--hi)")}"><b>${esc(c.subject)}</b><span class="manual-meta">${showApp ? `<a class="pill manual-tag" href="#help/${esc(a.id)}/history" data-c="${esc(a.colour || "var(--hi)")}">${esc(who(a))}</a>` : ""}<span>${esc(timeOf(c.date))}</span><code>${esc(c.hash)}</code></span>${c.body ? `<details class="manual-more"><summary>More about this change</summary><pre>${esc(c.body)}</pre></details>` : ""}</li>`;
    }
    return day ? `${out}</ul>` : out;
  }
  const top = '<button type="button" class="btn quiet wide manual-top" data-manual-top>Back to the top</button>';

  // ---- The start ----
  let query = "";
  function startPage(M, toc, here, seenBefore) {
    const s = M.suite;
    const repos = new Set(), feed = [];
    for (const a of M.apps) {
      if (repos.has(a.repo)) continue;
      repos.add(a.repo);
      for (const c of recent(a, M.recentDays || 7)) feed.push({ c, a });
    }
    feed.sort((x, y) => String(y.c.date).localeCompare(String(x.c.date)));
    let saved = {};
    try { saved = JSON.parse(store.get(PLACE_KEY) || "{}"); } catch (e) {}
    const back = saved.app && M.apps.find((a) => a.id === saved.app);
    const appRow = (a) => {
      const last = lastChange(a);
      const fresh = last && Date.parse(last) > seenBefore && Date.now() - Date.parse(last) < 3 * DAY;
      const marks = `${a.id === here ? '<span class="pill">Here</span>' : ""}${fresh ? '<span class="pill ok">New</span>' : !fresh && recent(a, 2).length ? '<span class="manual-fresh" aria-label="Changed in the last two days"></span>' : ""}`;
      return `<li><a class="row edge manual-app" href="#help/${esc(a.id)}" data-c="${esc(a.colour || "var(--hi)")}"><span class="row-lead">${glyph(a)}</span><span class="row-main"><b>${esc(a.name)} ${marks}</b><span>${esc(a.tagline || "")}</span><small class="manual-where">${esc(a.where || "")}${last ? ` · changed ${esc(ago(last))}` : ""}</small></span><span class="row-end">${icon("next")}</span></a></li>`;
    };
    return `<div class="card manual-hero"><span class="manual-big" aria-hidden="true">✺</span><div><p class="kicker">Manual</p><h2 class="card-title">The Nova Agent</h2><p>${esc((s && s.tagline) || "Every part of Nova Agent: how to use it, how it's built, its story so far and what's changing.")}</p>
        <p class="manual-pills"><span class="pill">${M.apps.length} apps</span>${M.built ? `<span class="pill">Updated ${esc(ago(M.built))}</span>` : ""}<span class="pill">Each place's help opens its own page</span></p></div></div>
      ${back ? list([`<li><a class="row edge" href="#help/${esc(back.id)}/${esc(saved.tab || "guide")}" data-c="${esc(back.colour || "var(--hi)")}"><span class="row-lead">${glyph(back)}</span><span class="row-main"><b>Carry on reading</b><span>${esc(back.name)} · ${esc(tabName(saved.tab))}</span></span><span class="row-end">${icon("next")}</span></a></li>`]) : ""}
      <h3 class="h">The apps</h3>${list(M.apps.map(appRow))}
      ${(M.addresses || []).length ? list([`<li><a class="row" href="#help/addresses"><span class="row-lead"><span class="manual-glyph" aria-hidden="true">⌖</span></span><span class="row-main"><b>All addresses</b><span>Every web address in the suite, to open or copy</span></span><span class="row-end">${icon("next")}</span></a></li>`]) : ""}
      ${feed.length ? `<h3 class="h">This week across the suite</h3>${timeline(feed.slice(0, 30), true)}` : ""}
      ${s && (s.chapters || []).length ? `<h3 class="h">How it all fits together</h3>${chapters(s.chapters, s.intro, toc)}` : ""}`;
  }

  // ---- Search: every word you type in every guide, write-up, note and change; best first ----
  let index = null;
  function search(M, q) {
    const typed = q.toLowerCase().split(/\s+/).filter(Boolean);
    // (short words like "a" and "to" don't count unless they're all there is)
    const words = typed.filter((w) => w.length > 2).length ? typed.filter((w) => w.length > 2) : typed;
    const need = Math.ceil(words.length / 2);
    const score = (t) => { const n = words.filter((w) => t.includes(w)).length; return n >= need ? n : 0; };
    if (!index) {
      index = [];
      const add = (a, tab, id, title, text, label) => index.push({ a, tab, id, title, text: text || "", label, lt: String(title).toLowerCase(), lx: `${title} ${text || ""}`.toLowerCase() });
      if (M.suite) for (const c of M.suite.chapters || []) add(null, "start", idOf(c.id), c.title, c.text || textOf(c.html), "The Nova Agent");
      const repos = new Set();
      for (const a of M.apps) {
        for (const c of a.guide || []) add(a, "guide", idOf(c.id), c.title, c.text || textOf(c.html), `${a.name} · Guide`);
        for (const c of a.built || []) add(a, "built", idOf(c.id), c.title, c.text || textOf(c.html), `${a.name} · How it's built`);
        for (const c of a.news || []) add(a, "new", idOf(c.id), c.title, c.text || textOf(c.html), `${a.name} · What's new`);
        if (!repos.has(a.repo)) { repos.add(a.repo); for (const c of commits(a)) add(a, "history", `c-${c.hash}`, c.subject, c.body || "", `${who(a)} · History · ${shortDay(c.date)}`); }
      }
    }
    const hits = [];
    for (const h of index) { const s = score(h.lx); if (s) hits.push({ h, rank: score(h.lt) * 3 + s }); }
    hits.sort((x, y) => y.rank - x.rank);
    if (!hits.length) return empty({ icon: "search", title: `Nothing in the manual mentions “${q}”`, text: "Try fewer or other words." });
    const re = new RegExp(`(${words.map((w) => esc(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    const mark = (s) => esc(s).replace(re, "<mark>$1</mark>");
    const snippet = (text) => {
      const t = text.toLowerCase();
      const at = Math.max(0, Math.min(...words.map((w) => (t.indexOf(w) < 0 ? Infinity : t.indexOf(w)))) - 60);
      if (!Number.isFinite(at)) return text.slice(0, 180);
      return (at ? "…" : "") + text.slice(at, at + 180) + (at + 180 < text.length ? "…" : "");
    };
    return `<h3 class="h">${hits.length} result${hits.length === 1 ? "" : "s"} for “${esc(q)}”</h3><ul class="list">${hits.slice(0, 40).map(({ h }) =>
      `<li><a class="row${h.a ? " edge" : ""} manual-hit" href="#help/${h.a ? `${esc(h.a.id)}/${h.tab}` : "start"}/${encodeURIComponent(h.id)}"${h.a ? ` data-c="${esc(h.a.colour || "var(--hi)")}"` : ""}><span class="row-main"><small class="manual-where">${esc(h.label)}</small><b>${mark(h.title)}</b>${h.text ? `<span>${mark(snippet(h.text))}</span>` : ""}</span><span class="row-end">${icon("next")}</span></a></li>`).join("")}</ul>${hits.length > 40 ? `<p class="muted small">The best 40 of ${hits.length}. Add a word to narrow it down.</p>` : ""}`;
  }

  // ---- An app's page ----
  function appPage(M, a, tab, toc, here) {
    const h = a.history || { total: 0, commits: [] };
    const days = M.recentDays || 7;
    const nNew = recent(a, days).length + (h.workCount ? 1 : 0);
    const tabs = TABS.filter(([id]) => id !== "built" || (a.built || []).length).map(([id, label]) => `<a class="chip" href="#help/${esc(a.id)}/${id}"${id === tab ? ' aria-current="page"' : ""}>${label}${id === "new" && nNew ? `<span class="n">${nNew}</span>` : ""}</a>`).join("");
    const last = lastChange(a);
    const [place, placeName] = APP_PLACE[a.id] || [];
    const open = place && N.has(place) ? `<a class="btn wide" href="#${place}">${a.id === here ? "Back to" : "Open"} ${esc(placeName)}</a>` : "";
    const hero = `<div class="card manual-hero" data-c="${esc(a.colour || "var(--hi)")}">${glyph(a, " manual-big")}<div><p class="kicker">${esc(a.where || "")}</p><h2 class="card-title">${esc(a.name)}</h2>${a.tagline ? `<p>${esc(a.tagline)}</p>` : ""}
      <p class="manual-pills">${a.id === here ? '<span class="pill">You came from here</span>' : ""}${last ? `<span class="pill">Changed ${esc(ago(last))}</span>` : ""}${h.total ? `<span class="pill">${h.total} changes since ${esc(h.first ? shortDay(h.first) : "the start")}</span>` : ""}</p></div>${open}</div>`;
    let body = "";
    if (tab === "built") body = `<p class="muted small manual-note">From ${esc(a.name)}'s own write-up, in <code>${esc(a.repo || "")}</code>.</p>${chapters(a.built || [], "", toc)}`;
    else if (tab === "history") body = history(a);
    else if (tab === "new") body = news(M, a, toc);
    else body = chapters(a.guide || [], a.intro, toc);
    const trail = tab === "guide" ? [["Manual", "#help"], [a.name, ""]] : [["Manual", "#help"], [a.name, `#help/${a.id}`], [tabName(tab), ""]];
    return `${crumbs(trail)}
      ${hero}<nav class="chips manual-tabs" aria-label="${esc(a.name)}">${tabs}</nav>${body}${pager(M, a)}`;
  }
  // The history: four figures, then every change by day
  function history(a) {
    const h = a.history || { total: 0, commits: [] };
    const cs = commits(a);
    const first = h.first ? Date.parse(h.first) : 0;
    const days = first ? Math.max(1, Math.round((Date.now() - first) / DAY)) : 0;
    const busiest = {};
    for (const c of cs) { const d = londonDay(c.date); busiest[d] = (busiest[d] || 0) + 1; }
    const topDay = Object.entries(busiest).sort((x, y) => y[1] - x[1])[0];
    return `<div class="sums manual-stats"><div class="sum"><b>${h.total || 0}</b><span>changes saved</span></div><div class="sum"><b>${first ? esc(shortDay(h.first)) : "–"}</b><span>the first one${days ? `, ${days} day${days === 1 ? "" : "s"} ago` : ""}</span></div>
        <div class="sum"><b>${topDay ? topDay[1] : 0}</b><span>on its busiest day${topDay ? ` (${esc(shortDay(topDay[0]))})` : ""}</span></div><div class="sum"><b>${h.workCount || 0}</b><span>file${h.workCount === 1 ? "" : "s"} changed, not saved yet</span></div></div>
      ${a.shared ? `<p class="muted small manual-note">${esc(a.shared)}</p>${a.id === "lossless" ? '<a class="btn wide" href="#help/agent/history">Nova Agent\'s history</a>' : ""}` : ""}
      ${cs.length ? timeline(cs.map((c) => ({ c, a })), false) : empty({ icon: "clock", title: "No history yet" })}
      ${h.total > cs.length ? `<p class="muted small manual-note">The latest ${cs.length} of ${h.total} changes.</p>` : ""}`;
  }
  // What's new: what's being worked on now, the app's own notes, and the last few days' changes
  function news(M, a, toc) {
    const h = a.history || {};
    const days = M.recentDays || 7;
    const fresh = recent(a, days);
    const wip = h.workCount ? `<div class="card manual-wip"><p class="kicker">Being worked on right now</p><p>${h.workCount} file${h.workCount === 1 ? "" : "s"} changed and not saved to its history yet${h.workStat ? ` (${esc(h.workStat)})` : ""}, as of ${esc(ago(M.built))}.</p><div class="manual-files">${(h.work || []).map((f) => `<span class="manual-file" data-state="${esc(f.state)}">${esc(f.file)}<small>${esc({ M: "changed", A: "new", D: "deleted", R: "renamed", "??": "new" }[f.state] || f.state || "")}</small></span>`).join("")}${h.workCount > (h.work || []).length ? `<span class="manual-file">+${h.workCount - (h.work || []).length} more</span>` : ""}</div></div>` : "";
    const notes = (a.news || []).map((c) => chapter(c, toc)).join("");
    const listed = fresh.length ? `<h3 class="h">The last ${days} days</h3>${timeline(fresh.map((c) => ({ c, a })), false)}` : `<p class="muted small manual-note">Nothing new in the last ${days} days${lastChange(a) ? `: the last change was ${esc(ago(lastChange(a)))}` : ""}.</p>`;
    return wip + notes + listed;
  }
  // The app before and after this one
  function pager(M, a) {
    const i = M.apps.indexOf(a);
    const prev = M.apps[i - 1], next = M.apps[i + 1];
    const one = (x, word, arrow) => `<a class="btn manual-pg" href="#help/${esc(x.id)}" data-c="${esc(x.colour || "var(--hi)")}"><small>${word}</small><b>${arrow === "←" ? "← " : ""}${esc(x.name)}${arrow === "→" ? " →" : ""}</b></a>`;
    return prev || next ? `<nav class="btns two manual-pager" aria-label="Other apps">${prev ? one(prev, "Previous app", "←") : ""}${next ? one(next, "Next app", "→") : ""}</nav>` : "";
  }

  // ---- All addresses ----
  function addressesPage(M) {
    return `${crumbs([["Manual", "#help"], ["All addresses", ""]])}<div class="card manual-hero"><span class="manual-big" aria-hidden="true">⌖</span><div><p class="kicker">Manual</p><h2 class="card-title">All addresses</h2><p>Every part of Nova is online at nova.novacane.co.uk. Copy an address, or open it. (Admins see a few more in Portal → Settings → Addresses.)</p></div></div>
      ${(M.addresses || []).map((g) => `<h3 class="h">${esc(g.title)}</h3>${g.note ? `<p class="muted small manual-note">${esc(g.note)}</p>` : ""}
        <ul class="list">${(g.items || []).map((it) => {
          const text = it.code || it.url || (it.path ? new URL(it.path, location.origin).href : "");
          const place = !it.code && phonePlace(it.url || it.path || "");
          return `<li class="manual-addr"><b>${esc(it.name)}</b>${it.what ? `<span class="muted">${esc(it.what)}</span>` : ""}<code class="manual-url">${esc(text)}</code>
            <div class="btns two"><button type="button" class="btn" data-copy="${esc(text)}">Copy</button>${it.code ? "" : place ? `<a class="btn" href="${esc(place)}">Open in Nova Phone</a>` : `<a class="btn" href="${esc(it.url || it.path)}" target="_blank" rel="noopener">Open ${esc(it.name)} ↗</a>`}</div></li>`;
        }).join("")}</ul>`).join("")}`;
  }

  // ---- "On this page": a slim bar at the top saying where you are; a tap lists every chapter to jump to ----
  function tocBar(toc) {
    return toc.length > 1 ? `<button type="button" class="manual-toc" data-manual-toc><span>On this page</span><b data-manual-now>${esc(toc[0].title)}</b><small>${toc.length} sections</small></button>` : "";
  }
  // As you read, the bar follows along (a scroll listener on the page while this page is the one showing; gone
  // when it isn't), and jumps flash the place they land on
  function follow(box, toc, goto) {
    const page = document.getElementById("page");
    let tries = 0, ticking = false;
    const now = box.querySelector("[data-manual-now]");
    const flat = toc.flatMap((c) => [{ id: c.id, title: c.title }, ...c.subs.map((s) => ({ id: s.id, title: `${c.title} · ${s.title}` }))]);
    const spy = () => {
      ticking = false;
      if (!box.isConnected) return stop();
      if (!now) return;
      const line = page.getBoundingClientRect().top + 70;
      let cur = flat[0];
      for (const f of flat) { const el = box.querySelector(`#${CSS.escape(f.id)}`); if (!el || el.getBoundingClientRect().top > line) break; cur = f; }
      // (at the very end, the last section, even when it's too short to reach the top)
      if (page.scrollTop > 0 && page.scrollTop + page.clientHeight >= page.scrollHeight - 8) cur = flat[flat.length - 1];
      if (cur && now.textContent !== cur.title) now.textContent = cur.title;
    };
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(spy); } };
    const stop = () => { page.removeEventListener("scroll", onScroll); removeEventListener("hashchange", stop); };
    const start = () => {
      if (!box.isConnected) { if (++tries < 120) requestAnimationFrame(start); return; }
      if (now) page.addEventListener("scroll", onScroll, { passive: true });
      addEventListener("hashchange", stop);
      if (goto) jump(box, goto);
    };
    requestAnimationFrame(start);
  }
  function jump(box, id) {
    const el = box.querySelector(`#${CSS.escape(id)}`);
    if (!el) return;
    const d = el.closest("details");
    if (d) d.open = true;
    // (straight there, and again once the fonts and anything late are in, in case the page grew meanwhile)
    el.scrollIntoView({ block: "start" });
    const at = el.getBoundingClientRect().top;
    const again = () => { if (el.isConnected && Math.abs(el.getBoundingClientRect().top - at) > 4) el.scrollIntoView({ block: "start" }); };
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => requestAnimationFrame(again));
    setTimeout(again, 500);
    el.classList.remove("manual-flash");
    void el.offsetWidth;
    el.classList.add("manual-flash");
    const now = box.querySelector("[data-manual-now]");
    const h = el.matches("section") ? el.querySelector("h3") : el;
    if (now && h) now.textContent = el.matches("h4") ? `${el.closest("section").querySelector("h3").textContent} · ${h.textContent}` : h.textContent;
  }
  // Every button on a Manual page: Copy (code and addresses), On this page, Back to the top
  function wire(box, toc) {
    box.addEventListener("click", async (e) => {
      const code = e.target.closest("[data-copy-code]");
      const copy = e.target.closest("[data-copy]");
      if (code || copy) {
        const text = code ? code.nextElementSibling.textContent : copy.dataset.copy;
        try { await navigator.clipboard.writeText(text); toast("Copied"); if (code) { code.textContent = "Copied"; setTimeout(() => (code.textContent = "Copy"), 1400); } } catch (err) { toast("Couldn't copy: press and hold the words to copy them", true); }
        return;
      }
      if (e.target.closest("[data-manual-top]")) { document.getElementById("page").scrollTo({ top: 0, behavior: "smooth" }); return; }
      if (e.target.closest("[data-manual-toc]")) {
        const to = await N.choose({ title: "On this page", options: toc.flatMap((c) => [[c.id, c.title], ...c.subs.map((s) => [s.id, `· ${s.title}`])]) });
        if (to) jump(box, to);
      }
    });
  }

  // ---- The Manual ----
  let here = "";
  N.section({
    id: "help", name: "Manual", tile: "manual",
    async draw(box, path, ui) {
      await N.css("manual.css");
      const [app = "", part = "", gid = ""] = path;
      // (a place's help button: its own page, and that app marked as where you came from)
      if (app === "for") {
        here = PLACE_APP[part] || "";
        location.replace(manualFor(part));
        box.innerHTML = N.skeleton();
        return;
      }
      let M;
      try { M = await loadData("/shared/manual-data.js", "NovaManualData"); } catch (err) {
        box.innerHTML = `${empty({ icon: "book", title: "The manual's pages aren't here yet", text: "Run node scripts/build-manual.mjs in Portal to make them, or check the connection." })}<button type="button" class="btn wide" data-again>${icon("refresh")} Try again</button>`;
        return;
      }
      if (!M.apps.some((a) => a.id === "lossless")) {
        const at = M.apps.findIndex((a) => a.id === "console");
        M.apps.splice(at < 0 ? M.apps.length : at, 0, LOSSLESS);
        index = null;
      }
      // (what's new since you last looked: marked on the start, then counted as seen)
      const seenBefore = Date.parse(store.get(SEEN_KEY)) || 0;
      store.set(SEEN_KEY, new Date().toISOString());
      N.badge("help", 0);
      const toc = [];
      if (app === "addresses") {
        ui.back("#help"); ui.title("All addresses");
        box.innerHTML = addressesPage(M);
        wire(box, toc);
        return;
      }
      const a = app && app !== "start" ? M.apps.find((x) => x.id === app) : null;
      if (app && app !== "start" && !a) {
        ui.back("#help");
        box.innerHTML = empty({ icon: "book", title: "That app isn't in the manual", action: '<a class="btn" href="#help">The Manual</a>' });
        return;
      }
      if (a) {
        // (older addresses: news, and guide/built pages by chapter, still land in the right place)
        const tab = { news: "new" }[part] || (TABS.some(([t]) => t === part) ? part : "guide");
        const t = tab === "built" && !(a.built || []).length ? "guide" : tab;
        ui.back("#help"); ui.title(a.name);
        store.set(PLACE_KEY, JSON.stringify({ app: a.id, tab: t }));
        const body = appPage(M, a, t, toc, here);
        box.innerHTML = `${tocBar(toc)}${body}${toc.length > 2 || t === "history" ? top : ""}`;
        wire(box, toc);
        follow(box, toc, gid ? ((g) => (/^(m|c)-/.test(g) ? g : idOf(g)))(decodeURIComponent(gid)) : "");
        return;
      }
      // The start, and the search over it
      const startHtml = `${startPage(M, toc, here, seenBefore)}${toc.length > 2 ? top : ""}`;
      box.innerHTML = `<form class="manual-search" role="search" data-manual-search>${N.field({ label: "Search every app's manual", name: "q", type: "search", value: query, placeholder: "Search every app's manual", attrs: 'autocomplete="off" enterkeyhint="search"' })}</form>
        <div class="page-in manual-results" data-manual-results${query ? "" : " hidden"}>${query ? search(M, query) : ""}</div><div class="page-in" data-manual-start${query ? " hidden" : ""}>${startHtml}</div>`;
      box.querySelector(".manual-search .field > span").classList.add("sr");
      const form = box.querySelector("[data-manual-search]");
      const results = box.querySelector("[data-manual-results]");
      const start = box.querySelector("[data-manual-start]");
      let timer = 0;
      const run = () => {
        query = form.elements.q.value.trim();
        results.hidden = !query;
        start.hidden = Boolean(query);
        results.innerHTML = query ? search(M, query) : "";
      };
      form.elements.q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 160); });
      form.addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(timer); run(); form.elements.q.blur(); });
      wire(box, toc);
      follow(box, toc, app === "start" && part ? decodeURIComponent(part) : "");
    },
  });
})();
