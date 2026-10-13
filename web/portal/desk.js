// Portal → Admin → Desk (admins): where Nova Bot runs, all day and night — on Cloudflare and on the
// studio's VPS — side by side (Nova Bot's src/desk.js: GET /app/api/desk says it all).
// Each side: online or not, since when, how busy (processor, memory, disk), its version, the
// last copy of the data and the last backup, its jobs' last runs, the PC link, and recent problems
// in plain words. Buttons for admins (Portal open in a browser): restart Nova Bot on the VPS,
// restart its web front, back up now (Restart asks twice).
// Plain buttons and text only (nothing from the server is drawn as HTML), words not colours.

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const K = () => window.PortalApp && window.PortalApp.kit;
  let data = null;
  let loading = false;
  let armed = "";
  let timer = 0;

  const el = (tag, cls, text) => K().el(tag, cls, text);
  const ago = (iso) => {
    if (!iso) return "never";
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return String(iso);
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h} h ago`;
    return `${Math.round(h / 24)} days ago`;
  };
  const gb = (n) => (n == null ? "?" : `${(n / 1024 ** 3).toFixed(1)} GB`);
  const dur = (s) => {
    if (s == null) return "?";
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? `${d} days ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
  };
  const pct = (used, total) => (total ? Math.round((used / total) * 100) : 0);

  function row(label, value, note) {
    const r = el("div", "dk-row");
    r.append(el("span", "dk-label", label), el("span", "dk-value", value));
    if (note) r.append(el("span", "dk-note", note));
    return r;
  }
  function meter(label, used, total, unit) {
    const p = pct(used, total);
    const r = el("div", "dk-row dk-meter");
    const bar = el("span", "dk-bar");
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", `${label}: ${p}% used`);
    const fill = el("i");
    fill.style.width = `${Math.min(100, p)}%`;
    bar.append(fill);
    r.append(el("span", "dk-label", label), el("span", "dk-value", `${p}% used · ${unit}`), bar);
    return r;
  }
  function state(on, words) {
    const s = el("span", `dk-state ${on ? "on" : "off"}`, `${on ? "●" : "○"} ${words}`);
    return s;
  }

  function hereCard(h) {
    const card = el("section", "card dk-card");
    card.setAttribute("aria-label", h.where === "vps" ? "Nova Bot here, on the VPS" : "Nova Bot on Cloudflare");
    const head = el("div", "dk-head");
    head.append(el("h3", "card-title", h.where === "vps" ? "This Nova Bot (VPS)" : "Cloudflare"), state(true, "Online"));
    card.append(head);
    card.append(row("Address", h.url || "?"));
    if (h.version) card.append(row("Version", h.version.id, h.version.at ? `deployed ${ago(h.version.at)}` : ""));
    card.append(row("Studio PC", h.pc && h.pc.connected ? "Linked" : "Not linked", h.pc && h.pc.since ? `since ${ago(h.pc.since)}` : ""));
    if (h.jobs && h.jobs.length) {
      card.append(el("h4", "dk-sub", "Jobs: last run"));
      const list = el("div", "dk-list");
      for (const j of h.jobs.slice(0, 14)) list.append(row(j.name, ago(j.at), j.ok ? j.note : `Problem: ${j.note}`));
      card.append(list);
    }
    return card;
  }

  function vpsCard(v, canAct) {
    const card = el("section", "card dk-card");
    card.setAttribute("aria-label", "The VPS");
    const head = el("div", "dk-head");
    head.append(el("h3", "card-title", "VPS"), state(v.reachable, v.reachable ? "Online" : "Can't be reached"));
    card.append(head);
    card.append(row("Address", v.url || "?"));
    if (!v.reachable) {
      card.append(el("p", "dk-why", v.reason || "No answer."));
      return card;
    }
    const svc = v.services || {};
    const on = (k) => svc[k] === "active";
    card.append(row("Server", v.host || "?", `up ${dur(v.uptimeSeconds)}`));
    card.append(row("Nova Bot", on("nova") ? "Running" : svc.nova || "?", v.novaSince ? `since ${v.novaSince}` : ""));
    card.append(row("Web front (HTTPS)", on("caddy") ? "Running" : svc.caddy || "?"));
    card.append(row("Every-minute jobs", v.jobsOn ? "On" : "Off", v.jobsOn ? "" : "they switch on at the cutover, so the VPS and Cloudflare never both send"));
    card.append(row("Nightly backup", on("nova-backup.timer") ? "On" : "Off", `last ${ago(v.lastBackup)}`));
    card.append(row("Data copied from Cloudflare", v.lastSync ? ago(v.lastSync) : "not yet"));
    if (v.cpu) card.append(row("Processors", `${v.cpu.count}`, `busy ${(v.cpu.load || []).join(" · ")} (1, 5, 15 min)`));
    if (v.memory) card.append(meter("Memory", v.memory.total - v.memory.free, v.memory.total, `${gb(v.memory.total - v.memory.free)} of ${gb(v.memory.total)}`));
    if (v.disk) card.append(meter("Disk", v.disk.total - v.disk.free, v.disk.total, `${gb(v.disk.free)} free of ${gb(v.disk.total)}`));
    if (v.version) card.append(row("Version", String(v.version).split(" ")[0], `sent ${ago(String(v.version).split(" ")[1])}`));
    card.append(el("h4", "dk-sub", "Recent problems (last day)"));
    if (v.problems && v.problems.length) {
      const list = el("ul", "dk-problems");
      for (const p of v.problems.slice(-8)) list.append(el("li", "", p));
      card.append(list);
    } else card.append(el("p", "dk-why", "None ✓"));
    if (canAct) {
      const acts = el("div", "dk-actions");
      const btn = (label, what, twice) => {
        const b = el("button", armed === what ? "btn danger" : "btn ghost", armed === what ? `Press again to ${label.toLowerCase()}` : label);
        b.type = "button";
        b.addEventListener("click", () => act(what, twice, label));
        return b;
      };
      acts.append(btn("Back up now", "backup", false), btn("Restart Nova Bot", "restart", true), btn("Restart web front", "restart-web", true));
      card.append(acts);
    } else card.append(el("p", "dk-why", "Restarting and backing up need Portal open in a browser, signed in as an admin."));
    return card;
  }

  async function act(what, twice, label) {
    if (twice && armed !== what) {
      armed = what;
      draw();
      setTimeout(() => {
        if (armed === what) {
          armed = "";
          draw();
        }
      }, 5000);
      return;
    }
    armed = "";
    try {
      await K().api("desk/action", { body: { do: what } });
      K().toast(`${label}: done ✓`);
    } catch (err) {
      if (err.message !== "signed out") K().toast(err.message);
    }
    setTimeout(load, 2500);
  }

  function draw() {
    const box = $("desk-body");
    if (!box || !data) return;
    const grid = el("div", "dk-grid");
    grid.append(hereCard(data.here), vpsCard(data.vps, data.canAct));
    box.replaceChildren(grid);
  }

  async function load() {
    const box = $("desk-body");
    if (!box || loading) return;
    loading = true;
    try {
      data = await K().api("desk");
      draw();
    } catch (err) {
      if (err.message !== "signed out") K().emptyState(box, "Desk couldn't load: " + err.message);
    } finally {
      loading = false;
    }
    clearTimeout(timer);
    timer = setTimeout(() => window.PortalApp && window.PortalApp.view === "desk" && !document.hidden && load(), 30000);
  }

  const refresh = $("desk-refresh");
  if (refresh) refresh.addEventListener("click", load);
  window.PortalDesk = { load };
})();
