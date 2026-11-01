import { describe, expect, it } from "vitest";
import { integrationStatus, tenantHost } from "./admin";

describe("tenantHost", () => {
  const cfg = { baseDomain: "control.tinconnect.com", defaultTenant: "tin" };
  it("the default tenant answers on the bare base domain, others on a subdomain", () => {
    expect(tenantHost("tin", cfg)).toBe("control.tinconnect.com");
    expect(tenantHost("botski", cfg)).toBe("botski.control.tinconnect.com");
  });
});

describe("integrationStatus", () => {
  it("reports configured by NAME only and never carries a value", () => {
    const rows = integrationStatus({ CONSOLE_DATABASE_URL: "postgres://secret@host/db", BOSS_API_URL: "https://boss", BOSS_REPORTS_KEY: "k", TENANT_OTHER_HOSTS: "reject" });
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(by.CONSOLE_DATABASE_URL.configured).toBe(true);
    expect(by.CONSOLE_ADMIN_DATABASE_URL.configured).toBe(false);
    expect(by.BOSS_API_URL.configured).toBe(true);
    expect(by.TENANT_OTHER_HOSTS).toMatchObject({ configured: true, note: "rejected (404)" });
    expect(JSON.stringify(rows)).not.toContain("secret");
  });
  it("BOSS counts as configured only with both the URL and the key", () => {
    expect(integrationStatus({ BOSS_API_URL: "https://boss" }).find((r) => r.name === "BOSS_API_URL")?.configured).toBe(false);
  });
  it("treats blank values as unset", () => {
    expect(integrationStatus({ AGENT_GITHUB_TOKEN: "  " }).find((r) => r.name === "AGENT_GITHUB_TOKEN")?.configured).toBe(false);
  });
});
