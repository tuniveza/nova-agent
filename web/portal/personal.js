// Plans & Nova, You and Look & sound, each on one screen (25 Oct 2026, the owner: "can you make the rest of nova
// portal as much as possible dashboards please", after Admin's, admin.js: "heavily simplify … put everything onto
// one screen as much as possible", then "get rid of old links please and just keep it simple and optimized").
// Each had an Overview of tiles and a row of buttons along the top, each opening a page or a sheet; now each is
// one dashboard in Admin's look (its panels: a name, a big line, a few lines, buttons along the foot):
//   - Plans & Nova (/portal/?view=quests): the quests, today's, in place, and Nova Agent's panel beside them:
//     whether it's online, Talk to Nova Agent, Ask Nova, Voice and the Hands-free switch;
//   - You (/portal/?view=me): your planet (Re-roll, Back to my original, Edit my name, in place), your account
//     (Change email and Change password open in place, Sign out), Google, How it works and All addresses (a line
//     each; Open › for the whole list, /portal/?view=me&part=tech|addresses) and the studio (admins);
//   - Look & sound (/portal/?view=look): the settings themselves, changed in place: Theme, Text & menu, Starting
//     tab, Sound, Look and feel, and the app (Install the app, Apps and links, Refresh everything, All options).
// Nothing new is read: the quests, your profile and the options are what their pages already had. No timers.
(function () {
  "use strict";
  if (window.PortalPersonal) return;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const say = (t) => window.PortalApp && window.PortalApp.kit && window.PortalApp.kit.toast(t);
  const icon = (name) => (window.NovaPillars ? window.NovaPillars.icon(name) : el("span"));
  const go = (url, replace = false) => window.PortalPage && window.PortalPage.go(url, { replace });
  const stored = (key) => {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
  // (once a sheet or a page has drawn it: turned to, onescreen.js)
  function reveal(find, then) {
    let tries = 12;
    (function look() {
      const n = find();
      if (n) {
        if (window.NovaOneScreen) window.NovaOneScreen.reveal(n);
        if (then) then(n);
      } else if (tries-- > 0) setTimeout(look, 100);
    })();
  }

  // ---- A panel, a line and a button, as Admin's (admin.js), in its look (admin.css) ----
  function panel(key, name, iconName, openIt) {
    const box = el("article", "dash-tile ad-panel ps-panel ps-" + key);
    box.dataset.key = "ps-" + key;
    // (whole on a page, drawn a little smaller if it must be: never its name on one page and its lines on the next)
    box.setAttribute("data-os-keep", "");
    const head = el("div", "dash-tile-head");
    head.append(icon(iconName || name), el("h3", "dash-name", name));
    if (openIt) head.append(button("Open ›", "dash-open", openIt, "Open " + name));
    const top = el("p", "dash-top");
    const big = el("span", "dash-big", "");
    const small = el("span", "dash-small", "");
    top.append(big, small);
    const rows = el("ul", "dash-rows");
    const foot = el("div", "ad-foot");
    box.append(head, top, rows, foot);
    return { box, head, top, big, small, rows, foot };
  }
  function line(main, side, open) {
    const li = el("li");
    const s = el("span", "dash-side", side || "");
    li.append(el("span", "dash-main", main), s);
    if (open) {
      li.tabIndex = 0;
      li.setAttribute("role", "button");
      li.addEventListener("click", open);
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
    }
    li.side = s;
    return li;
  }
  function button(label, cls, onClick, aria) {
    const b = el("button", cls, label);
    b.type = "button";
    if (aria) b.setAttribute("aria-label", aria);
    b.addEventListener("click", onClick);
    return b;
  }
  // A switch, the look Options has (app.css .option-switch): its words, then the switch
  function toggle(words, onChange) {
    const lab = el("label", "option-switch");
    const box = el("input");
    box.type = "checkbox";
    box.setAttribute("role", "switch");
    lab.append(el("span", "", words), box);
    if (onChange) box.addEventListener("change", () => onChange(box.checked));
    lab.box = box;
    return lab;
  }

  // ===== Plans & Nova: the quests, and Nova Agent beside them =====
  let nova = null;
  function plans() {
    const view = $("view-quests");
    if (!view) return;
    if (!nova) {
      view.classList.add("pn");
      const p = panel("nova", "Nova Agent");
      p.box.id = "pn-nova";
      // (whether it's online and when its plan last came: the line Quests had under its title, app.js drawQuests)
      const sync = $("quests-sync");
      if (sync) {
        sync.classList.add("pn-sync");
        p.top.replaceWith(sync);
      } else p.top.remove();
      // (the talk, the questions and the voice, each one tap, as their buttons along the top did)
      const voice = line("Voice", "", () => ($("voice") && !$("voice").hidden ? $("voice").click() : say("Voice isn't available here.")));
      p.rows.append(
        line("Talk to Nova Agent", "Its conversation", () => $("nav-agent").click()),
        line("Ask Nova", "In Website bot", askNova),
        voice
      );
      // Hands-free, a switch in place: the voice panel's own (app.js setHandsFree), pressed for you
      const hf = toggle("Hands-free", (on) => {
        const real = $("handsfree-switch");
        if (!real) return;
        real.checked = on;
        real.dispatchEvent(new Event("change"));
        sync2();
      });
      const hfLine = el("li", "pn-hf");
      const hfSide = el("span", "dash-side");
      hfLine.append(hf, hfSide);
      p.rows.append(hfLine);
      p.foot.remove();
      view.append(p.box);
      const sync2 = () => {
        const can = $("voice") && !$("voice").hidden;
        const on = stored("nova-handsfree") === "on";
        hf.box.checked = on;
        hf.box.disabled = !can;
        hfSide.textContent = !can ? "No microphone here" : on ? "Listening for “Nova”" : "Off";
        voice.side.textContent = can ? "Say a command" : "No microphone here";
      };
      // (changed from the voice panel or the listening bar: said here too)
      for (const id of ["handsfree-switch", "listening-off", "voice"]) {
        const n = $(id);
        if (n) n.addEventListener(id === "handsfree-switch" ? "change" : "click", () => setTimeout(sync2, 60));
      }
      nova = { sync: sync2 };
    }
    nova.sync();
  }
  // Ask Nova: the Website bot, set to Nova, ready to type
  function askNova() {
    go("/portal/?view=bot", true);
    reveal(() => document.querySelector('#view-bot:not([hidden]) [data-mode="nova"]'), (m) => {
      if (!m.classList.contains("active")) m.click();
      if ($("bot-input")) $("bot-input").focus();
    });
  }

  // ===== Look & sound: the settings themselves =====
  // (the choices are the Options sheet's own, copied from it, so there's one list of them: index.html)
  const sheet = () => $("options-sheet");
  const copy = (sel) => {
    const n = sheet() && sheet().querySelector(sel);
    return n ? n.cloneNode(true) : el("span");
  };
  const rowOf = (opt) => copy(`.option-row:has(> [data-option="${opt}"])`);
  const switchOf = (opt) => copy(`.option-switch:has(> [data-option="${opt}"])`);
  let look = null;
  function lookDash() {
    const grid = $("look-grid");
    if (!grid || !window.NovaOptions) return;
    if (!look) look = buildLook(grid);
    look.mark();
  }
  function buildLook(grid) {
    const opts = (...parts) => {
      const d = el("div", "lk-opts");
      d.append(...parts);
      return d;
    };
    // Theme: the picker themes.js drew into the section as the page loaded
    const theme = panel("theme", "Theme");
    theme.small.textContent = "Tap one to change it";
    const list = document.querySelector("#view-look > [data-theme-list]");
    if (list) {
      theme.rows.replaceWith(list);
      list.addEventListener("click", () => setTimeout(mark, 40));
    } else theme.rows.remove();
    theme.foot.remove();

    // Text & menu: the look, alignment, size, the menu and the times on alerts
    // (no big line over the choices of a panel: the lit choices say how each is set)
    const text = panel("text", "Text & menu");
    text.top.remove();
    text.rows.replaceWith(opts(rowOf("ui"), rowOf("align"), rowOf("size"), rowOf("menu"), rowOf("times")));
    text.foot.remove();

    // Starting tab: where Portal opens
    const start = panel("start", "Starting tab");
    start.top.remove();
    start.rows.replaceWith(opts(copy('.chips[data-option="startTab"]')));
    start.foot.remove();

    // Sound: the music, its volume, the sound effects and the pings; the rest of the music in Options
    const sound = panel("sound", "Sound", "Music on or off");
    sound.top.remove();
    const music = toggle("Ambient music", () => {
      $("music").click();
      setTimeout(mark, 150);
    });
    const sfx = toggle("Sound effects on taps, tabs and switches", (on) => window.NovaSfx && window.NovaSfx.setEnabled(on));
    sound.rows.replaceWith(opts(music, rowOf("volume"), sfx, switchOf("pings")));
    // (the music's variations, keeping one and playing one again: in Options, turned to Sound)
    sound.head.append(button("Variations ›", "dash-open", () => openOptions("Sound"), "Music variations, in Options"));
    sound.foot.remove();

    // Look and feel: animations, the starfield and the battery saver
    const feel = panel("feel", "Look and feel", "Options");
    feel.top.remove();
    feel.rows.replaceWith(opts(switchOf("motion"), switchOf("stars"), rowOf("saver")));
    feel.foot.remove();

    // The app, along the foot: installing it, the other apps, a refresh, and every option
    const app = panel("app", "The app", "Install the app");
    app.top.remove();
    app.rows.remove();
    app.foot.append(
      button("Install the app", "btn small ghost", install),
      button("Apps and links", "btn small ghost", () => $("brand").click()),
      button("Refresh everything", "btn small ghost", () => $("refresh").click()),
      button("All options", "btn small", () => $("options-btn").click())
    );

    grid.replaceChildren(theme.box, text.box, start.box, sound.box, feel.box, app.box);

    // The choices: saved on this device straight away, as in Options (options.js)
    grid.addEventListener("click", (e) => {
      const chip = e.target.closest(".chips[data-option] .chip");
      if (!chip) return;
      window.NovaOptions.set({ [chip.parentElement.dataset.option]: chip.dataset.value });
      mark();
    });
    grid.addEventListener("change", (e) => {
      const box = e.target;
      if (box.matches('input[type="checkbox"][data-option]')) window.NovaOptions.set({ [box.dataset.option]: box.checked });
      mark();
    });
    grid.addEventListener("input", (e) => {
      const range = e.target;
      if (!range.matches('input[type="range"][data-option]')) return;
      const o = window.NovaOptions.set({ [range.dataset.option]: Number(range.value) });
      // (the music follows the slider as it moves)
      if (range.dataset.option === "volume" && window.NovaAmbient) window.NovaAmbient.setVolume(o.volume / 100);
    });
    // (changed in Options or elsewhere meanwhile: said here too)
    for (const ev of ["novaoptionschange", "novasfxchange", "novaambientchange", "novalookchange"]) addEventListener(ev, () => look && look.mark());

    function mark() {
      const o = window.NovaOptions.get();
      grid.querySelectorAll(".chips[data-option]").forEach((g) => g.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.value === String(o[g.dataset.option]))));
      grid.querySelectorAll('input[type="checkbox"][data-option]').forEach((b) => (b.checked = o[b.dataset.option] !== false));
      grid.querySelectorAll('input[type="range"][data-option]').forEach((r) => (r.value = o[r.dataset.option]));
      const T = window.NovaThemes;
      const t = T && T.list.find((x) => x.id === T.current());
      theme.big.textContent = t ? t.name : "";
      music.box.checked = !!$("music") && $("music").getAttribute("aria-pressed") === "true";
      sfx.box.checked = !!(window.NovaSfx && window.NovaSfx.enabled());
    }
    return { mark };
  }
  // Options, turned to one part of it (the music's variations live there)
  function openOptions(heading) {
    $("options-btn").click();
    reveal(() => [...document.querySelectorAll("#options-sheet:not([hidden]) .kicker")].find((k) => k.textContent.trim() === heading));
  }
  // (its sheet in pages like every box in Portal, onescreen.js: in a short window it was a box that scrolled)
  function install() {
    if (!window.NovaInstall) return say("Installing isn't available here.");
    window.NovaInstall.open();
    reveal(() => document.querySelector(".ni-sheet"), (d) => window.NovaOneScreen && window.NovaOneScreen.adopt(d));
  }

  // ===== You: your profile, its parts side by side (the profile's own parts, portal.js, laid out: personal.css) =====
  // A crew member's page (from Admin) is the same section, left as a page.
  let built = false;
  let opened = ""; // the form open in place: "email" or "password"
  let emailWas = "";
  const view = () => $("view-profile");
  const groupOf = (head) => view().querySelector(`.panels > .group[aria-labelledby="${head}"]`);
  const tiles = () => [view().querySelector(":scope > .hero"), ...view().querySelectorAll(":scope > .panels > .group")];
  function you(self, person) {
    const v = view();
    if (!v) return;
    const asked = self ? new URLSearchParams(location.search).get("part") : "";
    const part = asked === "tech" || asked === "addresses" ? asked : "";
    const was = v.dataset.part || "";
    v.classList.toggle("yd", self && !part);
    v.classList.toggle("yd-room", self && !!part);
    v.dataset.part = part;
    // (each part a panel, whole on a page when it must go into pages; a list on its own goes into pages between its rows)
    for (const t of tiles()) {
      if (!t) continue;
      t.classList.toggle("dash-tile", self && !part);
      t.toggleAttribute("data-os-keep", self && !part);
    }
    // (into one of its lists or back: the strip along the top, its way back, shows or steps aside, pillars.js)
    if (part !== was && window.NovaPillars) window.NovaPillars.redraw();
    if (!self) return shut();
    if (!built) buildYou();
    // (the new email saved: its form shuts, the account shows it)
    if (opened === "email" && person && person.email !== emailWas) shut();
    sums();
  }
  function buildYou() {
    built = true;
    const head = (sel, name) => {
      const h = view().querySelector(sel);
      if (h && !h.querySelector(".yd-ico")) {
        const i = icon(name);
        i.classList.add("yd-ico");
        h.prepend(i);
      }
    };
    head("#group-account-head", "Your profile");
    head("#google-title", "Google");
    head("#group-tech-head", "How it works");
    head("#group-addresses-head", "All addresses");
    head("#self-admin-title", "Admin");
    // Change email and Change password: open in place of your details, beside Sign out
    const so = $("sign-out");
    so.before(button("Change email", "btn ghost yd-only", () => openForm("email")), button("Change password", "btn ghost yd-only", () => openForm("password")));
    for (const id of ["email-save", "password-save"]) {
      const save = $(id);
      const row = el("div", "actions yd-form-acts");
      save.replaceWith(row);
      const cancel = button("Cancel", "btn ghost yd-only", shut);
      cancel.dataset.sfx = "close";
      row.append(save, cancel);
    }
    // (a new password saved: portal.js empties its form, and it shuts)
    $("password-form").addEventListener("reset", () => opened === "password" && setTimeout(shut));
    // How it works and All addresses: a line each, the whole list one tap away (its own page)
    for (const [key, headId] of [["tech", "group-tech-head"], ["addresses", "group-addresses-head"]]) {
      const g = groupOf(headId);
      const sub = g.querySelector(".cp-subhead");
      sub.append(button("Open ›", "dash-open yd-only", () => go("/portal/?view=me&part=" + key), "Open " + $(headId).textContent.trim()));
      const top = el("p", "dash-top yd-only yd-sum");
      top.append(el("span", "dash-big", "…"), el("span", "dash-small", ""));
      sub.after(top);
    }
  }
  function openForm(kind) {
    const v = view();
    opened = kind;
    v.dataset.open = kind;
    emailWas = (window.PortalPage && window.PortalPage.me && (window.PortalPage.me() || {}).email) || "";
    const first = kind === "email" ? $("email-new") : $("password-current-field").hidden ? $("password-new") : $("password-current");
    if (first) first.focus({ preventScroll: true });
    if (window.NovaOneScreen) window.NovaOneScreen.reveal($(kind + "-card"));
  }
  function shut() {
    opened = "";
    const v = view();
    if (v) delete v.dataset.open;
  }
  // The two lines: how many parts of Nova are set up, and how many addresses there are
  function sums() {
    const set = (headId, big, small) => {
      const top = groupOf(headId) && groupOf(headId).querySelector(".yd-sum");
      if (!top) return;
      top.children[0].textContent = big;
      top.children[1].textContent = small;
    };
    const dots = [...document.querySelectorAll("#tech-list .tech-dot")];
    if (dots.length) {
      const on = dots.filter((d) => d.classList.contains("on")).length;
      const not = dots.filter((d) => !d.classList.contains("on")).map((d) => d.closest(".tech-item").querySelector("strong").textContent.trim());
      set("group-tech-head", `${on} of ${dots.length} set up`, not.length ? "Not yet: " + not.slice(0, 2).join(", ") + (not.length > 2 ? ` +${not.length - 2}` : "") : "Every part ✓");
    } else {
      const said = document.querySelector("#tech-list .hint");
      set("group-tech-head", "…", said ? said.textContent.trim() : "");
    }
    const admin = window.PortalPage && window.PortalPage.isAdmin && window.PortalPage.isAdmin();
    const n = window.NovaAddresses ? window.NovaAddresses.list(!!admin).reduce((t, g) => t + g.items.length, 0) : 0;
    set("group-addresses-head", plural(n, "address", "addresses"), "Copy or open any of them");
  }

  function show(viewName) {
    if (viewName === "quests") plans();
    if (viewName === "look") lookDash();
  }
  window.PortalPersonal = { show, you, services: sums };
})();
