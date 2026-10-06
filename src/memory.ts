// Nova Index from Nova Agent's side: what the Nova suite remembers, read before a reply,
// and conversations handed over afterwards so the suite keeps learning. The memory itself
// lives in Nova Bot's worker (its /memory/ API, with the agent key); Nova Agent reads the
// studio's facts and this staff member's own (NOVA_STAFF_ID), and never customers'.
//
// Reading is quick and never holds up a reply for long (a short timeout, a small cache);
// learning happens in the background on the worker.

import { config } from "./config";
import { trace } from "./trace";

const cache = new Map<string, { at: number; text: string }>();
const CACHE_MS = 30_000;

// The facts that matter for this turn, as a block for the system prompt ("" if none, or offline)
export async function memoryFor(q: string): Promise<string> {
  if (!config.agentNovaKey) return "";
  const key = q.slice(0, 200);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.text;
  try {
    const url = `${config.workerUrl}/memory/context?scope=staff&owner_id=${encodeURIComponent(config.staffId)}&q=${encodeURIComponent(q.slice(0, 500))}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${config.agentNovaKey}` }, signal: AbortSignal.timeout(2500) });
    if (!res.ok) return "";
    const { text } = (await res.json()) as { text?: string };
    const block = text
      ? `WHAT THE NOVA SUITE REMEMBERS (Nova Index: facts learned earlier about the studio, its people and ${config.staffId === "owner" ? "the person you're talking to" : config.staffId}). Use them quietly to plan and answer better; don't recite them or mention this memory unless asked. If they conflict with what's said now, trust what's said now.\n${text}`
      : "";
    cache.set(key, { at: Date.now(), text: block });
    if (cache.size > 100) cache.delete(cache.keys().next().value!);
    return block;
  } catch {
    return "";
  }
}

// Hand a finished exchange to the worker to learn from (in the background; never waits)
export function learnFrom(messages: { role: string; content: string }[], ref = ""): void {
  if (!config.agentNovaKey) return;
  const transcript = messages
    .slice(-6)
    .map((m) => `${m.role === "user" ? "Staff" : "Nova Agent"}: ${m.content.slice(0, 2000)}`)
    .join("\n");
  fetch(`${config.workerUrl}/memory/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.agentNovaKey}` },
    body: JSON.stringify({ scope: "staff", owner_id: config.staffId, transcript, source_ref: ref }),
    signal: AbortSignal.timeout(8000),
  })
    .then((r) => !r.ok && trace("llm", "warn", `Nova Index didn't take the conversation (${r.status})`))
    .catch(() => {});
}
