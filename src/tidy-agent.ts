// Agent's look at Test stuff: what looks like a test or a copy, and why (Nova Bot's list and this
// computer's). Read only, on purpose: deleting is for an admin in Portal → Test stuff.

import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { config } from "./config";
import { currentFixer } from "./fixer/service";
import { findPcTestStuff, pcData } from "./tidy";
import { trace } from "./trace";

type Action = { kind: "looked"; text: string };

async function botList(): Promise<{ counts: { likely: number; maybe: number }; items: { kind: string; title: string; confidence: string; reasons: string[] }[] } | null> {
  if (!config.agentNovaKey) return null;
  try {
    const res = await fetch(`${config.workerUrl}/nova-agent/tidy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.agentNovaKey}` },
      body: "{}",
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok ? ((await res.json()) as any) : null;
  } catch {
    return null;
  }
}

export function tidyTools(actions: { push(action: Action): number }) {
  return [
    betaZodTool({
      name: "test_stuff_list",
      description:
        "What looks like test stuff or copies across Nova Agent (enquiries, chats, chat bookings, clients, Index pages, notes, drafts, quests, calendar notes, Fixer jobs, files), each with why. Read-only: you can't delete anything. Point an admin to Portal → Test stuff, where each has Delete and Not a test.",
      inputSchema: z.object({}),
      run: async () => {
        const pc = findPcTestStuff(pcData(currentFixer() as any));
        const bot = await botList();
        const line = (i: { kind?: string; kindName?: string; title: string; confidence: string; reasons: (string | { text: string })[] }) =>
          `- ${i.confidence === "likely" ? "Likely" : "Maybe"} · ${i.kindName || i.kind}: ${i.title} (${i.reasons.map((r) => (typeof r === "string" ? r : r.text)).join("; ")})`;
        const all = [...(bot ? bot.items : []), ...pc];
        actions.push({ kind: "looked", text: `Looked at Test stuff (${all.length})` });
        trace("input", "ok", `Chat: looked at Test stuff (${all.length} things)`);
        if (!all.length) return `Nothing looks like test stuff${bot ? "" : " on this computer (Nova Bot couldn't be reached, so its list isn't included)"}.`;
        return `${all.length} thing${all.length === 1 ? "" : "s"} look like tests or copies${bot ? "" : " (this computer's only: Nova Bot couldn't be reached)"}. An admin deletes them in Portal → Test stuff (each can be put back for 30 days).\n${all.slice(0, 60).map(line).join("\n")}`;
      },
    }),
  ];
}
