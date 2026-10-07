#!/usr/bin/env node
// Nova Observatory — scan.mjs
// Reads projects.config.json, measures every project on disk and writes data/projects.json
// plus data/projects.js (the same data as a script, so index.html works straight from file://).
// Measures: size on disk, source size, files, lines of code per language, newest change,
// git state, the top two levels of the folder tree, and any media capture.mjs has made.
// Usage: node scan.mjs

import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
// Your own catalogue is projects.config.json (git ignores it). Without one, the example catalogue is used.
const CONFIG_FILE = ['projects.config.json', 'projects.config.example.json'].map((f) => path.join(HERE, f)).find((f) => fss.existsSync(f));
if (!CONFIG_FILE.endsWith('projects.config.json')) console.log('No projects.config.json yet, so using projects.config.example.json. Copy it to projects.config.json to make it yours.');
const config = JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8'));

// Folders that hold dependencies or build output rather than work. Counted on disk, not as source.
const IGNORE = new Set([
  'node_modules', '.git', 'build', 'dist', '.gradle', '.idea', '.godot', '.import', 'target', '__pycache__',
  '.wrangler', '.venv', 'venv', '.cache', 'out', 'bin', 'obj', '.kotlin', '.next', 'coverage', '.mypy_cache', '.vs', '.vscode'
]);
// Third-party code copied into a project (SDL, glad, cglm, Ace3, Python venvs…). Matched case-insensitively.
const VENDORED = new Set(['lib', 'libs', 'deps', 'glad', 'vendor', 'vendored', 'thirdparty', 'third_party', 'external', 'extern', 'addons', 'site-packages']);
const ignoreKind = (name) => {
  if (IGNORE.has(name) || /^build[-_]/i.test(name) || /^cmake-build/i.test(name)) return 'build';
  if (VENDORED.has(name.toLowerCase())) return 'vendored';
  return null;
};
const SKIP_FILES =new Set(['package-lock.json', 'bun.lock', 'bun.lockb', 'yarn.lock', 'pnpm-lock.yaml', '.DS_Store']);

const LANGS = {
  '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.jsx': 'JavaScript',
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.html': 'HTML', '.htm': 'HTML', '.css': 'CSS', '.scss': 'CSS',
  '.kt': 'Kotlin', '.kts': 'Kotlin', '.java': 'Java', '.c': 'C', '.h': 'C', '.cpp': 'C++', '.hpp': 'C++', '.cc': 'C++',
  '.cs': 'C#', '.py': 'Python', '.rb': 'Ruby', '.lua': 'Lua', '.gd': 'GDScript', '.hx': 'Haxe', '.cr': 'Crystal',
  '.odin': 'Odin', '.asm': 'Assembly', '.s': 'Assembly', '.nasm': 'Assembly', '.gml': 'GML', '.go': 'Go', '.rs': 'Rust',
  '.zig': 'Zig', '.gleam': 'Gleam', '.sql': 'SQL', '.sh': 'Shell', '.gdshader': 'Shaders', '.glsl': 'Shaders',
  '.vert': 'Shaders', '.frag': 'Shaders', '.wgsl': 'Shaders', '.shader': 'Shaders', '.hlsl': 'Shaders',
  '.xml': 'XML', '.toc': 'XML', '.md': 'Markdown', '.json': 'JSON', '.jsonc': 'JSON', '.toml': 'Config', '.yaml': 'Config', '.yml': 'Config'
};
// Languages that count towards "lines of code"
const NOT_CODE = new Set(['XML', 'Markdown', 'JSON', 'Config']);
const MEDIA = {
  image: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp', '.tga', '.aseprite', '.psd'],
  audio: ['.ogg', '.wav', '.mp3', '.flac'],
  video: ['.mp4', '.webm', '.mov'],
  model: ['.gltf', '.glb', '.obj', '.fbx', '.blend']
};
const mediaKind = (ext) => Object.keys(MEDIA).find((k) => MEDIA[k].includes(ext)) || null;

async function du(p) {
  try {
    const { stdout } = await run('du', ['-sb', p], { timeout: 60000, maxBuffer: 1 << 20 });
    return Number(stdout.split('\t')[0]) || 0;
  } catch (e) {
    // du exits non-zero on an unreadable subfolder but still prints the total
    const m = /^(\d+)\t/m.exec((e && e.stdout) || '');
    return m ? Number(m[1]) : 0;
  }
}

async function countLines(file, size) {
  if (size > 1.5e6 || file.endsWith('.min.js')) return 0;
  try {
    const buf = await fs.readFile(file);
    let n = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] === 10) n++;
    return buf.length && buf[buf.length - 1] !== 10 ? n + 1 : n;
  } catch { return 0; }
}

// Walk one project. Symlinks are not followed (some project folders link to each other).
async function walk(root, exclude = []) {
  const ex = new Set(exclude);
  const out = { files: 0, bytes: 0, lines: 0, newest: 0, newestFile: '', langs: {}, media: { image: 0, audio: 0, video: 0, model: 0 }, tree: new Map(), ignored: [] };
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full);
      if (ex.has(rel)) continue; // per-project excludes, as paths relative to the project
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        const kind = ignoreKind(e.name);
        if (kind) { if (depth <= 1) out.ignored.push({ rel, kind }); continue; }
        stack.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!e.isFile() || SKIP_FILES.has(e.name)) continue;
      let st;
      try { st = await fs.stat(full); } catch { continue; }
      const ext = path.extname(e.name).toLowerCase();
      out.files++;
      out.bytes += st.size;
      if (st.mtimeMs > out.newest) { out.newest = st.mtimeMs; out.newestFile = rel; }
      const mk = mediaKind(ext);
      if (mk) out.media[mk]++;
      const lang = LANGS[ext];
      if (lang) {
        const L = (out.langs[lang] = out.langs[lang] || { files: 0, lines: 0, bytes: 0 });
        L.files++;
        L.bytes += st.size;
        if (!NOT_CODE.has(lang)) {
          const n = await countLines(full, st.size);
          L.lines += n;
          out.lines += n;
        }
      }
      // sizes for the first two levels of the folder tree
      const parts = rel.split(path.sep);
      for (let d = 1; d <= Math.min(2, parts.length); d++) {
        const key = parts.slice(0, d).join('/');
        const isDir = d < parts.length;
        const node = out.tree.get(key) || { path: key, dir: isDir, bytes: 0, files: 0 };
        node.bytes += st.size;
        node.files++;
        out.tree.set(key, node);
      }
    }
  }
  return out;
}

async function git(p) {
  const g = (...args) => run('git', ['-C', p, ...args], { timeout: 8000 }).then((r) => r.stdout.trim()).catch(() => null);
  const top = await g('rev-parse', '--show-toplevel');
  if (!top) return null;
  const [branch, remote, last, count, dirty] = await Promise.all([
    g('rev-parse', '--abbrev-ref', 'HEAD'),
    g('remote', 'get-url', 'origin'),
    g('log', '-1', '--format=%h%x1f%s%x1f%cI'),
    g('rev-list', '--count', 'HEAD'),
    g('status', '--porcelain')
  ]);
  const [hash, subject, date] = (last || '').split('\x1f');
  return {
    root: top, branch, commits: Number(count) || 0, dirty: dirty ? dirty.split('\n').filter(Boolean).length : 0,
    remote: remote ? remote.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '') : null,
    last: hash ? { hash, subject, date } : null
  };
}

function readMedia(id) {
  const f = path.join(HERE, 'media', id, 'manifest.json');
  try { return JSON.parse(fss.readFileSync(f, 'utf8')); } catch { return null; }
}

const sortLangs = (langs) => Object.entries(langs).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.lines - a.lines || b.bytes - a.bytes);

async function scanProject(p) {
  const t0 = Date.now();
  if (!fss.existsSync(p.path)) return { ...p, missing: true };
  const base = { ...p };
  if (p.group) {
    const members = [];
    for (const m of p.members) {
      const w = await walk(m.path, m.exclude);
      members.push({
        name: m.name, path: m.path, files: w.files, bytes: w.bytes, lines: w.lines, disk: await du(m.path),
        newest: w.newest ? new Date(w.newest).toISOString() : null, langs: sortLangs(w.langs).slice(0, 3)
      });
    }
    const langs = {};
    members.forEach((m) => m.langs.forEach((l) => {
      const L = (langs[l.name] = langs[l.name] || { files: 0, lines: 0, bytes: 0 });
      L.files += l.files; L.lines += l.lines; L.bytes += l.bytes;
    }));
    const newest = members.map((m) => m.newest).filter(Boolean).sort().pop() || null;
    Object.assign(base, {
      members,
      stats: {
        files: members.reduce((s, m) => s + m.files, 0), bytes: members.reduce((s, m) => s + m.bytes, 0),
        lines: members.reduce((s, m) => s + m.lines, 0), disk: members.reduce((s, m) => s + m.disk, 0),
        newest, langs: sortLangs(langs)
      }
    });
  } else {
    const w = await walk(p.path, p.exclude);
    const ignored = [];
    for (const { rel, kind } of w.ignored) ignored.push({ path: rel, kind, bytes: await du(path.join(p.path, rel)) });
    const top = [...w.tree.values()].filter((n) => !n.path.includes('/')).sort((a, b) => b.bytes - a.bytes);
    const tree = top.slice(0, 24).map((n) => ({
      ...n,
      children: n.dir ? [...w.tree.values()].filter((c) => c.path.startsWith(n.path + '/')).sort((a, b) => b.bytes - a.bytes).slice(0, 12) : []
    }));
    Object.assign(base, {
      stats: {
        files: w.files, bytes: w.bytes, lines: w.lines, disk: await du(p.path),
        newest: w.newest ? new Date(w.newest).toISOString() : null, newestFile: w.newestFile,
        langs: sortLangs(w.langs), media: w.media
      },
      tree, ignored: ignored.sort((a, b) => b.bytes - a.bytes),
      git: await git(p.path)
    });
    for (const r of base.related || []) r.disk = await du(r.path);
  }
  base.media = readMedia(p.id);
  process.stdout.write(`  ${p.id.padEnd(20)} ${String(base.stats.lines).padStart(7)} lines  ${(Date.now() - t0 + 'ms').padStart(7)}\n`);
  return base;
}

console.log('Nova Observatory: scanning', config.projects.length, 'projects');
const projects = [];
for (const p of config.projects) projects.push(await scanProject(p));

const totals = { projects: projects.length, lines: 0, bytes: 0, disk: 0, files: 0, langs: {} };
for (const p of projects) {
  if (!p.stats) continue;
  totals.lines += p.stats.lines; totals.bytes += p.stats.bytes; totals.disk += p.stats.disk; totals.files += p.stats.files;
  for (const l of p.stats.langs) totals.langs[l.name] = (totals.langs[l.name] || 0) + l.lines;
}
totals.langs = Object.entries(totals.langs).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([name, lines]) => ({ name, lines }));
totals.newest = projects.map((p) => p.stats && p.stats.newest).filter(Boolean).sort().pop() || null;

const out = { generatedAt: new Date().toISOString(), root: config.root, totals, projects };
await fs.mkdir(path.join(HERE, 'data'), { recursive: true });
await fs.writeFile(path.join(HERE, 'data', 'projects.json'), JSON.stringify(out, null, 2));
await fs.writeFile(path.join(HERE, 'data', 'projects.js'), `// Generated by scan.mjs on ${out.generatedAt}. Do not edit; run "npm run scan".\nwindow.OBSERVATORY = ${JSON.stringify(out)};\n`);
console.log(`Done: ${totals.lines.toLocaleString()} lines of code, ${(totals.disk / 1e9).toFixed(2)} GB on disk → data/projects.js`);
