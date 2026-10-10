// A Mission, written out as one Markdown document: the strategy, tracks,
// milestones, every quest (by track, in date order), what the plan assumed and
// asked, and the research it was built on, with links. Made from the saved plan
// (no AI), so it's exactly what's in Nova Agent.

import { describeLength } from "./lengths";
import { questState } from "./actions";

const day = (stamp: string) =>
  new Date(`${stamp.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const when = (stamp: string) => (stamp ? `${day(stamp)} ${stamp.slice(11, 16)}` : "");
// Table cells can't hold line breaks or pipes
const cell = (s: string) => String(s || "").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();

export function missionMarkdown(idOrPrefix: string): { title: string; name: string; content: string; missionId: string } {
  const st = questState();
  const m = st.missions.find((x) => x.id === idOrPrefix || x.id.startsWith(idOrPrefix));
  if (!m) throw new Error(`No mission with id ${idOrPrefix}.`);
  const p = m.progress;
  const quests = st.quests.filter((q) => q.missionId === m.id);
  const out: string[] = [];
  out.push(`# ${m.title}`, "");
  if (m.summary) out.push(m.summary, "");
  out.push(
    [
      m.deadline ? `**Due:** ${when(m.deadline.length > 10 ? m.deadline : `${m.deadline}T23:59`).replace(/ 23:59$/, "")}` : "",
      `**Progress:** ${p.done} of ${p.total} quests done${p.atRisk ? `, ${p.atRisk} at risk` : ""}, about ${Math.round(p.minutesLeft / 60)} hours left`,
      `**Status:** ${m.status}`,
    ]
      .filter(Boolean)
      .join("  \n"),
    "",
  );
  if (m.request) out.push("> " + m.request.replace(/\s*\n\s*/g, " ").slice(0, 2000), "");

  if (p.tracks.length) {
    out.push("## Tracks", "", "| Track | Done |", "|---|---|", ...p.tracks.map((t) => `| ${cell(t.name)} | ${t.done} of ${t.total} |`), "");
  }
  if (m.strategy.length) {
    out.push("## Strategy", "");
    for (const s of m.strategy) out.push(`### ${s.heading}`, "", s.body.trim(), "");
  }
  if (m.milestones.length) {
    out.push("## Milestones", "", "| | When | Milestone | Track |", "|---|---|---|---|");
    for (const x of m.milestones) out.push(`| ${x.done ? "✓" : "·"} | ${when(x.at)} | ${cell(x.title)} | ${cell(x.track)} |`);
    out.push("");
  }
  if (quests.length) {
    out.push("## Quests", "");
    const tracks = [...new Set([...m.tracks.map((t) => t.name), ...quests.map((q) => q.track)])];
    for (const t of tracks) {
      const list = quests.filter((q) => q.track === t).sort((a, b) => (a.start || a.deadline || "z").localeCompare(b.start || b.deadline || "z"));
      if (!list.length) continue;
      out.push(`### ${t || "Other"}`, "", "| | Quest | When | Length | Priority | Due |", "|---|---|---|---|---|---|");
      for (const q of list) {
        const mark = q.status === "done" ? "✓" : q.status === "skipped" ? "–" : q.status === "doing" ? "▶" : q.atRisk ? "⚠" : "·";
        out.push(`| ${mark} | ${cell(q.title)}${q.location ? ` (at ${cell(q.location)})` : ""} | ${q.start ? when(q.start) : "not planned yet"} | ${cell(describeLength(q))} | ${q.priority} | ${q.deadline ? when(q.deadline) : ""} |`);
      }
      out.push("");
    }
    out.push("✓ done · ▶ under way · ⚠ at risk of missing its deadline · – skipped", "");
  }
  if (m.assumptions.length) out.push("## What the plan assumed", "", ...m.assumptions.map((a) => `- ${a}`), "");
  if (m.questions.length) out.push("## Questions that would sharpen it", "", ...m.questions.map((q) => `- ${q}`), "");
  if (m.refinements.length) out.push("## What's been added since", "", ...m.refinements.map((r) => `- ${r.at ? `${day(r.at)}: ` : ""}${r.text.replace(/\s*\n\s*/g, " ")}`), "");
  if (m.research.length) out.push("## Researched on the web", "", ...m.research.map((f) => `- ${f.text} [${f.title || new URL(f.url).hostname}](${f.url})`), "");
  out.push("---", "", `*Exported from Nova Agent, ${when(st.now)}.*`, "");
  const slug = m.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "mission";
  return { title: m.title, name: `${slug}.md`, content: out.join("\n"), missionId: m.id };
}
