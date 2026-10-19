// Invoices as PDF files (src/pdf.ts): only Nova Bot can ask, and a page comes back as a real PDF
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { config } from "../src/config";
import { htmlToPdf, registerPdfRoutes } from "../src/pdf";

const savedKey = config.agentNovaKey;
afterEach(() => {
  config.agentNovaKey = savedKey;
});
const app = (make?: (html: string) => Promise<Buffer>) => {
  const a = new Hono();
  registerPdfRoutes(a, make);
  return a;
};
const ask = (a: Hono, key: string, body = "<p>Invoice</p>") => a.request("/pdf/make", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body });

describe("the PDF maker", () => {
  it("only answers Nova Bot (its key), never without one set", async () => {
    config.agentNovaKey = "k";
    expect((await ask(app(async () => Buffer.from("x")), "wrong")).status).toBe(403);
    config.agentNovaKey = "";
    expect((await ask(app(async () => Buffer.from("x")), "")).status).toBe(403);
  });
  it("sends back the PDF, and says so when it can't make one", async () => {
    config.agentNovaKey = "k";
    const ok = await ask(app(async (html) => Buffer.from(`%PDF ${html.length}`)), "k");
    expect(ok.headers.get("Content-Type")).toBe("application/pdf");
    expect(await ok.text()).toBe("%PDF 14");
    expect((await ask(app(async () => Promise.reject(new Error("no browser"))), "k")).status).toBe(500);
    expect((await ask(app(), "k", "  ")).status).toBe(400);
  });
  it("prints a page to a real PDF with Chromium, without asking anything of the internet", async () => {
    const pdf = await htmlToPdf(`<!doctype html><style>body{font:16px sans-serif}</style><h1>Invoice NS-0001</h1><img src="https://example.com/x.png">`);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(500);
  }, 60_000);
});
