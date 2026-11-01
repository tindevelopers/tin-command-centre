import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { include: ["src/**/*.test.ts", "db/**/*.test.ts"], hookTimeout: 60_000 }, // the database tests start an in-memory Postgres and apply every migration in beforeAll; under parallel load that can pass the 10 s default
});
