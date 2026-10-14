import { describe, expect, it } from "vitest";
import { LINK_ATTEMPT_MS, RETRY_WAIT_MS, linkWatch } from "../src/relay";

// The online link's watcher: what it does with the link at each moment
describe("the link watcher", () => {
  const now = 1_000_000;
  it("leaves an open link alone", () => {
    expect(linkWatch({ state: "open", since: 0, scheduled: false, now })).toBe("ok");
  });
  it("waits for an attempt that's still young", () => {
    expect(linkWatch({ state: "connecting", since: now - 5_000, scheduled: false, now })).toBe("ok");
  });
  it("starts again when an attempt never finished (no open, no close)", () => {
    expect(linkWatch({ state: "connecting", since: now - LINK_ATTEMPT_MS - 1, scheduled: false, now })).toBe("restart");
    expect(linkWatch({ state: "closed", since: now - LINK_ATTEMPT_MS - 1, scheduled: false, now })).toBe("restart");
  });
  it("waits while a retry is scheduled, but not for ever", () => {
    expect(linkWatch({ state: "none", since: now - RETRY_WAIT_MS + 1_000, scheduled: true, now })).toBe("ok");
    expect(linkWatch({ state: "none", since: now - RETRY_WAIT_MS - 1, scheduled: true, now })).toBe("connect");
  });
  it("starts an attempt when there's none and none is scheduled (the retries stopped)", () => {
    expect(linkWatch({ state: "none", since: now, scheduled: false, now })).toBe("connect");
  });
});
