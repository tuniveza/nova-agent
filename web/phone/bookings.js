// Nova Phone: Booking tools (Nova Desk's Portal → Bookings month, app.js "the smart calendar"). The studio's
// bookings (Nova Bot's own booking system: /book, Stripe deposits, the studio's Google Calendar) made for the phone:
//   - this week at a glance: sessions, hours booked and how full, session value, the busiest day, the next free
//     hour and clashes, and Ask Nova about this week;
//   - the month, each day glowing by how full it is ("full" when nearly all opening hours are booked), a dot in
//     each session's colour, a lilac one when Calendar or Quests have something; a tap picks the day;
//   - the picked day: how full (a meter), clashes and tight changeovers, its free stretches (a tap asks NovaBot
//     for a booking link for that time), All / Bookings / Quests / Notes, Ask Nova about this day, and each
//     booking with its form answers, Call, Email and Open in Google Calendar (or Open in Calendar on that day);
//     a day with nothing offers the next booking.
// Opening hours are NovaBot's: 10am to 11pm, every day. Times are UK time, as on Nova Desk.
// Addresses: #bookings, #bookings/<day>, #bookings/<day>/<YYYY-MM> (that month shown, the day still picked).
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, empty, api, row, list } = N;
  const UK = "Europe/London";
  const OPEN_FROM = 10, OPEN_TO = 23, OPEN_HOURS = OPEN_TO - OPEN_FROM;
  // (each session always the same colour: Nova Phone's named colours, as on every other screen)
  const COLOURS = ["magenta", "violet", "amber", "blue", "orange", "teal"];
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  // (one formatter each, made once: a new one per date is slow with thousands of bookings)
  const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: UK, year: "numeric", month: "2-digit", day: "2-digit" });
  const CLOCK = new Intl.DateTimeFormat("en-GB", { timeZone: UK, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const dayKey = (d) => DAY.format(d);
  const clock = (d) => CLOCK.format(d);
  const feedDate = (v) => { const m = String(v || "").match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) : null; };
  const ukMinutes = (d) => { const [h, m] = clock(d).split(":").map(Number); return h * 60 + m; };
  const hm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  const pounds = (price) => { const m = String(price || "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)/); return m ? Number(m[1]) : 0; };
  const colour = (name) => { let sum = 0; for (const c of String(name)) sum += c.charCodeAt(0); return COLOURS[sum % COLOURS.length]; };
  const noon = (k) => new Date(`${k}T12:00:00Z`);
  const short = (k) => noon(k).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const long = (k) => noon(k).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const plus = (k, n) => new Date(noon(k).getTime() + n * 864e5).toISOString().slice(0, 10);
  const who = (b) => b.name || b.session || "Booking";

  // ---- The diary, and Calendar's cards and Quests from Nova Agent's plan (as Nova Desk reads them) ----
  let bookings = [], setUp = true, problem = "", loaded = false, plan = null, loadedAt = 0;
  async function load(force) {
    if (!force && loadedAt && Date.now() - loadedAt < 60000) return;
    const [c, q] = await Promise.all([
      api("/app/api/calendar").catch((e) => { if (e.signIn) throw e; return { error: e }; }),
      api("/app/api/quests").catch((e) => { if (e.signIn) throw e; return null; }),
    ]);
    if (c.error) problem = c.error.message || "The diary didn't load.";
    else if (!c.setUp) { setUp = false; problem = "The booking calendar isn't connected yet."; bookings = []; }
    else { setUp = true; problem = ""; bookings = (c.bookings || []).map((b) => ({ ...b, from: feedDate(b.start), to: feedDate(b.end) })).filter((b) => b.from).map((b) => ({ ...b, key: dayKey(b.from), fromMin: ukMinutes(b.from), toMin: b.to ? ukMinutes(b.to) || 24 * 60 : null })); loaded = true; }
    // (each day's bookings found once, not worked out again for every day of the month: the diary can hold thousands)
    byDay = new Map();
    for (const b of bookings.slice().sort((x, z) => x.from - z.from)) { if (!byDay.has(b.key)) byDay.set(b.key, []); byDay.get(b.key).push(b); }
    plan = q && q.state ? q.state : plan;
    loadedAt = Date.now();
  }
  let byDay = new Map();
  const bookingsOn = (key) => byDay.get(key) || [];
  // (Nova Desk's suiteOn: day cards, note cards and planned quests on a day)
  function suiteOn(key) {
    const st = plan;
    if (!st) return [];
    const items = [];
    const cal = st.calendar || { notes: [], days: [] };
    const t = (s) => String(s || "").slice(11, 16);
    for (const d of cal.days || []) if (d.date === key || (d.repeat === "yearly" && String(d.date).slice(5) === key.slice(5))) items.push({ kind: "day", title: d.title, sub: [d.info, d.location].filter(Boolean).join(" · "), sort: "" });
    for (const n of cal.notes || []) if (String(n.start).slice(0, 10) <= key && String(n.end).slice(0, 10) >= key) items.push({ kind: "note", title: n.title || "Note card", sub: n.body, time: String(n.start).slice(0, 10) === key ? `${t(n.start)}–${t(n.end)}` : "all day", sort: n.start });
    for (const q of st.quests || []) if (q.start && String(q.start).slice(0, 10) === key && q.status !== "skipped") items.push({ kind: "quest", id: q.id, title: `${q.status === "done" ? "✓ " : ""}${q.title}`, sub: length(q), time: `${t(q.start)}–${t(q.end)}`, sort: q.start });
    return items.sort((a, b) => String(a.sort).localeCompare(String(b.sort)));
  }
  function length(q) {
    const m = Number(q.minutes) || (q.start && q.end ? (Date.parse(q.end) - Date.parse(q.start)) / 60000 : 0);
    if (!m) return "";
    if (m < 60) return `${Math.round(m)} min`;
    const h = Math.floor(m / 60), mm = Math.round(m % 60);
    return mm ? `${h} h ${mm} min` : `${h} h`;
  }

  // Everything about one day's bookings: hours booked, how full, clashes, free stretches, takings
  function dayFacts(key) {
    const list_ = bookingsOn(key);
    const spans = list_.map((b) => ({ b, from: b.fromMin, to: b.toMin ?? b.fromMin + 60 })).sort((a, z) => a.from - z.from);
    const booked = spans.reduce((n, s) => n + Math.max(0, Math.min(s.to, OPEN_TO * 60) - Math.max(s.from, OPEN_FROM * 60)), 0);
    const clashes = [], tight = [];
    for (let i = 1; i < spans.length; i++) {
      const gap = spans[i].from - spans[i - 1].to;
      if (gap < 0) clashes.push([spans[i - 1].b, spans[i].b]);
      else if (gap < 15) tight.push([spans[i - 1].b, spans[i].b]);
    }
    const now = new Date();
    let cursor = OPEN_FROM * 60;
    if (key === dayKey(now)) cursor = Math.max(cursor, Math.ceil((ukMinutes(now) + 1) / 30) * 30);
    const free = [];
    for (const s of spans) { if (s.from - cursor >= 60) free.push([cursor, s.from]); cursor = Math.max(cursor, s.to); }
    if (OPEN_TO * 60 - cursor >= 60) free.push([cursor, OPEN_TO * 60]);
    const takings = list_.reduce((n, b) => n + pounds(b.price), 0);
    return { list: list_, booked, load: Math.min(1, booked / (OPEN_HOURS * 60)), clashes, tight, free, takings };
  }
  function weekOf(key) {
    const d = noon(key);
    const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5);
    return Array.from({ length: 7 }, (_, i) => new Date(monday.getTime() + i * 864e5).toISOString().slice(0, 10));
  }

  // Ask Nova (or NovaBot with the booking tools) something: the Website bot opens with it written, ready to send
  function askAbout(mode, text) {
    window.NovaPhoneBotAsk = { mode, text };
    location.hash = mode === "customer" ? "#bot/customer" : "#bot";
  }

  let filter = "all", focus = null;
  N.section({
    id: "bookings",
    name: "Booking tools",
    tile: "calendar",
    async draw(box, [pickedIn, monthIn], ui) {
      await Promise.all([N.css("bookings.css"), load()]);
      const todayKey = dayKey(new Date());
      const picked = /^\d{4}-\d\d-\d\d$/.test(pickedIn || "") ? pickedIn : todayKey;
      const month = /^\d{4}-\d\d$/.test(monthIn || "") ? monthIn : picked.slice(0, 7);
      ui.title("Booking tools");
      if (pickedIn) ui.back("#today");
      ui.action({ icon: "refresh", label: "Read the diary again", run: async () => { try { await load(true); } catch (e) { if (!e.signIn) N.toast(e.message, true); } N.show(); } });
      box.innerHTML = `${weekHtml(picked, todayKey)}${monthHtml(month, picked, todayKey)}${dayHtml(picked, todayKey, month)}`;
      // (sizes that vary, set the way the page's rules allow)
      box.querySelectorAll("[data-load]").forEach((c) => c.style.setProperty("--load", c.dataset.load));
      box.querySelectorAll(".bar[data-w]").forEach((b) => b.style.setProperty("width", `${b.dataset.w}%`));
      box.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => { filter = b.dataset.f; N.show(); }));
      box.querySelectorAll("[data-ask]").forEach((b) => b.addEventListener("click", () => askAbout(b.dataset.mode || "nova", b.dataset.ask)));
      // (a day or month picked: the month stays in sight with the day under it; a day from the week's tiles or
      // Next: its own heading at the top; rather than back to the top of the page each time)
      box.addEventListener("click", (e) => { const a = e.target.closest('a[href^="#bookings/"]'); if (a) focus = a.closest(".bookings-month") ? ".bookings-month" : ".bookings-dayname"; });
      const f = focus;
      focus = null;
      if (f) requestAnimationFrame(() => box.querySelector(f)?.scrollIntoView({ block: "start" }));
    },
  });

  // ---- This week at a glance ----
  function weekHtml(picked, todayKey) {
    const days = weekOf(picked);
    const facts = days.map((k) => ({ k, ...dayFacts(k) }));
    const sessions = facts.reduce((n, f) => n + f.list.length, 0);
    const hours = facts.reduce((n, f) => n + f.booked, 0) / 60;
    const takings = facts.reduce((n, f) => n + f.takings, 0);
    const busiest = facts.reduce((a, f) => (f.booked > a.booked ? f : a), facts[0]);
    const clashDay = facts.find((f) => f.clashes.length);
    const clashes = facts.reduce((n, f) => n + f.clashes.length, 0);
    let next = null;
    for (let i = 0; i < 14 && !next; i++) {
      const k = plus(todayKey, i);
      const f = dayFacts(k);
      if (f.free.length) next = { k, slot: f.free[0] };
    }
    const tile = (big, label, href, cls = "") => `<${href ? `a href="${href}"` : "div"} class="sum bookings-sum${cls ? ` ${cls}` : ""}"><b>${esc(big)}</b><span>${esc(label)}</span></${href ? "a" : "div"}>`;
    const pct = Math.round((hours / (OPEN_HOURS * 7)) * 100);
    return `<section class="card bookings-week" aria-label="This week at a glance">
        <p class="kicker">Week of ${esc(short(days[0]))}${days.includes(todayKey) ? " · this week" : ""}</p>
        <div class="sums bookings-sums">
          ${tile(String(sessions), sessions === 1 ? "session" : "sessions")}
          ${tile(`${hours.toFixed(1).replace(/\.0$/, "")}h`, `booked · ${pct}% full`)}
          ${tile(takings ? `£${Math.round(takings).toLocaleString("en-GB")}` : "–", "session value")}
          ${tile(busiest && busiest.booked ? short(busiest.k).split(" ")[0] : "–", "busiest day", busiest && busiest.booked ? `#bookings/${busiest.k}` : "")}
          ${tile(next ? `${next.k === todayKey ? "Today" : short(next.k).split(" ").slice(0, 2).join(" ")} ${hm(next.slot[0])}` : "None", "next free hour", next ? `#bookings/${next.k}` : "", "free")}
          ${clashes ? tile(String(clashes), clashes === 1 ? "clash" : "clashes", `#bookings/${clashDay.k}`, "warn") : ""}
        </div>
      </section>
      <button type="button" class="btn wide bookings-ask" data-mode="nova" data-ask="${esc(`Give me a quick rundown of the week starting ${short(days[0])}: who's in, anything unpaid or clashing, and where we've got space.`)}">${icon("agent")} Ask Nova about this week</button>`;
  }

  // ---- The month ----
  function monthHtml(month, picked, todayKey) {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1, 12));
    const lead = (first.getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const step = (n) => { const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
    const name = `${MONTHS[m - 1]} ${y}`;
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<span class="mday out" aria-hidden="true"></span>');
    for (let d = 1; d <= days; d++) {
      const key = `${month}-${String(d).padStart(2, "0")}`;
      const list_ = bookingsOn(key);
      const suite = suiteOn(key).length;
      const load_ = list_.length ? dayFacts(key).load : 0;
      const cls = ["mday", "bookings-day", key === todayKey ? "today" : "", key === picked ? "picked" : "", key < todayKey ? "past" : "", list_.length ? "loaded" : "", load_ >= 0.85 ? "full" : ""].filter(Boolean).join(" ");
      const dots = `${list_.slice(0, 3).map((b) => `<i data-c="${colour(b.session)}"></i>`).join("")}${list_.length > 3 ? `<em>+${list_.length - 3}</em>` : ""}${suite ? '<i data-c="violet" class="bookings-suite"></i>' : ""}`;
      cells.push(`<a class="${cls}" href="#bookings/${key}/${month}"${list_.length ? ` data-load="${load_.toFixed(2)}"` : ""} aria-label="${d} ${esc(name)}${list_.length ? `, ${list_.length} booking${list_.length === 1 ? "" : "s"}` : ""}${load_ >= 0.85 ? ", full" : ""}"${key === picked ? ' aria-current="date"' : ""}><b>${d}</b><span class="dots">${dots}</span></a>`);
    }
    while (cells.length % 7) cells.push('<span class="mday out" aria-hidden="true"></span>');
    return `<section class="month bookings-month" aria-label="${esc(name)}">
        <div class="bookings-mbar"><a class="icon-btn" href="#bookings/${picked}/${step(-1)}" aria-label="The month before">${icon("back")}</a><b>${esc(name)}</b><a class="icon-btn" href="#bookings/${picked}/${step(1)}" aria-label="The month after">${icon("next")}</a></div>
        <div class="mhead">${["M", "T", "W", "T", "F", "S", "S"].map((x) => `<span>${x}</span>`).join("")}</div>
        <div class="mgrid">${cells.join("")}</div>
        <p class="bookings-key small muted"><span><i class="bookings-glow"></i> brighter: fuller</span><span><i data-c="violet" class="bookings-suite"></i> Calendar or Quests</span>${month !== todayKey.slice(0, 7) || picked !== todayKey ? `<a class="chip" href="#bookings">Today</a>` : ""}</p>
      </section>`;
  }

  // ---- The picked day ----
  function dayHtml(key, todayKey) {
    const f = dayFacts(key);
    const name = long(key);
    const pct = Math.round(f.load * 100);
    const parts = [];
    parts.push(`<h3 class="h bookings-dayname">${esc(name)}${f.list.length ? ` · ${f.list.length} booking${f.list.length === 1 ? "" : "s"}` : ""}</h3>`);
    const smart = [];
    smart.push(`<div class="meter"><div class="meter-top"><span>${(f.booked / 60).toFixed(1).replace(/\.0$/, "")}h of ${OPEN_HOURS}h booked</span><b>${pct}% full</b></div><i class="bar" data-w="${pct}"></i></div>`);
    if (f.takings) smart.push(`<p class="small muted">£${Math.round(f.takings).toLocaleString("en-GB")} of sessions</p>`);
    for (const [a, b] of f.clashes) smart.push(`<p class="bookings-warn">⚠ Clash: ${esc(a.name || a.session)} and ${esc(b.name || b.session)} overlap at ${clock(b.from)}</p>`);
    for (const [a, b] of f.tight) smart.push(`<p class="bookings-note">⏱ Tight changeover: ${esc(a.name || a.session)} ends ${a.to ? clock(a.to) : ""}, ${esc(b.name || b.session)} starts ${clock(b.from)}</p>`);
    if (f.free.length) {
      smart.push(`<p class="small muted bookings-label">Free: tap a time to ask NovaBot for a booking link</p><div class="chips">${f.free.map(([from, to]) => `<button type="button" class="chip bookings-free" data-mode="customer" data-ask="${esc(`Get me a booking link for ${name} at ${hm(from)} (free until ${hm(to)}) to send to a client. Which sessions fit?`)}">${hm(from)}–${hm(to)}</button>`).join("")}</div>`);
    } else if (key >= todayKey) smart.push(`<p class="bookings-note">Fully booked within opening hours.</p>`);
    smart.push(`<div class="chips bookings-filters" role="group" aria-label="What to show">${[["all", "All"], ["bookings", "Bookings"], ["quests", "Quests"], ["notes", "Notes"]].map(([id, l]) => `<button type="button" class="chip" data-f="${id}" aria-pressed="${filter === id}">${l}</button>`).join("")}</div>`);
    parts.push(`<section class="card bookings-smart">${smart.join("")}</section>`);
    parts.push(`<button type="button" class="btn wide bookings-ask" data-mode="nova" data-ask="${esc(`What's on ${name}? Anything I should know: who's in, what's paid, clashes, and free time.`)}">${icon("agent")} Ask Nova about this day</button>`);
    // What's on it, as the filter says
    const suite = suiteOn(key).filter((i) => filter === "all" || (filter === "quests" ? i.kind === "quest" : filter === "notes" ? i.kind !== "quest" : false));
    const suiteList = () => (suite.length ? list(suite.map(suiteRow)) : "");
    const cards = () => f.list.map(card).join("");
    if (filter === "quests" || filter === "notes") parts.push(suite.length ? suiteList() : empty({ icon: filter === "quests" ? "quests" : "notes", title: filter === "quests" ? "No quests this day." : "No Calendar cards this day." }));
    else if (!f.list.length && problem) parts.push(`${empty({ icon: "calendar", title: problem, text: setUp ? "" : "Bookings show here once an admin connects Google (Google, in More)." })}${suiteList()}`);
    else if (!f.list.length && !loaded) parts.push(N.skeleton(2));
    else if (filter === "bookings" && !f.list.length) parts.push(empty({ icon: "calendar", title: "No bookings this day." }));
    else if (filter === "bookings") parts.push(cards());
    else if (suite.length) parts.push(`${cards()}${suiteList()}`);
    else if (!f.list.length) {
      const next = bookings.filter((b) => b.key > key).sort((a, b) => a.from - b.from)[0];
      parts.push(empty({ icon: "calendar", title: "No bookings this day." }));
      if (next) parts.push(list([row({ href: `#bookings/${dayKey(next.from)}`, icon: "calendar", title: `Next: ${next.from.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: UK })}`, text: [who(next), clock(next.from)].join(" · ") })]));
    } else parts.push(cards());
    return parts.join("");
  }
  function suiteRow(i) {
    const href = i.kind === "quest" ? (i.id ? `#quests/quest/${encodeURIComponent(i.id)}` : "#quests") : "#calendar";
    return row({ href, card: true, color: i.kind === "quest" ? "gold" : "violet", lead: i.time ? esc(i.time).replace("–", "<br>") : "All<br>day", title: i.title || "", text: [i.kind === "quest" ? "Quest" : i.kind === "day" ? "Calendar · day" : "Calendar", i.sub].filter(Boolean).join(" · ") });
  }
  // One booking: its time, who, the session, what they told the form, and what to do
  function card(b) {
    const lines = [["Price", b.price], ["Phone", b.phone], ["Email", b.email], ...(b.extra || [])].filter(([, v]) => v);
    const tel = b.phone ? String(b.phone).replace(/[^0-9+]/g, "") : "";
    return `<article class="card edge-card bookings-card" data-c="${colour(b.session)}">
        <p class="kicker">${clock(b.from)}${b.to ? ` – ${clock(b.to)}` : ""}</p>
        <h3 class="card-title">${esc(b.name || "Booking")}</h3>
        ${b.session ? `<p class="muted">${esc(b.session)}</p>` : ""}
        ${lines.length ? `<div class="facts">${lines.map(([l, v]) => `<div class="fact"><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join("")}</div>` : ""}
        <div class="btns two bookings-acts">${tel ? `<a class="btn" href="tel:${esc(tel)}">${icon("phone")} Call</a>` : ""}${b.email ? `<a class="btn" href="mailto:${esc(b.email)}">${icon("mail")} Email</a>` : ""}${b.link ? `<a class="btn" href="${esc(b.link)}" target="_blank" rel="noopener">Open in Google Calendar</a>` : `<a class="btn" href="#calendar/day/${esc(b.key)}">Open in Calendar</a>`}</div>
      </article>`;
  }
})();
