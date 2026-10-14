// How the Fixer asks Claude Code to prepare a fix: headless (`claude -p`), confined to the job's
// own worktrees, with the least it needs.
//
//   --restricted              no command-running tools unless named, the file tools kept to the
//                             working folders, user/project settings ignored, no bypass mode
//   --tools                   only reading, searching and editing files, and Bash for tests
//   --allowedTools            pre-approved: the file tools, and exactly the test and typecheck
//                             commands (anything else would need a person, so it's refused)
//   --permission-mode acceptEdits + --permission-prompts none
//                             edits inside the worktrees go ahead; anything that would ask is denied
//   --add-dir                 the job's worktrees (and nothing else)
//   --strict-mcp-config       no MCP servers
//   --no-session-persistence, --max-budget-usd, --json-schema (the card's words come back as JSON)
// It never gets a skip-all-permissions flag, never runs git (the Fixer commits for it, by
// explicit path, in the job's own branch), and never sees .env.

export const CARD_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "Plain English, 1-3 sentences: what changed, for someone who doesn't code" },
    why: { type: "string", description: "Why: the problem it fixes or what was asked for" },
    consequences: { type: "string", description: "What this means for the people using Nova Agent once it's live" },
    assessment: { type: "string", description: "Is it a good idea? An honest view, including doubts" },
    risks: { type: "array", items: { type: "string" } },
    verdict: { type: "string", enum: ["approve", "reject", "tweak"] },
    reasons: { type: "array", items: { type: "string" } },
    changed: { type: "boolean", description: "false if you made no change (say why in summary)" },
  },
  required: ["summary", "why", "consequences", "assessment", "risks", "verdict", "reasons", "changed"],
} as const;

export const RULES = [
  "Keep every existing feature, button, setting and name: only add or repair. Nothing is removed or renamed.",
  "Plain app names: the panels are Portal, Calendar, Notes, Index, Observatory, Lossless, Visualizer, Fixer, Manual; the Claude section is Agent (never Chat). Only Nova Agent and Nova Bot carry \"Nova\".",
  "Sounds stay calm and therapeutic: sparse, quiet, never repetitive. Add no chatty sounds.",
  "Colours come only from the theme tokens (var(--hi), var(--text), var(--line)…, from web/shared/themes.css), never hard-coded colours.",
  "Every screen works at phone width (390px) with no sideways scrolling; long content scrolls inside its own box.",
  "New logic gets tests (vitest, test/*.spec.ts in Nova Agent; test/*.spec.js in Nova Bot).",
  "Never touch .env, secrets or keys, database migrations, saved data (data/), customer data, package.json or lock files, wrangler settings, or anything about payments, emails or the mail server, Acuity or Stripe. Never change the Fixer itself (src/fixer, web/fixer, test/fixer*).",
  "Don't run git (no add, commit, checkout, reset or push): the Fixer commits your edits itself. Never add node_modules.",
  "Keep the change as small as it can be while doing the job properly.",
];

export interface Brief {
  title: string;
  details: string;
  kind: string;
  notes: string[]; // the admins' tweak notes
  naDir: string;
  nbDir: string;
}

export function briefText(b: Brief): string {
  const kind = b.kind === "glitch" ? "a visual or interaction glitch" : b.kind === "bug" ? "a bug" : "a change an admin asked for";
  return [
    `You are the Fixer's hands for Novacane Studios' Nova Agent. Prepare ${kind}:`,
    "",
    `TITLE: ${b.title}`,
    b.details ? `DETAILS:\n${b.details}` : "",
    b.notes.length ? `\nAN ADMIN ASKED FOR THESE TWEAKS TO THE LAST ATTEMPT (most important):\n${b.notes.map((n, i) => `${i + 1}. ${n}`).join("\n")}` : "",
    "",
    "Where:",
    `- Nova Agent (the PC app: TypeScript server in src/, panels in web/): ${b.naDir}  (you start here)`,
    `- Nova Bot (the Cloudflare Worker: src/*.js): ${b.nbDir}`,
    "Change only files inside those two folders. They're throwaway copies made for this job: nothing you do reaches the live app until an admin approves it.",
    "",
    "Project rules (all of them matter):",
    ...RULES.map((r) => `- ${r}`),
    "",
    "You may run only these checks: `npx vitest run` and `npx tsc --noEmit` in Nova Agent's folder, and `npx vitest run` in Nova Bot's.",
    "Run the tests that cover what you changed before you finish.",
    "",
    "When you're done, answer with the JSON asked for: a plain-English summary (no code words) of what you changed and why,",
    "what it means for the people using Nova Agent, an honest view of whether it's a good idea (with risks),",
    "and your recommendation (approve, reject or tweak) with reasons. If you couldn't or shouldn't change anything, say so (changed: false).",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function claudeArgs(b: Brief, budgetUsd = 5): string[] {
  return [
    "-p",
    briefText(b),
    "--restricted",
    "--tools",
    "Read,Glob,Grep,Edit,Write,Bash",
    "--allowedTools",
    "Read",
    "Glob",
    "Grep",
    "Edit",
    "Write",
    "Bash(npx vitest run)",
    "Bash(npx vitest run:*)",
    "Bash(npx tsc --noEmit)",
    "--disallowedTools",
    "WebFetch",
    "WebSearch",
    "Bash(git:*)",
    "--permission-mode",
    "acceptEdits",
    "--permission-prompts",
    "none",
    "--add-dir",
    b.naDir,
    b.nbDir,
    "--strict-mcp-config",
    "--no-session-persistence",
    "--max-budget-usd",
    String(budgetUsd),
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(CARD_SCHEMA),
  ];
}

export interface ClaudeAnswer {
  summary: string;
  why: string;
  consequences: string;
  assessment: string;
  risks: string[];
  verdict: string;
  reasons: string[];
  changed: boolean;
}

// What Claude Code printed (--output-format json): the structured answer, wherever it is
export function readAnswer(out: string): ClaudeAnswer | null {
  const pick = (o: any): ClaudeAnswer | null =>
    o && typeof o === "object" && typeof o.summary === "string"
      ? {
          summary: String(o.summary),
          why: String(o.why || ""),
          consequences: String(o.consequences || ""),
          assessment: String(o.assessment || ""),
          risks: Array.isArray(o.risks) ? o.risks.map(String) : [],
          verdict: String(o.verdict || ""),
          reasons: Array.isArray(o.reasons) ? o.reasons.map(String) : [],
          changed: o.changed !== false,
        }
      : null;
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  // The last JSON line is the result object
  const lines = out.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const o = tryParse(lines[i]);
    if (!o) continue;
    const direct = pick(o) || pick(o.structured_output) || pick(o.structuredOutput);
    if (direct) return direct;
    if (typeof o.result === "string") {
      const inner = tryParse(o.result) || tryParse((/\{[\s\S]*\}/.exec(o.result) || [""])[0]);
      if (pick(inner)) return pick(inner);
    }
  }
  const any = tryParse((/\{[\s\S]*\}/.exec(out) || [""])[0]);
  return pick(any) || pick(any?.structured_output);
}
