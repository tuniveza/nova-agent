// Builds the Nova Manual's content (app/manual-data.js) from the suite itself:
// every app's README (how to use it, how it's built, what's new), its git
// history, and what's changed but not saved in git yet. Then shares the manual
// with the apps that live on their own sites (scripts/share-badge.mjs).
//   node scripts/build-manual.mjs
// Run it again whenever a README or the history changes; Nova Bot's worker picks
// the new copy up on its next build, Nova Agent straight away.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ns = join(here, "..", "..");
const WORKER = "https://novacane-worker.novacane-studio.workers.dev";

// The apps, in the order the manual lists them
const APPS = [
  { id: "agent", name: "Nova Agent", repo: "na", colour: "#FF5FA8", glyph: "✦", where: "On the studio computer", links: [["Open Nova Agent", "http://localhost:4545/"]] },
  { id: "hub", name: "Nova Hub", repo: "nb/novacane-worker", sections: /Nova Hub/i, colour: "#C7A4FF", glyph: "▣", where: "On the staff phones", links: [["Open Nova Hub", `${WORKER}/app/`]] },
  { id: "bot", name: "Nova Bot", repo: "nb/novacane-worker", colour: "#5CE1FF", glyph: "◎", where: "On the website and Cloudflare", links: [["Admin pages", `${WORKER}/admin`]] },
  { id: "calendar", name: "Nova Calendar", repo: "na/calendar", colour: "#F2D9A0", glyph: "◷", where: "Its own site, and inside Nova Agent", links: [["Open Nova Calendar", "https://nova-calendar.novacane-studio.workers.dev/"]] },
  { id: "notes", name: "Nova Notes", repo: "nn", colour: "#FF8CC6", glyph: "✎", where: "Its own site, and inside Nova Agent", links: [["Open Nova Notes", "https://nova-notes.novacane-studio.workers.dev/"]] },
  { id: "index", name: "Nova Index", repo: "ni", colour: "#5CFFC0", glyph: "≡", where: "On Nova Bot's worker, and inside Nova Agent", links: [["Open Nova Index", `${WORKER}/app/memory/`]] },
  { id: "portal", name: "Nova Portal", repo: "np", colour: "#9DB4FF", glyph: "◉", where: "On Nova Bot's worker", links: [["Open Nova Portal", `${WORKER}/portal/`]] },
  { id: "observatory", name: "Nova Observatory", repo: "no", colour: "#FFB86B", glyph: "✧", where: "Inside Nova Agent, or any browser", links: [["Open it in Nova Agent", "http://localhost:4545/observatory/"]] },
];
// Nova Bot's README covers Hub too: this section of it is Nova Hub's
const HUB_SECTIONS = /^Nova Hub/i;

// Which README sections go where
const SKIP = /^(contents|screenshots|see it (work|in action)|part of the nova suite|licen[cs]e)\b/i;
const NEWS = /^what's new/i;
const BUILT = /^(how (it|the \w+) works?|run it|the build step|configuration|tests|deploying|project layout|where it runs|the api)/i;

const MAX_COMMITS = 120;
const RECENT_DAYS = 7;

// ---- Markdown, to safe HTML (only what the READMEs use) ----

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function inline(raw) {
  // Raw HTML in a README (centred divs, images, <sub>...) is dropped, keeping its words
  let s = raw.replace(/<br\s*\/?>/gi, " ").replace(/<\/?[a-z][^>]*>/gi, "");
  s = s.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, ""); // linked badges
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ""); // images
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  const links = [];
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, text, href) => `\u0001${links.push([text, href]) - 1}\u0001`);
  s = esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, "$1<em>$2</em>");
  s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => {
    const [text, href] = links[i];
    const words = inline(text);
    // Only links that work from anywhere: other pages in the repo don't
    return /^https?:\/\//.test(href) ? `<a href="${esc(href)}" target="_blank" rel="noopener">${words}</a>` : words;
  });
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`).trim();
}

function toHtml(md) {
  const lines = md.replace(/\r/g, "").split("\n");
  const out = [];
  let para = [];
  let list = null; // { tag, items }
  const flushPara = () => {
    const t = para.join(" ").trim();
    if (t) {
      const h = inline(t);
      if (h) out.push(`<p>${h}</p>`);
    }
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li${i.sub ? ' class="sub"' : ""}>${inline(i.text)}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  const flush = () => (flushPara(), flushList());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*```/.exec(line);
    if (fence) {
      flush();
      const code = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
      out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
      continue;
    }
    if (!line.trim()) {
      flushPara();
      if (list && !/^\s*([-*+]|\d+\.)\s/.test(lines[i + 1] || "")) flushList();
      continue;
    }
    const h = /^(#{3,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      out.push(`<h${Math.min(6, h[1].length + 1)}>${inline(h[2])}</h${Math.min(6, h[1].length + 1)}>`);
      continue;
    }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      flush();
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || "")) {
      flush();
      const cells = (l) => l.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => inline(c.trim().replace(/\\\|/g, "|")));
      const head = cells(line);
      i++;
      const rows = [];
      while (i + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[i + 1])) rows.push(cells(lines[++i]));
      out.push(`<div class="table"><table><thead><tr>${head.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      flush();
      const q = [quote[1]];
      while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1])) q.push(lines[++i].replace(/^\s*>\s?/, ""));
      const h2 = inline(q.join(" "));
      if (h2) out.push(`<blockquote>${h2}</blockquote>`);
      continue;
    }
    const item = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (item) {
      flushPara();
      const tag = /\d/.test(item[2]) ? "ol" : "ul";
      const sub = item[1].length >= 2;
      if (!list || (list.tag !== tag && !sub)) {
        flushList();
        list = { tag, items: [] };
      }
      list.items.push({ text: item[3], sub });
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1].text += " " + line.trim();
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flush();
  return out.join("\n");
}

const plain = (html) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// A README, split at its ## headings (headings inside code blocks don't count)
function readme(file) {
  const md = readFileSync(file, "utf8");
  const parts = [];
  let cur = { title: "", lines: [] };
  let inFence = false;
  for (const line of md.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const h2 = !inFence && /^##\s+(.*)$/.exec(line);
    const h1 = !inFence && /^#\s+(.*)$/.exec(line);
    if (h2) {
      parts.push(cur);
      cur = { title: h2[1].trim(), lines: [] };
    } else if (h1 && !cur.title && !parts.length) {
      cur.h1 = h1[1].trim();
    } else cur.lines.push(line);
  }
  parts.push(cur);
  const [top, ...sections] = parts;
  // The tagline: the first bold line, or the first sentence, under the title
  const topText = top.lines.join("\n");
  const bold = /\*\*([^*]+)\*\*/.exec(topText);
  const tagline = plain(inline(bold ? bold[1] : topText.split("\n").find((l) => l.trim() && !/^[<!\[]/.test(l.trim())) || ""));
  const intro = toHtml(topText.replace(/^\s*\*\*[^*]+\*\*\s*(<br>)?\s*$/m, ""));
  return { tagline, intro, sections: sections.map((s) => ({ title: plain(inline(s.title)), md: s.lines.join("\n") })) };
}

// ---- git ----

function git(repo, args) {
  try {
    return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 32 << 20 });
  } catch {
    return "";
  }
}

function history(repo) {
  const log = git(repo, ["log", `-${MAX_COMMITS}`, "--date=iso-strict", "--pretty=format:%x1e%h%x1f%ad%x1f%s%x1f%b"]);
  const commits = log
    .split("\x1e")
    .filter(Boolean)
    .map((c) => {
      const [hash, date, subject, body] = c.split("\x1f");
      const notes = (body || "").split("\n").filter((l) => l.trim() && !/^co-authored-by:/i.test(l)).join("\n").trim();
      return { hash, date, subject: subject.trim(), body: notes.slice(0, 900) };
    });
  const total = Number(git(repo, ["rev-list", "--count", "HEAD"]).trim()) || commits.length;
  // What's changed and not committed yet: file names and how much, never the contents
  const work = git(repo, ["status", "--porcelain=v1", "-uall"])
    .split("\n")
    .filter(Boolean)
    .filter((l) => !/(^|\/)(\.env|\.dev\.vars|session\.json|manual-data\.js|nova-manual(-data)?\.js|portal-badge\.js)$/.test(l.slice(3)))
    .map((l) => ({ state: /\?\?/.test(l.slice(0, 2)) ? "new" : /D/.test(l.slice(0, 2)) ? "removed" : "changed", file: l.slice(3).replace(/^"|"$/g, "") }));
  const stat = git(repo, ["diff", "HEAD", "--shortstat"]).trim();
  return { total, first: git(repo, ["log", "--reverse", "--date=iso-strict", "--pretty=format:%ad"]).split("\n")[0] || "", commits, work: work.slice(0, 60), workCount: work.length, workStat: stat };
}

// ---- the manual ----

function chapter(s, i) {
  const html = toHtml(s.md);
  return { id: `${slug(s.title)}-${i}`, title: s.title, html, text: plain(html).slice(0, 4000) };
}

function build() {
  const cache = new Map();
  const apps = [];
  for (const app of APPS) {
    const dir = join(ns, app.repo);
    const file = join(dir, "README.md");
    if (!existsSync(file)) {
      console.log(`skip ${app.name}: no README at ${app.repo}`);
      continue;
    }
    if (!cache.has(app.repo)) cache.set(app.repo, { doc: readme(file), hist: history(dir) });
    const { doc, hist } = cache.get(app.repo);
    // Nova Bot's README is shared: Nova Hub gets its own sections, Nova Bot the rest
    let sections = doc.sections;
    if (app.repo === "nb/novacane-worker") sections = sections.filter((s) => (app.id === "hub" ? HUB_SECTIONS.test(s.title) : !HUB_SECTIONS.test(s.title)));
    sections = sections.filter((s) => !SKIP.test(s.title));
    const news = sections.filter((s) => NEWS.test(s.title));
    const rest = sections.filter((s) => !NEWS.test(s.title));
    const guide = rest.filter((s) => app.id === "hub" || !BUILT.test(s.title));
    const built = app.id === "hub" ? [] : rest.filter((s) => BUILT.test(s.title));
    apps.push({
      id: app.id,
      name: app.name,
      colour: app.colour,
      glyph: app.glyph,
      where: app.where,
      links: app.links,
      repo: app.repo,
      shared: app.repo === "nb/novacane-worker" ? "Nova Hub and Nova Bot share one project (Nova Bot's worker), so their history is the same." : "",
      tagline: app.id === "hub" ? "The staff app: quests, the smart calendar, alerts and Ask Nova, on the phones." : doc.tagline,
      intro: app.id === "hub" ? "" : doc.intro,
      guide: guide.map(chapter),
      built: built.map(chapter),
      news: news.map(chapter),
      history: hist,
    });
  }
  // The suite's own story, from the umbrella repo (if it's next door)
  let suite = null;
  const suiteFile = join(ns, "..", "nova-suite", "README.md");
  if (existsSync(suiteFile)) {
    const doc = readme(suiteFile);
    suite = { tagline: doc.tagline, intro: doc.intro, chapters: doc.sections.filter((s) => !SKIP.test(s.title)).map(chapter) };
  }
  return { built: new Date().toISOString(), recentDays: RECENT_DAYS, suite, apps };
}

const data = build();
const out = join(here, "..", "app", "manual-data.js");
writeFileSync(out, `// The Nova Manual's content, made by scripts/build-manual.mjs from every app's README and git history.\n// Don't edit by hand: run  node scripts/build-manual.mjs  again.\nwindow.NovaManualData = ${JSON.stringify(data)};\n`);
console.log(`Nova Manual: ${data.apps.length} apps, ${data.apps.reduce((n, a) => n + a.guide.length + a.built.length, 0)} chapters, ${(readFileSync(out).length / 1024).toFixed(0)} KB → app/manual-data.js`);

// Share it (and the badge) with the apps on their own sites
execFileSync(process.execPath, [join(here, "share-badge.mjs")], { stdio: "inherit" });
