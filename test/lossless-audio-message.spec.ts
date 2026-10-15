// Lossless's Connect, when audio won't start: no microphone is a setup step with a plain next
// step, not the browser's own wording ("Requested device not found").
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("../web/lossless/public/lossless/app.js", import.meta.url), "utf8");
const FN = SRC.match(/function audioStartMessage\(err\) \{[\s\S]*?\n\}/)![0];
const audioStartMessage = vm.runInNewContext(`(${FN})`) as (err: unknown) => string;

const fail = (name: string, message = "Requested device not found") => Object.assign(new Error(message), { name });

describe("Lossless: why audio didn't start", () => {
  it("no microphone: says so and what to do", () => {
    for (const name of ["NotFoundError", "OverconstrainedError", "NotReadableError"]) {
      const said = audioStartMessage(fail(name));
      expect(said).toMatch(/No microphone available/);
      expect(said).not.toMatch(/Requested device not found/);
    }
  });

  it("permission refused: as before", () => {
    expect(audioStartMessage(fail("NotAllowedError"))).toBe("Couldn't start audio: Microphone permission was denied.");
  });

  it("anything else: the reason, as before", () => {
    expect(audioStartMessage(fail("TypeError", "boom"))).toBe("Couldn't start audio: boom");
    expect(audioStartMessage(undefined)).toBe("Couldn't start audio: unknown error");
  });
});
