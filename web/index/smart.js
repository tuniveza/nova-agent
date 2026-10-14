// Index's smart helpers: plain logic, no page and no server, so they're quick and testable on
// their own (test/index-smart.spec.ts). memory.js uses them as window.IndexSmart:
//   fuzzyHas / lineHit   search that forgives a typo or two and knows "evenings" from "evening"
//   suggest              "Did you mean …?" when nothing matches
//   looksLikeQuestion    a search that's really a question (Ask Index answers those)
//   related              other files about the same people and things
//   lookAlikes           two files that might be the same person or subject
//   changedWithin        the "Changed" filter (today, this week, this month, not for 6 months)
//   shelf                pinned files and recently opened ones (kept in this browser only)
(function (root) {
  "use strict";

  const STOP = new Set(
    "the and for are was were what who whom whose which when where why how does did done has have had with that this these those from into about any all our your their they them there here not but can could would should will just than then also its is am be been being of to in on at by an as or if do me my we us you he she his her him it know known tell say said get got like want much many".split(" ")
  );

  // The words in a piece of text, lower case (2 letters or more)
  const words = (text) => String(text || "").toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
  // A word cut to its stem ("sessions" → "session", "evenings" → "even")
  const stem = (w) => (w.length > 4 ? w.replace(/(?:ings|ing|ers|ies|es|ed|ly|s)$/, "") : w);

  // How many letters apart two words are (missing, extra, wrong or swapped), or max + 1 once it's further
  function dist(a, b, max) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev2 = null;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      let best = i;
      for (let j = 1; j <= b.length; j++) {
        let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        row.push(v);
        if (v < best) best = v;
      }
      if (best > max) return max + 1;
      prev2 = prev;
      prev = row;
    }
    return Math.min(prev[b.length], max + 1);
  }
  // How many typos a word may have: none under 4 letters, one up to 7, two from 8
  const allowance = (a, b) => {
    const longer = Math.max(a.length, b.length);
    return longer >= 8 ? 2 : longer >= 4 && Math.min(a.length, b.length) >= 3 ? 1 : 0;
  };
  // Close enough: the same, the start of a longer word (4+ letters typed), or a typo or two away
  function near(a, b) {
    if (a === b) return true;
    if (a.length >= 4 && b.startsWith(a)) return true;
    const max = allowance(a, b);
    return max > 0 && dist(a, b, max) <= max;
  }
  const alike = (a, b) => near(a, b) || near(stem(a), stem(b));

  // Does the text hold every word of the search? (as typed anywhere in it, or a close word)
  function fuzzyHas(hay, q) {
    const want = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!want.length) return true;
    const text = String(hay || "").toLowerCase();
    let have = null;
    return want.every((w) => {
      if (text.includes(w)) return true;
      if (w.length < 3) return false;
      have = have || words(text);
      return have.some((h) => alike(w, h));
    });
  }
  // Does one line mention any word of the search (for the line shown on a card)?
  function lineHit(line, q) {
    const want = String(q || "").toLowerCase().split(/\s+/).filter((w) => w.length > 1);
    const text = String(line || "").toLowerCase();
    return want.some((w) => text.includes(w) || (w.length >= 3 && words(text).some((h) => alike(w, h))));
  }

  // "Did you mean …?": the search with each unknown word swapped for the closest known one (or null)
  function suggest(q, vocab) {
    const want = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!want.length) return null;
    const known = vocab instanceof Set ? vocab : new Set(vocab);
    let changed = false;
    const out = want.map((w) => {
      if (known.has(w) || w.length < 3) return w;
      let best = null;
      let bestD = 3;
      for (const k of known) {
        if (Math.abs(k.length - w.length) > 2) continue;
        const d = dist(w, k, 2);
        if (d < bestD) (best = k), (bestD = d);
      }
      if (best && bestD <= Math.max(1, allowance(w, best))) {
        changed = true;
        return best;
      }
      return w;
    });
    return changed ? out.join(" ") : null;
  }
  // Every word Index knows (for suggest): names, aliases, descriptions, paths, owners and loaded facts
  function vocabulary(files, bodyOf) {
    const out = new Set();
    for (const f of files) {
      for (const w of words([f.name, f.description, f.path, (f.aliases || []).join(" "), f.owner_id, bodyOf ? bodyOf(f) : ""].join(" "))) if (w.length >= 3) out.add(w);
    }
    return out;
  }

  // A search that's really a question: ends in "?", or starts like one and has 3+ words
  const ASKING = /^(who|what|whats|what's|when|where|why|how|which|does|do|did|is|are|was|were|can|could|should|has|have|tell me|remind me)\b/i;
  const looksLikeQuestion = (q) => {
    const t = String(q || "").trim();
    return t.length >= 6 && (/\?$/.test(t) || (ASKING.test(t) && t.split(/\s+/).length >= 3));
  };

  // The words that say what a file is about (stems, without the little ones)
  const about = (f, body) => new Set(words([f.name, f.description, String(f.path || "").replace(/\//g, " "), (f.aliases || []).join(" "), body || ""].join(" ")).filter((w) => w.length >= 3 && !STOP.has(w)).map(stem));
  const namesOf = (f) => [f.name, ...(f.aliases || []), String(f.path || "").split("/").pop()].filter((n) => n && n.length >= 3).map((n) => String(n).toLowerCase().replace(/-/g, " "));

  // Other files about the same people and things, best first (at most `max`)
  // bodyOf(f): its facts if they're loaded ("" if not)
  function related(file, files, bodyOf = () => "", max = 4) {
    const same = (a, b) => a.scope === b.scope && (a.owner_id || "") === (b.owner_id || "") && a.path === b.path;
    const mine = about(file, bodyOf(file));
    const myText = [file.description, bodyOf(file)].join(" ").toLowerCase();
    const out = [];
    for (const f of files) {
      if (same(f, file)) continue;
      const theirs = about(f, bodyOf(f));
      let score = 0;
      for (const w of mine) if (theirs.has(w)) score += 1;
      // One names the other ("Kai" in a topic about the EP)
      if (namesOf(f).some((n) => myText.includes(n))) score += 3;
      const theirText = [f.description, bodyOf(f)].join(" ").toLowerCase();
      if (namesOf(file).some((n) => theirText.includes(n))) score += 3;
      if (f.owner_id && f.owner_id === file.owner_id) score += 1;
      if (score >= 2) out.push({ file: f, score });
    }
    return out.sort((a, b) => b.score - a.score || (b.file.updated_at || 0) - (a.file.updated_at || 0)).slice(0, max).map((r) => r.file);
  }

  // Pairs of files that might be the same person or subject: same memory, same owner, same kind,
  // and names a typo apart, one inside the other ("Kai" and "Kai M"), or one's alias the other's name
  function lookAlikes(files, max = 3) {
    const kind = (f) => String(f.path || "").split("/")[0];
    const named = files.filter((f) => String(f.path || "").includes("/"));
    const plain = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const out = [];
    for (let i = 0; i < named.length && out.length < max; i++) {
      for (let j = i + 1; j < named.length && out.length < max; j++) {
        const a = named[i];
        const b = named[j];
        if (a.scope !== b.scope || (a.owner_id || "") !== (b.owner_id || "") || kind(a) !== kind(b)) continue;
        const an = plain(String(a.path).split("/").pop());
        const bn = plain(String(b.path).split("/").pop());
        const aNames = new Set([an, plain(a.name), ...(a.aliases || []).map(plain)].filter(Boolean));
        const bNames = new Set([bn, plain(b.name), ...(b.aliases || []).map(plain)].filter(Boolean));
        const shared = [...aNames].some((n) => bNames.has(n));
        const typo = an.length >= 4 && bn.length >= 4 && dist(an, bn, 1) <= 1;
        const inside = an.length >= 3 && bn.length >= 3 && (bn.split(" ")[0] === an || an.split(" ")[0] === bn);
        if (shared || typo || inside) out.push([a, b]);
      }
    }
    return out;
  }

  // The "Changed" filter: any, today, week, month, or old (not changed for 6 months)
  function changedWithin(updatedAt, range, now = Date.now()) {
    const at = Number(updatedAt) || 0;
    if (!range || range === "any") return true;
    if (range === "today") {
      const midnight = new Date(now);
      midnight.setHours(0, 0, 0, 0);
      return at >= midnight.getTime();
    }
    if (range === "week") return at >= now - 7 * 86_400_000;
    if (range === "month") return at >= now - 30 * 86_400_000;
    if (range === "old") return at < now - 182 * 86_400_000;
    return true;
  }

  // Pinned files and recently opened ones, kept in this browser (it works without storage too)
  function shelf(storage, key = "nova-index-shelf") {
    let data = { pins: [], recent: [] };
    try {
      const saved = JSON.parse(storage.getItem(key) || "null");
      if (saved && Array.isArray(saved.pins) && Array.isArray(saved.recent)) data = saved;
    } catch (err) {}
    const save = () => {
      try {
        storage.setItem(key, JSON.stringify(data));
      } catch (err) {}
    };
    return {
      pins: () => data.pins.slice(),
      isPinned: (k) => data.pins.includes(k),
      toggle(k) {
        data.pins = data.pins.includes(k) ? data.pins.filter((p) => p !== k) : [k, ...data.pins].slice(0, 24);
        save();
        return data.pins.includes(k);
      },
      // Opened: counted, and moved to the front
      touch(k, now = Date.now()) {
        const had = data.recent.find((r) => r.k === k);
        data.recent = [{ k, at: now, n: (had ? had.n : 0) + 1 }, ...data.recent.filter((r) => r.k !== k)].slice(0, 30);
        save();
      },
      // The ones you use most, lately (each opening counts less as the weeks go by)
      top(max = 6, now = Date.now()) {
        return data.recent
          .map((r) => ({ k: r.k, score: r.n / (1 + (now - r.at) / (7 * 86_400_000)) + (now - r.at < 3_600_000 ? 1 : 0) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, max)
          .map((r) => r.k);
      },
      forget(k) {
        data.pins = data.pins.filter((p) => p !== k);
        data.recent = data.recent.filter((r) => r.k !== k);
        save();
      },
    };
  }

  root.IndexSmart = { words, stem, dist, near, alike, fuzzyHas, lineHit, suggest, vocabulary, looksLikeQuestion, related, lookAlikes, changedWithin, shelf };
})(typeof window !== "undefined" ? window : globalThis);
