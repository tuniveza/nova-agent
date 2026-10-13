// The watchdog: is Nova Bot (the server) still working? From the studio PC, or (Nova Agent on the
// server, NOVA_ON_SERVER=1) the server watching itself through its public address.
//
// Every 5 minutes it reads Nova Bot's public status page (GET /status.json, src/status.js in Nova
// Bot): 200 with "ok": true is fine; a 503, an error or no answer counts as a miss. After 2 misses
// in a row it tells someone, calmly, once:
//   - a desktop notification on this PC (notify-send; not on the server, which has no screen),
//   - a phone notification through ntfy.sh, if NTFY_TOPIC is set (works even when Nova Bot is down),
//   - and the usual alert (sendAlert: Nova Bot's push, which only gets through if the server answers).
// When it's working again it says so, once. The outside watchdog (an uptime checker watching the same
// address) is the main one; this is a second pair of eyes. WATCHDOG=off turns it off. On the server
// it's a self-watch: it catches the web front, the address or Nova Bot going wrong while the machine
// itself still runs (NTFY_TOPIC is the way out then, as Nova Bot's push goes through that address).

import { spawn } from "node:child_process";
import { sendAlert } from "./alerts";
import { config } from "./config";
import { trace } from "./trace";

const EVERY_MS = 5 * 60 * 1000;
const MISSES_BEFORE_ALERT = 2;

export interface WatchdogDeps {
  fetch: typeof fetch;
  notify: (title: string, message: string) => Promise<void> | void;
}

export interface CheckOutcome {
  ok: boolean;
  why: string;
}

// One look at the status page
export async function checkStatus(url: string, fetcher: typeof fetch = fetch): Promise<CheckOutcome> {
  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(30_000), headers: { "Cache-Control": "no-cache" } });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; overall?: string; parts?: { name: string; state: string }[] } | null;
    if (res.ok && data && data.ok === true) return { ok: true, why: data.overall || "working" };
    const red = (data?.parts || []).filter((p) => p.state === "red").map((p) => p.name);
    return { ok: false, why: red.length ? `needs attention: ${red.join(", ")}` : `answered ${res.status}` };
  } catch {
    return { ok: false, why: "couldn't be reached" };
  }
}

// Keeps count of misses in a row and decides when to tell someone (exported for tests)
export function makeWatchdog(url: string, deps: WatchdogDeps) {
  let misses = 0;
  let alerted = false;
  return async function tick(): Promise<CheckOutcome> {
    const outcome = await checkStatus(url, deps.fetch);
    if (outcome.ok) {
      if (alerted) await deps.notify("Nova is working again", "Nova Bot's status page is all clear.");
      misses = 0;
      alerted = false;
      return outcome;
    }
    misses += 1;
    trace("task", "info", `Watchdog: Nova Bot's status page ${outcome.why} (${misses} in a row)`);
    if (misses >= MISSES_BEFORE_ALERT && !alerted) {
      alerted = true;
      await deps.notify("Nova needs a look", `Nova Bot's status page ${outcome.why}. Open ${url.replace(/\.json$/, "")} — the card at the bottom says what to do.`);
    }
    return outcome;
  };
}

function desktop(title: string, message: string): void {
  if (config.onServer) return;
  try {
    const child = spawn("notify-send", ["--app-name=Nova Agent", "--urgency=normal", title, message], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // No desktop to tell (a server with no screen): the other ways still go
  }
}

async function phone(title: string, message: string): Promise<void> {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, { method: "POST", headers: { Title: title }, body: message, signal: AbortSignal.timeout(10_000) });
  } catch {
    // Best effort
  }
}

export function startWatchdog(): void {
  if (process.env.WATCHDOG === "off") return;
  const url = `${config.workerUrl.replace(/\/+$/, "")}/status.json`;
  const tick = makeWatchdog(url, {
    fetch,
    notify: async (title, message) => {
      desktop(title, message);
      await phone(title, message);
      await sendAlert(title, message).catch(() => {});
    },
  });
  setInterval(() => void tick().catch(() => {}), EVERY_MS).unref();
}
