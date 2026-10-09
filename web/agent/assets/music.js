// "Today in music" on Nova Agent's front page (under the welcome, gone once you start chatting):
// small cards, a line or two each: the Top 10 worldwide (live), popular genres, budget gear (what
// each does), the music industry's money, a musician's quote of the day (with their picture) and
// a song of the day. A tap on a card opens a short list; nothing moves by itself.
// Data: music-data.js (hand-picked) and Nova Bot's /music-world (the live Top 10, the photos).
(() => {
  "use strict";
  const D = window.NOVA_MUSIC;
  const log = document.getElementById("log");
  if (!D || !log) return;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  // Today's picks (the same all day, a new one tomorrow)
  const day = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);
  const pick = (list, salt = 0) => list[(day + salt) % list.length];
  const ICON = {
    top: '<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3.6 9h16.8M3.6 15h16.8M12 3c2.5 2.6 3.6 5.6 3.6 9s-1.1 6.4-3.6 9M12 3C9.5 5.6 8.4 8.6 8.4 12s1.1 6.4 3.6 9"/>',
    genres: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4.5" height="6.5" rx="1.5"/><rect x="16.5" y="14" width="4.5" height="6.5" rx="1.5"/>',
    gear: '<path d="M6 4v7M6 15v5M12 4v3M12 11v9M18 4v9M18 17v3"/><circle cx="6" cy="13" r="2"/><circle cx="12" cy="9" r="2"/><circle cx="18" cy="15" r="2"/>',
    money: '<path d="M4 19h16M6 16V11M10 16V7M14 16V9M18 16V5"/>',
    song: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  };
  // A picture over an icon: if the picture can't be found, it goes and the icon shows
  const art = (src) => `<img class="mw-art" alt="" loading="lazy" src="${src}" onerror="this.remove()">`;
  const ico = (k) => `<svg class="mw-ico" viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;

  // The live Top 10 (kept an hour on this device; Nova Bot keeps it 6 hours)
  let top = [];
  try { const c = JSON.parse(localStorage.getItem("nova-music-top") || "null"); if (c && Date.now() - c.at < 3600000) top = c.top; } catch (err) {}
  function loadTop() {
    fetch("/music-world", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || !d.top || !d.top.length) return;
        top = d.top;
        try { localStorage.setItem("nova-music-top", JSON.stringify({ at: Date.now(), top })); } catch (err) {}
        document.querySelectorAll(".mw-card[data-mw=top] .mw-line").forEach((el) => (el.textContent = topLine()));
        topArt();
      })
      .catch(() => {});
  }
  function topArt() {
    if (!top[0] || !top[0].art) return;
    document.querySelectorAll("[data-top-art]").forEach((el) => { if (!el.querySelector("img")) el.insertAdjacentHTML("afterbegin", art(top[0].art)); });
  }
  const topLine = () => (top[0] ? `#1 ${top[0].title} · ${top[0].artist}` : "Loading the charts…");

  let quoteAt = day % D.quotes.length;
  const quote = D.quotes[quoteAt];
  const song = pick(D.songs, 3);
  const gear = pick(D.gear, 5);
  const initials = (n) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join("");
  const lyrics = (s) => `https://genius.com/search?q=${encodeURIComponent(`${s.artist} ${s.title.replace(/"/g, "")}`)}`;

  function build() {
    const box = document.createElement("section");
    box.className = "mworld cpanel";
    box.setAttribute("aria-label", "Today in music");
    box.innerHTML = `
      <h4 class="mw-title">Today in music</h4>
      <div class="mw-row">
        <button type="button" class="mw-card" data-mw="top" data-sfx="open"><span class="mw-pic" data-top-art>${ico("top")}</span><span class="mw-k">Top 10 worldwide</span><span class="mw-line">${esc(topLine())}</span></button>
        <button type="button" class="mw-card" data-mw="genres" data-sfx="open"><span class="mw-pic">${art(`/music-world/art?q=${encodeURIComponent(D.genres[0].art)}`)}${ico("genres")}</span><span class="mw-k">Popular genres</span><span class="mw-line">${esc(D.genres.slice(0, 3).map((g) => g.name).join(" · "))}</span></button>
        <button type="button" class="mw-card" data-mw="gear" data-sfx="open"><span class="mw-pic">${gear.wiki ? art(`/music-world/photo/${encodeURIComponent(gear.wiki)}`) : ""}${ico("gear")}</span><span class="mw-k">Budget gear</span><span class="mw-line">${esc(gear.name)}: ${esc(gear.does.toLowerCase())}</span></button>
        <button type="button" class="mw-card" data-mw="song" data-sfx="open"><span class="mw-pic">${art(`/music-world/art?q=${encodeURIComponent(`${song.artist} ${song.title.replace(/"/g, "")}`)}`)}${ico("song")}</span><span class="mw-k">Song of the day</span><span class="mw-line">${esc(song.title)} · ${esc(song.artist)}</span></button>
        <button type="button" class="mw-card" data-mw="money" data-sfx="open"><span class="mw-pic">${ico("money")}</span><span class="mw-k">Music industry</span><span class="mw-line">${esc(D.revenue.headline)} in 2025, up 6.4%</span></button>
      </div>
      <figure class="mw-quote">
        <span class="mw-face"><img alt="" loading="lazy" src="/music-world/photo/${encodeURIComponent(quote.wiki)}"><b aria-hidden="true">${esc(initials(quote.who))}</b></span>
        <blockquote>“${esc(quote.text)}”</blockquote>
        <figcaption>${esc(quote.who)} · ${esc(quote.when)}${quote.attributed ? " · attributed" : ""}</figcaption>
      </figure>
`;
    const img = box.querySelector(".mw-face img");
    // No photo for this musician: no picture at all (not a placeholder)
    img.addEventListener("error", () => img.closest(".mw-face").hidden = true);
    box.addEventListener("click", (e) => {
      const card = e.target.closest(".mw-card");
      if (card) open(card);
    });
    return box;
  }

  // The short list a card opens
  const pop = document.createElement("div");
  pop.className = "mw-pop";
  pop.hidden = true;
  pop.setAttribute("role", "dialog");
  document.body.append(pop);
  function open(card) {
    const k = card.dataset.mw;
    let html = "";
    if (k === "top") {
      html = `<h5>Top 10 worldwide</h5>` + (top.length ? `<ol class="mw-list">${top.map((s) => `<li><img alt="" loading="lazy" src="${esc(s.art)}"><span><b>${esc(s.title)}</b><small>${esc(s.artist)}</small></span></li>`).join("")}</ol><p class="mw-src">Most played on Apple Music across 12 countries, updated through the day</p>` : `<p>The charts couldn't be reached just now. Try again in a bit.</p>`);
    } else if (k === "genres") {
      html = `<h5>Popular around the world</h5><ul class="mw-list plain">${D.genres.map((g) => `<li>${art(`/music-world/art?q=${encodeURIComponent(g.art || g.name)}`)}<span><b>${esc(g.name)}</b><small>${esc(g.line)}</small></span></li>`).join("")}</ul>`;
    } else if (k === "gear") {
      html = `<h5>Popular budget gear</h5><ul class="mw-list plain">${D.gear.map((g) => `<li>${g.wiki ? art(`/music-world/photo/${encodeURIComponent(g.wiki)}`) : `<i class="mw-dot">${ico("gear")}</i>`}<span><b>${esc(g.name)}</b><small>${esc(g.kind)}: ${esc(g.does)} · ${esc(g.price)}</small></span></li>`).join("")}</ul><p class="mw-src">Prices are rough and change by shop and country</p>`;
    } else if (k === "song") {
      html = `<h5>Song of the day</h5><div class="mw-song-pop">${art(`/music-world/art?q=${encodeURIComponent(`${song.artist} ${song.title.replace(/"/g, "")}`)}`)}<b>${esc(song.title)}</b><small>${esc(song.artist)} · ${song.year}</small><p>${esc(song.about)}</p><a href="${lyrics(song)}" target="_blank" rel="noopener">Read the lyrics ↗</a></div>`;
    } else if (k === "money") {
      html = `<h5>${esc(D.revenue.headline)} ${esc(D.revenue.sub)}</h5><ul class="mw-list plain">${D.revenue.bites.map((b) => `<li><span>${esc(b)}</span></li>`).join("")}</ul><p class="mw-src">${esc(D.revenue.source)}</p>`;
    }
    pop.innerHTML = html;
    pop.hidden = false;
    const r = card.getBoundingClientRect();
    const w = Math.min(340, innerWidth - 16);
    pop.style.width = `${w}px`;
    pop.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    const below = innerHeight - r.bottom > 260 || r.top < 260;
    pop.style.top = below ? `${r.bottom + 8}px` : "";
    pop.style.bottom = below ? "" : `${innerHeight - r.top + 8}px`;
    pop.style.maxHeight = `${below ? innerHeight - r.bottom - 20 : r.top - 20}px`;
  }
  const close = () => { if (!pop.hidden) pop.hidden = true; };
  document.addEventListener("click", (e) => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest(".mw-card")) close(); }, true);
  document.addEventListener("keydown", (e) => e.key === "Escape" && close());
  addEventListener("resize", close);
  log.addEventListener("scroll", close, { passive: true });

  // A new quote every so often (a random 2 to 16 minutes each time), fading softly, never the same
  // one twice in a row
  function nextQuote() {
    let n = Math.floor(Math.random() * D.quotes.length);
    if (n === quoteAt) n = (n + 1) % D.quotes.length;
    quoteAt = n;
    const q = D.quotes[n];
    document.querySelectorAll(".mw-quote").forEach((fig) => {
      fig.classList.add("mw-fade");
      setTimeout(() => {
        const face = fig.querySelector(".mw-face");
        face.hidden = false;
        face.innerHTML = `<img alt="" loading="lazy" src="/music-world/photo/${encodeURIComponent(q.wiki)}" onerror="this.parentElement.hidden = true"><b aria-hidden="true">${esc(initials(q.who))}</b>`;
        fig.querySelector("blockquote").textContent = `“${q.text}”`;
        fig.querySelector("figcaption").textContent = `${q.who} · ${q.when}${q.attributed ? " · attributed" : ""}`;
        fig.classList.remove("mw-fade");
        fit();
      }, 500);
    });
    setTimeout(nextQuote, (2 + Math.random() * 14) * 60000);
  }
  setTimeout(nextQuote, (2 + Math.random() * 14) * 60000);

  // Put it in the welcome (and again if the welcome comes back after "New chat")
  // The welcome in three content panels, each bordered: the hello (its heading and words), the
  // suggestions, and Today in music
  function place() {
    const w = document.getElementById("welcome");
    if (!w) return;
    const h = w.querySelector(":scope > h3"), p = w.querySelector(":scope > p");
    if (h && !h.closest(".cpanel")) {
      const intro = document.createElement("div");
      intro.className = "cpanel mw-intro";
      h.before(intro);
      intro.append(h);
      if (p) intro.append(p);
    }
    const sug = w.querySelector(":scope > .suggest");
    if (sug && !sug.classList.contains("cpanel")) {
      sug.classList.add("cpanel");
      // The first four ideas, and the rest a tap away
      const chips = [...sug.querySelectorAll(".chip")];
      if (chips.length > 4) {
        chips.slice(4).forEach((c) => c.classList.add("mw-more-idea"));
        const more = document.createElement("button");
        more.type = "button";
        more.className = "chip mw-more";
        more.dataset.sfx = "open";
        more.textContent = `More ideas (${chips.length - 4}) ▾`;
        more.addEventListener("click", (e) => {
          e.stopPropagation();
          const open = sug.classList.toggle("show-all");
          more.textContent = open ? "Fewer ideas ▴" : `More ideas (${chips.length - 4}) ▾`;
          fit();
        });
        sug.append(more);
      }
    }
    if (!w.querySelector(".mworld")) w.append(build());
    fit();
  }

  // The whole front page fits the chat's space with no scrolling, and fills it: drawn smaller when
  // it's taller than the room, bigger when there's room to spare
  let fitting = 0;
  function fit() {
    cancelAnimationFrame(fitting);
    fitting = requestAnimationFrame(() => {
      const w = document.getElementById("welcome");
      if (!w || !w.isConnected || w.hidden || !w.getClientRects().length) return;
      const cs = getComputedStyle(log);
      const room = log.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 8;
      // What the content itself needs, at a given size (the welcome box may be stretched taller)
      const measure = (z) => {
        w.style.zoom = z === 1 ? "" : String(z);
        w.style.width = z > 1 ? `${(100 / z).toFixed(2)}%` : "";
        const kids = [...w.children].filter((k) => k.getClientRects().length && k.getBoundingClientRect().height > 0);
        if (!kids.length) return 0;
        const top = Math.min(...kids.map((k) => k.getBoundingClientRect().top));
        const bottom = Math.max(...kids.map((k) => k.getBoundingClientRect().bottom));
        return bottom - top + 12;
      };
      // Fills the room: smaller when there's too little (never below 65%), bigger when there's
      // plenty (up to 140%), always all of it in view
      let z = 1;
      const need = measure(1);
      if (!need) return;
      if (need > room) z = Math.max(0.65, room / need);
      else {
        z = Math.min(1.4, room / need);
        for (let i = 0; i < 4 && z > 1.01 && measure(z) > room; i++) z = Math.max(1, z * 0.95);
      }
      measure(Math.round(z * 1000) / 1000);
      // Only on a very small screen, where even smaller would be unreadable, can it scroll
      log.classList.toggle("mw-scroll", z <= 0.65 && need * z > room + 2);
    });
  }
  new ResizeObserver(fit).observe(log);
  // Again once the fonts and pictures are in (they change how much room it needs)
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  addEventListener("load", fit);
  [800, 2000, 4000].forEach((ms) => setTimeout(fit, ms));
  addEventListener("resize", fit);
  document.addEventListener("load", (e) => e.target && e.target.closest && e.target.closest("#welcome") && fit(), true);
  place();
  new MutationObserver(place).observe(log, { childList: true });
  loadTop();
})();
