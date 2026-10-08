// The "doorman" (service worker) for phones that installed Hub from /app/, before Hub
// became part of Portal. It still lives on those phones and wakes up when Apple delivers a
// notification, so their notifications keep arriving; a tap now opens Portal (/portal/).
// New installs use Portal's own doorman (/portal/sw.js).

// A new version of the doorman takes over straight away (instead of waiting
// until every Hub window has been closed), so fixes reach the phone at once
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

// Hub's old address (/app/, /app/#nova) is Portal now; Index (/app/memory/) and other sites stay
function portalUrl(url) {
  const u = String(url || "/portal/");
  if (u === "/app" || (u.startsWith("/app/") && !u.startsWith("/app/memory"))) return "/portal/" + u.slice(5).replace(/^\//, "");
  return u;
}

// A notification has arrived from Apple
self.addEventListener("push", (event) => {
  // Unpack the title, text and where to go when it's tapped (or use plain defaults)
  const data = event.data ? event.data.json() : { title: "Nova Agent", body: "Something new in Hub" };
  // The plain version: title, text, icon and where to go (what every phone shows, iPhones included)
  const plain = { body: data.body || "", icon: "/app/icon-192.png", data: { url: portalUrl(data.url) } };
  // The rich version adds a buzz pattern, a tag (a newer one replaces the older one), and
  // staying on screen for check-ins. iPhones only get the plain version, and if a phone
  // turns the rich one down, it falls back to plain, so nothing is ever lost.
  const isApple = /iPhone|iPad|iPod|Macintosh/.test(self.navigator.userAgent);
  const rich = {
    ...plain,
    badge: "/app/icon-192.png",
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    vibrate: BUZZ[data.kind] || BUZZ[data.source] || [200, 100, 200],
    requireInteraction: data.urgent === true,
  };
  const show = () =>
    (isApple ? self.registration.showNotification(data.title || "Nova Agent", plain) : self.registration.showNotification(data.title || "Nova Agent", rich))
      .catch(() => self.registration.showNotification(data.title || "Nova Agent", plain));
  // Keep the doorman awake until the notification is on screen
  event.waitUntil(
    Promise.all([
      // Show the notification on the phone
      show(),
      // A dot on the Home Screen icon until Hub is opened (never allowed to stop the notification)
      self.navigator.setAppBadge ? self.navigator.setAppBadge().catch(() => {}) : null,
      // If Hub is open, tell it too, so it can ping and show a banner straight away
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => windows.forEach((w) => w.postMessage({ type: "nova-push", ...data }))).catch(() => {}),
    ])
  );
});

// The notification was tapped
self.addEventListener("notificationclick", (event) => {
  // Put the notification away
  event.notification.close();
  // Where this notification should take him (Portal, or Acuity for bookings)
  const url = portalUrl(event.notification.data?.url);
  // Keep the doorman awake until the right screen is open
  event.waitUntil(
    // Look for Hub windows that are already open
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      // For a Portal link, reuse an open Portal window if there is one
      const open = url.startsWith("/portal/") && windows.find((w) => new URL(w.url).pathname.startsWith("/portal/"));
      // Bring that window to the front, on the right tab
      if (open) {
        open.postMessage({ type: "nova-open", url });
        return open.focus();
      }
      // Otherwise open the link
      return self.clients.openWindow(url);
    })
  );
});
