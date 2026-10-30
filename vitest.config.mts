import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  // The db/* suites boot PGlite (a WASM Postgres) in `beforeAll`; cold starts
  // exceed vitest's 10 s default when several files start at once under the
  // default worker pool. db/agent_runs.test.ts already passes 60_000 to its own
  // hook; this makes the default match for the rest. No test is changed.
  test: { include: ["src/**/*.test.ts", "db/**/*.test.ts"], hookTimeout: 60_000 },
});
