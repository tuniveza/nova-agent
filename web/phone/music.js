// Nova Phone: Today in music (Nova Desk's front page "Today in music", agent-shell.md 80). A musician's quote of the
// day, then cards: the Top 10 worldwide (live, from Nova Bot's /music-world), popular genres, budget gear (what
// each does), the song of the day and the music industry's money. A tap on a card opens its list.
// The hand-picked parts are Nova Desk's own (agent/assets/music-data.js), so both apps show the same day's picks.
//   #music  #music/top  #music/genres  #music/gear  #music/song  #music/money
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, row, list, empty } = N;
  const data = () => (window.NOVA_MUSIC ? Promise.resolve(window.NOVA_MUSIC) : N.script(N.asset("/agent/music-data.js")).then(() => window.NOVA_MUSIC));
  // Today's picks: the same all day, new ones tomorrow (as Nova Desk)
  const today = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);
  const pick = (a, salt = 0) => a[(today() + salt) % a.length];
  const cover = (u) => `/music-world/img?u=${encodeURIComponent(String(u).replace(/\d+x\d+bb/, "300x300bb"))}`;
  const img = (src, cls = "music-art") => `<img class="${cls}" alt="" loading="lazy" decoding="async" width="56" height="56" src="${esc(src)}">`;
  const initials = (n) => String(n).split(/\s+/).map((w) => w[0]).slice(0, 2).join("");
  const lyrics = (s) => `https://genius.com/search?q=${encodeURIComponent(`${s.artist} ${String(s.title).replace(/"/g, "")}`)}`;
  // The live Top 10 (kept an hour on this phone, as Nova Desk keeps it)
  async function top() {
    try { const c = JSON.parse(localStorage.getItem("nova-music-top") || "null"); if (c && Date.now() - c.at < 3600000 && c.top?.length) return c.top; } catch (err) {}
    try {
      const r = await fetch("/music-world", { credentials: "same-origin" });
      const d = r.ok ? await r.json() : null;
      if (d && d.top && d.top.length) { try { localStorage.setItem("nova-music-top", JSON.stringify({ at: Date.now(), top: d.top })); } catch (err) {} return d.top; }
    } catch (err) {}
    return [];
  }

  N.section({
    id: "music",
    name: "Today in music",
    async draw(box, [part], ui) {
      await N.css("music.css");
      const D = await data().catch(() => null);
      if (!D) throw new Error("Today in music didn't load. Check the connection and try again.");
      if (part) ui.back("#music"); else ui.back("#more");
      const song = pick(D.songs, 3), withPhoto = D.gear.filter((g) => g.photo), gear = pick(withPhoto.length ? withPhoto : D.gear, 5), quote = D.quotes[today() % D.quotes.length];
      if (part === "top") {
        ui.title("Top 10 worldwide");
        const t = await top();
        box.innerHTML = t.length ? `${list(t.map((s, i) => row({ lead: s.art ? img(cover(s.art)) : `<b>${i + 1}</b>`, title: `${i + 1}. ${s.title}`, text: s.artist })))}<p class="small muted music-src">Most played on Apple Music across 12 countries, updated through the day</p>`
          : empty({ icon: "music", title: "The charts didn't load", text: "Nova Bot couldn't reach them just now. Try again in a while.", action: '<button type="button" class="btn" data-again>Try again</button>' });
      } else if (part === "genres") {
        ui.title("Popular genres");
        box.innerHTML = list(D.genres.map((g) => row({ lead: img(cover(g.cover)), title: g.name, text: g.line })));
      } else if (part === "gear") {
        ui.title("Popular budget gear");
        box.innerHTML = `${list(D.gear.map((g) => row({ lead: g.photo ? img(`/music-world/file/${encodeURIComponent(g.photo)}`) : icon("sound"), title: g.name, text: `${g.kind}: ${g.does} · ${g.price}` })))}<p class="small muted music-src">Prices are rough and change by shop and country</p>`;
      } else if (part === "song") {
        ui.title("Song of the day");
        box.innerHTML = `<div class="card music-song">${img(cover(song.cover), "music-big")}<h2 class="card-title">${esc(song.title)}</h2><p class="muted">${esc(song.artist)} · ${esc(song.year)}</p><p>${esc(song.about)}</p></div>
          <a class="btn wide" href="${esc(lyrics(song))}" target="_blank" rel="noopener">Read the lyrics on Genius ↗</a>`;
      } else if (part === "money") {
        ui.title("Music industry");
        box.innerHTML = `<div class="card"><p class="kicker">Worldwide</p><h2 class="card-title">${esc(D.revenue.headline)}</h2><p class="muted">${esc(D.revenue.sub)}</p></div>${list(D.revenue.bites.map((b) => row({ lead: icon("star"), title: b })))}<p class="small muted music-src">${esc(D.revenue.source)}</p>`;
      } else {
        const t = await top();
        box.innerHTML = `
          <figure class="card music-quote">
            <span class="music-face"><img alt="" loading="lazy" width="56" height="56" src="/music-world/photo/${encodeURIComponent(quote.wiki)}"><b aria-hidden="true">${esc(initials(quote.who))}</b></span>
            <blockquote>“${esc(quote.text)}”</blockquote>
            <figcaption class="small muted">${esc(quote.who)} · ${esc(quote.when)}${quote.attributed ? " · attributed" : ""}</figcaption>
          </figure>
          ${list([
            row({ href: "#music/top", lead: t[0] && t[0].art ? img(cover(t[0].art)) : icon("globe"), title: "Top 10 worldwide", text: t[0] ? `#1 ${t[0].title} · ${t[0].artist}` : "The charts, live" }),
            row({ href: "#music/genres", lead: img(cover(D.genres[0].cover)), title: "Popular genres", text: D.genres.slice(0, 4).map((g) => g.name).join(", ") }),
            row({ href: "#music/gear", lead: gear.photo ? img(`/music-world/file/${encodeURIComponent(gear.photo)}`) : icon("sound"), title: "Budget gear", text: `${gear.name}: ${gear.does.toLowerCase()}` }),
            row({ href: "#music/song", lead: img(cover(song.cover)), title: "Song of the day", text: `${song.title} · ${song.artist}` }),
            row({ href: "#music/money", lead: icon("money"), title: "Music industry", text: `${D.revenue.headline} in 2025, up 6.4%` }),
          ])}
          ${list([row({ href: "#settings", lead: icon("sound"), title: "Background music", text: "On or off, its volume and variation: in Settings" })])}`;
      }
      // (a picture that can't be found goes; the initials or icon show instead)
      box.addEventListener("error", (e) => { if (e.target.tagName === "IMG") { const f = e.target.closest(".music-face"); if (f) e.target.remove(); else e.target.replaceWith(Object.assign(document.createElement("span"), { className: "music-art music-none", innerHTML: icon("music") })); } }, true);
    },
  });
})();
