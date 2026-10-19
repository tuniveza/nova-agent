// Invoices as PDF files (19 Oct 2026): every invoice, anywhere in Nova Agent, before it's sent and after,
// can be saved as a PDF. Nova Bot draws the invoice's page (its pictures and fonts are inside it) and
// sends it here; Chromium prints it to a PDF, the same way a browser's "Save as PDF" does, and the file
// goes back. Nova Bot and Nova Agent share a server, so it's asked at 127.0.0.1 (Nova Bot's
// PDF_MAKER_URL), and only Nova Bot can ask (AGENT_NOVA_KEY).
//
//   POST /pdf/make   (Authorization: Bearer <AGENT_NOVA_KEY>, the page's HTML as the body) -> application/pdf
//
// One at a time, and the browser is closed after each, so it keeps no memory between. Nothing the page
// asks for leaves the server (it has everything it needs in it).

import type { Hono } from "hono";
import { chromium } from "playwright";
import { config } from "./config";

const MAX_HTML = 4_000_000;
const PRINT_MS = 30_000;

let queue: Promise<unknown> = Promise.resolve();

export function htmlToPdf(html: string): Promise<Buffer> {
  const run = queue.then(async () => {
    const browser = await chromium.launch({ args: ["--disable-gpu", "--mute-audio"] });
    try {
      const page = await browser.newPage();
      await page.route("**/*", (route) => (route.request().url().startsWith("data:") ? route.continue() : route.abort()));
      await page.setContent(html, { waitUntil: "load", timeout: PRINT_MS });
      await page.evaluate(() => document.fonts.ready).catch(() => {});
      page.setDefaultTimeout(PRINT_MS);
      return await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
    } finally {
      await browser.close().catch(() => {});
    }
  });
  queue = run.catch(() => {});
  return run;
}

export function registerPdfRoutes(app: Hono, make: (html: string) => Promise<Buffer> = htmlToPdf) {
  app.post("/pdf/make", async (c) => {
    const key = config.agentNovaKey;
    if (!key || c.req.header("Authorization") !== `Bearer ${key}`) return c.json({ error: "Only Nova Bot can ask for a PDF" }, 403);
    const html = await c.req.text();
    if (!html.trim() || html.length > MAX_HTML) return c.json({ error: "There's no page to make a PDF of" }, 400);
    try {
      const pdf = await make(html);
      return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
    } catch (err) {
      console.log(`PDF: couldn't make one (${String((err as Error).message).split("\n")[0].slice(0, 160)})`);
      return c.json({ error: "The PDF couldn't be made just now" }, 500);
    }
  });
}
