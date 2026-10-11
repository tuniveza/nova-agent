// Nova Agent's service worker (the "doorman"), at /sw.js for the whole app: it makes Nova Agent
// an installable app, wakes up when a phone notification arrives (even with Nova Agent closed),
// and opens Nova Agent on the right panel when a notification is tapped. Nothing is cached.
// On the studio PC it also brings Nova Agent back for its own reminders.
// (Phones that installed Portal (from /app/ or /portal/) keep their old doorman,
// /app/sw.js or /portal/sw.js, which sends taps here too.)

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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
