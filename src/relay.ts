// Nova Agent online: the link to Nova Bot that lets the online Nova Agent reach this PC.
//
// This computer can't be reached from the internet, so Nova Agent dials out instead: it keeps
// a WebSocket open to Nova Bot (/nova-agent/link, with AGENT_NOVA_KEY). When a signed-in staff
// member uses Nova Agent online, Nova Bot sends their request down it (chat, Missions, Quests,
// Calendar's data, the Visualizer); it's answered here by the same server as the local page,
// and the answer goes back up, streamed. The other side is src/agent-relay.js in Nova Bot.
//
// Only Nova Agent's own addresses are answered (RELAYED, the same list as Nova Bot's), and a
// relayed request never counts as "from our page" (src/signin.ts), so the PC's Portal sign-in,
// Portal's API and the staff pages can't be reached this way.
// Dropped connection (Nova Bot redeployed, network gone): it reconnects by itself.

import { config } from "./config";
import { trace } from "./trace";

type Handler = (request: Request) => Response | Promise<Response>;
type Staff = { id?: string; name?: string; role?: string } | null;
type Frame =
  | { t: "req"; id: string; method: string; path: string; headers: Record<string, string>; staff: Staff; body: boolean }
  | { t: "body"; id: string; d: string }
  | { t: "end"; id: string }
  | { t: "cancel"; id: string };

// The same list as RELAYED in Nova Bot's src/agent-relay.js (keep the two together)
const RELAYED: { methods: string[]; path: RegExp; admin?: boolean }[] = [
  { methods: ["GET"], path: /^\/status$/ },
  { methods: ["GET"], path: /^\/quests\/(state|events)$/ },
  { methods: ["POST"], path: /^\/actions\/(chat|missions|quests|blocks|rhythm|replan)$/ },
  { methods: ["POST"], path: /^\/actions\/(missions|quests)\/[\w-]+(\/(refine|export))?$/ },
  { methods: ["POST"], path: /^\/actions\/files\/[\w-]+\/remove$/ },
  { methods: ["GET"], path: /^\/files\/(list|[\w-]+\/[^/]+)$/ },
  { methods: ["GET", "PUT"], path: /^\/calendar-api\/data$/ },
  { methods: ["GET"], path: /^\/calendar-api\/events$/ },
  { methods: ["GET"], path: /^\/(events|cache|tasks)$/, admin: true },
  { methods: ["POST"], path: /^\/actions\/(run\/[\w-]+|forget)$/, admin: true },
  // The Fixer (src/fixer/routes.ts): admins only
  { methods: ["GET"], path: /^\/fixer-api\/(state|jobs\/[\w-]+|shots\/[\w-]+\/[\w-]+\.png)$/, admin: true },
  { methods: ["POST"], path: /^\/actions\/fixer\/(check|settings|quests|(quests|suggestions|issues|jobs)\/[\w-]+)$/, admin: true },
];

// Whether the link is up right now (the Fixer's health check asks)
export const relayLink = { up: false };

export function plainPath(pathname: string): boolean {
  if (typeof pathname !== "string" || !pathname.startsWith("/") || pathname.length > 512) return false;
  if (/%(2e|2f|5c|00)|\\|\/\.\.?(\/|$)|\/\//i.test(pathname)) return false;
  try {
    decodeURIComponent(pathname);
  } catch {
    return false;
  }
  return true;
}

// May this relayed request be answered? (Nova Bot checked already; this is the second lock)
export function relayAllowed(method: string, path: string, staff: Staff): boolean {
  const pathname = path.split("?")[0];
  if (!plainPath(pathname) || !staff?.id) return false;
  const rule = RELAYED.find((r) => r.methods.includes(method) && r.path.test(pathname));
  return !!rule && (!rule.admin || staff.role === "admin");
}

const MAX_BODY = 25 * 1024 * 1024;
const PIECE = 256 * 1024;
const PASS_HEADERS = ["accept", "content-type", "x-nova-visualizer", "x-nova-rev", "x-nova-app", "last-event-id", "range"];
// A made-up host: relayed requests are never "from this computer" (see fromOurPage)
const RELAY_ORIGIN = "http://online.nova-agent.invalid";

export function startRelay(handle: Handler): void {
  if (!config.agentNovaKey) {
    console.log("Not linking Nova Agent online: set AGENT_NOVA_KEY in .env (the same as the worker's secret).");
    return;
  }
  const url = config.workerUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/nova-agent/link";
  let ws: WebSocket | null = null;
  let delay = 1000;
  let wasUp = false;
  let lastPong = 0;
  let beat: ReturnType<typeof setInterval> | undefined;
  const running = new Map<string, { stop: () => void }>();
  const incoming = new Map<string, { req: Extract<Frame, { t: "req" }>; parts: Buffer[]; size: number }>();

  const send = (frame: unknown) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
  };
  // Don't flood a slow connection: wait while a lot is still queued
  const roomToSend = async () => {
    while (ws && ws.readyState === WebSocket.OPEN && ws.bufferedAmount > 8 * 1024 * 1024) await new Promise((r) => setTimeout(r, 50));
  };

  async function answer(req: Extract<Frame, { t: "req" }>, body?: Buffer) {
    const { id } = req;
    if (!relayAllowed(req.method, req.path, req.staff)) {
      send({ t: "res", id, status: 403, headers: { "content-type": "application/json" } });
      send({ t: "chunk", id, d: Buffer.from(JSON.stringify({ error: "Not allowed" })).toString("base64") });
      send({ t: "done", id });
      return;
    }
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    running.set(id, {
      stop: () => {
        controller.abort();
        reader?.cancel().catch(() => {});
      },
    });
    try {
      const headers = new Headers();
      for (const h of PASS_HEADERS) if (req.headers?.[h]) headers.set(h, req.headers[h]);
      headers.set("X-Nova-Online", req.staff?.name || req.staff?.id || "staff");
      // (Nova Bot checked who it is; only admins reach the Fixer's addresses: src/fixer/routes.ts)
      headers.set("X-Nova-Online-Role", req.staff?.role || "");
      if (req.method !== "GET" && req.method !== "HEAD") trace("input", "info", `Online, ${req.staff?.name || "someone"}: ${req.method} ${req.path.split("?")[0]}`);
      const res = await handle(
        new Request(RELAY_ORIGIN + req.path, { method: req.method, headers, body: body && body.length ? new Uint8Array(body) : undefined, signal: controller.signal }),
      );
      if (!running.has(id)) return void res.body?.cancel().catch(() => {});
      const out: Record<string, string> = {};
      res.headers.forEach((v, k) => (out[k] = v));
      send({ t: "res", id, status: res.status, headers: out });
      if (res.body) {
        reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done || !running.has(id)) break;
          for (let i = 0; i < value.byteLength; i += PIECE) {
            await roomToSend();
            send({ t: "chunk", id, d: Buffer.from(value.subarray(i, i + PIECE)).toString("base64") });
          }
        }
      }
      send({ t: "done", id });
    } catch (err) {
      if (running.has(id)) send({ t: "error", id, message: (err as Error).message });
    } finally {
      running.delete(id);
    }
  }

  function onFrame(frame: Frame) {
    if (frame.t === "req") {
      if (!frame.body) return void answer(frame);
      incoming.set(frame.id, { req: frame, parts: [], size: 0 });
      return;
    }
    if (frame.t === "body") {
      const into = incoming.get(frame.id);
      if (!into) return;
      const part = Buffer.from(frame.d, "base64");
      into.size += part.length;
      if (into.size > MAX_BODY) {
        incoming.delete(frame.id);
        send({ t: "error", id: frame.id, message: "Too big" });
        return;
      }
      into.parts.push(part);
      return;
    }
    if (frame.t === "end") {
      const into = incoming.get(frame.id);
      if (!into) return;
      incoming.delete(frame.id);
      return void answer(into.req, Buffer.concat(into.parts));
    }
    if (frame.t === "cancel") {
      incoming.delete(frame.id);
      running.get(frame.id)?.stop();
      running.delete(frame.id);
    }
  }

  function stopAll() {
    for (const r of running.values()) r.stop();
    running.clear();
    incoming.clear();
  }

  function connect() {
    let socket: WebSocket;
    try {
      // Node's WebSocket takes headers (the key never goes in the address)
      socket = new WebSocket(url, { headers: { Authorization: `Bearer ${config.agentNovaKey}` } } as unknown as string[]);
    } catch (err) {
      return later(`couldn't start (${(err as Error).message})`);
    }
    ws = socket;
    socket.onopen = () => {
      relayLink.up = true;
      delay = 1000;
      lastPong = Date.now();
      if (!wasUp) trace("llm", "ok", "Nova Agent is online: linked to Nova Bot, so it can be used from anywhere");
      wasUp = true;
      clearInterval(beat);
      beat = setInterval(() => {
        // No answer to the heartbeat for a minute: the connection is gone, start again
        if (Date.now() - lastPong > 60_000) return socket.close();
        if (socket.readyState === WebSocket.OPEN) socket.send("ping");
      }, 25_000);
    };
    socket.onmessage = (event) => {
      const text = typeof event.data === "string" ? event.data : Buffer.from(event.data as ArrayBuffer).toString("utf8");
      if (text === "pong") return void (lastPong = Date.now());
      try {
        onFrame(JSON.parse(text) as Frame);
      } catch {}
    };
    socket.onerror = () => {};
    socket.onclose = (event) => {
      if (ws !== socket) return;
      relayLink.up = false;
      clearInterval(beat);
      stopAll();
      ws = null;
      // Another Nova Agent took over the link (a second copy running): don't fight over it
      if (event.code === 4001) {
        trace("llm", "warn", "Another Nova Agent linked to Nova Bot instead of this one; trying again in a minute");
        wasUp = false;
        return void setTimeout(connect, 60_000);
      }
      later(event.code === 1006 || !wasUp ? "no connection" : `closed (${event.code})`);
    };
  }

  function later(why: string) {
    if (wasUp) trace("llm", "warn", `Nova Agent's online link dropped (${why}); reconnecting`);
    wasUp = false;
    setTimeout(connect, delay);
    delay = Math.min(delay * 2, 30_000);
  }

  connect();
}
