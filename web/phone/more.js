// Nova Phone: More. You first (your planet, name, role and since when, as Nova Desk's Portal card: your profile,
// your Index, Settings, voice, signing out), then every place in Nova as its Nova tile (the same tiles as Nova
// Desk's dock), grouped as the studio knows them, each with its number waiting (as on the Nova tiles), or as a
// list that says what each place is for; Nova Phone's own (Settings, Today in music, Apps and links, Install);
// the look (themes, the same ones as Nova Desk's); and the status line. A place not yet made for the phone shows
// its tile faded, "Coming next" under it, and isn't a link (never a link to nowhere).
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, row, list, choices, toast, confirm, post } = N;
  // [address, name, tile]
  const GROUPS = [
    ["Studio", [["inbox", "Inbox", "portal"], ["inbox/alerts", "Alerts", "portal"], ["inbox/approvals", "Approvals", "portal"], ["calendar", "Calendar", "calendar"], ["clients", "Clients", "portal"], ["money", "Money", "invoicer"]]],
    ["Outreach", [["outreach", "Campaigns", "portal"], ["outreach/one", "One-to-one", "portal"], ["outreach/social", "Social", "portal"], ["outreach/funnel", "Funnel", "portal"]]],
    ["Plans", [["agent", "Agent", "chat"], ["agent/plan", "Today's plan", "missions"], ["agent/missions", "Missions", "missions"], ["quests", "Quests", "quests"], ["notes", "Notes", "notes"], ["board", "Board", "board"], ["index", "Index", "index"]]],
    ["Helpers", [["observatory", "Observatory", "observatory"], ["console", "Console", "console"], ["lossless", "Lossless", "lossless"], ["help", "Manual", "manual"], ["visualizer", "Nova", "visualizer"]]],
    ["You", [["you", "Your profile", "portal"], ["inbox/alert/phone", "Notifications", "portal"]]],
    ["Admin", [["crew", "The crew", "portal"], ["google", "Google", "portal"], ["computer", "Computer", "computer"], ["tests", "Test stuff", "portal"], ["fixer", "Fixer", "fixer"], ["admin/referrals", "Referrals", "portal"], ["admin/links", "Links", "portal"], ["admin/test-booking", "Test booking", "portal"]]],
  ];
  // What each place is for (Nova Desk's words under each tile, its Panels window)
  const DESC = {
    inbox: "Enquiries, with replies to send", "inbox/alerts": "What reached the phones", "inbox/approvals": "Booking changes waiting for an admin", calendar: "The one Nova Agent plans into",
    clients: "Everyone the studio works with", money: "Invoices at each stage, payments and expenses", outreach: "Emails to fans and clients who opted in", "outreach/one": "One-to-one emails, approved before they go",
    "outreach/social": "Facebook and Instagram posts", "outreach/funnel": "Prospects, first emails and the warm-up", agent: "The conversation with Nova Agent", "agent/plan": "Your day, planned",
    "agent/missions": "Your goals, planned into Quests", quests: "Every quest: add in your own words, today first", notes: "Notes and documents", board: "A table for notes, pictures and links",
    index: "Everything Nova Agent remembers: browse, edit, approve", observatory: "Every project, lines of code and the star map", console: "Type commands for all of Nova", lossless: "Raw sound between two devices, anywhere",
    help: "How everything in Nova works", visualizer: "Nova's browser helper, live", you: "Your planet, name, email and password", "inbox/alert/phone": "Notifications on this phone",
    crew: "Everyone, invites and roles", google: "Calendar, Contacts, Drive and Sheets", computer: "The VPS live: its sessions and how busy it is", tests: "What looks like test stuff, to tidy", fixer: "Every screen checked against the four rules",
  };
  const day = (d) => { const x = N.asDate(d); return x ? x.toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : ""; };
  const UK = { timeZone: "Europe/London" };
  const time12 = (d) => d.toLocaleTimeString("en-GB", { ...UK, hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s?([ap]m)$/i, (m, x) => " " + x.toLowerCase());
  const standalone = () => navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;

  N.section({
    id: "more",
    name: "More",
    async draw(box) {
      // Who you are (as last seen, then fresh)
      let me = N.me();
      if (!me) { try { await N.api("/auth/me"); me = N.me(); } catch (err) { if (err.signIn) me = null; } }
      const badges = N.badges();
      const asList = N.options().more === "list";
      const badge = (to) => (badges[to] ? `<b class="tab-badge">${badges[to] > 99 ? "99+" : badges[to]}</b>` : "");
      const tile = ([to, name, p]) => (N.has(to.split("/")[0])
        ? `<a class="tile" href="#${to}">${window.NovaTile(p)}<span>${esc(name)}</span>${badge(to)}</a>`
        : `<div class="tile soon" aria-label="${esc(name)}: coming next">${window.NovaTile(p)}<span>${esc(name)}</span><small>Coming next</small></div>`);
      const asRow = ([to, name, p]) => (N.has(to.split("/")[0])
        ? row({ href: `#${to}`, lead: window.NovaTile(p), title: name, text: DESC[to] || "", end: badge(to) })
        : row({ lead: window.NovaTile(p), title: name, text: `${DESC[to] ? `${DESC[to]} · ` : ""}Coming next`, cls: "more-soon" }));
      const groups = GROUPS.map(([g, items]) => `<h3 class="h">${g}</h3>${asList ? list(items.map(asRow)) : `<div class="tiles">${items.map(tile).join("")}</div>`}`).join("");
      const look = N.look, chosen = look ? look.get().theme : "";
      const themes = (look ? look.base : []).map((t) => `<button type="button" class="swatch" data-look-id="${esc(t.id)}" aria-pressed="${t.id === chosen}"><i data-swatch="${esc(t.id)}"></i>${esc(t.name)}</button>`).join("");
      const canVoice = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
      // (help for the place you came from: the Manual's page for it)
      const was = N.history().find((h) => !/^(settings|more|music)(\/|$)/.test(h.to));
      const wasId = was ? was.to.split("/")[0] : "";
      box.innerHTML = `
        ${me ? `<div class="card profile more-me">
          <img class="planet more-planet" src="/staff/${encodeURIComponent(me.id)}/planet.svg?size=224" alt="Your planet" width="96" height="96">
          <p class="kicker">Signed in with Portal</p>
          <h2 class="card-title">${esc(me.display_name || "You")}</h2>
          <p class="more-pills"><span class="pill">${me.role === "admin" ? "Admin" : "Staff"}</span>${me.created_at ? `<span class="pill">Since ${esc(day(me.created_at))}</span>` : ""}</p>
          ${me.planet && me.planet.name ? `<p class="muted more-world">✦ ${esc(me.planet.name)}</p>` : ""}
          ${me.planet && me.planet.description ? `<p class="small muted">${esc(me.planet.description)}</p>` : ""}
        </div>
        <div class="more-acts">
          <a class="more-act" href="#you">${icon("user")}<span>Your profile</span></a><a class="more-act" href="#index">${icon("book")}<span>Your Index</span></a>
          <a class="more-act" href="#settings">${icon("cog")}<span>Settings</span></a>${canVoice ? `<button type="button" class="more-act" data-m="voice">${icon("mic")}<span>Voice</span></button>` : ""}
        </div>` : `<div class="card"><p class="kicker">Portal</p><h2 class="card-title">Who's here?</h2><p class="muted">Sign in once with Portal and Nova Phone knows who you are.</p></div><div class="btns two"><a class="btn main" href="/portal/?app=1&next=${encodeURIComponent("/phone/#more")}">Sign in</a><a class="btn" href="#settings">${icon("cog")} Settings</a></div>`}
        <fieldset class="field more-view"><legend class="sr">Show the places as</legend><div class="seg">
          <label><input type="radio" name="more-view" value="tiles"${asList ? "" : " checked"}>Tiles</label><label><input type="radio" name="more-view" value="list"${asList ? " checked" : ""}>What each is for</label>
        </div></fieldset>
        ${groups}
        <h3 class="h">Nova Phone</h3>
        ${list([
          ...(wasId && wasId !== "help" && N.has("help") ? [row({ href: `#help/for/${encodeURIComponent(wasId)}`, lead: icon("book"), title: `Help for ${was.title || wasId}`, text: "How it works, in the Manual" })] : []),
          row({ href: "#settings", lead: icon("cog"), title: "Settings", text: "Look, sound, music, battery, where it opens" }),
          row({ href: "#music", lead: icon("music"), title: "Today in music", text: "The Top 10, genres, gear, the song of the day" }),
          row({ href: "#settings/links", lead: icon("link"), title: "Apps and links", text: "Every place, every address and its check" }),
          ...(standalone() ? [] : [row({ href: "#settings/install", lead: icon("download"), title: "Add to your Home Screen", text: "Full screen, and notifications on an iPhone" })]),
        ])}
        <h3 class="h">Look</h3><div class="swatch-grid">${themes}</div>
        ${list([row({ href: "#settings", lead: icon("palette"), title: "Every colour", text: "Eleven more, Custom from one colour, and your planet's" })])}
        ${me ? `<button type="button" class="btn danger wide" data-m="out">${icon("out")} Sign out everywhere</button>` : ""}
        <p class="muted small more-status" data-m-status></p>`;
      for (const t of look ? look.base : []) box.querySelector(`[data-swatch="${CSS.escape(t.id)}"]`)?.style.setProperty("--c", t.palette.hi);
      box.querySelector(".more-planet")?.addEventListener("error", (e) => (e.target.hidden = true));
      box.querySelector('[data-m="voice"]')?.addEventListener("click", () => N.voice());
      box.querySelector('[data-m="out"]')?.addEventListener("click", async () => {
        if (!(await confirm({ title: "Sign out everywhere?", text: "On this phone and every other place you're signed in.", ok: "Sign out", danger: true }))) return;
        try { await post("/auth/logout", {}); location.reload(); } catch (err) { toast(err.message, true); }
      });
      box.querySelector(".more-view").addEventListener("change", (e) => { N.setOption("more", e.target.value); N.show(); });
      // The status line, small, at the bottom: the version, when you came on and last left, the date
      statusLine(box.querySelector("[data-m-status]"));
      if (canVoice) N.script("voice.js").catch(() => {});
    },
  });
  async function statusLine(el) {
    const S = window.NOVA_STATUS || (await N.script(N.asset("/shared/status-data.js")).then(() => window.NOVA_STATUS).catch(() => null));
    if (!el.isConnected) return;
    // (Nova Phone's shell comes a moment after the first screen: then the line has when you came on too)
    if (!window.NovaPhoneShell) await new Promise((r) => setTimeout(r, 1500));
    if (!el.isConnected) return;
    const sh = window.NovaPhoneShell;
    const left = sh && sh.lastLeft();
    el.textContent = [S ? `Nova v${S.version} · build ${S.build}` : "", sh ? `Here since ${time12(new Date(sh.here()))}` : "", left ? `Last left ${new Date(left).toLocaleDateString("en-GB", { ...UK, weekday: "short" })} ${time12(new Date(left))}` : "", new Date().toLocaleDateString("en-GB", { ...UK, weekday: "short", day: "numeric", month: "short" })].filter(Boolean).join(" · ");
  }
  // A theme chosen here is the theme for Nova Phone and Nova Desk
  document.addEventListener("click", (e) => {
    const sw = e.target.closest(".swatch[data-look-id]");
    if (!sw || !N.look) return;
    N.look.set(sw.dataset.lookId);
    N.sound("theme");
    N.activity(`Theme: ${N.look.name(sw.dataset.lookId)}`);
    for (const b of document.querySelectorAll(".swatch[data-look-id]")) b.setAttribute("aria-pressed", String(b === sw));
  });
  // (the numbers change while More is open: drawn again, quietly)
  addEventListener("novaphonebadges", () => { if (location.hash.slice(1).split("/")[0] === "more" && !document.querySelector("dialog[open]")) N.show(); });
})();
