// Outreach, on one screen (25 Oct 2026, the owner: "can you make the rest of nova portal as much as possible
// dashboards please", after Admin: "heavily simplify … put everything onto one screen as much as possible", then
// "get rid of old links please and just keep it simple and optimized"). Outreach had an Overview, three tabs
// (Campaigns, Social, Funnel) and seven buttons along the top that each opened a tab first. Now it's this one
// dashboard (/portal/?view=outreach), a panel each, side by side:
//   - To approve: everything waiting for an admin across all three (campaigns, one-to-one emails, posts, replies to
//     comments, the funnel's first emails), a line each with Approve and Reject right there, as careful as in their
//     rooms (Approve pressed twice, the first press saying exactly what will happen); a tap on its words opens that
//     very one in its room, to read it whole;
//   - Funnel: sending or paused (Start or Pause), today's warm-up, the counts; Add prospects, Write drafts;
//   - Campaigns: who can be emailed, what's scheduled and sent; Write a campaign, One-to-one email, Don't email
//     again, Fan sign-up link;
//   - Social: what's connected, what's coming up, followers, comments to answer; Write a post, Ideas, Ads Manager.
// The forms open in place of the panels, a form's width in the middle (their own code still runs them: app.js,
// social.js, funnel.js). Open › goes to a room only for the long lists (every campaign and one-to-one email, every
// post and comment, every prospect and the funnel's settings); the room's strip says Outreach, the way back.
// The rooms' own loaders read the data (app.js, social.js, funnel.js, so their badges stay right) and hand it here
// (took); it's drawn when it was asked for: the dashboard opening, a press here, or a form here being sent. No
// timers of its own.
(function () {
  "use strict";
  if (window.PortalOutreach) return;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const K = () => window.PortalApp && window.PortalApp.kit;
  const say = (t) => K() && K().toast(t);
  const page = () => window.PortalPage;
  // (a room opened from here: a new step in the history, so Back comes back to the dashboard; the Nova Tabs' strip,
  // which steps aside on the dashboard, drawn with it at once: coming a moment later it made the room's section
  // shorter after its pages were cut, and they came out drawn small, wider than the section)
  const go = (url) => {
    if (!page()) return;
    page().go(url);
    if (window.NovaPillars && window.NovaPillars.redraw) window.NovaPillars.redraw();
  };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
  const people = (n) => plural(Number(n) || 0, "person", "people");
  const num = (n) => (Number(n) || 0).toLocaleString("en-GB");
  // (UK time, as the rooms show it; shorter on a line: "Fri 16 Oct, 18:00")
  const ukWhen = (iso) => (K() && K().ukWhen ? K().ukWhen(iso) : "");
  const short = (iso) => {
    const d = new Date(iso);
    if (!iso || isNaN(d)) return "";
    return d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).replace(/^(\p{L}+),/u, "$1");
  };
  const firstLine = (t) => String(t || "").split("\n").map((x) => x.trim()).find(Boolean) || "";
  const NAMES = { facebook: "Facebook", instagram: "Instagram", youtube: "YouTube" };
  const AUDIENCE = { fans: "Fans", clients: "Studio clients", everyone: "Everyone" };
  const waits = (x) => x.status === "pending_approval" || x.status === "draft";

  const got = {}; // what each loader last found: campaigns, outreach, social, funnel (or { error })
  const want = new Set(); // the parts to draw when they come
  let P = null; // the panels on the dashboard now
  let rejecting = null; // the line whose "why" box is open

  // ---- A panel (as Admin's, admin.js): its name (with Open › to its room), a count, lines, buttons at its foot ----
  function panel(key, name, icon, openIt) {
    const box = el("article", "dash-tile ad-panel od-panel od-" + key);
    box.dataset.key = "od-" + key;
    // (whole on a page, drawn a little smaller if it must be: in a short window a panel a page, low and wide)
    box.setAttribute("data-os-keep", "");
    const head = el("div", "dash-tile-head");
    if (window.NovaPillars) head.append(window.NovaPillars.icon(icon));
    const badge = el("span", "badge");
    badge.hidden = true;
    head.append(el("h3", "dash-name", name), badge);
    if (openIt) {
      const open = el("button", "dash-open", "Open ›");
      open.type = "button";
      open.setAttribute("aria-label", "Open " + name);
      open.addEventListener("click", openIt);
      head.append(open);
    }
    const top = el("p", "dash-top");
    const big = el("span", "dash-big", "…");
    const small = el("span", "dash-small", "");
    top.append(big, small);
    const rows = el("ul", "dash-rows");
    const foot = el("div", "ad-foot");
    box.append(head, top, rows, foot);
    return { box, badge, big, small, rows, foot };
  }
  // A line: its words, how it is now beside them, and what a tap on it opens
  function line(main, side, open) {
    const li = el("li");
    li.append(el("span", "dash-main", main), el("span", "dash-side", side || ""));
    if (open) {
      li.tabIndex = 0;
      li.setAttribute("role", "link");
      li.title = "Open: " + main;
      li.addEventListener("click", open);
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
    }
    return li;
  }
  function button(label, cls, onClick) {
    const b = el("button", cls, label);
    b.type = "button";
    b.addEventListener("click", () => onClick(b));
    return b;
  }
  const badge = (p, n) => {
    p.badge.textContent = String(n);
    p.badge.hidden = !n;
  };
  const failed = (p, err) => {
    p.big.textContent = "–";
    p.small.textContent = "Couldn't load this just now" + (err && err.message ? ": " + err.message : "");
    p.rows.replaceChildren();
  };
  // (a part's own buttons, in the page once and moved onto its panel each time it's drawn: their code is the
  // rooms' own, app.js, social.js, funnel.js)
  const own = (id) => $(id);

  // ---- Reading: the rooms' loaders, which hand back what they found (took) ----
  function load(parts) {
    for (const part of parts) {
      if (part === "campaigns") {
        // (one-to-one emails come with the campaigns, app.js loadCampaigns)
        want.add("campaigns");
        want.add("outreach");
        if (window.PortalCampaigns) window.PortalCampaigns.load();
      } else if (part === "outreach") load(["campaigns"]);
      else {
        want.add(part);
        const room = part === "social" ? window.PortalSocial : window.PortalFunnel;
        if (room) room.load();
      }
    }
  }
  function took(part, data, err) {
    got[part] = data || { error: err || new Error("nothing came") };
    if (!want.has(part) || !P || !here()) return;
    want.delete(part);
    draw(part);
  }
  const here = () => window.PortalApp && window.PortalApp.view === "outreach" && !$("view-outreach").hidden;
  function draw(part) {
    // (a line's "why" box left open is kept: a refresh doesn't take away what's being typed)
    if (!rejecting) approve();
    if (part === "campaigns" || part === "outreach") campaigns();
    if (part === "social") social();
    if (part === "funnel") funnel();
  }

  // ---- To approve: everything waiting, across Campaigns, Social and the Funnel ----
  function items() {
    const list = [];
    const C = got.campaigns && !got.campaigns.error ? got.campaigns : null;
    const O = got.outreach && !got.outreach.error ? got.outreach : null;
    const S = got.social && !got.social.error ? got.social : null;
    const F = got.funnel && !got.funnel.error ? got.funnel : null;
    if (C) {
      const a = C.audiences || {};
      for (const c of (C.campaigns || []).filter(waits)) {
        const size = a[c.audience];
        list.push({
          key: "cp-" + c.id, kind: "Campaign", part: "campaigns", at: c.createdAt, can: C.canDecide,
          title: c.subject || "(No subject)",
          side: (AUDIENCE[c.audience] || c.audience) + (size !== undefined ? " · " + people(size) : "") + (c.sendAt ? " · " + short(c.sendAt) : ""),
          open: () => go("/portal/?view=campaigns&campaign=" + c.id),
          sure: c.sendAt ? "Schedule it for " + ukWhen(c.sendAt) + "?" : "Send it to " + (size !== undefined ? people(size) : "them") + " now?",
          // (still exactly what was shown? someone may have changed it since, as Campaigns checks)
          async approve() {
            const now = (await api("campaigns/" + c.id)).campaign || {};
            if (now.updatedAt !== c.updatedAt || now.status !== c.status) return say("It changed since it was shown: check it again");
            const done = (await api("campaigns/" + c.id + "/approve", {})).campaign || {};
            say(done.status === "sent" ? "Sent to " + people(done.recipients) : done.status === "scheduled" ? "Scheduled for " + ukWhen(done.sendAt) : done.status === "failed" ? "Didn't send: " + (done.error || "see it in Campaigns") : "Approved: sending now");
          },
          async reject(note) {
            await api("campaigns/" + c.id + "/reject", { note });
            say("Rejected: nothing was sent");
          },
        });
      }
    }
    if (O) {
      for (const o of (O.outreach || []).filter(waits)) {
        list.push({
          key: "or-" + o.id, kind: "One-to-one", part: "outreach", at: o.createdAt, can: O.canDecide,
          title: o.subject || "(No subject)",
          side: "To " + ([o.toName, o.organisation].filter(Boolean).join(", ") || o.toEmail),
          open: () => go("/portal/?view=campaigns&outreach=" + o.id),
          sure: "Send it to " + o.toEmail + " now?",
          async approve() {
            const now = (await api("outreach/" + o.id)).outreach || {};
            if (now.updatedAt !== o.updatedAt || now.status !== o.status) return say("It changed since it was shown: check it again");
            const done = (await api("outreach/" + o.id + "/approve", {})).outreach || {};
            say(done.status === "sent" ? "Sent to " + done.toEmail : done.status === "failed" ? "Didn't send: " + (done.error || "see it in Campaigns") : "Approved: sending now");
          },
          async reject(note) {
            await api("outreach/" + o.id + "/reject", { note });
            say("Rejected: nothing was sent");
          },
        });
      }
    }
    if (S) {
      const on = S.connected || {};
      for (const p of (S.posts || []).filter(waits)) {
        const auto = (p.platforms || []).filter((x) => on[x]);
        const hand = (p.platforms || []).filter((x) => !on[x]);
        const byHandToo = hand.length ? " (" + hand.map((x) => NAMES[x] || x).join(" and ") + " by hand)" : "";
        const head = firstLine(p.caption);
        list.push({
          key: "sc-" + p.id, kind: "Post", part: "social", at: p.createdAt, can: S.canDecide,
          title: head || ((p.media || []).length ? (p.media[0].kind === "video" ? "A video post" : "A picture post") : "A post"),
          side: (p.platforms || []).map((x) => NAMES[x] || x).join(", ") + (p.postAt ? " · " + short(p.postAt) : ""),
          open: () => go("/portal/?view=social&post=" + p.id),
          sure: p.postAt ? "Schedule it for " + ukWhen(p.postAt) + byHandToo + "?" : auto.length ? "Post it on " + auto.map((x) => NAMES[x]).join(" and ") + " now" + byHandToo + "?" : "Approve it to post by hand?",
          async approve() {
            const out = await api("social/" + p.id + "/approve", {});
            const st = out && out.post ? out.post.status : "";
            say(st === "failed" ? "It didn't post: open it in Social to see why." : p.postAt ? "Scheduled for " + ukWhen(p.postAt) : auto.length ? "Approved: posting now" : "Approved: it waits in Social to be posted by hand");
          },
          async reject(note) {
            await api("social/" + p.id + "/reject", { note });
            say("Rejected: nothing was posted");
          },
        });
      }
      for (const c of (S.comments || []).filter((x) => x.replyStatus === "pending_approval")) {
        list.push({
          key: "scc-" + c.id, kind: "Reply", part: "social", at: c.updatedAt || c.commentedAt, can: S.canDecide,
          title: c.reply || "A reply",
          side: "To " + (c.author || "someone") + " on " + (NAMES[c.platform] || c.platform),
          open: () => go("/portal/?view=social&comment=" + c.id),
          // (one press, as in Social: a reply to a comment)
          sure: null,
          approveLabel: on[c.platform] ? "Approve" : "Approve (by hand)",
          async approve() {
            await api("social/comments/" + c.id + "/approve", {});
            say(on[c.platform] ? "Reply approved: posting it" : "Reply approved: post it by hand from Social");
          },
          async reject(note) {
            await api("social/comments/" + c.id + "/reject", { note });
            say("Reply rejected: nothing was posted");
          },
        });
      }
    }
    if (F) {
      for (const p of (F.prospects || []).filter((x) => x.step === "approve")) {
        list.push({
          key: "fn-" + p.id, kind: "Funnel", part: "funnel", at: p.draftedAt || p.createdAt, can: F.canDecide,
          title: p.subject || "First email",
          side: "To " + (p.name || p.email) + (p.company ? ", " + p.company : ""),
          open: () => openFunnel("approve"),
          sure: "Queue it?",
          async approve() {
            const out = await api("funnel/approve", { items: [{ id: p.id, updatedAt: p.updatedAt }] });
            const refused = (out && out.refused) || [];
            say(`${Number(out && out.approved) || 0} in the warm-up queue` + (refused.length ? ` · ${refused.length} not: ${refused[0].why}` : "") + (F.settings && F.settings.paused ? " · sending is paused" : ""));
          },
          // (as in the Funnel: pressed twice, no "why" box)
          rejectSure: "Reject them?",
          async reject() {
            await api("funnel/" + p.id + "/stop", { why: "rejected" });
            say("Rejected: they won't be emailed.");
          },
        });
      }
    }
    // (oldest first, as each room lists them)
    return list.sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
  }
  const api = (path, body) => K().api(path, body ? { body } : {});

  function approve() {
    const p = P && P.approve;
    if (!p) return;
    const parts = ["campaigns", "outreach", "social", "funnel"];
    const known = parts.filter((x) => got[x]);
    if (!known.length) return;
    const list = items();
    const can = list.some((i) => i.can) || parts.some((x) => got[x] && got[x].canDecide);
    badge(p, list.length);
    const count = (kind, one, many) => {
      const n = list.filter((i) => i.kind === kind).length;
      return n ? plural(n, one, many) : "";
    };
    p.big.textContent = list.length ? `${list.length} waiting` : "Nothing waiting ✦";
    p.small.textContent = list.length
      ? [count("Campaign", "campaign"), count("One-to-one", "one-to-one email"), count("Post", "post"), count("Reply", "reply", "replies"), count("Funnel", "first email")].filter(Boolean).join(" · ") + (can ? "" : " · an admin approves these")
      : "Campaigns, one-to-one emails, posts, replies and the funnel's first emails wait here for an admin";
    const shown = list.slice(0, room(list.length));
    const rows = shown.map(item);
    if (list.length > shown.length) {
      const rest = list.slice(shown.length);
      const by = {};
      for (const i of rest) by[i.kind] = (by[i.kind] || 0) + 1;
      rows.push(line(`+${rest.length} more waiting`, Object.entries(by).map(([k, n]) => `${n} ${k === "Reply" ? (n === 1 ? "reply" : "replies") : k.toLowerCase()}`).join(" · "), rest[0].open));
    }
    const bad = parts.filter((x) => got[x] && got[x].error).map((x) => (x === "outreach" ? "one-to-one emails" : x));
    if (bad.length) rows.push(line("Couldn't load " + bad.join(" and ") + " just now", "", null));
    p.rows.replaceChildren(...rows);
  }
  // How many lines To approve has room for: what's left of the section under the second row (Campaigns and Social),
  // never fewer than three; when not all fit, the last is one line that says how many more and opens the first of
  // them. (in a short window, or Portal on its own, the panels are in pages anyway: a few)
  const tall = () => matchMedia("(min-height: 950px)").matches;
  function room(n) {
    const html = document.documentElement;
    if (!html.classList.contains("embed") || html.classList.contains("win-short")) return n > 6 ? 5 : n;
    const v = $("view-outreach");
    const cs = getComputedStyle(v);
    // (the section's room without a page bar: the bar's own space is kept only while it's in pages, onescreen.js,
    // and a "why" box open for a moment shouldn't leave To approve a line shorter for good)
    const h = v.clientHeight - parseFloat(cs.paddingTop) - Math.min(parseFloat(cs.paddingBottom), 8);
    const big = tall();
    const other = Math.max(P.campaigns.box.offsetHeight, P.social.box.offsetHeight, big ? 325 : 210);
    const left = h - other - (big ? 14 : 10) - (big ? 130 : 104);
    const line = big ? 46 : 31;
    if (n * line <= left) return n;
    return Math.max(2, Math.floor((left - (big ? 40 : 27)) / line));
  }
  // (Campaigns, Social and the Funnel: three lines each, four in a tall window, so To approve has the room)
  const lines = () => (tall() ? 4 : 3);

  // A line waiting for approval: its kind, its words (a tap opens it in its room) and Approve and Reject
  function item(i) {
    const li = el("li", "od-item");
    li.dataset.key = i.key;
    const what = el("button", "od-what");
    what.type = "button";
    what.title = "Open it to read it whole";
    what.append(el("span", "od-kind", i.kind), el("span", "dash-main", i.title), el("span", "dash-side", i.side));
    what.addEventListener("click", i.open);
    li.append(what);
    if (!i.can) {
      li.append(el("span", "od-note", "An admin approves"));
      return li;
    }
    const acts = el("span", "od-acts");
    const all = () => li.querySelectorAll("button");
    const problem = (err) => {
      if (err && err.message === "signed out") return;
      let why = li.querySelector(".od-problem");
      if (!why) {
        why = el("p", "appr-result bad od-problem");
        why.setAttribute("role", "alert");
        li.append(why);
      }
      why.textContent = "Not done: " + ((err && err.message) || "something went wrong");
      all().forEach((b) => (b.disabled = false));
    };
    // (done: read that part again, and To approve is drawn afresh)
    const run = async (fn, arg) => {
      all().forEach((b) => (b.disabled = true));
      try {
        await fn(arg);
      } catch (err) {
        return problem(err);
      }
      rejecting = null;
      load([i.part]);
    };
    // Approve: pressed twice when it sends or posts, the first press saying exactly what will happen
    const ok = button(i.approveLabel || "Approve", "btn small", (b) => {
      if (i.sure && b.dataset.sure !== "1") {
        b.dataset.sure = "1";
        b.textContent = i.sure;
        return;
      }
      run(() => i.approve());
    });
    const no = button("Reject", "btn small ghost", (b) => {
      if (i.rejectSure) {
        if (b.dataset.sure !== "1") {
          b.dataset.sure = "1";
          b.textContent = i.rejectSure;
          return;
        }
        return run(() => i.reject());
      }
      // (a "why" box, ready to type in, so whoever wrote it can fix it; Reject it, or Cancel)
      rejecting = i.key;
      acts.hidden = true;
      const why = el("label", "od-why");
      const input = el("input");
      input.type = "text";
      input.maxLength = 500;
      input.placeholder = "Why (optional): so whoever wrote it can fix it";
      input.setAttribute("aria-label", "Why it's rejected (optional)");
      why.append(input);
      const sure = button("Reject it", "btn small", () => run((note) => i.reject(note), input.value.trim() || undefined));
      const cancel = button("Cancel", "btn small ghost", () => {
        rejecting = null;
        why.remove();
        acts.hidden = false;
        no.focus();
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") sure.click();
        if (e.key === "Escape") cancel.click();
      });
      why.append(sure, cancel);
      li.append(why);
      if (window.NovaOneScreen) window.NovaOneScreen.reveal(why);
      input.focus({ preventScroll: true });
    });
    acts.append(ok, no);
    li.append(acts);
    return li;
  }

  // ---- Campaigns: who can be emailed, what's next and what went; writing one, here ----
  function campaigns() {
    const p = P && P.campaigns;
    if (!p) return;
    const C = got.campaigns;
    const O = got.outreach;
    if (!C) return;
    if (C.error) return failed(p, C.error);
    const a = C.audiences || {};
    const all = C.campaigns || [];
    const ones = O && !O.error ? O.outreach || [] : [];
    p.big.textContent = `${num(a.everyone)} can be emailed`;
    p.small.textContent = `${num(a.fans)} fans · ${num(a.clients)} clients` + (C.pendingFans ? ` · ${num(C.pendingFans)} still to confirm` : "");
    const room = (q) => () => go("/portal/?view=campaigns" + (q || ""));
    const by = (key, dir) => (x, y) => dir * String(x[key] || x.updatedAt || "").localeCompare(String(y[key] || y.updatedAt || ""));
    const news = [];
    const next = all.filter((c) => c.status === "approved" || c.status === "scheduled").sort(by("sendAt", 1))[0];
    if (next) news.push(line(next.subject || "(No subject)", next.sending ? `Going out · ${next.sending.sent} of ${next.sending.total}` : "Sends " + (next.sendAt ? short(next.sendAt) : "now"), room("&campaign=" + next.id)));
    const sent = all.filter((c) => c.status === "sent" || c.status === "failed").sort(by("sentAt", -1))[0];
    if (sent) news.push(line(sent.subject || "(No subject)", sent.status === "failed" ? "Didn't send" : "Sent " + short(sent.sentAt) + (sent.recipients != null ? " · " + people(sent.recipients) : ""), room("&campaign=" + sent.id)));
    const one = ones.filter((o) => o.status === "sent" || o.status === "failed" || o.status === "approved").sort(by("sentAt", -1))[0];
    if (one) news.push(line("To " + (one.toName || one.toEmail) + ": " + (one.subject || ""), one.status === "sent" ? "Sent " + short(one.sentAt) : one.status === "failed" ? "Didn't send" : "Sending", room("&outreach=" + one.id)));
    const no = all.filter((c) => c.status === "rejected").length + ones.filter((o) => o.status === "rejected").length;
    if (no) news.push(line("Rejected", plural(no, "email"), room()));
    if (!news.length) news.push(line("No campaigns sent yet", "", room()));
    // The fan sign-up link and "don't email again": a line each, opening in place (the panels step aside)
    const signup = line("Fan sign-up link", "Copy or share it", () => toggle("od-signup"));
    signup.classList.add("od-signup-open");
    const optout = line("Don't email again", O && !O.error && O.optouts ? `${num(O.optouts)} said no` : "Someone said no thanks", () => toggle("outreach-optout", "or-optout-email"));
    optout.classList.add("od-optout-open");
    p.rows.replaceChildren(...news.slice(0, lines() - 2), signup, optout);
  }

  // ---- Social: what's connected and coming up, followers, comments; writing a post, here ----
  function social() {
    const p = P && P.social;
    if (!p) return;
    const S = got.social;
    if (!S) return;
    if (S.error) return failed(p, S.error);
    const posts = S.posts || [];
    const on = Object.keys(NAMES).filter((x) => (S.connected || {})[x]);
    p.big.textContent = on.length ? on.map((x) => NAMES[x]).join(", ") : "Not connected";
    p.small.textContent = on.length === 3 ? "Approved posts go out by themselves" : on.length ? "The others wait to be posted by hand" : "Approved posts wait to be posted by hand";
    const room = (q) => () => go("/portal/?view=social" + (q || ""));
    const rows = [];
    const hand = posts.filter((x) => x.status === "manual");
    if (hand.length) rows.push(line("Post these by hand", plural(hand.length, "post"), room("&post=" + hand[0].id)));
    const coming = posts.filter((x) => ["approved", "scheduled", "posting"].includes(x.status)).sort((x, y) => String(x.postAt || "").localeCompare(String(y.postAt || "")));
    if (coming.length) rows.push(line("Coming up", plural(coming.length, "post") + (coming[0].postAt ? " · next " + short(coming[0].postAt) : ""), room("&post=" + coming[0].id)));
    const open = (S.comments || []).filter((c) => !c.handled);
    rows.push(line("Comments to answer", String(open.length), room(open.length ? "&comment=" + open[0].id : "")));
    const f = S.followers || {};
    for (const x of Object.keys(NAMES)) {
      if (!f[x]) continue;
      const c = Number(f[x].change) || 0;
      rows.push(line(NAMES[x] + (x === "youtube" ? " subscribers" : " followers"), num(f[x].followers) + " · " + (c >= 0 ? "+" : "−") + num(Math.abs(c)) + (x === "youtube" ? " since yesterday" : " in 30 days"), room()));
    }
    const posted = posts.filter((x) => x.status === "posted").sort((x, y) => String(y.postedAt || "").localeCompare(String(x.postedAt || "")));
    rows.push(line("Posted", posted.length ? plural(posted.length, "post") + " · last " + short(posted[0].postedAt) : "None yet", room(posted.length ? "&post=" + posted[0].id : "")));
    p.rows.replaceChildren(...rows.slice(0, lines()));
    // (Ads Manager where Social's own card sends it)
    const ads = p.foot.querySelector(".od-ads");
    if (ads && S.adsUrl) ads.href = S.adsUrl;
  }

  // ---- The Funnel: sending or paused, the warm-up, the counts ----
  function funnel() {
    const p = P && P.funnel;
    if (!p) return;
    const F = got.funnel;
    if (!F) return;
    if (F.error) return failed(p, F.error);
    const s = F.settings || {};
    const t = F.today || {};
    const c = F.counts || {};
    const hh = (h) => String(h).padStart(2, "0") + ":00";
    p.big.textContent = s.paused ? "Paused" : "Sending";
    p.small.textContent = s.paused ? (s.pausedWhy || "Nothing goes until it's started").replace(/\.$/, "") : t.inHours ? "Within today's sending hours" : `Waits for ${hh(s.fromHour)} to ${hh(s.toHour)} UK${s.weekdaysOnly ? ", Mon to Fri" : ""}`;
    const rows = [];
    // (anything that stops it working comes first)
    if (F.ready && !F.ready.gmail) rows.push(line("Gmail isn't connected for sending", "Admin → Google", () => go("/portal/?view=google")));
    rows.push(line(`Warm-up day ${t.day || 1}`, `${num(t.sent)} of ${num(t.limit)} sent today`, () => openFunnel("warming")));
    rows.push(line("Next email", s.paused ? "Paused" : t.nextAt ? "After " + new Date(t.nextAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : c.warming ? "Within a minute or two" : "Nothing in the queue", () => openFunnel("warming")));
    rows.push(line("On the list", `${num(c.pending)} pending · ${num(c.warming)} warming`, () => openFunnel(c.written ? "approve" : "write")));
    rows.push(line("Emailed", `${num(c.sent)} sent · ${num(c.replied)} replied` + (c.replyRate != null ? ` (${c.replyRate}%)` : "") + (c.bounced ? ` · ${num(c.bounced)} bounced` : ""), () => openFunnel(c.replied ? "replied" : "sent")));
    p.rows.replaceChildren(...rows.slice(0, lines()));
    // Start or Pause, and Write drafts: the Funnel's own buttons pressed (funnel.js), so they do just what they do there
    const run = p.foot.querySelector(".od-run");
    run.textContent = s.paused ? "Start sending" : "Pause sending";
    run.hidden = Boolean(s.paused && !F.canDecide);
    const write = p.foot.querySelector(".od-draft");
    const left = (F.prospects || []).filter((x) => x.step === "write").length;
    write.textContent = left > 5 ? "Write next 5" : "Write drafts";
    write.hidden = !left;
    write.disabled = false;
  }
  // The Funnel's room, showing what was asked for (funnel.js reads ?funnel=; from Open ›, whatever needs doing first)
  const openFunnel = (filter) => go("/portal/?view=funnel" + (filter ? "&funnel=" + filter : ""));

  // ---- The forms, in place of the panels (outreach-dash.css): the rooms' own, opened by their own buttons ----
  // Don't email again and the Fan sign-up link have no button of their own: these open and close them
  function toggle(id, focus) {
    const box = $(id);
    box.hidden = !box.hidden;
    if (!box.hidden) {
      const f = focus && $(focus);
      (f || box.querySelector("button, a, input") || box).focus({ preventScroll: true });
    }
  }
  function wire() {
    const write = $("outreach-write");
    if (!write || write.dataset.wired) return;
    write.dataset.wired = "1";
    // (a form sent: its part is read again when its code has saved it, and drawn afresh, app.js / social.js /
    // funnel.js hand it back)
    write.addEventListener("submit", (e) => {
      const id = e.target && e.target.id;
      want.add(id === "social-form" ? "social" : id === "funnel-import" ? "funnel" : id === "campaigns-form" ? "campaigns" : "outreach");
    });
    // (closed: back to the button that opened it, on the panels again)
    const back = (closer, opener) => $(closer) && $(closer).addEventListener("click", () => requestAnimationFrame(() => $(opener) && $(opener).focus({ preventScroll: true })));
    back("cp-new-cancel", "campaigns-new");
    back("or-new-cancel", "outreach-new");
    back("sc-new-cancel", "social-new");
    back("funnel-import-cancel", "funnel-import-open");
    $("or-optout-close").addEventListener("click", () => {
      $("outreach-optout").hidden = true;
      const b = document.querySelector(".od-optout-open");
      if (b) b.focus({ preventScroll: true });
    });
    $("od-signup-close").addEventListener("click", () => {
      $("od-signup").hidden = true;
      const b = document.querySelector(".od-signup-open");
      if (b) b.focus({ preventScroll: true });
    });
  }

  // ---- The dashboard: drawn each time it's opened, from what's known, then again as each part comes ----
  function show() {
    const grid = $("outreach-grid");
    if (!grid) return;
    wire();
    rejecting = null;
    // (a form left open when the dashboard was last left is still open, with what was written: the panels come
    // back when it's sent or closed)
    P = {
      approve: panel("approve", "To approve", "Approvals"),
      funnel: panel("funnel", "Funnel", "Funnel", () => openFunnel()),
      campaigns: panel("campaigns", "Campaigns", "Campaigns", () => go("/portal/?view=campaigns")),
      social: panel("social", "Social", "Social", () => go("/portal/?view=social")),
    };
    P.approve.foot.remove();
    P.funnel.foot.append(
      button("Pause sending", "btn small od-run", () => {
        want.add("funnel");
        own("funnel-run").click();
      }),
      own("funnel-import-open"),
      button("Write drafts", "chip od-draft", (b) => {
        want.add("funnel");
        b.disabled = true;
        b.textContent = "Writing…";
        own("funnel-draft").click();
      })
    );
    P.campaigns.foot.append(own("campaigns-new"), own("outreach-new"));
    const ads = el("a", "chip od-ads", "Ads Manager ↗");
    ads.href = "https://adsmanager.facebook.com/";
    ads.target = "_blank";
    ads.rel = "noopener";
    P.social.foot.append(
      own("social-new"),
      button("Ideas and trends", "chip", () => window.PortalSocial && window.PortalSocial.ideas()),
      ads
    );
    for (const b of P.funnel.foot.querySelectorAll(".od-run, .od-draft")) b.hidden = true;
    grid.replaceChildren(P.approve.box, P.funnel.box, P.campaigns.box, P.social.box);
    // (what's known already drawn at once, so nothing flickers to "…" and back; then fresh)
    for (const part of ["campaigns", "outreach", "social", "funnel"]) if (got[part]) draw(part);
    load(["campaigns", "social", "funnel"]);
  }

  window.PortalOutreach = { show, took };
})();
