// A link dropped on a Board: its page's title, a line about it and its little icon, so the card
// reads well. Only public web pages: addresses on this computer, the studio's network or other
// private ranges are refused (each redirect is checked again), only a small part of the page is
// read, and nothing from it runs anywhere.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  site: string;
  icon: string;
}

const MAX_BYTES = 256 * 1024;

// Private, local and special addresses (IPv4 and IPv6)
export function privateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return true;
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return privateAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s);
  }
  return true;
}

async function publicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That isn't a web address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only web pages (http or https).");
  if (url.username || url.password) throw new Error("Addresses with a password in them aren't opened.");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("Only ordinary web addresses.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) throw new Error("Not a public web page.");
  const found = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!found.length || found.some((f) => privateAddress(f.address))) throw new Error("Not a public web page.");
  return url;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();

function meta(html: string, names: string[]): string {
  for (const name of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, "i");
    const tag = html.match(re)?.[0];
    const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
    if (content) return decode(content);
  }
  return "";
}

export async function linkPreview(raw: string): Promise<LinkPreview> {
  let url = await publicUrl(raw);
  let res: Response | null = null;
  for (let hop = 0; hop < 4; hop++) {
    res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(6000), headers: { "User-Agent": "Mozilla/5.0 (Nova Agent Board link preview)", Accept: "text/html,application/xhtml+xml" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = await publicUrl(new URL(res.headers.get("location")!, url).toString());
      continue;
    }
    break;
  }
  const plain: LinkPreview = { url: url.toString(), title: url.hostname.replace(/^www\./, ""), description: "", site: url.hostname.replace(/^www\./, ""), icon: `${url.origin}/favicon.ico` };
  if (!res || !res.ok || !(res.headers.get("content-type") || "").includes("html") || !res.body) return plain;
  // Only the start of the page (where the title and the descriptions are)
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  reader.cancel().catch(() => {});
  const html = new TextDecoder().decode(Buffer.concat(chunks));
  const title = meta(html, ["og:title", "twitter:title"]) || decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const description = meta(html, ["og:description", "description", "twitter:description"]);
  const site = meta(html, ["og:site_name"]) || plain.site;
  const iconHref = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*>/i)?.[0]?.match(/href=["']([^"']+)["']/i)?.[1];
  let icon = plain.icon;
  try {
    if (iconHref) {
      const u = new URL(decode(iconHref), url);
      if (u.protocol === "https:" || u.protocol === "http:") icon = u.toString();
    }
  } catch {}
  return { url: url.toString(), title: (title || plain.title).slice(0, 200), description: description.slice(0, 400), site: site.slice(0, 80), icon };
}
