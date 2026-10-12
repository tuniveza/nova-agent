// Portal → Social: Facebook, Instagram and YouTube posts (Nova Bot posts them through Meta and Google, src/social.js
// there). Anyone signed in writes a post and adds its pictures and videos (kept on the studio
// computer: src/social-media.ts in Nova Agent); nothing is posted until an admin approves it here.
// Without Meta connected, an approved post waits for someone to post it by hand: the words and files
// are here to copy and download, then "I posted it". Comments on the studio's posts come in every
// hour; replies wait for an admin's Approve too. Everything from the server is shown as plain text.
// app.js shows this section (window.PortalSocial.load) and lends its helpers (PortalApp.kit).

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const K = () => window.PortalApp.kit;
  const el = (...a) => K().el(...a);

  const STATUS = {
    draft: ["pill-draft", "Draft"],
    pending_approval: ["pill-draft", "Waiting for approval"],
    approved: ["pill-replied", "Approved · starting"],
    scheduled: ["pill-replied", "Scheduled"],
    posting: ["pill-replied", "Posting…"],
    manual: ["pill-replied", "Post it by hand"],
    posted: ["pill-done", "Posted"],
    failed: ["pill-failed", "Didn't post"],
    rejected: ["pill-stop", "Rejected"],
  };
  const NAMES = { facebook: "Facebook", instagram: "Instagram", youtube: "YouTube" };
  const ALL = ["facebook", "instagram", "youtube"];
  const WRITERS = { agent: "Nova Agent", "staff-chat": "Portal's staff chat" };
  const EVENTS = {
    created: "Written", edited: "Changed", submitted: "Sent for approval", approved: "Approved", rejected: "Rejected", scheduled: "Scheduled",
    posting: "Posting", posted: "Posted", manual: "Waiting to be posted by hand", marked_posted: "Posted by hand", failed: "Didn't post", stats: "Results updated",
    reply_drafted: "Reply written", reply_approved: "Reply approved", reply_rejected: "Reply rejected", reply_sent: "Reply posted", reply_failed: "Reply didn't post",
  };
  const IDEAS_PROMPT =
    "Help me plan the studio's social posts for the next week. Look at how our recent posts did (social_context), research what's trending right now for recording studios and UK artists (sounds, formats, hashtags, what similar studios post), then suggest 3 posts: the caption, Facebook or Instagram, the picture or video to use, and the best day and time to post (UK).";
  // Online, Nova Bot's link to the studio computer carries 25 MB at most
  const onStudioPC = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const ONLINE_MAX = 25 * 1024 * 1024;
  const IMAGE_MAX = 8 * 1024 * 1024;

  let data = null; // the last /app/api/social answer
  let editing = null; // the post whose fields are open
  let rejecting = null; // "post:<id>" or "comment:<id>" whose "why" box is open
  let picked = null; // the ?post= / ?comment= already pointed at
  const logOpen = new Set(); // posts whose history is showing
  const logs = new Map(); // id -> { updatedAt, log }
  const replyText = new Map(); // comment id -> what's typed so far
  let draft = null; // the new post being written: { caption, platforms, media, when }
  let timer = 0;
  let drawn = 0;

  const waiting = (p) => p.status === "pending_approval" || p.status === "draft";
  const people = (n) => (Number(n) || 0).toLocaleString("en-GB");
  const hashtags = (t) => (String(t).match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length;
  const firstLine = (t) => String(t || "").split("\n").map((x) => x.trim()).find(Boolean) || "";
  const dayName = (iso) => new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" });

  // ===== Loading =====

  async function load() {
    const k = K();
    if (!k.running) return;
    let got;
    try {
      got = await k.api("social");
    } catch (err) {
      if (window.PortalApp.view === "social" && err.message !== "signed out") k.emptyState($("social-list"), err.status === 404 ? "Social isn't switched on yet: Nova Bot needs its update." : "Couldn't load the posts: " + err.message);
      return;
    }
    data = got;
    const posts = data.posts || [];
    k.setBadge("social-badge", posts.filter((p) => p.status === "pending_approval" || p.status === "manual").length);
    k.syncCounts();
    if (window.PortalApp.view !== "social") return;
    // (a post being edited isn't redrawn under someone's fingers: refreshes wait until it's saved)
    if (!editing) draw();
    clearTimeout(timer);
    // Posting, Instagram getting a video ready, new comments: look again in a minute while it's open
    timer = setTimeout(() => !document.hidden && window.PortalApp.view === "social" && load(), 60_000);
  }

  function draw() {
    const k = K();
    const posts = data.posts || [];
    const connected = data.connected || {};
    const on = ALL.filter((p) => connected[p]);
    const off = ALL.filter((p) => !connected[p]);
    const list = (ps) => ps.map((p) => NAMES[p]).join(ps.length === 2 ? " and " : ", ");
    k.setText(
      "social-hint",
      (data.canDecide ? "Facebook, Instagram and YouTube posts. Nothing is posted until you approve it. " : "Facebook, Instagram and YouTube posts. An admin approves these (signed in to Portal in a browser); nothing is posted until then. ") +
        (!off.length ? "Approved posts go out by themselves." : on.length ? `Approved posts go out on ${list(on)} by themselves; ${list(off)} ones wait for someone to post them by hand.` : "Nothing's connected yet, so approved posts wait here for someone to post them by hand.")
    );
    drawGlance(posts);
    const want = Number(new URLSearchParams(location.search).get("post")) || null;
    const by = (key, dir) => (a, b) => dir * String(a[key] || a.updatedAt || "").localeCompare(String(b[key] || b.updatedAt || ""));
    const card = (p) => postCard(p);
    const nodes = [];
    const wait = posts.filter(waiting).sort(by("createdAt", 1));
    nodes.push(...(wait.length ? wait.map(card) : [el("p", "empty", "Nothing waiting for approval.")]));
    const hand = posts.filter((p) => p.status === "manual");
    if (hand.length) nodes.push(el("h3", "group-head", "Post these by hand"), ...hand.map(card));
    // Coming up, by day (UK)
    const coming = posts.filter((p) => ["approved", "scheduled", "posting"].includes(p.status)).sort(by("postAt", 1));
    if (coming.length) {
      nodes.push(el("h3", "group-head", "Coming up"));
      let day = "";
      for (const p of coming) {
        const d = p.postAt ? dayName(p.postAt) : "Now";
        if (d !== day) nodes.push(el("p", "sc-day", (day = d)));
        nodes.push(card(p));
      }
    }
    const posted = posts.filter((p) => p.status === "posted").sort(by("postedAt", -1)).slice(0, 20);
    if (posted.length) nodes.push(el("h3", "group-head", "Posted"), ...posted.map(card));
    const failed = posts.filter((p) => p.status === "failed").sort(by("updatedAt", -1)).slice(0, 10);
    if (failed.length) nodes.push(el("h3", "group-head", "Didn't post"), ...failed.map(card));
    const rejected = posts.filter((p) => p.status === "rejected").sort(by("decidedAt", -1)).slice(0, 10);
    if (rejected.length) nodes.push(el("h3", "group-head", "Rejected"), ...rejected.map(card));
    k.reconcile($("social-list"), nodes);
    $("social-list").removeAttribute("aria-busy");
    drawComments();
    drawTools();
    if (want && picked !== "p" + want) pointAt($("social-list"), "sc-" + want, "p" + want);
  }

  function pointAt(list, key, mark) {
    const node = list.querySelector('[data-key="' + CSS.escape(key) + '"]');
    if (!node) return;
    picked = mark;
    node.classList.add("picked");
    node.scrollIntoView({ block: "center", behavior: K().calm() ? "auto" : "smooth" });
  }

  // ===== At a glance =====

  function drawGlance(posts) {
    const tiles = [];
    const tile = (value, label, sub, go) => {
      const t = el(go ? "button" : "div", "sc-tile");
      if (go) {
        t.type = "button";
        t.addEventListener("click", go);
      }
      t.append(el("b", "", value), el("span", "", label));
      if (sub) t.appendChild(el("small", "", sub));
      tiles.push(t);
    };
    const scrollTo = (id) => () => $(id).scrollIntoView({ block: "start", behavior: K().calm() ? "auto" : "smooth" });
    tile(String(posts.filter(waiting).length), "Waiting for approval", "", scrollTo("social-list"));
    const next = posts.filter((p) => p.status === "scheduled" && p.postAt).sort((a, b) => a.postAt.localeCompare(b.postAt))[0];
    tile(String(posts.filter((p) => p.status === "scheduled").length), "Scheduled", next ? "Next: " + K().ukWhen(next.postAt) : "");
    const f = data.followers || {};
    for (const p of ALL) {
      if (!f[p]) continue;
      const c = Number(f[p].change) || 0;
      tile(people(f[p].followers), NAMES[p] + (p === "youtube" ? " subscribers" : " followers"), (c >= 0 ? "+" : "−") + people(Math.abs(c)) + (p === "youtube" ? " since yesterday" : " in 30 days"));
    }
    const open = (data.comments || []).filter((c) => !c.handled).length;
    tile(String(open), "Comments to answer", "", scrollTo("social-comments-head"));
    $("social-glance").replaceChildren(...tiles);
  }

  // ===== Writing (new, or editing one) =====

  // The fields for a post: the words (with Facebook's and Instagram's counts), the platforms, the
  // pictures and videos (added straight away to the studio computer), and when
  function fields(state, box) {
    box.replaceChildren();
    const limits = (data && data.limits) || { instagramCaption: 2200, instagramHashtags: 30, facebookCaption: 63206, media: 10 };
    const words = el("textarea");
    words.rows = 7;
    words.maxLength = limits.facebookCaption;
    words.value = state.caption || "";
    words.placeholder = "A strong first line. Short lines. A few hashtags at the end (#novacane #foresthill).";
    words.dataset.field = "caption";
    const wordsLabel = el("label", "cp-field cp-wide");
    wordsLabel.append(el("span", "", "The words"), words);
    const count = el("p", "sc-count");
    const recount = () => {
      state.caption = words.value;
      const n = words.value.length;
      const tags = hashtags(words.value);
      const ig = state.platforms.includes("instagram");
      const parts = [];
      if (ig) parts.push([`Instagram ${n.toLocaleString("en-GB")} / ${limits.instagramCaption.toLocaleString("en-GB")}`, n > limits.instagramCaption], [`${tags} / ${limits.instagramHashtags} hashtags`, tags > limits.instagramHashtags]);
      if (state.platforms.includes("facebook")) parts.push([`Facebook ${n.toLocaleString("en-GB")} characters`, false]);
      if (state.platforms.includes("youtube")) {
        const first = (words.value.split("\n").map((l) => l.trim()).find(Boolean) || "");
        parts.push([`YouTube title ${first.length} / ${limits.youtubeTitle || 100} (the first line)`, first.length > (limits.youtubeTitle || 100)], [`description ${n.toLocaleString("en-GB")} / ${(limits.youtubeDescription || 5000).toLocaleString("en-GB")}`, n > (limits.youtubeDescription || 5000)]);
      }
      count.replaceChildren(...parts.map(([t, over]) => el("span", over ? "over" : "", t)));
    };
    words.addEventListener("input", recount);

    const where = el("fieldset", "sc-platforms");
    where.appendChild(el("legend", "", "Where"));
    for (const p of ALL) {
      const l = el("label", "sc-check");
      const box2 = el("input");
      box2.type = "checkbox";
      box2.checked = state.platforms.includes(p);
      box2.addEventListener("change", () => {
        state.platforms = ALL.filter((x) => (x === p ? box2.checked : state.platforms.includes(x)));
        recount();
      });
      l.append(box2, el("span", "", NAMES[p]));
      where.appendChild(l);
    }

    // Pictures and videos
    const media = el("div", "sc-media");
    const drawMedia = () => {
      media.replaceChildren(
        ...state.media.map((m, i) => {
          const fig = thumb(m);
          const x = el("button", "sc-x", "✕");
          x.type = "button";
          x.title = "Take it out of this post";
          x.setAttribute("aria-label", "Take " + (m.name || "it") + " out of this post");
          x.addEventListener("click", () => {
            state.media.splice(i, 1);
            // A file only this new post had goes from the studio computer too
            if (m.fresh) fetch("/actions/social-media/" + m.id + "/remove", { method: "POST", headers: { "X-Nova-Visualizer": "1" }, credentials: "same-origin" }).catch(() => {});
            drawMedia();
          });
          fig.appendChild(x);
          return fig;
        }),
        ...state.uploading.map((u) => el("figure", "sc-thumb busy", u))
      );
    };
    state.redrawMedia = drawMedia;
    const drop = el("div", "sc-drop");
    const pick = el("input");
    pick.type = "file";
    pick.multiple = true;
    pick.accept = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime";
    const add = el("button", "btn small ghost", "Add pictures or videos");
    add.type = "button";
    add.addEventListener("click", () => pick.click());
    pick.addEventListener("change", () => {
      addFiles(state, [...pick.files], problemOf(box));
      pick.value = "";
    });
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("over");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("over");
      addFiles(state, [...(e.dataTransfer?.files || [])], problemOf(box));
    });
    drop.append(
      add,
      pick,
      el("p", "", `Up to ${limits.media}. Pictures become JPEGs (what Instagram takes). Videos: MP4 or MOV${onStudioPC ? "" : ", up to 25 MB from here (bigger ones from the studio computer)"}. They're kept on the studio computer, so it has to be on when the post goes out.`)
    );
    if (!state.media.length && state.platforms.includes("instagram")) drop.appendChild(el("p", "", "Instagram needs at least one before it can be approved."));
    if (state.platforms.includes("youtube")) drop.appendChild(el("p", "", "YouTube takes one video on its own (no pictures). Google keeps new uploads private until YouTube has checked the studio's Google project: make each one public in YouTube Studio until then."));

    const at = el("input");
    at.type = "datetime-local";
    at.value = state.when || "";
    at.addEventListener("change", () => (state.when = at.value));
    const atLabel = el("label", "cp-field");
    atLabel.append(el("span", "", "Post at (UK time; empty: as soon as it's approved)"), at);

    box.append(wordsLabel, count, where, media, drop, atLabel);
    drawMedia();
    recount();
  }

  const problemOf = (box) => (text) => {
    const form = box.closest("form, article");
    const why = form && form.querySelector(".cp-error, .appr-error");
    if (why) why.textContent = text;
  };

  function thumb(m) {
    const fig = el("figure", "sc-thumb");
    if (m.kind === "video") {
      const v = el("video");
      v.src = m.url;
      v.preload = "metadata";
      v.muted = true;
      v.playsInline = true;
      v.controls = true;
      fig.appendChild(v);
    } else {
      const img = el("img");
      img.src = m.url;
      img.alt = m.name || "";
      img.loading = "lazy";
      fig.appendChild(img);
    }
    fig.appendChild(el("figcaption", "", m.name || ""));
    fig.title = m.name || "";
    return fig;
  }

  // A picture Instagram takes: a JPEG under 8 MB (others are redrawn as one, at most 2160 pixels)
  async function asJpeg(file) {
    if (file.type === "image/jpeg" && file.size <= IMAGE_MAX) return { blob: file, name: file.name };
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2160 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    if (!blob) throw new Error("That picture couldn't be read.");
    return { blob, name: file.name.replace(/\.\w+$/, "") + ".jpg" };
  }

  async function addFiles(state, files, problem) {
    const limit = ((data && data.limits) || {}).media || 10;
    problem("");
    for (const file of files) {
      if (state.media.length + state.uploading.length >= limit) {
        problem(`At most ${limit} pictures and videos in one post.`);
        break;
      }
      const video = /^video\//.test(file.type);
      if (!video && !/^image\//.test(file.type)) {
        problem(`${file.name} isn't a picture or video.`);
        continue;
      }
      if (video && !/^video\/(mp4|quicktime)$/.test(file.type)) {
        problem(`${file.name}: videos need to be MP4 or MOV.`);
        continue;
      }
      if (video && !onStudioPC && file.size > ONLINE_MAX) {
        problem(`${file.name} is ${Math.round(file.size / 1e6)} MB: from here videos can be up to 25 MB. Add it from the studio computer instead.`);
        continue;
      }
      const label = "Adding " + file.name + "…";
      state.uploading.push(label);
      state.redrawMedia && state.redrawMedia();
      try {
        const { blob, name } = video ? { blob: file, name: file.name } : await asJpeg(file);
        const res = await fetch("/actions/social-media?name=" + encodeURIComponent(name), {
          method: "POST",
          headers: { "Content-Type": blob.type || file.type, "X-Nova-Visualizer": "1" },
          body: blob,
          credentials: "same-origin",
        });
        const got = await res.json().catch(() => ({}));
        if (!res.ok || !got.media) throw new Error(got.pcOffline ? "The studio computer is off or offline, so pictures and videos can't be added right now." : got.message || got.error || "It couldn't be added (" + res.status + ").");
        state.media.push({ ...got.media, fresh: true });
      } catch (err) {
        problem(file.name + ": " + err.message);
      } finally {
        state.uploading.splice(state.uploading.indexOf(label), 1);
        state.redrawMedia && state.redrawMedia();
      }
    }
  }

  const newState = (p) => ({
    caption: p ? p.caption : "",
    platforms: p ? [...p.platforms] : ["facebook", "instagram"],
    media: p ? p.media.map((m) => ({ ...m })) : [],
    when: p && p.postAt ? K().ukLocal(p.postAt) : "",
    uploading: [],
  });
  const bodyOf = (state) => ({
    caption: state.caption.trim(),
    platforms: state.platforms,
    media: state.media.map((m) => ({ id: m.id, ext: m.ext, name: m.name, size: m.size })),
    postAt: state.when ? K().ukToIso(state.when) : "",
  });

  // The new post form
  function openForm(open) {
    const form = $("social-form");
    form.hidden = !open;
    $("social-new").setAttribute("aria-expanded", String(open));
    $("sc-new-error").textContent = "";
    if (open) {
      draft = draft || newState(null);
      fields(draft, $("sc-new-fields"));
      form.querySelector("textarea").focus({ preventScroll: true });
      form.scrollIntoView({ block: "nearest", behavior: K().calm() ? "auto" : "smooth" });
    }
  }
  $("social-new").addEventListener("click", () => openForm($("social-form").hidden));
  $("sc-new-cancel").addEventListener("click", () => {
    // Files added only for this post go again
    for (const m of (draft && draft.media) || []) if (m.fresh) fetch("/actions/social-media/" + m.id + "/remove", { method: "POST", headers: { "X-Nova-Visualizer": "1" }, credentials: "same-origin" }).catch(() => {});
    draft = null;
    openForm(false);
  });
  $("social-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (draft.uploading.length) return void ($("sc-new-error").textContent = "Wait for the files to finish adding.");
    if (!draft.platforms.length) return void ($("sc-new-error").textContent = "Pick Facebook, Instagram and/or YouTube.");
    const button = e.submitter || $("social-form").querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await K().api("social", { body: bodyOf(draft) });
      draft = null;
      openForm(false);
      K().toast("Saved. It waits for an admin's approval.");
      load();
    } catch (err) {
      $("sc-new-error").textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });

  // ===== A post =====

  function postCard(p) {
    const k = K();
    const canDecide = Boolean(data.canDecide);
    const editable = waiting(p) || ["rejected", "failed", "scheduled", "manual"].includes(p.status);
    const isEditing = editing && editing.id === p.id && editable;
    const isRejecting = rejecting === "post:" + p.id && waiting(p) && canDecide;
    const detail = logOpen.has(p.id) ? logs.get(p.id) : null;
    const card = el("article", "card cp-card sc-card" + (waiting(p) ? "" : " done"));
    card.dataset.key = "sc-" + p.id;
    // (the card being edited is drawn afresh each time: its fields keep what's typed and added)
    card.dataset.sig = k.sig(p, canDecide, data.connected, isEditing ? ++drawn : false, isRejecting, logOpen.has(p.id), detail ? detail.log.length : null);
    const top = el("div", "card-top");
    const head = firstLine(p.caption);
    const title = el("h3", "card-title", (head.length > 80 ? head.slice(0, 78).replace(/\s+\S*$/, "") + "…" : head) || (p.media.length ? (p.media[0].kind === "video" ? "A video post" : "A picture post") : "A post"));
    const pill = STATUS[p.status] || ["pill-stop", p.status];
    title.appendChild(el("span", pill[0], pill[1]));
    top.append(title, el("span", "card-meta", k.when(p.createdAt)));
    card.append(top, el("p", "card-who", "Written by " + (WRITERS[p.createdBy] || "someone in the team")));
    const chips = el("div", "sc-chips");
    for (const pl of p.platforms) chips.appendChild(el("span", "sc-chip", NAMES[pl] || pl));
    card.appendChild(chips);

    if (isEditing) {
      const box = el("div", "sc-fields appr-edit");
      fields(editing.state, box);
      card.appendChild(box);
    } else {
      if (p.media.length) {
        const media = el("div", "sc-media");
        for (const m of p.media) media.appendChild(thumb(m));
        card.appendChild(media);
      }
      if (p.caption) card.appendChild(el("div", "cp-plain", p.caption));
      const facts = el("dl", "cp-facts");
      const fact = (label, value) => value && facts.append(el("dt", "", label), el("dd", "", value));
      if (p.status === "posted") fact("Posted", k.ukWhen(p.postedAt));
      else if (!["failed", "rejected", "manual"].includes(p.status)) fact(p.status === "scheduled" ? "Posts" : "Post time", p.postAt ? k.ukWhen(p.postAt) + " (UK time)" : "As soon as it's approved");
      if (p.decidedByName && !waiting(p)) fact(p.status === "rejected" ? "Rejected by" : "Approved by", p.decidedByName + (p.decidedAt ? " · " + k.ukWhen(p.decidedAt) : ""));
      if (facts.children.length) card.appendChild(facts);
      card.appendChild(whereItWent(p));
    }
    if (p.note) card.appendChild(el("p", "appr-why", "Note: " + p.note));
    if (p.status === "failed") card.appendChild(el("p", "appr-result bad", "Didn't post: " + String(p.error || "unknown reason").replace(/\.$/, "") + "."));
    if (p.status === "posting") card.appendChild(el("p", "appr-result", "Approved · going out through Meta… (the studio computer needs to stay on until it's done)"));
    if (p.status === "scheduled") card.appendChild(el("p", "card-foot", "The studio computer needs to be on at that time: the pictures and videos are on it."));
    if (p.status === "manual" && !isEditing) card.appendChild(byHand(p));
    if (p.stats) card.appendChild(results(p));
    if (detail && detail.log.length) {
      const log = el("ul", "cp-log");
      for (const e of detail.log.slice(-10)) log.appendChild(el("li", "", k.ukWhen(e.at) + " · " + (EVENTS[e.event] || e.event) + (e.byName ? " · " + e.byName : "") + (e.detail ? " · " + e.detail : "")));
      card.appendChild(log);
    }
    if (isRejecting) {
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
    if (isEditing) {
      button("Save changes", "", () => savePost(card, p));
      button("Cancel", "ghost", () => {
        editing = null;
        draw();
      });
    } else if (isRejecting) {
      button("Reject it", "", () => decide(card, "social/" + p.id + "/reject", { note: card.querySelector('[data-field="note"]').value.trim() || undefined }));
      button("Cancel", "ghost", () => {
        rejecting = null;
        draw();
      });
    } else {
      if (waiting(p) && canDecide) {
        // Approve: pressed twice (it goes on the studio's pages), saying exactly what will happen
        button("Approve", "", (b) => {
          if (b.dataset.sure !== "1") {
            b.dataset.sure = "1";
            const auto = p.platforms.filter((x) => (data.connected || {})[x]);
            const hand = p.platforms.filter((x) => !(data.connected || {})[x]);
            const byHandToo = hand.length ? " (" + hand.map((x) => NAMES[x]).join(" and ") + " by hand)" : "";
            b.textContent = p.postAt ? "Schedule it for " + k.ukWhen(p.postAt) + byHandToo + "?" : auto.length ? "Post it on " + auto.map((x) => NAMES[x]).join(" and ") + " now" + byHandToo + "?" : "Approve it to post by hand?";
            return;
          }
          decide(card, "social/" + p.id + "/approve", {});
        });
      }
      if (editable) {
        button("Edit", "ghost", () => {
          editing = { id: p.id, state: newState(p) };
          rejecting = null;
          draw();
        });
      }
      if (waiting(p) && canDecide) {
        button("Reject", "ghost", () => {
          rejecting = "post:" + p.id;
          editing = null;
          draw();
        });
      }
      button(logOpen.has(p.id) ? "Hide history" : "History", "ghost", async () => {
        if (logOpen.has(p.id)) logOpen.delete(p.id);
        else {
          logOpen.add(p.id);
          try {
            logs.set(p.id, { updatedAt: p.updatedAt, log: (await k.api("social/" + p.id)).log || [] });
          } catch (err) {}
        }
        draw();
      });
    }
    if (row.children.length) card.appendChild(row);
    if (waiting(p) && !canDecide) card.appendChild(el("p", "card-foot", "An admin approves these, signed in to Portal in a browser. Nothing is posted until then."));
    return card;
  }

  // Where it went (or is going): each platform, by itself or by hand, with its link
  function whereItWent(p) {
    const list = el("ul", "sc-where");
    for (const pl of p.platforms) {
      const t = (p.targets || {})[pl];
      if (!t || !t.state) continue;
      const li = el("li");
      li.appendChild(el("b", "", NAMES[pl]));
      const words =
        t.state === "posted" ? (t.mode === "manual" ? "Posted by hand" : "Posted") + (t.postedAt ? " · " + K().ukWhen(t.postedAt) : "")
        : t.state === "failed" ? "Didn't post"
        : t.mode === "manual" ? "Waiting for someone to post it by hand"
        : t.state === "preparing" ? "Instagram is getting it ready"
        : t.state === "uploading" ? "Uploading to YouTube"
        : "Waiting";
      li.appendChild(el("span", t.state === "failed" ? "bad" : "", words));
      if (t.url) {
        const a = el("a", "", "Open it ↗");
        a.href = t.url;
        a.target = "_blank";
        a.rel = "noopener";
        li.appendChild(a);
      }
      list.appendChild(li);
    }
    return list;
  }

  // Meta isn't connected for it: the words to copy, the files to download, and "I posted it"
  function byHand(p) {
    const box = el("div", "sc-hand");
    const left = p.platforms.filter((pl) => (p.targets[pl] || {}).mode === "manual" && (p.targets[pl] || {}).state !== "posted");
    box.appendChild(el("p", "", "Approved. Post it on " + left.map((x) => NAMES[x]).join(" and ") + " yourself (Meta isn't connected to Nova for " + (left.length > 1 ? "them" : "it") + " yet), then say so here."));
    const tools = el("div", "sc-row");
    if (p.caption) {
      const copy = el("button", "btn small ghost", "Copy the words");
      copy.type = "button";
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(p.caption);
          K().toast("Copied.");
        } catch (err) {
          K().toast("Couldn't copy: select the words above instead.");
        }
      });
      tools.appendChild(copy);
    }
    p.media.forEach((m, i) => {
      const a = el("a", "btn small ghost", "Download " + (p.media.length > 1 ? (m.kind === "video" ? "video " : "picture ") + (i + 1) : m.kind === "video" ? "the video" : "the picture"));
      a.href = m.url + "?download";
      a.setAttribute("download", m.name || "");
      tools.appendChild(a);
    });
    if (tools.children.length) box.appendChild(tools);
    for (const pl of left) {
      const r = el("div", "sc-row");
      const link = el("input");
      link.type = "url";
      link.placeholder = NAMES[pl] + " post's link (optional)";
      link.setAttribute("aria-label", NAMES[pl] + " post's link (optional)");
      const done = el("button", "btn small", "I posted it on " + NAMES[pl]);
      done.type = "button";
      done.addEventListener("click", () => decide(box.closest("article"), "social/" + p.id + "/posted", { platform: pl, url: link.value.trim() }));
      r.append(link, done);
      box.appendChild(r);
    }
    return box;
  }

  // How it did, per platform
  function results(p) {
    const wrap = el("div", "");
    for (const pl of ALL) {
      const s = p.stats[pl];
      if (!s) continue;
      const box = el("div", "cp-stats");
      const tile = (value, label) => {
        if (value === undefined || value === null) return;
        const t = el("div", "cp-stat");
        t.append(el("b", "", people(value)), el("span", "", label));
        box.appendChild(t);
      };
      tile(s.reach, NAMES[pl] + " · reached");
      tile(s.views, s.reach === undefined ? NAMES[pl] + " · views" : "Views");
      tile(s.likes, "Likes");
      tile(s.comments, "Comments");
      tile(s.shares, "Shares");
      tile(s.saved, "Saves");
      tile(s.clicks, "Clicks");
      if (box.children.length) wrap.appendChild(box);
    }
    wrap.appendChild(el("p", "card-foot", p.stats.fetchedAt ? "As of " + K().ukWhen(p.stats.fetchedAt) + ". Updated every hour for 30 days." : "Results come within the hour."));
    return wrap;
  }

  // The reason something didn't work stays on the card (its buttons work again)
  function problem(card, text) {
    let why = card.querySelector(".appr-error");
    if (!why) {
      why = el("p", "appr-result bad appr-error");
      why.setAttribute("role", "alert");
      card.appendChild(why);
    }
    why.textContent = text;
    card.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }

  async function decide(card, path, body) {
    card.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      const got = await K().api(path, { body });
      rejecting = null;
      if (got.post && got.post.status === "failed") K().toast("It didn't post: the card says why.");
      await load();
    } catch (err) {
      problem(card, err.message);
    }
  }

  async function savePost(card, p) {
    const state = editing.state;
    if (state.uploading.length) return problem(card, "Wait for the files to finish adding.");
    if (!state.platforms.length) return problem(card, "Pick Facebook, Instagram and/or YouTube.");
    card.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      await K().api("social/" + p.id + "/edit", { body: bodyOf(state) });
      editing = null;
      K().toast("Saved. It waits for an admin's approval again.");
      await load();
    } catch (err) {
      problem(card, err.message);
    }
  }

  // ===== Comments =====

  function drawComments() {
    const k = K();
    const canDecide = Boolean(data.canDecide);
    const comments = data.comments || [];
    const connected = data.connected || {};
    const nodes = [];
    if (!comments.length) nodes.push(el("p", "empty", connected.facebook || connected.instagram ? "No comments on the studio's posts yet. New ones come in every hour." : "Comments on the studio's posts show here once Meta is connected."));
    for (const c of comments) {
      const done = c.handled && c.replyStatus !== "pending_approval";
      const isRejecting = rejecting === "comment:" + c.id;
      const card = el("article", "card sc-comment" + (done ? " done" : ""));
      card.dataset.key = "scc-" + c.id;
      card.dataset.sig = k.sig(c, canDecide, isRejecting, Boolean(connected[c.platform]));
      const top = el("div", "card-top");
      const title = el("h3", "card-title", (c.author || "Someone") + " on " + (NAMES[c.platform] || c.platform));
      const pill = c.replyStatus === "pending_approval" ? ["pill-draft", "Reply waiting"] : c.replyStatus === "sent" ? ["pill-done", "Answered"] : c.replyStatus === "failed" ? ["pill-failed", "Reply didn't post"] : c.handled ? ["pill-done", "Dealt with"] : ["pill-new", "New"];
      title.appendChild(el("span", pill[0], pill[1]));
      top.append(title, el("span", "card-meta", k.when(c.commentedAt)));
      card.append(top, el("p", "sc-said", c.text));
      if (c.postCaption) card.appendChild(el("p", "sc-on", "On: " + firstLine(c.postCaption)));
      if (c.reply && c.replyStatus !== "sent") card.appendChild(el("div", "cp-plain", "Reply: " + c.reply));
      if (c.replyStatus === "sent") card.appendChild(el("p", "sc-on", "Answered: " + c.reply));
      if (c.replyStatus === "failed" && c.replyError) card.appendChild(el("p", "appr-result bad", c.replyError));
      if (c.replyStatus === "rejected" && c.note) card.appendChild(el("p", "appr-why", "Reply rejected: " + c.note));
      const row = el("div", "actions");
      const button = (text, cls, fn) => {
        const b = el("button", "btn small" + (cls ? " " + cls : ""), text);
        b.type = "button";
        b.addEventListener("click", () => fn(b));
        row.appendChild(b);
      };
      if (isRejecting) {
        const why = el("label", "cp-field cp-reject");
        const input = el("input");
        input.type = "text";
        input.maxLength = 500;
        input.dataset.field = "note";
        why.append(el("span", "", "Why (optional)"), input);
        card.appendChild(why);
        button("Reject the reply", "", () => decide(card, "social/comments/" + c.id + "/reject", { note: input.value.trim() || undefined }));
        button("Cancel", "ghost", () => {
          rejecting = null;
          draw();
        });
      } else {
        if (c.replyStatus !== "sent" && c.replyStatus !== "approved") {
          const text = el("textarea");
          text.maxLength = 1000;
          text.placeholder = "Write a reply (it's posted after an admin approves it)";
          text.setAttribute("aria-label", "Reply to " + (c.author || "this comment"));
          text.value = replyText.get(c.id) || "";
          text.addEventListener("input", () => replyText.set(c.id, text.value));
          card.appendChild(text);
          button(c.replyStatus === "pending_approval" ? "Save the new reply" : "Save reply for approval", "ghost", async () => {
            const t = text.value.trim();
            if (!t) return problem(card, "Write the reply first.");
            card.querySelectorAll("button").forEach((b) => (b.disabled = true));
            try {
              await k.api("social/comments/" + c.id + "/reply", { body: { text: t } });
              replyText.delete(c.id);
              await load();
            } catch (err) {
              problem(card, err.message);
            }
          });
        }
        if (c.replyStatus === "pending_approval" && canDecide) {
          button(connected[c.platform] ? "Approve the reply" : "Approve (post it by hand)", "", () => decide(card, "social/comments/" + c.id + "/approve", {}));
          button("Reject", "ghost", () => {
            rejecting = "comment:" + c.id;
            draw();
          });
        }
        button(c.handled ? "Not dealt with" : "Dealt with", "ghost", () => decide(card, "social/comments/" + c.id + "/handled", { handled: !c.handled }));
      }
      card.appendChild(row);
      nodes.push(card);
    }
    k.reconcile($("social-comments"), nodes);
    const want = Number(new URLSearchParams(location.search).get("comment")) || null;
    if (want && picked !== "c" + want) pointAt($("social-comments"), "scc-" + want, "c" + want);
  }

  // ===== Ideas, trends and ads =====

  function drawTools() {
    if ($("social-tools").children.length) return;
    const ideas = el("div", "card");
    ideas.append(el("h3", "card-title", "Ideas and trends"), el("p", "", "Nova Agent looks at how recent posts did and what's trending for studios and artists right now, then suggests posts with captions and times. You can change the question before sending it."));
    const ask = el("button", "btn small", "Ask Nova Agent");
    ask.type = "button";
    ask.addEventListener("click", () => {
      try {
        if (window.parent !== window && window.parent.NovaAgent && window.parent.NovaAgent.agent) return void window.parent.NovaAgent.agent(IDEAS_PROMPT);
      } catch (err) {}
      location.href = "/agent/";
    });
    ideas.appendChild(ask);
    const ads = el("div", "card");
    ads.append(el("h3", "card-title", "Paid ads"), el("p", "", "Ads are set up, paid for and checked in Meta's Ads Manager. Nova never spends money or runs ads."));
    const link = el("a", "btn small ghost", "Open Ads Manager ↗");
    link.href = (data && data.adsUrl) || "https://adsmanager.facebook.com/";
    link.target = "_blank";
    link.rel = "noopener";
    ads.appendChild(link);
    $("social-tools").replaceChildren(ideas, ads);
  }

  document.addEventListener("visibilitychange", () => !document.hidden && window.PortalApp && window.PortalApp.view === "social" && load());

  window.PortalSocial = { load };
})();
