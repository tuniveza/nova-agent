// Nova Agent remembers the app you had open (Calendar, Notes, Portal…, and where you were in it,
// such as Portal's Quests tab) and opens it again after a refresh or the next time you open Nova
// Agent. Back on the home, it remembers that instead, and opens on the home. Kept on this device.
(() => {
  "use strict";
  const KEY = "nova-last-panel";
  const main = document.getElementById("main");
  const viewer = document.getElementById("viewer");
  if (!main || !viewer || !window.NovaAgent) return;
  const save = (v) => { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (err) {} };
  const saved = () => { try { return localStorage.getItem(KEY) || ""; } catch (err) { return ""; } };

  // The app in view, and where it is now (its own address, as it moves between its own pages)
  function current() {
    const frames = [...viewer.querySelectorAll("iframe")].filter((f) => !f.hidden && f.src && !/^about:/.test(f.src));
    const f = frames.find((x) => x.offsetParent !== null) || frames[0];
    if (!f) return "";
    try {
      const l = f.contentWindow.location;
      if (l && l.origin === location.origin && !/^about:/.test(l.href)) return l.pathname + l.search + l.hash;
    } catch (err) {}
    const u = new URL(f.src, location.href);
    return u.pathname + u.search + u.hash;
  }
  function remember() {
    if (!main.classList.contains("viewing")) return save("");
    const where = current();
    if (where && !where.startsWith("/agent")) save(where);
  }

  // Open it again (unless something else is already open, such as a link to a panel)
  const again = saved();
  if (again && !main.classList.contains("viewing")) window.NovaAgent.open(again);

  // Keep it up to date: an app opening or closing, switching apps, moving around inside one
  new MutationObserver(remember).observe(main, { attributes: true, attributeFilter: ["class"] });
  new MutationObserver(remember).observe(viewer, { attributes: true, subtree: true, childList: true, attributeFilter: ["src", "hidden"] });
  viewer.addEventListener("load", () => setTimeout(remember, 50), true);
  setInterval(() => !document.hidden && main.classList.contains("viewing") && remember(), 5000);
  addEventListener("pagehide", remember);
})();
