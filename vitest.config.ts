import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The older test/*.test.ts files are plain scripts (npx tsx test/<file>.ts)
    include: ["test/**/*.spec.ts"],
    // A pretend Nova Bot worker, so tests never ring a real phone (each test
    // also gets its own throwaway data folder: see test/harness.ts)
    env: {
      NOVA_WORKER_URL: "https://worker.test",
      AGENT_NOVA_KEY: "test-key",
      STUDIO_TIMEZONE: "Europe/London",
    },
    isolate: true,
    pool: "forks",
  },
});
