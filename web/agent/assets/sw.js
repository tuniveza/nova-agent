// Nova Agent's service worker (the "doorman"), at /sw.js for the whole app: it makes Nova Agent
// an installable app, wakes up when a phone notification arrives (even with Nova Agent closed),
// and opens Nova Agent on the right panel when a notification is tapped. It also keeps Nova's own
// files (scripts, styles, icons, fonts) on the device, so Nova and its panels open instantly (see
// "Nova's files on the device" below; pages and data always come fresh from Nova).
// On the studio PC it also brings Nova Agent back for its own reminders.
// (Phones that installed Portal (from /app/ or /portal/) keep their old doorman,
// /app/sw.js or /portal/sw.js, which sends taps here too.)

self.addEventListener("install", () => self.skipWaiting());
// (navigation preload: a page's request goes out while this wakes up, so it never waits for it)
// (and the panels' files fetched quietly a few seconds after it first starts, so even the first
// visit's first panel opens fast)
self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([self.clients.claim(), self.registration.navigationPreload ? self.registration.navigationPreload.enable().catch(() => {}) : null]));
  if (!slowLink()) event.waitUntil(checkList().then(() => new Promise((r) => setTimeout(r, 5000))).then(warm).catch(() => {}));
});

// ---- Nova's files on the device ----
// Every deploy writes /nova-build.json: each of Nova's own files (scripts, styles, icons, sounds)
// with a fingerprint of what's in it. A file is kept here once fetched and used straight from here
// (no asking the server "has it changed?" for each of the 60+ files a page needs) for as long as
// its fingerprint stays the same. A page being opened (Nova Agent, or a panel inside it) says which
// deploy it's from (X-Nova-Build): the same as the list kept here, and the files are used at once;
// a newer one, and the new list is fetched first, so after a deploy only the files that changed are
// fetched; files that went are dropped. Pages themselves, data and anything not on the list always come from Nova as before,
// and so does everything when the list can't be had (the studio PC, offline the first time).
// After Nova Agent's page opens, the files of the panels not opened yet are fetched quietly too
// (not on a slow or data-saving connection), so the first time a panel opens it's instant as well.
// Google's fonts are kept once fetched (their addresses never change what's in them).
const FILES = "nova-files";
const LIST = "/nova-build.json";
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];
// What a file of Nova's looks like (pages, data and live updates never come here)
const FILE = /\.(?:m?js|css|svg|png|jpe?g|webp|gif|ico|woff2?|ttf|otf|wasm)$/i;
let list = null; // { build, files: { "/shared/fit.js": [fingerprint, bytes] } }
let checking = null; // the list being fetched for the page that's opening
let checkedAt = 0;

async function storedList() {
  if (list) return list;
  try {
    const hit = await (await caches.open(FILES)).match(LIST);
    list = hit ? await hit.json() : null;
  } catch (err) {
    list = null;
  }
  return list;
}
// The newest list, and anything kept that it no longer has (or has changed) dropped
async function freshList() {
  const old = await storedList();
  let res;
  try {
    res = await fetch(LIST, { cache: "no-store", credentials: "omit" });
  } catch (err) {
    return old; // offline: what we had
  }
  if (!res.ok) return res.status === 404 ? (list = null) : old; // not on this Nova (the studio PC): nothing kept
  let next;
  try {
    next = await res.clone().json();
  } catch (err) {
    return old;
  }
  if (!next || !next.files) return old;
  if (!old || old.build !== next.build) {
    const cache = await caches.open(FILES);
    for (const req of await cache.keys()) {
      const path = new URL(req.url).pathname;
      if (path === LIST) continue;
      const hit = await cache.match(req);
      const now = next.files[path];
      if (!now || !hit || hit.headers.get("X-Nova-Print") !== now[0]) await cache.delete(req);
    }
    await cache.put(LIST, new Response(JSON.stringify(next), { headers: { "Content-Type": "application/json" } }));
  }
  list = next;
  return list;
}
function checkList() {
  if (!checking || Date.now() - checkedAt > 5000) {
    checkedAt = Date.now();
    checking = freshList().catch(() => list);
  }
  return checking;
}
// The deploy a page says it's from: the list kept here if it's that one, else the new list
async function listFor(build) {
  if (!build) return checkList(); // a page that doesn't say: ask for the list
  const now = await storedList();
  if (now && now.build === build) return now;
  checkedAt = 0;
  return checkList();
}

// One of Nova's files: from here if it's kept and still the same, else fetched (and kept)
async function novaFile(request, path) {
  const now = await (checking || storedList());
  const entry = now && now.files[path];
  if (!entry) return fetch(request);
  const cache = await caches.open(FILES);
  const hit = await cache.match(path);
  if (hit && hit.headers.get("X-Nova-Print") === entry[0]) return hit;
  const res = await fetch(request);
  if (res.ok && res.status === 200 && res.type === "basic") await keep(cache, path, entry[0], res.clone());
  return res;
}
async function keep(cache, path, print, res) {
  const headers = new Headers(res.headers);
  for (const h of ["Content-Encoding", "Content-Length", "Set-Cookie"]) headers.delete(h); // the body kept is already unpacked
  headers.set("X-Nova-Print", print);
  const body = await res.blob();
  await cache.put(path, new Response(body, { status: 200, statusText: "OK", headers }));
}

// The files of panels not opened yet, fetched a few at a time while nothing else is going on
let warming = null;
async function warm() {
  const now = await (checking || storedList());
  if (!now) return;
  const cache = await caches.open(FILES);
  const kept = new Set((await cache.keys()).map((r) => new URL(r.url).pathname));
  const todo = Object.entries(now.files).filter(([path, [, bytes]]) => !kept.has(path) && bytes < 800_000);
  const next = async () => {
    for (let item = todo.shift(); item; item = todo.shift()) {
      const [path, [print]] = item;
      try {
        const res = await fetch(path, { credentials: "same-origin" });
        if (res.ok && res.status === 200) await keep(cache, path, print, res);
      } catch (err) {}
    }
  };
  await Promise.all([next(), next(), next()]);
}
const slowLink = () => !!(self.navigator.connection && (self.navigator.connection.saveData || /(^|-)(2g|3g)$/.test(self.navigator.connection.effectiveType || "")));
const slow = (request) => request.headers.get("Save-Data") === "on" || slowLink();

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // A page opening (Nova Agent or a panel): fetched as always; what it says about its deploy decides
  // whether the files kept here can be used at once or the new list is needed first
  if (req.mode === "navigate") {
    if (url.origin === location.origin) {
      const page = Promise.resolve(event.preloadResponse).then((res) => res || fetch(req));
      const check = page.then((res) => listFor(res.headers.get("X-Nova-Build")), () => list);
      checking = check;
      event.respondWith(page);
      event.waitUntil(check);
      // Nova Agent's own page: then the other panels' files, quietly (once per deploy)
      if (url.pathname === "/agent/" && !warming && !slow(req)) {
        warming = check.then(() => new Promise((r) => setTimeout(r, 4000))).then(warm).catch(() => {}).finally(() => { warming = null; });
        event.waitUntil(warming);
      }
    }
    return;
  }
  if (url.origin === location.origin) {
    if (!FILE.test(url.pathname) || url.pathname === "/sw.js") return;
    event.respondWith(novaFile(req, url.pathname).catch(() => fetch(req)));
    return;
  }
  // Google's fonts: kept once fetched
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open("nova-fonts").then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === "opaque") await cache.put(req, res.clone());
        return res;
      }).catch(() => fetch(req))
    );
  }
});

// How each kind of notification buzzes (on phones that can; iPhones use their own sound)
const BUZZ = {
  checkin: [220, 90, 220, 90, 420],
  pulse: [140],
  leave: [320, 120, 320, 120, 320],
  starting: [260, 110, 260],
  mission: [90, 60, 90, 60, 90, 60, 520],
  agent: [500, 150, 500],
};

// Where a notification goes: a panel's address (/portal/#nova, /app/memory/...) opens inside
// Nova Agent; Portal's old address (/app/) is Portal; other sites (Acuity) open as they are
function panelUrl(url) {
  let u = String(url || "/");
  if (u === "/app" || (u.startsWith("/app/") && !u.startsWith("/app/memory"))) u = "/portal/" + u.slice(5).replace(/^\//, "");
  return u;
}
// In the Portal phone app: the same place, in Portal itself (other places open as they are)
function portalAppUrl(url) {
  const u = panelUrl(url);
  if (u.startsWith("/portal/")) return u + (u.includes("?") ? "&" : "?") + "app=1";
  if (!u.startsWith("/") || u.startsWith("//")) return u;
  return "/portal/?app=1&view=alerts";
}
// Which app this phone opens for notifications: "portal" when it's the Portal phone app
async function homeApp() {
  try {
    const hit = await (await caches.open("nova-home")).match("/home");
    return hit ? await hit.text() : "agent";
  } catch (err) {
    return "agent";
  }
}
function novaAgentUrl(url) {
  const u = panelUrl(url);
  if (!u.startsWith("/") || u.startsWith("//")) return u;
  if (u === "/" || u.startsWith("/?")) return u;
  return "/agent/?open=" + encodeURIComponent(u);
}

// A notification has arrived
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : { title: "Nova Agent", body: "Something new in Portal" };
  // The plain version (what every phone shows, iPhones included)
  const plain = { body: data.body || "", icon: "/agent/icon-192.png", data: { url: panelUrl(data.url) } };
  // The rich version adds a buzz, a tag (a newer one replaces the older one) and staying on screen
  // for check-ins; a phone that turns it down gets the plain one, so nothing is lost
  const isApple = /iPhone|iPad|iPod|Macintosh/.test(self.navigator.userAgent);
  const rich = {
    ...plain,
    badge: "/agent/icon-192.png",
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    vibrate: BUZZ[data.kind] || BUZZ[data.source] || [200, 100, 200],
    requireInteraction: data.urgent === true,
  };
  const title = data.title || "Nova Agent";
  const show = () => (isApple ? self.registration.showNotification(title, plain) : self.registration.showNotification(title, rich)).catch(() => self.registration.showNotification(title, plain));
  event.waitUntil(
    Promise.all([
      show(),
      // A dot on the Home Screen icon until Nova Agent is opened
      self.navigator.setAppBadge ? self.navigator.setAppBadge().catch(() => {}) : null,
      // Nova Agent (and Portal inside it) open: tell them too, so they ping and refresh straight away
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => windows.forEach((w) => w.postMessage({ type: "nova-push", ...data }))).catch(() => {}),
    ])
  );
});

// A notification was tapped (a phone's, or one of Nova Agent's own reminders on the PC)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ? panelUrl(event.notification.data.url) : "";
  event.waitUntil(
    Promise.all([self.clients.matchAll({ type: "window", includeUncontrolled: true }), homeApp()]).then(([windows, home]) => {
      // The Portal phone app: open (or bring back) Portal itself, on the right tab
      const portal = windows.find((w) => new URL(w.url).pathname.startsWith("/portal/"));
      if (home === "portal" || (portal && !windows.some((w) => new URL(w.url).pathname === "/agent/"))) {
        if (portal) return (url && portal.navigate ? portal.navigate(portalAppUrl(url)).catch(() => portal) : Promise.resolve(portal)).then((w) => (w || portal).focus());
        return self.clients.openWindow(portalAppUrl(url || "/portal/"));
      }
      // Nova Agent already open: bring it to the front, on the right panel
      const open = windows.find((w) => new URL(w.url).pathname === "/agent/");
      if (open && (!url || url.startsWith("/"))) {
        if (url) open.postMessage({ type: "nova-open", url });
        return open.focus();
      }
      return self.clients.openWindow(url ? novaAgentUrl(url) : "/?view=today");
    })
  );
});
