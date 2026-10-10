// Builds the status line's data (web/shared/status-data.js): Nova Agent's version and build number,
// and for each panel a few plain words about what changed lately (from its git history), grouped
// as on the panels bar (Apps, Tasks, Tools, Helpers). The status line scrolls these words.
//   node scripts/build-status.mjs   (or npm run status; npm run manual runs it too)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

// Which files belong to which panel
const PANELS = {
  chat: ["web/agent/chat.html", "src/chat.ts", "src/llm.ts", "src/memory.ts"],
  portal: ["web/portal", "docs/apps/portal"],
  calendar: ["web/calendar", "src/calendar", "docs/apps/calendar"],
  notes: ["web/notes", "docs/apps/notes"],
  index: ["web/index", "docs/apps/index"],
  quests: ["src/quests"],
  missions: ["src/tasks.ts", "src/jobs.ts"],
  lossless: ["web/lossless"],
  visualizer: ["web/agent/page.html", "src/visualizer"],
  observatory: ["web/observatory"],
  manual: ["web/shared/manual.js", "scripts/build-manual.mjs"],
  look: ["web/shared/sfx.js", "web/shared/ambient.js", "web/shared/look.js", "web/agent/assets"],
};
const GROUPS = { apps: ["chat", "portal", "calendar", "notes", "index"], tasks: ["quests", "missions"], tools: ["lossless", "visualizer"], helpers: ["observatory", "manual"] };

// A commit's subject made into a few plain words: no "Panel:" prefix, up to the first comma
function words(subject) {
  if (/^(merge|wip|readme|docs?|manual)\b/i.test(subject)) return "";
  // Portal had another name once: those notes say Portal (and a note about the rename itself goes)
  subject = subject.replace(new RegExp("\\b(?:Nova )?" + ["H", "ub"].join("") + "\\b", "g"), "Portal");
  if (/\bPortal\b.*\bPortal\b/.test(subject) && /takes in|part of|merged|folded/i.test(subject)) return "";
  let s = subject.replace(/^(Notes|Calendar|Portal|Index|Observatory|Lossless audio|Visualizer|Quests|Missions|Manual|Phones?|Admin|Nova Agent)\s*:\s+/i, "");
  // Up to the first comma or colon, but never just one word
  const parts = s.split(/[,;:(]| — | - /).map((p) => p.trim()).filter(Boolean);
  s = parts[0] || "";
  if (s.split(/\s+/).length < 2 && parts[1]) s = `${s}, ${parts[1]}`;
  const w = s.split(/\s+/).filter(Boolean);
  if (w.length > 7) s = w.slice(0, 7).join(" ") + "…";
  return s.replace(/\.$/, "");
}
function recent(paths, n = 5) {
  const out = [];
  let log = "";
  try {
    log = git("log", "--no-merges", "-n", "40", "--format=%s", "--", ...paths);
  } catch (err) {
    return out;
  }
  for (const line of log.split("\n")) {
    const w = words(line);
    if (w && w.split(/\s+/).length >= 2 && !out.some((o) => o.toLowerCase() === w.toLowerCase())) out.push(w);
    if (out.length >= n) break;
  }
  return out;
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const panels = Object.fromEntries(Object.entries(PANELS).map(([k, paths]) => [k, recent(paths)]));
const areas = Object.fromEntries(Object.entries(GROUPS).map(([g, keys]) => [g, keys.flatMap((k) => panels[k].slice(0, 2).map((w) => ({ panel: k, words: w })))]));
const data = {
  version: pkg.version,
  build: Number(git("rev-list", "--count", "HEAD")) + 1,
  date: new Date().toISOString().slice(0, 10),
  panels,
  areas,
  everything: recent(["."], 8),
};
const out = join(root, "web", "shared", "status-data.js");
writeFileSync(out, `// Made by scripts/build-status.mjs: Nova Agent's version and what changed lately, per panel.\nwindow.NOVA_STATUS = ${JSON.stringify(data, null, 1)};\n`);
console.log(`Status: v${data.version} build ${data.build}, ${Object.values(panels).flat().length} lines → web/shared/status-data.js`);
