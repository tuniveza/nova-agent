// Nova Phone: voice commands (Portal's mic, app.js "Voice commands", portal.md G2). Tap "Say what to do", say it,
// and Nova Phone does it: the recording goes to Nova Bot (POST /app/api/voice, a WAV), which writes the words
// down (Whisper), and they're matched to a command below. A question, or anything that isn't a command, is asked
// of Nova (POST /app/api/ask), shown and said out loud.
// The same on every phone engine: the microphone (getUserMedia), MediaRecorder (Safari's mp4, Chrome's webm,
// Firefox's ogg) and Web Audio to turn it into a 16 kHz WAV, as Portal does. Nothing is kept on the phone.
// Hands-free ("Always listen", G3) is not here: it keeps the microphone and a check ten times a second running the
// whole time Nova Phone is open, which a phone pays for in battery (ns CLAUDE.md 2e: still when idle).
//   window.NovaPhoneVoice = { open(), can }
(() => {
  "use strict";
  if (window.NovaPhoneVoice) return;
  const N = window.NovaPhone;
  const { esc, icon, api, post, toast } = N;
  const AC = window.AudioContext || window.webkitAudioContext;
  const can = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder && AC && window.OfflineAudioContext);
  let sheet = null, close = null, mic = null, recorder = null;
  const history = [];

  // ---- The sheet: what it's doing, what was heard, Nova's answer ----
  function view({ status, heard = "", answer = "", listening = false, thinking = false }) {
    if (!sheet) return;
    sheet.querySelector("[data-v-status]").textContent = status;
    sheet.querySelector("[data-v-ring]").classList.toggle("on", listening);
    sheet.querySelector("[data-v-ring]").classList.toggle("thinking", thinking);
    const h = sheet.querySelector("[data-v-heard]");
    h.hidden = !heard; h.textContent = heard ? `“${heard}”` : "";
    const a = sheet.querySelector("[data-v-answer]");
    a.hidden = !answer; a.textContent = answer;
    sheet.querySelector("[data-v-stop]").hidden = !listening;
    sheet.querySelector("[data-v-again]").hidden = listening || thinking;
    sheet.querySelector("[data-v-say]").hidden = !answer || !("speechSynthesis" in window);
  }
  const HELP = ["Show alerts", "New enquiries", "Calendar", "Call (a name)", "Email (a name)", "Mark (a name) done", "What's booked tomorrow?", "Delete alerts after 7 days", "Refresh"];
  function open() {
    if (!can) {
      return N.form(`<h2 class="sheet-title">Voice commands</h2><p class="sheet-text">This browser can't record sound, so voice commands can't work here. Everything they do is a tap away in Nova Phone.</p><div class="btns"><button type="button" class="btn wide quiet" data-no>Close</button></div>`, (el, done) => { el.querySelector("[data-no]").onclick = () => done(null); });
    }
    // (the sound for the level meter is started here, in the tap itself: iPhones only allow sound after a tap)
    const ctx = new AC();
    ctx.resume().catch(() => {});
    N.form(`<h2 class="sheet-title">Say what to do</h2>
      <div class="voice-ring" data-v-ring aria-hidden="true">${icon("mic")}</div>
      <p class="sheet-text" data-v-status role="status">Listening…</p>
      <p class="voice-heard" data-v-heard hidden></p>
      <p class="voice-answer" data-v-answer hidden></p>
      <div class="btns">
        <button type="button" class="btn main wide" data-v-stop>${icon("check")} Done</button>
        <button type="button" class="btn main wide" data-v-again hidden>${icon("mic")} Say something else</button>
        <button type="button" class="btn wide" data-v-say hidden>Say it again</button>
        <button type="button" class="btn wide quiet" data-no>Close</button>
      </div>
      <p class="small muted voice-help">Try: ${HELP.map(esc).join(" · ")}</p>`, (el, done) => {
      sheet = el;
      close = () => done(null);
      el.querySelector("[data-no]").onclick = () => done(null);
      el.querySelector("[data-v-stop]").onclick = () => { if (recorder && recorder.state === "recording") recorder.stop(); };
      el.querySelector("[data-v-again]").onclick = () => { const c = new AC(); c.resume().catch(() => {}); listen(c); };
      el.querySelector("[data-v-say]").onclick = () => speak(el.querySelector("[data-v-answer]").textContent);
    }).then(() => { cancel(); closeMic(); sheet = null; if (window.speechSynthesis) speechSynthesis.cancel(); });
    listen(ctx);
  }

  // ---- The microphone ----
  async function openMic(ctx) {
    if (mic) { try { mic.ctx.close(); } catch (err) {} mic.ctx = ctx; }
    const stream = mic ? mic.stream : await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const meter = ctx.createAnalyser();
    meter.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(meter);
    mic = { stream, ctx, meter, samples: new Float32Array(meter.fftSize) };
    return mic;
  }
  function closeMic() {
    if (!mic) return;
    mic.stream.getTracks().forEach((t) => t.stop());
    mic.ctx.close().catch(() => {});
    mic = null;
  }
  // (someone talking: loud enough to be speech; with the meter not running, as can happen on an iPhone, it
  // listens until Done or 8 seconds)
  function talking() {
    if (mic.ctx.state !== "running") return null;
    mic.meter.getFloatTimeDomainData(mic.samples);
    let sum = 0;
    for (const x of mic.samples) sum += x * x;
    return Math.sqrt(sum / mic.samples.length) > 0.02;
  }
  function recordOnce(waitMs) {
    return new Promise((resolve) => {
      const rec = new MediaRecorder(mic.stream);
      const chunks = [];
      rec.addEventListener("dataavailable", (e) => e.data && e.data.size && chunks.push(e.data));
      const started = Date.now();
      let spoke = false, lastSound = Date.now(), blind = false;
      const timer = setInterval(() => {
        const t = talking();
        if (t === null) { blind = true; spoke = true; }
        else if (t) { spoke = true; lastSound = Date.now(); }
        const long = Date.now() - started;
        if ((!blind && spoke && Date.now() - lastSound > 1200) || (!spoke && long > waitMs) || (blind && long > 8000) || long > 15000) {
          if (rec.state === "recording") rec.stop();
        }
      }, 100);
      rec.addEventListener("stop", async () => {
        clearInterval(timer);
        if (recorder === rec) recorder = null;
        if (rec.cancelled || !spoke || !chunks.length) return resolve(null);
        resolve(await toWav(new Blob(chunks, { type: rec.mimeType || chunks[0].type })).catch(() => null));
      });
      recorder = rec;
      rec.start();
    });
  }
  function cancel() { if (recorder) { recorder.cancelled = true; if (recorder.state === "recording") recorder.stop(); } }
  // A WAV at 16,000 samples a second, in mono (what Whisper always reads)
  async function toWav(blob) {
    const dec = new AC();
    const decoded = await dec.decodeAudioData(await blob.arrayBuffer());
    dec.close().catch(() => {});
    const rate = 16000;
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
    const src = off.createBufferSource();
    src.buffer = decoded; src.connect(off.destination); src.start();
    const pcm = (await off.startRendering()).getChannelData(0);
    const v = new DataView(new ArrayBuffer(44 + pcm.length * 2));
    const text = (at, s) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
    text(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true); text(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); text(36, "data"); v.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
    return new Blob([v], { type: "audio/wav" });
  }
  async function transcribe(wav) {
    const r = await fetch("/app/api/voice", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav, credentials: "same-origin" });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) throw Object.assign(new Error("Sign in first"), { signIn: true });
    if (!r.ok) throw new Error(d.error || "Couldn't make that out. Try again.");
    return d.text || "";
  }

  async function listen(ctx) {
    try { await openMic(ctx); } catch (err) {
      try { ctx.close(); } catch (e) {}
      return view({ status: "Nova Phone can't use the microphone. Allow it for this site in the phone's settings, then try again." });
    }
    view({ status: "Listening…", listening: true });
    N.sound("open");
    const wav = await recordOnce(7000);
    if (!sheet) return;
    if (!wav) return view({ status: "Nothing heard. Tap below and try again." });
    view({ status: "Working out what you said…", thinking: true });
    try {
      const said = await transcribe(wav);
      if (!sheet) return;
      if (!said) return view({ status: "Couldn't make that out. Try again." });
      await run(said);
    } catch (err) {
      if (err.signIn) { close && close(); return N.show(); }
      view({ status: err.message });
    }
  }

  // ---- What was said ----
  function daysSaid(t) {
    const d = t.match(/\b(\d{1,2})\b/);
    if (d) return Number(d[1]);
    if (/\b(a|one) day\b/.test(t)) return 1;
    if (/\bthree days\b/.test(t)) return 3;
    if (/\b(a|one) week\b|\bseven days\b/.test(t)) return 7;
    if (/\bfortnight\b|\btwo weeks\b|\bfourteen days\b/.test(t)) return 14;
    if (/\b(a|one) month\b|\bthirty days\b/.test(t)) return 30;
    return 0;
  }
  async function findPerson(spoken) {
    let alerts = [], enquiries = [];
    try { alerts = (await api("/app/api/notifications")).notifications || []; } catch (err) {}
    try { enquiries = (await api("/app/api/enquiries?show=all")).enquiries || []; } catch (err) {}
    const people = [...alerts.map((a) => a.contact).filter((c) => c && c.name), ...enquiries.map((q) => ({ name: q.name, email: q.email, phone: q.phone, enquiry: q }))];
    const words = spoken.toLowerCase().split(/[^a-z']+/);
    let best = null, score = 0;
    for (const p of people) {
      const s = String(p.name).toLowerCase().split(/\s+/).filter((w) => w.length > 1 && words.includes(w)).length;
      if (s > score) { best = p; score = s; }
    }
    return best;
  }
  const go = (to) => { close && close(); location.hash = to; };
  // Places by the names people say
  const PLACES = [
    [/\b(calendar|diary|schedule|bookings?|sessions?)\b/, "#calendar"], [/\b(alerts?|notifications?)\b/, "#inbox/alerts"], [/\b(chats?|conversations?)\b/, "#inbox/chats"],
    [/\bapprovals?\b/, "#inbox/approvals"], [/\b(invoices?|money|invoicer)\b/, "#money"], [/\bquests?\b/, "#quests"], [/\bnotes?\b/, "#notes"],
    [/\bboard\b/, "#board"], [/\bindex\b/, "#index"], [/\bclients?\b/, "#clients"], [/\b(campaigns?|outreach)\b/, "#outreach"], [/\bsettings?\b/, "#settings"], [/\b(today|portal|home)\b/, "#today"],
  ];
  async function run(said) {
    N.activity(`Said “${said}”`);
    const t = said.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
    const n = daysSaid(t);
    const done = (status) => view({ status, heard: said });
    if (/^(what|whats|what's|when|who|whose|where|which|how|is|are|was|were|does|do|did|has|have|had|can|could|tell|give|any|list|find|check)\b/.test(t)) return askNova(said);
    if (/auto ?delete|delete (my |the )?alerts after|keep alerts/.test(t)) {
      const days = /\b(off|stop|never|forever)\b/.test(t) ? 0 : [1, 3, 7, 14, 30].includes(n) ? n : -1;
      if (days < 0) return done("Say 1, 3, 7, 14 or 30 days, or “auto delete off”.");
      await post("/app/api/notifications/settings", { days });
      toast(days ? `Alerts delete themselves after ${days} day${days === 1 ? "" : "s"}` : "Alerts are kept until you delete them");
      return go("#inbox/alerts");
    }
    if (/\b(delete|clear|remove|wipe)\b.*\b(alerts?|notifications?)\b/.test(t) && !/\b(latest|last|newest|top|first)\b/.test(t)) {
      close && close();
      if (!(await N.confirm({ title: "Delete every alert?", text: "They go from every phone. This can't be undone.", ok: "Delete them all", danger: true }))) return;
      await post("/app/api/notifications/delete", { all: true });
      toast("Every alert deleted");
      location.hash = "#inbox/alerts";
      return N.show();
    }
    if (/\b(delete|remove)\b.*\b(latest|last|newest|top|first)\b/.test(t)) {
      const latest = ((await api("/app/api/notifications")).notifications || [])[0];
      if (!latest) return done("No alerts to delete.");
      close && close();
      if (!(await N.confirm({ title: `Delete the alert “${latest.title}”?`, ok: "Delete", danger: true }))) return;
      await post("/app/api/notifications/delete", { id: latest.id });
      toast("Alert deleted");
      location.hash = "#inbox/alerts";
      return N.show();
    }
    let m = t.match(/^(call|ring|phone)\b (.+)/);
    if (m) {
      const p = await findPerson(m[2]);
      if (!p || !p.phone) return done(p ? `${p.name} has no phone number.` : `Couldn't find “${m[2]}”.`);
      close && close();
      if (await N.confirm({ title: `Call ${p.name}?`, text: p.phone, ok: "Call" })) location.href = `tel:${p.phone.replace(/[^0-9+]/g, "")}`;
      return;
    }
    m = t.match(/^(email|e mail|mail)\b (.+)/);
    if (m) {
      const p = await findPerson(m[2]);
      if (!p || !p.email) return done(p ? `${p.name} has no email.` : `Couldn't find “${m[2]}”.`);
      close && close();
      location.href = `mailto:${encodeURIComponent(p.email)}`;
      return;
    }
    m = t.match(/\bmark (.+?) (as )?(done|finished|complete)\b/);
    if (m) {
      const p = await findPerson(m[1]);
      if (!p || !p.enquiry) return done(`Couldn't find an enquiry from “${m[1]}”.`);
      await post("/app/api/enquiries/status", { id: p.enquiry.id, status: "done" });
      toast(`${p.name}'s enquiry marked done`);
      return go("#inbox");
    }
    if (/\btest\b.*\bnotification/.test(t)) { await post("/app/api/push/test", {}); toast("Test notification sent"); return done("Sent a test notification to every signed-up phone."); }
    if (/\b(sign|log) ?out\b/.test(t)) {
      close && close();
      if (!(await N.confirm({ title: "Sign out everywhere?", text: "On this phone and every other place you're signed in.", ok: "Sign out", danger: true }))) return;
      await post("/auth/logout", {});
      return location.reload();
    }
    if (/^(refresh|reload|update)\b/.test(t)) { close && close(); return N.refresh(); }
    if (/^ask (nova ?bot)\b/.test(t) && N.has("bot")) return go("#bot");
    if (/\b(en|in)quir/.test(t) && !/^ask\b/.test(t)) return go(/\ball\b/.test(t) ? "#inbox/box/all" : "#inbox");
    if (!/^ask\b/.test(t)) for (const [re, to] of PLACES) if (re.test(t) && t.split(" ").length <= 5) return go(to);
    return askNova(said.replace(/^\s*ask\s+(nova\s*(bot)?\s*)?[,:]?\s*/i, "") || said);
  }
  async function askNova(question) {
    view({ status: "Thinking…", heard: question, thinking: true });
    try {
      const { answer } = await post("/app/api/ask", { question, history });
      history.push({ role: "user", content: question }, { role: "assistant", content: answer });
      history.splice(0, Math.max(0, history.length - 6));
      if (!sheet) return;
      view({ status: "Nova says", heard: question, answer });
      speak(answer);
    } catch (err) {
      if (err.signIn) { close && close(); return N.show(); }
      view({ status: err.message, heard: question });
    }
  }
  function speak(text) {
    if (!("speechSynthesis" in window) || !text) return;
    speechSynthesis.cancel();
    const w = new SpeechSynthesisUtterance(String(text).replace(/[*_#`]/g, ""));
    w.lang = "en-GB";
    const v = speechSynthesis.getVoices().find((x) => x.lang === "en-GB");
    if (v) w.voice = v;
    speechSynthesis.speak(w);
  }

  window.NovaPhoneVoice = { open, can };
})();
