// Signing in to Nova Bot as a person, from Nova Agent on the studio PC.
//
// Portal uses Nova Bot's staff API (/app/api/*, /auth/*, /staff*).
// Online, the browser talks to Nova Bot itself. Here, Nova Agent passes those
// requests on: signing in in the Portal logs in to Nova Bot the way an app does
// (an app token, "nsess_…"), and the token stays in data/signin.json, never in the
// browser. Every request after that goes to Nova Bot as that person, with their
// permissions; signing out ends the session on Nova Bot too.
//
// Only Nova Agent's own pages can use this: requests must come to localhost (not a
// look-alike address), and changes must come from Nova Agent's own origin, so
// another website open in the browser can't act as you through it.

import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { config } from "./config";
import { connectId } from "./staff";
import { trace } from "./trace";

const file = `${config.paths.dataDir}signin.json`;
type Session = { token: string; staff: { id: string; display_name: string; role: string }; at: string };

export function session(): Session | null {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Session) : null;
  } catch {
    return null;
  }
}
function keep(s: Session) {
  writeFileSync(file, JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
}
function drop() {
  rmSync(file, { force: true });
}

// A request from Nova Agent's own page? (Host is localhost; changes come from this origin)
export function fromOurPage(req: Request): boolean {
  const host = req.headers.get("host") || "";
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  if (!local) return false;
  if (req.method === "GET" || req.method === "HEAD") return true;
  const origin = req.headers.get("origin");
  return !!origin && new URL(origin).host === host;
}

async function worker(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  return fetch(`${config.workerUrl}${path}`, {
    ...init,
    // Nova Bot checks that changes come from its own site: an app token is the proof here
    headers: { ...(init.headers || {}), Origin: new URL(config.workerUrl).origin },
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
}

// POST /auth/login from the Portal: log in as an app, keep the token here
export async function signIn(body: Record<string, unknown>): Promise<{ status: number; data: unknown }> {
  let res: Response;
  try {
    res = await worker("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, client: "app" }) });
  } catch (err) {
    return { status: 502, data: { error: "Can't reach Portal just now. Check the connection and try again." } };
  }
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; token?: string; staff?: Session["staff"] };
  if (res.ok && data.token && data.staff) {
    keep({ token: data.token, staff: { id: data.staff.id, display_name: data.staff.display_name, role: data.staff.role }, at: new Date().toISOString() });
    await connectId(data.staff);
    const { token, ...rest } = data;
    return { status: 200, data: rest };
  }
  return { status: res.status, data };
}

export async function signOut(): Promise<void> {
  const s = session();
  drop();
  if (s) await worker("/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${s.token}` } }).catch(() => {});
  trace("llm", "info", "Signed out of Nova Bot on this computer");
}

// Pass a request on to Nova Bot as the signed-in person. Without a session: 401, like Nova Bot.
export async function passOn(req: Request): Promise<Response> {
  const s = session();
  if (!s) return Response.json({ error: "Sign in first (the Portal)", signedIn: false }, { status: 401 });
  const url = new URL(req.url);
  const headers: Record<string, string> = { Authorization: `Bearer ${s.token}` };
  const type = req.headers.get("content-type");
  if (type) headers["Content-Type"] = type;
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
  let res: Response;
  try {
    res = await worker(url.pathname + url.search, { method: req.method, headers, body });
  } catch (err) {
    return Response.json({ error: `Nova Bot can't be reached: ${(err as Error).message}` }, { status: 502 });
  }
  // The session ended on Nova Bot's side (signed out elsewhere, or expired)
  if (res.status === 401) drop();
  const out = new Headers();
  for (const h of ["content-type", "cache-control", "location"]) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(res.body, { status: res.status, headers: out });
}
