// All addresses (web/shared/addresses.js): every address is the online one, nothing points at an
// old address or this computer, no keys, and only admins get the admin ones. The live check that
// each one answers is scripts/check-addresses.mjs.
// Run: npm test
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const box: any = { window: {} };
vm.runInNewContext(readFileSync(join(__dirname, "..", "web", "shared", "addresses.js"), "utf8"), box);
const A = box.window.NovaAddresses;
const all = (admin: boolean) => A.list(admin).flatMap((g: any) => g.items);

describe("All addresses", () => {
  it("are all on https://nova.novacane.co.uk", () => {
    expect(A.base).toBe("https://nova.novacane.co.uk");
    for (const i of all(true)) {
      const text = i.code || i.url;
      expect(text, i.name).toContain("https://nova.novacane.co.uk/");
      expect(text, i.name).not.toMatch(/workers\.dev|sslip\.io|localhost|127\.0\.0\.1/);
      expect(text, i.name).not.toMatch(/[?&](key|token)=/i);
    }
  });

  it("each have a name and a plain line", () => {
    for (const i of all(true)) {
      expect(i.name.length).toBeGreaterThan(1);
      expect(i.what.length).toBeGreaterThan(10);
    }
  });

  it("show the admin ones to admins only", () => {
    const staff = all(false).map((i: any) => i.name);
    const admins = all(true).map((i: any) => i.name);
    expect(staff).toContain("Nova Agent");
    expect(staff).toContain("Status");
    expect(staff).not.toContain("Fixer");
    expect(staff).not.toContain("Stripe's payment notices");
    expect(staff).not.toContain("Google's return address");
    expect(admins).toEqual(expect.arrayContaining(["Fixer", "Stripe's payment notices", "Google's return address", "Status, as data"]));
    expect(A.list(false).some((g: any) => g.admin)).toBe(false);
  });

  it("are each listed once", () => {
    const urls = all(true).filter((i: any) => i.url).map((i: any) => i.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});
