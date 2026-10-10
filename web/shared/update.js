// Nova Agent and the Portal app keep themselves up to date. A phone doesn't reload an app from
// the home screen: it wakes the copy still in memory, sometimes for days. So whenever the app is
// opened or comes back to the front (and every 10 minutes while it's on screen), this asks Nova Bot
// which version is live (/app-version, new with every deploy). When it's a new one, the app
// refreshes itself: straight away if you're not in the middle of something, otherwise as soon as
// you've finished typing or closed the window that's open. Then a small "Updated ✦".
(() => {
  "use strict";
  if (window.top !== window || window.NovaUpdate) return;
  let known = null;
  let waiting = false;

  const busy = () => {
    const a = document.activeElement;
    const frame = a && a.tagName === "IFRAME" ? (() => { try { return a.contentDocument.activeElement; } catch (err) { return null; } })() : null;
    const el = frame || a;
    const typing = el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) && (el.isContentEditable || (el.value || "").length > 0);
    return typing || !!document.querySelector("dialog[open]");
  };

  function refresh() {
    if (busy()) {
      if (!waiting) {
        waiting = true;
        const again = () => { if (!busy()) { cleanup(); refresh(); } };
        const cleanup = () => { clearInterval(t); document.removeEventListener("focusout", again, true); };
        const t = setInterval(again, 4000);
        document.addEventListener("focusout", again, true);
      }
      return;
    }
    try { sessionStorage.setItem("nova-updated", "1"); } catch (err) {}
    // The notification helper (sw.js) gets the new copy too
    navigator.serviceWorker?.getRegistration("/").then((r) => r && r.update()).catch(() => {}).finally(() => location.reload());
  }

  async function check() {
    if (document.hidden) return;
    try {
      const r = await fetch("/app-version", { cache: "no-store", credentials: "omit" });
      if (!r.ok) return;
      const { version } = await r.json();
      if (!version) return;
      if (known === null) known = version;
      else if (version !== known) refresh();
    } catch (err) {} // offline: try again later
  }

  check();
  document.addEventListener("visibilitychange", () => !document.hidden && check());
  addEventListener("focus", check);
  addEventListener("pageshow", (e) => e.persisted && check());
  setInterval(check, 10 * 60 * 1000);

  // Just updated: say so, quietly
  try {
    if (sessionStorage.getItem("nova-updated")) {
      sessionStorage.removeItem("nova-updated");
      addEventListener("load", () => {
        const n = document.createElement("div");
        n.textContent = "Updated ✦";
        n.setAttribute("role", "status");
        n.style.cssText = "position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:95;padding:8px 16px;border-radius:999px;font:600 13px system-ui,sans-serif;color:#fff;background:rgba(28,17,41,.92);border:1px solid rgba(255,95,168,.5);box-shadow:0 10px 30px -10px #000;transition:opacity .6s";
        document.body.append(n);
        setTimeout(() => (n.style.opacity = "0"), 2600);
        setTimeout(() => n.remove(), 3400);
      });
    }
  } catch (err) {}

  window.NovaUpdate = { check };
})();
