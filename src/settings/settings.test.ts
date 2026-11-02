import { describe, expect, it } from "vitest";
import { INTEGRATIONS, integrationStates, publicLeaks, tenantScoped } from "./integrations";
import { OWNER_GATES, POLICIES } from "./policy";

describe("integrationStates", () => {
  it("judges by names only and never carries a value", () => {
    const env = { CONSOLE_DATABASE_URL: "postgres://reader:hunter2@host/db", BOSS_API_URL: "https://boss.example.com", AGENT_GITHUB_TOKEN: "ghp_secret" };
    const states = integrationStates(env);
    const by = Object.fromEntries(states.map((s) => [s.integration.id, s]));
    expect(by["store-read"].state).toBe("configured");
    expect(by["store-write"].state).toBe("not-set");
    expect(by["boss-reports"].state).toBe("partial");
    expect(by["boss-reports"].missing).toEqual(["BOSS_REPORTS_KEY"]);
    expect(by["agent"].state).toBe("configured");
    expect(by["tenancy"].state).toBe("defaults");
    expect(JSON.stringify(states)).not.toContain("hunter2");
    expect(JSON.stringify(states)).not.toContain("ghp_secret");
  });
  it("treats blank as unset and reports optional names that are set", () => {
    const by = Object.fromEntries(integrationStates({ COLLECTOR_GITHUB_TOKEN: "  ", COLLECTOR_REPO: "o/r", TENANT_OTHER_HOSTS: "reject" }).map((s) => [s.integration.id, s]));
    expect(by["collector"].state).toBe("not-set");
    expect(by["collector"].set).toEqual(["COLLECTOR_REPO"]);
    expect(by["tenancy"].state).toBe("configured");
  });
  it("flags a server-only name published to the browser", () => {
    expect(publicLeaks({ NEXT_PUBLIC_BOSS_REPORTS_KEY: "x", NEXT_PUBLIC_APP_NAME: "fine", BOSS_API_URL: "y" })).toEqual(["NEXT_PUBLIC_BOSS_REPORTS_KEY"]);
    expect(publicLeaks({})).toEqual([]);
  });
  it("every integration names a page or none, and the tenant-scoped ones are the BOSS keys and the agent", () => {
    for (const i of INTEGRATIONS) expect(i.page === null || i.page.startsWith("/")).toBe(true);
    expect(tenantScoped().map((i) => i.id)).toEqual(["boss-reports", "boss-operator", "boss-credentials", "agent"]);
  });
});

describe("policies", () => {
  it("every record computes values from code without throwing, and cites where it is recorded", () => {
    for (const p of POLICIES) {
      const values = p.values();
      expect(values.length).toBeGreaterThan(0);
      for (const v of values) expect(v.value.length).toBeGreaterThan(0);
      expect(p.recordedIn.length).toBeGreaterThan(0);
    }
  });
  it("the registry vocabulary comes from the code, not a copy", () => {
    const reg = POLICIES.find((p) => p.id === "registry")!.values();
    expect(reg.find((v) => v.label === "kinds")!.value).toBe("boss, hub, spoke, package, shell-base, app");
    expect(reg.find((v) => v.label === "environments")!.value).toContain("production");
  });
  it("tenancy values reflect the environment", () => {
    const t = POLICIES.find((p) => p.id === "tenancy")!;
    const before = t.values().find((v) => v.label === "unknown hosts")!.value;
    expect(before).toContain("fall back");
    expect(OWNER_GATES).toContain("merge or push to main");
  });
});
