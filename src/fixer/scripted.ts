// Scripted fixes: problems with a known recipe are fixed by running it, not by asking Claude Code.
// The Fixer tries these first (fixer.ts prepare()): in the job's own worktrees, then the same commit,
// tests, typecheck, sweep, looks and admin's Approve as any fix. Claude Code is the fallback, for
// problems no script knows.
//
// Each one says which problems it's for (a test on the problem's fingerprint and words), the commands
// it runs (each in the job's Nova Agent or Nova Bot worktree), and the words on the approval card.
// Commands only build files from the code that's there; none of them is allowed to touch what the
// Fixer must never change (rules.ts offLimits checks the result the same way).

export interface ScriptedTarget {
  type: string; // "issue" or "quest"
  id: string;
  title: string;
  details?: string;
  fingerprint?: string;
}
export interface ScriptedFix {
  id: string;
  name: string; // shown in the Fixer's log: "Fixed by script: <name>"
  matches: (t: ScriptedTarget) => boolean;
  commands: { repo: "na" | "nb"; cmd: string; args: string[] }[];
  card: { title: string; wrong: string; cause: string; fix: string; summary: string };
}

const said = (t: ScriptedTarget) => `${t.fingerprint || ""} ${t.title} ${t.details || ""}`.toLowerCase();

export const SCRIPTED_FIXES: ScriptedFix[] = [
  {
    id: "manual",
    name: "Rebuild the Manual",
    // The Manual's links or chapters out of step with the code (the Manual checks, a chapter missing)
    matches: (t) => /^checks:manual:/.test(t.fingerprint || "") || /\bmanual\b.*\b(out of date|missing|broken|stale|old|link)/.test(said(t)),
    commands: [
      { repo: "na", cmd: "node", args: ["scripts/build-status.mjs"] },
      { repo: "na", cmd: "node", args: ["scripts/build-manual.mjs"] },
    ],
    card: {
      title: "Rebuild the Manual",
      wrong: "The Manual was out of step with the apps (a link or a chapter).",
      cause: "The Manual is built from each app's README and history, and it hadn't been rebuilt since they changed.",
      fix: "Rebuilt it with the Manual's own builder (scripts/build-manual.mjs).",
      summary: "The Manual and its news rebuilt from the apps' READMEs and history by the Manual's own builder. No other change.",
    },
  },
  {
    id: "status",
    name: "Rebuild the status data",
    matches: (t) => /\bstatus (data|news|page data)\b.*\b(out of date|stale|old|missing)/.test(said(t)),
    commands: [{ repo: "na", cmd: "node", args: ["scripts/build-status.mjs"] }],
    card: {
      title: "Rebuild the status data",
      wrong: "The status line's news was out of date.",
      cause: "It's built from the history, and hadn't been rebuilt since the last changes.",
      fix: "Rebuilt it with its own builder (scripts/build-status.mjs).",
      summary: "The status data rebuilt from the history by its own builder. No other change.",
    },
  },
];

export function scriptedFixFor(t: ScriptedTarget): ScriptedFix | null {
  return SCRIPTED_FIXES.find((f) => f.matches(t)) || null;
}

// Which new problems the Fixer prepares a fix for by itself: any a script can fix; with Claude Code,
// only serious ones (a small one waits for an admin to press Prepare a fix), so scripts do most of it
export function preparesByItself(issue: { severity: string; area: string; title: string; detail?: string; fingerprint?: string; id: string }): "script" | "claude" | null {
  const t = { type: "issue", id: issue.id, title: issue.title, details: issue.detail, fingerprint: issue.fingerprint };
  if (scriptedFixFor(t)) return "script";
  return issue.severity === "serious" ? "claude" : null;
}
