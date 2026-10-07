// Nova Quest's eyes on the internet.
//
//   - webTools(): Claude's own web search and web fetch (they run on
//     Anthropic's servers), for the chat and the mission planner
//   - sourcesIn(): the pages Claude actually searched up or read in a reply,
//     so a plan's research only ever cites real pages
//   - lookAt(): open any public webpage in a browser of its own (never the
//     Acuity session), and return what it looks like (a screenshot) and what's
//     on it (the page's text structure), for Claude to see

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type Anthropic from "@anthropic-ai/sdk";
import type { BetaToolResultContentBlockParam } from "@anthropic-ai/sdk/resources/beta";
import { chromium, type Browser } from "playwright";
import { trace } from "./trace";

export interface Source {
  title: string;
  url: string;
}

// Search and fetch, with a cap on how many of each one reply may use
export function webTools(uses: { search: number; fetch: number }) {
  return [
    { type: "web_search_20260209" as const, name: "web_search" as const, max_uses: uses.search },
    { type: "web_fetch_20260209" as const, name: "web_fetch" as const, max_uses: uses.fetch, max_content_tokens: 20000 },
  ];
}

// Every page a reply's searches found or its fetches read (each URL once)
export function sourcesIn(content: Anthropic.Beta.BetaContentBlock[]): Source[] {
  const seen = new Map<string, Source>();
  for (const b of content) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) if (r.type === "web_search_result") seen.set(r.url, { title: r.title || r.url, url: r.url });
    } else if (b.type === "web_fetch_tool_result" && b.content.type === "web_fetch_result") {
      const doc = b.content.content;
      seen.set(b.content.url, { title: (doc.type === "document" && doc.title) || b.content.url, url: b.content.url });
    }
  }
  return [...seen.values()];
}

// --- seeing a webpage ---

const LOOK_TIMEOUT_MS = 30_000;
const MAX_TEXT = 12_000;
const IDLE_CLOSE_MS = 2 * 60_000;

// Only the public internet: never the studio computer itself, the local
// network, or anything else that isn't a public address
function isPrivate(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivate(v.slice(7));
    return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export async function checkPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`That isn't a web address: ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http and https pages can be opened.");
  if (url.username || url.password) throw new Error("Addresses with a login in them can't be opened.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal|.*\.lan)$/i.test(host)) throw new Error("Only public webpages can be opened, not this computer or the local network.");
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((r) => r.address);
  if (!ips.length) throw new Error(`Couldn't find ${host}.`);
  if (ips.some(isPrivate)) throw new Error("Only public webpages can be opened, not this computer or the local network.");
  return url;
}

// One browser for looking, shared, closed again after a couple of quiet minutes
let browser: Promise<Browser> | undefined;
let idle: NodeJS.Timeout | undefined;
function lookingBrowser(): Promise<Browser> {
  if (idle) clearTimeout(idle);
  idle = setTimeout(() => {
    const b = browser;
    browser = undefined;
    b?.then((x) => x.close()).catch(() => {});
  }, IDLE_CLOSE_MS);
  idle.unref();
  browser ??= chromium.launch({ headless: true }).catch((error) => {
    browser = undefined;
    throw error;
  });
  return browser;
}

export interface Look {
  url: string; // where it ended up, after any redirects
  title: string;
  text: string; // the page's structure: headings, links, buttons, text
  screenshot: Buffer; // JPEG, the top of the page as a person would see it
}

export async function lookAt(raw: string): Promise<Look> {
  const url = await checkPublicUrl(raw);
  trace("browser", "start", `Looking at ${url.href}`);
  const context = await (await lookingBrowser()).newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: false });
  try {
    // Every request the page makes has to stay on the public internet too
    // (each host checked once per look)
    const hosts = new Map<string, Promise<boolean>>();
    await context.route("**/*", async (route) => {
      const u = route.request().url();
      if (u.startsWith("data:") || u.startsWith("blob:")) return route.continue();
      let host = "";
      try {
        host = new URL(u).host;
      } catch {
        return route.abort();
      }
      if (!hosts.has(host)) hosts.set(host, checkPublicUrl(u).then(() => true, () => false));
      return (await hosts.get(host)) ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: LOOK_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    // A redirect can't lead it off the public internet either
    await checkPublicUrl(page.url());
    const screenshot = await page.screenshot({ type: "jpeg", quality: 60 });
    const text = (await page.locator("body").ariaSnapshot({ timeout: 10_000 }).catch(() => page.locator("body").innerText()))
      .slice(0, MAX_TEXT);
    const look = { url: page.url(), title: await page.title(), text, screenshot };
    trace("browser", "ok", `Looked at ${look.title || look.url}`);
    return look;
  } finally {
    await context.close().catch(() => {});
  }
}

// What Claude gets back from a look: the words, then the picture
export function lookResult(look: Look): BetaToolResultContentBlockParam[] {
  return [
    { type: "text", text: `${look.title || "(no title)"}\n${look.url}\n\nWhat's on the page:\n${look.text}${look.text.length >= MAX_TEXT ? "\n…(cut short)" : ""}` },
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: look.screenshot.toString("base64") } },
  ];
}
