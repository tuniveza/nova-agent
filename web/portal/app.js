// Portal's work tabs: enquiries, conversations, the calendar, clients, money (money.js), approvals, campaigns, quests, alerts, the Website bot, test stuff (teststuff.js),
// push and voice. All data comes from /app/api/ (a Portal sign-in is needed). Everything from
// the server is shown as plain text, never as HTML.
// portal.js runs the page (signing in, the address, the You tab); it starts these tabs with
// window.PortalApp.start() once someone's signed in, and they hand a sign-out back to it.

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  let enquiryFilter = "all";
  // The work tabs (the You tab and the crew are portal.js's)
  const VIEWS = ["today", "enquiries", "chats", "calendar", "clients", "money", "approvals", "campaigns", "social", "funnel", "quests", "alerts", "bot", "tests", "google", "desk", "group"];
  // On a phone these live under More, so the tab bar fits (the You tab too: portal.js's)
  const MORE = ["clients", "money", "approvals", "campaigns", "social", "funnel", "quests", "alerts", "bot", "tests", "google", "desk"];
  let currentView = "today";
  let running = false;
  let sessions = null; // session types for booking links
  let sheetEnquiry = null;
  const botHistory = [];
  let lastAlerts = []; // the alerts last shown (for voice commands)
  let lastEnquiries = []; // the enquiries last shown (for voice commands)

  // ===== Talking to the Worker =====

  async function api(path, options = {}) {
    const res = await fetch("/app/api/" + path, {
      method: options.body ? "POST" : "GET",
      headers: options.body ? { "Content-Type": "application/json" } : {},
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: "same-origin",
    });
    let data = {};
    try {
      data = await res.json();
    } catch (err) {}
    if (res.status === 401 && path !== "login") {
      showLogin();
      throw new Error("signed out");
    }
    if (!res.ok) {
      const err = new Error(data.error || "Something went wrong (" + res.status + ")");
      // (what Nova Bot said, for the few places that need more than the words, e.g. a duplicate's id)
      err.data = data;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ===== Little helpers =====

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function when(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    return date.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
  }

  function toast(message) {
    const t = $("toast");
    t.textContent = message;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.hidden = true), 2200);
  }

  // Text with web links made clickable (links only, nothing else from the text)
  function linkify(node, text) {
    String(text).split(/(https?:\/\/[^\s<>"']+)/).forEach((part, i) => {
      if (i % 2 === 0) {
        if (part) node.appendChild(document.createTextNode(part));
        return;
      }
      const trail = part.match(/[.,!?;:)]+$/);
      const url = trail ? part.slice(0, -trail[0].length) : part;
      const a = el("a", "", /acuityscheduling|\/(book\?|pay\/|booking\/)/.test(url) ? "Booking link" : /calendar\.google\.com|google\.com\/calendar/.test(url) ? "Google Calendar" : url.replace(/^https?:\/\//, ""));
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      node.appendChild(a);
      if (trail) node.appendChild(document.createTextNode(trail[0]));
    });
  }

  // Booking or enquiry details, coloured line by line: the first line stands out,
  // "Label: value" lines get a rose label, days and times are gold
  function richDetails(text) {
    // The paragraph that holds the lines
    const box = el("p", "details");
    // Each line
    String(text).split("\n").forEach((line, i) => {
      // One line of text
      const row = el("span", "d-line");
      // "Label: value"?
      const pair = line.match(/^([^:]{1,60}):\s(.+)$/);
      // A day or a time ("Thursday, 22 October 2026, 14:15–16:15")
      const isWhen = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b|\b\d{1,2}:\d{2}\b/.test(line);
      // A labelled line: coloured label, then the value ("Was:" values are crossed out)
      if (pair) {
        row.append(el("span", "d-label", pair[1] + ": "), el("span", pair[1] === "Was" ? "d-was" : "d-value", pair[2]));
      } else {
        // A day or time is gold; the first line (the session) stands out
        if (isWhen) row.classList.add("d-when");
        else if (i === 0) row.classList.add("d-first");
        // The words
        row.textContent = line;
      }
      // Add the line
      box.appendChild(row);
    });
    // Hand it back
    return box;
  }

  function emptyState(list, text) {
    reconcile(list, [el("p", "empty", text)]);
  }

  // ===== Calm redrawing =====
  // A refresh (every 15 s on Quests, coming back to the app, a new alert) only changes what really
  // changed: cards are matched by their key (data-key) and kept when their data (data-sig) is the
  // same, so nothing on screen blinks, open cards stay open, and the scroll and focus stay put.
  // Nodes without a key (day headings, "nothing here" messages) are matched by their words.
  function reconcile(list, nodes) {
    const old = new Map();
    for (const n of list.children) if (n.dataset && n.dataset.key) old.set(n.dataset.key, n);
    const used = new Set();
    const next = nodes.map((n) => {
      let key = n.dataset.key || "~" + n.tagName + "." + n.className + ":" + n.textContent;
      while (used.has(key)) key += "+";
      used.add(key);
      n.dataset.key = key;
      if (!n.dataset.sig) n.dataset.sig = n.textContent;
      const was = old.get(key);
      if (was && was.dataset.sig === n.dataset.sig) {
        old.delete(key);
        return was;
      }
      // (a card that was opened stays open when its details change)
      if (was && was.classList.contains("open")) n.classList.add("open");
      return n;
    });
    // In order, moving only what's out of place
    let at = list.firstChild;
    for (const n of next) {
      if (n === at) at = at.nextSibling;
      else list.insertBefore(n, at);
    }
    while (at) {
      const gone = at;
      at = at.nextSibling;
      gone.remove();
    }
    // The first real content after the placeholders fades in once (the placeholders held its space)
    if (list.getAttribute("aria-busy") === "true") {
      list.removeAttribute("aria-busy");
      list.classList.add("filled");
    }
  }
  // Draw a box only when what it would show is different from what it shows (sig: what it depends on)
  function redraw(box, sig, nodes) {
    const html = sig + "|" + nodes.map((n) => n.outerHTML).join("");
    if (box.dataset.sig === html) return false;
    box.dataset.sig = html;
    box.replaceChildren(...nodes);
    return true;
  }
  // Text and counts that change only when they change (no blink, no jump)
  function setText(id, value) {
    const node = $(id);
    if (node && node.textContent !== String(value)) node.textContent = String(value);
  }
  function setBadge(id, n) {
    const badge = $(id);
    const show = Number(n) > 0;
    if (badge.hidden === show) badge.hidden = !show;
    if (show) setText(id, n);
  }
  // Data as a card's signature
  const sig = (...parts) => JSON.stringify(parts);

  // ===== Signing in and out =====

  // Inside Nova Agent on the studio PC (not a phone)
  const onStudioPC = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  // The session ended (signed out elsewhere, or it ran out): portal.js shows the sign-in card
  function showLogin() {
    if (!running) return;
    running = false;
    stopHandsFree();
    if (window.PortalPage) window.PortalPage.signedOut("You've been signed out. Sign in again to carry on.");
  }

  // Signed in (portal.js calls this): the badges, the bell and hands-free voice start up
  function start() {
    running = true;
    // The Quests badge (quests left today), whatever tab is open
    loadQuests();
    loadAlerts();
    // The Approvals badge (booking changes waiting for an admin)
    loadApprovals();
    // The Campaigns badge (email campaigns waiting for an admin)
    loadCampaigns();
    // The Social badge (posts waiting for an admin, or to be posted by hand): social.js
    if (window.PortalSocial) window.PortalSocial.load();
    // The Funnel badge (first emails written and waiting for an admin): funnel.js
    if (window.PortalFunnel) window.PortalFunnel.load();
    // The Money badge (invoices waiting for an admin, and overdue ones): money.js
    if (window.PortalMoney) window.PortalMoney.load();
    // This phone's notifications still use the server's current key
    setTimeout(renewPushAddress, 3000);
    // Admins: what looks like test stuff (the Test stuff badge and Today's line): teststuff.js
    if (window.PortalTests) window.PortalTests.load();
    // Light the bell up if this phone already gets notifications
    updateNotifyPanel();
    // Hands-free voice: the mic glows, and listening starts
    $("voice").classList.toggle("on", handsFree);
    startHandsFree();
  }
  // Signed out on purpose (portal.js): stop listening
  function stop() {
    running = false;
    stopHandsFree();
  }

  $("logout").addEventListener("click", () => window.PortalPage && window.PortalPage.signOut());

  // ===== Switching sections =====

  // One view at a time. A view that comes into sight fades in once (only then: never on a
  // refresh of the view already showing). portal.js shows its own views (You, Admin) with this too.
  function showOnly(id) {
    document.querySelectorAll("#main > .view").forEach((v) => {
      const on = v.id === id;
      if (v.hidden === !on) return;
      v.hidden = !on;
      if (on) enter(v);
    });
  }
  function enter(node) {
    node.classList.remove("view-enter");
    if (calm()) return;
    void node.offsetWidth;
    node.classList.add("view-enter");
    node.addEventListener("animationend", () => node.classList.remove("view-enter"), { once: true });
  }
  const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.getAttribute("data-motion") === "calm";

  // Show one of the work tabs (portal.js decides which from the address, and calls this)
  function show(view) {
    if (!VIEWS.includes(view)) view = "today";
    currentView = view;
    document.querySelectorAll(".tabs .tab").forEach((t) => {
      // (Portal's bookings month lights Booking tools: the Calendar item opens the Calendar panel)
      const on = t.id === "nav-booking-tools" ? view === "calendar" : t.dataset.view === "calendar" ? false : t.dataset.view === view || (t.id === "tab-more" && (MORE.includes(view) || view === "calendar"));
      if (t.classList.contains("active") !== on) t.classList.toggle("active", on);
      if (on) t.setAttribute("aria-current", "page");
      else t.removeAttribute("aria-current");
    });
    showOnly("view-" + view);
    if (view === "today") loadToday();
    if (view === "quests") loadQuests();
    if (view === "enquiries") loadEnquiries();
    if (view === "chats") {
      // (?chat=ID, from a phone ping about a chat: open that one, once)
      const wanted = new URLSearchParams(location.search).get("chat");
      if (wanted && wanted !== pickedChat) {
        pickedChat = wanted;
        openChatId = wanted;
      }
      openChatId ? openChat(openChatId, openChatName) : loadChats();
    }
    if (view === "calendar") loadCalendar();
    if (view === "approvals") loadApprovals();
    if (view === "campaigns") loadCampaigns();
    if (view === "social" && window.PortalSocial) window.PortalSocial.load();
    if (view === "funnel" && window.PortalFunnel) window.PortalFunnel.load();
    if (view === "clients") loadClients();
    // (Today's "Invoices overdue" too)
    if ((view === "money" || view === "today") && window.PortalMoney) window.PortalMoney.load();
    if ((view === "tests" || view === "today") && window.PortalTests) window.PortalTests.load();
    if (view === "google" && window.PortalGoogle) window.PortalGoogle.load();
    if (view === "desk" && window.PortalDesk) window.PortalDesk.load();
    // A Nova Tab's Overview (dash.js)
    if (view === "group" && window.NovaDash) window.NovaDash.group();
    // Every section keeps the Alerts badge up to date; the Alerts tab also shows the list
    loadAlerts();
    if (view === "bot") setTimeout(() => $("bot-input").focus({ preventScroll: true }), 50);
  }

  // A tab: the address follows (so a reload stays put), and portal.js shows it
  const goView = (view) => {
    // One calendar: Calendar (and Today's "Bookings today") open the Calendar panel
    if (view === "calendar") return openCalendar();
    // Conversations from the menu starts at the list
    if (view === "chats" && currentView !== "chats") openChatId = null;
    return window.PortalPage && window.PortalPage.go("/portal/?view=" + (view === "admin" ? "manage" : view), { replace: VIEWS.includes(view) });
  };
  document.querySelectorAll(".tabs .tab[data-view]").forEach((tab) => tab.addEventListener("click", () => goView(tab.dataset.view)));

  // One calendar: the Calendar panel has everything, the studio's bookings too. Inside Nova Agent it
  // opens in Nova Agent's viewer; Portal on its own opens Nova Agent with Calendar showing.
  // (Portal's own bookings month, /portal/?view=calendar, still works: the starting tab, voice.)
  function openCalendar() {
    try {
      if (window.parent !== window && window.parent.NovaAgent && window.parent.NovaAgent.open && window.parent.NovaAgent.open("/calendar/")) return;
    } catch (err) {}
    location.href = "/agent/?open=%2Fcalendar%2F";
  }
  $("cal-open-panel").addEventListener("click", openCalendar);
  // Booking tools: Portal's own bookings month (this week at a glance, free slots), one tap away
  const openBookingTools = () => window.PortalPage && window.PortalPage.go("/portal/?view=calendar", { replace: true });
  $("nav-booking-tools").addEventListener("click", openBookingTools);
  $("today-booking-tools").addEventListener("click", openBookingTools);

  // Inside Nova Agent Portal's own top bar steps aside: Voice, Music, Options and the other apps
  // are in the side menu (or the row of sections) instead, doing just what their top-bar buttons do
  $("nav-voice").addEventListener("click", () => $("voice").click());
  $("nav-music").addEventListener("click", () => $("music").click());
  $("nav-options").addEventListener("click", () => openOptions());
  $("nav-suite").addEventListener("click", () => $("brand").click());
  const openOptions = () => window.PortalOptions && window.PortalOptions.open();
  // The menu's Voice glows with the mic, and goes where the mic can't be used
  new MutationObserver(() => {
    $("nav-voice").classList.toggle("on", $("voice").classList.contains("on"));
    $("nav-voice").hidden = $("voice").hidden;
  }).observe($("voice"), { attributes: true, attributeFilter: ["class", "hidden"] });

  // Agent: the same conversation as Nova Agent's own, never a second one. Inside Nova Agent this
  // panel steps aside for Agent; Portal on its own opens Nova Agent at Agent.
  $("nav-agent").addEventListener("click", () => {
    try {
      if (window.parent !== window && window.parent.NovaAgent && window.parent.NovaAgent.agent) return window.parent.NovaAgent.agent();
    } catch (err) {}
    location.href = "/agent/";
  });

  // ===== More (phones): the sections that don't fit on the bar, in the menu's groups (Studio:
  // Clients, Approvals, Campaigns, Website bot; Plans: Quests, Alerts, Agent; You; Admin), with their counts =====
  function openMore() {
    const list = $("more-list");
    const items = [];
    let group = null;
    const inside = document.documentElement.classList.contains("embed");
    for (const node of document.querySelector(".tabs").children) {
      if (node.classList.contains("tab-group")) {
        group = node;
        continue;
      }
      if (!node.classList.contains("tab-more") || node.hidden || (node.classList.contains("embed-only") && !inside)) continue;
      if (group) {
        items.push(el("p", "more-group", group.textContent));
        group = null;
      }
      const tab = node;
      const item = el("button", "more-item" + (tab.classList.contains("active") ? " active" : ""));
      item.type = "button";
      const icon = tab.querySelector("svg, img").cloneNode(true);
      icon.removeAttribute("id");
      const hint = tab.querySelector(".tab-hint");
      const name = el("span", "more-name", tab.querySelector("span:not(.badge)").textContent);
      if (hint) name.append(el("small", "more-hint", hint.textContent));
      item.append(icon, name);
      const badge = tab.querySelector(".badge");
      if (badge && !badge.hidden) item.appendChild(el("span", "badge", badge.textContent));
      item.addEventListener("click", () => {
        $("more-sheet").hidden = true;
        // A Portal section, or (Agent) whatever that button does
        if (tab.dataset.view) goView(tab.dataset.view);
        else tab.click();
      });
      items.push(item);
    }
    list.replaceChildren(...items);
    $("more-sheet").hidden = false;
  }
  $("tab-more").addEventListener("click", openMore);
  $("more-close").addEventListener("click", () => ($("more-sheet").hidden = true));
  $("more-sheet").addEventListener("click", (e) => e.target === $("more-sheet") && ($("more-sheet").hidden = true));

  // The counts behind More (and Today's tiles) follow the Quests, Alerts, Approvals and Campaigns badges
  // (the Today tiles show a count once it's known: until then they keep their "–")
  const known = new Set();
  function syncCounts() {
    const n = (id) => ($(id).hidden ? 0 : Number($(id).textContent) || 0);
    setBadge("more-badge", n("quest-badge") + n("alert-badge") + n("approvals-badge") + n("campaigns-badge") + n("social-badge") + n("funnel-badge") + n("money-badge"));
    if (known.has("alerts")) setText("t-alerts", n("alert-badge"));
    if (known.has("quests")) setText("t-quests", n("quest-badge"));
  }

  // ===== Today: what matters at a glance (each tile opens its section) =====
  // (Today's "Invoices overdue" opens the Invoicer on the overdue ones: everything for invoices is there, 19 Oct 2026)
  document.querySelectorAll("#view-today [data-go]").forEach((b) => b.addEventListener("click", () => (b.dataset.go === "money" && window.NovaInvoicer ? window.NovaInvoicer.open({ filter: "overdue" }) : goView(b.dataset.go))));
  const todayName = () => new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" });
  setText("today-date", todayName());
  async function loadToday() {
    setText("today-date", todayName());
    // Everything in one section: a tile for every section (dash.js)
    if (window.NovaDash) window.NovaDash.today();
    const today = dayKey(new Date());
    const set = setText;
    const [enq, chats, cal] = await Promise.allSettled([api("enquiries"), api("conversations"), api("calendar")]);
    const list = $("today-list");
    if (enq.status === "fulfilled") {
      set("t-enquiries", enq.value.newCount || 0);
      setBadge("new-badge", enq.value.newCount);
      lastEnquiries = enq.value.enquiries;
      const newest = enq.value.enquiries.slice(0, 3);
      if (newest.length) reconcile(list, newest.map(enquiryCard));
      else emptyState(list, "Nothing new. All caught up ✦");
    } else if (enq.reason && enq.reason.message !== "signed out") emptyState(list, enq.reason.message);
    if (chats.status === "fulfilled") set("t-chats", chats.value.conversations.filter((c) => c.started && dayKey(new Date(c.started)) === today).length);
    if (cal.status === "fulfilled") set("t-bookings", cal.value.setUp ? cal.value.bookings.filter((b) => { const d = feedDate(b.start); return d && dayKey(d) === today; }).length : "–");
    // Today's calendar, with Google Calendar's events (google.js)
    if (window.PortalGoogle && window.PortalGoogle.today) window.PortalGoogle.today();
    syncCounts();
  }
  const onWorkTab = () => running && !$("view-" + currentView).hidden;
  $("refresh").addEventListener("click", () => {
    if (onWorkTab()) show(currentView);
    else window.PortalPage && window.PortalPage.refresh();
    toast("Refreshed");
  });
  // Coming back to the app: get the latest
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && onWorkTab() && currentView !== "bot") show(currentView);
  });

  // ===== Enquiries =====

  document.querySelectorAll("[data-show]").forEach((chip) =>
    chip.addEventListener("click", () => {
      enquiryFilter = chip.dataset.show;
      document.querySelectorAll("[data-show]").forEach((c) => c.classList.toggle("active", c === chip));
      loadEnquiries();
    })
  );
  // Search: as you type (a moment after the last key)
  let enquirySearch = "";
  let searchTimer = null;
  $("enq-search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      enquirySearch = $("enq-search").value.trim();
      loadEnquiries();
    }, 300);
  });

  // What each inbox place is empty of
  const INBOX_EMPTY = {
    all: "No enquiries yet.",
    new: "No new enquiries. They appear here when a customer asks NovaBot to send one.",
    open: "Nothing open. Tap Open on an enquiry when you start on it.",
    replied: "Nobody to wait on: enquiries you've replied to wait here for their answer.",
    done: "Nothing done yet.",
    spam: "No spam. Likely spam lands here by itself (with the reason), and never pings anyone.",
  };
  let inboxTeam = []; // the team, for "who's on it"

  async function loadEnquiries() {
    // An enquiry open (?enquiry=ID in the address): its conversation; otherwise the list
    const openId = Number(new URLSearchParams(location.search).get("enquiry"));
    if (Number.isInteger(openId) && openId > 0) return openThread(openId);
    closeThread();
    loadSaved();
    const list = $("enquiry-list");
    try {
      const params = new URLSearchParams(enquiryFilter === "all" ? { show: "all" } : { box: enquiryFilter });
      if (enquirySearch) params.set("q", enquirySearch);
      const data = await api("enquiries?" + params);
      if (threadId) return; // an enquiry was opened meanwhile
      lastEnquiries = data.enquiries;
      setBadge("new-badge", data.newCount);
      inboxCounts(data);
      if (!data.enquiries.length) {
        return emptyState(list, enquirySearch ? "Nothing matches “" + enquirySearch + "”." : INBOX_EMPTY[enquiryFilter] || INBOX_EMPTY.all);
      }
      reconcile(list, data.enquiries.map(enquiryCard));
    } catch (err) {
      if (err.message !== "signed out") emptyState(list, err.message);
    }
  }

  // The counts on the inbox chips, the team and the labels already used
  function inboxCounts(data) {
    const counts = data.counts || {};
    document.querySelectorAll("#enq-chips [data-count]").forEach((n) => (n.textContent = counts[n.dataset.count] ? String(counts[n.dataset.count]) : ""));
    if (data.team) inboxTeam = data.team;
    if (data.labels) $("enq-labels").replaceChildren(...data.labels.map((l) => Object.assign(el("option"), { value: l })));
  }

  // Open one enquiry (the address changes, so Back returns to the list)
  const goEnquiry = (id) => window.PortalPage && window.PortalPage.go("/portal/?view=enquiries" + (id ? "&enquiry=" + id : ""));

  // The enquiry's state as a pill: New, Open, Replied, Done, Spam, Don't contact (and its label,
  // and drafts waiting)
  function statePills(title, q) {
    if (q.status === "spam") title.appendChild(el("span", "pill-spam", "Spam"));
    else if (q.do_not_contact_at) title.appendChild(el("span", "pill-stop", "Don't contact"));
    else if (q.status === "new") title.appendChild(el("span", "pill-new", "New"));
    else if (q.status === "open") title.appendChild(el("span", "pill-open", "Open"));
    else if (q.status === "replied") title.appendChild(el("span", "pill-replied", "Replied"));
    else title.appendChild(el("span", "pill-done", "Done"));
    if (q.label) title.appendChild(el("span", "pill-label", q.label));
    if (q.drafts) title.appendChild(el("span", "pill-draft", q.drafts === 1 ? "Draft to approve" : q.drafts + " drafts to approve"));
    if (q.failed) title.appendChild(el("span", "pill-failed", "Didn't send"));
  }

  // ===== WhatsApp, calls and texts (from the person's own phone) =====
  // Portal doesn't send these itself: it opens WhatsApp (the app, or WhatsApp Web on a
  // computer), Messages or the dialler with the customer's number and the message filled in.
  // The person sends or calls from there; then Portal asks how it went and adds that to the
  // conversation. q.dial is the number in full international form from Nova Bot
  // ("+447700900123"), or null when it isn't a mobile.
  const onPhone = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  // Where WhatsApp opens. On a phone: WhatsApp's own link, which opens the app. On a computer:
  // straight into WhatsApp Web (no "continue to chat" page in between), always in the same
  // tab, or the WhatsApp app if the person picked it (remembered on this computer).
  const waQuery = (dial, text) => "phone=" + dial.replace(/\D/g, "") + (text ? "&text=" + encodeURIComponent(text) : "");
  const WA_PICK = "nova-portal-whatsapp";
  function waWhere() {
    if (onPhone) return "phone";
    try {
      return localStorage.getItem(WA_PICK) === "app" ? "app" : "web";
    } catch (err) {
      return "web";
    }
  }
  function waLink(dial, text) {
    const where = waWhere();
    if (where === "app") return "whatsapp://send?" + waQuery(dial, text);
    return (where === "web" ? "https://web.whatsapp.com/send?" : "https://api.whatsapp.com/send?") + waQuery(dial, text);
  }
  function openWhatsApp(dial, text) {
    const where = waWhere();
    if (where === "app") location.href = waLink(dial, text);
    // One WhatsApp Web tab, used again each time (it can't have two open at once)
    else if (where === "web") window.open(waLink(dial, text), "nova-whatsapp-web");
    else window.open(waLink(dial, text), "_blank", "noopener");
  }
  // "?&body=" works on both iPhone and Android
  const smsLink = (dial, text) => "sms:" + dial + (text ? "?&body=" + encodeURIComponent(text) : "");
  // A number to call: the mobile, or whatever they typed (a landline can still be called)
  const callNumber = (q) => q.dial || String(q.phone || "").replace(/[^0-9+]/g, "");
  // "+44 7700 900123": easy to read and type
  function prettyNumber(dial) {
    const uk = /^\+44(\d{4})(\d{6})$/.exec(dial);
    return uk ? "+44 " + uk[1] + " " + uk[2] : dial;
  }

  // Email, WhatsApp, Call and Text for a customer (none but Email once they've asked not to be
  // contacted). onCall: also run when Call is pressed (the conversation asks how it went).
  function contactLinks(actions, q, emailClass = "btn small", onCall) {
    const reply = el("a", emailClass, "Email");
    reply.href = "mailto:" + encodeURIComponent(q.email) + "?subject=" + encodeURIComponent("Re: " + (q.subject || "Your Novacane enquiry"));
    actions.appendChild(reply);
    if (q.do_not_contact_at) return;
    if (q.dial) {
      const wa = el("a", "btn small ghost", "WhatsApp");
      wa.href = waLink(q.dial);
      wa.target = "_blank";
      wa.rel = "noopener";
      wa.addEventListener("click", (e) => {
        e.preventDefault();
        openWhatsApp(q.dial);
      });
      actions.appendChild(wa);
    }
    const number = callNumber(q);
    if (number) actions.appendChild(phoneButton("Call", "tel:" + number, () => phoneSheet(q, "call"), onCall));
    if (q.dial) actions.appendChild(phoneButton("Text", smsLink(q.dial), () => phoneSheet(q, "sms")));
  }

  // On a phone: straight to the dialler or Messages. On a computer (where those links often do
  // nothing): the number to use on your phone, plus "Try on this computer" for a Mac or PC that can.
  function phoneButton(text, href, onComputer, after) {
    if (onPhone) {
      const a = el("a", "btn small ghost", text);
      a.href = href;
      if (after) a.addEventListener("click", after);
      return a;
    }
    return button(text, "btn small ghost", () => {
      onComputer();
      if (after) after();
    });
  }

  // The "from your phone" sheet: a call, or a text (with the message to send)
  function phoneSheet(q, kind, text) {
    const number = kind === "call" ? callNumber(q) : q.dial;
    const first = q.name.split(/\s+/)[0];
    const link = kind === "call" ? "tel:" + number : smsLink(number, text);
    setText("phone-title", (kind === "call" ? "Call " : "Text ") + first);
    setText("phone-for", kind === "call" ? "Call this number from your phone:" : "Send " + (text ? "this message" : "a text") + " to this number from your phone:");
    $("phone-number").textContent = prettyNumber(number);
    $("phone-number").href = link;
    $("phone-number").dataset.number = number;
    $("phone-here").href = link;
    setText("phone-here", kind === "call" ? "Call from this computer" : "Open Messages on this computer");
    $("phone-text-box").hidden = !text;
    $("phone-text").value = text || "";
    $("phone-copy-text").hidden = !text;
    setText(
      "phone-hint",
      kind === "call"
        ? "On a Mac with an iPhone, or a PC with Phone Link, “Call from this computer” rings through your phone."
        : "On a Mac with an iPhone, or a PC with Phone Link, “Open Messages” sends it through your phone."
    );
    $("phone-sheet").hidden = false;
  }
  async function copyText(text, done) {
    try {
      await navigator.clipboard.writeText(text);
      toast(done);
    } catch (err) {
      toast("Couldn't copy: select it and copy it");
    }
  }
  $("phone-copy").addEventListener("click", () => copyText($("phone-number").dataset.number, "Number copied"));
  $("phone-copy-text").addEventListener("click", () => copyText($("phone-text").value, "Message copied"));
  $("phone-close").addEventListener("click", () => ($("phone-sheet").hidden = true));
  $("phone-sheet").addEventListener("click", (e) => {
    if (e.target === $("phone-sheet")) $("phone-sheet").hidden = true;
  });

  function enquiryCard(q) {
    const card = el("article", "card fold" + (q.status === "done" || q.status === "spam" ? " done" : ""));
    card.dataset.key = "e" + q.id;
    card.dataset.sig = sig(q, inboxTeam.length);
    // On a phone an enquiry is one line (what, who, when) until it's tapped
    card.addEventListener("click", (e) => {
      if (e.target.closest("a, button, select, input, label")) return;
      card.classList.toggle("open");
    });
    const top = el("div", "card-top");
    const title = el("h3", "card-title", q.subject || "Enquiry");
    statePills(title, q);
    top.append(title, el("span", "card-meta", when(q.created_at)));
    card.append(top, el("p", "card-who", q.name + " · " + q.email + (q.phone ? " · " + q.phone : "")));
    card.appendChild(el("p", "details", q.details));
    if (q.status === "spam" && q.spam_reason) card.appendChild(el("p", "ib-why", q.spam_reason));
    card.appendChild(el("p", "card-foot", [q.assigned_name ? q.assigned_name + "'s on it" : "", q.page ? "From " + q.page : "", q.emailed ? "Email copy sent" : "", q.replies ? q.replies + (q.replies === 1 ? " reply sent" : " replies sent") : ""].filter(Boolean).join(" · ")));

    const actions = el("div", "actions");
    // The conversation: reply from here, see drafts and notes
    const open = el("button", "btn small", q.drafts ? "Open · approve draft" : "Open & reply");
    open.type = "button";
    open.addEventListener("click", () => goEnquiry(q.id));
    actions.appendChild(open);
    contactLinks(actions, q, "btn small ghost");
    const link = el("button", "btn small ghost", "Booking link");
    link.type = "button";
    link.addEventListener("click", () => openSheet(q));
    actions.appendChild(link);
    if (q.chat_id) {
      const chat = el("button", "btn small ghost", "Read conversation");
      chat.type = "button";
      chat.addEventListener("click", () => {
        openChatId = null;
        show("chats");
        openChat(q.chat_id, q.name);
      });
      actions.appendChild(chat);
    }
    card.appendChild(actions);
    card.appendChild(sortRow(q));
    return card;
  }

  // ===== The inbox: where an enquiry is, who's on it, its label (one press each) =====
  const SORT_PLACES = [
    ["new", "New"],
    ["open", "Open"],
    ["replied", "Waiting"],
    ["done", "Done"],
  ];
  const SORT_SAID = { new: "Moved to New", open: "Open: it's being worked on", replied: "Waiting on them", done: "Marked done", spam: "Moved to Spam (nothing's deleted)" };

  async function sortEnquiry(q, changes, said) {
    try {
      await api("inbox/sort", { body: { id: q.id, ...changes } });
      toast(said);
    } catch (err) {
      toast(err.message);
    }
    if (threadId) loadThread();
    else loadEnquiries();
  }

  function sortRow(q) {
    const row = el("div", "ib-sort");
    if (q.status === "spam") {
      row.appendChild(button("Not spam", "btn small", () => sortEnquiry(q, { state: "new" }, "Back in New")));
      return row;
    }
    const places = el("div", "chips ib-places");
    places.setAttribute("role", "group");
    places.setAttribute("aria-label", "Move to");
    for (const [state, name] of SORT_PLACES) {
      const b = button(name, "chip" + (q.status === state ? " active" : ""), () => q.status !== state && sortEnquiry(q, { state }, SORT_SAID[state]));
      b.setAttribute("aria-pressed", String(q.status === state));
      if (state === "replied") b.title = "Replied: waiting on them";
      places.appendChild(b);
    }
    row.appendChild(places);
    // Who's on it
    const who = el("select", "ib-pick");
    who.setAttribute("aria-label", "Who's on it");
    who.appendChild(Object.assign(el("option", "", "Nobody's on it"), { value: "" }));
    for (const p of inboxTeam) who.appendChild(Object.assign(el("option", "", p.name + "'s on it"), { value: p.id }));
    who.value = q.assigned_to || "";
    who.addEventListener("change", () => sortEnquiry(q, { assignedTo: who.value || null }, who.value ? who.selectedOptions[0].textContent : "Nobody's on it"));
    row.appendChild(who);
    // Its label: tap, type (or pick one used before), Enter
    const label = el("input", "ib-label");
    label.type = "text";
    label.maxLength = 40;
    label.placeholder = "Label";
    label.value = q.label || "";
    label.setAttribute("list", "enq-labels");
    label.setAttribute("aria-label", "Label");
    label.enterKeyHint = "done";
    const saveLabel = () => label.value.trim() !== (q.label || "") && sortEnquiry(q, { label: label.value.trim() }, label.value.trim() ? "Labelled “" + label.value.trim() + "”" : "Label cleared");
    label.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), label.blur()));
    label.addEventListener("change", saveLabel);
    row.appendChild(label);
    row.appendChild(button("Spam", "btn small ghost", () => sortEnquiry(q, { state: "spam" }, SORT_SAID.spam)));
    return row;
  }

  // ===== Saved replies: the team's answers to routine questions =====
  // Picking one in an enquiry fills the reply box ({name} becomes their first name); it still
  // only goes when someone presses Send, like any reply.
  let savedReplies = [];
  let savedEditing = null; // the saved reply being changed, or null for a new one
  let savedLoaded = 0;

  async function loadSaved(force) {
    if (!force && Date.now() - savedLoaded < 60000) return;
    try {
      savedReplies = (await api("inbox/saved")).saved || [];
      savedLoaded = Date.now();
      drawSaved();
    } catch (err) {
      if (err.message !== "signed out" && !$("saved-panel").hidden) toast(err.message);
    }
  }

  function drawSaved() {
    const list = $("saved-list");
    if (!savedReplies.length) list.replaceChildren(el("p", "hint", "None yet. Add the answers you give most often."));
    else
      list.replaceChildren(
        ...savedReplies.map((r) => {
          const item = el("div", "ib-saved-item");
          item.append(el("strong", "", r.title), el("p", "", r.body));
          const actions = el("div", "actions");
          actions.appendChild(
            button("Change", "btn small ghost", () => {
              savedEditing = r.id;
              $("saved-title").value = r.title;
              $("saved-body").value = r.body;
              setText("saved-save", "Save changes");
              $("saved-cancel").hidden = false;
              $("saved-title").focus();
            })
          );
          // Two presses, so one slip doesn't lose it
          actions.appendChild(
            button("Remove", "btn small ghost", async (b) => {
              if (!b.dataset.sure) {
                b.dataset.sure = "1";
                b.textContent = "Sure? Remove";
                setTimeout(() => {
                  delete b.dataset.sure;
                  b.textContent = "Remove";
                }, 4000);
                return;
              }
              try {
                savedReplies = (await api("inbox/saved/remove", { body: { id: r.id } })).saved;
                toast("Removed");
                drawSaved();
              } catch (err) {
                toast(err.message);
              }
            })
          );
          item.appendChild(actions);
          return item;
        })
      );
    // The picker in the reply box
    const pick = $("thread-saved");
    pick.replaceChildren(Object.assign(el("option", "", "Saved replies…"), { value: "" }), ...savedReplies.map((r) => Object.assign(el("option", "", r.title), { value: String(r.id) })));
    pick.hidden = !savedReplies.length;
  }

  function resetSavedForm() {
    savedEditing = null;
    $("saved-form").reset();
    setText("saved-save", "Add saved reply");
    $("saved-cancel").hidden = true;
  }
  $("saved-open").addEventListener("click", () => {
    const open = $("saved-panel").hidden;
    $("saved-panel").hidden = !open;
    $("saved-open").setAttribute("aria-expanded", String(open));
    if (open) loadSaved(true);
  });
  $("saved-cancel").addEventListener("click", resetSavedForm);
  $("saved-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const save = $("saved-save");
    save.disabled = true;
    try {
      const body = { title: $("saved-title").value, body: $("saved-body").value, ...(savedEditing ? { id: savedEditing } : {}) };
      savedReplies = (await api("inbox/saved", { body })).saved;
      toast(savedEditing ? "Saved" : "Added");
      resetSavedForm();
      drawSaved();
    } catch (err) {
      toast(err.message);
    }
    save.disabled = false;
  });
  // In an enquiry: fill the box with one (added after anything already written)
  $("thread-saved").addEventListener("change", () => {
    const r = savedReplies.find((x) => String(x.id) === $("thread-saved").value);
    $("thread-saved").value = "";
    if (!r) return;
    const first = thread && thread.enquiry ? thread.enquiry.name.split(/\s+/)[0] : "";
    const text = r.body.replace(/\{name\}/gi, first || "there");
    const box = $("thread-input");
    box.value = box.value.trim() ? box.value.replace(/\s+$/, "") + "\n\n" + text : text;
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.focus();
    toast("Filled in: check it, then Send");
  });

  // The enquiry list refreshes itself while it's on screen (only what changed is redrawn)
  setInterval(() => !document.hidden && running && currentView === "enquiries" && !threadId && loadEnquiries(), 20000);

  // ===== Approvals: booking changes waiting for an admin =====
  // Agent (and Portal's staff chat) can only PROPOSE a booking change: a new booking, a move, a
  // cancel, new details, or a blocked time added or removed. Nothing happens in Acuity until an
  // admin presses Approve here (or on the proposal's card under Agent's reply), with their own
  // sign-in; Nova Bot checks that again and runs it once. Everyone signed in can look; canDecide
  // (from Nova Bot) says whether this person can decide. Waiting ones come first, then the recent
  // decided ones with what became of them. ?view=approvals&action=<id> points at one.
  let approvalEditing = null; // the proposal whose fields are open (refreshes wait meanwhile), or null
  let approvalPicked = null; // the ?action= one already pointed at
  const APPROVAL_KINDS = { create: "New booking", reschedule: "Move a booking", cancel: "Cancel a booking", update: "Booking details", block_add: "Block off time", block_remove: "Unblock time" };
  const APPROVAL_STATUS = { pending: ["pill-draft", "Waiting"], approved: ["pill-replied", "Approved"], executed: ["pill-done", "Done"], failed: ["pill-failed", "Didn't go through"], rejected: ["pill-stop", "Rejected"] };
  const PROPOSERS = { agent: "Nova Agent", "staff-chat": "Portal's staff chat" };
  // The simple fields each kind can have changed before it's approved
  const APPROVAL_FIELDS = {
    create: [["start", "When (UK time)", "when"], ["firstName", "First name"], ["lastName", "Last name"], ["email", "Email", "email"], ["phone", "Phone"], ["notes", "Notes", "long"], ["notifyClient", "Acuity emails the client", "tick"]],
    reschedule: [["start", "New time (UK time)", "when"], ["notifyClient", "Acuity emails the client", "tick"]],
    cancel: [["note", "Cancel note", "long"], ["notifyClient", "Acuity emails the client", "tick"]],
    update: [["firstName", "First name"], ["lastName", "Last name"], ["email", "Email", "email"], ["phone", "Phone"], ["notes", "Notes", "long"]],
    block_add: [["start", "From (UK time)", "when"], ["end", "Until (UK time)", "when"], ["notes", "Notes", "long"]],
    block_remove: [],
  };
  // A UTC time as UK wall-clock "YYYY-MM-DDTHH:MM" (for a date-and-time box)
  function ukLocal(iso) {
    const d = new Date(iso);
    if (!iso || isNaN(d)) return "";
    const p = {};
    for (const x of new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d)) p[x.type] = x.value;
    return p.year + "-" + p.month + "-" + p.day + "T" + p.hour + ":" + p.minute;
  }

  async function loadApprovals() {
    const list = $("approvals-list");
    let data;
    try {
      data = await api("booking-actions?status=all");
    } catch (err) {
      if (currentView === "approvals" && err.message !== "signed out") emptyState(list, "Couldn't load approvals: " + err.message);
      return;
    }
    const actions = data.actions || [];
    const pending = actions.filter((a) => a.status === "pending").sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    setBadge("approvals-badge", pending.length);
    syncCounts();
    if (currentView !== "approvals") return;
    setText("approvals-hint", data.canDecide ? "Booking changes Nova Agent proposed. Nothing changes in Acuity until you approve it." : "Booking changes Nova Agent proposed. An admin approves these; nothing changes in Acuity until then.");
    const decided = actions
      .filter((a) => a.status !== "pending")
      .sort((a, b) => String(b.decidedAt || b.createdAt).localeCompare(String(a.decidedAt || a.createdAt)))
      .slice(0, 20);
    const nodes = pending.length ? pending.map((a) => approvalCard(a, data.canDecide)) : [el("p", "empty", "Nothing waiting for approval.")];
    if (decided.length) nodes.push(el("h3", "group-head", "Decided"), ...decided.map((a) => approvalCard(a, data.canDecide)));
    reconcile(list, nodes);
    // Pointed at one (from a notification or Agent's card): bring it into view, once
    const want = new URLSearchParams(location.search).get("action");
    if (want && approvalPicked !== want) {
      const card = list.querySelector('[data-key="act-' + CSS.escape(want) + '"]');
      if (card) {
        approvalPicked = want;
        card.classList.add("picked");
        card.scrollIntoView({ block: "center", behavior: calm() ? "auto" : "smooth" });
      }
    }
  }

  function approvalCard(a, canDecide) {
    const editing = approvalEditing === a.id && a.status === "pending" && canDecide;
    const card = el("article", "card appr" + (a.status === "pending" ? "" : " done"));
    card.dataset.key = "act-" + a.id;
    card.dataset.sig = sig(a.status, a.summary, a.payload, a.reason, a.decidedByName, a.error, a.executedAt, canDecide, editing);
    const top = el("div", "card-top");
    const title = el("h3", "card-title", APPROVAL_KINDS[a.kind] || "Booking change");
    const pill = APPROVAL_STATUS[a.status] || ["pill-stop", a.status];
    title.appendChild(el("span", pill[0], pill[1]));
    top.append(title, el("span", "card-meta", when(a.createdAt)));
    card.append(top, el("p", "details appr-summary", a.summary));
    card.appendChild(el("p", "card-who", "Proposed by " + (PROPOSERS[a.proposedBy] || a.proposedBy || "someone")));
    if (a.reason) card.appendChild(el("p", "appr-why", "Why: " + a.reason));
    // What became of it
    const by = a.decidedByName ? " by " + a.decidedByName : "";
    if (a.status === "executed") card.appendChild(el("p", "appr-result ok", "Done in Acuity · approved" + by + (a.executedAt ? " · " + when(a.executedAt) : "")));
    if (a.status === "approved") card.appendChild(el("p", "appr-result", "Approved" + by + " · going through to Acuity…"));
    if (a.status === "failed") card.appendChild(el("p", "appr-result bad", "Didn't go through: " + String(a.error || "unknown reason").replace(/\.$/, "") + ". Approved" + by + "; nothing else was changed."));
    if (a.status === "rejected") card.appendChild(el("p", "appr-result", "Rejected" + by + (a.decidedAt ? " · " + when(a.decidedAt) : "") + ". Nothing was changed."));
    if (a.status !== "pending") return card;
    if (!canDecide) {
      card.appendChild(el("p", "card-foot", "An admin approves these."));
      return card;
    }
    const fields = APPROVAL_FIELDS[a.kind] || [];
    const box = editing ? approvalFields(a, fields) : null;
    if (box) card.appendChild(box);
    const row = el("div", "actions");
    const ok = el("button", "btn small", editing ? "Approve with changes" : "Approve");
    ok.type = "button";
    ok.addEventListener("click", () => decideApproval(card, "approve", editing ? { id: a.id, payload: editedPayload(a, box) } : { id: a.id }));
    row.appendChild(ok);
    if (fields.length) {
      const edit = el("button", "btn small ghost", editing ? "Save changes" : "Edit");
      edit.type = "button";
      edit.addEventListener("click", () => {
        if (!editing) {
          approvalEditing = a.id;
          return loadApprovals();
        }
        decideApproval(card, "edit", { id: a.id, payload: editedPayload(a, box) });
      });
      row.appendChild(edit);
    }
    if (editing) {
      const close = el("button", "btn small ghost", "Cancel");
      close.type = "button";
      close.addEventListener("click", () => {
        approvalEditing = null;
        loadApprovals();
      });
      row.appendChild(close);
    }
    // Reject: pressed twice, so a stray tap doesn't
    const no = el("button", "btn small ghost", "Reject");
    no.type = "button";
    no.addEventListener("click", () => {
      if (no.dataset.sure !== "1") {
        no.dataset.sure = "1";
        no.textContent = "Reject it?";
        return;
      }
      decideApproval(card, "reject", { id: a.id });
    });
    row.appendChild(no);
    card.appendChild(row);
    return card;
  }

  // The edit fields, filled from the proposal as it is
  function approvalFields(a, fields) {
    const box = el("div", "appr-edit");
    for (const [key, label, type] of fields) {
      const v = a.payload ? a.payload[key] : undefined;
      const row = el("label", "appr-field" + (type === "tick" ? " tick" : ""));
      let input;
      if (type === "tick") {
        input = el("input");
        input.type = "checkbox";
        input.checked = v !== false;
      } else if (type === "long") {
        input = el("textarea");
        input.rows = 2;
        input.maxLength = 2000;
        input.value = v || "";
      } else {
        input = el("input");
        input.type = type === "when" ? "datetime-local" : type === "email" ? "email" : "text";
        input.value = type === "when" ? ukLocal(v) : v || "";
      }
      input.dataset.field = key;
      input.dataset.type = type || "text";
      if (type === "tick") row.append(input, el("span", "", label));
      else row.append(el("span", "", label), input);
      box.appendChild(row);
    }
    return box;
  }
  // What the fields say now (the proposal's other details stay as they were; Nova Bot checks it all again)
  function editedPayload(a, box) {
    const p = Object.assign({}, a.payload);
    for (const input of box.querySelectorAll("[data-field]")) {
      const key = input.dataset.field;
      if (input.dataset.type === "tick") p[key] = input.checked;
      else if (input.value.trim() || key in p) p[key] = input.value.trim();
    }
    return p;
  }

  async function decideApproval(card, path, body) {
    card.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      const data = await api("booking-actions/" + path, { body });
      const a = data.action || {};
      approvalEditing = null;
      if (path === "approve") toast(a.status === "executed" ? "Done in Acuity" : a.status === "failed" ? "Didn't go through: " + (a.error || "see the card") : "Approved");
      else toast(path === "edit" ? "Saved: still waiting for approval" : "Rejected: nothing was changed");
    } catch (err) {
      if (err.message === "signed out") return;
      toast(err.message);
      // The reason stays on the card (nothing changed, so the card isn't redrawn: its buttons work again)
      let why = card.querySelector(".appr-error");
      if (!why) {
        why = el("p", "appr-result bad appr-error");
        why.setAttribute("role", "alert");
        card.appendChild(why);
      }
      why.textContent = (path === "approve" ? "Not approved: " : path === "edit" ? "Not saved: " : "Not rejected: ") + err.message;
      card.querySelectorAll("button").forEach((b) => (b.disabled = false));
      return;
    }
    loadApprovals();
  }

  // Approvals refresh while they're on screen (not while a proposal's fields are open); the badge every minute
  setInterval(() => !document.hidden && running && currentView === "approvals" && approvalEditing === null && loadApprovals(), 15000);
  setInterval(() => !document.hidden && running && currentView !== "approvals" && loadApprovals(), 60000);

  // ===== Campaigns: email newsletters, waiting for an admin =====
  // Emails to the studio's opted-in fans (signed up and confirmed by email) and clients (said yes to
  // studio news), sent by Nova Bot through the studio's own mail server, a few a minute. Agent (and anyone signed in, with Write one) only
  // DRAFTS them: nothing is sent until an admin presses Approve here (or on the campaign's card under
  // Agent's reply) with their own sign-in. Nova Bot keeps a fingerprint of exactly what was approved
  // and won't send anything that changed since; here, Approve also checks the campaign is still the
  // one on screen first. Waiting ones come first (with the email as people will get it, in a
  // sandboxed frame), then scheduled, sent (with how they did) and rejected ones, then the fan sign-up
  // link to share. canDecide (from Nova Bot) says whether this person can approve, reject and send
  // themselves a test. ?view=campaigns&campaign=<id> points at one. Times are shown in UK time.
  let campaignEditing = null; // the campaign whose fields are open (refreshes wait meanwhile), or null
  let campaignRejecting = null; // the campaign whose "why" box is open, or null
  let campaignPicked = null; // the ?campaign= one already pointed at
  const campaignOpen = new Set(); // sent or decided ones whose email is showing
  const campaignDetail = new Map(); // id -> { updatedAt, previewHtml, log } (fetched once per version)
  // The one-to-one emails under the campaigns (their own block below); the badge counts both kinds
  let campaignsWaitingN = 0;
  let outreachWaitingN = 0;
  let outreachEditing = null; // the email whose fields are open, or null
  let outreachRejecting = null; // the email whose "why" box is open, or null
  let outreachPicked = null; // the ?outreach= one already pointed at
  const outreachOpen = new Set(); // sent or decided ones whose email is showing
  const outreachDetail = new Map(); // id -> { updatedAt, email, log } (fetched once per version)
  const CAMPAIGN_STATUS = {
    draft: ["pill-draft", "Draft"],
    pending_approval: ["pill-draft", "Waiting for approval"],
    approved: ["pill-replied", "Approved · sending"],
    scheduled: ["pill-replied", "Scheduled"],
    sent: ["pill-done", "Sent"],
    failed: ["pill-failed", "Didn't send"],
    rejected: ["pill-stop", "Rejected"],
  };
  const AUDIENCE_NAMES = { fans: "Fans", clients: "Studio clients", everyone: "Everyone (fans and clients)" };
  const CAMPAIGN_WRITERS = { agent: "Nova Agent", "staff-chat": "Portal's staff chat" };
  const CAMPAIGN_EVENTS = { created: "Written", edited: "Changed", submitted: "Sent for approval", approved: "Approved", rejected: "Rejected", sent: "Sent", scheduled: "Scheduled", failed: "Didn't send", stats: "Results updated" };
  const campaignWaiting = (c) => c.status === "pending_approval" || c.status === "draft";
  const people = (n) => (Number(n) || 0) + (Number(n) === 1 ? " person" : " people");
  const pickedCampaign = () => Number(new URLSearchParams(location.search).get("campaign")) || null;
  // A UK wall-clock time ("2026-10-16T18:00", from a date-and-time box) as UTC ISO, whatever the clocks are doing
  function ukToIso(local) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local || "");
    if (!m) return null;
    const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    const offset = (t) => {
      const p = {};
      for (const x of new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t))) p[x.type] = x.value;
      return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t;
    };
    let t = wall - offset(wall);
    t = wall - offset(t);
    return new Date(t).toISOString();
  }
  // "Fri 16 Oct 2026, 18:00" (UK time)
  const ukWhen = (iso) => {
    const d = new Date(iso);
    if (!iso || isNaN(d)) return "";
    return d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).replace(/^(\p{L}+),/u, "$1");
  };
  const pct = (n, of) => (of > 0 ? Math.round((n / of) * 100) + "%" : "–");

  // The email as people will get it (and its history), once per version of the campaign
  async function campaignDetails(c) {
    const have = campaignDetail.get(c.id);
    if (have && have.updatedAt === c.updatedAt) return have;
    const d = await api("campaigns/" + c.id);
    const got = { updatedAt: c.updatedAt, previewHtml: String(d.previewHtml || ""), log: d.log || [] };
    campaignDetail.set(c.id, got);
    return got;
  }

  async function loadCampaigns() {
    const list = $("campaigns-list");
    loadOutreach();
    let data;
    try {
      data = await api("campaigns");
    } catch (err) {
      if (currentView === "campaigns" && err.message !== "signed out") emptyState(list, "Couldn't load campaigns: " + err.message);
      return;
    }
    const all = data.campaigns || [];
    campaignsWaitingN = all.filter((c) => c.status === "pending_approval").length;
    setBadge("campaigns-badge", campaignsWaitingN + outreachWaitingN);
    syncCounts();
    if (currentView !== "campaigns") return;
    setText("campaigns-hint", data.canDecide ? "Emails to fans and clients who opted in. Nothing is sent until you approve it." : "Emails to fans and clients who opted in. An admin approves these (signed in to Portal in a browser); nothing is sent until then.");
    const want = pickedCampaign();
    if (want && campaignPicked !== String(want)) campaignOpen.add(want);
    // The emails to show: every waiting one, and any that's been opened
    await Promise.allSettled(all.filter((c) => campaignWaiting(c) || campaignOpen.has(c.id)).map(campaignDetails));
    if (currentView !== "campaigns") return;
    const by = (key, dir) => (a, b) => dir * String(a[key] || a.updatedAt || "").localeCompare(String(b[key] || b.updatedAt || ""));
    const waiting = all.filter(campaignWaiting).sort(by("createdAt", 1));
    const later = all.filter((c) => c.status === "approved" || c.status === "scheduled").sort(by("sendAt", 1));
    const sent = all.filter((c) => c.status === "sent" || c.status === "failed").sort(by("sentAt", -1)).slice(0, 20);
    const rejected = all.filter((c) => c.status === "rejected").sort(by("decidedAt", -1)).slice(0, 10);
    const card = (c) => campaignCard(c, data);
    const nodes = waiting.length ? waiting.map(card) : [el("p", "empty", "Nothing waiting for approval.")];
    if (later.length) nodes.push(el("h3", "group-head", "Scheduled"), ...later.map(card));
    if (sent.length) nodes.push(el("h3", "group-head", "Sent"), ...sent.map(card));
    if (rejected.length) nodes.push(el("h3", "group-head", "Rejected"), ...rejected.map(card));
    reconcile(list, nodes);
    drawSignup(data);
    // Pointed at one (from a notification or Agent's card): bring it into view, once
    if (want && campaignPicked !== String(want)) {
      const node = list.querySelector('[data-key="cp-' + CSS.escape(String(want)) + '"]');
      if (node) {
        campaignPicked = String(want);
        node.classList.add("picked");
        node.scrollIntoView({ block: "center", behavior: calm() ? "auto" : "smooth" });
      }
    }
  }

  function campaignCard(c, data) {
    const canDecide = Boolean(data.canDecide);
    const audiences = data.audiences || {};
    const editable = campaignWaiting(c) || c.status === "rejected";
    const editing = campaignEditing === c.id && editable;
    const rejecting = campaignRejecting === c.id && campaignWaiting(c) && canDecide;
    const open = campaignWaiting(c) || campaignOpen.has(c.id);
    const detail = open ? campaignDetail.get(c.id) : null;
    const card = el("article", "card cp-card" + (campaignWaiting(c) ? "" : " done"));
    card.dataset.key = "cp-" + c.id;
    card.dataset.sig = sig(c, canDecide, audiences[c.audience], editing, rejecting, open, detail ? [detail.updatedAt, detail.previewHtml.length, detail.log.length] : null);
    const top = el("div", "card-top");
    const title = el("h3", "card-title", c.subject || "(No subject)");
    const pill = c.status === "scheduled" && c.sending ? ["pill-replied", "Sending"] : CAMPAIGN_STATUS[c.status] || ["pill-stop", c.status];
    title.appendChild(el("span", pill[0], pill[1]));
    top.append(title, el("span", "card-meta", when(c.createdAt)));
    card.append(top, el("p", "card-who", "Written by " + (CAMPAIGN_WRITERS[c.createdBy] || "someone in the team")));
    // Who, when, and how it went
    const facts = el("dl", "cp-facts");
    const fact = (label, value) => value && facts.append(el("dt", "", label), el("dd", "", value));
    const size = audiences[c.audience];
    fact("Goes to", (AUDIENCE_NAMES[c.audience] || c.audience) + (size !== undefined && c.status !== "sent" ? " · " + size + " opted in" : ""));
    if (c.status === "sent") fact("Sent", ukWhen(c.sentAt) + (c.recipients !== null && c.recipients !== undefined ? " · to " + people(c.recipients) : ""));
    else if (c.status !== "failed" && c.status !== "rejected") fact(c.status === "scheduled" ? "Sends" : "Send time", c.sendAt ? ukWhen(c.sendAt) + " (UK time)" : "As soon as it's approved");
    if (c.decidedByName && c.status !== "pending_approval") fact(c.status === "rejected" ? "Rejected by" : "Approved by", c.decidedByName + (c.decidedAt ? " · " + ukWhen(c.decidedAt) : ""));
    card.appendChild(facts);
    if (c.note) card.appendChild(el("p", "appr-why", "Note: " + c.note));
    if (c.status === "failed") card.appendChild(el("p", "appr-result bad", "Didn't send: " + String(c.error || "unknown reason").replace(/\.$/, "") + ". Nobody got it."));
    if (c.status === "approved") card.appendChild(el("p", "appr-result", "Approved · getting ready to send…"));
    if (c.status === "scheduled" && c.sending) card.appendChild(el("p", "appr-result", "Going out now, a few a minute · " + c.sending.sent + " of " + c.sending.total + " sent"));
    if (c.status === "sent") card.appendChild(campaignStats(c));
    // The email, as people will get it (or as written, while the preview loads)
    if (editing) card.appendChild(campaignFields(c, audiences));
    else if (open) {
      if (detail && detail.previewHtml) {
        const frame = el("iframe", "cp-preview");
        frame.setAttribute("sandbox", "");
        frame.setAttribute("loading", "lazy");
        frame.title = "The email: " + (c.subject || "");
        // Nova Bot serves the email as its own page, with rules that let its styles show
        // (Portal's own rules would block them in an inline copy)
        frame.src = "/app/api/campaigns/" + encodeURIComponent(c.id) + "/preview?v=" + encodeURIComponent(c.updatedAt || "");
        card.appendChild(frame);
      } else card.appendChild(el("div", "cp-plain", c.body || ""));
      if (detail && detail.log.length && !campaignWaiting(c)) {
        const log = el("ul", "cp-log");
        for (const e of detail.log.slice(-8)) log.appendChild(el("li", "", ukWhen(e.at) + " · " + (CAMPAIGN_EVENTS[e.event] || e.event) + (e.detail ? " · " + e.detail : "")));
        card.appendChild(log);
      }
    }
    if (rejecting) {
      const why = el("label", "cp-field cp-reject");
      const input = el("input");
      input.type = "text";
      input.maxLength = 500;
      input.dataset.field = "note";
      input.placeholder = "So Nova Agent (or whoever wrote it) can fix it";
      why.append(el("span", "", "Why (optional)"), input);
      card.appendChild(why);
    }
    const row = el("div", "actions");
    const button = (text, cls, fn) => {
      const b = el("button", "btn small" + (cls ? " " + cls : ""), text);
      b.type = "button";
      b.addEventListener("click", () => fn(b));
      row.appendChild(b);
      return b;
    };
    if (editing) {
      button("Save changes", "", () => saveCampaign(card, c));
      button("Cancel", "ghost", () => {
        campaignEditing = null;
        loadCampaigns();
      });
    } else if (rejecting) {
      button("Reject it", "", () => decideCampaign(card, c, "reject", { note: card.querySelector('[data-field="note"]').value.trim() || undefined }));
      button("Cancel", "ghost", () => {
        campaignRejecting = null;
        loadCampaigns();
      });
    } else {
      if (campaignWaiting(c) && canDecide) {
        // Approve: pressed twice (it emails real people), saying exactly what will happen
        button("Approve", "", (b) => {
          if (b.dataset.sure !== "1") {
            b.dataset.sure = "1";
            b.textContent = c.sendAt ? "Schedule it for " + ukWhen(c.sendAt) + "?" : "Send it to " + (size !== undefined ? people(size) : "them") + " now?";
            return;
          }
          approveCampaign(card, c);
        });
      }
      if (editable) {
        button("Edit", "ghost", () => {
          campaignEditing = c.id;
          campaignRejecting = null;
          loadCampaigns();
        });
      }
      if (campaignWaiting(c) && canDecide) {
        button("Reject", "ghost", () => {
          campaignRejecting = c.id;
          campaignEditing = null;
          loadCampaigns();
        });
        button("Send me a test", "ghost", () => testCampaign(card, c));
      }
      if (!campaignWaiting(c)) {
        button(open ? "Hide the email" : "Show the email", "ghost", () => {
          if (open) campaignOpen.delete(c.id);
          else campaignOpen.add(c.id);
          loadCampaigns();
        });
      }
    }
    if (row.children.length) card.appendChild(row);
    if (campaignWaiting(c) && !canDecide) card.appendChild(el("p", "card-foot", "An admin approves these, signed in to Portal in a browser. Nothing is sent until then."));
    return card;
  }

  // How a sent one did: how many it went to, unsubscribes since, and any it couldn't send to
  // (the studio's own mail server sends them: opens and clicks aren't tracked)
  function campaignStats(c) {
    const s = c.stats || {};
    const sent = Number(s.sent || c.recipients) || 0;
    const box = el("div", "cp-stats");
    const tile = (value, label) => {
      const t = el("div", "cp-stat");
      t.append(el("b", "", value), el("span", "", label));
      box.appendChild(t);
    };
    tile(String(sent), "Sent");
    tile(String(Number(s.unsubscribed) || 0), "Unsubscribed");
    if (Number(s.failed)) tile(String(s.failed), "Didn't go");
    if (Number(s.skipped)) tile(String(s.skipped), "Unsubscribed first");
    if (Number(s.opened)) tile(pct(Number(s.opened) || 0, Number(s.delivered) || sent), "Opened");
    const wrap = el("div", "");
    wrap.appendChild(box);
    wrap.appendChild(el("p", "card-foot", "Sent by the studio's own mail server" + (s.fetchedAt ? ", finished " + ukWhen(s.fetchedAt) : "") + ". Opens and clicks aren't tracked; unsubscribes are counted as they come in."));
    return wrap;
  }

  // The edit fields, filled from the campaign as it is
  function campaignFields(c, audiences) {
    const box = el("div", "appr-edit");
    const field = (label, input, wide) => {
      const l = el("label", "cp-field" + (wide ? " cp-wide" : ""));
      l.append(el("span", "", label), input);
      box.appendChild(l);
    };
    const subject = el("input");
    subject.type = "text";
    subject.maxLength = 150;
    subject.value = c.subject || "";
    subject.dataset.field = "subject";
    field("Subject", subject, true);
    const body = el("textarea");
    body.rows = 10;
    body.maxLength = 20000;
    body.value = c.body || "";
    body.dataset.field = "body";
    field("The email", body, true);
    const who = el("select");
    for (const k of Object.keys(AUDIENCE_NAMES)) {
      const o = el("option", "", AUDIENCE_NAMES[k] + (audiences[k] !== undefined ? " · " + audiences[k] + " opted in" : ""));
      o.value = k;
      o.selected = k === c.audience;
      who.appendChild(o);
    }
    who.dataset.field = "audience";
    field("Who it goes to", who);
    const at = el("input");
    at.type = "datetime-local";
    at.value = c.sendAt ? ukLocal(c.sendAt) : "";
    at.dataset.field = "sendAt";
    field("Send at (UK time; empty: as soon as it's approved)", at);
    return box;
  }

  // The reason something didn't work stays on the card (nothing changed, so it isn't redrawn: its buttons work again)
  function campaignProblem(card, text) {
    let why = card.querySelector(".appr-error");
    if (!why) {
      why = el("p", "appr-result bad appr-error");
      why.setAttribute("role", "alert");
      card.appendChild(why);
    }
    why.textContent = text;
    card.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
  const busy = (card) => card.querySelectorAll("button").forEach((b) => (b.disabled = true));

  async function saveCampaign(card, c) {
    const v = (k) => card.querySelector('[data-field="' + k + '"]').value;
    const subject = v("subject").trim();
    const body = v("body").trim();
    if (!subject || !body) return campaignProblem(card, "Not saved: it needs a subject and the email.");
    const sendAt = v("sendAt") ? ukToIso(v("sendAt")) : null;
    if (v("sendAt") && (!sendAt || Date.parse(sendAt) < Date.now())) return campaignProblem(card, "Not saved: pick a send time that hasn't passed, or leave it empty.");
    busy(card);
    try {
      await api("campaigns/" + c.id + "/edit", { body: { subject, body, audience: v("audience"), sendAt } });
    } catch (err) {
      if (err.message === "signed out") return;
      toast(err.message);
      return campaignProblem(card, "Not saved: " + err.message);
    }
    campaignEditing = null;
    campaignDetail.delete(c.id);
    toast("Saved: waiting for approval");
    loadCampaigns();
  }

  async function approveCampaign(card, c) {
    busy(card);
    // Still exactly what's on screen? (someone may have changed it since this was drawn)
    try {
      const now = (await api("campaigns/" + c.id)).campaign || {};
      if (now.updatedAt !== c.updatedAt || now.status !== c.status) {
        campaignDetail.delete(c.id);
        toast("It changed since it was shown: check it again");
        return loadCampaigns();
      }
    } catch (err) {
      if (err.message === "signed out") return;
      return campaignProblem(card, "Not approved: " + err.message);
    }
    let done;
    try {
      done = (await api("campaigns/" + c.id + "/approve", { body: {} })).campaign || {};
    } catch (err) {
      if (err.message === "signed out") return;
      toast(err.message);
      return campaignProblem(card, "Not approved: " + err.message);
    }
    if (done.status === "sent") toast("Sent to " + people(done.recipients));
    else if (done.status === "scheduled") toast("Scheduled for " + ukWhen(done.sendAt));
    else if (done.status === "failed") toast("Didn't send: " + (done.error || "see the card"));
    else toast("Approved: sending now");
    loadCampaigns();
  }

  async function decideCampaign(card, c, path, body) {
    busy(card);
    try {
      await api("campaigns/" + c.id + "/" + path, { body });
    } catch (err) {
      if (err.message === "signed out") return;
      toast(err.message);
      return campaignProblem(card, "Not rejected: " + err.message);
    }
    campaignRejecting = null;
    toast("Rejected: nothing was sent");
    loadCampaigns();
  }

  async function testCampaign(card, c) {
    busy(card);
    try {
      await api("campaigns/test-send", { body: { id: c.id } });
    } catch (err) {
      if (err.message === "signed out") return;
      toast(err.message);
      return campaignProblem(card, "Test not sent: " + err.message);
    }
    card.querySelectorAll("button").forEach((b) => (b.disabled = false));
    const old = card.querySelector(".appr-error");
    if (old) old.remove();
    toast("A test is on its way to your own email (marked [TEST])");
  }

  // The fan sign-up link (for SoundCloud and socials), with who's opted in
  function drawSignup(data) {
    const a = data.audiences || {};
    const card = el("article", "card");
    card.dataset.key = "signup";
    card.dataset.sig = sig(data.signupUrl, a);
    card.appendChild(el("h3", "card-title", "Fan sign-up link"));
    card.appendChild(el("p", "appr-why", "Share it on SoundCloud, Instagram and your other socials. People confirm by email before they're on the list, and can unsubscribe from any email."));
    if (data.signupUrl) {
      const link = el("a", "cp-link", data.signupUrl);
      link.href = data.signupUrl;
      link.target = "_blank";
      link.rel = "noopener";
      card.appendChild(link);
      const row = el("div", "actions");
      const copy = el("button", "btn small", "Copy");
      copy.type = "button";
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(data.signupUrl);
          toast("Copied the sign-up link");
        } catch (err) {
          toast("Couldn't copy: press and hold the link instead");
        }
      });
      row.appendChild(copy);
      card.appendChild(row);
    }
    const facts = el("dl", "cp-facts");
    const fact = (label, value) => facts.append(el("dt", "", label), el("dd", "", String(value)));
    fact("Confirmed fans", Number(a.fans) || 0);
    fact("Clients who said yes", Number(a.clients) || 0);
    fact("Everyone (each once)", Number(a.everyone) || 0);
    card.appendChild(facts);
    reconcile($("campaigns-signup"), [card]);
  }

  // Write one (anyone signed in): it waits for an admin's approval like Agent's drafts
  $("campaigns-new").addEventListener("click", () => {
    const form = $("campaigns-form");
    form.hidden = !form.hidden;
    $("campaigns-new").setAttribute("aria-expanded", String(!form.hidden));
    if (!form.hidden) $("cp-new-subject").focus();
  });
  $("cp-new-cancel").addEventListener("click", () => {
    $("campaigns-form").hidden = true;
    $("campaigns-new").setAttribute("aria-expanded", "false");
  });
  $("campaigns-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = $("campaigns-form");
    const local = $("cp-new-when").value;
    const sendAt = local ? ukToIso(local) : null;
    if (local && (!sendAt || Date.parse(sendAt) < Date.now())) return setText("cp-new-error", "Pick a send time that hasn't passed, or leave it empty.");
    setText("cp-new-error", "");
    const go = form.querySelector('button[type="submit"]');
    go.disabled = true;
    try {
      const body = { subject: $("cp-new-subject").value.trim(), body: $("cp-new-body").value.trim(), audience: $("cp-new-audience").value };
      if (sendAt) body.sendAt = sendAt;
      await api("campaigns", { body });
    } catch (err) {
      go.disabled = false;
      if (err.message !== "signed out") setText("cp-new-error", "Not saved: " + err.message);
      return;
    }
    go.disabled = false;
    form.reset();
    form.hidden = true;
    $("campaigns-new").setAttribute("aria-expanded", "false");
    toast("Saved: waiting for an admin's approval");
    loadCampaigns();
  });

  // Campaigns refresh while they're on screen (not while one's fields are open, or one's being written); the badge every minute
  const campaignBusy = () => campaignEditing !== null || campaignRejecting !== null || !$("campaigns-form").hidden || outreachBusy();
  setInterval(() => !document.hidden && running && currentView === "campaigns" && !campaignBusy() && loadCampaigns(), 20000);
  setInterval(() => !document.hidden && running && currentView !== "campaigns" && loadCampaigns(), 60000);

  // ===== One-to-one emails (under Campaigns) =====
  // A personal email to one person: a venue, label, brand or other business (at a work address), a
  // studio client, or someone who wrote to the studio. Agent (and anyone signed in, with Write one)
  // only DRAFTS them; Nova Bot checks the person may be emailed at all (UK law: never anyone who said
  // no, a client only about their booking unless they said yes to studio news) and adds the footer
  // with a "don't email me again" link. Nothing is sent until an admin presses Approve here, with
  // their own sign-in; Nova Bot sends exactly what was approved, once. Waiting ones first (the
  // email as it goes, footer and all), then sent and rejected ones. Someone who replies "no thanks"
  // can be recorded below the list. ?view=campaigns&outreach=<id> points at one.
  const OUTREACH_STATUS = {
    draft: ["pill-draft", "Draft"],
    pending_approval: ["pill-draft", "Waiting for approval"],
    approved: ["pill-replied", "Approved · sending"],
    sent: ["pill-done", "Sent"],
    failed: ["pill-failed", "Didn't send"],
    rejected: ["pill-stop", "Rejected"],
  };
  const OUTREACH_KINDS = { business: "A business", client: "A studio client", reply: "Someone who wrote in" };
  const OUTREACH_EVENTS = { created: "Written", edited: "Changed", submitted: "Sent for approval", approved: "Approved", rejected: "Rejected", sent: "Sent", failed: "Didn't send" };
  const outreachWaiting = (o) => o.status === "pending_approval" || o.status === "draft";
  const pickedOutreach = () => Number(new URLSearchParams(location.search).get("outreach")) || null;
  const outreachBusy = () => outreachEditing !== null || outreachRejecting !== null || !$("outreach-form").hidden;
  const outreachTo = (o) => [o.toName, o.organisation].filter(Boolean).join(", ");

  // The email as it goes (with its footer) and its history, once per version
  async function outreachDetails(o) {
    const have = outreachDetail.get(o.id);
    if (have && have.updatedAt === o.updatedAt) return have;
    const d = await api("outreach/" + o.id);
    const got = { updatedAt: o.updatedAt, email: String(d.email || ""), log: d.log || [] };
    outreachDetail.set(o.id, got);
    return got;
  }

  async function loadOutreach() {
    const list = $("outreach-list");
    let data;
    try {
      data = await api("outreach");
    } catch (err) {
      if (currentView === "campaigns" && err.message !== "signed out") emptyState(list, "Couldn't load the one-to-one emails: " + err.message);
      return;
    }
    const all = data.outreach || [];
    outreachWaitingN = all.filter((o) => o.status === "pending_approval").length;
    setBadge("campaigns-badge", campaignsWaitingN + outreachWaitingN);
    syncCounts();
    if (currentView !== "campaigns") return;
    setText("outreach-hint", data.canDecide ? "A personal email to one person. Nothing is sent until you approve it." : "A personal email to one person. An admin approves these (signed in to Portal in a browser); nothing is sent until then.");
    const want = pickedOutreach();
    if (want && outreachPicked !== String(want)) outreachOpen.add(want);
    await Promise.allSettled(all.filter((o) => outreachWaiting(o) || outreachOpen.has(o.id)).map(outreachDetails));
    if (currentView !== "campaigns") return;
    const by = (key) => (a, b) => String(b[key] || b.updatedAt || "").localeCompare(String(a[key] || a.updatedAt || ""));
    const waiting = all.filter(outreachWaiting).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const sent = all.filter((o) => o.status === "sent" || o.status === "failed" || o.status === "approved").sort(by("sentAt")).slice(0, 20);
    const rejected = all.filter((o) => o.status === "rejected").sort(by("decidedAt")).slice(0, 10);
    const card = (o) => outreachCard(o, data);
    const nodes = waiting.length ? waiting.map(card) : [el("p", "empty", "No one-to-one emails waiting.")];
    if (sent.length) nodes.push(el("h3", "group-head", "Sent one-to-one"), ...sent.map(card));
    if (rejected.length) nodes.push(el("h3", "group-head", "Not sent"), ...rejected.map(card));
    reconcile(list, nodes);
    if (want && outreachPicked !== String(want)) {
      const node = list.querySelector('[data-key="or-' + CSS.escape(String(want)) + '"]');
      if (node) {
        outreachPicked = String(want);
        node.classList.add("picked");
        node.scrollIntoView({ block: "center", behavior: calm() ? "auto" : "smooth" });
      }
    }
  }

  function outreachCard(o, data) {
    const canDecide = Boolean(data.canDecide);
    const editable = outreachWaiting(o) || o.status === "rejected";
    const editing = outreachEditing === o.id && editable;
    const rejecting = outreachRejecting === o.id && outreachWaiting(o) && canDecide;
    const open = outreachWaiting(o) || outreachOpen.has(o.id);
    const detail = open ? outreachDetail.get(o.id) : null;
    const card = el("article", "card cp-card" + (outreachWaiting(o) ? "" : " done"));
    card.dataset.key = "or-" + o.id;
    card.dataset.sig = sig(o, canDecide, editing, rejecting, open, detail ? [detail.updatedAt, detail.email.length, detail.log.length] : null);
    const top = el("div", "card-top");
    const title = el("h3", "card-title", o.subject || "(No subject)");
    const pill = OUTREACH_STATUS[o.status] || ["pill-stop", o.status];
    title.appendChild(el("span", pill[0], pill[1]));
    top.append(title, el("span", "card-meta", when(o.createdAt)));
    card.append(top, el("p", "card-who", "Written by " + (o.createdByName || "someone in the team")));
    const facts = el("dl", "cp-facts");
    const fact = (label, value) => value && facts.append(el("dt", "", label), el("dd", "", value));
    fact("To", (outreachTo(o) ? outreachTo(o) + " · " : "") + o.toEmail);
    fact("Who they are", (OUTREACH_KINDS[o.kind] || o.kind) + (o.kind === "client" ? (o.aboutBooking ? " · about their booking" : " · said yes to studio news") : ""));
    if (o.status === "sent") fact("Sent", ukWhen(o.sentAt));
    if (o.decidedByName && o.status !== "pending_approval") fact(o.status === "rejected" ? "Rejected by" : "Approved by", o.decidedByName + (o.decidedAt ? " · " + ukWhen(o.decidedAt) : ""));
    card.appendChild(facts);
    if (o.note) card.appendChild(el("p", "appr-why", "Note: " + o.note));
    if (o.status === "failed") card.appendChild(el("p", "appr-result bad", "Didn't send: " + String(o.error || "unknown reason").replace(/\.$/, "") + "."));
    if (o.status === "approved") card.appendChild(el("p", "appr-result", "Approved · sending…"));
    if (editing) card.appendChild(outreachFields(o));
    else if (open) {
      card.appendChild(el("div", "cp-plain", detail && detail.email ? detail.email : o.body || ""));
      if (detail && detail.log.length && !outreachWaiting(o)) {
        const log = el("ul", "cp-log");
        for (const e of detail.log.slice(-8)) log.appendChild(el("li", "", ukWhen(e.at) + " · " + (OUTREACH_EVENTS[e.event] || e.event) + (e.detail ? " · " + e.detail : "")));
        card.appendChild(log);
      }
    }
    if (rejecting) {
      const why = el("label", "cp-field cp-reject");
      const input = el("input");
      input.type = "text";
      input.maxLength = 500;
      input.dataset.field = "note";
      input.placeholder = "So Nova Agent (or whoever wrote it) can fix it";
      why.append(el("span", "", "Why (optional)"), input);
      card.appendChild(why);
    }
    const row = el("div", "actions");
    const button = (text, cls, fn) => {
      const b = el("button", "btn small" + (cls ? " " + cls : ""), text);
      b.type = "button";
      b.addEventListener("click", () => fn(b));
      row.appendChild(b);
      return b;
    };
    if (editing) {
      button("Save changes", "", () => saveOutreach(card, o));
      button("Cancel", "ghost", () => {
        outreachEditing = null;
        loadOutreach();
      });
    } else if (rejecting) {
      button("Reject it", "", () => rejectOutreach(card, o, card.querySelector('[data-field="note"]').value.trim() || undefined));
      button("Cancel", "ghost", () => {
        outreachRejecting = null;
        loadOutreach();
      });
    } else {
      if (outreachWaiting(o) && canDecide) {
        // Approve: pressed twice (it emails a real person), saying exactly who
        button("Approve", "", (b) => {
          if (b.dataset.sure !== "1") {
            b.dataset.sure = "1";
            b.textContent = "Send it to " + o.toEmail + " now?";
            return;
          }
          approveOutreach(card, o);
        });
      }
      if (editable) {
        button("Edit", "ghost", () => {
          outreachEditing = o.id;
          outreachRejecting = null;
          loadOutreach();
        });
      }
      if (outreachWaiting(o) && canDecide) {
        button("Reject", "ghost", () => {
          outreachRejecting = o.id;
          outreachEditing = null;
          loadOutreach();
        });
        button("Send me a test", "ghost", () => testOutreach(card, o));
      }
      if (!outreachWaiting(o)) {
        button(open ? "Hide the email" : "Show the email", "ghost", () => {
          if (open) outreachOpen.delete(o.id);
          else outreachOpen.add(o.id);
          loadOutreach();
        });
      }
    }
    if (row.children.length) card.appendChild(row);
    if (outreachWaiting(o) && !canDecide) card.appendChild(el("p", "card-foot", "An admin approves these, signed in to Portal in a browser. Nothing is sent until then."));
    return card;
  }

  // The edit fields, filled from the email as it is
  function outreachFields(o) {
    const box = el("div", "appr-edit");
    const field = (label, input, wide) => {
      const l = el("label", "cp-field" + (wide ? " cp-wide" : ""));
      l.append(el("span", "", label), input);
      box.appendChild(l);
      return l;
    };
    const input = (key, value, max, type = "text") => {
      const i = el("input");
      i.type = type;
      i.maxLength = max;
      i.value = value || "";
      i.dataset.field = key;
      return i;
    };
    const kind = el("select");
    for (const k of Object.keys(OUTREACH_KINDS)) {
      const opt = el("option", "", OUTREACH_KINDS[k]);
      opt.value = k;
      opt.selected = k === o.kind;
      kind.appendChild(opt);
    }
    kind.dataset.field = "kind";
    field("Who it's to", kind);
    field("Their email", input("toEmail", o.toEmail, 200, "email"));
    field("Their name", input("toName", o.toName, 100));
    field("Business or organisation", input("organisation", o.organisation, 120));
    const tick = el("label", "cp-tick");
    const box2 = el("input");
    box2.type = "checkbox";
    box2.checked = Boolean(o.aboutBooking);
    box2.dataset.field = "aboutBooking";
    tick.append(box2, el("span", "", "A client email about their own booking"));
    box.appendChild(tick);
    field("Subject", input("subject", o.subject, 150), true);
    const body = el("textarea");
    body.rows = 10;
    body.maxLength = 10000;
    body.value = o.body || "";
    body.dataset.field = "body";
    field("The email", body, true);
    return box;
  }

  async function saveOutreach(card, o) {
    const f = (k) => card.querySelector('[data-field="' + k + '"]');
    const body = { kind: f("kind").value, toEmail: f("toEmail").value.trim(), toName: f("toName").value.trim(), organisation: f("organisation").value.trim(), aboutBooking: f("aboutBooking").checked, subject: f("subject").value.trim(), body: f("body").value.trim() };
    if (!body.toEmail || !body.subject || !body.body) return campaignProblem(card, "Not saved: it needs their email, a subject and the email.");
    busy(card);
    try {
      await api("outreach/" + o.id + "/edit", { body });
    } catch (err) {
      if (err.message === "signed out") return;
      toast(err.message);
      return campaignProblem(card, "Not saved: " + err.message);
    }
    outreachEditing = null;
    outreachDetail.delete(o.id);
    toast("Saved: waiting for approval");
    loadOutreach();
  }

  async function approveOutreach(card, o) {
    busy(card);
    // Still exactly what's on screen?
    try {
      const now = (await api("outreach/" + o.id)).outreach || {};
      if (now.updatedAt !== o.updatedAt || now.status !== o.status) {
        outreachDetail.delete(o.id);
        toast("It changed since it was shown: check it again");
        return loadOutreach();
      }
    } catch (err) {
      if (err.message === "signed out") return;
      return campaignProblem(card, "Not approved: " + err.message);
    }
    let done;
    try {
      done = (await api("outreach/" + o.id + "/approve", { body: {} })).outreach || {};
    } catch (err) {
      if (err.message === "signed out") return;
      toast(err.message);
      return campaignProblem(card, "Not approved: " + err.message);
    }
    if (done.status === "sent") toast("Sent to " + done.toEmail);
    else if (done.status === "failed") toast("Didn't send: " + (done.error || "see the card"));
    else toast("Approved: sending now");
    loadOutreach();
  }

  async function rejectOutreach(card, o, note) {
    busy(card);
    try {
      await api("outreach/" + o.id + "/reject", { body: { note } });
    } catch (err) {
      if (err.message === "signed out") return;
      toast(err.message);
      return campaignProblem(card, "Not rejected: " + err.message);
    }
    outreachRejecting = null;
    toast("Rejected: nothing was sent");
    loadOutreach();
  }

  async function testOutreach(card, o) {
    busy(card);
    try {
      await api("outreach/test-send", { body: { id: o.id } });
    } catch (err) {
      if (err.message === "signed out") return;
      toast(err.message);
      return campaignProblem(card, "Test not sent: " + err.message);
    }
    card.querySelectorAll("button").forEach((b) => (b.disabled = false));
    const old = card.querySelector(".appr-error");
    if (old) old.remove();
    toast("A test is on its way to your own email (marked [TEST])");
  }

  // Write one: the business field for a business, the booking tick for a client
  function outreachFormKind() {
    const kind = $("or-new-kind").value;
    $("or-new-org-wrap").hidden = kind !== "business";
    $("or-new-booking-wrap").hidden = kind !== "client";
  }
  $("or-new-kind").addEventListener("change", outreachFormKind);
  $("outreach-new").addEventListener("click", () => {
    const form = $("outreach-form");
    form.hidden = !form.hidden;
    $("outreach-new").setAttribute("aria-expanded", String(!form.hidden));
    outreachFormKind();
    if (!form.hidden) $("or-new-email").focus();
  });
  $("or-new-cancel").addEventListener("click", () => {
    $("outreach-form").hidden = true;
    $("outreach-new").setAttribute("aria-expanded", "false");
  });
  $("outreach-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = $("outreach-form");
    const kind = $("or-new-kind").value;
    const body = { kind, toEmail: $("or-new-email").value.trim(), toName: $("or-new-name").value.trim(), subject: $("or-new-subject").value.trim(), body: $("or-new-body").value.trim() };
    if (kind === "business") body.organisation = $("or-new-org").value.trim();
    if (kind === "client") body.aboutBooking = $("or-new-booking").checked;
    if (kind === "business" && !body.organisation) return setText("or-new-error", "Say which business or organisation it's to.");
    setText("or-new-error", "");
    const go = form.querySelector('button[type="submit"]');
    go.disabled = true;
    try {
      await api("outreach", { body });
    } catch (err) {
      go.disabled = false;
      if (err.message !== "signed out") setText("or-new-error", "Not saved: " + err.message);
      return;
    }
    go.disabled = false;
    form.reset();
    form.hidden = true;
    $("outreach-new").setAttribute("aria-expanded", "false");
    toast("Saved: waiting for an admin's approval");
    loadOutreach();
  });
  // Someone replied "no thanks": never emailed this way again (and anything waiting to them won't go)
  $("outreach-optout").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("or-optout-email").value.trim();
    if (!email) return;
    try {
      const r = await api("outreach/optouts", { body: { email } });
      toast("Recorded: " + r.email + " won't get one-to-one emails again" + (r.stopped ? " (" + r.stopped + " waiting stopped)" : ""));
    } catch (err) {
      if (err.message !== "signed out") toast("Not recorded: " + err.message);
      return;
    }
    $("outreach-optout").reset();
    loadOutreach();
  });

  // ===== Clients: the studio's client list =====
  // Everyone who's booked through Acuity, sent an enquiry, been imported from Acuity's spreadsheets
  // or added by hand. Nova Bot keeps the list (one card per person: same email, else same phone,
  // else same name). Search and filters up top; tapping a card opens that client's page
  // (?view=clients&client=<id>, so Back returns to the list): contact and notes, money in pounds,
  // marketing consent and its history, and their sessions. Marketing consent is NO for everyone
  // until someone records a yes with where it came from and when; every change is kept, with who.
  // Admins also get "Sync with Acuity now" (Acuity's calendar feed) and "Import from Acuity"
  // (Acuity's appointments or clients spreadsheet). Money is pounds as text ("120.00"); times UK.
  let clientFilter = "all"; // all | owing | lapsed | enquiry
  let clientSearch = "";
  let clientSearchTimer = 0;
  let clientsAsked = 0; // the newest list asked for (an older answer arriving late is dropped)
  let clientOpen = null; // the open client's latest data ({ client, sessions, consentLog }), or null
  let consentAsking = false; // the consent switch is waiting for where the yes came from, and when
  let importText = ""; // the chosen file's text
  const CLIENT_SOURCES = { booking: "Booked through Acuity", enquiry: "Sent an enquiry", import: "Imported from Acuity", staff: "Added by hand" };
  const SESSION_SOURCES = { feed: "from Acuity's calendar", webhook: "from Acuity", import: "imported" };
  const isAdminHere = () => Boolean(window.PortalPage && window.PortalPage.isAdmin && window.PortalPage.isAdmin());
  const openClientId = () => {
    const id = Number(new URLSearchParams(location.search).get("client"));
    return Number.isInteger(id) && id > 0 ? id : null;
  };
  const goClient = (id) => window.PortalPage && window.PortalPage.go("/portal/?view=clients" + (id ? "&client=" + id : ""));
  const gbp = (v) => "£" + (Number(v) || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const owes = (c) => Number(c.outstanding) > 0;
  // "Sat 1 Aug 2026" (and ", 14:00" with the time), UK time
  function ukDay(iso, withTime) {
    const d = new Date(iso);
    if (!iso || isNaN(d)) return "";
    const o = { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" };
    if (withTime) Object.assign(o, { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleString("en-GB", o).replace(/^(\p{L}+),/u, "$1");
  }
  // Today in the UK, YYYY-MM-DD
  const ukToday = () => ukLocal(new Date().toISOString()).slice(0, 10);
  // The month n months ago, YYYY-MM (the "Not booked since" picker starts three months back)
  function monthsAgo(n) {
    const [y, m] = ukToday().split("-").map(Number);
    const total = y * 12 + (m - 1) - n;
    return Math.floor(total / 12) + "-" + String((total % 12) + 1).padStart(2, "0");
  }
  // Pounds as typed ("£1,200", "45.5", "") → "1200.00", or null when it isn't an amount
  function readPounds(text) {
    const t = String(text).replace(/[£,\s]/g, "");
    if (t === "") return "0.00";
    return /^\d{1,7}(\.\d{1,2})?$/.test(t) ? Number(t).toFixed(2) : null;
  }

  async function loadClients() {
    const admin = isAdminHere();
    for (const b of document.querySelectorAll("#view-clients .admin-only")) if (b.hidden === admin) b.hidden = !admin;
    if (!admin) $("clients-import").hidden = true;
    const id = openClientId();
    if (id) return openClient(id);
    closeClient();
    const list = $("clients-list");
    if (!$("clients-since").value) $("clients-since").value = monthsAgo(3);
    const q = new URLSearchParams({ filter: clientFilter });
    if (clientSearch) q.set("search", clientSearch);
    if (clientFilter === "lapsed") q.set("since", $("clients-since").value + "-01");
    const asked = ++clientsAsked;
    let data;
    try {
      data = await api("clients?" + q);
    } catch (err) {
      if (asked === clientsAsked && currentView === "clients" && err.message !== "signed out") {
        setText("clients-count", "");
        emptyState(list, "Couldn't load clients: " + err.message);
      }
      return;
    }
    if (asked !== clientsAsked || openClientId()) return;
    const clients = data.clients || [];
    setText("clients-count", clientsCount(clients, Number(data.total) || clients.length));
    if (!clients.length) return emptyState(list, clientsEmpty());
    reconcile(list, clients.map(clientCard));
  }
  function clientsCount(clients, total) {
    const more = clients.length < total ? " (the first " + clients.length + " shown: search to narrow it down)" : "";
    if (clientFilter === "owing") {
      const sum = clients.reduce((n, c) => n + Math.round((Number(c.outstanding) || 0) * 100), 0) / 100;
      return total + (total === 1 ? " client owes " : " clients owe ") + gbp(sum) + (more ? " between them" + more : " in all");
    }
    if (clientFilter === "lapsed") return total + (total === 1 ? " client hasn't" : " clients haven't") + " booked since " + ukDay($("clients-since").value + "-01T12:00:00Z") + more;
    return total + (total === 1 ? " client" : " clients") + more;
  }
  function clientsEmpty() {
    if (clientSearch) return "No clients match “" + clientSearch + "”.";
    if (clientFilter === "owing") return "Nobody owes anything.";
    if (clientFilter === "lapsed") return "Everyone who booked before then has booked again since.";
    if (clientFilter === "enquiry") return "No clients from enquiries only.";
    return isAdminHere() ? "No clients yet. Sync with Acuity now, or import Acuity's spreadsheet." : "No clients yet. They appear here as people book and send enquiries.";
  }

  // Their marketing consent as a badge
  const consentPill = (c) => (c.consent && c.consent.yes ? el("span", "pill-replied", "Marketing: yes") : el("span", "pill-stop", "No marketing"));

  function clientCard(c) {
    const card = el("article", "card cl-card");
    card.dataset.key = "c" + c.id;
    card.dataset.sig = sig(c);
    card.tabIndex = 0;
    card.setAttribute("role", "link");
    card.setAttribute("aria-label", c.name + ": open");
    const top = el("div", "card-top");
    const title = el("h3", "card-title", c.name);
    title.appendChild(consentPill(c));
    if (owes(c)) title.appendChild(el("span", "pill-failed", "Owes " + gbp(c.outstanding)));
    if (c.source === "enquiry" && !c.sessionCount) title.appendChild(el("span", "pill-draft", "Enquiry"));
    top.appendChild(title);
    card.appendChild(top);
    const contact = [c.email, c.phone].filter(Boolean).join(" · ");
    if (contact) card.appendChild(el("p", "card-who", contact));
    const booked = [c.lastBooked ? "Last booked " + ukDay(c.lastBooked) : "Not booked yet", c.nextBooked ? "Next " + ukDay(c.nextBooked, true) : "", c.sessionCount ? c.sessionCount + (c.sessionCount === 1 ? " session" : " sessions") : ""];
    card.appendChild(el("p", "card-foot", booked.filter(Boolean).join(" · ")));
    card.addEventListener("click", (e) => !e.target.closest("a, button") && goClient(c.id));
    card.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && e.target === card && (e.preventDefault(), goClient(c.id)));
    return card;
  }

  // ----- One client's page -----
  async function openClient(id) {
    $("clients-browse").hidden = true;
    $("clients-back").hidden = false;
    setText("clients-title", "Client");
    const page = $("client-page");
    page.hidden = false;
    if (!clientOpen || clientOpen.client.id !== id) {
      clientOpen = null;
      consentAsking = false;
      page.setAttribute("aria-busy", "true");
      page.classList.remove("filled");
      page.replaceChildren(el("div", "skeleton"), el("div", "skeleton short"));
    }
    let data;
    try {
      data = await api("clients/" + id);
    } catch (err) {
      if (openClientId() === id && err.message !== "signed out") emptyState(page, "Couldn't open this client: " + err.message);
      return;
    }
    if (openClientId() !== id || currentView !== "clients") return;
    clientOpen = { client: data.client, sessions: data.sessions || [], consentLog: data.consentLog || [] };
    drawClient();
  }
  function closeClient() {
    clientOpen = null;
    consentAsking = false;
    $("client-page").hidden = true;
    $("clients-browse").hidden = false;
    $("clients-back").hidden = true;
    setText("clients-title", "Clients");
  }
  function drawClient() {
    if (!clientOpen) return;
    const { client, sessions, consentLog } = clientOpen;
    reconcile($("client-page"), [clientHead(client), consentCard(client, consentLog), clientForm(client), sessionsCard(sessions)]);
  }

  function clientHead(c) {
    const card = el("article", "card");
    card.dataset.key = "head";
    card.dataset.sig = sig(c);
    const title = el("h3", "card-title cl-name", c.name);
    title.appendChild(consentPill(c));
    if (owes(c)) title.appendChild(el("span", "pill-failed", "Owes " + gbp(c.outstanding)));
    card.appendChild(title);
    const contact = [c.email, c.phone].filter(Boolean).join(" · ");
    card.appendChild(el("p", "card-who", contact || "No email or phone yet"));
    const facts = el("dl", "cl-facts");
    const fact = (label, value) => value && facts.append(el("dt", "", label), el("dd", "", value));
    fact("Last booked", c.lastBooked ? ukDay(c.lastBooked, true) : "Not yet");
    fact("Next booked", c.nextBooked ? ukDay(c.nextBooked, true) : "Nothing booked");
    fact("Sessions", String(c.sessionCount || 0));
    fact("Owes", gbp(c.outstanding));
    fact("Deposits paid", gbp(c.depositsPaid));
    fact("Invoiced", gbp(c.invoiced));
    card.appendChild(facts);
    card.appendChild(el("p", "card-foot", [CLIENT_SOURCES[c.source] || "", c.createdAt ? "On the list since " + ukDay(c.createdAt) : ""].filter(Boolean).join(" · ")));
    const row = el("div", "actions");
    if (c.email) {
      const a = el("a", "btn small ghost", "Email");
      a.href = "mailto:" + c.email;
      row.appendChild(a);
    }
    if (c.phone) {
      const a = el("a", "btn small ghost", "Call");
      a.href = "tel:" + String(c.phone).replace(/[^\d+]/g, "");
      row.appendChild(a);
    }
    // Their invoices, in the Invoicer (19 Oct 2026): a new one with their name and email filled in, or theirs listed
    if (window.NovaInvoicer) {
      const write = el("button", "btn small", "New invoice");
      write.type = "button";
      write.addEventListener("click", () => window.NovaInvoicer.open({ new: true, name: c.name, email: c.email || "" }));
      const theirs = el("button", "btn small ghost", "Invoices");
      theirs.type = "button";
      theirs.addEventListener("click", () => window.NovaInvoicer.open({ q: c.name }));
      row.append(write, theirs);
    }
    card.appendChild(row);
    return card;
  }

  // Marketing consent: a switch. Turning it on asks where the yes came from and when (today unless
  // changed); turning it off is straight away. Every change is kept below, with who and when.
  function consentCard(c, log) {
    const yes = Boolean(c.consent && c.consent.yes);
    const card = el("article", "card cl-consent");
    card.dataset.key = "consent";
    card.dataset.sig = sig(c.consent, log, consentAsking);
    card.appendChild(el("h3", "card-title", "Marketing"));
    const label = el("label", "switch");
    const box = el("input");
    box.type = "checkbox";
    box.setAttribute("role", "switch");
    box.checked = yes || consentAsking;
    const track = el("span", "switch-track");
    track.setAttribute("aria-hidden", "true");
    track.appendChild(el("span", "switch-knob"));
    label.append(box, track, el("span", "", "They've said yes to marketing"));
    card.appendChild(label);
    card.appendChild(el("p", "hint cl-small", yes ? "Yes since " + ukDay(c.consent.at) + (c.consent.source ? " · " + c.consent.source : "") : "No. Everyone starts at no: it's only yes once you record where their yes came from, and when. A reply to an enquiry doesn't count."));
    const problem = el("p", "error cl-error");
    problem.setAttribute("role", "alert");
    box.addEventListener("change", () => {
      if (box.checked && !yes) {
        consentAsking = true;
        drawClient();
        const first = $("client-page").querySelector("#consent-source");
        if (first) first.focus();
        return;
      }
      if (!box.checked && consentAsking) {
        consentAsking = false;
        return drawClient();
      }
      if (!box.checked && yes) saveConsent(c.id, { yes: false, source: "Switched off in Portal" }, card, problem);
    });
    if (consentAsking) {
      const form = el("div", "cl-grid cl-ask");
      const src = el("label", "cl-field cl-wide");
      const input = el("input");
      input.type = "text";
      input.id = "consent-source";
      input.maxLength = 300;
      input.setAttribute("list", "consent-sources");
      input.placeholder = "e.g. Ticked on the booking form";
      input.addEventListener("input", () => (problem.textContent = ""));
      const me = window.PortalPage && window.PortalPage.me && window.PortalPage.me();
      const list = el("datalist");
      list.id = "consent-sources";
      for (const text of ["Ticked on the booking form", "Said yes in person, recorded by " + ((me && me.display_name) || "me"), "Fan sign-up"]) {
        const o = el("option");
        o.value = text;
        list.appendChild(o);
      }
      src.append(el("span", "", "Where their yes came from"), input, list);
      const at = el("label", "cl-field");
      const day = el("input");
      day.type = "date";
      day.max = ukToday();
      day.value = ukToday();
      at.append(el("span", "", "When they said yes"), day);
      form.append(src, at);
      card.appendChild(form);
      const row = el("div", "actions");
      const ok = el("button", "btn small", "Save their yes");
      ok.type = "button";
      ok.addEventListener("click", () => {
        const source = input.value.trim();
        if (!source) return (problem.textContent = "Say where their yes came from first."), input.focus();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day.value) || day.value > ukToday()) return (problem.textContent = "Pick the day they said yes (today or before)."), day.focus();
        saveConsent(c.id, { yes: true, source, at: day.value }, card, problem);
      });
      const no = el("button", "btn small ghost", "Cancel");
      no.type = "button";
      no.addEventListener("click", () => {
        consentAsking = false;
        drawClient();
      });
      row.append(ok, no);
      card.appendChild(row);
    }
    card.appendChild(problem);
    if (log.length) {
      card.appendChild(el("p", "cl-sub", "History"));
      const ul = el("ul", "cl-log");
      for (const e of [...log].sort((a, b) => String(b.recorded_at || b.at).localeCompare(String(a.recorded_at || a.at)))) {
        const who = e.byName || e.by_name || (e.by === "customer" ? "the customer" : e.by === "import" ? "an import" : e.by || "");
        ul.appendChild(el("li", "", [Number(e.consent) ? "Yes" : "No", e.at ? ukDay(e.at) : "", e.source || "", who ? "recorded by " + who : "", e.recorded_at && ukDay(e.recorded_at) !== ukDay(e.at) ? "on " + ukDay(e.recorded_at) : ""].filter(Boolean).join(" · ")));
      }
      card.appendChild(ul);
    }
    return card;
  }
  async function saveConsent(id, consent, card, problem) {
    card.querySelectorAll("button, input").forEach((b) => (b.disabled = true));
    try {
      await api("clients/" + id, { body: { consent } });
    } catch (err) {
      if (err.message === "signed out") return;
      card.querySelectorAll("button, input").forEach((b) => (b.disabled = false));
      problem.textContent = "Not saved: " + err.message;
      const box = card.querySelector("input[role=switch]");
      if (box && !consent.yes) box.checked = true;
      return;
    }
    consentAsking = false;
    toast(consent.yes ? "Marketing: yes, recorded" : "Marketing: off, recorded");
    openClient(id);
  }

  // Contact, notes and money (pounds). Only what changed is sent.
  function clientForm(c) {
    const form = el("form", "card cl-form");
    form.dataset.key = "form";
    form.dataset.sig = sig(c.id, c.name, c.email, c.phone, c.notes, c.outstanding, c.depositsPaid, c.invoiced);
    form.autocomplete = "off";
    form.appendChild(el("h3", "card-title", "Details"));
    const grid = el("div", "cl-grid");
    const field = (key, label, type, value, extra) => {
      const row = el("label", "cl-field" + (type === "long" ? " cl-wide" : ""));
      const input = el(type === "long" ? "textarea" : "input");
      if (type === "long") input.rows = 3;
      else input.type = type;
      input.value = value || "";
      input.dataset.field = key;
      Object.assign(input, extra || {});
      row.append(el("span", "", label), input);
      grid.appendChild(row);
    };
    field("name", "Name", "text", c.name, { maxLength: 200, required: true });
    field("email", "Email", "email", c.email, { maxLength: 200 });
    field("phone", "Phone", "tel", c.phone, { maxLength: 40 });
    field("notes", "Notes", "long", c.notes, { maxLength: 4000 });
    for (const [key, label] of [["depositsPaid", "Deposits paid (£)"], ["invoiced", "Invoiced (£)"], ["outstanding", "Owes (£)"]]) field(key, label, "text", Number(c[key]) ? Number(c[key]).toFixed(2) : "", { inputMode: "decimal", placeholder: "0.00" });
    form.appendChild(grid);
    form.appendChild(el("p", "hint cl-small", "Money is typed in by hand for now, in pounds."));
    const problem = el("p", "error cl-error");
    problem.setAttribute("role", "alert");
    const row = el("div", "actions");
    const save = el("button", "btn small", "Save");
    save.type = "submit";
    row.appendChild(save);
    form.append(row, problem);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      problem.textContent = "";
      const body = {};
      for (const input of form.querySelectorAll("[data-field]")) {
        const key = input.dataset.field;
        const money = key === "depositsPaid" || key === "invoiced" || key === "outstanding";
        const value = money ? readPounds(input.value) : input.value.trim();
        if (value === null) return (problem.textContent = "That isn't an amount in pounds (like 120 or 45.50)."), input.focus();
        if (key === "name" && !value) return (problem.textContent = "They need a name."), input.focus();
        const was = money ? Number(c[key] || 0).toFixed(2) : String(c[key] || "");
        if (value !== was) body[key] = value;
      }
      if (!Object.keys(body).length) return toast("Nothing changed");
      save.disabled = true;
      try {
        await api("clients/" + c.id, { body });
      } catch (err) {
        save.disabled = false;
        if (err.message !== "signed out") problem.textContent = "Not saved: " + err.message;
        return;
      }
      toast("Saved");
      openClient(c.id);
    });
    return form;
  }

  function sessionsCard(sessions) {
    const card = el("article", "card");
    card.dataset.key = "sessions";
    card.dataset.sig = sig(sessions);
    const list = [...sessions].sort((a, b) => String(b.start).localeCompare(String(a.start)));
    card.appendChild(el("h3", "card-title", list.length ? "Sessions (" + list.length + ")" : "Sessions"));
    if (!list.length) {
      card.appendChild(el("p", "hint cl-small", "No sessions on record yet."));
      return card;
    }
    const now = new Date().toISOString();
    const ul = el("ul", "cl-sessions");
    for (const s of list) {
      const li = el("li", "cl-session" + (s.status === "cancelled" ? " off" : ""));
      li.appendChild(el("span", "cl-when", ukDay(s.start, true)));
      li.appendChild(el("span", "cl-what", s.session || "Session"));
      const extra = [s.price ? (isNaN(Number(s.price)) ? s.price : gbp(s.price)) : "", SESSION_SOURCES[s.source] || ""].filter(Boolean).join(" · ");
      if (extra) li.appendChild(el("span", "card-meta", extra));
      if (s.status === "cancelled") li.appendChild(el("span", "pill-stop", "Cancelled"));
      else if (s.start > now) li.appendChild(el("span", "pill-draft", "Coming up"));
      ul.appendChild(li);
    }
    card.appendChild(ul);
    return card;
  }

  // ----- Search, filters and the buttons -----
  $("clients-search").addEventListener("input", () => {
    clearTimeout(clientSearchTimer);
    clientSearchTimer = setTimeout(() => {
      const next = $("clients-search").value.trim();
      if (next === clientSearch) return;
      clientSearch = next;
      loadClients();
    }, 250);
  });
  for (const chip of document.querySelectorAll("#clients-chips .chip")) {
    chip.addEventListener("click", () => {
      clientFilter = chip.dataset.filter;
      for (const c of document.querySelectorAll("#clients-chips .chip")) {
        const on = c === chip;
        if (c.classList.contains("active") !== on) c.classList.toggle("active", on);
        c.setAttribute("aria-pressed", on ? "true" : "false");
      }
      $("clients-since-row").hidden = clientFilter !== "lapsed";
      loadClients();
    });
  }
  $("clients-since").addEventListener("change", () => clientFilter === "lapsed" && $("clients-since").value && loadClients());
  $("clients-back").addEventListener("click", () => goClient(null));

  // Add a client by hand. Nova Bot refuses a duplicate and says which one it is: that one opens.
  const showAddForm = (on) => {
    $("clients-add-form").hidden = !on;
    $("clients-add").setAttribute("aria-expanded", on ? "true" : "false");
    if (on) {
      $("clients-import").hidden = true;
      $("clients-import-open").setAttribute("aria-expanded", "false");
      $("clients-contacts").hidden = true;
      $("clients-contacts-open").setAttribute("aria-expanded", "false");
      $("add-name").focus();
    }
  };
  $("clients-add").addEventListener("click", () => showAddForm($("clients-add-form").hidden));
  $("add-cancel").addEventListener("click", () => showAddForm(false));
  $("clients-add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = $("clients-add-form");
    const body = { name: $("add-name").value.trim(), email: $("add-email").value.trim(), phone: $("add-phone").value.trim(), notes: $("add-notes").value.trim() };
    if (!body.name) return $("add-name").focus();
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const data = await api("clients", { body });
      form.reset();
      showAddForm(false);
      toast("Added " + body.name);
      if (data.client && data.client.id) goClient(data.client.id);
      else loadClients();
    } catch (err) {
      if (err.message === "signed out") return;
      const d = err.data || {};
      const existing = d.id || d.existingId || (d.client && d.client.id);
      if (existing) {
        toast("They're already on the list");
        showAddForm(false);
        goClient(existing);
      } else toast(err.message);
    } finally {
      button.disabled = false;
    }
  });

  // Admins: sync with Acuity's calendar feed now
  $("clients-sync").addEventListener("click", async () => {
    const b = $("clients-sync");
    b.disabled = true;
    b.textContent = "Syncing…";
    try {
      const r = await api("clients/sync", { body: {} });
      const c = r.clients || {};
      const s = r.sessions || {};
      toast(c.added || c.updated || s.added || s.updated ? "Synced: " + (c.added || 0) + " new clients, " + (s.added || 0) + " new sessions" : "Synced: already up to date");
      loadClients();
    } catch (err) {
      if (err.message !== "signed out") toast("Couldn't sync: " + err.message);
    } finally {
      b.disabled = false;
      b.textContent = "Sync with Acuity now";
    }
  });

  // Import from contacts (19 Oct 2026, anyone signed in): a phone number given, then the contact with
  // that number found and everything on their card shown, ready to add as a client. Three ways in:
  // Find this number (the studio's Google Contacts, through Nova Bot), Choose from this phone's
  // contacts (the phone's own contact book: Android's contact picker, opened from Nova Agent's page
  // since a phone only offers it to the top page), and Open a contact card (a .vcf, how an iPhone
  // shares a contact). Nothing is added until Add is pressed (Nova Bot refuses a duplicate and says who).
  const lastNine = (v) => String(v || "").replace(/\D/g, "").slice(-9);
  const contactsPicker = () => {
    for (const w of [window.top, window]) {
      try {
        if (w && w.navigator && w.navigator.contacts && typeof w.navigator.contacts.select === "function") return w.navigator.contacts;
      } catch (err) {}
    }
    return null;
  };
  $("contacts-pick").hidden = !contactsPicker();
  if (contactsPicker()) $("contacts-how").textContent = "Find this number looks in the studio's Google Contacts. Choose from this phone's contacts opens your contact book.";
  const showContactsForm = (on) => {
    $("clients-contacts").hidden = !on;
    $("clients-contacts-open").setAttribute("aria-expanded", on ? "true" : "false");
    if (on) {
      showAddForm(false);
      $("clients-import").hidden = true;
      $("clients-import-open").setAttribute("aria-expanded", "false");
      $("clients-contacts").scrollIntoView({ block: "nearest", behavior: calm() ? "auto" : "smooth" });
      $("contacts-phone").focus();
    }
  };
  $("clients-contacts-open").addEventListener("click", () => showContactsForm($("clients-contacts").hidden));
  $("contacts-cancel").addEventListener("click", () => showContactsForm(false));
  const showContacts = (nodes) => $("contacts-result").replaceChildren(...nodes);

  // A contact card (.vcf: one or more vCards, 2.1 to 4.0) -> [{ name, emails, phones, addresses, organisation, birthday, notes }]
  function readVcards(text) {
    const unfolded = String(text || "").replace(/\r\n/g, "\n").replace(/=\n/g, "").replace(/\n[ \t]/g, "");
    const cards = [];
    let card = null;
    const unescape = (v) => v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1").trim();
    const qp = (v) => {
      try {
        return decodeURIComponent(v.replace(/%/g, "%25").replace(/=([0-9A-F]{2})/gi, "%$1"));
      } catch (err) {
        return v;
      }
    };
    for (const line of unfolded.split("\n")) {
      const m = line.match(/^(?:[\w-]+\.)?([A-Za-z-]+)((?:;[^:]*)?):(.*)$/);
      if (!m) continue;
      const key = m[1].toUpperCase();
      const value = /ENCODING=QUOTED-PRINTABLE/i.test(m[2]) ? qp(m[3]) : m[3];
      if (key === "BEGIN" && /vcard/i.test(value)) card = { name: "", n: "", emails: [], phones: [], addresses: [], organisation: "", birthday: "", notes: "" };
      else if (!card) continue;
      else if (key === "END") {
        card.name = card.name || card.n;
        delete card.n;
        if (card.name || card.phones.length || card.emails.length) cards.push(card);
        card = null;
      } else if (key === "FN") card.name = unescape(value);
      else if (key === "N") card.n = value.split(";").slice(0, 2).reverse().map(unescape).filter(Boolean).join(" ");
      else if (key === "TEL") card.phones.push(unescape(value.replace(/^tel:/i, "")));
      else if (key === "EMAIL") card.emails.push(unescape(value).toLowerCase());
      else if (key === "ADR") card.addresses.push(value.split(";").map(unescape).filter(Boolean).join(", "));
      else if (key === "ORG") card.organisation = value.split(";").map(unescape).filter(Boolean).join(", ");
      else if (key === "TITLE") card.organisation = [card.organisation, unescape(value)].filter(Boolean).join(", ");
      else if (key === "BDAY") card.birthday = unescape(value).replace(/^--/, "");
      else if (key === "NOTE") card.notes = unescape(value).slice(0, 1000);
    }
    return cards;
  }

  // What's found, as cards: each with what's on it and its own Add; with a number given, the ones
  // with that number first (and said so)
  function showFound(found, from) {
    const want = lastNine($("contacts-phone").value);
    const has = (c) => want.length === 9 && c.phones.some((p) => lastNine(p) === want);
    const list = want.length === 9 && found.some(has) ? [...found.filter(has), ...found.filter((c) => !has(c))] : found;
    if (!list.length) return showContacts([el("p", "", "No one found" + (want ? " with that number" : "") + " in " + from + ".")]);
    const nodes = [el("p", "hint cl-small", list.length === 1 ? "Found in " + from + ":" : list.length + " found in " + from + ":")];
    for (const c of list) {
      const box = el("div", "cl-found");
      box.appendChild(el("p", "cl-found-name", c.name || c.phones[0] || c.emails[0] || "No name"));
      if (want.length === 9 && has(c)) box.appendChild(el("p", "cl-done cl-small", "Has that number"));
      const facts = el("dl", "cl-facts");
      const fact = (label, value) => {
        if (!value) return;
        facts.appendChild(el("dt", "", label));
        facts.appendChild(el("dd", "", value));
      };
      fact("Phone", c.phones.join("\n"));
      fact("Email", c.emails.join("\n"));
      fact("Address", c.addresses.join("\n"));
      fact("Work", c.organisation);
      fact("Birthday", c.birthday);
      fact("Notes", c.notes);
      box.appendChild(facts);
      const add = el("button", "btn small", "Add as a client");
      add.type = "button";
      // (once added, or already a client: it opens them)
      add.addEventListener("click", () => (add.dataset.open ? goClient(Number(add.dataset.open)) : addFromContact(c, from, add)));
      box.appendChild(add);
      nodes.push(box);
    }
    showContacts(nodes);
  }
  async function addFromContact(c, from, button) {
    const want = lastNine($("contacts-phone").value);
    const phone = c.phones.find((p) => want.length === 9 && lastNine(p) === want) || c.phones[0] || "";
    const extra = [
      "From " + from + " (" + new Date().toLocaleDateString("en-GB") + ").",
      c.phones.length > 1 ? "Other numbers: " + c.phones.filter((p) => p !== phone).join(", ") : "",
      c.emails.length > 1 ? "Other emails: " + c.emails.slice(1).join(", ") : "",
      c.addresses.length ? "Address: " + c.addresses.join(" / ").replace(/\n/g, ", ") : "",
      c.organisation ? "Work: " + c.organisation : "",
      c.birthday ? "Birthday: " + c.birthday : "",
      c.notes,
    ].filter(Boolean);
    const body = { name: (c.name || phone || c.emails[0] || "").slice(0, 200), email: c.emails[0] || "", phone, notes: extra.join("\n").slice(0, 4000) };
    if (!body.name) return toast("That contact has no name or number to add.");
    button.disabled = true;
    try {
      const data = await api("clients", { body });
      toast("Added " + body.name);
      button.disabled = false;
      const id = data.client && data.client.id;
      if (id) {
        button.textContent = "Added: open them";
        button.dataset.open = String(id);
      } else {
        button.textContent = "Added";
        button.disabled = true;
      }
      loadClients();
    } catch (err) {
      button.disabled = false;
      if (err.message === "signed out") return;
      const d = err.data || {};
      const existing = d.id || d.existingId;
      if (existing) {
        toast("They're already on the list");
        button.textContent = "Already a client: open them";
        button.dataset.open = String(existing);
      } else toast(err.message);
    }
  }
  // Find this number: the studio's Google Contacts
  $("clients-contacts").addEventListener("submit", async (e) => {
    e.preventDefault();
    const phone = $("contacts-phone").value.trim();
    if (lastNine(phone).length < 9) {
      showContacts([el("p", "error", "Type their whole phone number first.")]);
      return $("contacts-phone").focus();
    }
    const b = $("contacts-find");
    b.disabled = true;
    showContacts([el("p", "hint cl-small", "Looking…")]);
    try {
      const r = await api("google/contacts/phone?phone=" + encodeURIComponent(phone));
      if (r.off) return showContacts([el("p", "", "Google Contacts isn't connected yet (Portal → Admin → Google)." + (contactsPicker() ? " Choose from this phone's contacts instead." : " Open a contact card instead."))]);
      showFound(r.contacts || [], "the studio's Google Contacts");
      if (!(r.contacts || []).length && contactsPicker()) $("contacts-result").appendChild(el("p", "hint cl-small", "Not there? Choose from this phone's contacts."));
    } catch (err) {
      if (err.message !== "signed out") showContacts([el("p", "error", err.message)]);
    } finally {
      b.disabled = false;
    }
  });
  // Choose from this phone's contacts (the phone asks the person; only what they choose comes back)
  $("contacts-pick").addEventListener("click", async () => {
    const book = contactsPicker();
    if (!book) return;
    try {
      const can = typeof book.getProperties === "function" ? await book.getProperties() : ["name", "email", "tel"];
      const props = ["name", "email", "tel", "address"].filter((p) => can.includes(p));
      const picked = await book.select(props, { multiple: true });
      if (!picked || !picked.length) return;
      const tidy = (a) => [...new Set((a || []).map((v) => String(v || "").trim()).filter(Boolean))];
      showFound(
        picked.map((c) => ({
          name: tidy(c.name)[0] || "",
          emails: tidy(c.email).map((e) => e.toLowerCase()),
          phones: tidy(c.tel),
          addresses: (c.address || []).map((a) => [...(a.addressLine || []), a.city, a.region, a.postalCode, a.country].filter(Boolean).join(", ")).filter(Boolean),
          organisation: "",
          birthday: "",
          notes: "",
        })),
        "this phone's contacts"
      );
    } catch (err) {
      showContacts([el("p", "error", "The phone's contacts didn't open: " + (err.message || err) + ". Open a contact card instead.")]);
    }
  });
  // Open a contact card (.vcf)
  $("contacts-file").addEventListener("change", async () => {
    const files = [...$("contacts-file").files];
    $("contacts-file").value = "";
    if (!files.length) return;
    if (files.some((f) => f.size > 5 * 1024 * 1024)) return showContacts([el("p", "error", "That contact card is too big (over 5 MB).")]);
    try {
      const cards = (await Promise.all(files.map((f) => f.text()))).flatMap(readVcards);
      showFound(cards, files.length === 1 ? files[0].name : "the contact cards");
    } catch (err) {
      showContacts([el("p", "error", "Couldn't read that contact card.")]);
    }
  });

  // Admins: import Acuity's appointments or clients spreadsheet (a chosen file, or pasted)
  $("clients-import-open").addEventListener("click", () => {
    const on = $("clients-import").hidden;
    $("clients-import").hidden = !on;
    $("clients-import-open").setAttribute("aria-expanded", on ? "true" : "false");
    if (on) showAddForm(false), ($("clients-contacts").hidden = true), $("clients-contacts-open").setAttribute("aria-expanded", "false"), $("clients-import").scrollIntoView({ block: "nearest", behavior: calm() ? "auto" : "smooth" });
  });
  $("import-cancel").addEventListener("click", () => {
    $("clients-import").hidden = true;
    $("clients-import-open").setAttribute("aria-expanded", "false");
  });
  $("import-file").addEventListener("change", () => {
    const file = $("import-file").files[0];
    importText = "";
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) return showImport([el("p", "error", "That file is too big (over 20 MB). Export a shorter date range from Acuity.")]);
    const reader = new FileReader();
    reader.onload = () => {
      importText = String(reader.result || "");
      showImport([el("p", "hint cl-small", "Chosen: " + file.name + " (" + Math.max(0, importText.split(/\r?\n/).filter((l) => l.trim()).length - 1) + " lines). Press Import.")]);
    };
    reader.onerror = () => showImport([el("p", "error", "Couldn't read that file.")]);
    reader.readAsText(file);
  });
  // Pasting instead of a chosen file: the pasted text is what's imported
  $("import-text").addEventListener("input", () => {
    if (!importText) return;
    importText = "";
    $("import-file").value = "";
  });
  const showImport = (nodes) => $("import-result").replaceChildren(...nodes);
  $("clients-import").addEventListener("submit", async (e) => {
    e.preventDefault();
    const csv = importText || $("import-text").value;
    if (!csv.trim()) return showImport([el("p", "error", "Choose the CSV file, or paste it, first.")]);
    const b = $("import-go");
    b.disabled = true;
    b.textContent = "Importing…";
    showImport([]);
    try {
      const r = await api("clients/import", { body: { csv } });
      const c = r.clients || {};
      const s = r.sessions || {};
      const lines = [
        el("p", "cl-done", (r.kind === "clients" ? "Acuity's client list" : "Acuity's appointments") + " imported."),
        el("p", "", "Clients: " + (c.added || 0) + " new, " + (c.updated || 0) + " updated." + (r.kind === "clients" ? "" : " Sessions: " + (s.added || 0) + " new, " + (s.updated || 0) + " updated.")),
      ];
      if (r.skipped) lines.push(el("p", "hint cl-small", r.skipped + (r.skipped === 1 ? " line was" : " lines were") + " skipped."));
      if (r.problems && r.problems.length) {
        const ul = el("ul", "cl-log");
        for (const p of r.problems) ul.appendChild(el("li", "", typeof p === "string" ? p : (p.line ? "Line " + p.line + ": " : "") + (p.problem || p.error || p.message || JSON.stringify(p))));
        lines.push(ul);
      }
      showImport(lines);
      importText = "";
      $("import-file").value = "";
      $("import-text").value = "";
      toast("Imported");
      loadClients();
    } catch (err) {
      if (err.message !== "signed out") showImport([el("p", "error", "Not imported: " + err.message)]);
    } finally {
      b.disabled = false;
      b.textContent = "Import";
    }
  });

  // The list refreshes now and then while it's on screen (calmly: only changed cards are redrawn)
  setInterval(() => !document.hidden && running && currentView === "clients" && !openClientId() && document.activeElement !== $("clients-search") && loadClients(), 60000);

  // ===== One enquiry: the conversation =====
  // Their message, then every reply, note and draft from Agent, oldest first. While it's open
  // and on screen it checks for news every 5 seconds, so other staff's replies and Agent's
  // drafts appear by themselves; only messages that changed are redrawn (nothing flickers).

  let threadId = null; // the enquiry open, or null
  let thread = null; // its latest data
  let threadMode = "reply"; // the box writes a reply or a note
  let threadTimer = null;
  let threadLoading = false;
  const editing = new Map(); // drafts being edited: message id -> the text so far
  const pending = new Map(); // Send presses not answered yet: key -> { body, mode, failed, error }
  let sentAsk = null; // WhatsApp or Messages opened with a message: { kind, body, key } until "Yes, it sent"
  let callAsk = null; // a call made from here: { key, note } until they say how it went
  const THREAD_POLL_MS = 5000;

  // A random id for one press of Send (the server never saves the same press twice)
  const pressKey = () => "p-" + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2));

  function closeThread() {
    if (!threadId) return;
    threadId = null;
    thread = null;
    editing.clear();
    pending.clear();
    sentAsk = null;
    callAsk = null;
    clearInterval(threadTimer);
    threadTimer = null;
    $("enquiry-thread").hidden = true;
    $("enquiry-list").hidden = false;
    $("enq-chips").hidden = false;
    $("enq-tools").hidden = false;
    $("enq-back").hidden = true;
    setText("enq-title", "Enquiries");
    $("thread-input").value = "";
  }

  async function openThread(id) {
    const fresh = threadId !== id;
    if (fresh) {
      closeThread();
      threadId = id;
      $("enquiry-list").hidden = true;
      $("enq-chips").hidden = true;
      $("enq-tools").hidden = true;
      $("saved-panel").hidden = true;
      $("saved-open").setAttribute("aria-expanded", "false");
      $("enq-back").hidden = false;
      $("enquiry-thread").hidden = false;
      $("thread-head").replaceChildren();
      $("thread-list").replaceChildren(el("div", "skeleton"));
      delete $("thread-head").dataset.sig;
      setMode("reply");
      loadSaved();
      threadTimer = setInterval(() => !document.hidden && running && currentView === "enquiries" && loadThread(), THREAD_POLL_MS);
      if (window.portalTop) window.portalTop(); else window.scrollTo(0, 0);
    }
    await loadThread();
  }

  async function loadThread() {
    const id = threadId;
    if (!id || threadLoading) return;
    threadLoading = true;
    try {
      const data = await api("enquiries/thread?id=" + id);
      if (threadId !== id) return;
      thread = data;
      if (data.team) inboxTeam = data.team;
      drawThread();
    } catch (err) {
      if (err.message !== "signed out" && threadId === id && !thread) emptyState($("thread-list"), err.message);
    } finally {
      threadLoading = false;
    }
  }

  function drawThread() {
    const q = thread.enquiry;
    setText("enq-title", q.name);
    // The details card (redrawn only when it changes)
    redraw($("thread-head"), sig(q, thread.canSend, inboxTeam.length), [threadHead(q)]);
    // The conversation: their message first, then each message, then presses still on their way
    const nodes = [customerMessage(q)];
    for (const m of thread.messages) nodes.push(editing.has(m.id) ? keepEditing(m) : messageCard(m));
    for (const [key, p] of pending) nodes.push(pendingCard(key, p));
    if (sentAsk) nodes.push(sentCard());
    if (callAsk) nodes.push(callCard());
    reconcile($("thread-list"), nodes);
    updateBox();
  }

  // Name, how to reach them (email, call, text), consent, Don't contact
  function threadHead(q) {
    const card = el("article", "card thread-head" + (q.status === "done" || q.status === "spam" ? " done" : ""));
    const top = el("div", "card-top");
    const title = el("h3", "card-title", q.subject || "Enquiry");
    statePills(title, q);
    top.append(title, el("span", "card-meta", when(q.created_at)));
    card.append(top, el("p", "card-who", q.name + " · " + q.email + (q.phone ? " · " + q.phone : "")));
    const actions = el("div", "actions");
    contactLinks(actions, q, "btn small", askCall);
    const link = el("button", "btn small ghost", "Booking link");
    link.type = "button";
    link.addEventListener("click", () => openSheet(q));
    actions.appendChild(link);
    if (q.chat_id) {
      const chat = el("button", "btn small ghost", "Read conversation");
      chat.type = "button";
      chat.addEventListener("click", () => {
        openChatId = null;
        show("chats");
        openChat(q.chat_id, q.name);
      });
      actions.appendChild(chat);
    }
    card.appendChild(actions);
    if (q.status === "spam" && q.spam_reason) card.appendChild(el("p", "ib-why", q.spam_reason));
    card.appendChild(sortRow(q));
    if (q.dial && !q.do_not_contact_at) card.appendChild(el("p", "card-foot", "WhatsApp, Call and Text use your own phone (or WhatsApp Web on a computer). Write a WhatsApp or text below and Portal opens it ready to send, then adds it here."));
    else if (q.phone && !q.do_not_contact_at) card.appendChild(el("p", "card-foot", "Their number isn't a mobile, so there's no WhatsApp or texts. Call still works."));
    // UK GDPR: why the studio may contact them
    card.appendChild(el("p", "card-foot", "Asked to be contacted: " + when(q.consent_at || q.created_at) + (q.consent_source ? " · " + q.consent_source : "")));
    // Don't contact: blocks every send (the customer's own stop link can't be undone here)
    const stop = el("label", "dnc");
    const box = el("input");
    box.type = "checkbox";
    box.checked = Boolean(q.do_not_contact_at);
    box.disabled = q.do_not_contact_by === "customer";
    stop.append(box, el("span", "", "Don't contact"));
    const why = q.do_not_contact_at
      ? q.do_not_contact_by === "customer"
        ? "They asked to stop with the link in an email (" + when(q.do_not_contact_at) + "). Nothing can be sent."
        : "Switched on " + when(q.do_not_contact_at) + ". Nothing can be sent while it's on."
      : "Switch on if they ask the studio to stop contacting them.";
    stop.appendChild(el("small", "", why));
    box.addEventListener("change", async () => {
      box.disabled = true;
      try {
        await api("enquiries/contact", { body: { id: q.id, doNotContact: box.checked } });
        toast(box.checked ? "They won't be contacted" : "Replies are allowed again");
      } catch (err) {
        toast(err.message);
        box.checked = !box.checked;
      }
      box.disabled = false;
      loadThread();
    });
    card.appendChild(stop);
    return card;
  }

  // Their first message (from NovaBot's chat)
  function customerMessage(q) {
    const card = el("article", "card msg-card customer");
    card.dataset.key = "first";
    card.dataset.sig = sig(q.details, q.created_at);
    card.appendChild(el("span", "msg-who", q.name + " · " + when(q.created_at)));
    card.appendChild(el("p", "msg-body", q.details));
    return card;
  }

  // Sending / Sent ✓ / Failed (with the reason) / Draft
  function stateChip(m) {
    if (m.status === "sent" && m.channel === "whatsapp") return el("span", "msg-state sent", "Sent on WhatsApp ✓ " + when(m.sent_at));
    if (m.status === "sent" && m.channel === "sms") return el("span", "msg-state sent", "Texted ✓ " + when(m.sent_at));
    if (m.status === "sent") return el("span", "msg-state sent", "Sent ✓ " + when(m.sent_at) + (m.approver_name && m.created_by === "agent" ? " · approved by " + m.approver_name : ""));
    if (m.status === "approved") return el("span", "msg-state sending", m.stuck ? "Still sending? You can retry" : "Sending…");
    if (m.status === "failed") return el("span", "msg-state failed", "Didn't send: " + (m.error || "unknown reason"));
    if (m.status === "draft") return el("span", "msg-state draft", "Draft · waiting for approval");
    return null;
  }

  function messageCard(m) {
    const kind = m.direction === "note" ? "note" : m.status === "draft" ? "draft" : "out";
    // A call made from someone's phone is kept as a note starting "Phone call: " (Nova Bot's CALL_PREFIX)
    const call = m.direction === "note" && m.body.startsWith(CALL_PREFIX);
    const card = el("article", "card msg-card " + kind + (call ? " call" : ""));
    card.dataset.key = "m" + m.id;
    card.dataset.sig = sig(m.status, m.body, m.updated_at, m.error, m.stuck, thread.canSend, Boolean(thread.enquiry.do_not_contact_at));
    const by = { whatsapp: "WhatsApp", sms: "Text" }[m.channel] || "Reply";
    const who = call
      ? "Call · " + (m.author_name || "Staff")
      : m.direction === "note"
        ? "Note · " + (m.created_by === "customer" ? "Nova Bot" : m.author_name || "Staff")
        : m.created_by === "agent"
          ? "Draft by Nova Agent"
          : by + " · " + (m.author_name || "Staff");
    card.appendChild(el("span", "msg-who", who + " · " + when(m.created_at)));
    card.appendChild(el("p", "msg-body", call ? m.body.slice(CALL_PREFIX.length) : m.body));
    const chip = stateChip(m);
    const row = el("div", "msg-foot");
    if (chip) row.appendChild(chip);
    const blocked = Boolean(thread.enquiry.do_not_contact_at);
    if (m.status === "draft") {
      if (!blocked && thread.canSend) row.appendChild(button("Approve & send", "btn small", () => approve(m, card)));
      if (!blocked && !thread.canSend && thread.onlineUrl) {
        const online = el("a", "btn small", "Approve in Portal online");
        online.href = thread.onlineUrl;
        online.target = "_blank";
        online.rel = "noopener";
        row.appendChild(online);
      }
      row.appendChild(button("Edit", "btn small ghost", () => {
        editing.set(m.id, m.body);
        drawThread();
      }));
      row.appendChild(button("Discard", "btn small ghost", () => discard(m)));
    }
    if ((m.status === "failed" || m.stuck) && !blocked && thread.canSend) row.appendChild(button("Retry", "btn small", () => retry(m)));
    if (row.childNodes.length) card.appendChild(row);
    return card;
  }

  // A draft being edited stays as it is while the thread refreshes around it
  function keepEditing(m) {
    const was = $("thread-list").querySelector('[data-key="m' + m.id + '"].editing');
    if (was && m.status === "draft") return was;
    if (m.status !== "draft") {
      editing.delete(m.id);
      return messageCard(m);
    }
    const card = el("article", "card msg-card draft editing");
    card.dataset.key = "m" + m.id;
    card.dataset.sig = "editing";
    card.appendChild(el("span", "msg-who", "Draft by Nova Agent · editing"));
    const area = el("textarea", "msg-edit");
    area.value = editing.get(m.id);
    area.rows = Math.min(14, Math.max(4, area.value.split("\n").length + 1));
    area.addEventListener("input", () => editing.set(m.id, area.value));
    card.appendChild(area);
    const row = el("div", "msg-foot");
    row.appendChild(button("Save", "btn small", async (b) => {
      b.disabled = true;
      try {
        await api("enquiries/draft/edit", { body: { messageId: m.id, body: area.value } });
        editing.delete(m.id);
        toast("Draft saved");
      } catch (err) {
        toast(err.message);
        b.disabled = false;
        return;
      }
      loadThread();
    }));
    if (thread.canSend && !thread.enquiry.do_not_contact_at) {
      row.appendChild(button("Approve & send", "btn small ghost", () => approve(m, card, area.value)));
    }
    row.appendChild(button("Cancel", "btn small ghost", () => {
      editing.delete(m.id);
      drawThread();
    }));
    card.appendChild(row);
    setTimeout(() => area.focus({ preventScroll: true }), 30);
    return card;
  }

  function button(text, cls, onClick) {
    const b = el("button", cls, text);
    b.type = "button";
    b.addEventListener("click", () => onClick(b));
    return b;
  }

  // Approve & send: the person's press is the approval; the text they see is what goes
  async function approve(m, card, body) {
    card.querySelectorAll("button").forEach((b) => (b.disabled = true));
    const chip = card.querySelector(".msg-state");
    if (chip) {
      chip.className = "msg-state sending";
      chip.textContent = "Sending…";
    }
    try {
      const data = await api("enquiries/draft/approve", { body: { messageId: m.id, body: body !== undefined ? body : m.body } });
      editing.delete(m.id);
      if (data.message && data.message.status === "failed") toast("Didn't send: " + (data.message.error || "unknown reason"));
      else toast("Sent to " + thread.enquiry.name);
    } catch (err) {
      toast(err.message);
    }
    loadThread();
  }

  async function discard(m) {
    try {
      await api("enquiries/draft/discard", { body: { messageId: m.id } });
      editing.delete(m.id);
      toast("Draft discarded");
    } catch (err) {
      toast(err.message);
    }
    loadThread();
  }

  async function retry(m) {
    try {
      const data = await api("enquiries/retry", { body: { messageId: m.id } });
      toast(data.message && data.message.status === "sent" ? "Sent ✓" : "Didn't send: " + ((data.message && data.message.error) || "unknown reason"));
    } catch (err) {
      toast(err.message);
    }
    loadThread();
  }

  // A press of Send still on its way (or that couldn't reach Nova Bot: Retry sends the same press)
  function pendingCard(key, p) {
    const card = el("article", "card msg-card " + (p.mode === "note" ? "note" : "out") + " pending");
    card.dataset.key = "p" + key;
    card.dataset.sig = sig(p);
    card.appendChild(el("span", "msg-who", (p.mode === "note" ? "Note" : "Reply") + " · you"));
    card.appendChild(el("p", "msg-body", p.body));
    const row = el("div", "msg-foot");
    row.appendChild(el("span", "msg-state " + (p.failed ? "failed" : "sending"), p.failed ? "Didn't reach Nova Bot: " + p.error : p.mode === "note" ? "Saving…" : "Sending…"));
    if (p.failed) row.appendChild(button("Retry", "btn small", () => submitPress(key, p)));
    card.appendChild(row);
    return card;
  }

  async function submitPress(key, p) {
    const id = threadId;
    p.failed = false;
    pending.set(key, p);
    if (thread) drawThread();
    try {
      const data = await api(p.mode === "note" ? "enquiries/note" : "enquiries/reply", { body: { id, body: p.body, key } });
      pending.delete(key);
      if (p.mode !== "note" && data.message && data.message.status === "failed") toast("Didn't send: " + (data.message.error || "unknown reason"));
      else if (p.mode !== "note") toast("Sent to " + (thread ? thread.enquiry.name : "them"));
    } catch (err) {
      if (err.message === "signed out") return;
      // Refused (e.g. don't contact): back in the box to change; couldn't reach: Retry
      if (/^(Something went wrong \(5|Failed to fetch|NetworkError|Load failed)/.test(err.message)) {
        pending.set(key, { ...p, failed: true, error: err.message });
      } else {
        pending.delete(key);
        if (!$("thread-input").value) $("thread-input").value = p.body;
        toast(err.message);
      }
    }
    if (threadId === id) loadThread();
  }

  // The reply box: Reply or Note, who it goes to, and whether this sign-in can send
  function setMode(mode) {
    threadMode = mode;
    document.querySelectorAll("#thread-form [data-mode]").forEach((c) => {
      c.classList.toggle("active", c.dataset.mode === mode);
      c.setAttribute("aria-pressed", String(c.dataset.mode === mode));
    });
    updateBox();
  }
  function updateBox() {
    const q = thread && thread.enquiry;
    // WhatsApp and Text need a mobile number (and nobody's asked not to be contacted)
    const mobile = Boolean(q && q.dial);
    document.querySelectorAll("#thread-form [data-mode=whatsapp], #thread-form [data-mode=sms]").forEach((c) => (c.hidden = !mobile));
    if (!mobile && (threadMode === "whatsapp" || threadMode === "sms")) return setMode("reply");
    const note = threadMode === "note";
    const phone = threadMode === "whatsapp" || threadMode === "sms";
    const blocked = q && q.do_not_contact_at;
    const cantSend = thread && !thread.canSend;
    const first = q ? q.name.split(/\s+/)[0] : "them";
    $("thread-input").placeholder = note
      ? "A note for the team (never sent)…"
      : threadMode === "whatsapp"
        ? "Write a WhatsApp message to " + first + "…"
        : threadMode === "sms"
          ? "Write a text to " + first + "…"
          : "Write a reply to " + first + "…";
    setText(
      "thread-to",
      note ? "Team only" : !q ? "" : threadMode === "whatsapp" ? "To " + prettyNumber(q.dial) + " on WhatsApp" : threadMode === "sms" ? "To " + prettyNumber(q.dial) + " by text" : "To " + q.email
    );
    let hint = "";
    if (!note && blocked) hint = "They've asked not to be contacted, so replies can't be sent. Notes still work.";
    else if (threadMode === "whatsapp") hint = { phone: "Opens WhatsApp", web: "Opens WhatsApp Web", app: "Opens the WhatsApp app" }[waWhere()] + " with this filled in. Press send there, then come back and tap “Yes, it sent”.";
    else if (threadMode === "sms") hint = onPhone ? "Opens Messages with this filled in. Press send there, then come back and tap “Yes, it sent”." : "Shows the number and message to send from your phone (or Messages on this computer). Then tap “Yes, it sent”.";
    else if (!note && cantSend) hint = "Sending needs Portal open in a browser, signed in. Notes work here.";
    else if (!note) hint = "Emailed from the studio. Their replies come to the studio inbox. Every email says why they're getting it and how to stop.";
    setText("thread-hint", hint);
    const online = !note && !phone && cantSend && !blocked;
    $("thread-online").hidden = !online;
    if (online && thread.onlineUrl) $("thread-online").href = thread.onlineUrl;
    $("thread-send").disabled = !note && Boolean(blocked || (!phone && cantSend));
    const where = waWhere();
    $("thread-wa-where").hidden = threadMode !== "whatsapp" || where === "phone";
    setText("thread-wa-where", where === "app" ? "Use WhatsApp Web instead" : "Use the WhatsApp app instead");
    setText("thread-send", note ? "Add note" : threadMode === "whatsapp" ? "Open WhatsApp" : threadMode === "sms" ? (onPhone ? "Open Messages" : "Text from your phone") : "Send");
  }

  // ----- WhatsApp, texts and calls: open them, then ask how it went -----
  const CALL_PREFIX = "Phone call: ";

  // Write a WhatsApp or text: open it ready to send (WhatsApp in a new tab: the app or
  // WhatsApp Web), then ask "Did it send?" (the press itself opens it, so nothing blocks it)
  function openPhoneReply(body) {
    const q = thread.enquiry;
    const kind = threadMode;
    if (kind === "whatsapp") openWhatsApp(q.dial, body);
    else if (onPhone) location.href = smsLink(q.dial, body);
    else phoneSheet(q, "sms", body);
    sentAsk = { kind, body, key: pressKey() };
    $("thread-input").value = "";
    drawThread();
  }

  // After Call: how did it go?
  function askCall() {
    if (!callAsk) callAsk = { key: pressKey(), note: "" };
    if (thread) drawThread();
  }

  function sentCard() {
    const a = sentAsk;
    const app = a.kind === "whatsapp" ? "WhatsApp" : "text";
    const card = el("article", "card msg-card out ask");
    card.dataset.key = "ask-sent";
    card.dataset.sig = sig(a.key, a.saving, a.error);
    card.appendChild(el("span", "msg-who", (a.kind === "whatsapp" ? "WhatsApp" : "Text") + " · you"));
    card.appendChild(el("p", "msg-body", a.body));
    card.appendChild(el("p", "ask-q", "Did your " + app + " to " + thread.enquiry.name.split(/\s+/)[0] + " send?"));
    const row = el("div", "msg-foot");
    row.appendChild(button("Yes, it sent", "btn small", () => logContact(a, () => (sentAsk = null))));
    row.appendChild(button(a.kind === "whatsapp" ? "Open WhatsApp again" : onPhone ? "Open Messages again" : "Show the number again", "btn small ghost", () => {
      const q = thread.enquiry;
      if (a.kind === "whatsapp") openWhatsApp(q.dial, a.body);
      else if (onPhone) location.href = smsLink(q.dial, a.body);
      else phoneSheet(q, "sms", a.body);
    }));
    row.appendChild(button("No, change it", "btn small ghost", () => {
      sentAsk = null;
      setMode(a.kind);
      $("thread-input").value = a.body;
      drawThread();
      $("thread-input").focus();
    }));
    if (a.error) row.appendChild(el("span", "msg-state failed", a.error));
    row.querySelectorAll("button").forEach((b) => (b.disabled = Boolean(a.saving)));
    card.appendChild(row);
    return card;
  }

  function callCard() {
    const a = callAsk;
    const card = el("article", "card msg-card note call ask");
    card.dataset.key = "ask-call";
    card.dataset.sig = sig(a.key, a.saving, a.error);
    card.appendChild(el("span", "msg-who", "Call · you"));
    card.appendChild(el("p", "ask-q", "How did the call with " + thread.enquiry.name.split(/\s+/)[0] + " go?"));
    const note = el("input", "ask-note");
    note.type = "text";
    note.maxLength = 1000;
    note.placeholder = "A note for the team (optional), e.g. booked Tuesday 2pm";
    note.setAttribute("aria-label", "A note about the call (optional)");
    note.value = a.note;
    note.addEventListener("input", () => (a.note = note.value));
    card.appendChild(note);
    const row = el("div", "msg-foot");
    for (const [outcome, label] of [["spoke", "Spoke to them"], ["voicemail", "Left a voicemail"], ["no-answer", "No answer"]]) {
      row.appendChild(button(label, outcome === "spoke" ? "btn small" : "btn small ghost", () => logContact({ ...a, kind: "call", outcome, body: a.note }, () => (callAsk = null), a)));
    }
    row.appendChild(button("Skip", "btn small ghost", () => {
      callAsk = null;
      drawThread();
    }));
    if (a.error) row.appendChild(el("span", "msg-state failed", a.error));
    card.querySelectorAll("button, input").forEach((b) => (b.disabled = Boolean(a.saving)));
    row.querySelectorAll("button").forEach((b) => (b.disabled = Boolean(a.saving)));
    card.appendChild(row);
    return card;
  }

  // Write what happened into the conversation (the same press is never saved twice)
  async function logContact(p, clear, ask = p) {
    const id = threadId;
    ask.saving = true;
    ask.error = "";
    drawThread();
    try {
      await api("enquiries/logged", { body: { id, kind: p.kind, body: p.body, outcome: p.outcome, key: p.key } });
      clear();
      toast(p.kind === "call" ? "Call added to the conversation" : "Added to the conversation");
    } catch (err) {
      if (err.message === "signed out") return;
      ask.saving = false;
      ask.error = err.message;
    }
    if (threadId === id) {
      drawThread();
      loadThread();
    }
  }

  document.querySelectorAll("#thread-form [data-mode]").forEach((c) => c.addEventListener("click", () => setMode(c.dataset.mode)));
  // On a computer: WhatsApp Web (the default) or the WhatsApp app installed on it
  $("thread-wa-where").addEventListener("click", () => {
    try {
      localStorage.setItem(WA_PICK, waWhere() === "app" ? "web" : "app");
    } catch (err) {}
    updateBox();
    toast(waWhere() === "app" ? "WhatsApp will open in the app" : "WhatsApp will open in WhatsApp Web");
  });
  $("thread-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const body = $("thread-input").value.trim();
    if (!body || !threadId || $("thread-send").disabled) return;
    if (threadMode === "whatsapp" || threadMode === "sms") return openPhoneReply(body);
    $("thread-input").value = "";
    submitPress(pressKey(), { body, mode: threadMode });
  });
  // Ctrl/Cmd + Enter sends
  $("thread-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) $("thread-form").requestSubmit();
  });
  $("enq-back").addEventListener("click", () => goEnquiry(null));

  // ===== Booking link sheet =====

  async function openSheet(q) {
    sheetEnquiry = q;
    $("sheet-for").textContent = "For " + q.name + " (" + q.email + ")";
    $("sheet-result").hidden = true;
    $("sheet-error").textContent = "";
    $("sheet").hidden = false;
    if (!sessions) {
      try {
        sessions = (await api("sessions")).sessions;
      } catch (err) {
        $("sheet-error").textContent = err.message;
        return;
      }
    }
    $("sheet-session").replaceChildren(
      ...sessions.map((s) => {
        const option = el("option", "", s.name + (s.price ? " (" + s.price + ")" : ""));
        option.value = s.id;
        return option;
      })
    );
  }

  $("sheet-make").addEventListener("click", async () => {
    $("sheet-error").textContent = "";
    try {
      const data = await api("booking-link", { body: { enquiryId: sheetEnquiry.id, typeId: Number($("sheet-session").value) } });
      $("sheet-link").value = data.url;
      const first = sheetEnquiry.name.split(/\s+/)[0];
      const body =
        "Hi " + first + ",\n\nThanks for your enquiry. You can book your session here: pick a time on the calendar and pay the deposit to confirm.\n\n" +
        data.session + "\n" + data.url + "\n\nNovacane Studios";
      $("sheet-email").href =
        "mailto:" + encodeURIComponent(sheetEnquiry.email) + "?subject=" + encodeURIComponent("Booking your session at Novacane") + "&body=" + encodeURIComponent(body);
      $("sheet-result").hidden = false;
    } catch (err) {
      $("sheet-error").textContent = err.message;
    }
  });

  $("sheet-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("sheet-link").value);
      toast("Link copied");
    } catch (err) {
      $("sheet-link").select();
      toast("Select the link and copy it");
    }
  });

  $("sheet-close").addEventListener("click", () => ($("sheet").hidden = true));
  $("sheet").addEventListener("click", (e) => {
    if (e.target === $("sheet")) $("sheet").hidden = true;
  });

  // ===== Conversations =====

  // The conversation open in the Conversations tab (a refresh keeps it open), or null for the list
  let openChatId = null;
  let pickedChat = null; // the ?chat= one already opened
  let openChatName = "";

  // Chats as tickets: "Needs a person" (someone should follow it up) or "Done"
  let chatsFilter = "all";
  document.querySelectorAll("[data-chats]").forEach((chip) =>
    chip.addEventListener("click", () => {
      chatsFilter = chip.dataset.chats;
      document.querySelectorAll("[data-chats]").forEach((c) => c.classList.toggle("active", c === chip));
      loadChats();
    })
  );
  async function markChat(chatId, state, said) {
    try {
      await api("inbox/chat", { body: { chatId, state, ...(state === "needs-person" ? { assignedTo: "me" } : {}) } });
      toast(said);
    } catch (err) {
      toast(err.message);
    }
    if (openChatId === chatId) openChat(chatId, openChatName);
    else loadChats();
  }
  // The buttons for a chat's mark (the one it has is lit; pressing it again clears it)
  function chatMarks(chatId, ticket) {
    const row = el("div", "chips ib-places");
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", "Mark this chat");
    for (const [state, name, said] of [
      ["needs-person", "Needs a person", "Marked: needs a person (you're on it)"],
      ["done", "Done", "Marked done"],
    ]) {
      const b = button(name, "chip" + (ticket === state ? " active" : ""), (btn) => {
        btn.disabled = true;
        markChat(chatId, ticket === state ? null : state, ticket === state ? "Mark cleared" : said);
      });
      b.setAttribute("aria-pressed", String(ticket === state));
      row.appendChild(b);
    }
    return row;
  }

  async function loadChats() {
    openChatId = null;
    $("chats-back").hidden = true;
    $("chats-chips").parentElement.hidden = false;
    setText("chats-title", "Conversations");
    $("chats-hint").hidden = false;
    const list = $("chat-list");
    try {
      const data = await api("conversations");
      if (openChatId) return; // a conversation was opened meanwhile
      setText("chats-needs-n", data.needsPerson ? String(data.needsPerson) : "");
      const shown = data.conversations.filter((c) => chatsFilter === "all" || c.ticket === chatsFilter);
      if (!shown.length) return emptyState(list, chatsFilter === "needs-person" ? "No chats waiting for a person." : chatsFilter === "done" ? "No chats marked done yet." : "No conversations yet.");
      reconcile(
        list,
        shown.map((c) => {
          const card = el("article", "card tappable" + (c.ticket === "done" ? " done" : ""));
          card.dataset.key = "c" + c.chat_id;
          card.dataset.sig = sig(c);
          const top = el("div", "card-top");
          const title = el("h3", "card-title", (c.first_question || "(no question)").slice(0, 120));
          if (c.enquiries) title.appendChild(el("span", "pill-new", "Enquiry"));
          if (c.live === "staff") title.appendChild(el("span", "pill-new", "Live" + (c.live_name ? " · " + c.live_name : "")));
          if (c.ticket === "needs-person") title.appendChild(el("span", "pill-open", "Needs a person"));
          if (c.ticket === "done") title.appendChild(el("span", "pill-done", "Done"));
          top.append(title, el("span", "card-meta", when(c.started)));
          card.append(top, el("p", "card-foot", [c.messages + (c.messages === 1 ? " message" : " messages"), c.assigned_name ? c.assigned_name + "'s on it" : ""].filter(Boolean).join(" · ")));
          card.appendChild(chatMarks(c.chat_id, c.ticket));
          card.addEventListener("click", (e) => {
            if (e.target.closest("button")) return;
            openChat(c.chat_id);
          });
          return card;
        })
      );
    } catch (err) {
      if (err.message !== "signed out") emptyState(list, err.message);
    }
  }

  async function openChat(chatId, name) {
    const fresh = openChatId !== chatId;
    openChatId = chatId;
    openChatName = name || "";
    $("chats-back").hidden = false;
    $("chats-chips").parentElement.hidden = true;
    $("chats-hint").hidden = true;
    setText("chats-title", name ? "Conversation with " + name.split(/\s+/)[0] : "Conversation");
    const list = $("chat-list");
    try {
      const data = await api("conversations?chat=" + encodeURIComponent(chatId));
      if (openChatId !== chatId) return; // moved on meanwhile
      if (!data.messages.length) return emptyState(list, "This conversation has been deleted (conversations are kept for 90 days).");
      // Its mark (needs a person / done), above the chat
      const ticket = data.ticket ? data.ticket.state : null;
      const bar = el("article", "card ib-chat-bar");
      bar.dataset.key = "ticket:" + chatId;
      bar.dataset.sig = sig(data.ticket);
      bar.appendChild(el("p", "card-foot", ticket === "needs-person" ? "Needs a person" + (data.ticket.assigned_name ? ": " + data.ticket.assigned_name + "'s on it" : "") : ticket === "done" ? "Done" : "Does this chat need someone from the studio to follow it up?"));
      bar.appendChild(chatMarks(chatId, ticket));
      const card = el("article", "card");
      card.dataset.key = "chat:" + chatId;
      card.dataset.sig = sig(data.messages);
      data.messages.forEach((m) => {
        if (m.role === "note") {
          card.appendChild(el("p", "line note", m.content + " · " + when(m.created_at)));
          return;
        }
        const line = el("div", "line " + (m.role === "user" ? "visitor" : m.role === "staff" ? "staff" : "bot"));
        const who = m.role === "user" ? "Customer" : m.role === "staff" ? (m.sender || "Someone") + " (studio)" : "NovaBot";
        line.appendChild(el("span", "who", who + " · " + when(m.created_at) + (m.page ? " · " + m.page : "")));
        const p = el("p");
        linkify(p, m.content);
        line.appendChild(p);
        card.appendChild(line);
      });
      reconcile(list, [bar, card, liveBox(chatId, data.live || { mode: "bot" })]);
      if (fresh) { if (window.portalTop) window.portalTop(); else window.scrollTo(0, 0); }
      watchChat(chatId, data.live);
    } catch (err) {
      if (err.message !== "signed out") emptyState(list, err.message);
    }
  }

  // ----- Live: someone from the studio typing straight to the visitor (Nova Bot's src/livechat.js) -----
  // Take over pauses NovaBot for this chat and tells the visitor who's here; replying takes it over
  // too. Hand back gives it back to NovaBot. While a chat is open here it's checked every few
  // seconds (sooner while someone has it), so the visitor's new messages show up by themselves.
  let chatTimer = 0;
  function watchChat(chatId, live) {
    clearTimeout(chatTimer);
    const gap = live && live.mode === "staff" ? 4000 : 10000;
    chatTimer = setTimeout(() => {
      if (openChatId === chatId && currentView === "chats" && !document.hidden) openChat(chatId, openChatName);
      else if (openChatId === chatId) watchChat(chatId, live);
    }, gap);
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && openChatId && currentView === "chats") openChat(openChatId, openChatName);
  });

  async function chatLive(chatId, action, extra, said) {
    const data = await api("conversations/live", { body: { chatId, action, ...extra } });
    if (said) toast(said);
    if (openChatId === chatId) openChat(chatId, openChatName);
    return data;
  }

  // The box under the chat: who has it, Take over / Hand back, and the reply. It keeps what's being
  // typed while the chat refreshes (its key and sig stay the same until who has the chat changes).
  function liveBox(chatId, live) {
    const mine = live.mode === "staff";
    const box = el("article", "card lc-box" + (mine ? " lc-live" : ""));
    box.dataset.key = "live:" + chatId;
    box.dataset.sig = sig([live.mode, live.staffName]);
    const head = el("div", "lc-head");
    head.appendChild(el("p", "card-foot lc-who", mine ? (live.staffName || "Someone") + " from the studio has this chat. NovaBot is paused." : "NovaBot is answering this chat. Reply below (or Take over) to answer the visitor yourself."));
    const toggle = button(mine ? "Hand back to NovaBot" : "Take over", "chip lc-toggle", async (b) => {
      b.disabled = true;
      try {
        await chatLive(chatId, mine ? "handback" : "takeover", {}, mine ? "NovaBot has the chat again" : "You have the chat. The visitor sees you joined.");
      } catch (err) {
        toast(err.message);
        b.disabled = false;
      }
    });
    head.appendChild(toggle);
    box.appendChild(head);
    const form = el("form", "lc-form");
    form.setAttribute("aria-label", "Reply to the visitor");
    const input = el("textarea", "lc-input");
    input.rows = 2;
    input.maxLength = 1500;
    input.placeholder = mine ? "Write to the visitor…" : "Write to the visitor (this takes the chat over)…";
    input.setAttribute("aria-label", "Your reply to the visitor");
    const send = el("button", "btn lc-send", "Send");
    send.type = "submit";
    form.append(input, send);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || send.disabled) return;
      send.disabled = true;
      try {
        await chatLive(chatId, "reply", { text });
        input.value = "";
      } catch (err) {
        toast(err.message);
      }
      send.disabled = false;
      input.focus();
    });
    // Enter sends, Shift+Enter makes a new line
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    box.appendChild(form);
    box.appendChild(el("p", "hint lc-hint", "The visitor sees your first name. Replies here go straight to them (no approval needed: they started the chat)."));
    return box;
  }

  $("chats-back").addEventListener("click", loadChats);

  // ===== Calendar =====
  // Every booking in Acuity's diary, as a month you can swipe through. Tap a
  // day to see its bookings with every detail, and call or email from there.

  // The bookings (loaded once, then refreshed when the tab opens)
  let calBookings = [];
  // Which month is showing ({ year, month } with month 0–11)
  let calMonth = null;
  // Which day is picked ("2026-10-22")
  let calPicked = null;
  // Whether the bookings have come in yet, and why not (the feed isn't set up, or an error)
  let calLoaded = false;
  let calProblem = "";
  // Colours for the different sessions (each session always gets the same one)
  const CAL_COLOURS = ["#ff5fa8", "#b98bff", "#ffd08a", "#7fd8ff", "#ff9d6e", "#8ef0c0"];

  // A day as "2026-10-22", in UK time
  function dayKey(date) {
    return date.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  }

  // The feed's time ("20261022T131500Z") as a real date
  function feedDate(value) {
    // Its parts: year, month, day, hour, minute
    const m = String(value || "").match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
    // A date, or nothing
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) : null;
  }

  // A time of day in UK time ("14:15")
  function clock(date) {
    return date.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
  }

  // A session's colour (the same session always gets the same colour)
  function sessionColour(name) {
    // Add up the letters to pick a colour
    let sum = 0;
    for (const c of String(name)) sum += c.charCodeAt(0);
    // That colour
    return CAL_COLOURS[sum % CAL_COLOURS.length];
  }

  // Get the bookings and draw the calendar
  async function loadCalendar() {
    // Today, in UK time
    const today = dayKey(new Date());
    // First visit: show this month, with today picked
    if (!calMonth) {
      calMonth = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 };
      calPicked = today;
    }
    // Draw what we have straight away
    drawMonth();
    drawDay();
    // Then get the latest bookings
    try {
      // Ask the Worker for the diary
      const data = await api("calendar");
      // The feed isn't set up
      if (!data.setUp) {
        calProblem = "The Acuity calendar feed isn't set up yet.";
        drawDay();
        return;
      }
      calProblem = "";
      // Each booking with its start and end as real dates
      calBookings = data.bookings
        .map((b) => ({ ...b, from: feedDate(b.start), to: feedDate(b.end) }))
        .filter((b) => b.from);
      calLoaded = true;
      // Draw again with them (only what changed is drawn again: no blink)
      drawMonth();
      drawDay();
    } catch (err) {
      // Show the problem
      if (err.message !== "signed out") {
        calProblem = err.message;
        drawDay();
      }
    }
  }

  // The bookings on one day ("2026-10-22"), earliest first
  // Calendar's cards and Quests on a day (sent by Nova Agent with its plan)
  function suiteOn(key) {
    const st = lastQuests && lastQuests.state;
    if (!st) return [];
    const items = [];
    const cal = st.calendar || { notes: [], days: [] };
    // Day cards (a whole day: birthdays, release days...), including yearly ones
    for (const d of cal.days || []) if (d.date === key || (d.repeat === "yearly" && d.date.slice(5) === key.slice(5))) items.push({ kind: "day", title: d.title, sub: [d.info, d.location].filter(Boolean).join(" · "), sort: "" });
    // Note cards (at a time)
    for (const n of cal.notes || []) if (n.start.slice(0, 10) <= key && n.end.slice(0, 10) >= key) items.push({ kind: "note", title: n.title || "Note card", sub: n.body, time: n.start.slice(0, 10) === key ? hhmm(n.start) + "–" + hhmm(n.end) : "all day", sort: n.start });
    // Planned quests
    for (const q of st.quests || []) if (q.start && q.start.slice(0, 10) === key && q.status !== "skipped") items.push({ kind: "quest", title: (q.status === "done" ? "✓ " : "") + q.title, sub: length(q), time: hhmm(q.start) + "–" + hhmm(q.end), sort: q.start });
    return items.sort((a, b) => a.sort.localeCompare(b.sort));
  }

  // One Calendar card or quest, in the Calendar tab
  function suiteCard(item) {
    const card = el("article", "card cal-card suite-item " + item.kind);
    card.appendChild(el("span", "alert-kind " + (item.kind === "quest" ? "quest" : "other"), item.kind === "quest" ? "Quest" : item.kind === "day" ? "Calendar · day" : "Calendar"));
    if (item.time) card.appendChild(el("p", "cal-time", item.time));
    card.appendChild(el("h3", "card-title", item.title));
    if (item.sub) card.appendChild(el("p", "cal-session", item.sub));
    return card;
  }

  // ===== The smart calendar =====
  // Opening hours (NovaBot tells customers 10am to 11pm, 7 days a week)
  const OPEN_FROM = 10;
  const OPEN_TO = 23;
  const OPEN_HOURS = OPEN_TO - OPEN_FROM;
  // What the day list shows: everything, or just bookings, quests or calendar notes
  let calFilter = "all";

  // A price like "£80", "80.00" or "£1,200.50" as a number of pounds (0 if there isn't one)
  function pounds(price) {
    const m = String(price || "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : 0;
  }
  // Minutes since midnight, UK time
  const ukMinutes = (date) => {
    const [h, m] = clock(date).split(":").map(Number);
    return h * 60 + m;
  };
  // "14:00" from minutes
  const hm = (mins) => String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0");

  // Everything about one day's bookings: hours booked, how full, clashes, free slots
  function dayFacts(key) {
    const list = bookingsOn(key);
    const spans = list.map((b) => ({ b, from: ukMinutes(b.from), to: b.to ? ukMinutes(b.to) || 24 * 60 : ukMinutes(b.from) + 60 })).sort((a, z) => a.from - z.from);
    const booked = spans.reduce((n, s) => n + Math.max(0, Math.min(s.to, OPEN_TO * 60) - Math.max(s.from, OPEN_FROM * 60)), 0);
    // Clashes (overlapping) and tight changeovers (under 15 minutes between sessions)
    const clashes = [];
    const tight = [];
    for (let i = 1; i < spans.length; i++) {
      const gap = spans[i].from - spans[i - 1].to;
      if (gap < 0) clashes.push([spans[i - 1].b, spans[i].b]);
      else if (gap < 15) tight.push([spans[i - 1].b, spans[i].b]);
    }
    // Free stretches of an hour or more within opening hours (and not already past, today)
    const now = new Date();
    let cursor = OPEN_FROM * 60;
    if (key === dayKey(now)) cursor = Math.max(cursor, Math.ceil((ukMinutes(now) + 1) / 30) * 30);
    const free = [];
    for (const s of spans) {
      if (s.from - cursor >= 60) free.push([cursor, s.from]);
      cursor = Math.max(cursor, s.to);
    }
    if (OPEN_TO * 60 - cursor >= 60) free.push([cursor, OPEN_TO * 60]);
    const takings = list.reduce((n, b) => n + pounds(b.price), 0);
    return { list, booked, load: Math.min(1, booked / (OPEN_HOURS * 60)), clashes, tight, free, takings };
  }

  // The week (Monday to Sunday) around a day
  function weekOf(key) {
    const d = new Date(key + "T12:00:00Z");
    const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000);
    return Array.from({ length: 7 }, (_, i) => new Date(monday.getTime() + i * 86400000).toISOString().slice(0, 10));
  }

  // Ask Nova (or NovaBot with the booking tools) something, ready to send
  function askAbout(mode, text) {
    show("bot");
    const chip = document.querySelector(`#view-bot [data-mode="${mode}"]`);
    if (chip && !chip.classList.contains("active")) chip.click();
    setTimeout(() => {
      $("bot-input").value = text;
      $("bot-input").dispatchEvent(new Event("input"));
      $("bot-input").focus();
    }, 80);
  }

  // This week at a glance, above the month
  function drawSmartWeek() {
    const box = $("cal-smart");
    if (!box) return;
    const days = weekOf(calPicked || dayKey(new Date()));
    const facts = days.map((k) => ({ k, ...dayFacts(k) }));
    const sessions = facts.reduce((n, f) => n + f.list.length, 0);
    const hours = facts.reduce((n, f) => n + f.booked, 0) / 60;
    const takings = facts.reduce((n, f) => n + f.takings, 0);
    const busiest = facts.reduce((a, f) => (f.booked > a.booked ? f : a), facts[0]);
    const clashes = facts.reduce((n, f) => n + f.clashes.length, 0);
    // The next free hour from now (this week or the next 14 days)
    let next = null;
    const today = dayKey(new Date());
    for (let i = 0; i < 14 && !next; i++) {
      const k = new Date(Date.now() + i * 86400000).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
      const f = dayFacts(k);
      if (f.free.length) next = { k, slot: f.free[0] };
    }
    const short = (k) => new Date(k + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
    const tile = (big, label, cls = "") => {
      const t = el("div", "smart-tile " + cls);
      t.append(el("b", "", big), el("span", "", label));
      return t;
    };
    const head = el("p", "smart-kicker", "Week of " + short(days[0]) + (days.includes(today) ? " · this week" : ""));
    const tiles = el("div", "smart-tiles");
    tiles.append(
      tile(String(sessions), sessions === 1 ? "session" : "sessions"),
      tile(hours.toFixed(1).replace(/\.0$/, "") + "h", "booked · " + Math.round((hours / (OPEN_HOURS * 7)) * 100) + "% full"),
      tile(takings ? "£" + Math.round(takings).toLocaleString("en-GB") : "–", "session value"),
      tile(busiest && busiest.booked ? short(busiest.k).split(" ")[0] : "–", "busiest day"),
      tile(next ? (next.k === today ? "Today" : short(next.k).split(" ").slice(0, 2).join(" ")) + " " + hm(next.slot[0]) : "None", "next free hour", "free")
    );
    if (clashes) tiles.append(tile(String(clashes), clashes === 1 ? "clash" : "clashes", "warn"));
    const ask = el("button", "chip smart-ask", "✦ Ask Nova about this week");
    ask.type = "button";
    ask.addEventListener("click", () => askAbout("nova", `Give me a quick rundown of the week starting ${short(days[0])}: who's in, anything unpaid or clashing, and where we've got space.`));
    redraw(box, calPicked, [head, tiles, ask]);
  }

  // The picked day: how full it is, warnings, free slots, filters, and Ask Nova
  function drawSmartDay() {
    const box = $("cal-day-smart");
    if (!box || !calPicked) return;
    const f = dayFacts(calPicked);
    const name = new Date(calPicked + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
    const parts = [];
    // How full it is
    const meter = el("div", "load-meter");
    const bar = el("i", "");
    bar.style.width = Math.round(f.load * 100) + "%";
    meter.appendChild(bar);
    const pct = Math.round(f.load * 100);
    parts.push(el("p", "smart-kicker", `${(f.booked / 60).toFixed(1).replace(/\.0$/, "")}h of ${OPEN_HOURS}h booked · ${pct}% full${f.takings ? " · £" + Math.round(f.takings).toLocaleString("en-GB") + " of sessions" : ""}`), meter);
    // Warnings
    for (const [a, b] of f.clashes) parts.push(el("p", "smart-warn", `⚠ Clash: ${a.name || a.session} and ${b.name || b.session} overlap at ${clock(b.from)}`));
    for (const [a, b] of f.tight) parts.push(el("p", "smart-note", `⏱ Tight changeover: ${a.name || a.session} ends ${a.to ? clock(a.to) : ""}, ${b.name || b.session} starts ${clock(b.from)}`));
    // Free slots, each one tap from a booking link
    if (f.free.length) {
      const row = el("div", "free-slots");
      row.appendChild(el("span", "smart-label", "Free"));
      for (const [from, to] of f.free) {
        const slot = el("button", "chip free-slot", `${hm(from)}–${hm(to)}`);
        slot.type = "button";
        slot.title = "Get a booking link for this time";
        slot.addEventListener("click", () => askAbout("customer", `Get me a booking link for ${name} at ${hm(from)} (free until ${hm(to)}) to send to a client. Which sessions fit?`));
        row.appendChild(slot);
      }
      parts.push(row);
    } else if (calPicked >= dayKey(new Date())) parts.push(el("p", "smart-note", "Fully booked within opening hours."));
    // What to show, and Ask Nova
    const tools = el("div", "smart-tools");
    const filters = el("div", "chips");
    for (const [id, label] of [["all", "All"], ["bookings", "Bookings"], ["quests", "Quests"], ["notes", "Notes"]]) {
      const c = el("button", "chip" + (calFilter === id ? " active" : ""), label);
      c.type = "button";
      c.addEventListener("click", () => {
        calFilter = id;
        drawDay();
      });
      filters.appendChild(c);
    }
    const ask = el("button", "chip smart-ask", "✦ Ask Nova about this day");
    ask.type = "button";
    ask.addEventListener("click", () => askAbout("nova", `What's on ${name}? Anything I should know: who's in, what's paid, clashes, and free time.`));
    tools.append(filters, ask);
    parts.push(tools);
    redraw(box, calPicked + calFilter, parts);
  }

  function bookingsOn(key) {
    return calBookings.filter((b) => dayKey(b.from) === key).sort((a, b) => a.from - b.from);
  }

  // Draw the month grid. `slide` is "left" or "right" when changing month.
  function drawMonth(slide) {
    // The month's name ("October 2026")
    const first = new Date(Date.UTC(calMonth.year, calMonth.month, 1, 12));
    $("cal-month").textContent = first.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
    // How many blank days before the 1st (weeks start on Monday)
    const lead = (first.getUTCDay() + 6) % 7;
    // How many days in the month
    const days = new Date(Date.UTC(calMonth.year, calMonth.month + 1, 0)).getUTCDate();
    // Today
    const today = dayKey(new Date());
    // The cells: blanks, then one per day, then blanks to finish the last week
    const cells = [];
    // Blanks before
    for (let i = 0; i < lead; i++) cells.push(el("span", "cal-blank"));
    // One per day
    for (let d = 1; d <= days; d++) {
      // This day as "2026-10-22"
      const key = calMonth.year + "-" + String(calMonth.month + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      // Its bookings
      const list = bookingsOn(key);
      // The day's button
      const cell = el("button", "cal-day");
      cell.type = "button";
      // Today, the picked day, busy days and past days look different
      if (key === today) cell.classList.add("today");
      if (key === calPicked) cell.classList.add("picked");
      if (list.length) cell.classList.add("busy");
      // How full the day is, as a glow (and "full" when nearly all opening hours are booked)
      if (list.length) {
        const load = dayFacts(key).load;
        cell.style.setProperty("--load", load.toFixed(2));
        cell.classList.add("loaded");
        if (load >= 0.85) cell.classList.add("full");
      }
      if (key < today) cell.classList.add("past");
      // Read out properly by screen readers
      cell.setAttribute("aria-label", d + " " + $("cal-month").textContent + (list.length ? ", " + list.length + (list.length === 1 ? " booking" : " bookings") : ""));
      // The date number
      cell.appendChild(el("span", "cal-num", d));
      // A coloured dot per booking (up to three, then "+2")
      const dots = el("span", "cal-dots");
      list.slice(0, 3).forEach((b) => {
        const dot = el("i");
        dot.style.background = sessionColour(b.session);
        dots.appendChild(dot);
      });
      if (list.length > 3) dots.appendChild(el("b", "", "+" + (list.length - 3)));
      // A lilac dot when Calendar or Quests have something that day
      if (suiteOn(key).length) {
        const dot = el("i", "suite-dot");
        dot.style.background = "#c7a4ff";
        dots.appendChild(dot);
        cell.classList.add("busy");
      }
      cell.appendChild(dots);
      // Tapping it picks the day
      cell.addEventListener("click", () => {
        calPicked = key;
        drawMonth();
        drawDay(true);
      });
      cells.push(cell);
    }
    // Blanks after, to finish the week
    while (cells.length % 7) cells.push(el("span", "cal-blank"));
    // Put them in
    const grid = $("cal-grid");
    // (the same month drawn again is left as it is)
    if (!redraw(grid, "", cells) && !slide) return;
    // Slide in from the side when the month changes
    grid.classList.remove("from-left", "from-right");
    if (slide && !calm()) {
      void grid.offsetWidth; // restart the animation
      grid.classList.add(slide === "left" ? "from-left" : "from-right");
    }
  }

  // Draw the picked day's bookings under the calendar
  function drawDay(animate) {
    // The picked day as a date
    const date = new Date(calPicked + "T12:00:00Z");
    // Its name ("Thursday 22 October")
    const name = date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
    // Its bookings
    const list = bookingsOn(calPicked);
    // The heading
    setText("cal-day-title", name + (list.length ? " · " + list.length + (list.length === 1 ? " booking" : " bookings") : ""));
    // The list (drawn only when it changes; a day picked by hand fades in once)
    const box = $("cal-day-list");
    const put = (...nodes) => {
      if (redraw(box, calPicked + calFilter, nodes) && animate) enter(box);
    };
    // The smart parts: this week, and this day
    drawSmartWeek();
    drawSmartDay();
    // Calendar's cards and Quests that day, after the bookings (as the filter says)
    const suite = suiteOn(calPicked).filter((i) => calFilter === "all" || (calFilter === "quests" ? i.kind === "quest" : calFilter === "notes" ? i.kind !== "quest" : false));
    if (calFilter !== "all" && calFilter !== "bookings") {
      return put(...(suite.length ? suite.map(suiteCard) : [el("p", "empty", calFilter === "quests" ? "No quests this day." : "No Calendar cards this day.")]));
    }
    // The bookings aren't here yet: hold their place (or say why they can't come)
    if (!list.length && calProblem) return put(el("p", "empty", calProblem), ...suite.map(suiteCard));
    if (!list.length && !calLoaded) return put(el("div", "skeleton"), ...suite.map(suiteCard));
    if (calFilter === "bookings" && !list.length) return put(el("p", "empty", "No bookings this day."));
    if (calFilter === "bookings") return put(...list.map(calCard));
    if (suite.length) return put(...list.map(calCard), ...suite.map(suiteCard));
    // None that day: say so, and offer the next booking
    if (!list.length) {
      // The next booking after that day
      const next = calBookings.filter((b) => dayKey(b.from) > calPicked).sort((a, b) => a.from - b.from)[0];
      // The message
      const empty = el("div", "empty");
      empty.appendChild(el("p", "", "No bookings this day."));
      // A button to jump to the next booking
      if (next) {
        const jump = el("button", "chip", "Next: " + next.from.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" }) + " · " + (next.name || next.session));
        jump.type = "button";
        jump.addEventListener("click", () => pickDay(dayKey(next.from)));
        empty.appendChild(jump);
      }
      return put(empty);
    }
    // One card per booking
    put(...list.map(calCard));
  }

  // Jump to a day (changing month if needed)
  function pickDay(key) {
    // The month it's in
    const month = { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) - 1 };
    // Which way to slide
    const slide = month.year * 12 + month.month > calMonth.year * 12 + calMonth.month ? "right" : month.year * 12 + month.month < calMonth.year * 12 + calMonth.month ? "left" : null;
    // Show it
    calMonth = month;
    calPicked = key;
    drawMonth(slide);
    drawDay(true);
  }

  // One booking, as a card
  function calCard(b) {
    // The card, edged in the session's colour
    const card = el("article", "card cal-card");
    card.style.setProperty("--c", sessionColour(b.session));
    // The time ("14:15 – 16:15")
    card.appendChild(el("p", "cal-time", clock(b.from) + (b.to ? " – " + clock(b.to) : "")));
    // The customer's name, then the session
    card.appendChild(el("h3", "card-title", b.name || "Booking"));
    card.appendChild(el("p", "cal-session", b.session || ""));
    // Price, phone, email and any form answers, coloured
    const lines = [b.price && "Price: " + b.price, b.phone && "Phone: " + b.phone, b.email && "Email: " + b.email, ...(b.extra || []).map(([l, v]) => l + ": " + v)].filter(Boolean);
    if (lines.length) card.appendChild(richDetails(lines.join("\n")));
    // Buttons: call, email, open in Acuity
    const actions = el("div", "actions");
    if (b.phone) {
      const call = el("a", "btn small", "Call");
      call.href = "tel:" + b.phone.replace(/[^0-9+]/g, "");
      actions.appendChild(call);
    }
    if (b.email) {
      const email = el("a", "btn small ghost", "Email");
      email.href = "mailto:" + encodeURIComponent(b.email);
      actions.appendChild(email);
    }
    // A booking made with Nova Bot's own system opens in Google Calendar; anything else in Acuity
    const acuity = el("a", "btn small ghost", b.link ? "Open in Google Calendar" : "Open in Acuity");
    Object.assign(acuity, { href: b.link || "https://secure.acuityscheduling.com/appointments.php", target: "_blank", rel: "noopener" });
    actions.appendChild(acuity);
    card.appendChild(actions);
    // Hand it back
    return card;
  }

  // Change month (+1 next, -1 previous)
  function changeMonth(step) {
    // Move the month
    const total = calMonth.year * 12 + calMonth.month + step;
    calMonth = { year: Math.floor(total / 12), month: total % 12 };
    // Draw it, sliding in from the right side
    drawMonth(step > 0 ? "right" : "left");
  }

  // The arrows and "Today"
  $("cal-prev").addEventListener("click", () => changeMonth(-1));
  $("cal-next").addEventListener("click", () => changeMonth(1));
  $("cal-today").addEventListener("click", () => pickDay(dayKey(new Date())));

  // Swipe left or right on the month to change it
  let swipeFrom = null;
  $("cal-grid").addEventListener("touchstart", (e) => (swipeFrom = e.touches[0].clientX), { passive: true });
  $("cal-grid").addEventListener("touchend", (e) => {
    // How far the finger moved sideways
    const moved = swipeFrom === null ? 0 : e.changedTouches[0].clientX - swipeFrom;
    swipeFrom = null;
    // Far enough to count as a swipe
    if (Math.abs(moved) > 50) changeMonth(moved < 0 ? 1 : -1);
  });

  // ===== Quests =====
  // Nova Agent (on the studio computer) sends its plan here every time it
  // changes. Taps (Done, Start, Not now...) go back to it, usually within a second.

  // Which part is showing: today, missions, or every quest
  let questTab = "today";
  // The last plan we got (for redrawing without asking again)
  let lastQuests = null;

  // "14:30" from "2026-10-09T14:30" (with seconds if it has them)
  const hhmm = (s) => (s ? s.slice(11, s.length > 16 ? 19 : 16) : "");
  // "30 s", "45 min", "1 h 30 min", "3 days 4 h"; repeats: "∞ · 30 s every 2 min"
  function length(q) {
    const plain = (minutes) => {
      const secs = Math.round(minutes * 60);
      if (secs < 60) return secs + " s";
      const m = Math.floor(secs / 60), s = secs % 60;
      if (m < 60) return s ? `${m} min ${s} s` : `${m} min`;
      const h = Math.floor(m / 60), mm = m % 60;
      if (h < 48) return mm ? `${h} h ${mm} min` : `${h} h`;
      return `${Math.floor(h / 24)} days ${h % 24 ? (h % 24) + " h" : ""}`.trim();
    };
    if (!q.ongoing) return plain(q.minutes);
    const every = q.every === "interval" ? "every " + plain(q.everyMinutes) : q.every === "week" ? "a week" : q.every === "weekday" ? "each weekday" : "a day";
    return `∞ · ${plain(q.minutes)} ${every}`;
  }
  // A day's name: "Wednesday 7 October"
  const dayName = (ymd) => new Date(ymd + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

  // Whose quests: your own (the default), or everyone's (admins: the Mine / Everyone chips)
  let questWho = "mine";
  try {
    if (localStorage.getItem("portal/quests-who") === "everyone") questWho = "everyone";
  } catch (err) {}
  // Someone else's: their name (Nova Agent sends whose each one is)
  const ownerLabel = (x) => {
    const st = lastQuests && lastQuests.state;
    if (!x || !x.owner || !lastQuests || lastQuests.scope !== "everyone" || x.owner === lastQuests.me) return "";
    const person = st && st.people && st.people[x.owner];
    return (x.ownerName || (person && person.name) || "Someone") + "’s";
  };
  function drawWho() {
    const box = $("quests-who");
    if (!box) return;
    box.hidden = !(lastQuests && lastQuests.canSeeEveryone);
    const shown = lastQuests && lastQuests.scope === "everyone" ? "everyone" : "mine";
    box.querySelectorAll("[data-quests-who]").forEach((c) => c.classList.toggle("active", c.dataset.questsWho === shown));
  }

  // Get the plan and draw the open part
  async function loadQuests() {
    try {
      const data = await api(questWho === "everyone" ? "quests?who=everyone" : "quests");
      lastQuests = data;
      drawWho();
      drawQuests();
    } catch (err) {
      if (err.message !== "signed out" && currentView === "quests") emptyState($("quests-body"), err.message);
    }
  }

  // Send a tap to Nova Agent, then look again a moment later
  async function questTap(id, action, kind = "quest", minutes, session, mode) {
    try {
      await api("quests/action", { body: { id, action, kind, minutes, session, mode } });
      toast(lastQuests && lastQuests.online ? "Sent to Nova Agent" : "Sent: Nova Agent will do it when it's back online");
      setTimeout(loadQuests, 1500);
      setTimeout(loadQuests, 4000);
    } catch (err) {
      if (err.message !== "signed out") toast(err.message);
    }
  }

  // A small button
  function questButton(label, onClick, primary) {
    const b = el("button", "btn small" + (primary ? "" : " ghost"), label);
    b.type = "button";
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      b.disabled = true;
      onClick();
      // (the card is only drawn again if the quest changes: ready again for another try)
      setTimeout(() => (b.disabled = false), 5000);
    });
    return b;
  }

  // The buttons for one quest, depending on where it's at
  function questButtons(q) {
    const row = el("div", "actions");
    if (q.status === "todo") row.appendChild(questButton("▶ Start", () => questTap(q.id, "start"), true));
    if (q.status !== "done") row.appendChild(questButton(q.ongoing ? "✓ Session done" : "✓ Done", () => questTap(q.id, "done", "quest", undefined, q.start), q.status === "doing"));
    if (q.status === "doing") row.appendChild(questButton("+15 min", () => questTap(q.id, "snooze", "quest", 15)));
    if (q.status === "todo" && !q.ongoing) row.appendChild(questButton("Not now", () => questTap(q.id, "snooze", "quest", 60)));
    if (q.status === "todo" && !q.ongoing) row.appendChild(questButton("Skip", () => questTap(q.id, "skip")));
    if (q.ongoing && q.status !== "done") row.appendChild(questButton("Stop", () => questTap(q.id, "finish")));
    if (q.status === "done" || q.status === "skipped") row.appendChild(questButton("Undo", () => questTap(q.id, "reopen")));
    return row;
  }

  // One quest as a card
  function questCard(q, missions, big) {
    // The whole card wears its mode's colour (Waiting, Soon, Working On It...: /shared/quest-modes.css)
    const mode = q.mode || (q.status === "done" ? "done" : q.status === "doing" ? "working" : "waiting");
    const card = el("article", "card quest-card " + q.status + (q.atRisk ? " risk" : "") + (big ? " now" : "") + " qm-tinted qm-" + mode);
    const mission = missions.find((m) => m.id === q.missionId);
    card.dataset.key = "q" + q.id + (big ? ":now" : "");
    card.dataset.sig = sig(q, mission && mission.title);
    // Every quest says so: "✦ Quest" (with where it's at for the big one), and its mission
    const tags = el("div", "q-tags");
    tags.appendChild(el("span", "q-tag", (q.ongoing ? "∞ Quest · repeat" : "✦ Quest") + (big ? (q.status === "doing" ? " · in progress" : " · up next") : "")));
    if (mission) tags.appendChild(el("span", "m-tag", "◆ " + mission.title));
    if (q.from) tags.appendChild(el("span", "m-tag", "✎ " + q.from));
    // Someone else's (an admin looking at everyone's): whose it is
    const whose = ownerLabel(q);
    if (whose) tags.appendChild(el("span", "m-tag", "◎ " + whose));
    if (q.atRisk && q.status !== "done") tags.appendChild(el("span", "risk-tag", "⚠ At risk"));
    // How it's going: a coloured chip (the same as in Notes and on Nova Agent's front page); tap to change
    if (window.NovaQuestModes) {
      const mode = q.mode || (q.status === "done" ? "done" : q.status === "doing" ? "working" : "waiting");
      const holder = document.createElement("span");
      holder.innerHTML = NovaQuestModes.chip(mode);
      const chip = holder.firstElementChild;
      chip.addEventListener("click", async (e) => {
        e.stopPropagation();
        const picked = await NovaQuestModes.pick(chip, mode);
        if (picked && picked !== mode) questTap(q.id, "mode", "quest", undefined, undefined, picked);
      });
      tags.appendChild(chip);
    }
    card.appendChild(tags);
    const top = el("div", "card-top");
    top.append(el("h3", "card-title", q.title), el("span", "card-meta", q.start ? hhmm(q.start) + "–" + hhmm(q.end) : "not planned yet"));
    card.appendChild(top);
    const bits = [length(q), q.priority];
    if (q.location) bits.push("at " + q.location + (q.travelMinutes ? ` (leave ${hhmm(q.travelStart)})` : ""));
    if (q.deadline) bits.push("due " + q.deadline.replace("T", " "));
    card.appendChild(el("p", "quest-meta", bits.join(" · ")));
    if (q.status !== "done") card.appendChild(questButtons(q));
    return card;
  }

  // Draw the open part of the Quests tab
  function drawQuests() {
    const body = $("quests-body");
    const data = lastQuests;
    if (!data || !data.state) {
      setText("quests-sync", "Nothing from Nova Agent yet. It sends its plan here once it's running the latest version.");
      return reconcile(body, []);
    }
    const st = data.state;
    const ago = data.at ? Math.round((Date.now() - Date.parse(data.at)) / 60000) : null;
    setText("quests-sync", (data.online ? "● Nova Agent is online" : "○ Nova Agent is offline") + (ago !== null ? ` · updated ${ago < 1 ? "just now" : ago + " min ago"}` : ""));
    const missions = st.missions || [];
    const quests = st.quests || [];
    const today = (st.now || "").slice(0, 10);
    const open = quests.filter((q) => q.status === "todo" || q.status === "doing");
    // The badge: quests left today
    const left = open.filter((q) => q.start && q.start.startsWith(today)).length;
    setBadge("quest-badge", left);
    known.add("quests");
    syncCounts();
    // The Calendar tab shows Calendar and quests too: redraw it with the latest
    if (currentView === "calendar" && calMonth) {
      drawMonth();
      drawDay();
    }
    if (currentView !== "quests") return;
    const cards = [];

    if (questTab === "today") {
      const current = st.current || (st.next || [])[0];
      if (current) cards.push(questCard(current, missions, true));
      for (const q of st.pulses || []) {
        const card = el("article", "card quest-card pulse");
        card.dataset.key = "p" + q.id;
        card.dataset.sig = sig(q);
        card.append(el("span", "nova-label quest", "Pulse"), el("h3", "card-title", "∞ " + q.title), el("p", "quest-meta", length(q) + (q.deadline ? " · until " + hhmm(q.deadline) : "")));
        card.appendChild(questButtons(q));
        cards.push(card);
      }
      const todays = quests.filter((q) => q.start && q.start.startsWith(today) && q.status !== "skipped" && (!current || q.id !== current.id)).sort((a, b) => a.start.localeCompare(b.start));
      if (todays.length) cards.push(el("h3", "quest-day", "Today · " + dayName(today)), ...todays.map((q) => questCard(q, missions)));
      const later = open.filter((q) => q.start && q.start.slice(0, 10) > today).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 12);
      let day = "";
      for (const q of later) {
        if (q.start.slice(0, 10) !== day) {
          day = q.start.slice(0, 10);
          cards.push(el("h3", "quest-day", dayName(day)));
        }
        cards.push(questCard(q, missions));
      }
      // Quests with no time yet (from Notes, or waiting for room in the plan)
      const unplanned = open.filter((q) => !q.start && (!current || q.id !== current.id));
      if (unplanned.length) cards.push(el("h3", "quest-day", "Not planned yet"), ...unplanned.map((q) => questCard(q, missions)));
      if (!cards.length) return emptyState(body, "Nothing planned. Ask Nova Agent for a mission, or add a quest.");
    }

    if (questTab === "missions") {
      if (!missions.length) return emptyState(body, "No missions yet. Ask Nova Agent: \"Plan a mission: finish the EP by 1 December\".");
      for (const m of missions) {
        const p = m.progress || { done: 0, total: 0, atRisk: 0, minutesLeft: 0 };
        const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
        const card = el("article", "card mission-card " + m.status);
        card.dataset.key = "m" + m.id;
        card.dataset.sig = sig(m);
        const ring = el("div", "ring", pct + "%");
        ring.style.setProperty("--p", pct);
        const head = el("div", "mission-head");
        const words = el("div", "mission-words");
        words.append(el("h3", "card-title", m.title), el("p", "quest-meta", m.summary || ""));
        head.append(ring, words);
        card.append(el("span", "m-badge", "◆ Mission" + (m.status === "done" ? " · complete" : m.status === "paused" ? " · paused" : "") + (ownerLabel(m) ? " · " + ownerLabel(m) : "")), head);
        if (p.atRisk) card.classList.add("risk");
        card.appendChild(el("p", "quest-meta", [m.deadline ? "Due " + m.deadline.replace("T", " ") : "", `${p.done}/${p.total} quests`, (p.minutesLeft / 60).toFixed(1) + " h left", p.atRisk ? `⚠ ${p.atRisk} at risk` : ""].filter(Boolean).join(" · ")));
        const row = el("div", "actions");
        if (m.status === "active") row.appendChild(questButton("Pause", () => questTap(m.id, "pause", "mission")));
        if (m.status === "paused") row.appendChild(questButton("Resume", () => questTap(m.id, "resume", "mission"), true));
        card.appendChild(row);
        cards.push(card);
      }
    }

    if (questTab === "all") {
      // Every quest, wherever it was made, grouped by how it's going (Waiting first, Done last)
      const live = quests.filter((q) => q.status !== "skipped");
      if (!live.length) return emptyState(body, "No quests yet.");
      const modeOf = (q) => q.mode || (q.status === "done" ? "done" : q.status === "doing" ? "working" : "waiting");
      const order = window.NovaQuestModes ? NovaQuestModes.list.map((m) => m.id) : ["waiting", "soon", "working", "nearly", "longer", "questions", "done"];
      for (const mode of order) {
        const group = live.filter((q) => modeOf(q) === mode).sort((a, b) => (a.start || "z").localeCompare(b.start || "z"));
        if (!group.length) continue;
        const head = el("h3", "quest-day quest-mode-head");
        head.innerHTML = (window.NovaQuestModes ? NovaQuestModes.chip(mode, { tag: "span" }) : mode) + ` <small>${group.length}</small>`;
        cards.push(head, ...group.map((q) => questCard(q, missions)));
      }
      const skipped = quests.filter((q) => q.status === "skipped");
      if (skipped.length) cards.push(el("h3", "quest-day", `Skipped · ${skipped.length}`), ...skipped.map((q) => questCard(q, missions)));
    }
    reconcile(body, cards);
  }

  document.querySelectorAll("[data-quests-who]").forEach((chip) =>
    chip.addEventListener("click", () => {
      questWho = chip.dataset.questsWho === "everyone" ? "everyone" : "mine";
      try {
        localStorage.setItem("portal/quests-who", questWho);
      } catch (err) {}
      document.querySelectorAll("[data-quests-who]").forEach((c) => c.classList.toggle("active", c === chip));
      loadQuests();
    })
  );
  document.querySelectorAll("[data-quests]").forEach((chip) =>
    chip.addEventListener("click", () => {
      questTab = chip.dataset.quests;
      document.querySelectorAll("[data-quests]").forEach((c) => c.classList.toggle("active", c === chip));
      drawQuests();
    })
  );
  // While the Quests tab is open, keep it fresh
  setInterval(() => !document.hidden && currentView === "quests" && loadQuests(), 15000);

  // ===== Ambient music =====
  // Novacane's quiet ambient music (shared/ambient.js). Inside Nova Agent it's the one player
  // for the whole app, so it carries on across panels; it remembers on or off by itself and
  // starts again on the first tap when it was on.
  const music = $("music");
  function musicState(on) {
    for (const b of [music, $("nav-music")]) {
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.classList.toggle("on", on);
    }
  }
  let ambient = null;
  function loadAmbient() {
    if (!ambient)
      ambient = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "/shared/ambient.js";
        script.onload = () => {
          const engine = window.NovaAmbient;
          if (!engine) return reject(new Error("No music here"));
          engine.onchange = musicState;
          musicState(engine.isPlaying());
          if (window.NovaOptions) engine.setVolume(window.NovaOptions.get().volume / 100);
          resolve(engine);
        };
        script.onerror = () => reject(new Error("Couldn't load the music"));
        document.head.appendChild(script);
      });
    return ambient;
  }
  // Ready a moment after the first screen, so a tap starts it straight away
  setTimeout(() => loadAmbient().catch(() => {}), window.top !== window ? 0 : 2500);
  music.addEventListener("click", async () => {
    try {
      const on = await (await loadAmbient()).toggle();
      toast(on ? "Ambient music on ✦" : "Ambient music off");
    } catch (err) {
      toast(err.message);
    }
  });

  // ===== Alerts =====
  // A copy of every notification that went through to a phone, newest first.
  // Like the pile of letters on the doormat: the badge counts the unopened ones.

  // The newest alert he has already seen (remembered on this phone only)
  function seenAlert() {
    // Read it, or 0 if this phone hasn't seen any yet (or can't remember)
    try {
      // The number saved last time
      return Number(localStorage.getItem("nova-seen-alert")) || 0;
    } catch (err) {
      // This phone can't remember things: treat everything as unseen
      return 0;
    }
  }

  // Remember the newest alert he has now seen
  function markAlertsSeen(id) {
    // Save it, ignoring phones that can't
    try {
      // Write it down
      localStorage.setItem("nova-seen-alert", String(id));
    } catch (err) {}
  }

  // Get the alerts, update the badge, and show the list if the Alerts tab is open
  async function loadAlerts() {
    // The list on the page
    const list = $("alert-list");
    // Try it, and show any problem in the list
    try {
      // Ask the Worker for the alerts and the auto-delete setting
      const { notifications, autoDeleteDays, choices } = await api("notifications");
      // Show the auto-delete switch's setting
      showAutoDelete(autoDeleteDays, choices);
      // Keep the list for voice commands ("call Eric")
      lastAlerts = notifications;
      // Is the Alerts tab the one on screen?
      const looking = currentView === "alerts";
      // He's looking at them: they count as seen
      if (looking && notifications.length) markAlertsSeen(notifications[0].id);
      // How many are newer than the last one he saw
      const unseen = notifications.filter((n) => n.id > seenAlert()).length;
      // Show the number on the tab, or hide it when there are none
      setBadge("alert-badge", unseen);
      known.add("alerts");
      syncCounts();
      // Not on the Alerts tab: the badge is all we needed
      if (!looking) return;
      // Nothing yet: say so
      if (!notifications.length) return emptyState(list, "No alerts yet. New enquiries and bookings appear here once they've reached a phone.");
      // One card per alert (only new or changed ones are drawn), and the "ago" times brought up to date
      reconcile(list, notifications.map(alertCard));
      list.querySelectorAll(".alert-when[data-at]").forEach((p) => setTimeText(p, p.dataset.at));
      list.querySelectorAll(".al-ago[data-at]").forEach((p) => (p.textContent = ago(p.dataset.at)));
      // (a card kept open by the redraw says so on its button)
      list.querySelectorAll(".card.open .al-more").forEach((b) => b.setAttribute("aria-expanded", "true"));
    } catch (err) {
      // Show the problem (unless he's just been signed out)
      if (err.message !== "signed out" && currentView === "alerts") emptyState(list, err.message);
    }
  }

  // Which Nova app an alert came from (from the start of its title), or null
  function novaSource(title) {
    // The three Nova apps that send alerts, and their colour names
    const sources = [["Quest: ", "quest"], ["Mission: ", "mission"], ["Nova Agent: ", "agent"]];
    // Find the one the title starts with
    const found = sources.find(([prefix]) => String(title).startsWith(prefix));
    // Its name (without the colon) and colour, or nothing
    return found ? { name: found[0].slice(0, -2), key: found[1] } : null;
  }

  // The label for each kind of alert
  const KIND_LABELS = { booking: "Booking · Acuity", "nova-booking": "Booking · Nova", enquiry: "Enquiry", quest: "Quest", mission: "Mission", agent: "Nova Agent", health: "Acuity connection", test: "Test", other: "Alert" };

  // "Tue 6 Oct 2026 · 21:02:40" (UK time, to the second)
  function exactTime(iso) {
    const d = new Date(iso);
    const day = d.toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", year: "numeric" });
    const time = d.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return `${day} · ${time}`;
  }
  // "just now", "3 min ago", "2 h ago", "yesterday", "4 days ago"
  function ago(iso) {
    const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + " min ago";
    const hours = Math.round(mins / 60);
    if (hours < 24) return hours + " h ago";
    const days = Math.round(hours / 24);
    return days === 1 ? "yesterday" : days + " days ago";
  }

  // "Tue 6 Oct 2026 · 21:02:40 · 3 min ago", or just "3 min ago" (Options), on an alert
  function setTimeText(node, iso) {
    const text = window.NovaOptions && window.NovaOptions.get().times === "ago" ? ago(iso) : exactTime(iso) + " · " + ago(iso);
    if (node.textContent !== text) node.textContent = text;
  }

  // What Acuity said about each booking (asked once per visit), and the answers that came back
  const verified = new Map();
  const verifiedAnswer = new Map();
  // A panel that checks the booking with Acuity when it comes into view
  function verifyPanel(id) {
    const box = el("div", "verify checking");
    box.append(el("p", "verify-title", "Checking with Acuity…"), el("div", "verify-lines"));
    // Fill it in with what Acuity says
    const fill = (r) => {
      box.className = "verify " + r.status;
      const icon = { real: "✓ ", cancelled: "✕ ", missing: "⚠ " }[r.status] || "";
      box.querySelector(".verify-title").textContent = icon + r.title;
      box.querySelector(".verify-lines").replaceChildren(...(r.lines || []).map((line) => el("span", "", line)));
    };
    // Already known: shown straight away (no "Checking…" every time the list is refreshed)
    if (verifiedAnswer.has(id)) {
      fill(verifiedAnswer.get(id));
      return box;
    }
    const check = () => {
      if (!verified.has(id))
        verified.set(
          id,
          api("verify-booking?id=" + encodeURIComponent(id))
            .catch((err) => ({ status: "unknown", title: err.message, lines: [] }))
            .then((r) => (verifiedAnswer.set(id, r), r))
        );
      verified.get(id).then(fill);
    };
    // Only ask Acuity about bookings that are actually on screen
    if ("IntersectionObserver" in window) {
      const seen = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          seen.disconnect();
          check();
        }
      });
      seen.observe(box);
    } else check();
    return box;
  }

  // Changing how times show (in Options) redraws the Alerts straight away
  window.addEventListener("novaoptionschange", () => currentView === "alerts" && loadAlerts());

  // One alert, drawn as a card
  function alertCard(n) {
    // The card (with room for its delete button)
    const card = el("article", "card has-delete");
    // The delete button in the corner
    const remove = el("button", "card-delete", "×");
    // Labelled for screen readers
    Object.assign(remove, { type: "button", title: "Delete this alert" });
    remove.setAttribute("aria-label", "Delete this alert");
    // Delete it when tapped
    remove.addEventListener("click", () => deleteAlert(n.id));
    // What it's about, as a coloured label ("Booking", "Quest", "Test"...)
    const kind = n.kind || "other";
    card.classList.add("kind-" + kind);
    // The top: the title
    const top = el("div", "card-top");
    top.append(el("h3", "card-title", n.title));
    // When it was sent: the exact moment (to the second) and how long ago (kept up to date in place)
    const exact = el("p", "alert-when");
    exact.dataset.at = n.created_at;
    setTimeText(exact, n.created_at);
    card.dataset.key = "a" + n.id;
    card.dataset.sig = sig(n, window.NovaOptions && window.NovaOptions.get().times);
    // One slim line until it's opened (22 Oct 2026, the user: "shrink the alert blocks so they can all
    // fit on the same screen"): its kind, its title and how long ago; a tap opens the whole card in place
    // (and the card stays open when the list refreshes: reconcile keeps "open")
    const line = el("div", "al-line");
    const agoText = el("span", "al-ago", ago(n.created_at));
    agoText.dataset.at = n.created_at;
    const more = el("button", "al-more", "▾");
    more.type = "button";
    more.setAttribute("aria-label", "Open this alert: " + n.title);
    more.setAttribute("aria-expanded", "false");
    line.append(el("span", "alert-kind " + kind, KIND_LABELS[kind] || "Alert"), el("span", "al-title", n.title), agoText, more);
    line.title = n.title;
    line.addEventListener("click", (e) => {
      if (e.target.closest("a") || (e.target.closest("button") && e.target.closest("button") !== more)) return;
      const opened = card.classList.toggle("open");
      more.setAttribute("aria-expanded", String(opened));
      more.setAttribute("aria-label", (opened ? "Close this alert: " : "Open this alert: ") + n.title);
    });
    card.append(line);
    // Then every detail (coloured), and how many phones it reached
    card.append(remove, el("span", "alert-kind " + kind, KIND_LABELS[kind] || "Alert"), top, exact, richDetails(n.body), el("p", "card-foot", `Alert #${n.id} · delivered to ${n.phones} ${n.phones === 1 ? "phone" : "phones"}`));
    // A booking in Acuity: check it with Acuity itself, so a real booking can't be mistaken for a test or a fake
    if (kind === "booking" && n.appointmentId) card.insertBefore(verifyPanel(n.appointmentId), exact.nextSibling);
    // A test: say plainly that it isn't a real booking
    if (kind === "test") card.insertBefore(el("p", "verify unknown", "A test notification: not a real booking or enquiry."), exact.nextSibling);
    // The latest from Acuity's email about this booking (if one has come through)
    if (n.email) card.appendChild(emailPanel(n.email));
    // A row of buttons
    const actions = el("div", "actions");
    // Alerts from Nova Agent, Quest and Mission: nothing to open
    const nova = novaSource(n.title);
    if (nova) {
      // Mark the card with its colour
      card.classList.add("nova-alert", nova.key);
      // No buttons: the card is the whole message
      return card;
    }
    // Enquiry alerts open the Enquiries tab; booking alerts open Acuity; invoice alerts (an invoice,
    // reminder or receipt to approve) open the Invoicer on that invoice (19 Oct 2026: older ones still
    // say /portal/?view=money&invoice=N)
    const invoiceAt = /^\/invoicer\//.test(n.url) ? n.url : /[?&]view=money\b/.test(n.url) ? "/invoicer/" + (/[?&]invoice=(\d+)/.test(n.url) ? "?invoice=" + n.url.match(/[?&]invoice=(\d+)/)[1] : "") : "";
    const inHere = /^\/(app|portal)\//.test(n.url) && !invoiceAt;
    const open = el(inHere || invoiceAt ? "button" : "a", "btn small", invoiceAt ? "Open in Invoicer" : inHere ? "Open enquiry" : /acuityscheduling/.test(n.url) ? "Open in Acuity" : "Open in Google Calendar");
    if (invoiceAt) open.addEventListener("click", () => (window.NovaAgent && window.NovaAgent.open ? window.NovaAgent.open(invoiceAt) : window.parent !== window && window.parent.NovaAgent ? window.parent.NovaAgent.open(invoiceAt) : (location.href = "/agent/?open=" + encodeURIComponent(invoiceAt))));
    // An enquiry: switch tabs when tapped
    else if (inHere) open.addEventListener("click", () => window.PortalPage.go("/portal/?view=enquiries", { replace: true }));
    // A booking: a link to Acuity, opened outside the app
    else Object.assign(open, { href: n.url, target: "_blank", rel: "noopener" });
    // Add it to the row
    actions.appendChild(open);
    // The customer's email, if we know it: an Email button
    if (n.contact.email) {
      // The button
      const email = el("a", "btn small ghost", "Email");
      // Opens a new email to them
      email.href = "mailto:" + encodeURIComponent(n.contact.email);
      // Add it to the row
      actions.appendChild(email);
    }
    // Their phone number, if we know it: a Call button
    if (n.contact.phone) {
      // The button
      const call = el("a", "btn small ghost", "Call");
      // Rings the number (digits and + only)
      call.href = "tel:" + n.contact.phone.replace(/[^0-9+]/g, "");
      // Add it to the row
      actions.appendChild(call);
    }
    // The email in Gmail, if we know where it is
    if (n.email && n.email.gmail) {
      // The button
      const gmail = el("a", "btn small ghost", "Open in Gmail");
      // Opens the email (outside the app)
      Object.assign(gmail, { href: n.email.gmail, target: "_blank", rel: "noopener" });
      // Add it to the row
      actions.appendChild(gmail);
    }
    // Put the buttons on the card
    card.appendChild(actions);
    // Hand the card back
    return card;
  }

  // The "From Acuity" box on a booking alert (its calendar or its email)
  function emailPanel(email) {
    // The box
    const box = el("div", "email-panel");
    // What kind of email it was, in plain words
    const kind = { scheduled: "booking", rescheduled: "move", canceled: "cancellation" }[email.kind] || "update";
    // Its heading: where the details came from, and when
    const head = email.source === "booking" ? "Booking now" : email.source === "calendar" ? "From Acuity's calendar" : "From Acuity's " + kind + " email";
    box.appendChild(el("p", "email-head", head + " · " + when(email.at)));
    // Every detail, unless the alert's own text above already shows exactly the same
    if (!email.same) box.appendChild(richDetails(email.lines.join("\n")));
    // Hand the box back
    return box;
  }

  // Delete one alert
  async function deleteAlert(id) {
    // Try it
    try {
      // Ask the Worker to delete it
      await api("notifications/delete", { body: { id } });
      // Let them know
      toast("Alert deleted");
      // Show the list without it
      loadAlerts();
    } catch (err) {
      // Something went wrong
      if (err.message !== "signed out") toast(err.message);
    }
  }

  // Delete every alert (after checking)
  async function deleteAllAlerts() {
    // Nothing to delete
    if (!lastAlerts.length) return toast("No alerts to delete");
    // Make sure
    if (!confirm("Delete all " + lastAlerts.length + " alerts?")) return;
    // Try it
    try {
      // Ask the Worker to delete them all
      await api("notifications/delete", { body: { all: true } });
      // Let them know
      toast("All alerts deleted");
      // Show the empty list
      loadAlerts();
    } catch (err) {
      // Something went wrong
      if (err.message !== "signed out") toast(err.message);
    }
  }

  // "Delete all" button
  $("alerts-clear").addEventListener("click", deleteAllAlerts);

  // Show the auto-delete switch as it's set (days = 0 means off)
  function showAutoDelete(days, choices) {
    // The day choices, filled in once
    const select = $("auto-delete-days");
    // Not filled in yet: add one option per choice
    if (!select.options.length) {
      select.replaceChildren(
        ...choices.map((d) => {
          // "1 day", "7 days"
          const option = el("option", "", d + (d === 1 ? " day" : " days"));
          // Its number
          option.value = d;
          // Hand it back
          return option;
        })
      );
      // Default choice when the switch is first turned on: 7 days
      select.value = "7";
    }
    // The switch: on or off
    $("auto-delete").checked = days > 0;
    // When it's on, show the chosen number of days
    if (days > 0) select.value = String(days);
    // The day choice only matters when the switch is on
    select.disabled = !(days > 0);
  }

  // Save the auto-delete setting (0 = off)
  async function saveAutoDelete(days) {
    // Try it
    try {
      // Tell the Worker
      await api("notifications/settings", { body: { days } });
      // Let them know
      toast(days ? "Alerts delete themselves after " + days + (days === 1 ? " day" : " days") : "Alerts are kept (90 days)");
      // Show the list as it is now
      loadAlerts();
    } catch (err) {
      // Something went wrong
      if (err.message !== "signed out") toast(err.message);
    }
  }

  // Flipping the switch
  $("auto-delete").addEventListener("change", () => saveAutoDelete($("auto-delete").checked ? Number($("auto-delete-days").value) : 0));
  // Choosing a different number of days (only while the switch is on)
  $("auto-delete-days").addEventListener("change", () => $("auto-delete").checked && saveAutoDelete(Number($("auto-delete-days").value)));

  // ===== Ask NovaBot =====

  function addBubble(text, me) {
    const bubble = el("div", "bubble" + (me ? " me" : ""));
    linkify(bubble, text);
    // NovaBot's answer arriving: a soft two-note chime (not for "is typing…")
    if (!me && !/typing…$/.test(text) && window.NovaSfx) window.NovaSfx.play("message");
    $("bot-messages").appendChild(bubble);
    bubble.scrollIntoView({ block: "end", behavior: "smooth" });
    return bubble;
  }

  function fitInput() {
    const box = $("bot-input");
    box.style.height = "auto";
    box.style.height = box.scrollHeight + 2 + "px";
  }

  // Which assistant the tab talks to: "nova" (knows the studio's bookings,
  // enquiries and alerts) or "customer" (the website's NovaBot, for testing)
  let botMode = "nova";

  // Switching between them starts a new chat
  // (only the Website bot's own chips: the enquiry reply box has Reply, WhatsApp, Text and Note chips too, 19 Oct 2026)
  document.querySelectorAll("#view-bot [data-mode]").forEach((chip) =>
    chip.addEventListener("click", () => {
      // Remember the choice
      botMode = chip.dataset.mode;
      // Light up the chosen chip
      document.querySelectorAll("#view-bot [data-mode]").forEach((c) => c.classList.toggle("active", c === chip));
      // Explain what this one does
      $("bot-hint").textContent =
        botMode === "nova"
          ? 'Ask about your bookings, enquiries and alerts: "What time is Eric\'s session?", "Any new enquiries?". These chats aren\'t saved.'
          : 'NovaBot with the booking tools, talking to you as staff: "Get me a link for a 2-hour vocal session for Dana", "Move Eric\'s Thursday session to 3pm". These chats aren\'t saved.';
      // Start a fresh chat
      $("bot-clear").click();
    })
  );

  async function askNovaBot() {
    const box = $("bot-input");
    const text = box.value.trim();
    if (!text) return;
    box.value = "";
    fitInput();
    addBubble(text, true);
    botHistory.push({ role: "user", content: text });
    const typing = addBubble((botMode === "nova" ? "Nova" : "NovaBot") + " is typing…", false);
    typing.classList.add("typing");
    try {
      // Nova answers from the studio's data; NovaBot as it would for a customer
      const reply =
        botMode === "nova"
          ? (await api("ask", { body: { question: text, history: botHistory.slice(0, -1) } })).answer
          : (await api("chat", { body: { messages: botHistory } })).reply;
      typing.remove();
      addBubble(reply, false);
      botHistory.push({ role: "assistant", content: reply });
    } catch (err) {
      typing.remove();
      botHistory.pop();
      if (err.message !== "signed out") addBubble("Couldn't reach NovaBot: " + err.message, false);
    }
  }

  $("bot-form").addEventListener("submit", (e) => {
    e.preventDefault();
    askNovaBot();
  });
  $("bot-input").addEventListener("input", fitInput);
  $("bot-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      askNovaBot();
    }
  });
  // "Ask Agent instead": the same as Agent in the side menu
  $("bot-agent").addEventListener("click", () => $("nav-agent").click());
  $("bot-clear").addEventListener("click", () => {
    botHistory.length = 0;
    $("bot-messages").replaceChildren();
    $("bot-input").focus();
  });

  // ===== Notifications =====
  // Like giving the post office your address once: the phone gets a delivery
  // address from Apple, Portal hands it to the Worker, and from then on the
  // Worker can post notifications to it, even when Portal is closed.

  // Can this browser do notifications at all? (needs all three of these.) Not inside Nova
  // Agent on the studio PC: Nova Agent shows its own notices there, and phone pushes are for phones.
  const canNotify = !onStudioPC && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  // Is this an iPhone or iPad?
  const isIPhone = /iPhone|iPad|iPod/.test(navigator.userAgent);
  // Was Portal opened from the Home Screen icon (rather than a Safari tab)?
  const fromHomeScreen = window.navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;

  // The doorman is Nova Agent's own (/sw.js, for the whole app: Portal opens inside Nova Agent).
  // Nova Agent installs it; make sure it's there, and look for a newer one when Portal opens.
  function novaAgentDoorman() {
    return navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  }
  if (canNotify) {
    novaAgentDoorman()
      .then((reg) => {
        reg.update().catch(() => {});
        document.addEventListener("visibilitychange", () => !document.hidden && reg.update().catch(() => {}));
      })
      .catch(() => {});
  }

  // ===== Pings =====
  // When a notification arrives while Portal is open, it rings out with a
  // bright ping (a different one for each kind) and drops a banner from the top.

  // The sound maker (made on the first tap, because phones only allow sound after a tap)
  let sound = null;
  // Make it (or wake it up) on the first tap anywhere
  function wakeSound() {
    // Try it, ignoring phones that can't
    try {
      // Make it the first time
      if (!sound) sound = new (window.AudioContext || window.webkitAudioContext)();
      // Wake it if the phone put it to sleep
      if (sound.state === "suspended") sound.resume();
      // (and back to sleep 10 s after: a running sound maker keeps the phone's audio awake in silence;
      // 22 Oct 2026, battery)
      clearTimeout(wakeSound.sleep);
      wakeSound.sleep = setTimeout(() => sound && sound.state === "running" && sound.suspend().catch(() => {}), 10000);
    } catch (err) {}
  }
  // Listen for that first tap (and later ones, in case the phone sends it back to sleep)
  ["pointerdown", "touchstart", "keydown"].forEach((type) => document.addEventListener(type, wakeSound, { passive: true }));

  // The notes for each kind of ping (in hertz), played one after another
  const PINGS = {
    // A quest is starting or it's time to leave: two bright rising notes
    starting: [1318.5, 1975.5],
    leave: [1174.7, 1568, 2093],
    // A quick repeat: one short, bright tick
    pulse: [2093],
    // A check-in: a quick double ping, twice
    checkin: [1760, 1760, 2349.3, 2349.3],
    // A mission: a sparkling run up
    mission: [1046.5, 1318.5, 1568, 2093, 2637],
    // Nova Agent: one clear, lower bell
    agent: [880, 1318.5],
  };

  // Play a ping: soft bell-like notes, each with a faint shimmer an octave up (quiet and unhurried,
  // so an alert arriving is noticed without a jolt)
  function ping(kind) {
    // Wake the sound maker if it's allowed (asleep: once it's awake, then the ping)
    wakeSound();
    if (sound && sound.state === "suspended" && !ping.waking) {
      ping.waking = true;
      sound.resume().catch(() => {}).finally(() => { ping.waking = false; ping(kind); });
      return;
    }
    // No sound on this phone: just buzz (where phones allow it)
    if (!sound || sound.state !== "running") return navigator.vibrate && navigator.vibrate([200, 100, 200]);
    // The notes to play
    const notes = PINGS[kind] || PINGS.starting;
    // Now, in the sound maker's clock
    const t0 = sound.currentTime + 0.02;
    // Play each note a little after the last
    notes.forEach((freq, i) => {
      // When this note starts
      const t = t0 + i * 0.16;
      // The note and its shimmer
      [[freq, 0.09, "sine"], [freq * 2, 0.018, "sine"]].forEach(([f, loud, wave]) => {
        // The tone
        const osc = sound.createOscillator();
        // Its volume
        const gain = sound.createGain();
        // Set the tone
        osc.type = wave;
        osc.frequency.value = f;
        // A soft strike that rings away, like a bell heard from the next room
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(loud, t + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
        // Wire it up and play it
        osc.connect(gain).connect(sound.destination);
        osc.start(t);
        osc.stop(t + 1.3);
      });
    });
    // A buzz too, on phones that can
    if (navigator.vibrate) navigator.vibrate([180, 80, 180]);
  }

  // Drop a banner from the top of the screen
  function banner(data) {
    // A newer one about the same thing replaces the old banner (quick repeats don't stack up)
    if (data.tag) document.querySelectorAll(".ping-banner").forEach((b) => b.dataset.tag === data.tag && b.remove());
    // The banner
    const box = el("div", "ping-banner " + (data.source || "agent"));
    // Remember what it's about
    box.dataset.tag = data.tag || "";
    // Its title and text
    box.append(el("strong", "", data.title || "Portal"), el("p", "", data.body || ""));
    // Tapping it opens the Alerts tab
    box.addEventListener("click", () => {
      box.remove();
      show("alerts");
    });
    // Put it on the page
    document.body.appendChild(box);
    // Check-ins and problems stay a while; the rest go after 7 seconds
    setTimeout(() => box.classList.add("going"), data.urgent ? 30000 : 7000);
    setTimeout(() => box.remove(), data.urgent ? 30600 : 7600);
  }

  // Messages from the doorman
  if (canNotify) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      // A notification just arrived: ping, show the banner and refresh the Alerts
      if (event.data?.type === "nova-push") {
        // Unless pings are switched off in Options
        if (!window.NovaOptions || window.NovaOptions.get().pings !== false) {
          ping(event.data.kind || event.data.source);
          banner(event.data);
        }
        loadAlerts();
        if (event.data.source === "quest" || event.data.source === "mission") loadQuests();
      }
      // A notification was tapped: show the Alerts tab
      if (event.data?.type === "nova-open" && String(event.data.url).includes("#nova")) window.PortalPage.go("/portal/?view=alerts", { replace: true });
    });
  }

  // Opening Portal clears the dot on its Home Screen icon
  function clearIconDot() {
    // Only where the phone supports it
    if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  }
  // Now, and every time Portal comes back to the front
  clearIconDot();
  document.addEventListener("visibilitychange", () => !document.hidden && clearIconDot());

  // Turn the public key (text) into the raw bytes the phone wants
  function keyBytes(text) {
    // Put back the padding and characters that the web-safe version leaves out
    const base64 = (text + "===".slice((text.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/");
    // Decode it into raw bytes
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  }

  // Phones that installed Portal (from /app/ or /portal/) got their address through
  // that old doorman (/app/sw.js, /portal/sw.js). It's kept: one address per phone, so nothing
  // arrives twice. Everyone else uses Nova Agent's (/sw.js).
  async function pushDoorman() {
    for (const scope of ["/app/", "/portal/"]) {
      const old = await navigator.serviceWorker.getRegistration(scope).catch(() => null);
      if (old && old.scope.endsWith(scope) && (await old.pushManager.getSubscription().catch(() => null))) return old;
    }
    return novaAgentDoorman();
  }

  // This phone's current notification address, if it has one
  async function currentAddress() {
    // No notifications on this browser: no address
    if (!canNotify) return null;
    // The doorman that has (or will get) this phone's address
    const reg = await pushDoorman();
    // Ask for the address the phone already has (or nothing)
    return reg.pushManager.getSubscription();
  }

  // Show the right message and buttons in the notifications panel
  async function updateNotifyPanel() {
    // Does this phone already have an address?
    const address = await currentAddress().catch(() => null);
    // Light the bell up if notifications are on
    $("bell").classList.toggle("on", Boolean(address));
    // The message under the title
    let status = "Get a notification here for new enquiries and bookings.";
    // iPhone in a Safari tab: it has to be opened from the Home Screen first
    if (!canNotify && isIPhone && !fromHomeScreen) {
      status = "On iPhone, notifications only work when Portal is opened from its Home Screen icon. In Safari, tap Share, then Add to Home Screen, then open Portal from there.";
    }
    // Any other browser that can't do it
    else if (!canNotify) status = "This browser can't show notifications.";
    // He said no to the iPhone's question earlier: only Settings can change that now
    else if (Notification.permission === "denied") status = "Notifications are blocked for this app. Turn them on in the iPhone's Settings, then Notifications, then Portal (or Portal or Nova Agent, if you added it to the Home Screen before).";
    // Already on
    else if (address) status = "Notifications are on for this phone.";
    // The server's keys changed and this phone needs one tap to get notifications again
    else if (pushRenewNeeded) status = "Nova's notification keys changed. Tap Turn on notifications once to get them on this phone again.";
    // Put the message in the panel
    $("notify-status").textContent = status;
    // Show "Turn on" only when it can be turned on and isn't already
    $("notify-on").hidden = !canNotify || Boolean(address) || Notification.permission === "denied";
    // Show "Send a test" and "Turn off" only when it's on
    $("notify-test").hidden = !address;
    $("notify-off").hidden = !address;
  }

  // Alerts in one place: the bell opens the Alerts tab; this phone's notifications are a button there
  $("bell").addEventListener("click", () => goView("alerts"));
  $("alerts-notify").addEventListener("click", () => {
    // Show the panel
    $("notify-sheet").hidden = false;
    // Fill it in
    updateNotifyPanel();
  });
  // Close it with the Close button
  $("notify-close").addEventListener("click", () => ($("notify-sheet").hidden = true));
  // Or by tapping outside it
  $("notify-sheet").addEventListener("click", (e) => {
    // Only when the tap was on the dark background, not the panel itself
    if (e.target === $("notify-sheet")) $("notify-sheet").hidden = true;
  });

  // "Turn on notifications" (the iPhone only allows the question after a tap like this)
  $("notify-on").addEventListener("click", async () => {
    // Stop double taps while it works
    $("notify-on").disabled = true;
    // Try it, and report anything that goes wrong
    try {
      // Ask the iPhone's "Allow notifications?" question first, straight from the tap
      const answer = await Notification.requestPermission();
      // He didn't tap Allow: update the panel and stop
      if (answer !== "granted") return updateNotifyPanel();
      // Get our public key from the Worker (it proves the notifications are ours)
      const { publicKey } = await api("push/key");
      // The server hasn't been given its keys yet
      if (!publicKey) throw new Error("Notifications aren't set up on the server yet.");
      // Wait until the doorman is installed
      const reg = await pushDoorman();
      // Ask Apple for this phone's delivery address
      const address = await reg.pushManager.subscribe({
        // iPhone rule: every notification must be shown to him
        userVisibleOnly: true,
        // Our public key, so only our Worker can send to this address
        applicationServerKey: keyBytes(publicKey),
      });
      // Hand the address to the Worker to keep
      await api("push/subscribe", { body: { subscription: address.toJSON() } });
      pushRenewNeeded = false;
      // Let him know it worked
      toast("Notifications are on");
    } catch (err) {
      // Show what went wrong in the panel
      $("notify-status").textContent = "Couldn't turn notifications on: " + err.message;
      // Let him try again
      $("notify-on").disabled = false;
      // Don't overwrite the error message below
      return;
    }
    // Let the button work again next time
    $("notify-on").disabled = false;
    // Show the new state
    updateNotifyPanel();
  });

  // "Send a test": the Worker sends a notification to every signed-up phone
  $("notify-test").addEventListener("click", async () => {
    // Try it
    try {
      // Ask the Worker to send it, and hear how many phones it reached
      const { delivered } = await api("push/test", { body: {} });
      // Report back
      toast(delivered ? "Test sent to " + delivered + (delivered === 1 ? " phone" : " phones") : "No phones got it. Try turning notifications off and on.");
    } catch (err) {
      // Something went wrong
      toast(err.message);
    }
  });

  // "Turn off on this phone"
  $("notify-off").addEventListener("click", async () => {
    // Find this phone's address
    const address = await currentAddress();
    // Only if it has one
    if (address) {
      // Ask the Worker to forget it (ignore problems: we still switch it off below)
      await api("push/unsubscribe", { body: { endpoint: address.endpoint } }).catch(() => {});
      // Tell Apple to cancel the address too
      await address.unsubscribe();
    }
    // Let him know
    toast("Notifications are off on this phone");
    // Show the new state
    updateNotifyPanel();
  });

  // ===== When the server's notification keys change (the switch to the VPS) =====
  // A phone keeps the public key it signed up with, and notifications sent with a new pair of keys
  // can't reach it. So when Portal opens it compares the two: if they differ it quietly gets a new
  // address with the new key (the phone already said Allow), or, when the phone wants a tap for
  // that, says calmly that notifications need turning on again, once.
  let pushRenewChecked = false;
  let pushRenewNeeded = false;
  async function renewPushAddress() {
    if (pushRenewChecked || !canNotify || Notification.permission !== "granted") return;
    pushRenewChecked = true;
    try {
      const address = await currentAddress();
      const had = address && address.options && address.options.applicationServerKey;
      // No address here, or the phone doesn't say which key it has: nothing to compare
      if (!had) return;
      const { publicKey } = await api("push/key");
      if (!publicKey) return;
      const want = keyBytes(publicKey);
      const old = new Uint8Array(had);
      if (old.length === want.length && old.every((b, i) => b === want[i])) return;
      // The doorman that holds the old address gets the new one
      const reg = await pushDoorman();
      await api("push/unsubscribe", { body: { endpoint: address.endpoint } }).catch(() => {});
      await address.unsubscribe().catch(() => {});
      try {
        const fresh = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
        await api("push/subscribe", { body: { subscription: fresh.toJSON() } });
      } catch (err) {
        if (err.message === "signed out") return;
        pushRenewNeeded = true;
        toast("Notifications need turning on again: Alerts, then Turn on notifications");
      }
      updateNotifyPanel();
    } catch (err) {}
  }

  // ===== Voice commands =====
  // Tap the mic, say what to do, and Portal does it. Like asking someone at
  // the front desk: the recording goes to the Worker, which writes down the
  // words (Whisper), and the app matches them to a command below. Anything
  // that isn't a command is asked to NovaBot instead.
  //
  // Hands-free ("Always listen"): while Portal is open on screen, it keeps
  // listening and acts on anything that starts with "Nova" ("Nova, show
  // alerts"), so everyday conversation is ignored. iPhones only allow the
  // microphone while the app is open, so it pauses when you leave and starts
  // again when you come back.

  // Can this browser record sound?
  const canRecord = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  // The microphone while it's open: { stream, context, meter, samples } (or null)
  let mic = null;
  // The recording in progress (or null)
  let recorder = null;
  // Is hands-free switched on (remembered on this phone)?
  let handsFree = false;
  try {
    handsFree = localStorage.getItem("nova-handsfree") === "on";
  } catch (err) {}
  // Is the hands-free loop running right now?
  let looping = false;
  // Hide the mic (and the switch) where recording isn't possible
  if (!canRecord) $("voice").hidden = true;

  // The mic button: with hands-free on, it switches hands-free off;
  // otherwise it listens once (or stops listening)
  $("voice").addEventListener("click", () => {
    // Hands-free is on: turn it off
    if (handsFree) return setHandsFree(false);
    // Listening once already: stop and use what was said
    if (recorder) return stopRecording();
    // Listen once
    listenOnce();
  });
  // The "Done" button: stop listening now
  $("voice-stop").addEventListener("click", () => {
    // Hands-free keeps listening; just close the panel
    if (handsFree) {
      window.speechSynthesis?.cancel();
      return closeVoice();
    }
    // Listening once: stop and use what was said; otherwise close
    recorder ? stopRecording() : closeVoice();
  });
  // The "Always listen" switch in the voice panel
  $("handsfree-switch").addEventListener("change", () => setHandsFree($("handsfree-switch").checked));
  // The "Stop" button on the listening bar
  $("listening-off").addEventListener("click", () => setHandsFree(false));
  // Escape closes whichever sheet is open, the same as its Close (or Done) button
  // (the Options and Nova Agent sheets close themselves: options.js, suite.js)
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    for (const [sheet, close] of [["voice-sheet", "voice-stop"], ["sheet", "sheet-close"], ["phone-sheet", "phone-close"], ["notify-sheet", "notify-close"], ["more-sheet", "more-close"]]) {
      if (!$(sheet).hidden) return $(close).click();
    }
  });

  // Show the listening panel with a message
  function voiceStatus(text, thinking) {
    // Show the panel
    $("voice-sheet").hidden = false;
    // Faster rings while working out the words
    $("voice-sheet").classList.toggle("thinking", Boolean(thinking));
    // The message
    $("voice-status").textContent = text;
    // No answer showing yet
    $("voice-answer").hidden = true;
    // The switch shows whether hands-free is on
    $("handsfree-switch").checked = handsFree;
  }

  // Hide the listening panel
  function closeVoice() {
    // Hide it
    $("voice-sheet").hidden = true;
    // The mic stops glowing (unless hands-free is on)
    $("voice").classList.toggle("on", handsFree);
  }

  // The bar under the header while hands-free is on
  function listeningBar(text) {
    // Show it, or hide it when there's no text
    $("listening-bar").hidden = !text;
    // The message
    if (text) $("listening-text").textContent = text;
  }

  // Signed out: any listening stops (the setting is kept for next time)
  function stopHandsFree() {
    cancelRecording();
    listeningBar("");
    closeMic();
  }

  // Turn hands-free on or off (and remember it on this phone)
  function setHandsFree(on) {
    // Remember the choice
    handsFree = on;
    try {
      localStorage.setItem("nova-handsfree", on ? "on" : "off");
    } catch (err) {}
    // The mic glows while it's on
    $("voice").classList.toggle("on", on);
    // Any single listen in progress stops (and is thrown away)
    cancelRecording();
    // Close the voice panel
    $("voice-sheet").hidden = true;
    // Start listening, or stop
    if (on) {
      toast("Always listening. Start with “Nova”");
      startHandsFree();
    } else {
      toast("Stopped listening");
      listeningBar("");
      closeMic();
    }
  }

  // Open the microphone (and a volume meter, to hear when someone's talking)
  async function openMic() {
    // Already open
    if (mic) return mic;
    // Ask for the microphone: clear sound, without echo
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    // Something to measure the volume with
    const context = new (window.AudioContext || window.webkitAudioContext)();
    // iPhones start it paused; try to start it (it may need a tap, see below)
    try {
      await context.resume();
    } catch (err) {}
    // The volume meter
    const meter = context.createAnalyser();
    // Its size
    meter.fftSize = 1024;
    // Connect the microphone to it
    context.createMediaStreamSource(stream).connect(meter);
    // Keep it all together
    mic = { stream, context, meter, samples: new Float32Array(meter.fftSize) };
    // Hand it back
    return mic;
  }

  // Close the microphone (the iPhone's orange dot goes away)
  function closeMic() {
    // Nothing open
    if (!mic) return;
    // Stop any recording
    cancelRecording();
    // Turn the microphone off
    mic.stream.getTracks().forEach((t) => t.stop());
    // Close the volume meter
    mic.context.close().catch(() => {});
    // Closed
    mic = null;
  }

  // Is someone talking right now?
  function talking() {
    // Read the volume
    mic.meter.getFloatTimeDomainData(mic.samples);
    // How loud it is (average power)
    let sum = 0;
    for (const x of mic.samples) sum += x * x;
    // Loud enough to be speech?
    return Math.sqrt(sum / mic.samples.length) > 0.02;
  }

  // Record one thing said. Resolves with a WAV recording, or null if nothing
  // was said within `waitMs` (or the recording was cancelled).
  function recordOnce(waitMs) {
    return new Promise((resolve) => {
      // Record from the open microphone
      const rec = new MediaRecorder(mic.stream);
      // The pieces of the recording
      const chunks = [];
      // Keep each piece
      rec.addEventListener("dataavailable", (e) => chunks.push(e.data));
      // When it started, whether they've spoken yet, and when they last made a sound
      const started = Date.now();
      let spoke = false;
      let lastSound = Date.now();
      // Check the volume ten times a second
      const timer = setInterval(() => {
        // Someone's talking
        if (talking()) {
          spoke = true;
          lastSound = Date.now();
        }
        // Stop after a 1.2-second pause, nothing said for a while, or 15 seconds in all
        if ((spoke && Date.now() - lastSound > 1200) || (!spoke && Date.now() - started > waitMs) || Date.now() - started > 15000) {
          if (rec.state === "recording") rec.stop();
        }
      }, 100);
      // When it stops: hand back the recording (or nothing)
      rec.addEventListener("stop", async () => {
        // Stop checking the volume
        clearInterval(timer);
        // No longer recording (unless a newer recording has already started)
        if (recorder === rec) recorder = null;
        // Cancelled, or nothing said
        if (rec.cancelled || !spoke || !chunks.length) return resolve(null);
        // Turn it into a WAV file the Worker can always read
        resolve(await toWav(new Blob(chunks, { type: rec.mimeType })).catch(() => null));
      });
      // Start
      recorder = rec;
      rec.start();
    });
  }

  // Stop recording and use what was said
  function stopRecording() {
    // Only if it's recording
    if (recorder && recorder.state === "recording") recorder.stop();
  }

  // Stop recording and throw it away
  function cancelRecording() {
    // Mark it as cancelled, then stop
    if (recorder) recorder.cancelled = true;
    stopRecording();
  }

  // Send a recording to the Worker to be written down
  async function transcribe(wav) {
    // Send it
    const res = await fetch("/app/api/voice", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav, credentials: "same-origin" });
    // The answer
    const data = await res.json().catch(() => ({}));
    // Signed out
    if (res.status === 401) {
      showLogin();
      throw new Error("signed out");
    }
    // Didn't work
    if (!res.ok) throw new Error(data.error || "Couldn't make that out. Try again.");
    // The words
    return data.text || "";
  }

  // Listen once (the mic button, when hands-free is off)
  async function listenOnce() {
    // Open the microphone
    try {
      await openMic();
    } catch (err) {
      return toast("Portal can't use the microphone. Allow it in Settings.");
    }
    // The mic glows, and the panel shows
    $("voice").classList.add("on");
    voiceStatus("Listening…");
    // Record what's said (up to 7 seconds to start talking)
    const wav = await recordOnce(7000);
    // Hands-free was switched on meanwhile: it has the microphone now
    if (handsFree) return;
    // Done with the microphone
    closeMic();
    // Nothing said
    if (!wav) return closeVoice();
    // Working on it
    voiceStatus("Working out what you said…", true);
    try {
      // Write it down
      const text = await transcribe(wav);
      // Close the panel
      closeVoice();
      // Do what was asked
      if (text) await runCommand(text);
    } catch (err) {
      // Show the problem, then close
      if (err.message === "signed out") return closeVoice();
      voiceStatus(err.message);
      setTimeout(closeVoice, 2200);
    }
  }

  // What was said after "Nova" (null if it didn't start with "Nova").
  // Whisper sometimes hears "Nova" as "Noah", "Nava" or "Nover".
  function afterWakeWord(text) {
    // "Nova, show alerts", "Hey Nova show alerts", "Portal, call Eric"
    const m = String(text).match(/^\W*(?:(?:hey|hi|ok|okay)\W+)?(?:nova(?:\s*portal)?|novah|noah|nava|nover|no va)\b\W*(.*)$/i);
    // The command (maybe empty), or null
    return m ? m[1].trim() : null;
  }

  // Wait for one tap anywhere (iPhones need a tap before the app can hear)
  function waitForTap() {
    return new Promise((resolve) => document.addEventListener("pointerdown", resolve, { once: true }));
  }

  // Hands-free: keep listening while Portal is open and on screen
  async function startHandsFree() {
    // Already running, switched off, signed out, or not on screen
    if (looping || !handsFree || !canRecord || $("app").hidden || document.hidden) return;
    // Running now
    looping = true;
    // Open the microphone (if the iPhone wants a tap first, wait for one)
    try {
      await openMic();
    } catch (err) {
      // Ask for a tap, then try again
      listeningBar("Tap anywhere to start listening");
      await waitForTap();
      try {
        await openMic();
      } catch (err2) {
        // Still no: the microphone is blocked
        listeningBar("");
        looping = false;
        return toast("Portal can't use the microphone. Allow it in Settings.");
      }
    }
    // The volume meter is paused until a tap (iPhone rule): wait for one
    if (mic.context.state !== "running") {
      listeningBar("Tap anywhere to start listening");
      await waitForTap();
      await mic.context.resume().catch(() => {});
    }
    // Keep going while hands-free is on and the app is on screen
    while (handsFree && !document.hidden && !$("app").hidden && mic) {
      // Ready
      listeningBar("Listening… say “Nova, …”");
      // Wait for someone to say something (up to 10 seconds, then start again)
      const wav = await recordOnce(10000);
      // Switched off or left meanwhile
      if (!handsFree || document.hidden || !mic) break;
      // Nothing said: listen again
      if (!wav) continue;
      // Working on it
      listeningBar("Working out what you said…");
      // Write it down
      let text = "";
      try {
        text = await transcribe(wav);
      } catch (err) {
        // Signed out: stop; anything else: carry on listening
        if (err.message === "signed out") break;
        continue;
      }
      // The command after "Nova" (null: not meant for Portal, so ignore it)
      const command = afterWakeWord(text);
      // Not for us
      if (command === null) continue;
      // Just "Nova": nothing to do yet
      if (!command) {
        toast("Yes? Say what to do after “Nova”");
        continue;
      }
      // Do it
      await runCommand(command);
    }
    // Stopped: close the microphone and hide the bar
    closeMic();
    listeningBar("");
    looping = false;
    // Came straight back while it was stopping: start again
    if (handsFree && !document.hidden && !$("app").hidden) setTimeout(startHandsFree, 300);
  }

  // Leaving the app: stop listening. Coming back: start again.
  document.addEventListener("visibilitychange", () => {
    // Left: stop recording (the loop sees it and closes the microphone)
    if (document.hidden) cancelRecording();
    // Back: start again if hands-free is on
    else startHandsFree();
  });

  // Turn any recording into a small 16 kHz mono WAV file (iPhones record in a format Whisper can't always read)
  async function toWav(blob) {
    // Decode the recording
    const decoder = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await decoder.decodeAudioData(await blob.arrayBuffer());
    decoder.close();
    // Re-play it at 16,000 samples a second, in mono
    const rate = 16000;
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    // The sound as numbers
    const pcm = (await offline.startRendering()).getChannelData(0);
    // Write the WAV file: a 44-byte header, then the sound
    const view = new DataView(new ArrayBuffer(44 + pcm.length * 2));
    const text = (at, str) => [...str].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    text(0, "RIFF");
    view.setUint32(4, 36 + pcm.length * 2, true);
    text(8, "WAVEfmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, "data");
    view.setUint32(40, pcm.length * 2, true);
    pcm.forEach((x, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x)) * 0x7fff, true));
    // Hand it back
    return new Blob([view], { type: "audio/wav" });
  }

  // The number of days said ("7 days", "seven days", "a week"), or 0
  function daysSaid(t) {
    // Digits ("7 days")
    const digits = t.match(/\b(\d{1,2})\b/);
    if (digits) return Number(digits[1]);
    // Words
    if (/\b(a|one) day\b/.test(t)) return 1;
    if (/\bthree days\b/.test(t)) return 3;
    if (/\b(a|one) week\b|\bseven days\b/.test(t)) return 7;
    if (/\bfortnight\b|\btwo weeks\b|\bfourteen days\b/.test(t)) return 14;
    if (/\b(a|one) month\b|\bthirty days\b/.test(t)) return 30;
    // None
    return 0;
  }

  // Find a customer by the name they said, in the alerts and enquiries
  async function findPerson(spoken) {
    // Get the latest of both
    try {
      lastAlerts = (await api("notifications")).notifications;
      lastEnquiries = (await api("enquiries?show=all")).enquiries;
    } catch (err) {}
    // Everyone we know, with how to reach them (newest first)
    const people = [
      ...lastAlerts.map((a) => a.contact).filter((c) => c && c.name),
      ...lastEnquiries.map((q) => ({ name: q.name, email: q.email, phone: q.phone, enquiry: q })),
    ];
    // The words they said
    const words = spoken.toLowerCase().split(/[^a-z']+/);
    // The person whose name shares the most words with what was said
    let best = null;
    let bestScore = 0;
    people.forEach((p) => {
      // How many parts of their name were said
      const score = p.name.toLowerCase().split(/\s+/).filter((part) => part.length > 1 && words.includes(part)).length;
      // Better than anyone so far (ties go to the newest)
      if (score > bestScore) {
        best = p;
        bestScore = score;
      }
    });
    // Them, or nobody
    return best;
  }

  // Do what was said
  async function runCommand(said) {
    // Show what was heard
    toast("“" + said + "”");
    // Lower case, without punctuation, for matching
    const t = said.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
    // A number of days, if one was said
    const n = daysSaid(t);
    // Any open answer panel closes for the next command
    if (!$("voice-sheet").hidden) closeVoice();

    // A question about bookings, enquiries or alerts: Nova answers it (and says it out loud)
    if (/^(what|whats|what's|when|who|whose|where|which|how|is|are|was|were|does|do|did|has|have|had|can|could|tell|give|any|list|find|check)\b/.test(t)) return askNova(said);

    // Auto-delete: "auto delete off", "delete alerts after 7 days"
    if (/auto ?delete|delete (my |the )?alerts after|keep alerts/.test(t)) {
      // Off, or a number of days
      if (/\b(off|stop|never|forever)\b/.test(t)) return saveAutoDelete(0);
      // One of the choices
      if ([1, 3, 7, 14, 30].includes(n)) return saveAutoDelete(n);
      // Not a choice
      return toast("Say 1, 3, 7, 14 or 30 days, or “auto delete off”");
    }
    // "Delete all alerts", "clear alerts"
    if (/\b(delete|clear|remove|wipe)\b.*\b(alerts?|notifications?)\b/.test(t) && !/\b(latest|last|newest|top|first)\b/.test(t)) return show("alerts"), deleteAllAlerts();
    // "Delete the latest alert"
    if (/\b(delete|remove)\b.*\b(latest|last|newest|top|first)\b/.test(t)) {
      // The newest alert
      const latest = (await api("notifications")).notifications[0];
      // None
      if (!latest) return toast("No alerts to delete");
      // Check first
      if (confirm("Delete the alert “" + latest.title + "”?")) deleteAlert(latest.id);
      // Done
      return show("alerts");
    }
    // "Call Eric", "ring Fanny Winters"
    let m = t.match(/^(call|ring|phone)\b (.+)/);
    if (m) {
      // Who
      const person = await findPerson(m[2]);
      // Nobody with that name, or no number
      if (!person || !person.phone) return toast(person ? person.name + " has no phone number" : "Couldn't find “" + m[2] + "”");
      // Check, then ring them
      if (confirm("Call " + person.name + " on " + person.phone + "?")) location.href = "tel:" + person.phone.replace(/[^0-9+]/g, "");
      return;
    }
    // "Email Eric"
    m = t.match(/^(email|e mail|mail)\b (.+)/);
    if (m) {
      // Who
      const person = await findPerson(m[2]);
      // Nobody with that name, or no email
      if (!person || !person.email) return toast(person ? person.name + " has no email" : "Couldn't find “" + m[2] + "”");
      // Open a new email to them
      location.href = "mailto:" + encodeURIComponent(person.email);
      return;
    }
    // "Mark Jordan done"
    m = t.match(/\bmark (.+?) (as )?(done|finished|complete)\b/);
    if (m) {
      // Whose enquiry
      const person = await findPerson(m[1]);
      // Not an enquiry
      if (!person || !person.enquiry) return toast("Couldn't find an enquiry from “" + m[1] + "”");
      // Mark it done
      await api("enquiries/status", { body: { id: person.enquiry.id, status: "done" } });
      // Let them know, and show the list
      toast(person.name + "'s enquiry marked done");
      return show("enquiries");
    }
    // "Send a test notification"
    if (/\btest\b.*\bnotification/.test(t)) return $("notify-test").click();
    // "Sign out"
    if (/\b(sign|log) ?out\b/.test(t)) return $("logout").click();
    // "Refresh"
    if (/^(refresh|reload|update)\b/.test(t)) return $("refresh").click();
    // Sections: "show alerts", "new enquiries", "chats", "open NovaBot"
    if (/\b(calendar|diary|schedule|bookings?|sessions?)\b/.test(t) && !/^ask\b/.test(t)) return show("calendar");
    if (/\b(alerts?|notifications?)\b/.test(t) && !/^ask\b/.test(t)) return show("alerts");
    if (/\b(en|in)quir/.test(t) && !/^ask\b/.test(t)) {
      // "All enquiries" or just the new ones
      enquiryFilter = /\ball\b/.test(t) ? "all" : "new";
      document.querySelectorAll("[data-show]").forEach((c) => c.classList.toggle("active", c.dataset.show === enquiryFilter));
      return show("enquiries");
    }
    if (/\b(chats?|conversations?)\b/.test(t)) return show("chats");
    // "Ask NovaBot …": the customer NovaBot, in its tab
    if (/^ask (nova ?bot)\b/.test(t)) {
      // The question without "ask NovaBot"
      const question = said.replace(/^\s*ask\s+nova ?bot[,:]?\s*/i, "").trim();
      // Switch the tab to the customer NovaBot and open it
      document.querySelector('#view-bot [data-mode="customer"]').click();
      show("bot");
      // Ask it
      if (question) {
        $("bot-input").value = question;
        askNovaBot();
      }
      return;
    }
    // Anything else: Nova answers it from the studio's data
    return askNova(said.replace(/^\s*ask\s+(nova\s*)?/i, ""));
  }

  // Nova's answers so far (for follow-up questions like "and his phone number?")
  const novaHistory = [];

  // Ask Nova a question, show the answer and say it out loud
  async function askNova(question) {
    // Show that it's thinking
    voiceStatus("Thinking…", true);
    try {
      // Ask the Worker
      const { answer } = await api("ask", { body: { question, history: novaHistory } });
      // Remember the question and answer (the last three of each)
      novaHistory.push({ role: "user", content: question }, { role: "assistant", content: answer });
      novaHistory.splice(0, Math.max(0, novaHistory.length - 6));
      // Show the question and the answer
      voiceStatus("“" + question + "”");
      $("voice-answer").textContent = answer;
      $("voice-answer").hidden = false;
      // Say it out loud (hands-free waits until it's finished, so it doesn't hear itself)
      await speak(answer);
    } catch (err) {
      // Signed out, or something went wrong
      if (err.message === "signed out") return closeVoice();
      voiceStatus(err.message);
    }
  }

  // Say something out loud (with a British voice, if the phone has one)
  function speak(text) {
    return new Promise((resolve) => {
      // This browser can't speak
      if (!("speechSynthesis" in window)) return resolve();
      // Stop anything already being said
      speechSynthesis.cancel();
      // What to say, without any formatting marks
      const words = new SpeechSynthesisUtterance(String(text).replace(/[*_#`]/g, ""));
      // British English
      words.lang = "en-GB";
      // A British voice, if there is one
      const voice = speechSynthesis.getVoices().find((v) => v.lang === "en-GB");
      if (voice) words.voice = voice;
      // Finished (or failed): carry on
      words.onend = words.onerror = () => resolve();
      // Say it
      speechSynthesis.speak(words);
      // Never wait more than 30 seconds
      setTimeout(resolve, 30000);
    });
  }

  // ===== Button ripples =====
  // A soft ring of light spreads from wherever a button is tapped

  document.addEventListener("pointerdown", (e) => {
    // The button (or chip, icon button, tab, calendar day) that was tapped
    const button = e.target.closest(".btn, .chip, .icon-btn, .tab, .cal-day, .card-delete");
    // Not a button, or less movement is asked for (the device, or Options → Animations off)
    if (!button || calm()) return;
    // Where on the button it was tapped
    const box = button.getBoundingClientRect();
    // The ring
    const ring = el("span", "ripple");
    // Big enough to cover the whole button
    const size = Math.max(box.width, box.height) * 2;
    // Centred on the finger
    Object.assign(ring.style, { width: size + "px", height: size + "px", left: e.clientX - box.left - size / 2 + "px", top: e.clientY - box.top - size / 2 + "px" });
    // Add it, and remove it when it's faded
    button.appendChild(ring);
    setTimeout(() => ring.remove(), 650);
  });

  // ===== Start =====

  // ===== Start: portal.js starts the tabs once someone's signed in =====
  // (openOptions: Nova Agent's gear opens Portal's Options when Portal is the panel showing;
  //  showOnly: portal.js shows its own views the same way)
  // kit: the helpers Social (social.js), Funnel (funnel.js), Money (money.js) and Test stuff (teststuff.js) draw with
  const kit = { api, el, reconcile, redraw, setText, setBadge, syncCounts, emptyState, sig, when, ukWhen, ukLocal, ukToIso, calm, toast, goView, get running() { return running; }, get view() { return currentView; } };
  window.PortalApp = { VIEWS, start, stop, show, showOnly, openOptions, kit, get view() { return currentView; } };
})();
