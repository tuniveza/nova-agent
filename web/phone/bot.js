// Nova Phone: Website bot (Nova Desk's Portal → Website bot). Two ways to talk, as on Nova Desk:
//   Ask Nova            questions about the studio's bookings, enquiries and alerts (POST /app/api/ask
//                       { question, history } → { answer })
//   NovaBot · bookings  the website's NovaBot with the booking tools, as clients get it, talking to you as staff
//                       (POST /app/api/chat { messages } → { reply }): booking links, moving a session…
// These conversations aren't saved (kept on this phone only while the app is open). Switching between the two,
// or New conversation, starts again. Booking tools hands a question over ready to send (window.NovaPhoneBotAsk).
// Addresses: #bot (Ask Nova), #bot/customer (NovaBot · bookings).
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, post, toast } = N;
  const HINT = {
    nova: "Ask about your bookings, enquiries and alerts: “What time is Eric's session?”, “Any new enquiries?”. These conversations aren't saved.",
    customer: "NovaBot with the booking tools, talking to you as staff: “Get me a link for a 2-hour vocal session for Dana”, “Move Eric's Thursday session to 3pm”. These conversations aren't saved.",
  };
  let mode = "nova", history = [], waiting = false, draft = "";

  // A reply's words, its links as links (a booking link and Google Calendar by name, as on Nova Desk)
  function words(text) {
    const link = (url) => {
      const trail = url.match(/[.,!?;:)]+$/);
      const u = trail ? url.slice(0, -trail[0].length) : url;
      const name = /acuityscheduling|\/(book\?|pay\/|booking\/)/.test(u) ? "Booking link" : /calendar\.google\.com|google\.com\/calendar/.test(u) ? "Google Calendar" : u.replace(/^https?:\/\//, "");
      return `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(name)}</a>${trail ? esc(trail[0]) : ""}`;
    };
    return String(text || "").split("\n").filter((l, i, all) => l.trim() || (i && all[i - 1].trim())).map((line) => `<p>${line.split(/(https?:\/\/[^\s<>"']+)/).map((part, i) => (i % 2 ? link(part) : esc(part).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>"))).join("")}</p>`).join("");
  }
  const bubble = (m) => `<li class="say${m.role === "user" ? " me" : ""}${m.error ? " note" : ""}">${m.role === "user" ? `<p class="pre">${esc(m.content)}</p>` : words(m.content)}</li>`;

  N.section({
    id: "bot",
    name: "Website bot",
    tile: "portal",
    bottom: () => true,
    async draw(box, [which], ui) {
      await N.css("bot.css");
      const want = which === "customer" ? "customer" : "nova";
      // (switching starts a new conversation, as on Nova Desk)
      if (want !== mode) { mode = want; history = []; draft = ""; }
      const ask = window.NovaPhoneBotAsk;
      if (ask && (ask.mode === "customer" ? "customer" : "nova") === mode) { draft = ask.text || ""; window.NovaPhoneBotAsk = null; }
      ui.title("Website bot");
      if (history.length) ui.action({ icon: "refresh", label: "New conversation", run: () => { history = []; draft = ""; N.show(); } });
      const who = mode === "nova" ? "Nova" : "NovaBot";
      box.innerHTML = `<div class="seg bot-seg" role="tablist"><a role="tab" class="seg-a" href="#bot" aria-selected="${mode === "nova"}">Ask Nova</a><a role="tab" class="seg-a" href="#bot/customer" aria-selected="${mode === "customer"}">NovaBot · bookings</a></div>
        <div class="bot-about"><p class="muted small">See what clients get when they chat on the website. For your own questions, use Nova Agent.</p><a class="chip" href="#agent">${icon("agent")} Ask Nova Agent instead</a></div>
        <p class="small bot-hint">${esc(HINT[mode])}</p>
        <ul class="talk bot-talk" aria-live="polite">${history.map(bubble).join("")}${waiting ? `<li class="typing" aria-label="${who} is typing"><i></i><i></i><i></i></li>` : ""}</ul>
        ${history.length ? `<button type="button" class="btn quiet wide" data-new>${icon("refresh")} New conversation</button>` : ""}
        <form class="composer" data-bot><label class="sr" for="bot-box">Message ${who}</label><textarea class="input" id="bot-box" rows="1" placeholder="${mode === "nova" ? "Ask Nova…" : "Ask NovaBot…"}"${waiting ? " disabled" : ""}>${esc(draft)}</textarea><button class="btn main" type="submit" aria-label="Send"${waiting ? " disabled" : ""}>${icon("send")}</button></form>`;
      const f = box.querySelector("[data-bot]");
      const t = f.querySelector("textarea");
      t.addEventListener("input", () => (draft = t.value));
      t.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(pointer: fine)").matches) { e.preventDefault(); f.requestSubmit(); } });
      f.addEventListener("submit", send);
      box.querySelector("[data-new]")?.addEventListener("click", () => { history = []; draft = ""; N.show(); });
      // (a question handed over from Booking tools: in the box, ready to send or change)
      if (draft) requestAnimationFrame(() => { if (t.isConnected) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } });
    },
  });

  async function send(ev) {
    ev.preventDefault();
    const text = ev.target.querySelector("textarea").value.trim();
    if (!text || waiting) return;
    const was = mode, at = location.hash;
    history.push({ role: "user", content: text });
    draft = "";
    waiting = true;
    N.show();
    try {
      // (what went wrong earlier is only shown, never sent)
      const said = history.filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
      const reply = was === "nova"
        ? (await post("/app/api/ask", { question: text, history: said.slice(0, -1) })).answer
        : (await post("/app/api/chat", { messages: said })).reply;
      if (mode === was) history.push({ role: "assistant", content: reply || "(No answer came back.)" });
    } catch (err) {
      if (mode === was) {
        history.pop();
        draft = text;
        if (err.signIn) toast("Sign in again to carry on", true);
        else history.push({ role: "assistant", error: true, content: `Couldn't reach ${was === "nova" ? "Nova" : "NovaBot"}: ${err.message}. Your question is back in the box to send again.` });
      }
    } finally {
      waiting = false;
      if (location.hash === at) N.show();
    }
  }
})();
