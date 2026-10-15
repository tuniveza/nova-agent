// In place: one of Nova Bot's own pages (an admin page, like All links), shown in a window over the
// page you're on, instead of taking you to Portal to see it. The same page Portal shows, with the
// same sign-in: what's admin-only stays admin-only (the page itself says so to anyone else).
//
//   NovaInPlace.open("/admin/links", "All links")
//
// Only Nova Bot's own /admin pages open (never another site). Esc, ✕ or a tap outside closes it.
(() => {
  if (window.NovaInPlace) return;
  const SAFE = /^\/admin(\/[\w\/-]*)?(\?[\w=&%.-]*)?$/;
  let dlg = null;
  function build() {
    const style = document.createElement("style");
    style.textContent = `
      dialog.nv-inplace { width: min(1100px, calc(100vw - 24px)); height: min(820px, calc(100dvh - 24px)); max-width: none; max-height: none; padding: 0; border-radius: 18px; border: 1px solid var(--line, #3a2a44); background: var(--deep, #120a1a); color: var(--text, #eee); overflow: hidden; }
      dialog.nv-inplace[open] { display: flex; flex-direction: column; }
      dialog.nv-inplace::backdrop { background: rgb(0 0 0 / .55); }
      .nv-inplace header { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--line, #3a2a44); }
      .nv-inplace header b { font-size: 15px; letter-spacing: .04em; }
      .nv-inplace header button { min-width: 40px; min-height: 40px; border-radius: 12px; border: 1px solid var(--line, #3a2a44); background: none; color: inherit; font: inherit; font-size: 16px; cursor: pointer; }
      .nv-inplace iframe { flex: 1 1 auto; width: 100%; border: 0; background: var(--deep, #120a1a); }`;
    document.head.append(style);
    dlg = document.createElement("dialog");
    dlg.className = "nv-inplace";
    dlg.setAttribute("aria-label", "");
    dlg.innerHTML = `<header><b></b><button type="button" aria-label="Close" title="Close">✕</button></header><iframe title=""></iframe>`;
    dlg.querySelector("header button").addEventListener("click", () => dlg.close());
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) dlg.close();
    });
    dlg.addEventListener("close", () => dlg.querySelector("iframe").removeAttribute("src"));
    document.body.append(dlg);
  }
  window.NovaInPlace = {
    open(url, title) {
      if (!SAFE.test(String(url || ""))) return false;
      if (!dlg) build();
      dlg.querySelector("header b").textContent = title || "";
      dlg.setAttribute("aria-label", title || "");
      dlg.querySelector("iframe").title = title || "";
      dlg.querySelector("iframe").src = url;
      if (!dlg.open) dlg.showModal();
      try {
        if (window.NovaSfx) window.NovaSfx.play("unfold");
      } catch (err) {}
      return true;
    },
  };
})();
