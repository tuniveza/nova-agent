// Scripted fixes (src/fixer/scripted.ts): known problems fixed by a script, not by Claude Code; Claude
// Code by itself only for serious problems no script knows.
import { describe, expect, it } from "vitest";
import { preparesByItself, SCRIPTED_FIXES, scriptedFixFor } from "../src/fixer/scripted";
import { offLimits } from "../src/fixer/rules";

describe("scripted fixes", () => {
  it("knows the Manual's problems, and only builds files with the project's own builders", () => {
    expect(scriptedFixFor({ type: "issue", id: "1", title: "Manual: a link is broken", fingerprint: "checks:manual:links" })?.id).toBe("manual");
    expect(scriptedFixFor({ type: "issue", id: "2", title: "The Manual's Nova chapter is missing" })?.id).toBe("manual");
    expect(scriptedFixFor({ type: "issue", id: "3", title: "Invoicer: Text running into other text" })).toBeNull();
    for (const f of SCRIPTED_FIXES) {
      for (const c of f.commands) expect(c.cmd === "node" && /^scripts\/[\w-]+\.mjs$/.test(c.args[0])).toBe(true);
      expect(f.card.title && f.card.fix && f.card.summary).toBeTruthy();
    }
    // (what those builders write is never off limits)
    expect(offLimits([{ repo: "na", path: "web/shared/manual-data.js" }, { repo: "na", path: "web/shared/manual-news.js" }] as any)).toEqual([]);
  });

  it("scripts first: any problem a script fixes; Claude Code by itself only for serious ones", () => {
    expect(preparesByItself({ id: "1", severity: "minor", area: "checks", title: "Manual: a link is broken", fingerprint: "checks:manual:x" })).toBe("script");
    expect(preparesByItself({ id: "2", severity: "serious", area: "sweep", title: "Portal: a script error", fingerprint: "sweep:portal" })).toBe("claude");
    expect(preparesByItself({ id: "3", severity: "minor", area: "looks", title: "Notes: text cut off", fingerprint: "looks:/notes/:text-cut" })).toBeNull();
  });
});
