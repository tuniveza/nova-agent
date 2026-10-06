// The Nova Agent visualizer: a local web page that shows, live, every step
// the agent takes: what it's looking for, what it remembered, what it asked
// the AI, what the AI answered, and what the browser saw.
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

import { readFileSync, rmSync } from "node:fs";
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

const pageFile = fileURLToPath(new URL("./page.html", import.meta.url));

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

// The page itself. Read from disk each time, so edits show on refresh.
app.get("/", (c) => c.html(readFileSync(pageFile, "utf8")));

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
  console.log(`Nova Agent visualizer: http://localhost:${config.visualizerPort}`);
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
