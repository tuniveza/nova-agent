// Nova Agent's local web pages, on http://localhost:4545:
//
//   /             the chat: talk to Nova Agent, with Nova Calendar beside it
//   /calendar/    Nova Calendar (the ../../calendar folder), saving to Nova Agent
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

import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
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
import { checkLogin, describeAppointments, listTask, readOnlyTour } from "../tasks";
import { getRecentEvents, onTrace, trace } from "../trace";
import { calendarEvents, normalise, readCalendar, writeCalendar } from "../calendar/store";
import { chat, type ChatTurn } from "../chat";
import { addBlock, addQuest, questState, removeBlock, removeMission, removeQuest, setQuestStatus, setRhythm, snoozeQuest, tidyBlocks, updateMission, updateQuest } from "../quests/actions";
import { replan } from "../quests/plan";
import { createMission } from "../quests/planner";
import { startQuestReminders } from "../quests/reminders";
import { questEvents } from "../quests/store";

const pageFile = fileURLToPath(new URL("./page.html", import.meta.url));
const chatFile = fileURLToPath(new URL("./chat.html", import.meta.url));
const syncFile = fileURLToPath(new URL("./calendar-sync.js", import.meta.url));
const calendarRoot = fileURLToPath(new URL("../../calendar/", import.meta.url));
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

// The pages. Read from disk each time, so edits show on refresh.
app.get("/", (c) => c.html(readFileSync(chatFile, "utf8")));
app.get("/visualizer", (c) => c.html(readFileSync(pageFile, "utf8")));

// ---- Nova Calendar, served from the calendar folder ----
// Its own offline helper isn't needed (or wanted) here: Nova Agent is the server.
app.get("/calendar/sw.js", (c) => c.text("// not used inside Nova Agent", 404));
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
app.put("/calendar-api/data", async (c) => {
  if (c.req.header("X-Nova-Visualizer") !== "1") return c.json({ ok: false }, 403);
  try {
    writeCalendar(normalise(await c.req.json()));
    return c.json({ ok: true });
  } catch {
    return c.json({ ok: false, message: "That isn't calendar data" }, 400);
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

// ---- Nova Missions and Nova Quests ----
app.get("/quests/state", (c) => c.json(questState()));
// Live: the plan changed, or a reminder / check-in is due
app.get("/quests/events", (c) =>
  streamSSE(c, async (stream) => {
    const changed = () => void stream.writeSSE({ event: "changed", data: String(Date.now()) });
    const notice = (n: unknown) => void stream.writeSSE({ event: "notice", data: JSON.stringify(n) });
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
  }),
);
const questAction = async (c: any, fn: () => unknown) => {
  try {
    return c.json({ ok: true, result: await fn() });
  } catch (error) {
    return c.json({ ok: false, message: (error as Error).message }, 400);
  }
};
app.post("/actions/missions", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.request !== "string" || !body.request.trim()) return c.json({ ok: false, message: "Describe the mission first." }, 400);
  return questAction(c, () => createMission(body.request, { deadline: body.deadline }));
});
app.post("/actions/missions/:id", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return questAction(c, () => (body.remove ? removeMission(c.req.param("id")) : updateMission(c.req.param("id"), body)));
});
app.post("/actions/quests", async (c) => questAction(c, async () => addQuest(await c.req.json())));
app.post("/actions/quests/:id", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const id = c.req.param("id");
  return questAction(c, () => {
    if (body.action === "done") return setQuestStatus(id, "done");
    if (body.action === "start") return setQuestStatus(id, "doing");
    if (body.action === "skip") return setQuestStatus(id, "skipped");
    if (body.action === "reopen") return setQuestStatus(id, "todo");
    if (body.action === "snooze") return snoozeQuest(id, Number(body.minutes) || 15);
    if (body.action === "remove") return removeQuest(id);
    return updateQuest(id, body.changes || {});
  });
});
app.post("/actions/blocks", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return questAction(c, () => (body.remove ? removeBlock(body.id) : addBlock(body.start, body.end, body.reason)));
});
app.post("/actions/rhythm", async (c) => questAction(c, async () => setRhythm(await c.req.json())));
app.post("/actions/replan", (c) => questAction(c, () => {
  const r = replan();
  return { atRisk: r.atRisk, unplaced: r.unplaced };
}));

// ---- The chat ----
app.post("/actions/chat", async (c) => {
  let messages: ChatTurn[] = [];
  try {
    messages = (await c.req.json()).messages;
  } catch {
    return c.json({ ok: false, message: "Bad request" }, 400);
  }
  if (!Array.isArray(messages)) return c.json({ ok: false, message: "Bad request" }, 400);
  try {
    return c.json({ ok: true, ...(await chat(messages)) });
  } catch (error) {
    const message = (error as Error).message;
    trace("llm", "error", `Chat failed: ${message}`);
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
  console.log(`Nova Agent: http://localhost:${config.visualizerPort}  (chat)  ·  /calendar/  ·  /visualizer`);
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

startCollectingJobs();

// Nova Quests: plan on start-up, then reminders and check-ins every 30 seconds
try {
  tidyBlocks();
  replan();
} catch (error) {
  console.warn("Nova Quests couldn't plan on start-up:", (error as Error).message);
}
startQuestReminders();
