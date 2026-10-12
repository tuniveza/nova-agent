// Portal → Test stuff (admins): things that look like tests or copies, each with why, where it
// lives, when it was made and by whom, what goes with it, and Delete / Not a test.
//
// Two lists, shown as one: Nova Bot's (/app/api/tidy: enquiries, chats, chat bookings, clients,
// Index pages, shared notes, drafts; src/tidy.js there) and the studio PC's (/tidy-api/state:
// quests, missions, calendar notes, Fixer jobs, files; src/tidy.ts in Nova Agent, relayed when
// online). PC off: Nova Bot's list still shows, and it says so.
//
// Deleting puts a copy in the bin first: "Recently deleted" puts it back for 30 days (a Fixer job
// is only cleared). "Delete all likely" needs a second press that says how many. Everything is
// plain buttons and text: keyboard, screen readers, big tap targets, reasons in words (not colour).
// Nothing from the server is drawn as HTML.

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const K = () => window.PortalApp && window.PortalApp.kit;
  const isAdmin = () => Boolean(window.PortalPage && window.PortalPage.isAdmin && window.PortalPage.isAdmin());

  let bot = null; // Nova Bot's answer
  let pc = null; // the PC's answer
  let botProblem = "";
  let pcProblem = "";
  let filter = "all"; // all | likely | maybe | a kind name
  let armed = 0; // "Delete all likely": the count it's armed for (0 = not armed)
  let armTimer = 0;
  const apart = new Set(); // items whose "delete these with it" box was unticked
  const working = new Set(); // keys being deleted or marked right now
  let loading = null;

  // ===== Talking to the two sides =====

  async function pcCall(path, body) {
    const res = await fetch(path, {
      method: body ? "POST" : "GET",
      // (the PC only takes changes from its own pages: they say so with this header)
      headers: body ? { "Content-Type": "application/json", "X-Nova-Visualizer": "1" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
    let data = {};
    try {
      data = await res.json();
    } catch (err) {}
    if (!res.ok || data.ok === false) {
      const err = new Error(data.pcOffline ? "The studio computer is off" : data.message || data.error || "The studio computer couldn't answer (" + res.status + ")");
      err.pcOffline = Boolean(data.pcOffline) || res.status === 503;
      throw err;
    }
    return data;
  }
  const botCall = (path, body) => K().api(path, body ? { body } : {});
  const sideOf = (item) => (item.side === "pc" ? "pc" : "bot");
  const call = (side, action, body) => (side === "pc" ? pcCall("/actions/tidy/" + action, body) : botCall("tidy/" + action, body));

  // ===== Loading =====

  function load() {
    if (!K() || !K().running) return Promise.resolve();
    if (!isAdmin()) {
      hideToday();
      if (K().view === "tests") K().setText("tests-summary", "Test stuff is for admins.");
      return Promise.resolve();
    }
    if (loading) return loading;
    loading = (async () => {
      const [b, p] = await Promise.allSettled([botCall("tidy"), pcCall("/tidy-api/state")]);
      bot = b.status === "fulfilled" ? b.value : null;
      botProblem = b.status === "rejected" && b.reason.message !== "signed out" ? b.reason.message : "";
      pc = p.status === "fulfilled" ? p.value : null;
      pcProblem = p.status === "rejected" ? (p.reason.pcOffline ? "The studio computer is off, so its quests, calendar notes, Fixer jobs and files aren't checked right now." : "The studio computer's list couldn't load: " + p.reason.message) : "";
      const n = items().filter((i) => i.confidence === "likely").length;
      K().setBadge("tests-badge", n);
      const tile = $("today-tests");
      if (tile) {
        const all = items().length;
        tile.hidden = !all;
        K().setText("today-tests-n", all === 1 ? "1 thing looks like a test" : all + " things look like tests");
      }
      if (K().view === "tests") draw();
    })().finally(() => (loading = null));
    return loading;
  }
  function hideToday() {
    const tile = $("today-tests");
    if (tile) tile.hidden = true;
  }

  const items = () => [...((bot && bot.items) || []), ...((pc && pc.items) || [])];
  const recent = () => [...((bot && bot.recent) || []).map((r) => ({ ...r, side: "bot" })), ...((pc && pc.recent) || []).map((r) => ({ ...r, side: "pc" }))].sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
  const real = () => [...((bot && bot.real) || []).map((r) => ({ ...r, side: "bot" })), ...((pc && pc.real) || []).map((r) => ({ ...r, side: "pc" }))];

  // ===== Drawing =====

  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  const ukWhen = (iso) => (iso ? K().ukWhen(iso) : "");

  function draw() {
    const k = K();
    const all = items();
    const likely = all.filter((i) => i.confidence === "likely");
    const maybe = all.filter((i) => i.confidence === "maybe");

    // The summary, said once when it changes
    const summary = !bot && !pc ? (botProblem || "Loading…") : !all.length ? "Nothing looks like a test. All clean ✦" : `${plural(likely.length, "thing looks", "things look")} like a test, and ${maybe.length} might.`;
    k.setText("tests-summary", summary);
    const problems = [botProblem && bot === null ? "Nova Bot's list couldn't load: " + botProblem : "", pcProblem].filter(Boolean);
    const note = $("tests-note");
    note.hidden = !problems.length;
    k.setText("tests-note", problems.join(" "));

    // The filter chips: all, likely, maybe, then each kind there is
    const kinds = [...new Set(all.map((i) => i.kindName))].sort();
    if (filter !== "all" && filter !== "likely" && filter !== "maybe" && !kinds.includes(filter)) filter = "all";
    const chip = (value, label, n) => {
      const b = k.el("button", "chip", `${label} · ${n}`);
      b.type = "button";
      b.dataset.filter = value;
      b.setAttribute("aria-pressed", String(filter === value));
      if (filter === value) b.classList.add("active");
      b.addEventListener("click", () => {
        filter = value;
        draw();
        const again = document.querySelector(`#tests-filters [data-filter="${CSS.escape(value)}"]`);
        if (again) again.focus();
      });
      return b;
    };
    k.redraw($("tests-filters"), k.sig(filter, all.length, kinds), [
      chip("all", "All", all.length),
      chip("likely", "Likely", likely.length),
      chip("maybe", "Maybe", maybe.length),
      ...kinds.map((kn) => chip(kn, kn, all.filter((i) => i.kindName === kn).length)),
    ]);

    // Delete all likely (two presses)
    const allBtn = $("tests-delete-all");
    const deletable = likely.filter((i) => !i.locked);
    allBtn.hidden = !deletable.length;
    if (armed && armed !== deletable.length) disarm();
    k.setText("tests-delete-all", armed ? `Yes, delete ${plural(deletable.length, "thing", "things")}` : `Delete all likely (${deletable.length})`);
    allBtn.classList.toggle("solid", Boolean(armed));
    $("tests-delete-all-hint").hidden = !armed;

    // The two lists
    const shown = (i) => filter === "all" || filter === i.confidence || filter === i.kindName;
    const likelyShown = likely.filter(shown);
    const maybeShown = maybe.filter(shown);
    $("tests-likely-group").hidden = !likelyShown.length;
    $("tests-maybe-group").hidden = !maybeShown.length;
    k.setText("tests-likely-head", `Likely tests · ${likelyShown.length}`);
    k.setText("tests-maybe-head", `Maybe · ${maybeShown.length}`);
    k.reconcile($("tests-likely"), likelyShown.map(card));
    k.reconcile($("tests-maybe"), maybeShown.map(card));
    const empty = $("tests-empty");
    // (all clean is said once, above: this is only for a filter that hides everything)
    empty.hidden = !all.length || Boolean(likelyShown.length || maybeShown.length);
    k.setText("tests-empty", "Nothing here with that filter.");

    // Recently deleted, and marked as real
    const rec = recent();
    $("tests-recent-wrap").hidden = !rec.length;
    k.setText("tests-recent-count", String(rec.length));
    k.reconcile($("tests-recent"), rec.map(recentRow));
    const marked = real();
    $("tests-real-wrap").hidden = !marked.length;
    k.setText("tests-real-count", String(marked.length));
    k.reconcile($("tests-real"), marked.map(realRow));
  }

  function card(item) {
    const k = K();
    const node = k.el("article", "card ts-card ts-" + item.confidence);
    node.dataset.key = "ts-" + item.key;
    const titleId = "ts-t-" + item.key.replace(/[^\w-]/g, "_");
    node.setAttribute("aria-labelledby", titleId);
    const together = !apart.has(item.key);
    node.dataset.sig = k.sig(item, together, working.has(item.key));

    const top = k.el("div", "ts-top");
    const pill = k.el("span", "ts-pill ts-pill-" + item.confidence, item.confidence === "likely" ? "Likely a test" : "Maybe a test");
    const kind = k.el("span", "ts-kind", item.kindName);
    top.append(pill, kind);
    const h = k.el("h4", "card-title ts-title", item.title);
    h.id = titleId;
    h.tabIndex = -1;

    const meta = k.el("p", "card-meta ts-meta");
    const bits = [item.where ? "In " + item.where : "", item.created ? "Made " + ukWhen(item.created) : "", item.by ? "By " + item.by : "", item.side === "pc" ? "On the studio computer" : ""].filter(Boolean);
    meta.textContent = bits.join(" · ");

    const why = k.el("div", "ts-why");
    why.append(k.el("span", "ts-why-label", "Why:"));
    const reasons = k.el("ul", "ts-reasons");
    for (const r of item.reasons) {
      const li = k.el("li", "ts-reason" + (r.strong ? " strong" : ""), r.text);
      reasons.append(li);
    }
    why.append(reasons);

    node.append(top, h, meta, why);
    if (item.note) node.append(k.el("p", "hint ts-note", item.note));

    // What goes with it
    if (item.linked && item.linked.length) {
      const box = k.el("div", "ts-linked");
      box.append(k.el("p", "ts-linked-head", `Goes with it (${item.linked.length}):`));
      const ul = k.el("ul", "ts-linked-list");
      for (const l of item.linked) ul.append(k.el("li", "", `${l.kindName}: ${l.label}`));
      box.append(ul);
      const label = k.el("label", "ts-check");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = together;
      cb.addEventListener("change", () => {
        if (cb.checked) apart.delete(item.key);
        else apart.add(item.key);
      });
      label.append(cb, k.el("span", "", item.linked.length === 1 ? "Delete it too" : "Delete these too"));
      box.append(label);
      node.append(box);
    }

    const actions = k.el("div", "actions ts-actions");
    const busy = working.has(item.key);
    if (!item.locked) {
      const del = k.el("button", "btn small danger", busy ? "Deleting…" : "Delete");
      del.type = "button";
      del.disabled = busy;
      del.setAttribute("aria-label", `Delete ${item.kindName.toLowerCase()} “${item.title}”`);
      del.addEventListener("click", () => remove([item]));
      actions.append(del);
    }
    const realBtn = k.el("button", "btn small", "Not a test");
    realBtn.type = "button";
    realBtn.disabled = busy;
    realBtn.setAttribute("aria-label", `“${item.title}” is not a test: keep it and stop showing it here`);
    realBtn.addEventListener("click", () => markReal(item));
    actions.append(realBtn);
    if (item.open) {
      const a = k.el("a", "btn small ts-open", "Open");
      a.href = item.open;
      a.setAttribute("aria-label", `Open ${item.kindName.toLowerCase()} “${item.title}” in ${item.where || "Nova Agent"}`);
      if (item.open.startsWith("/portal/")) {
        a.addEventListener("click", (e) => {
          e.preventDefault();
          window.PortalPage && window.PortalPage.go(item.open);
        });
      } else a.target = "_top";
      actions.append(a);
    }
    node.append(actions);
    return node;
  }

  function recentRow(r) {
    const k = K();
    const row = k.el("li", "ts-row");
    row.dataset.key = "tr-" + r.side + "-" + r.binId;
    row.dataset.sig = k.sig(r);
    const text = k.el("span", "ts-row-text", `${r.kindName}: ${r.title}`);
    const when = k.el("span", "ts-row-when", r.restoredAt ? `Put back ${ukWhen(r.restoredAt)}` : `Deleted ${ukWhen(r.deletedAt)}${r.deletedBy ? " by " + r.deletedBy : ""}`);
    row.append(text, when);
    if (r.noRestore) row.append(k.el("span", "ts-row-when", "Cleared (can't come back)"));
    else if (!r.restoredAt) {
      const b = k.el("button", "btn small", "Put back");
      b.type = "button";
      b.setAttribute("aria-label", `Put back “${r.title}”`);
      b.addEventListener("click", () => restore(r, b));
      row.append(b);
    }
    return row;
  }

  function realRow(r) {
    const k = K();
    const row = k.el("li", "ts-row");
    row.dataset.key = "tm-" + r.side + "-" + r.key;
    row.dataset.sig = k.sig(r);
    row.append(k.el("span", "ts-row-text", `${r.kindName || r.kind}: ${r.title}`), k.el("span", "ts-row-when", `Marked ${ukWhen(r.markedAt)}${r.markedBy ? " by " + r.markedBy : ""}`));
    const b = k.el("button", "btn small", "Undo");
    b.type = "button";
    b.setAttribute("aria-label", `Undo: show “${r.title}” here again if it looks like a test`);
    b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        await call(r.side, "unreal", { key: r.key });
        say(`“${r.title}” will be checked again.`);
      } catch (err) {
        say("Couldn't undo that: " + err.message);
      }
      await load();
    });
    row.append(b);
    return row;
  }

  // ===== Doing things =====

  // Say what happened (read out by screen readers too), with Put back when there is one
  function say(text, undo) {
    const live = $("tests-live");
    const k = K();
    const nodes = [k.el("span", "", text)];
    if (undo) {
      const b = k.el("button", "btn small", "Put back");
      b.type = "button";
      b.addEventListener("click", async () => {
        b.disabled = true;
        for (const u of undo) {
          try {
            await call(u.side, "restore", { binId: u.binId });
          } catch (err) {}
        }
        say(undo.length === 1 ? "Put back." : `${undo.length} things put back.`);
        await load();
      });
      nodes.push(b);
    }
    live.replaceChildren(...nodes);
    live.hidden = false;
  }

  async function remove(list) {
    const todo = list.filter((i) => !i.locked && !working.has(i.key));
    if (!todo.length) return;
    // Where the focus goes after: the next card's title
    const after = nextFocus(todo[todo.length - 1]);
    for (const i of todo) working.add(i.key);
    draw();
    // (the card is drawn again with its buttons waiting: keep the focus on it meanwhile)
    holdFocus(todo[0]);
    const sides = { bot: [], pc: [] };
    for (const i of todo) sides[sideOf(i)].push({ key: i.key, title: i.title, together: !apart.has(i.key), linked: (i.linked || []).map((l) => l.key) });
    const undo = [];
    const failed = [];
    for (const side of ["bot", "pc"]) {
      if (!sides[side].length) continue;
      try {
        const res = await call(side, "delete", { items: sides[side] });
        for (const d of res.done || []) undo.push({ side, binId: d.binId });
        for (const f of res.failed || []) failed.push(f.error);
      } catch (err) {
        failed.push(err.message);
      }
    }
    for (const i of todo) working.delete(i.key);
    const n = undo.length;
    if (n && !failed.length) say(n === 1 ? `Deleted “${todo[0].title}”.` : `Deleted ${n} things.`, undo);
    else if (n) say(`Deleted ${n}; ${failed.length} couldn't be: ${failed[0]}`, undo);
    else say("Nothing was deleted: " + (failed[0] || "it's gone already."));
    await load();
    focusAfter(after);
  }

  async function markReal(item) {
    const after = nextFocus(item);
    working.add(item.key);
    draw();
    holdFocus(item);
    try {
      await call(sideOf(item), "real", { key: item.key, title: item.title });
      say(`Kept “${item.title}”. It won't be shown here again (Undo is under “Marked as real”).`);
    } catch (err) {
      say("Couldn't mark that: " + err.message);
    }
    working.delete(item.key);
    await load();
    focusAfter(after);
  }

  async function restore(r, button) {
    button.disabled = true;
    try {
      await call(r.side, "restore", { binId: r.binId });
      say(`Put back “${r.title}”.`);
    } catch (err) {
      say("Couldn't put it back: " + err.message);
    }
    await load();
  }

  // The card after this one (or before it, at the end), to move the focus to
  function nextFocus(item) {
    const cards = [...document.querySelectorAll("#view-tests .ts-card")];
    const i = cards.findIndex((c) => c.dataset.key === "ts-" + item.key);
    const next = cards[i + 1] || cards[i - 1];
    return next ? next.dataset.key : null;
  }
  function holdFocus(item) {
    const title = document.querySelector(`#view-tests [data-key="${CSS.escape("ts-" + item.key)}"] .ts-title`);
    if (title && (!document.activeElement || document.activeElement === document.body)) title.focus({ preventScroll: true });
  }
  function focusAfter(key) {
    const card = key && document.querySelector(`#view-tests [data-key="${CSS.escape(key)}"] .ts-title`);
    (card || $("tests-summary")).focus({ preventScroll: false });
  }

  function disarm() {
    armed = 0;
    clearTimeout(armTimer);
  }

  $("tests-delete-all").addEventListener("click", () => {
    const deletable = items().filter((i) => i.confidence === "likely" && !i.locked);
    if (!deletable.length) return;
    if (!armed) {
      armed = deletable.length;
      clearTimeout(armTimer);
      armTimer = setTimeout(() => {
        disarm();
        draw();
      }, 8000);
      draw();
      return;
    }
    disarm();
    remove(deletable);
  });
  $("view-tests").addEventListener("keydown", (e) => {
    if (e.key === "Escape" && armed) {
      disarm();
      draw();
    }
  });
  $("tests-refresh").addEventListener("click", () => load());
  const tile = $("today-tests");
  if (tile) tile.addEventListener("click", () => K() && K().goView("tests"));

  window.PortalTests = { load };
})();
