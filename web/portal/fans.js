// Fans (19 Oct 2026): everything in Portal from one button, as half fans. The ✦ button (bottom right,
// above the tabs) opens a half fan of Portal's groups: Inbox, Bookings, Clients & Money, Outreach,
// Plans & Nova, You, Look & sound, and Admin (admins only). Each section is a chamfered blade (its
// corners cut). A group opens its own half fan of up to eight blades, each doing one real thing:
// a tab, a button pressed on its page, the Invoicer, a sheet. Nothing here does a job by itself that
// its page would ask about first: it opens the place and presses the same button a person would.
//   The hub (the circle at the fan's centre): tap for Today (or back, inside a group); hold for Voice.
//   Escape or a tap outside closes it. Arrow keys move between blades; Enter opens one.
// In Nova Agent's theme (its colours from /shared/themes.css), calm: the fan opens like a hand fan
// (each blade turns out from the first), and not at all with reduced motion.
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

  let root = null; // the open fan's layer
  let level = null; // null: the groups; else the group open
  let focusAt = 0;
  let launcher = null;

  function geometry() {
    const W = innerWidth;
    const H = innerHeight;
    const bar = barTop();
    const cx = W / 2;
    // (the hub sits whole above the tabs: the fan's straight edge is its middle)
    let r1 = Math.max(120, Math.min(W / 2 - 10, bar - 110, 330));
    let r0 = Math.max(44, Math.round(r1 * 0.3));
    const cy = bar - (r0 - 9) - 8;
    r1 = Math.max(110, Math.min(r1, cy - 58));
    r0 = Math.max(44, Math.round(r1 * 0.3));
    return { W, H, cx, cy, r1, r0 };
  }
  // The top of Portal's tabs when they sit along the bottom (a phone), else the bottom of the screen
  function barTop() {
    const nav = document.querySelector("nav.tabs");
    if (nav && shown(nav)) {
      const r = nav.getBoundingClientRect();
      if (r.bottom >= innerHeight - 4 && r.top > innerHeight / 2) return r.top;
    }
    return innerHeight - Math.max(8, parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sab")) || 0);
  }

  function itemsNow() {
    if (!level) return GROUPS.filter((g) => !g.admin || admin()).filter((g) => g.items.some((i) => !i.admin || admin()));
    return level.items.filter((i) => !i.admin || admin());
  }

  function draw(opening) {
    const g = geometry();
    const list = itemsNow();
    const n = list.length;
    const gap = n > 6 ? 1.4 : 2;
    const step = 180 / n;
    const c = Math.max(5, Math.min(11, g.r1 * 0.04));
    const svg = root.querySelector("svg");
    svg.setAttribute("viewBox", `0 0 ${g.W} ${g.H}`);
    svg.setAttribute("width", g.W);
    svg.setAttribute("height", g.H);
    const fan = svg.querySelector(".fan-blades");
    fan.replaceChildren();
    fan.style.transformOrigin = `${g.cx}px ${g.cy}px`;
    list.forEach((it, i) => {
      const a0 = 180 - i * step - gap / 2;
      const a1 = 180 - (i + 1) * step + gap / 2;
      const mid = (a0 + a1) / 2;
      const b = document.createElementNS(SVG, "g");
      b.setAttribute("class", "fan-blade" + (i % 2 ? " pleat" : ""));
      b.setAttribute("role", "menuitem");
      b.setAttribute("tabindex", "-1");
      b.setAttribute("aria-label", it.name + (count(it.badge || "") ? `, ${count(it.badge)} new` : "") + (level ? "" : ", opens its fan"));
      b.dataset.i = i;
      // (the hand fan opening: each blade turns out from the first one's place)
      b.style.setProperty("--fold", `${(180 - mid) - step / 2}deg`);
      b.style.setProperty("--i", i);
      b.style.transformOrigin = `${g.cx}px ${g.cy}px`;
      const path = document.createElementNS(SVG, "path");
      path.setAttribute("class", "fan-shape");
      path.setAttribute("d", blade(g.cx, g.cy, g.r0, g.r1, a0, a1, c));
      // the rib: a fine line down the blade's middle, like a hand fan's
      const rib = document.createElementNS(SVG, "path");
      rib.setAttribute("class", "fan-rib");
      const rad = (mid * Math.PI) / 180;
      rib.setAttribute("d", `M ${g.cx + (g.r0 + c * 1.5) * Math.cos(rad)} ${g.cy - (g.r0 + c * 1.5) * Math.sin(rad)} L ${g.cx + (g.r1 - c * 1.5) * Math.cos(rad)} ${g.cy - (g.r1 - c * 1.5) * Math.sin(rad)}`);
      // the rim: a line along the outer edge, in the theme's glow
      const rim = document.createElementNS(SVG, "path");
      rim.setAttribute("class", "fan-rim");
      rim.setAttribute("d", blade(g.cx, g.cy, g.r1 - 3.5, g.r1 - 1.5, a0, a1, Math.min(c, 2)));
      b.append(path, rib, rim);
      // The words, along the blade (read from the outside in on the left, the inside out on the right)
      const glyphR = g.r1 - c - 15;
      const gx = g.cx + glyphR * Math.cos(rad);
      const gy = g.cy - glyphR * Math.sin(rad);
      const glyph = document.createElementNS(SVG, "text");
      glyph.setAttribute("class", "fan-glyph");
      glyph.setAttribute("x", gx);
      glyph.setAttribute("y", gy);
      glyph.textContent = it.glyph || "✦";
      const textR = (g.r0 + glyphR - 14) / 2 + 4;
      const tx = g.cx + textR * Math.cos(rad);
      const ty = g.cy - textR * Math.sin(rad);
      const turn = mid > 90 ? 180 - mid : -mid;
      const label = document.createElementNS(SVG, "text");
      label.setAttribute("class", "fan-label" + (level ? "" : " group"));
      label.setAttribute("x", tx);
      label.setAttribute("y", ty);
      label.setAttribute("transform", `rotate(${turn.toFixed(2)} ${tx.toFixed(2)} ${ty.toFixed(2)})`);
      label.textContent = it.name;
      b.append(glyph, label);
      const n2 = level ? count(it.badge || "") : (it.badges || []).reduce((s, id) => s + count(id), 0);
      if (n2) {
        const bx = g.cx + (g.r1 - c - 4) * Math.cos(((a1 + 4) * Math.PI) / 180);
        const by = g.cy - (g.r1 - c - 4) * Math.sin(((a1 + 4) * Math.PI) / 180);
        const dot = document.createElementNS(SVG, "circle");
        dot.setAttribute("class", "fan-badge");
        dot.setAttribute("cx", bx);
        dot.setAttribute("cy", by);
        dot.setAttribute("r", 8.5);
        const num = document.createElementNS(SVG, "text");
        num.setAttribute("class", "fan-badge-n");
        num.setAttribute("x", bx);
        num.setAttribute("y", by);
        num.textContent = n2 > 99 ? "99" : String(n2);
        b.append(dot, num);
      }
      b.addEventListener("click", () => choose(i));
      b.addEventListener("pointerenter", () => caption(it));
      b.addEventListener("focus", () => caption(it));
      fan.append(b);
      fit(label, (g.r1 - g.r0) - c * 2 - 34, g.r0 + (g.r1 - g.r0) / 2, step);
    });
    // The hub
    const hub = svg.querySelector(".fan-hub");
    hub.querySelector("circle").setAttribute("cx", g.cx);
    hub.querySelector("circle").setAttribute("cy", g.cy);
    hub.querySelector("circle").setAttribute("r", g.r0 - 9);
    const ht = hub.querySelector("text");
    ht.setAttribute("x", g.cx);
    ht.setAttribute("y", g.cy - (g.r0 - 9) * 0.28);
    ht.textContent = level ? "←" : "⌂";
    const hs = hub.querySelectorAll("text")[1];
    hs.setAttribute("x", g.cx);
    hs.setAttribute("y", g.cy - (g.r0 - 9) * 0.28 + 15);
    hs.textContent = level ? "Back" : "Today";
    hub.setAttribute("aria-label", level ? "Back to the groups (hold for Voice)" : "Today (hold for Voice)");
    // The caption: what the blade under the finger is, above the fan
    const cap = root.querySelector(".fan-caption");
    cap.style.left = `${g.cx}px`;
    cap.style.top = `${Math.max(6, g.cy - g.r1 - 46)}px`;
    cap.hidden = g.cy - g.r1 - 46 < 4;
    caption(level ? { name: level.name, hint: "Choose one" } : { name: "Portal", hint: "Choose a group" });
    if (opening && !calm()) {
      root.classList.remove("open");
      void root.offsetWidth;
    }
    root.classList.add("open");
    focusAt = Math.min(focusAt, n - 1);
  }
  // Words that don't fit along their blade get smaller (never under 9px): never cut, never on two lines
  function fit(label, room, midR, step) {
    let size = level ? 13 : 14;
    // (a narrow blade's own width limits the words' height too)
    const across = 2 * midR * Math.sin(((step / 2) * Math.PI) / 180) - 8;
    size = Math.min(size, Math.max(9, across * 0.62));
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
  function caption(it) {
    const cap = root && root.querySelector(".fan-caption");
    if (!cap) return;
    cap.querySelector("b").textContent = it.name;
    cap.querySelector("small").textContent = it.hint || (it.items ? `${it.items.filter((x) => !x.admin || admin()).length} things` : it.admin ? "Admins only" : "");
  }

  function choose(i) {
    const it = itemsNow()[i];
    if (!it) return;
    if (!level) {
      level = it;
      focusAt = 0;
      draw(true);
      focusBlade(0);
      return;
    }
    close();
    try {
      it.run();
    } catch (err) {
      say("That didn't open: " + (err.message || err));
    }
  }
  function focusBlade(i) {
    const blades = root.querySelectorAll(".fan-blade");
    if (!blades.length) return;
    focusAt = (i + blades.length) % blades.length;
    blades[focusAt].focus({ preventScroll: true });
  }

  // ---- Open and close ----
  function open() {
    if (root) return close();
    level = null;
    focusAt = 0;
    root = document.createElement("div");
    root.className = "fans";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Portal's fans: everything in Portal");
    root.innerHTML = `<div class="fan-scrim"></div><p class="fan-caption" aria-live="polite"><b></b><small></small></p>
      <svg class="fan-svg" xmlns="${SVG}" role="menu" aria-label="Portal">
        <defs>
          <linearGradient id="fan-fill" x1="0" y1="1" x2="0" y2="0"><stop offset="0" class="fan-stop-a"/><stop offset="1" class="fan-stop-b"/></linearGradient>
          <linearGradient id="fan-lit" x1="0" y1="1" x2="1" y2="0"><stop offset="0" class="fan-lit-a"/><stop offset="1" class="fan-lit-b"/></linearGradient>
        </defs>
        <g class="fan-blades"></g>
        <g class="fan-hub" role="button" tabindex="0"><circle/><text class="fan-hub-mark"></text><text class="fan-hub-word"></text></g>
      </svg>`;
    document.body.append(root);
    document.documentElement.classList.add("fans-open");
    launcher.setAttribute("aria-expanded", "true");
    root.querySelector(".fan-scrim").addEventListener("click", close);
    root.addEventListener("click", (e) => {
      if (e.target === root || e.target.classList.contains("fan-svg")) close();
    });
    hubPress(root.querySelector(".fan-hub"));
    root.addEventListener("keydown", keys);
    draw(true);
    requestAnimationFrame(() => focusBlade(0));
  }
  function close() {
    if (!root) return;
    const r = root;
    root = null;
    level = null;
    document.documentElement.classList.remove("fans-open");
    launcher.setAttribute("aria-expanded", "false");
    r.classList.remove("open");
    setTimeout(() => r.remove(), calm() ? 0 : 160);
    launcher.focus({ preventScroll: true });
  }
  // The hub: a tap is Today (or back), a hold (half a second) is Voice
  function hubPress(hub) {
    let timer = 0;
    let held = false;
    const start = () => {
      held = false;
      timer = setTimeout(() => {
        held = true;
        close();
        $("voice") && !$("voice").hidden ? $("voice").click() : say("Voice isn't available here.");
      }, 500);
    };
    const end = () => clearTimeout(timer);
    hub.addEventListener("pointerdown", start);
    hub.addEventListener("pointerup", end);
    hub.addEventListener("pointerleave", end);
    hub.addEventListener("contextmenu", (e) => e.preventDefault());
    hub.addEventListener("click", () => {
      if (held) return;
      if (level) {
        level = null;
        draw(true);
        focusBlade(0);
        return;
      }
      close();
      tab("today")();
    });
    hub.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        hub.dispatchEvent(new MouseEvent("click"));
      }
    });
  }
  function keys(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (level) {
        level = null;
        draw(true);
        focusBlade(0);
      } else close();
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
      level = null;
      draw(true);
      focusBlade(0);
    }
  }

  // ---- The ✦ button that opens them ----
  // (never over something to press: right, else left, else a little higher; and out of the way while typing)
  const PRESSABLE = 'button, a[href], input, select, textarea, [role="button"], [contenteditable="true"], summary, label';
  function covers(side, lift) {
    const size = 52;
    const bottom = Math.max(12, innerHeight - barTop() + 12) + lift;
    const x0 = side === "right" ? innerWidth - Math.max(14, 0) - size : 14;
    const y0 = innerHeight - bottom - size;
    for (const [x, y] of [[x0 + size / 2, y0 + size / 2], [x0 + 6, y0 + 6], [x0 + size - 6, y0 + 6], [x0 + 6, y0 + size - 6], [x0 + size - 6, y0 + size - 6]]) {
      for (const el of document.elementsFromPoint(x, y)) {
        if (el === launcher || launcher.contains(el)) continue;
        if (el.closest(PRESSABLE) && !el.closest(".fan-launcher")) return true;
        break;
      }
    }
    return false;
  }
  function placeLauncher() {
    if (!launcher) return;
    const typing = document.activeElement && document.activeElement.matches && document.activeElement.matches("input, textarea, select, [contenteditable='true']");
    const sheetOpen = [...document.querySelectorAll(".sheet, #options-sheet, #voice-sheet, #suite-sheet, #notify-sheet, #more-sheet")].some((x) => !x.hidden);
    launcher.classList.toggle("away", Boolean(typing || sheetOpen));
    const base = Math.max(12, innerHeight - barTop() + 12);
    for (const [side, lift] of [["right", 0], ["left", 0], ["right", 64], ["left", 64], ["right", 128]]) {
      if (!covers(side, lift)) {
        launcher.style.bottom = `${base + lift}px`;
        launcher.style.right = side === "right" ? "" : "auto";
        launcher.style.left = side === "left" ? "max(14px, env(safe-area-inset-left))" : "";
        return;
      }
    }
    launcher.style.bottom = `${base}px`;
  }
  function start() {
    launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "fan-launcher";
    launcher.setAttribute("aria-haspopup", "menu");
    launcher.setAttribute("aria-expanded", "false");
    launcher.setAttribute("aria-label", "Everything in Portal (fans)");
    launcher.title = "Everything in Portal";
    launcher.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20 3.5 11.5a12 12 0 0 1 17 0Z"/><path d="M12 20V9M12 20 7 10.4M12 20l5-9.6"/></svg>';
    launcher.addEventListener("click", open);
    document.body.append(launcher);
    placeLauncher();
    addEventListener("resize", () => {
      placeLauncher();
      if (root) draw(false);
    });
    // (only once someone's signed in: Portal's sign-in screen has nothing to open)
    const signedIn = () => document.body.classList.contains("signed-in") || !!(window.PortalPage && window.PortalPage.me && window.PortalPage.me());
    const watch = () => {
      launcher.hidden = !signedIn();
      if (!launcher.hidden && !root) placeLauncher();
    };
    watch();
    setInterval(watch, 1200);
    document.addEventListener("focusin", watch);
    document.addEventListener("focusout", () => setTimeout(watch, 50));
    addEventListener("popstate", () => setTimeout(watch, 300));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
  window.PortalFans = { open, close, groups: GROUPS };
})();
