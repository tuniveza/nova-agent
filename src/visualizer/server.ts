// Nova Agent's local web pages, on http://localhost:4545:
//
//   /             the chat: talk to Nova Agent, with Calendar beside it
//   /calendar/    Calendar (the ../../calendar folder), saving to Nova Agent
//   /visualizer   every step the agent takes, live: what it's looking for, what
//                 it remembered, what it asked the AI, what the browser saw
//
//   npm run visualizer      then open http://localhost:4545
//
// While it runs, it also:
//   - runs the daily read-only healthcheck (HEALTHCHECK_CRON, default 06:00 UK)
//   - collects jobs from Novabot every minute (jobs.ts)
// so this is the process to keep running (npm run service does the same).
//
// It only listens on this computer (127.0.0.1), because the steps include
// client names and the AI prompts. To view it from the VPS later, use an
// SSH tunnel:  ssh -L 4545:localhost:4545 your-vps

import { fromOurPage, passOn, passOnPicture, session, signIn, signOut } from "../signin";
import { createReadStream, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import cron from "node-cron";
import { config } from "../config";
import { addDays, today } from "../acuity/list";
import { readCache } from "../heal/cache";
import { runHealthcheck } from "../healthcheck";
import { startCollectingJobs } from "../jobs";
import { startRelay } from "../relay";
import { checkLogin, describeAppointments, listTask, readOnlyTour } from "../tasks";
import { getRecentEvents, onTrace, trace } from "../trace";
import { calendarEvents, readCalendar } from "../calendar/store";
import { saveFromPage } from "../calendar/page";
import { chat } from "../chat";
import { adoptChat, chatTurn, clearChat, readChat } from "../chats";
import { ownerToSave, personFor, type Person } from "../person";
import { whoAmI } from "../staff";
import { drawPlanet } from "./planet";
import { addBlock, addQuest, mayChange, questState, removeBlock, removeMission, removeQuest, setMilestone, setQuestMode, setQuestStatus, setRhythm, snoozeQuest, tidyBlocks, updateMission, updateQuest } from "../quests/actions";
import { replan } from "../quests/plan";
import { createMission, refineMission } from "../quests/planner";
import { startPortalSync } from "../quests/portalsync";
import { startPulses } from "../quests/pulses";
import { startQuestReminders } from "../quests/reminders";
import { startBookingRefresh } from "../quests/bookings";
import { questEvents, readQuests } from "../quests/store";
import { missionMarkdown } from "../quests/export";
import { CONTENT_TYPES, fileCard, findFile, listFiles, readFileText, removeFile, saveFile } from "../files";
import { MAX_RECEIPT_BYTES, RECEIPT_TYPES, receipts } from "../receipts";
import { registerFixerRoutes } from "../fixer/routes";
import { registerTidyRoutes } from "../tidy-routes";
import { MAX_VIDEO_BYTES, MEDIA_ID, MEDIA_TYPES, mediaCard, mediaStore, readRange } from "../social-media";
import { backupFilesToDrive, copyToDriveLater, dropFromDriveLater } from "../google";
import { currentFixer, startFixer } from "../fixer/service";

// Everything Nova Agent shows lives in web/: its own page (web/agent) and each panel
const web = (path: string) => fileURLToPath(new URL(`../../web/${path}`, import.meta.url));
const pageFile = web("agent/page.html");
const chatFile = web("agent/chat.html");
const syncFile = web("agent/calendar-sync.js");
const calendarRoot = web("calendar/");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".webmanifest": "application/manifest+json",
};

// The tasks the page's buttons can start (the page builds a button for
// each one). All of them are read-only.
const TASKS: Record<string, { label: string; run: () => Promise<string> }> = {
  "check-login": { label: "Check login", run: checkLogin },
  "next-7-days": {
    label: "Next 7 days",
    run: async () => describeAppointments(await listTask(today(), addDays(today(), 6))),
  },
  "last-30-days": {
    label: "Last 30 days",
    run: async () => describeAppointments(await listTask(addDays(today(), -30), today())),
  },
  tour: { label: "Read-only tour", run: readOnlyTour },
  healthcheck: { label: "Health check", run: async () => (await runHealthcheck()).summary },
};

const app = new Hono();

// Buttons on the page send this header. Other websites can't add custom
// headers to requests to this server, so they can't press our buttons.
app.use("/actions/*", async (c, next) => {
  if (c.req.header("X-Nova-Visualizer") !== "1") {
    return c.json({ ok: false, message: "Missing visualizer header" }, 403);
  }
  await next();
});

// ---- One address: Nova Agent online ----
// A page opened in a browser on this computer opens Nova Agent online instead
// (https://…workers.dev/agent/), which reaches this server over its link (src/relay.ts).
// NOVA_LOCAL_UI=1 keeps the pages here (for when the internet is down). Only top-level pages:
// Nova Agent's own requests, files and the online link's requests aren't touched.
app.use("*", async (c, next) => {
  if (config.localUi || c.req.header("Sec-Fetch-Dest") !== "document" || (c.req.method !== "GET" && c.req.method !== "HEAD")) return next();
  const path = c.req.path;
  const last = path.slice(path.lastIndexOf("/") + 1);
  if (last.includes(".") && !last.endsWith(".html")) return next();
  const online = config.workerUrl.replace(/\/$/, "") + "/agent/";
  const search = new URL(c.req.url).search;
  if (path === "/" || path === "/agent" || path === "/agent/") return c.redirect(online + search);
  if (path.startsWith("/agent/")) return c.redirect(config.workerUrl.replace(/\/$/, "") + path + search);
  if (PANELS.some((p) => path === p || path.startsWith(p + "/"))) return c.redirect(online + "?open=" + encodeURIComponent(path + search));
  return c.redirect(online);
});

// ---- Panels have no pages of their own ----
// Opened on its own (a bookmark, a typed address, an old link), a panel opens inside Nova Agent
// instead: /agent/?open=<its address>. Inside Nova Agent's viewer (a frame) it loads as itself. The
// browser says which (Sec-Fetch-Dest); web/shared/inside.js catches browsers that don't.
const PANELS = ["/portal", "/calendar", "/notes", "/app/memory", "/observatory", "/lossless", "/visualizer", "/admin", "/fixer"];
app.use("*", async (c, next) => {
  const path = c.req.path;
  const page = (c.req.method === "GET" || c.req.method === "HEAD") && c.req.header("Sec-Fetch-Dest") === "document";
  const last = path.slice(path.lastIndexOf("/") + 1);
  // (Connecting Google leaves Nova Agent: Google won't show its sign-in inside a frame)
  if (page && (!last.includes(".") || last.endsWith(".html")) && PANELS.some((p) => path === p || path.startsWith(p + "/")) && !/^\/admin\/google(\/|$)/.test(path)) {
    return c.redirect("/agent/?open=" + encodeURIComponent(path + new URL(c.req.url).search));
  }
  await next();
});

// The pages. Read from disk each time, so edits show on refresh.
// Nova Agent's page is /agent/, the same address as online; /agent/<panel> opens it with that panel
const PANEL_NAMES: Record<string, string> = { portal: "/portal/", calendar: "/calendar/", notes: "/notes/", index: "/app/memory/", observatory: "/observatory/", lossless: "/lossless/", visualizer: "/visualizer", admin: "/admin", fixer: "/fixer/" };
app.get("/", (c) => c.redirect("/agent/"));
app.get("/agent", (c) => c.redirect("/agent/"));
app.get("/agent/", (c) => c.html(readFileSync(chatFile, "utf8")));
app.get("/agent/:name{[a-z]+}", (c, next) => {
  const panel = PANEL_NAMES[c.req.param("name")];
  return panel ? c.redirect("/agent/?open=" + encodeURIComponent(panel + new URL(c.req.url).search)) : next();
});
app.get("/visualizer", (c) => c.html(readFileSync(pageFile, "utf8")));

// ---- The installable app: manifest, service worker and icons ----
const appRoot = web("agent/assets/");
const appFile = (name: string) => (c: any) => c.body(readFileSync(appRoot + name), 200, { "Content-Type": TYPES[extname(name)], "Cache-Control": "no-cache" });
app.get("/manifest.webmanifest", appFile("manifest.webmanifest"));
app.get("/sw.js", appFile("sw.js"));
// Nova Agent's own icons (/app/ was Portal's old address)
app.get("/agent/:file", (c) => {
  const name = c.req.param("file");
  if (/^[\w-]+\.(png|svg|js|css)$/.test(name) && existsSync(appRoot + name)) return appFile(name)(c);
  return c.text("Not found", 404);
});

// ---- Observatory and Notes, served from their folders next to Nova Agent ----
// So they're always on while Nova Agent is, and open inside it in any browser (as part of
// Nova Agent, a privacy-minded browser doesn't block what they save). Notes here keeps
// its own notes on this computer, separate from the web app's.
const MEDIA: Record<string, string> = { ".mp4": "video/mp4", ".webm": "video/webm", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8" };
// `skip`: paths under the prefix that aren't files (the staff API under /app/api/)
function serveFolder(prefix: string, folder: string, missing: string, skip?: RegExp) {
  const root = web(folder);
  app.get(prefix, (c) => c.redirect(prefix + "/"));
  app.get(prefix + "/*", async (c, next) => {
    if (skip?.test(c.req.path)) return next();
    const rel = decodeURIComponent(c.req.path.slice(prefix.length + 1)) || "index.html";
    const file = resolve(root, rel);
    if (!file.startsWith(root.replace(/[\\/]$/, "") + sep) || !existsSync(file) || !statSync(file).isFile()) {
      if (!existsSync(root + "index.html")) return c.text(missing, 404);
      return c.text("Not found", 404);
    }
    const type = TYPES[extname(file)] || MEDIA[extname(file)] || "application/octet-stream";
    return c.body(readFileSync(file) as any, 200, { "Content-Type": type, "Cache-Control": "no-cache" });
  });
}
// Notes and Calendar keep an offline copy of themselves on their own; inside Nova Agent that
// only meant seeing the previous version after an update. Here their offline helper clears
// what it kept, steps aside and reloads the page with the current version.
const RETIRE_OFFLINE = `// Inside Nova Agent nothing is kept offline: clear the old copy, step aside, reload.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  for (const key of await caches.keys()) await caches.delete(key);
  await self.registration.unregister();
  for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url);
})()));
`;
for (const path of ["/notes/sw.js", "/calendar/sw.js"]) {
  app.get(path, (c) => c.body(RETIRE_OFFLINE, 200, { "Content-Type": TYPES[".js"], "Cache-Control": "no-cache" }));
}
serveFolder("/observatory", "observatory/", "Observatory is missing from web/observatory.");
serveFolder("/notes", "notes/", "Notes is missing from web/notes.");
// Lossless audio: the page only; its signalling and relay setup are Nova Bot's (/lossless/ws, /lossless/ice)
serveFolder("/lossless", "lossless/public/lossless/", "Lossless audio is missing from web/lossless.");
serveFolder("/app/memory", "index/", "Index is missing from web/index.");
// The Fixer: Nova Agent's caretaker (its addresses: src/fixer/routes.ts)
serveFolder("/fixer", "fixer/", "The Fixer is missing from web/fixer.");
registerFixerRoutes(app, currentFixer);
// Test stuff: quests, calendar notes, Fixer jobs and files that look like tests (admins: src/tidy.ts)
registerTidyRoutes(app, currentFixer);
// Where Index was for a day
app.get("/index/*", (c) => c.redirect("/app/memory/" + c.req.path.slice("/index/".length)));

// ---- What every panel shares: the look (themes), sounds, the Nova Agent badge and the Manual ----
// The badge asks this server who Nova Agent works for (src/staff.ts), which asks Nova Bot with
// Nova Agent's key; the planet pictures come through here too, so the panels never talk to another site.
serveFolder("/shared", "shared/", "web/shared is missing.");

// ---- Portal, as a panel ----
// It uses Nova Bot's staff API. Signing in on the Portal signs Nova Agent in to Nova Bot
// as that person (src/signin.ts); their requests are passed on with that sign-in.
serveFolder("/portal", "portal/", "web/portal is missing.");
// Portal's old address: its pages go to Portal (/app/#nova stays #nova; the browser keeps it).
// The API (/app/api/) and Index (/app/memory/) keep theirs, and so do the files phones that
// installed Portal still use (its push helper, manifest and icons).
const oldPortalFiles = web("portal/old-app-address/");
const OLD_ADDRESS_FILES = new Set(["sw.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"]);
app.get("/app", (c) => c.redirect("/portal/" + new URL(c.req.url).search));
app.get("/app/*", async (c, next) => {
  const rest = c.req.path.slice("/app/".length);
  if (/^(api|memory)(\/|$)/.test(rest)) return next();
  if (OLD_ADDRESS_FILES.has(rest)) {
    const type = TYPES[extname(rest)] || MEDIA[extname(rest)] || (rest.endsWith(".webmanifest") ? "application/manifest+json" : "application/octet-stream");
    return c.body(readFileSync(oldPortalFiles + rest) as any, 200, { "Content-Type": type, "Cache-Control": "no-cache" });
  }
  return c.redirect("/portal/" + new URL(c.req.url).search);
});
// Where they were for a day
app.get("/studio/*", (c) => c.redirect("/portal/" + new URL(c.req.url).search));
app.get("/crew/*", (c) => c.redirect("/portal/" + c.req.path.slice("/crew/".length) + new URL(c.req.url).search));
for (const path of ["/auth/*", "/staff", "/staff/*", "/app/api/*"]) {
  app.use(path, async (c, next) => (fromOurPage(c.req.raw) ? next() : c.json({ error: "Only from Nova Agent's own pages" }, 403)));
}
app.post("/auth/login", async (c) => {
  const { status, data } = await signIn((await c.req.json().catch(() => ({}))) as Record<string, unknown>);
  return c.json(data as any, status as any);
});
app.post("/auth/logout", async (c) => {
  await signOut();
  return c.json({ ok: true });
});
// There's no shared password any more: everyone signs in with their own account in the Portal
app.post("/app/api/login", (c) => c.json({ error: "On the studio computer, sign in with your own account in Portal." }, 400));
app.post("/app/api/logout", async (c) => {
  await signOut();
  return c.json({ ok: true });
});

// Who's signed in: only the person signed in on this computer (src/signin.ts), so the
// planet at the top shows someone exactly when every panel works without signing in.
// Nobody signed in: 401, like Nova Bot. Nova Bot out of reach: who it was, from the saved sign-in.
app.get("/auth/me", async (c) => {
  const s = session();
  if (!s) return c.json({ error: "Not signed in", signedIn: false }, 401, { "Cache-Control": "no-store" });
  const res = await passOn(c.req.raw);
  if (res.status !== 502) return res;
  return c.json({ staff: { ...s.staff, planet_seed: s.staff.id }, via: "portal", offline: true }, 200, { "Cache-Control": "no-store" });
});
const planetCache = new Map<string, { at: number; body: string }>();
app.get("/staff/:id/planet.svg", async (c) => {
  const url = `${config.workerUrl}/staff/${encodeURIComponent(c.req.param("id"))}/planet.svg${new URL(c.req.url).search}`;
  let hit = planetCache.get(url);
  if (!hit || Date.now() - hit.at > 10 * 60_000) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        hit = { at: Date.now(), body: await res.text() };
        if (planetCache.size > 200) planetCache.clear();
        planetCache.set(url, hit);
      }
    } catch {}
  }
  if (hit) return c.body(hit.body, 200, { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=300" });
  // Nova Bot out of reach: drawn here from the id, and not kept, so the saved planet returns with Nova Bot
  try {
    const svg = await drawPlanet(c.req.param("id"), new URL(c.req.url).searchParams);
    return c.body(svg, 200, { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store" });
  } catch {
    return c.text("Not found", 404);
  }
});

// ---- Index's data, through Nova Agent's own key ----
// The same addresses Index uses online (/app/api/memory/...), passed on to the
// memory engine as Nova Agent: the studio's memory and staff memory, never customers'.
// Approvals (customers' facts) need a Portal sign-in.
async function toEngine(path: string, init: RequestInit = {}) {
  const res = await fetch(`${config.workerUrl}/memory${path}`, {
    ...init,
    headers: { ...((init.headers as Record<string, string>) || {}), Authorization: `Bearer ${config.agentNovaKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
app.all("/app/api/memory/*", async (c) => {
  if (session()) return passOn(c.req.raw);
  if (!config.agentNovaKey) return c.json({ error: "Nova Agent isn't connected to Nova Bot (AGENT_NOVA_KEY)" }, 503);
  // Changes only from the page itself (the header makes other websites' requests fail)
  if (c.req.method !== "GET" && c.req.header("X-Nova-App") !== "index") return c.json({ error: "Forbidden" }, 403);
  const route = c.req.path.slice("/app/api/memory".length);
  const query = new URL(c.req.url).search;
  if (route === "/pending") return c.json({ pending: [], locked: true });
  if (route.startsWith("/pending/")) return c.json({ error: "Approvals need a Portal sign-in" }, 403);
  // Tidy up (the cleanup and its bin) is for an admin signed in to Portal, never this key
  if (route === "/cleanup" || route.startsWith("/cleanup/")) return c.json({ error: "Cleaning up Index is for admins, signed in to Portal" }, 403);
  if (route === "/stats") {
    const { data } = await toEngine("/index");
    const by = new Map<string, { scope: string; files: number; facts: number }>();
    for (const f of (data.files || []) as { scope: string; facts: number }[]) {
      const s = by.get(f.scope) || { scope: f.scope, files: 0, facts: 0 };
      s.files += 1;
      s.facts += f.facts || 0;
      by.set(f.scope, s);
    }
    return c.json({ scopes: [...by.values()], pending: 0, locked: true });
  }
  if (route === "/index" || route === "/file") {
    const body = c.req.method === "PUT" ? await c.req.text() : undefined;
    const { status, data } = await toEngine(route + query, { method: c.req.method, body });
    return c.json(data, status as any);
  }
  return c.json({ error: "Not found" }, 404);
});

// The rest of Nova Bot's staff API (Portal), as the signed-in person
app.all("/app/api/*", (c) => passOn(c.req.raw));
app.all("/auth/*", (c) => passOn(c.req.raw));
app.all("/staff", (c) => passOn(c.req.raw));
app.all("/staff/*", (c) => passOn(c.req.raw));
// Shared notes (Notes): the team's notes, kept by Nova Bot, as the person signed in here.
// Changes only from Nova Agent's own pages, like the rest of the staff API.
app.use("/notes-api/*", async (c, next) => (fromOurPage(c.req.raw) ? next() : c.json({ error: "Only from Nova Agent's own pages" }, 403)));
app.all("/notes-api/*", (c) => passOn(c.req.raw));
// Nova Agent's front page: "Today in music" (the live charts and musicians' photos come from Nova Bot)
app.get("/music-world", (c) => passOn(c.req.raw));

// Which version of the pages this PC is serving (web/shared/update.js asks, like it asks Nova Bot
// online): the newest change to any file in web/, so an open Nova Agent refreshes itself after an
// update here too. Worked out at most every 30 seconds.
let pageVersion = { at: 0, version: "" };
function newestChange(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = resolve(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestChange(full) : statSync(full).mtimeMs);
  }
  return newest;
}
app.get("/app-version", (c) => {
  if (Date.now() - pageVersion.at > 30_000) {
    try {
      pageVersion = { at: Date.now(), version: `pc-${Math.round(newestChange(web("")))}` };
    } catch {
      pageVersion = { at: Date.now(), version: pageVersion.version || "pc" };
    }
  }
  return c.json({ version: pageVersion.version }, 200, { "Cache-Control": "no-store" });
});
app.get("/music-world/*", (c) => passOnPicture(c.req.raw));

// ---- Admin, as a panel: Nova Bot's admin pages, as the person signed in on this computer ----
// (Online they're Nova Bot's own, at the same address.) Signed out: Portal, then back here.
async function admin(c: any) {
  if (!fromOurPage(c.req.raw)) return c.text("Only from Nova Agent's own pages", 403);
  const here = c.req.path + new URL(c.req.url).search;
  if (!session()) return c.req.method === "GET" ? c.redirect("/portal/?next=" + encodeURIComponent(here)) : c.text("Sign in with Portal first.", 401);
  const res = await passOn(c.req.raw);
  // Nova Bot's links back to itself (signing in, Portal) stay inside Nova Agent
  const where = res.headers.get("location");
  if (!where || !where.startsWith(config.workerUrl)) return res;
  const headers = new Headers(res.headers);
  headers.set("location", where.slice(config.workerUrl.replace(/\/$/, "").length) || "/");
  return new Response(res.body, { status: res.status, headers });
}
app.all("/admin", admin);
app.all("/admin/*", admin);

// ---- Calendar, served from the calendar folder ----
// Its own offline helper isn't needed (or wanted) here: Nova Agent is the server.
app.get("/calendar-sync.js", (c) => c.body(readFileSync(syncFile, "utf8"), 200, { "Content-Type": TYPES[".js"], "Cache-Control": "no-cache" }));
app.get("/calendar", (c) => c.redirect("/calendar/"));
app.get("/calendar/*", (c) => {
  const rel = decodeURIComponent(c.req.path.slice("/calendar/".length)) || "index.html";
  const file = resolve(calendarRoot, rel);
  if (!file.startsWith(calendarRoot.replace(/[\\/]$/, "") + sep) || !existsSync(file) || !statSync(file).isFile()) {
    if (!existsSync(calendarRoot + "index.html")) return c.text("The calendar folder is empty: run  git submodule update --init  in the Nova Agent folder.", 404);
    return c.text("Not found", 404);
  }
  let body: string | Buffer = readFileSync(file);
  if (rel === "index.html") {
    // Save to Nova Agent instead of only the browser (see calendar-sync.js)
    body = body.toString("utf8").replace('<script src="js/store.js"></script>', '<script src="/calendar-sync.js"></script>\n<script src="js/store.js"></script>');
  }
  return c.body(body as any, 200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
});

// The calendar's data: read by the calendar page and saved back from it
app.get("/calendar-api/data", (c) => c.json(readCalendar()));
// (merged with changes made elsewhere since the page loaded revision X-Nova-Rev: see calendar/page.ts)
app.put("/calendar-api/data", async (c) => {
  if (c.req.header("X-Nova-Visualizer") !== "1") return c.json({ ok: false }, 403);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, message: "That isn't calendar data" }, 400);
  }
  try {
    return c.json({ ok: true, ...saveFromPage(body, Number(c.req.header("X-Nova-Rev"))) });
  } catch (error) {
    trace("task", "error", `Calendar: a change from the page didn't save: ${(error as Error).message}`);
    return c.json({ ok: false, message: (error as Error).message }, 500);
  }
});
// Tells an open calendar page that Nova Agent changed something, so it refreshes
app.get("/calendar-api/events", (c) =>
  streamSSE(c, async (stream) => {
    const send = () => void stream.writeSSE({ event: "change", data: String(Date.now()) });
    calendarEvents.on("change", send);
    stream.onAbort(() => {
      calendarEvents.off("change", send);
    });
    while (!stream.aborted) {
      await stream.sleep(20_000);
      await stream.writeSSE({ event: "ping", data: "" });
    }
  }),
);

// How Nova Agent is set up (for the chat page's status pill)
app.get("/status", (c) =>
  c.json({ live: !config.dryRun, connected: Boolean(config.agentNovaKey), model: config.novaModel || "claude-opus-5-5" }),
);

// ---- Missions and Quests ----
// Each person's own (who's asking: src/person.ts). ?who=everyone: everyone's, for admins and the
// studio computer; ?who=notes: their own plus quests tied to a note (Notes, for shared notes).
app.get("/quests/state", async (c) => {
  const person = await personFor(c.req.raw);
  const asked = c.req.query("who");
  const everyone = asked === "everyone" && person.everyone;
  return c.json({
    ...questState({ id: person.id, everyone, notes: asked === "notes" }),
    person: { id: person.id, name: person.name, role: person.role },
    scope: everyone ? "everyone" : "mine",
    canSeeEveryone: person.everyone,
  });
});
// Live: the plan changed, or a reminder / check-in is due (only the person's own notices)
app.get("/quests/events", async (c) => {
  const person = await personFor(c.req.raw);
  return streamSSE(c, async (stream) => {
    const changed = () => void stream.writeSSE({ event: "changed", data: String(Date.now()) });
    const notice = (n: { owner?: string }) => {
      if (!n.owner || n.owner === person.id) void stream.writeSSE({ event: "notice", data: JSON.stringify(n) });
    };
    questEvents.on("changed", changed);
    questEvents.on("notice", notice);
    stream.onAbort(() => {
      questEvents.off("changed", changed);
      questEvents.off("notice", notice);
    });
    while (!stream.aborted) {
      await stream.sleep(20_000);
      await stream.writeSSE({ event: "ping", data: "" });
    }
  });
});
// Theirs to change? (anyone's for an admin or the PC; staff: their own, and quests tied to a note)
function allowed(person: Person, kind: "quest" | "mission" | "block", id: string): void {
  const data = readQuests();
  const list: { id: string; owner: string; link?: string }[] = kind === "quest" ? data.quests : kind === "mission" ? data.missions : data.blocks;
  const exact = list.find((x) => x.id === id);
  const starts = list.filter((x) => x.id.startsWith(id));
  const item = exact ?? (starts.length === 1 ? starts[0] : undefined);
  if (item && !mayChange(item, person)) throw new Error(`That ${kind === "block" ? "blocked time" : kind} isn't yours to change.`);
}
const questAction = async (c: any, fn: () => unknown) => {
  try {
    return c.json({ ok: true, result: await fn() });
  } catch (error) {
    return c.json({ ok: false, message: (error as Error).message }, 400);
  }
};
app.post("/actions/missions", async (c) => {
  const person = await personFor(c.req.raw);
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.request !== "string" || !body.request.trim()) return c.json({ ok: false, message: "Describe the mission first." }, 400);
  return questAction(c, () => createMission(body.request, { deadline: body.deadline, owner: ownerToSave(person) }));
});
app.post("/actions/missions/:id", async (c) => {
  const person = await personFor(c.req.raw);
  const body = await c.req.json().catch(() => ({}));
  const id = c.req.param("id");
  return questAction(c, () => {
    allowed(person, "mission", id);
    if (body.remove) return removeMission(id);
    if (typeof body.milestone === "string") return setMilestone(id, body.milestone, body.done === true);
    return updateMission(id, { title: body.title, status: body.status, deadline: body.deadline });
  });
});
// Answers to the plan's questions, or any new detail: the work that's left is planned again
// ---- Social posts' pictures and videos (social-media.ts): Portal → Social adds them; Nova Bot
// fetches them for Meta when an approved post goes out (both over the link when online) ----
app.post("/actions/social-media", async (c) => {
  const size = Number(c.req.header("Content-Length") || 0);
  if (size > MAX_VIDEO_BYTES) return c.json({ ok: false, message: "That's too big (up to 100 MB)." }, 413);
  const person = await personFor(c.req.raw).catch(() => null);
  const bytes = Buffer.from(await c.req.arrayBuffer());
  if (!bytes.length) return c.json({ ok: false, message: "No file came through." }, 400);
  try {
    const entry = mediaStore.save(bytes, { name: c.req.query("name"), by: person?.id || "" });
    trace("input", "ok", `Social: ${person?.online ? `${person.name} ` : ""}added a ${entry.kind} (${Math.round(entry.size / 1000)} KB)`);
    // A copy in the studio's Google Drive, so posts go out with this computer off (google.ts)
    copyToDriveLater("media", entry.id, entry.name, MEDIA_TYPES[entry.ext], bytes);
    return c.json({ ok: true, media: mediaCard(entry) });
  } catch (error) {
    return c.json({ ok: false, message: (error as Error).message }, 400);
  }
});
app.post("/actions/social-media/:id/remove", (c) => {
  const id = c.req.param("id");
  if (!MEDIA_ID.test(id)) return c.json({ ok: false, message: "No such file" }, 404);
  if (!mediaStore.remove(id)) return c.json({ ok: false, message: "No such file" }, 404);
  dropFromDriveLater("media", id);
  return c.json({ ok: true });
});
app.on(["GET", "HEAD"], "/social-media/:file", (c) => {
  const m = /^([a-f0-9]{32})\.(jpg|png|webp|gif|mp4|mov)$/.exec(c.req.param("file"));
  const entry = m ? mediaStore.find(m[1]) : null;
  if (!entry || entry.ext !== m![2]) return c.text("No such file", 404);
  const headers: Record<string, string> = {
    "Content-Type": MEDIA_TYPES[entry.ext],
    "Accept-Ranges": "bytes",
    // (how big it is, for Nova Bot: the link doesn't carry Content-Length)
    "X-Nova-Size": String(entry.size),
    "Cache-Control": "private, max-age=86400, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
  };
  const download = c.req.query("download");
  if (download !== undefined) {
    const name = entry.name.replace(/["\\]/g, "") || `${entry.kind}.${entry.ext}`;
    headers["Content-Disposition"] = `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;
  }
  const range = readRange(c.req.header("Range"), entry.size);
  if (range === "bad") return c.body(null, 416, { ...headers, "Content-Range": `bytes */${entry.size}` });
  const [start, end] = range ?? [0, entry.size - 1];
  headers["Content-Length"] = String(end - start + 1);
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${entry.size}`;
  if (c.req.method === "HEAD") return c.body(null, range ? 206 : 200, headers);
  const stream = Readable.toWeb(createReadStream(mediaStore.path(entry), { start, end })) as ReadableStream;
  return c.body(stream, range ? 206 : 200, headers);
});

// ---- Files Nova Agent wrote (files.ts): the list, each one to view or download ----
app.get("/files/list", (c) => c.json({ files: listFiles().map(fileCard) }, 200, { "Cache-Control": "no-store" }));
app.get("/files/:id/:name", (c) => {
  const f = findFile(c.req.param("id"));
  if (!f || f.id !== c.req.param("id")) return c.text("No such file", 404);
  const download = c.req.query("download") !== undefined;
  return c.body(readFileText(f), 200, {
    // Markdown and CSV show as plain text in the browser; ?download saves the file
    "Content-Type": download ? CONTENT_TYPES[f.type] : f.type === "html" ? CONTENT_TYPES.html : f.type === "json" ? CONTENT_TYPES.json : "text/plain; charset=utf-8",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${f.name.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    // A file is only ever a document: it can't run scripts or reach Nova Agent's pages
    "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: https:",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  });
});
app.post("/actions/files/:id/remove", (c) => {
  try {
    return c.json({ ok: true, file: fileCard(removeFile(c.req.param("id"))) });
  } catch (error) {
    return c.json({ ok: false, message: (error as Error).message }, 404);
  }
});
// ---- Receipts for expenses (receipts.ts): Portal → Money uploads one, and shows it ----
// The upload is the file itself (its type in Content-Type); the answer is the receipt's name,
// which Portal saves on the expense in Nova Bot.
app.post("/actions/receipts", async (c) => {
  const type = (c.req.header("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (!RECEIPT_TYPES[type]) return c.json({ ok: false, message: "A receipt is a photo (JPEG, PNG, WebP, HEIC) or a PDF." }, 415);
  if (Number(c.req.header("Content-Length") || 0) > MAX_RECEIPT_BYTES) return c.json({ ok: false, message: "That's too big for a receipt (20 MB at most)." }, 413);
  try {
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const receipt = receipts.save(bytes, type);
    // A copy in the studio's Google Drive, so Portal shows it with this computer off (google.ts)
    copyToDriveLater("receipt", receipt.id, receipt.id, type, bytes);
    return c.json({ ok: true, receipt });
  } catch (error) {
    return c.json({ ok: false, message: (error as Error).message }, 400);
  }
});
app.get("/receipts/:id", (c) => {
  const found = receipts.read(c.req.param("id"));
  if (!found) return c.text("No such receipt", 404);
  return c.body(new Uint8Array(found.bytes), 200, {
    "Content-Type": found.type,
    "Content-Disposition": `inline; filename="${c.req.param("id")}.${RECEIPT_TYPES[found.type] || "bin"}"`,
    // Only ever a picture or a PDF to look at: it can't run anything
    "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; object-src 'self'",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=3600",
  });
});
// A mission's whole plan as a Markdown file (exporting again updates the same file)
app.post("/actions/missions/:id/export", async (c) => {
  const person = await personFor(c.req.raw);
  try {
    allowed(person, "mission", c.req.param("id"));
    const doc = missionMarkdown(c.req.param("id"));
    const source = `mission:${doc.missionId}`;
    const before = listFiles().find((f) => f.source === source);
    return c.json({ ok: true, file: fileCard(saveFile({ name: doc.name, title: doc.title, content: doc.content, id: before?.id, source })) });
  } catch (error) {
    return c.json({ ok: false, message: (error as Error).message }, 400);
  }
});

app.post("/actions/missions/:id/refine", async (c) => {
  const person = await personFor(c.req.raw);
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.detail !== "string" || !body.detail.trim()) return c.json({ ok: false, message: "Say what's new first." }, 400);
  return questAction(c, () => {
    allowed(person, "mission", c.req.param("id"));
    return refineMission(c.req.param("id"), body.detail, { deadline: body.deadline });
  });
});
// A new quest is the asker's (from Notes: the person who wrote it in the note)
app.post("/actions/quests", async (c) => {
  const person = await personFor(c.req.raw);
  return questAction(c, async () => addQuest(await c.req.json(), ownerToSave(person)));
});
app.post("/actions/quests/:id", async (c) => {
  const person = await personFor(c.req.raw);
  const body = await c.req.json().catch(() => ({}));
  const id = c.req.param("id");
  return questAction(c, () => {
    allowed(person, "quest", id);
    if (body.action === "done") return setQuestStatus(id, "done");
    if (body.action === "finish") return setQuestStatus(id, "done", true);
    if (body.action === "start") return setQuestStatus(id, "doing");
    if (body.action === "skip") return setQuestStatus(id, "skipped");
    if (body.action === "reopen") return setQuestStatus(id, "todo");
    if (body.action === "snooze") return snoozeQuest(id, Number(body.minutes) || 15);
    if (body.action === "remove") return removeQuest(id);
    if (body.action === "mode") return setQuestMode(id, String(body.mode || ""));
    return updateQuest(id, body.changes || {});
  });
});
app.post("/actions/blocks", async (c) => {
  const person = await personFor(c.req.raw);
  const body = await c.req.json().catch(() => ({}));
  return questAction(c, () => {
    if (!body.remove) return addBlock(body.start, body.end, body.reason, ownerToSave(person));
    allowed(person, "block", String(body.id || ""));
    return removeBlock(body.id);
  });
});
// Their own rhythm (the PC's person's is the main one)
app.post("/actions/rhythm", async (c) => {
  const person = await personFor(c.req.raw);
  return questAction(c, async () => setRhythm(await c.req.json(), ownerToSave(person)));
});
app.post("/actions/replan", (c) => questAction(c, () => {
  const r = replan();
  return { atRisk: r.atRisk, unplaced: r.unplaced };
}));

// ---- The chat ----
// Each person's own conversation (src/chats.ts), kept here; the Agent knows who it's talking to
app.get("/chat/history", async (c) => {
  const person = await personFor(c.req.raw);
  return c.json({ ok: true, person: { id: person.id, name: person.name, role: person.role, owner: person.pcOwner }, messages: readChat(person.id) }, 200, { "Cache-Control": "no-store" });
});
app.post("/actions/chat/clear", async (c) => {
  clearChat((await personFor(c.req.raw)).id);
  return c.json({ ok: true });
});
// The conversation this browser kept before (the PC's person's only, once, into an empty history)
app.post("/actions/chat/adopt", async (c) => {
  const person = await personFor(c.req.raw);
  const body = await c.req.json().catch(() => ({}));
  return c.json({ ok: true, ...adoptChat(person, body.messages) });
});
app.post("/actions/chat", async (c) => {
  let body: { message?: unknown; messages?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, message: "Bad request" }, 400);
  }
  if (!body || (typeof body.message !== "string" && !Array.isArray(body.messages))) return c.json({ ok: false, message: "Bad request" }, 400);
  try {
    const person = await personFor(c.req.raw);
    return c.json({ ok: true, ...(await chatTurn(person, body, chat)) });
  } catch (error) {
    const message = (error as Error).message;
    trace("llm", "error", `Agent failed: ${message}`);
    return c.json({ ok: false, message: /api[_ ]?key|authentication|401/i.test(message) ? "Nova Agent can't reach Claude: check ANTHROPIC_API_KEY in .env." : "Nova Agent couldn't answer just now. Try again in a moment." }, 500);
  }
});

// Live event stream. Sends recent history first, then each new event.
app.get("/events", (c) =>
  streamSSE(c, async (stream) => {
    for (const event of getRecentEvents()) {
      await stream.writeSSE({ data: JSON.stringify(event) });
    }
    const stopListening = onTrace((event) => {
      void stream.writeSSE({ data: JSON.stringify(event) });
    });
    stream.onAbort(stopListening);

    // Keep the connection open, with a small ping so proxies don't close it.
    while (!stream.aborted) {
      await stream.sleep(20_000);
      await stream.writeSSE({ event: "ping", data: "" });
    }
  }),
);

// What's in the selector cache (the agent's memory) right now.
app.get("/cache", (c) => c.json(readCache()));

app.get("/tasks", (c) =>
  c.json(Object.entries(TASKS).map(([id, task]) => ({ id, label: task.label }))),
);

app.post("/actions/run/:id", async (c) => {
  const task = TASKS[c.req.param("id")];
  if (!task) return c.json({ ok: false, message: "Unknown task" }, 404);

  trace("input", "start", `You asked for: ${task.label}`);
  try {
    const message = await task.run();
    trace("input", "ok", `Result: ${message}`);
    return c.json({ ok: true, message });
  } catch (error) {
    const message = (error as Error).message;
    trace("input", "error", `Result: failed (${message})`);
    return c.json({ ok: false, message }, 500);
  }
});

// Wipe the agent's memory, so you can watch it re-learn everything with the AI.
app.post("/actions/forget", (c) => {
  rmSync(config.paths.selectors, { force: true });
  trace("cache", "warn", "Memory wiped: every element will be looked up with the AI again");
  return c.json({ ok: true, message: "Memory wiped" });
});

serve({ fetch: app.fetch, hostname: "127.0.0.1", port: config.visualizerPort }, () => {
  console.log(`Nova Agent: http://localhost:${config.visualizerPort}  (Agent)  ·  /calendar/  ·  /visualizer`);
});

// The daily healthcheck. It waits its turn in the task queue like any task.
cron.schedule(
  config.healthcheckSchedule,
  () => {
    runHealthcheck().catch((error) => trace("task", "error", `Healthcheck crashed: ${(error as Error).message}`));
  },
  { timezone: config.timezone },
);
console.log(`Daily healthcheck scheduled: "${config.healthcheckSchedule}" (${config.timezone})`);

// Every night at 3:15: this computer's files into Google Drive's Backups (when Google is connected)
cron.schedule(
  "15 3 * * *",
  () => {
    backupFilesToDrive()
      .then((n) => n && trace("task", "ok", `Google Drive: ${n} file${n === 1 ? "" : "s"} backed up`))
      .catch((error) => trace("task", "warn", `Backup to Google Drive failed: ${(error as Error).message}`));
  },
  { timezone: config.timezone },
);

startCollectingJobs();

// Quests: plan on start-up, then reminders and check-ins every 30 seconds
try {
  tidyBlocks();
  replan();
} catch (error) {
  console.warn("Quests couldn't plan on start-up:", (error as Error).message);
}
startQuestReminders();
startPulses();
// The studio's bookings as busy time for Quests (ACUITY_SOURCE=api): now, every 10 minutes, and on a change in Acuity
startBookingRefresh();
startPortalSync();
// Who Nova Agent works for on this PC (owner of everything ownerless): asked once now
void whoAmI().catch(() => {});
// Online: Nova Bot passes staff members' requests to this server over a link the PC opens (src/relay.ts)
startRelay(app.fetch);
// The Fixer: hourly checks, fixes prepared for an admin's Approve (src/fixer/)
startFixer();
