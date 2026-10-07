// Nova Agent's service worker: makes it an installable app, and shows its
// reminders as system notifications that bring the app back when clicked.
// Nothing is cached: Nova Agent is its own server, on this machine.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).pathname === "/");
      return open ? open.focus() : self.clients.openWindow("/?view=today");
    }),
  );
});
