// Nova Phone: Outreach (Nova Desk's Portal → Campaigns, One-to-one emails, Social and Funnel). Everything that
// goes out waits for an admin's approval, as on Nova Desk; nothing here sends by itself.
//   Campaigns    emails to fans, clients or everyone: write, change, approve (now or at a time), reject, test
//   One-to-one   single emails (to a business, a client, someone who wrote in): the same, and "don't email again"
//   Social       posts (Facebook, Instagram, YouTube): write, approve, post by hand, results; comments to answer
//   Funnel       prospects, drafts Claude writes, the warm-up sender: approve, hold, replied, settings
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, row, list, field, toggle, empty, api, post, toast, confirm, choose, form: sheetForm, busy, ago } = N;
  const A = "/app/api/";
  const PARTS = [["campaigns", "Campaigns"], ["one", "One-to-one"], ["social", "Social"], ["funnel", "Funnel"]];
  const partTabs = (on) => `<div class="seg">${PARTS.map(([p, l]) => `<a class="seg-a" href="#outreach${p === "campaigns" ? "" : `/${p}`}" aria-selected="${p === on}">${l}</a>`).join("")}</div>`;
  const STATUS = { draft: "Draft", pending_approval: "Waiting for approval", approved: "Approved · sending", scheduled: "Scheduled", sending: "Sending", posting: "Posting…", manual: "Post it by hand", sent: "Sent", posted: "Posted", failed: "Didn't go", rejected: "Rejected" };
  const pill = (s) => `<span class="pill ${["failed", "rejected"].includes(s) ? "bad" : ["sent", "posted"].includes(s) ? "ok" : ["pending_approval", "manual"].includes(s) ? "warn" : ""}">${esc(STATUS[s] || s)}</span>`;
  const when = (s) => (s ? new Date(s).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
  const sheet = (title, inner, read) => sheetForm(`<h2 class="sheet-title">${esc(title)}</h2><form class="form" data-f>${inner}<div class="btns"><button class="btn main wide" type="submit">Save</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
    (el, done) => { el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); done(read(ev.target.elements)); }; el.querySelector("[data-no]").onclick = () => done(null); });

  N.section({
    id: "outreach",
    name: "Outreach",
    tile: "portal",
    async draw(box, [part, a], ui) {
      if (part === "one") return a ? drawOne(box, a, ui) : drawOnes(box, ui);
      if (part === "social") return a ? drawPost(box, a, ui) : drawSocial(box, ui);
      if (part === "comment") return drawComment(box, a, ui);
      if (part === "funnel") return a ? drawProspect(box, a, ui) : drawFunnel(box, ui);
      if (part === "campaign") return drawCampaign(box, a, ui);
      return drawCampaigns(box, ui);
    },
  });

  // ---- Campaigns ----
  const AUD = [["fans", "Fans"], ["clients", "Studio clients"], ["everyone", "Everyone"]];
  async function drawCampaigns(box, ui) {
    const r = await api(`${A}campaigns`);
    const cs = r.campaigns || [];
    ui.action({ icon: "plus", label: "Write a campaign", run: () => writeCampaign(null, r) });
    const waiting = cs.filter((c) => ["draft", "pending_approval"].includes(c.status)), other = cs.filter((c) => !waiting.includes(c));
    const cRow = (c) => row({ href: `#outreach/campaign/${c.id}`, icon: "mail", title: c.subject || "(No subject)", text: [(AUD.find(([a]) => a === c.audience) || [, c.audience])[1], c.sendAt ? `sends ${when(c.sendAt)}` : c.sentAt ? `sent ${when(c.sentAt)}` : ""].filter(Boolean).join(" · "), end: pill(c.status) });
    box.innerHTML = `${partTabs("campaigns")}
      ${r.audiences ? `<div class="sums">${AUD.map(([k, l]) => `<div class="sum"><b>${r.audiences[k] ?? 0}</b><span>${l}</span></div>`).join("")}</div><p class="muted small">Who can be emailed: only people who said yes.</p>` : ""}
      ${waiting.length ? `<h3 class="h">Waiting</h3>${list(waiting.map(cRow))}` : ""}
      ${other.length ? `<h3 class="h">Sent and scheduled</h3>${list(other.map(cRow))}` : ""}
      ${!cs.length ? empty({ icon: "mail", title: "No campaigns yet", action: `<button type="button" class="btn main" data-write>${icon("plus")} Write one</button>` }) : ""}
      ${r.signupUrl ? `<div class="card"><p class="kicker">Fan sign-up link</p><p class="small pre">${esc(r.signupUrl)}</p><button type="button" class="btn" data-copy="${esc(r.signupUrl)}">Copy the link</button></div>` : ""}`;
    box.querySelector("[data-write]")?.addEventListener("click", () => writeCampaign(null, r));
    box.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast("Copied"); } catch (e) { toast("Couldn't copy", true); } }));
  }
  async function writeCampaign(c, r) {
    const v = await sheet(c ? "Change the campaign" : "Write a campaign", `${field({ label: "Subject", name: "subject", value: c?.subject || "" })}${field({ label: "The email", name: "body", type: "textarea", rows: 8, value: c?.body || "" })}${field({ label: "Who it goes to", name: "audience", type: "select", value: c?.audience || "fans", options: AUD.map(([k, l]) => [k, `${l}${r?.audiences ? ` (${r.audiences[k] ?? 0})` : ""}`]) })}${field({ label: "Send at (UK time; empty: as soon as it's approved)", name: "sendAt", type: "datetime-local", value: c?.sendAt ? c.sendAt.slice(0, 16) : "" })}`,
      (x) => ({ subject: x.subject.value.trim(), body: x.body.value, audience: x.audience.value, sendAt: x.sendAt.value || "" }));
    if (!v) return;
    try { const res = await post(c ? `${A}campaigns/${c.id}/edit` : `${A}campaigns`, v); toast(c ? "Saved" : "Saved for approval"); location.hash = `#outreach/campaign/${(res.campaign || c).id}`; N.show(); } catch (err) { toast(err.message, true); }
  }
  async function drawCampaign(box, id, ui) {
    ui.back("#outreach");
    const [r, all] = await Promise.all([api(`${A}campaigns/${id}`), api(`${A}campaigns`)]);
    const c = r.campaign;
    if (!c) { box.innerHTML = empty({ icon: "mail", title: "That campaign isn't there" }); return; }
    ui.title("Campaign");
    const can = all.canDecide, waiting = ["draft", "pending_approval"].includes(c.status);
    box.innerHTML = `<div class="card"><p class="kicker">${esc(STATUS[c.status] || c.status)}</p><h2 class="card-title">${esc(c.subject || "")}</h2>
        <div class="facts">${[["Goes to", `${(AUD.find(([a]) => a === c.audience) || [, c.audience])[1]}${c.recipients ? ` · ${c.recipients} people` : ""}`], ["Sends", c.sendAt ? when(c.sendAt) : waiting ? "Once approved" : ""], ["Sent", when(c.sentAt)], [c.status === "rejected" ? "Rejected by" : "Approved by", c.decidedByName], ["Note", c.note], ["Problem", c.error]].filter(([, v]) => v).map(([k, v]) => `<div class="fact"><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div>
        ${c.sending ? `<p class="small">${esc(`${c.sending.sent || 0} of ${c.sending.total || c.recipients || 0} sent`)}</p>` : ""}</div>
      <details class="card" open><summary>The email</summary><p class="pre">${esc(c.body || "")}</p></details>
      ${waiting && can ? `<div class="btns two"><button type="button" class="btn main" data-c="approve">${icon("send")} Approve</button><button type="button" class="btn danger" data-c="reject">Reject</button></div>` : waiting ? `<p class="muted small">An admin approves it before it goes.</p>` : ""}
      <div class="btns two">${waiting ? `<button type="button" class="btn" data-c="edit">${icon("edit")} Change it</button>` : ""}${can ? `<button type="button" class="btn" data-c="test">Send me a test</button>` : ""}</div>
      ${(r.log || []).length ? `<details class="card"><summary>What happened</summary>${list(r.log.map((l) => row({ icon: "clock", title: l.detail || l.event, text: [ago(l.at), l.byName].filter(Boolean).join(" · ") })))}</details>` : ""}`;
    box.querySelectorAll("[data-c]").forEach((b) => b.addEventListener("click", async () => {
      const what = b.dataset.c;
      try {
        if (what === "edit") return writeCampaign(c, all);
        if (what === "test") { await busy(b, "Sending…", () => post(`${A}campaigns/test-send`, { id: c.id })); return toast("Test sent to you"); }
        if (what === "approve") {
          const fresh = (await api(`${A}campaigns/${id}`)).campaign;
          if (fresh.updatedAt !== c.updatedAt) { toast("It was changed meanwhile: look again", true); return N.show(); }
          if (!(await confirm({ title: c.sendAt ? `Schedule it for ${when(c.sendAt)}?` : `Send it to ${c.recipients || "everyone in the audience"} now?`, ok: c.sendAt ? "Schedule" : "Send it" }))) return;
          await post(`${A}campaigns/${c.id}/approve`, {}); toast(c.sendAt ? "Scheduled" : "Sending");
        }
        if (what === "reject") { const v = await sheet("Reject the campaign", field({ label: "Why (optional)", name: "note", type: "textarea", rows: 3 }), (x) => ({ note: x.note.value })); if (!v) return; await post(`${A}campaigns/${c.id}/reject`, v); toast("Rejected"); }
        N.show();
      } catch (err) { toast(err.message, true); }
    }));
  }

  // ---- One-to-one emails ----
  const KINDS = [["business", "A business"], ["client", "A studio client"], ["reply", "Someone who wrote in"]];
  async function drawOnes(box, ui) {
    const r = await api(`${A}outreach`);
    const os = r.outreach || r.items || [];
    ui.action({ icon: "plus", label: "Write one", run: () => writeOne(null) });
    const oRow = (o) => row({ href: `#outreach/one/${o.id}`, icon: "mail", title: o.subject || "(No subject)", text: [o.toName || o.toEmail, o.organisation].filter(Boolean).join(" · "), end: pill(o.status) });
    const waiting = os.filter((o) => ["draft", "pending_approval"].includes(o.status));
    box.innerHTML = `${partTabs("one")}
      ${waiting.length ? `<h3 class="h">Waiting</h3>${list(waiting.map(oRow))}` : ""}
      ${os.filter((o) => !waiting.includes(o)).length ? `<h3 class="h">Sent and not sent</h3>${list(os.filter((o) => !waiting.includes(o)).map(oRow))}` : ""}
      ${!os.length ? empty({ icon: "mail", title: "No one-to-one emails yet" }) : ""}
      <form class="form card" id="optout"><p class="kicker">Someone said “no thanks”?</p>${field({ label: "Their email", name: "email", type: "email" })}<button class="btn wide" type="submit">Don't email them again</button></form>`;
    box.querySelector("#optout").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = e.target.elements.email.value.trim();
      if (!email) return;
      try { await post(`${A}outreach/optouts`, { email }); e.target.reset(); toast(`${email} won't be emailed again`); } catch (err) { toast(err.message, true); }
    });
  }
  async function writeOne(o) {
    const v = await sheet(o ? "Change the email" : "Write a one-to-one email", `${field({ label: "Who it's to", name: "kind", type: "select", value: o?.kind || "business", options: KINDS })}${field({ label: "Their email", name: "toEmail", type: "email", value: o?.toEmail || "" })}${field({ label: "Their name", name: "toName", value: o?.toName || "" })}${field({ label: "Business or organisation", name: "organisation", value: o?.organisation || "" })}${toggle({ label: "It's about their own booking", name: "aboutBooking", checked: !!o?.aboutBooking })}${field({ label: "Subject", name: "subject", value: o?.subject || "" })}${field({ label: "The email", name: "body", type: "textarea", rows: 8, value: o?.body || "" })}`,
      (x) => ({ kind: x.kind.value, toEmail: x.toEmail.value.trim(), toName: x.toName.value.trim(), organisation: x.organisation.value.trim(), aboutBooking: x.aboutBooking.checked, subject: x.subject.value.trim(), body: x.body.value }));
    if (!v) return;
    try { const r = await post(o ? `${A}outreach/${o.id}/edit` : `${A}outreach`, v); toast(o ? "Saved" : "Saved for approval"); location.hash = `#outreach/one/${(r.outreach || o).id}`; N.show(); } catch (err) { toast(err.message, true); }
  }
  async function drawOne(box, id, ui) {
    ui.back("#outreach/one");
    const [r, all] = await Promise.all([api(`${A}outreach/${id}`), api(`${A}outreach`)]);
    const o = r.outreach;
    if (!o) { box.innerHTML = empty({ icon: "mail", title: "That email isn't there" }); return; }
    ui.title("One-to-one email");
    const can = all.canDecide, waiting = ["draft", "pending_approval"].includes(o.status);
    box.innerHTML = `<div class="card"><p class="kicker">${esc(STATUS[o.status] || o.status)}</p><h2 class="card-title">${esc(o.subject || "")}</h2>
        <div class="facts">${[["To", `${o.toName ? `${o.toName} · ` : ""}${o.toEmail}`], ["Who they are", (KINDS.find(([k]) => k === o.kind) || [, o.kind])[1]], ["Organisation", o.organisation], ["Sent", when(o.sentAt)], [o.status === "rejected" ? "Rejected by" : "Approved by", o.decidedByName], ["Problem", o.error]].filter(([, v]) => v).map(([k, v]) => `<div class="fact"><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div></div>
      <details class="card" open><summary>The email</summary><p class="pre">${esc(o.body || "")}</p></details>
      ${waiting && can ? `<div class="btns two"><button type="button" class="btn main" data-o="approve">${icon("send")} Approve &amp; send</button><button type="button" class="btn danger" data-o="reject">Reject</button></div>` : waiting ? `<p class="muted small">An admin approves it before it goes.</p>` : ""}
      <div class="btns two">${waiting ? `<button type="button" class="btn" data-o="edit">${icon("edit")} Change it</button>` : ""}${can ? `<button type="button" class="btn" data-o="test">Send me a test</button>` : ""}</div>`;
    box.querySelectorAll("[data-o]").forEach((b) => b.addEventListener("click", async () => {
      const what = b.dataset.o;
      try {
        if (what === "edit") return writeOne(o);
        if (what === "test") { await post(`${A}outreach/test-send`, { id: o.id }); return toast("Test sent to you"); }
        if (what === "approve") { if (!(await confirm({ title: `Send it to ${o.toEmail} now?`, ok: "Send it" }))) return; await post(`${A}outreach/${o.id}/approve`, {}); toast("Sent"); }
        if (what === "reject") { const v = await sheet("Reject the email", field({ label: "Why (optional)", name: "note", type: "textarea", rows: 3 }), (x) => ({ note: x.note.value })); if (!v) return; await post(`${A}outreach/${o.id}/reject`, v); toast("Rejected"); }
        N.show();
      } catch (err) { toast(err.message, true); }
    }));
  }

  // ---- Social ----
  const PLATFORMS = [["facebook", "Facebook"], ["instagram", "Instagram"], ["youtube", "YouTube"]];
  async function drawSocial(box, ui) {
    const r = await api(`${A}social`);
    const posts = r.posts || [], comments = (r.comments || []).filter((c) => !c.handled);
    ui.action({ icon: "plus", label: "Write a post", run: () => writePost(null) });
    const pRow = (p) => row({ href: `#outreach/social/${p.id}`, icon: "share", title: (p.caption || "(No words)").slice(0, 80), text: [(p.platforms || []).map((x) => (PLATFORMS.find(([k]) => k === x) || [, x])[1]).join(", "), p.postAt ? when(p.postAt) : "", (p.media || []).length ? `${p.media.length} picture${p.media.length > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · "), end: pill(p.status) });
    const groups = [["Waiting", (p) => ["draft", "pending_approval"].includes(p.status)], ["Post these by hand", (p) => p.status === "manual"], ["Coming up", (p) => ["approved", "scheduled", "posting"].includes(p.status)], ["Posted", (p) => p.status === "posted"], ["Didn't post or rejected", (p) => ["failed", "rejected"].includes(p.status)]];
    box.innerHTML = `${partTabs("social")}
      ${r.followers ? `<div class="sums">${Object.entries(r.followers).map(([k, v]) => `<div class="sum"><b>${esc(v?.count ?? v)}</b><span>${esc(k)}</span></div>`).join("")}</div>` : ""}
      ${r.connected ? "" : `<p class="muted small">Not connected to Meta yet: approved posts are posted by hand.</p>`}
      ${comments.length ? `<h3 class="h">Comments to answer · ${comments.length}</h3>${list(comments.map((c) => row({ href: `#outreach/comment/${c.id}`, icon: "chat", title: `${c.author || "Someone"} on ${c.platform}`, text: String(c.text || "").slice(0, 120), end: c.replyStatus ? `<span class="pill">${esc(c.replyStatus)}</span>` : "" })))}` : ""}
      ${groups.map(([name, test]) => { const these = posts.filter(test); return these.length ? `<h3 class="h">${name}</h3>${list(these.map(pRow))}` : ""; }).join("") || empty({ icon: "share", title: "No posts yet" })}
      ${r.adsUrl ? `<a class="btn wide" href="${esc(r.adsUrl)}" target="_blank" rel="noopener">Paid ads: Ads Manager</a>` : ""}`;
  }
  async function writePost(p) {
    const v = await sheet(p ? "Change the post" : "Write a post", `${field({ label: "The words", name: "caption", type: "textarea", rows: 6, value: p?.caption || "" })}<fieldset class="field"><legend>Where</legend><div class="chips">${PLATFORMS.map(([k, l]) => `<label class="chip check-chip"><input type="checkbox" name="pl" value="${k}"${(p?.platforms || ["instagram", "facebook"]).includes(k) ? " checked" : ""}>${l}</label>`).join("")}</div></fieldset>${p ? "" : `<label class="field"><span>Pictures or videos (optional)</span><input class="input file" type="file" name="media" accept="image/*,video/*" multiple></label>`}${field({ label: "Post at (UK time; empty: as soon as it's approved)", name: "postAt", type: "datetime-local", value: p?.postAt ? p.postAt.slice(0, 16) : "" })}`,
      (x) => ({ caption: x.caption.value, platforms: [...x].filter((el) => el.name === "pl" && el.checked).map((c) => c.value), files: x.media ? [...x.media.files] : [], postAt: x.postAt.value || "" }));
    if (!v) return;
    try {
      const media = p ? p.media : [];
      for (const file of v.files) {
        toast(`Uploading ${file.name}…`);
        const res = await fetch(`/actions/social-media?name=${encodeURIComponent(file.name)}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": file.type || "application/octet-stream", "X-Nova-Visualizer": "1" }, body: file });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !(d.media || d.file || d.id)) throw new Error(res.status === 503 ? "Pictures go through the studio's computer, which is off: try later, or post without them." : d.message || d.error || "It didn't upload");
        media.push(d.media || d.file || { id: d.id, ext: file.name.split(".").pop(), name: file.name, size: file.size });
      }
      const r = await post(p ? `${A}social/${p.id}/edit` : `${A}social`, { caption: v.caption, platforms: v.platforms, media, postAt: v.postAt });
      toast(p ? "Saved" : "Saved for approval");
      location.hash = `#outreach/social/${(r.post || p).id}`; N.show();
    } catch (err) { toast(err.message, true); }
  }
  async function drawPost(box, id, ui) {
    ui.back("#outreach/social");
    const r = await api(`${A}social`);
    const p = (r.posts || []).find((x) => String(x.id) === String(id));
    if (!p) { box.innerHTML = empty({ icon: "share", title: "That post isn't there" }); return; }
    ui.title("Post");
    const can = r.canDecide, waiting = ["draft", "pending_approval"].includes(p.status);
    const t = p.targets || {};
    box.innerHTML = `<div class="card"><p class="kicker">${esc(STATUS[p.status] || p.status)}</p><p class="pre">${esc(p.caption || "")}</p>
        <div class="facts">${[["Where", (p.platforms || []).join(", ")], ["Posts", p.postAt ? when(p.postAt) : waiting ? "Once approved" : ""], ["Posted", when(p.postedAt)], [p.status === "rejected" ? "Rejected by" : "Approved by", p.decidedByName], ["Problem", p.error]].filter(([, v]) => v).map(([k, v]) => `<div class="fact"><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div>
        ${Object.keys(t).length ? `<div class="facts">${Object.entries(t).map(([k, v]) => `<div class="fact"><span>${esc(k)}</span><b>${esc(v?.status || "")}${v?.url ? ` · <a href="${esc(v.url)}" target="_blank" rel="noopener">open it</a>` : ""}</b></div>`).join("")}</div>` : ""}
        ${p.stats ? `<p class="small muted">${esc(Object.entries(p.stats).map(([k, v]) => `${v} ${k}`).join(" · "))}</p>` : ""}</div>
      ${(p.media || []).length ? `<p class="muted small">${p.media.length} picture${p.media.length > 1 ? "s" : ""} or video${p.media.length > 1 ? "s" : ""} with it.</p>` : ""}
      ${waiting && can ? `<div class="btns two"><button type="button" class="btn main" data-p="approve">${icon("check")} Approve</button><button type="button" class="btn danger" data-p="reject">Reject</button></div>` : waiting ? `<p class="muted small">An admin approves it before it's posted.</p>` : ""}
      ${p.status === "manual" ? `<div class="card"><p class="kicker">Post it by hand</p><button type="button" class="btn wide" data-p="copy">Copy the words</button>${(p.platforms || []).map((k) => `<button type="button" class="btn wide" data-posted="${k}">I posted it on ${esc((PLATFORMS.find(([x]) => x === k) || [, k])[1])}</button>`).join("")}</div>` : ""}
      ${waiting ? `<button type="button" class="btn wide" data-p="edit">${icon("edit")} Change it</button>` : ""}`;
    box.querySelectorAll("[data-p]").forEach((b) => b.addEventListener("click", async () => {
      const what = b.dataset.p;
      try {
        if (what === "edit") return writePost(p);
        if (what === "copy") { await navigator.clipboard.writeText(p.caption || ""); return toast("Copied"); }
        if (what === "approve") { if (!(await confirm({ title: p.postAt ? `Post it at ${when(p.postAt)}?` : "Post it now?", ok: "Approve" }))) return; await post(`${A}social/${p.id}/approve`, {}); toast("Approved"); }
        if (what === "reject") { const v = await sheet("Reject the post", field({ label: "Why (optional)", name: "note", type: "textarea", rows: 3 }), (x) => ({ note: x.note.value })); if (!v) return; await post(`${A}social/${p.id}/reject`, v); toast("Rejected"); }
        N.show();
      } catch (err) { toast(err.message, true); }
    }));
    box.querySelectorAll("[data-posted]").forEach((b) => b.addEventListener("click", async () => {
      const v = await sheet("Where is it?", field({ label: "Its address (optional)", name: "url", type: "url" }), (x) => ({ url: x.url.value.trim() }));
      if (!v) return;
      try { await post(`${A}social/${p.id}/posted`, { platform: b.dataset.posted, url: v.url }); toast("Marked as posted"); N.show(); } catch (err) { toast(err.message, true); }
    }));
  }
  async function drawComment(box, id, ui) {
    ui.back("#outreach/social");
    const r = await api(`${A}social`);
    const c = (r.comments || []).find((x) => String(x.id) === String(id));
    if (!c) { box.innerHTML = empty({ icon: "chat", title: "That comment isn't there" }); return; }
    ui.title("Comment");
    box.innerHTML = `<div class="card"><p class="kicker">${esc(c.author || "Someone")} on ${esc(c.platform)} · ${esc(ago(c.commentedAt))}</p><p class="pre">${esc(c.text)}</p>${c.postCaption ? `<p class="muted small">On: ${esc(String(c.postCaption).slice(0, 120))}</p>` : ""}</div>
      ${c.reply ? `<div class="card"><p class="kicker">The reply · ${esc(c.replyStatus || "")}</p><p class="pre">${esc(c.reply)}</p>${c.replyError ? `<p class="bad small">${esc(c.replyError)}</p>` : ""}</div>` : ""}
      ${c.reply && c.replyStatus === "pending_approval" && r.canDecide ? `<div class="btns two"><button type="button" class="btn main" data-cm="approve">Approve the reply</button><button type="button" class="btn danger" data-cm="reject">Reject</button></div>` : ""}
      <form class="form" id="reply">${field({ label: c.reply ? "Change the reply" : "Your reply (an admin approves it)", name: "text", type: "textarea", rows: 4, value: c.reply || "" })}<button class="btn main wide" type="submit">Save the reply for approval</button></form>
      <button type="button" class="btn wide" data-cm="handled">${c.handled ? "Not dealt with" : "Dealt with"}</button>`;
    box.querySelector("#reply").addEventListener("submit", async (e) => { e.preventDefault(); try { await post(`${A}social/comments/${c.id}/reply`, { text: e.target.elements.text.value }); toast("Saved for approval"); N.show(); } catch (err) { toast(err.message, true); } });
    box.querySelectorAll("[data-cm]").forEach((b) => b.addEventListener("click", async () => {
      const what = b.dataset.cm;
      try { await post(`${A}social/comments/${c.id}/${what}`, what === "handled" ? { handled: !c.handled } : {}); toast({ approve: "Approved", reject: "Rejected", handled: "Done" }[what]); N.show(); } catch (err) { toast(err.message, true); }
    }));
  }

  // ---- Funnel ----
  const STEPS = [["approve", "To approve"], ["write", "To write"], ["blocked", "Can't email"], ["warming", "Warming"], ["sent", "Sent"], ["replied", "Replied"], ["bounced", "Bounced"], ["all", "Everyone"]];
  let step = "approve";
  async function drawFunnel(box, ui) {
    const r = await api(`${A}funnel`);
    const ps = r.prospects || [], c = r.counts || {}, s = r.settings || {};
    const shown = ps.filter((p) => step === "all" || p.step === step || p.status === step).slice(0, 60);
    box.innerHTML = `${partTabs("funnel")}
      <div class="card"><p class="kicker">${s.paused ? "Paused" : "Sending"}</p><p class="small">${esc([r.ready?.gmail ? "Gmail ready" : "Gmail not ready", r.ready?.claude ? "Claude ready" : "Claude not ready", r.today ? `${r.today.sent ?? 0} of ${r.today.cap ?? "?"} today` : ""].filter(Boolean).join(" · "))}</p>
        <div class="btns two"><button type="button" class="btn" data-fn="draft">Write next 5</button>${r.canDecide || s.paused === false ? `<button type="button" class="btn" data-fn="pause">${s.paused ? "Start sending" : "Pause sending"}</button>` : ""}</div></div>
      <div class="sums">${[["Pending", c.pending], ["Warming", c.warming], ["Sent", c.sent], ["Replied", c.replied]].map(([l, v]) => `<div class="sum"><b>${v ?? 0}</b><span>${l}</span></div>`).join("")}</div>
      <div class="chips">${STEPS.map(([k, l]) => `<button type="button" class="chip" data-step="${k}" aria-pressed="${k === step}">${l}</button>`).join("")}</div>
      ${step === "approve" && r.canDecide && shown.length ? `<button type="button" class="btn main wide" data-fn="approveall">${icon("check")} Approve all ${shown.length}</button>` : ""}
      ${shown.length ? list(shown.map((p) => row({ href: `#outreach/funnel/${p.id}`, icon: "user", title: p.name || p.email, text: [p.company, p.roleName, p.subject].filter(Boolean).join(" · "), end: `<span class="pill">${esc((STEPS.find(([k]) => k === p.step) || [, p.status])[1])}</span>` }))) : empty({ icon: "globe", title: "No one here" })}`;
    box.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => { step = b.dataset.step; N.show(); }));
    box.querySelectorAll("[data-fn]").forEach((b) => b.addEventListener("click", async () => {
      const what = b.dataset.fn;
      try {
        if (what === "draft") { await busy(b, "Writing…", () => post(`${A}funnel/draft`, {})); toast("Drafts written"); }
        if (what === "pause") { await post(`${A}funnel/pause`, { paused: !s.paused }); toast(s.paused ? "Sending" : "Paused"); }
        if (what === "approveall") { if (!(await confirm({ title: `Queue all ${shown.length} to send?`, text: "They go out a few a day, as the warm-up allows.", ok: "Approve all" }))) return; await post(`${A}funnel/approve`, { items: shown.map((p) => ({ id: p.id, updatedAt: p.updatedAt })) }); toast("Queued"); }
        N.show();
      } catch (err) { toast(err.message, true); }
    }));
  }
  async function drawProspect(box, id, ui) {
    ui.back("#outreach/funnel");
    const r = await api(`${A}funnel/${id}`);
    const p = r.prospect;
    if (!p) { box.innerHTML = empty({ icon: "user", title: "That prospect isn't there" }); return; }
    ui.title(p.name || "Prospect");
    const all = await api(`${A}funnel`).catch(() => ({}));
    box.innerHTML = `<div class="card"><p class="kicker">${esc((STEPS.find(([k]) => k === p.step) || [, p.status])[1])}</p><h2 class="card-title">${esc(p.name || "")}</h2>
        <div class="facts">${[["Email", p.email], ["Company", p.company], ["Role", p.roleName], ["Why", p.roleWhy], ["Sent", ago(p.sentAt)], ["Replied", ago(p.repliedAt)], ["Stopped because", p.stopReason]].filter(([, v]) => v).map(([k, v]) => `<div class="fact"><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div>
        ${p.scores ? `<p class="small muted">${esc(["deliverability", "open", "reply"].map((k) => (p.scores[k] !== undefined ? `${k} ${p.scores[k]}/10` : "")).filter(Boolean).join(" · "))}</p>` : ""}</div>
      ${p.subject || p.body ? `<details class="card" open><summary>${esc(p.subject || "The email")}</summary><p class="pre">${esc(p.body || "")}</p></details>` : ""}
      <div class="btns two">
        ${p.step === "approve" && all.canDecide ? `<button type="button" class="btn main" data-pp="approve">${icon("check")} Approve</button>` : ""}
        <button type="button" class="btn" data-pp="draft">${p.body ? "Rewrite it" : "Write it"}</button>
        <button type="button" class="btn" data-pp="edit">${icon("edit")} Change</button>
        <button type="button" class="btn" data-pp="hold">Hold</button>
        <button type="button" class="btn" data-pp="replied">They replied</button>
        <button type="button" class="btn" data-pp="stop">They said no</button>
        <button type="button" class="btn danger" data-pp="remove">${icon("trash")} Remove</button>
      </div>`;
    box.querySelectorAll("[data-pp]").forEach((b) => b.addEventListener("click", async () => {
      const what = b.dataset.pp;
      try {
        if (what === "approve") { if (!(await confirm({ title: "Queue it to send?", ok: "Approve" }))) return; await post(`${A}funnel/approve`, { items: [{ id: p.id, updatedAt: p.updatedAt }] }); }
        else if (what === "draft") await busy(b, "Writing…", () => post(`${A}funnel/draft`, { ids: [p.id] }));
        else if (what === "edit") { const v = await sheet("Change", `${field({ label: "Name", name: "name", value: p.name || "" })}${field({ label: "Company or project", name: "company", value: p.company || "" })}${field({ label: "Subject", name: "subject", value: p.subject || "" })}${field({ label: "The email", name: "body", type: "textarea", rows: 8, value: p.body || "" })}${field({ label: "Bio and notes", name: "bio", type: "textarea", rows: 3, value: p.bio || "" })}`, (x) => ({ name: x.name.value, company: x.company.value, subject: x.subject.value, body: x.body.value, bio: x.bio.value })); if (!v) return; await post(`${A}funnel/${p.id}/edit`, v); }
        else { if (["stop", "remove"].includes(what) && !(await confirm({ title: what === "stop" ? "They said no: never email them?" : "Remove them from the funnel?", ok: what === "stop" ? "Never email" : "Remove", danger: true }))) return; await post(`${A}funnel/${p.id}/${what}`, what === "stop" ? { why: "Said no" } : {}); }
        toast("Done"); what === "remove" ? (location.hash = "#outreach/funnel") : N.show();
      } catch (err) { toast(err.message, true); }
    }));
  }
})();
