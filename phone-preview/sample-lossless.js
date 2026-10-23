// The phone preview: Lossless. There's no Nova Bot behind the preview, so its two addresses are stood in for here:
//   /lossless/ice → STUN-less, TURN-less (the devices find each other on this computer, as on one Wi-Fi)
//   /lossless/ws  → a stand-in room server that joins the preview's tabs in this browser (BroadcastChannel), with
//                   the real one's rules: two to a room ("full" for a third), welcome / peer-joined / peer-left,
//                   offer / answer / candidate passed on, "ping" → "pong", the same device's new socket replacing its old.
// So two tabs of the preview, the same room code, make a real call: the real WebRTC data channel, worklets and
// meters, only the introductions done here. The worklets are Nova Desk's own, copied beside the preview (lossless/).
(() => {
  "use strict";
  window.NovaLosslessBase = "lossless/";
  window.NovaLosslessNote = "The preview: its room server only joins tabs in this browser. Open the preview in a second tab with the same room code to be the other device. In Nova Phone it's the real room server, so the other device can be anywhere.";

  (window.NovaSampleExtra = window.NovaSampleExtra || []).push((u) => {
    if (u.pathname === "/lossless/ice") return { iceServers: [], turn: false, ttl: 0, note: "the preview has no relay" };
  });

  const Real = window.WebSocket;
  const RELAYED = new Set(["offer", "answer", "candidate"]);
  const open = new Set();
  class RoomSocket extends EventTarget {
    constructor(url) {
      super();
      const u = new URL(url, location.href);
      this.url = String(url);
      this.readyState = 0;
      this.binaryType = "blob";
      this.bufferedAmount = 0;
      this.room = u.searchParams.get("room") || "";
      this.client = u.searchParams.get("client") || "";
      this.id = Math.random().toString(36).slice(2, 10);
      this.others = new Map();
      this.joined = false;
      this.bc = new BroadcastChannel(`nova-lossless-preview:${this.room}`);
      this.bc.onmessage = (e) => this.heard(e.data);
      this.bc.postMessage({ t: "who", from: this.id, client: this.client });
      open.add(this);
      setTimeout(() => this.join(), 200);
    }
    emit(type, props = {}) {
      const ev = Object.assign(new Event(type), props);
      this[`on${type}`]?.(ev);
      this.dispatchEvent(ev);
    }
    say(msg) { setTimeout(() => this.readyState === 1 && this.emit("message", { data: typeof msg === "string" ? msg : JSON.stringify(msg) }), 0); }
    heard(m) {
      if (m.from === this.id || this.readyState > 1) return;
      if (m.t === "who") {
        // (the same device again, after a blip: its new socket replaces this one, which hasn't really left)
        if (m.client && m.client === this.client) return this.end(4002, false);
        if (this.joined) this.bc.postMessage({ t: "here", from: this.id, to: m.from });
      } else if (m.t === "here" && m.to === this.id) this.others.set(m.from, 1);
      else if (m.t === "joined") { this.others.set(m.from, 1); if (this.joined) this.say({ type: "peer-joined", id: m.from }); }
      else if (m.t === "left") { if (this.others.delete(m.from) && this.joined) this.say({ type: "peer-left", id: m.from }); }
      else if (m.t === "msg" && this.joined) this.say({ ...m.msg, from: m.from });
    }
    join() {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.emit("open");
      if (this.others.size >= 2) {
        this.say({ type: "full" });
        return setTimeout(() => this.end(4000, false), 50);
      }
      this.joined = true;
      this.bc.postMessage({ t: "joined", from: this.id });
      this.say({ type: "welcome", id: this.id, peers: this.others.size });
    }
    send(data) {
      if (this.readyState !== 1) throw new DOMException("not open", "InvalidStateError");
      if (data === "ping") return this.say("pong");
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (this.joined && RELAYED.has(msg?.type)) this.bc.postMessage({ t: "msg", from: this.id, msg });
    }
    close() { this.end(1000, true); }
    end(code, tell) {
      if (this.readyState > 1) return;
      this.readyState = 3;
      if (tell && this.joined) this.bc.postMessage({ t: "left", from: this.id });
      this.bc.close();
      open.delete(this);
      setTimeout(() => this.emit("close", { code, reason: "", wasClean: true }), 0);
    }
  }
  function PreviewSocket(url, protocols) {
    if (/\/lossless\/ws(\?|$)/.test(new URL(url, location.href).pathname + "?")) return new RoomSocket(url);
    return protocols === undefined ? new Real(url) : new Real(url, protocols);
  }
  Object.assign(PreviewSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  PreviewSocket.prototype = Real.prototype;
  window.WebSocket = PreviewSocket;
  // (a tab closing leaves the room, as the real server notices)
  addEventListener("pagehide", () => { for (const s of [...open]) s.close(); });
})();
