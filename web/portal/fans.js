// Fans (19 Oct 2026): Portal's sections as half fans, in place of the tab panel under the top panel
// (the user: "the fans were supposed to replace the button panel"). A half fan hangs from under the top
// panel with Portal's groups: Inbox, Bookings, Clients & Money, Outreach, Plans & Nova, You, Look &
// sound, and Admin (admins only). Each section is a chamfered blade (its corners cut). A group opens
// its own half fan, in the same place, of up to eight blades, each doing one real thing: a tab, a
// button pressed on its page, the Invoicer, a sheet. Nothing does a job by itself that its page would
// ask about first: it opens the place and presses the same button a person would.
//   The hub (the circle at the fan's centre): tap for Today (or Back, inside a group); hold for Voice.
//   The group and the blade you're on are lit, as the tabs were. Arrow keys move; Enter opens; Escape is Back.
// The tab panel stays in the page, hidden (its buttons are what the blades press, and its counts are
// read for the blades' badges). In Nova Agent's theme; calm: a fan opens like a hand fan, quickly,
// and not at all with reduced motion.
(function () {
  "use strict";
  if (window.PortalFans) return;
  const $ = (id) => document.getElementById(id);
  const SVG = "http://www.w3.org/2000/svg";
  const admin = () => Boolean(window.PortalPage && window.PortalPage.isAdmin && window.PortalPage.isAdmin());

  // ---- Doing things: the same as a person would ----
  const shown = (el) => el && (typeof el.checkVisibility === "function" ? el.checkVisibility() : el.offsetParent !== null);
  // Wait for a part of a page to be there (a tab just opened draws its parts), then do something with it
  function when(sel, fn, ms = 4000) {
    const t0 = Date.now();
    (function look() {
      const el = typeof sel === "function" ? sel() : document.querySelector(sel);
      if (el && (shown(el) || Date.now() - t0 > 900)) return fn(el);
      if (Date.now() - t0 > ms) return say("That isn't here just now.");
      setTimeout(look, 80);
    })();
  }
  const say = (text) => (window.PortalApp && window.PortalApp.kit ? window.PortalApp.kit.toast(text) : console.log(text));
  const tab = (view) => () => {
    const t = view === "agent" ? $("nav-agent") : view === "booking" ? $("nav-booking-tools") : document.querySelector(`.tabs .tab[data-view="${view}"]`);
    if (t) t.click();
  };
  const go = (url) => () => window.PortalPage && window.PortalPage.go(url, { replace: true });
  const press = (view, sel) => () => {
    tab(view)();
    when(sel, (el) => el.click());
  };
  const show = (view, sel, focus) => () => {
    (view.startsWith("/") ? go(view) : tab(view))();
    when(sel, (el) => {
      el.scrollIntoView({ block: "center", behavior: calm() ? "auto" : "smooth" });
      const f = focus ? document.querySelector(focus) : el;
      if (f && f.focus) f.focus({ preventScroll: true });
    });
  };
  const click = (sel) => () => when(sel, (el) => el.click());
  const options = (heading) => () => {
    $("options-btn").click();
    when(() => [...document.querySelectorAll("#options-sheet .kicker")].find((k) => k.textContent.trim() === heading), (el) => el.scrollIntoView({ block: "start", behavior: calm() ? "auto" : "smooth" }));
  };
  const invoicer = (what) => () => window.NovaInvoicer && window.NovaInvoicer.open(what);
  const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "calm";

  // ---- The groups and their blades (8 or fewer each; [admin] only for admins) ----
  // glyph: a small mark for each (the theme's own font draws it); badge: the tab's count shown on it
  const GROUPS = [
    { name: "Inbox", glyph: "✉", badges: ["new-badge", "alert-badge"], items: [
      { name: "Enquiries", glyph: "✉", badge: "new-badge", run: tab("enquiries") },
      { name: "Conversations", glyph: "❝", run: tab("chats") },
      { name: "Alerts", glyph: "◔", badge: "alert-badge", run: tab("alerts") },
      { name: "Saved replies", glyph: "❏", run: press("enquiries", "#saved-open") },
      { name: "Website bot", glyph: "✦", run: tab("bot") },
      { name: "Notifications", glyph: "◉", run: press("alerts", "#alerts-notify") },
    ] },
    { name: "Bookings", glyph: "◷", badges: ["approvals-badge"], items: [
      { name: "Calendar", glyph: "▦", run: tab("calendar") },
      { name: "Booking tools", glyph: "◫", run: tab("booking") },
      { name: "Approvals", glyph: "✓", badge: "approvals-badge", run: tab("approvals") },
      { name: "Ask about this week", glyph: "✦", run: press("booking", "#view-calendar .smart-ask") },
      { name: "Booking link", glyph: "⛓", run: () => { tab("enquiries")(); say("Choose who it's for: Booking link is on their enquiry."); } },
      { name: "Test booking", glyph: "⚑", admin: true, run: go("/portal/?view=manage&page=test-booking") },
    ] },
    { name: "Clients & Money", glyph: "£", badges: ["money-badge"], items: [
      { name: "Clients", glyph: "☺", run: tab("clients") },
      { name: "Add a client", glyph: "+", run: press("clients", "#clients-add") },
      { name: "Sync with Acuity", glyph: "↻", admin: true, run: press("clients", "#clients-sync") },
      { name: "Import clients", glyph: "⇣", admin: true, run: press("clients", "#clients-import-open") },
      { name: "Money", glyph: "£", badge: "money-badge", run: tab("money") },
      { name: "Write an invoice", glyph: "✎", run: invoicer({ new: true }) },
      { name: "Add an expense", glyph: "−", run: press("money", "#money-expense-new") },
      { name: "Overdue invoices", glyph: "!", run: invoicer({ filter: "overdue" }) },
    ] },
    { name: "Outreach", glyph: "➶", badges: ["campaigns-badge", "social-badge"], items: [
      { name: "Campaigns", glyph: "✉", badge: "campaigns-badge", run: tab("campaigns") },
      { name: "Write a campaign", glyph: "✎", run: press("campaigns", "#campaigns-new") },
      { name: "One-to-one email", glyph: "➝", run: press("campaigns", "#outreach-new") },
      { name: "Don't email again", glyph: "⊘", run: show("campaigns", "#outreach-optout", "#or-optout-email") },
      { name: "Social", glyph: "◈", badge: "social-badge", run: tab("social") },
      { name: "Write a post", glyph: "✎", run: press("social", "#social-new") },
      { name: "Fan sign-up link", glyph: "⛓", run: show("campaigns", "#campaigns-signup") },
      { name: "Ads Manager", glyph: "↗", run: () => window.open("https://adsmanager.facebook.com/", "_blank", "noopener") },
    ] },
    { name: "Plans & Nova", glyph: "✧", badges: ["quest-badge"], items: [
      { name: "Quests", glyph: "✧", badge: "quest-badge", run: tab("quests") },
      { name: "Everyone's quests", glyph: "☷", admin: true, run: press("quests", '#quests-who [data-quests-who="everyone"]') },
      { name: "Nova Agent", glyph: "✦", run: tab("agent") },
      { name: "Ask Nova", glyph: "?", run: () => { tab("bot")(); when('#view-bot [data-mode="nova"]', (el) => { if (!el.classList.contains("active")) el.click(); $("bot-input") && $("bot-input").focus(); }); } },
      { name: "Hands-free", glyph: "◎", run: () => { $("voice-sheet").hidden = false; $("handsfree-switch") && $("handsfree-switch").focus(); } },
      { name: "My Index", glyph: "◍", run: show("/portal/?view=me", "#open-index") },
      { name: "Manual", glyph: "?", run: () => { const m = document.querySelector("nova-manual"); if (m && m.open) m.open(); } },
    ] },
    { name: "You", glyph: "◐", items: [
      { name: "Your profile", glyph: "◐", run: go("/portal/?view=me") },
      { name: "Re-roll planet", glyph: "↻", run: show("/portal/?view=me", "#reroll") },
      { name: "Edit your name", glyph: "✎", run: press("you", "#edit-name") },
      { name: "Change email", glyph: "@", run: show("/portal/?view=me", "#email-card", "#email-new") },
      { name: "Change password", glyph: "⚿", run: show("/portal/?view=me", "#password-card", "#password-new") },
      { name: "All addresses", glyph: "⌘", run: show("/portal/?view=me", "#addresses-card") },
      { name: "How it works", glyph: "⚙", run: show("/portal/?view=me", "#group-tech-head") },
      { name: "Sign out", glyph: "⏻", run: show("/portal/?view=me", "#signout-card", "#sign-out") },
    ] },
    { name: "Look & sound", glyph: "◑", items: [
      { name: "Options", glyph: "⚙", run: () => $("options-btn").click() },
      { name: "Theme", glyph: "◑", run: options("Theme") },
      { name: "Text & menu", glyph: "A", run: options("Text") },
      { name: "Starting tab", glyph: "⌂", run: options("Starting tab") },
      { name: "Music on or off", glyph: "♫", run: () => $("music").click() },
      { name: "Music variation", glyph: "♪", run: options("Sound") },
      { name: "Refresh everything", glyph: "↻", run: () => { $("options-btn").click(); when("#refresh", (el) => el.focus()); } },
      { name: "Install the app", glyph: "⇩", run: () => window.NovaInstall && window.NovaInstall.open() },
    ] },
    { name: "Admin", glyph: "♛", admin: true, badges: ["tests-badge"], items: [
      { name: "Admin pages", glyph: "♛", admin: true, run: go("/portal/?view=manage") },
      { name: "The crew", glyph: "☺", admin: true, run: go("/portal/?view=crew") },
      { name: "Invite someone", glyph: "+", admin: true, run: () => { go("/portal/?view=crew")(); when("#invite-toggle", (el) => el.click()); } },
      { name: "Google", glyph: "G", admin: true, run: tab("google") },
      { name: "Links", glyph: "⛓", admin: true, run: go("/portal/?view=manage&page=links") },
      { name: "Test stuff", glyph: "⚑", admin: true, badge: "tests-badge", run: tab("tests") },
      { name: "Computer", glyph: "▣", admin: true, run: tab("desk") },
      { name: "Apps and links", glyph: "⌘", admin: true, run: () => $("brand").click() },
    ] },
  ];
  const count = (id) => {
    const b = $(id);
    const n = b && !b.hidden && Number(String(b.textContent).replace(/\D/g, ""));
    return n > 0 ? n : 0;
  };

  // ---- Drawing a half fan ----
  // A blade: the slice between two angles, from the inner ring to the outer, with each of its four
  // corners cut (the chamfer). Angles in degrees, 180 (left) over the top to 0 (right).
  function blade(cx, cy, r0, r1, a0, a1, c) {
    const rad = (d) => (d * Math.PI) / 180;
    const at = (r, d) => [cx + r * Math.cos(rad(d)), cy - r * Math.sin(rad(d))];
    const dOut = (c / r1) * (180 / Math.PI);
    const dIn = (c / r0) * (180 / Math.PI);
    const pts = (p) => p.map((n) => n.toFixed(2)).join(" ");
    // (a0 is the larger angle: the blade runs from a0 down to a1, clockwise on screen)
    const o0 = at(r1, a0 - dOut), o1 = at(r1, a1 + dOut);
    const e1a = at(r1 - c, a1), e1b = at(r0 + c, a1);
    const i1 = at(r0, a1 + dIn), i0 = at(r0, a0 - dIn);
    const e0a = at(r0 + c, a0), e0b = at(r1 - c, a0);
    const big = a0 - a1 - 2 * dOut > 180 ? 1 : 0;
    return `M ${pts(o0)} A ${r1} ${r1} 0 ${big} 1 ${pts(o1)} L ${pts(e1a)} L ${pts(e1b)} L ${pts(i1)} A ${r0} ${r0} 0 0 0 ${pts(i0)} L ${pts(e0a)} L ${pts(e0b)} Z`;
  }

  // Where you are: the tab open (or the profile, Admin, the crew), for lighting its group and blade
  const AT = { Enquiries: "enquiries", Conversations: "chats", Alerts: "alerts", "Website bot": "bot", "Booking tools": "calendar", Approvals: "approvals", Clients: "clients", Money: "money", Campaigns: "campaigns", Social: "social", Quests: "quests", "Your profile": "me", "Admin pages": "admin", "The crew": "crew", Google: "google", "Test stuff": "tests", Computer: "desk" };
  function here() {
    const v = new URLSearchParams(location.search).get("view") || "";
    if (v === "manage" || v === "admin") return "admin";
    if (v === "crew") return "crew";
    if (v === "me" || v === "you" || new URLSearchParams(location.search).get("id")) return "me";
    return (window.PortalApp && window.PortalApp.view) || v || "today";
  }
  const isHere = (it) => (it.items ? it.items.some((x) => AT[x.name] === here()) : AT[it.name] === here());

  let dock = null; // the fans, where the tab panel was
  let level = null; // null: the groups; else the group open
  let focusAt = 0;
  let drawnSig = "";

  function itemsNow() {
    if (!level) return GROUPS.filter((g) => !g.admin || admin()).filter((g) => g.items.some((i) => !i.admin || admin()));
    return level.items.filter((i) => !i.admin || admin());
  }
  // The fan's size: the panel's width, and never more than a third of the screen's height
  function geometry() {
    const W = Math.max(240, dock.clientWidth || innerWidth);
    const r1 = Math.round(Math.max(104, Math.min(W / 2 - 12, innerHeight * 0.34, 200)));
    const r0 = Math.max(40, Math.round(r1 * 0.29));
    const hub = r0 - 8;
    const cy = hub + 4;
    return { W, H: cy + r1 + 6, cx: W / 2, cy, r1, r0, hub };
  }
  // Words along a blade, turned to read upright
  const upright = (deg) => {
    let r = -deg % 360;
    if (r > 180) r -= 360;
    if (r <= -180) r += 360;
    if (r > 90) r -= 180;
    if (r <= -90) r += 180;
    return r;
  };

  function draw(opening) {
    if (!dock) return;
    const g = geometry();
    const list = itemsNow();
    const n = list.length;
    const gap = n > 6 ? 1.4 : 2;
    const step = 180 / n;
    const c = Math.max(5, Math.min(10, g.r1 * 0.045));
    const svg = dock.querySelector("svg");
    svg.setAttribute("viewBox", `0 0 ${g.W} ${g.H}`);
    svg.setAttribute("width", g.W);
    svg.setAttribute("height", g.H);
    svg.setAttribute("aria-label", level ? level.name : "Portal's sections");
    dock.style.height = `${g.H}px`;
    const fan = svg.querySelector(".fan-blades");
    fan.replaceChildren();
    list.forEach((it, i) => {
      // (the fan hangs down: from the left (180°) under the hub to the right (360°))
      const a0 = 180 + (i + 1) * step - gap / 2;
      const a1 = 180 + i * step + gap / 2;
      const mid = (a0 + a1) / 2;
      const rad = (mid * Math.PI) / 180;
      const lit = isHere(it);
      const b = document.createElementNS(SVG, "g");
      b.setAttribute("class", "fan-blade" + (i % 2 ? " pleat" : "") + (lit ? " here" : ""));
      b.setAttribute("role", level ? "menuitem" : "button");
      b.setAttribute("tabindex", i === focusAt ? "0" : "-1");
      const nb = level ? count(it.badge || "") : (it.badges || []).reduce((s, id) => s + count(id), 0);
      b.setAttribute("aria-label", it.name + (nb ? `, ${nb} new` : "") + (level ? "" : ", opens its fan") + (lit ? " (you're here)" : ""));
      if (lit) b.setAttribute("aria-current", "page");
      b.dataset.i = i;
      b.style.setProperty("--fold", `${mid - 180 - step / 2}deg`);
      b.style.setProperty("--i", i);
      b.style.transformOrigin = `${g.cx}px ${g.cy}px`;
      const path = document.createElementNS(SVG, "path");
      path.setAttribute("class", "fan-shape");
      path.setAttribute("d", blade(g.cx, g.cy, g.r0, g.r1, a0, a1, c));
      const rib = document.createElementNS(SVG, "path");
      rib.setAttribute("class", "fan-rib");
      rib.setAttribute("d", `M ${g.cx + (g.r0 + c * 1.5) * Math.cos(rad)} ${g.cy - (g.r0 + c * 1.5) * Math.sin(rad)} L ${g.cx + (g.r1 - c * 1.5) * Math.cos(rad)} ${g.cy - (g.r1 - c * 1.5) * Math.sin(rad)}`);
      const rim = document.createElementNS(SVG, "path");
      rim.setAttribute("class", "fan-rim");
      rim.setAttribute("d", blade(g.cx, g.cy, g.r1 - 3.5, g.r1 - 1.5, a0, a1, Math.min(c, 2)));
      b.append(path, rib, rim);
      const glyphR = g.r1 - c - 13;
      const glyph = document.createElementNS(SVG, "text");
      glyph.setAttribute("class", "fan-glyph");
      glyph.setAttribute("x", g.cx + glyphR * Math.cos(rad));
      glyph.setAttribute("y", g.cy - glyphR * Math.sin(rad));
      glyph.textContent = it.glyph || "✦";
      const textR = (g.r0 + glyphR - 12) / 2 + 3;
      const tx = g.cx + textR * Math.cos(rad);
      const ty = g.cy - textR * Math.sin(rad);
      const label = document.createElementNS(SVG, "text");
      label.setAttribute("class", "fan-label" + (level ? "" : " group"));
      label.setAttribute("x", tx);
      label.setAttribute("y", ty);
      label.setAttribute("transform", `rotate(${upright(mid).toFixed(2)} ${tx.toFixed(2)} ${ty.toFixed(2)})`);
      label.textContent = it.name;
      b.append(glyph, label);
      if (nb) {
        const ba = ((a1 + Math.min(5, step / 3)) * Math.PI) / 180;
        const bx = g.cx + (g.r1 - c - 5) * Math.cos(ba);
        const by = g.cy - (g.r1 - c - 5) * Math.sin(ba);
        const dot = document.createElementNS(SVG, "circle");
        dot.setAttribute("class", "fan-badge");
        dot.setAttribute("cx", bx);
        dot.setAttribute("cy", by);
        dot.setAttribute("r", 8.5);
        const num = document.createElementNS(SVG, "text");
        num.setAttribute("class", "fan-badge-n");
        num.setAttribute("x", bx);
        num.setAttribute("y", by);
        num.textContent = nb > 99 ? "99" : String(nb);
        b.append(dot, num);
      }
      b.addEventListener("click", () => choose(i));
      b.addEventListener("focus", () => (focusAt = i));
      fan.append(b);
      fit(label, g.r1 - g.r0 - c * 2 - 30, (g.r0 + g.r1) / 2, step);
    });
    // The hub: Today (or Back to the groups); hold for Voice
    const hub = svg.querySelector(".fan-hub");
    const circle = hub.querySelector("circle");
    circle.setAttribute("cx", g.cx);
    circle.setAttribute("cy", g.cy);
    circle.setAttribute("r", g.hub);
    const [mark, word] = hub.querySelectorAll("text");
    mark.setAttribute("x", g.cx);
    mark.setAttribute("y", g.cy - g.hub * 0.22);
    mark.textContent = level ? "←" : "⌂";
    word.setAttribute("x", g.cx);
    word.setAttribute("y", g.cy + g.hub * 0.32);
    word.textContent = level ? "Back" : "Today";
    hub.classList.toggle("here", !level && here() === "today");
    hub.setAttribute("aria-label", level ? `Back to Portal's groups (hold for Voice)` : "Today (hold for Voice)");
    if (opening && !calm()) {
      dock.classList.remove("open");
      void dock.getBoundingClientRect();
    }
    dock.classList.add("open");
    drawnSig = sig();
  }
  // Words that don't fit along their blade get smaller (never under 9px): never cut, never on two lines
  function fit(label, room, midR, step) {
    const across = 2 * midR * Math.sin(((step / 2) * Math.PI) / 180) - 8;
    let size = Math.min(level ? 13 : 14, Math.max(9, across * 0.62));
    label.style.fontSize = `${size}px`;
    try {
      let len = label.getComputedTextLength();
      while (len > room && size > 9) {
        size -= 0.5;
        label.style.fontSize = `${size}px`;
        len = label.getComputedTextLength();
      }
    } catch (e) {
      /* (not drawn yet) */
    }
  }
  // What's drawn depends on: where you are, the counts, who you are, the width
  const sig = () => [here(), admin(), level && level.name, Math.round((dock && dock.clientWidth) || 0), Math.round(innerHeight / 20), ...["new-badge", "alert-badge", "approvals-badge", "money-badge", "campaigns-badge", "social-badge", "quest-badge", "tests-badge"].map(count)].join("|");

  function choose(i) {
    const it = itemsNow()[i];
    if (!it) return;
    if (!level) {
      level = it;
      focusAt = Math.max(0, itemsNow().findIndex(isHere));
      draw(true);
      focusBlade(focusAt);
      return;
    }
    focusAt = i;
    try {
      it.run();
    } catch (err) {
      say("That didn't open: " + (err.message || err));
    }
    setTimeout(() => draw(false), 350);
  }
  function back() {
    const was = level;
    level = null;
    focusAt = Math.max(0, itemsNow().indexOf(was));
    draw(true);
    focusBlade(focusAt);
  }
  function focusBlade(i) {
    const blades = dock.querySelectorAll(".fan-blade");
    if (!blades.length) return;
    focusAt = (i + blades.length) % blades.length;
    blades.forEach((b, j) => b.setAttribute("tabindex", j === focusAt ? "0" : "-1"));
    blades[focusAt].focus({ preventScroll: true });
  }
  // The hub: a tap is Today (or Back), a hold (half a second) is Voice
  function hubPress(hub) {
    let timer = 0;
    let held = false;
    hub.addEventListener("pointerdown", () => {
      held = false;
      timer = setTimeout(() => {
        held = true;
        $("voice") && !$("voice").hidden ? $("voice").click() : say("Voice isn't available here.");
      }, 500);
    });
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) hub.addEventListener(ev, () => clearTimeout(timer));
    hub.addEventListener("contextmenu", (e) => e.preventDefault());
    hub.addEventListener("click", () => {
      if (held) return;
      if (level) return back();
      tab("today")();
      setTimeout(() => draw(false), 300);
    });
    hub.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        hub.dispatchEvent(new MouseEvent("click"));
      }
    });
  }
  function keys(e) {
    if (e.key === "Escape" && level) {
      e.preventDefault();
      back();
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      focusBlade(focusAt + 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      focusBlade(focusAt - 1);
    } else if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("fan-blade")) {
      e.preventDefault();
      choose(Number(e.target.dataset.i));
    } else if (e.key === "Backspace" && level) {
      e.preventDefault();
      back();
    }
  }

  // ---- In place of the tab panel ----
  function start() {
    const main = $("main");
    if (!main) return;
    dock = document.createElement("nav");
    dock.className = "fan-dock";
    dock.setAttribute("aria-label", "Portal's sections");
    dock.innerHTML = `<svg class="fan-svg" xmlns="${SVG}" role="group">
        <defs>
          <linearGradient id="fan-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="fan-stop-a"/><stop offset="1" class="fan-stop-b"/></linearGradient>
          <linearGradient id="fan-lit" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="fan-lit-a"/><stop offset="1" class="fan-lit-b"/></linearGradient>
        </defs>
        <g class="fan-blades"></g>
        <g class="fan-hub" role="button" tabindex="0"><circle/><text class="fan-hub-mark"></text><text class="fan-hub-word"></text></g>
      </svg>`;
    // (exactly where the tab panel is: inside Nova Agent it's in the header's box with the top panel)
    const nav = document.querySelector("nav.tabs");
    if (nav && nav.parentElement && !nav.parentElement.classList.contains("app")) nav.after(dock);
    else main.before(dock);
    document.documentElement.classList.add("fans-dock");
    hubPress(dock.querySelector(".fan-hub"));
    dock.addEventListener("keydown", keys);
    draw(true);
    // Kept up to date: where you are, the counts, the width (cheap: drawn again only when one changes)
    const refresh = () => {
      // (the tab panel is moved into the header's box inside Nova Agent once Portal has drawn: follow it)
      const nav = document.querySelector("nav.tabs");
      if (nav && nav.parentElement && !nav.parentElement.classList.contains("app") && nav.nextElementSibling !== dock) nav.after(dock);
      if (sig() !== drawnSig) draw(false);
    };
    setInterval(refresh, 1000);
    addEventListener("resize", refresh);
    addEventListener("popstate", () => setTimeout(refresh, 200));
    document.addEventListener("click", (e) => {
      if (!dock.contains(e.target)) setTimeout(refresh, 300);
    });
    new ResizeObserver(refresh).observe(dock);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
  window.PortalFans = { groups: GROUPS, back, redraw: () => draw(false) };
})();
