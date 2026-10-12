import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  // Each db suite boots an in-memory Postgres (PGlite); with several running in parallel the default 10 s hook limit is too tight on a busy machine.
  test: { include: ["src/**/*.test.ts", "db/**/*.test.ts"], hookTimeout: 60_000, testTimeout: 30_000 },
});
