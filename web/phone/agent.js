// Nova on a phone: Agent, talking to Nova Agent (the same conversation as on the computer: one per person,
// kept by Nova Agent on the studio's PC). What it did shows under its reply (a card added, a file made…).
// When the studio's PC is off, Agent can't answer: it says so, and the rest of the phone app still works.
(() => {
  "use strict";
  const { section, api, esc, icon, computerLink } = window.NovaPhone;
  const HDR = { "X-Nova-Visualizer": "1" };
  let messages = null, waiting = false, offline = false;

  // A reply's words: paragraphs, lists, **bold**, `code` and links (the rest as written, safely)
  function words(text) {
    const inline = (s) => esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    const out = [];
    let list = null;
    for (const line of String(text || "").split("\n")) {
      const item = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (item) { (list ||= []).push(`<li>${inline(item[1])}</li>`); continue; }
      if (list) { out.push(`<ul>${list.join("")}</ul>`); list = null; }
      if (line.trim()) out.push(`<p>${inline(line.replace(/^#+\s*/, ""))}</p>`);
    }
    if (list) out.push(`<ul>${list.join("")}</ul>`);
    return out.join("");
  }
  function said(m) {
    const acts = (m.actions || []).map((a) => `<li>${a.url || a.file?.url ? `<a href="${esc(a.url || a.file.url)}" target="_blank" rel="noopener">${esc(a.text || "Open")}</a>` : esc(a.text || a.kind)}</li>`).join("");
    return `<li class="say ${m.role === "user" ? "out me" : "in"}"><div class="say-words">${m.role === "user" ? `<p class="pre">${esc(m.content)}</p>` : words(m.content)}</div>${acts ? `<ul class="acts">${acts}</ul>` : ""}</li>`;
  }

  section({
    id: "agent",
    name: "Agent",
    bottom: true,
    async draw(page) {
      if (!messages) {
        try {
          const r = await api("/chat/history");
          messages = r.messages || [];
          offline = false;
        } catch (err) {
          if (err.signIn) throw err;
          offline = /503/.test(err.message);
          if (!offline) throw err;
          messages = [];
        }
      }
      page.innerHTML = `${offline ? `<div class="card"><p><strong>Nova Agent isn't answering right now.</strong></p><p class="muted">It runs on the studio's PC, which looks to be off. Everything else here still works.</p><button type="button" class="btn" data-again>Try again</button></div>` : ""}
        <ul class="talk agent-talk" id="talk">${messages.map(said).join("") || (offline ? "" : '<li class="note">Ask Nova Agent anything: what\'s on today, to add a note card, to draft a reply…</li>')}</ul>
        ${waiting ? '<p class="note thinking" role="status">Nova Agent is working on it… (it can take a minute or two)</p>' : ""}
        <form class="ask" id="ask">
          <label class="sr" for="ask-box">Message to Nova Agent</label>
          <textarea id="ask-box" name="message" rows="2" placeholder="Message Nova Agent" required${waiting || offline ? " disabled" : ""}></textarea>
          <button class="btn main" type="submit"${waiting || offline ? " disabled" : ""}>Send</button>
        </form>
        <div class="btns"><button type="button" class="btn" data-clear${messages.length && !waiting ? "" : " disabled"}>Start again</button><a class="btn" href="${computerLink("/agent/")}">${icon("open")} Agent on the computer version</a></div>`;
      page.querySelector("[data-again]")?.addEventListener("click", () => { messages = null; window.NovaPhone.show(); });
      page.querySelector("#ask").addEventListener("submit", send);
    },
  });

  async function send(ev) {
    ev.preventDefault();
    const box = ev.target.elements.message;
    const text = box.value.trim();
    if (!text || waiting) return;
    messages.push({ role: "user", content: text, at: new Date().toISOString() });
    waiting = true;
    window.NovaPhone.show();
    try {
      const r = await api("/actions/chat", { method: "POST", headers: HDR, body: JSON.stringify({ message: text }) });
      if (r.ok === false) throw new Error(r.message || "Nova Agent couldn't answer");
      messages.push({ role: "assistant", content: r.reply || "", actions: r.actions || [] });
    } catch (err) {
      messages.push({ role: "assistant", content: `(That didn't reach Nova Agent: ${err.message}. Your message is above; send it again when you're ready.)` });
    } finally {
      waiting = false;
      if (location.hash.startsWith("#agent")) window.NovaPhone.show();
    }
  }
  // Start again: a second tap to be sure (no pop-up), then the conversation is cleared for everyone's Agent view
  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-clear]");
    if (!b) return;
    if (!b.dataset.sure) {
      b.dataset.sure = "1";
      b.textContent = "Tap again to clear the conversation";
      b.classList.add("danger");
      setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = "Start again"; b.classList.remove("danger"); } }, 4000);
      return;
    }
    b.disabled = true;
    try {
      await api("/actions/chat/clear", { method: "POST", headers: HDR, body: "{}" });
      messages = [];
      window.NovaPhone.show();
    } catch (err) {
      b.disabled = false;
      b.textContent = `Not cleared (${err.message})`;
    }
  });
})();
