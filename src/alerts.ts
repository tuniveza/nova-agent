// Alerts: telling a human that something needs attention.
//
// Every alert is:
//   - shown in the trace (console, logs, visualizer),
//   - appended to data/alerts.log,
//   - and, if AGENT_NOVA_KEY is set, sent to staff phones through Novabot's
//     worker (POST /hub/notify).
//
// Repeated identical alerts are held back for a few hours, so a problem that
// lasts all day doesn't send a notification every few minutes.

import { appendFileSync, mkdirSync } from "node:fs";
import { config } from "./config";
import { trace } from "./trace";

const REPEAT_AFTER_MS = 6 * 60 * 60 * 1000; // 6 hours
const lastSent = new Map<string, number>();

export async function sendAlert(title: string, message: string): Promise<void> {
  const key = `${title}|${message}`;
  const now = Date.now();
  if (now - (lastSent.get(key) ?? 0) < REPEAT_AFTER_MS) return;
  lastSent.set(key, now);

  trace("task", "error", `ALERT: ${title}: ${message}`);

  try {
    mkdirSync(config.paths.dataDir, { recursive: true });
    appendFileSync(`${config.paths.dataDir}alerts.log`, `${new Date(now).toISOString()}  ${title}: ${message}\n`);
  } catch {
    // Never let alert bookkeeping crash the agent.
  }

  if (!config.agentNovaKey) return;
  try {
    const response = await fetch(`${config.workerUrl}/hub/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.agentNovaKey}` },
      body: JSON.stringify({ title, message, source: "agent", kind: "agent", urgent: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) trace("task", "warn", `Novabot's worker didn't accept the alert (${response.status})`);
  } catch (error) {
    trace("task", "warn", `Couldn't send the alert to staff phones: ${(error as Error).message}`);
  }
}
