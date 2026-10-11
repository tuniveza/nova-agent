// Install and remove Nova's web apps (Nova Agent and the Portal phone app), on any phone, tablet or
// computer. One "App" button (in Nova Agent's top bar, the Portal app's top bar, the phone's gear
// menu and the Panels window) opens a short sheet: each app with Install and Remove, and the
// steps for exactly this device.
//   Install: Android and computers get a real one-tap install (when the browser offers it);
//     iPhone and iPad don't let any website install itself, so it shows the two taps in Safari.
//   Remove: no website can delete its own icon, so it wipes the app off this device (notifications
//     off, signed out, saved data and offline files gone; shared notes and everything online stay
//     safe) and then shows the one step that deletes the icon on this device.
//   window.NovaInstall = { open(appId?), mount(container, appId) }
(() => {
  "use strict";
  if (window.NovaInstall) return;
  const APPS = {
    agent: { name: "Nova Agent", icon: "/agent/icon-192.png?v=2", install: "/agent/?install=1", scope: "/agent/" },
    portal: { name: "Nova Portal", icon: "/portal/icon-192.png", install: "/portal/?app=1&install=1", scope: "/portal/" },
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  // This device
  const ua = navigator.userAgent || "";
  const isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isIPhone = /iPhone|iPod/.test(ua);
  const isApple = isIPad || isIPhone;
  const isAndroid = /Android/.test(ua);
  const isAndroidTablet = isAndroid && !/Mobile/.test(ua);
  const inSafari = isApple && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  const device = isIPad ? "iPad" : isIPhone ? "iPhone" : isAndroidTablet ? "Android tablet" : isAndroid ? "Android phone" : "computer";
  const iosVersion = (() => { const m = ua.match(/OS (\d+)[._](\d+)/); if (m && isApple) return +m[1] + +m[2] / 100; const v = ua.match(/Version\/(\d+)\.(\d+)/); return isApple && v ? +v[1] + +v[2] / 100 : 0; })();
  const androidVersion = (() => { const m = ua.match(/Android (\d+)/); return m ? +m[1] : 0; })();
  const browser = /SamsungBrowser/.test(ua) ? "Samsung Internet" : /EdgA|EdgiOS|Edg\//.test(ua) ? "Edge" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /OPR|OPiOS/.test(ua) ? "Opera" : /CriOS|Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "your browser";
  const deviceLine = `${device}${isApple && iosVersion ? ` · ${isIPad ? "iPadOS" : "iOS"} ${String(Math.floor(iosVersion))}${iosVersion % 1 ? "." + Math.round((iosVersion % 1) * 100) : ""}` : ""}${isAndroid && androidVersion ? ` · Android ${androidVersion}` : ""} · ${browser}`;
  const standalone = window.navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
  let here = "agent";
  try { here = (window.top.location.pathname || "").startsWith("/portal/") ? "portal" : "agent"; } catch (err) {}
  const installedHere = (id) => standalone && id === here;

  // The browser's own install offer (Android, computers), kept for the button
  let offer = null;
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); offer = e; render(); });
  addEventListener("appinstalled", () => { offer = null; say(`${APPS[here].name} is installed ✦ Find it on your home screen.`); });

  // ---- The steps, for this device ----
  const SHARE = '<svg class="ni-inline" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M6 11v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8"/></svg>';
  const DOTS = '<b class="ni-key">⋮</b>';
  function installSteps(app) {
    if (isApple) {
      const where = isIPad ? "at the top right" : "at the bottom (or top) of the screen";
      return `${inSafari ? "" : `<li>Open this page in <b>Safari</b> (iPhone and iPad only install from Safari).</li>`}
        <li>Tap <b>Share</b> ${SHARE} ${where}.</li>
        <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
        <li>Tap <b>Add</b>. ${esc(app.name)} is on your home screen.</li>`;
    }
    if (isAndroid) return `<li>Tap the menu ${DOTS} at the top right of Chrome.</li><li>Tap <b>Install app</b> (or <b>Add to Home screen</b>), then <b>Install</b>.</li>`;
    return `<li>In Chrome or Edge, click the install icon at the right of the address bar (or the menu ${DOTS} → <b>Install ${esc(app.name)}</b>).</li>`;
  }
  function removeSteps(app) {
    if (isApple) return `<li>Go to your home screen and <b>press and hold</b> the ${esc(app.name)} icon.</li><li>Tap <b>Remove App</b>, then <b>Delete App</b>.</li>`;
    if (isAndroid) return `<li>Go to your home screen and <b>press and hold</b> the ${esc(app.name)} icon.</li><li>Tap <b>Uninstall</b> (or <b>App info → Uninstall</b>), then <b>OK</b>.</li>`;
    return `<li>In Chrome, type <b>chrome://apps</b> in the address bar and press Enter.</li><li><b>Right-click</b> ${esc(app.name)} and choose <b>Remove from Chrome</b>, then <b>Remove</b>.</li><li>(Or in ${esc(app.name)}'s own window: the menu ${DOTS} at its very top right → <b>Uninstall</b>.)</li>`;
  }

  // ---- Something not working? The usual problems, and the fix on this device ----
  const PROBLEMS = [
    ["hidden", "I installed it but can't find the icon"],
    ["no-option", "There's no Install or Add to Home Screen"],
    ["browser", "It opens in the browser, not as an app"],
    ["alerts", "Notifications don't come"],
    ["old", "It shows an old name or old picture"],
    ["signin", "It keeps asking me to sign in"],
    ["twice", "There are two of it"],
    ["stuck", "It's blank, frozen or out of date"],
  ];
  function fix(kind, app) {
    const n = esc(app.name);
    const reinstall = `<li>Remove it: tap <b>Back</b>, then <b>Remove…</b> for ${n} and follow the steps.</li><li>Then add it again: <b>Install…</b> for ${n}.</li>`;
    if (kind === "hidden") {
      if (isIPad) return `<li>Tap the <b>App Library</b> icon at the right end of the <b>Dock</b> (the bar at the bottom).</li><li>Type <b>${n}</b> in the search box at the top.</li><li>Press and hold it and drag it onto your home screen.</li><li>Still not there? It isn't installed: tap <b>Back</b> and <b>Install…</b></li>`;
      if (isApple) return `<li>Swipe left past your last home-screen page to the <b>App Library</b>.</li><li>Type <b>${n}</b> in the search box at the top.</li><li>Press and hold it, then tap <b>Add to Home Screen</b>.</li><li>Still not there? It isn't installed: tap <b>Back</b> and <b>Install…</b></li>`;
      if (isAndroid) return `<li>Swipe up from the bottom of your home screen to see <b>all apps</b>.</li><li>Type <b>${n}</b> in the search box.</li><li>Press and hold it and drag it onto your home screen.</li>${/Samsung/i.test(ua) || browser === "Samsung Internet" ? `<li>Samsung: open <b>Settings → Home screen</b> and turn on <b>Add new apps to Home screen</b>.</li>` : ""}<li>Still not there? It isn't installed: tap <b>Back</b> and <b>Install…</b></li>`;
      return `<li>Search for <b>${n}</b> in your computer's Start menu or Launchpad.</li><li>Or open Chrome and go to <b>chrome://apps</b>.</li>`;
    }
    if (kind === "no-option") {
      if (isApple) return `${inSafari ? "" : `<li>Copy this page's address and open it in <b>Safari</b> (the compass icon). ${iosVersion && iosVersion < 16.04 ? "This iPhone can only install from Safari." : ""}</li>`}<li>In Safari, tap <b>Share</b> ${SHARE}.</li><li>Scroll all the way down the list. If <b>Add to Home Screen</b> isn't there, tap <b>Edit Actions</b> and add it.</li><li>Using a <b>Private</b> tab? Switch to a normal tab first.</li><li>Still missing? Check <b>Settings → Screen Time → Content & Privacy</b> isn't blocking it.</li>`;
      if (isAndroid && browser === "Samsung Internet") return `<li>Tap the menu <b>≡</b> at the bottom right.</li><li>Tap <b>Add page to</b> → <b>Home screen</b>.</li><li>Or open this page in <b>Chrome</b> and use ⋮ → <b>Install app</b>.</li>`;
      if (isAndroid && browser === "Firefox") return `<li>Tap the menu ${DOTS}.</li><li>Tap <b>Install</b> (or <b>Add to Home screen</b>).</li><li>Or open this page in <b>Chrome</b> instead.</li>`;
      if (isAndroid) return `<li>Open this page in <b>Chrome</b>.</li><li>Tap ${DOTS} at the top right. If you see <b>Open in app</b>, it's already installed: tap it.</li><li>Otherwise tap <b>Install app</b> or <b>Add to Home screen</b>.</li><li>Nothing there? Pull the page down to reload it, wait a few seconds and look again.</li>`;
      return `<li>Use <b>Chrome</b> or <b>Edge</b>.</li><li>Look for the install icon at the right of the address bar, or the menu ${DOTS} → <b>Install ${n}</b>.</li>`;
    }
    if (kind === "browser") return `<li>That's an old shortcut, not the app.</li>${reinstall}${isApple ? `<li>Make sure you add it from <b>Safari</b> with <b>Add to Home Screen</b>.</li>` : isAndroid ? `<li>Choose <b>Install app</b> (not <b>Add shortcut</b>).</li>` : ""}`;
    if (kind === "alerts") {
      if (isApple && iosVersion && iosVersion < 16.04) return `<li>This ${device} is too old for app notifications.</li><li>Update it: <b>Settings → General → Software Update</b>.</li><li>Then open ${n} from its icon and turn notifications on.</li>`;
      if (isApple) return `<li>Open ${n} from its <b>home-screen icon</b> (not Safari).</li><li>Open <b>Alerts</b> and tap <b>Turn on notifications</b>, then <b>Allow</b>.</li><li>Check <b>Settings → Notifications → ${n}</b>: <b>Allow Notifications</b> on.</li><li>Check <b>Focus</b> or <b>Do Not Disturb</b> is off.</li>`;
      if (isAndroid) return `<li>Open ${n}, go to <b>Alerts</b> and tap <b>Turn on notifications</b>, then <b>Allow</b>.</li><li>Press and hold the ${n} icon → <b>App info</b> → <b>Notifications</b>: turn them on.</li><li>Turn off <b>Battery saver</b> for it: <b>App info → Battery → Unrestricted</b>.</li><li>Check <b>Do Not Disturb</b> is off.</li>`;
      return `<li>Open <b>Alerts</b> and tap <b>Turn on notifications</b>, then <b>Allow</b>.</li><li>Check your computer's notification settings allow ${esc(browser)}.</li>`;
    }
    if (kind === "old") return `<li>Phones keep an app's name and picture from the day it was added.</li>${reinstall}`;
    if (kind === "signin") return `<li>Sign in once inside the app itself (tap the planet at the top).</li>${isApple ? `<li>On iPhone and iPad each home-screen app has its own sign-in, separate from Safari: that's normal.</li>` : ""}<li>Still asking every time? ${isApple ? "Check <b>Settings → Safari</b>: <b>Block All Cookies</b> is off." : "Check the browser isn't set to clear data on exit."}</li>`;
    if (kind === "twice") return `<li>Keep one and delete the other.</li>${isApple ? `<li>Press and hold the extra icon → <b>Remove App</b> → <b>Delete App</b>.</li>` : isAndroid ? `<li>Press and hold the extra icon → <b>Remove</b> (or <b>Uninstall</b>).</li>` : `<li>Delete the extra shortcut.</li>`}<li>Nova Agent and Portal are two different apps: having one of each is fine.</li>`;
    if (kind === "stuck") return `<li>Close it completely (swipe it away in your recent apps) and open it again.</li><li>Still stuck? Tap <b>Back</b>, <b>Remove…</b> for ${n}, wipe it, then <b>Install…</b> again. That always gives a fresh copy.</li>`;
    return "";
  }

  // ---- Wipe this app off this device ----
  async function wipe() {
    try {
      const reg = await navigator.serviceWorker?.getRegistration("/");
      const sub = reg && (await reg.pushManager.getSubscription());
      if (sub) {
        await fetch("/app/api/push/unsubscribe", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
    } catch (err) {}
    await fetch("/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    try { for (const r of (await navigator.serviceWorker?.getRegistrations()) || []) await r.unregister(); } catch (err) {}
    try { for (const k of await caches.keys()) await caches.delete(k); } catch (err) {}
    try { localStorage.clear(); sessionStorage.clear(); } catch (err) {}
    try { for (const db of (await indexedDB.databases?.()) || []) if (db.name) indexedDB.deleteDatabase(db.name); } catch (err) {}
  }

  // ---- The sheet ----
  let sheet = null;
  let view = { mode: "list", app: null };
  function ensure() {
    if (sheet) return sheet;
    sheet = document.createElement("dialog");
    sheet.className = "ni-sheet";
    sheet.setAttribute("aria-label", "Install or remove the apps");
    document.body.append(sheet);
    sheet.addEventListener("click", async (e) => {
      if (e.target === sheet) return sheet.close();
      const b = e.target.closest("[data-ni]");
      if (!b) return;
      const [act, id, extra] = b.dataset.ni.split(":");
      const app = APPS[id];
      if (act === "close") return sheet.close();
      if (act === "back") view = { mode: "list" };
      if (act === "install") {
        if (id === here && offer) {
          offer.prompt();
          const { outcome } = await offer.userChoice.catch(() => ({}));
          offer = null;
          if (outcome === "accepted") return sheet.close();
        } else if (id !== here && !isApple) {
          // The other app installs from its own address (that's what the browser installs)
          location.href = app.install;
          return;
        }
        view = { mode: "install", app: id };
      }
      if (act === "open") { location.href = app.install; return; }
      if (act === "remove") view = { mode: "remove", app: id };
      if (act === "help") view = { mode: "help", app: id };
      if (act === "fix") view = { mode: "fix", app: id, problem: extra };
      if (act === "wipe") view = { mode: "wipe", app: id };
      if (act === "wipe-yes") {
        b.disabled = true;
        b.textContent = "Removing…";
        await wipe();
        view = { mode: "wiped", app: id };
      }
      render();
    });
    return sheet;
  }

  function card(id) {
    const app = APPS[id];
    const inIt = installedHere(id);
    const status = inIt ? "Installed: you're using it now" : id === here ? "Not installed on this " + device : "Open it to check, or look for its icon";
    return `<div class="ni-card">
      <img src="${app.icon}" alt="" width="44" height="44">
      <div class="ni-name"><b>${esc(app.name)}</b><small>${esc(status)}</small></div>
      <div class="ni-actions">
        ${inIt ? "" : `<button type="button" class="ni-btn primary" data-ni="install:${id}">${id === here && offer ? "Install" : "Install…"}</button>`}
        <button type="button" class="ni-btn" data-ni="remove:${id}">Remove…</button>
      </div>
    </div>`;
  }

  function render() {
    if (!sheet || !sheet.open) return;
    const app = view.app && APPS[view.app];
    let html = `<header class="ni-head"><h3>${view.mode === "list" ? `Apps on this ${esc(device)}` : view.mode === "help" || view.mode === "fix" ? `Help: ${esc(app.name)}` : esc(app.name)}</h3><button type="button" class="ni-x" data-ni="close" aria-label="Close">✕</button></header>`;
    if (view.mode === "list") {
      html += `<p class="ni-device">This is: <b>${esc(deviceLine)}</b></p>` + card(here) + card(here === "agent" ? "portal" : "agent") +
        `<button type="button" class="ni-btn wide help" data-ni="help:${here}">Something not working? Get help</button>` +
        `<p class="ni-note">Both apps work on their own: Nova Portal is also inside Nova Agent.</p>`;
    } else if (view.mode === "help") {
      html += `<p class="ni-device">This is: <b>${esc(deviceLine)}</b></p><p>What's happening?</p><div class="ni-problems">${PROBLEMS.map(([k, t]) => `<button type="button" class="ni-btn wide" data-ni="fix:${view.app}:${k}">${esc(t)}</button>`).join("")}</div>
        <div class="ni-which">For: ${Object.keys(APPS).map((id) => `<button type="button" class="ni-chip${id === view.app ? " on" : ""}" data-ni="help:${id}">${esc(APPS[id].name)}</button>`).join("")}</div>
        <button type="button" class="ni-btn wide" data-ni="back">Back</button>`;
    } else if (view.mode === "fix") {
      const title = (PROBLEMS.find((p) => p[0] === view.problem) || [, ""])[1];
      html += `<p><b>${esc(title)}</b></p><ol class="ni-steps">${fix(view.problem, app)}</ol><button type="button" class="ni-btn wide" data-ni="help:${view.app}">Something else</button><button type="button" class="ni-btn wide" data-ni="back">Back</button>`;
    } else if (view.mode === "install") {
      html += `<p>To add <b>${esc(app.name)}</b> to this ${esc(device)}:</p><ol class="ni-steps">${installSteps(app)}</ol>` +
        (view.app !== here ? `<button type="button" class="ni-btn primary wide" data-ni="open:${view.app}">Open ${esc(app.name)} to install it</button>` : "") +
        `<button type="button" class="ni-btn wide" data-ni="back">Back</button>`;
    } else if (view.mode === "remove") {
      const inIt = view.app === here;
      html += `<p>Removing <b>${esc(app.name)}</b> from this ${esc(device)} takes two steps.</p>
        <p class="ni-sub">1. Wipe it from this ${esc(device)}</p>` +
        (inIt ? `<p class="ni-small">Turns its notifications off, signs you out and deletes what it saved here (offline files, settings and local notes). Shared notes and everything online stay safe.</p><button type="button" class="ni-btn danger wide" data-ni="wipe:${view.app}">Wipe ${esc(app.name)} from this ${esc(device)}</button>`
              : `<p class="ni-small">Open ${esc(app.name)}, tap its <b>App</b> button and choose Remove there (each app wipes itself).</p><button type="button" class="ni-btn wide" data-ni="open:${view.app}">Open ${esc(app.name)}</button>`) +
        `<p class="ni-sub">2. Delete its icon</p><ol class="ni-steps">${removeSteps(app)}</ol><button type="button" class="ni-btn wide" data-ni="back">Back</button>`;
    } else if (view.mode === "wipe") {
      html += `<p><b>Wipe ${esc(app.name)} from this ${esc(device)}?</b></p><p class="ni-small">You'll be signed out here, and its saved data on this ${esc(device)} goes (local notes too). Shared notes and everything online stay safe.</p>
        <button type="button" class="ni-btn danger wide" data-ni="wipe-yes:${view.app}">Yes, wipe it</button><button type="button" class="ni-btn wide" data-ni="remove:${view.app}">Cancel</button>`;
    } else if (view.mode === "wiped") {
      html += `<p><b>Done:</b> ${esc(app.name)} is wiped from this ${esc(device)}.</p><p class="ni-sub">Now delete its icon</p><ol class="ni-steps">${removeSteps(app)}</ol>`;
    }
    sheet.innerHTML = html;
  }

  function open(id) {
    ensure();
    view = id ? { mode: "install", app: id } : { mode: "list" };
    if (!sheet.open) sheet.showModal();
    render();
    if (window.NovaSfx) window.NovaSfx.play("open");
  }
  let note = null;
  function say(text) {
    if (!note) { note = document.createElement("div"); note.className = "ni-note-pop"; note.setAttribute("role", "status"); document.body.append(note); }
    note.textContent = text;
    note.classList.remove("show");
    void note.offsetWidth;
    note.classList.add("show");
  }

  // The button itself
  const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M12 7.5v7M9 12l3 3 3-3M10.5 18.5h3"/></svg>';
  function mount(container, where = "first") {
    if (!container || container.querySelector(".ni-open")) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "icon-btn ni-open";
    b.dataset.sfx = "none";
    b.title = installedHere(here) ? "This app: remove it, or get the other one" : "Install the app (or remove it)";
    b.setAttribute("aria-label", "Install or remove the app");
    b.innerHTML = ICON + `<span class="ni-label">${installedHere(here) ? "App" : "Install"}</span>`;
    b.addEventListener("click", () => open());
    if (where === "first") container.prepend(b);
    else container.append(b);
  }

  window.NovaInstall = { open, mount, help: (id) => { open(); view = { mode: "help", app: id || here }; render(); } };
  // The App button in the top bar: Nova Agent's, and the Portal app's (inside Nova Agent, Portal
  // uses Nova Agent's)
  function place() {
    if (window.top !== window) return;
    if (location.pathname.startsWith("/portal/")) {
      mount(document.querySelector("header.top .top-actions"), "first");
      // …and on its sign-in screen (before signing in, there's no top bar)
      const sub = document.getElementById("auth-sub");
      if (sub && !document.querySelector("#auth .ni-open")) {
        const holder = document.createElement("div");
        holder.className = "ni-auth";
        sub.after(holder);
        mount(holder, "first");
      }
    }
    else mount(document.querySelector(".topbar .top-side.right"), "first");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", place);
  else place();
  // Arrived from an install link (…?install=1): the steps straight away
  if (/[?&]install=1\b/.test(location.search)) addEventListener("load", () => setTimeout(() => open(here), 600));
})();
