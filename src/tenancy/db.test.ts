import { describe, expect, it } from "vitest";
import { PRE_MIGRATION_TENANT, connectionFor, isMissingFunction } from "./db";

describe("tenancy db helpers", () => {
  it("recognises Postgres' 'function does not exist' error and nothing else", () => {
    expect(isMissingFunction({ code: "42883" })).toBe(true);
    expect(isMissingFunction({ code: "42P01" })).toBe(false);
    expect(isMissingFunction(new Error("boom"))).toBe(false);
    expect(isMissingFunction(null)).toBe(false);
    expect(PRE_MIGRATION_TENANT).toMatch(/^0{8}-0{4}-0{4}-0{4}-0{12}$/);
  });
  it("connectionFor is the single place a connection is chosen, and fails loudly when unset", () => {
    const saved = { r: process.env.CONSOLE_DATABASE_URL, a: process.env.CONSOLE_ADMIN_DATABASE_URL };
    try {
      delete process.env.CONSOLE_DATABASE_URL;
      expect(() => connectionFor("t", "reader")).toThrow(/CONSOLE_DATABASE_URL is not set/);
      process.env.CONSOLE_DATABASE_URL = "postgres://reader";
      process.env.CONSOLE_ADMIN_DATABASE_URL = "postgres://admin";
      expect(connectionFor("t", "reader")).toBe("postgres://reader");
      expect(connectionFor("t", "admin")).toBe("postgres://admin");
    } finally {
      for (const [k, v] of [["CONSOLE_DATABASE_URL", saved.r], ["CONSOLE_ADMIN_DATABASE_URL", saved.a]] as const) v === undefined ? delete process.env[k] : (process.env[k] = v);
    }
  });
});
