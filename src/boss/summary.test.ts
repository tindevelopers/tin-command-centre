import { describe, expect, it } from "vitest";
import type { Project } from "@/src/registry/types";
import type { BossReport, ReportsResult } from "./reports";
import { platformCounts, platformSummary, registeredPlatforms } from "./summary";

const project = (over: Partial<Project> = {}): Project => ({ slug: "pawpointers-dashboard", name: "PawPointers dashboard", kind: "app", client: "pawpointers", repo: null, lifecycle: "active", notes: null, ownerProject: null, path: null, ownerGroup: null, tier: null, annotations: {}, ...over });
const report = (over: Partial<BossReport> = {}): BossReport => ({ platform: "pawpointers", environment: "production", component: "dashboard", versions: { "@tindevelopers/credential-crypto": "1.0.0" }, health: "ok", errors: [], reportedAt: new Date("2026-10-31T10:00:00Z"), ...over });
const ok = (...reports: BossReport[]): ReportsResult => ({ status: "ok", reports });
const projects = [project(), project({ slug: "konnect-app", client: "konnect" }), project({ slug: "old", client: "legacy", lifecycle: "retired" }), project({ slug: "boss", kind: "boss", client: null })];

describe("registeredPlatforms", () => {
  it("is the distinct clients of live projects, sorted", () => {
    expect(registeredPlatforms(projects)).toEqual(["konnect", "pawpointers"]);
  });
});

describe("platformSummary", () => {
  it("one row per platform environment with the worst health, the newest time and every component", () => {
    const rows = platformSummary({ projects }, ok(
      report(),
      report({ component: "admin", health: "degraded", errors: [{ code: "x", count: 3 }], reportedAt: new Date("2026-10-31T11:00:00Z") }),
    ));
    const pp = rows.find((r) => r.platform === "pawpointers")!;
    expect(pp).toMatchObject({ environment: "production", health: "degraded", state: "reported" });
    expect(pp.reportedAt?.toISOString()).toBe("2026-10-31T11:00:00.000Z");
    expect(pp.components.map((c) => [c.component, c.errorCount])).toEqual([["admin", 3], ["dashboard", 0]]);
  });

  it("keeps only the latest report per component", () => {
    const rows = platformSummary({ projects: [project()] }, ok(
      report({ versions: { a: "1.0.0" }, reportedAt: new Date("2026-10-30T10:00:00Z") }),
      report({ versions: { a: "1.1.0" }, reportedAt: new Date("2026-10-31T10:00:00Z") }),
    ));
    expect(rows[0].components).toHaveLength(1);
    expect(rows[0].components[0].versions).toEqual({ a: "1.1.0" });
  });

  it("a registered platform that never reported is a not-reported row; a retired client is not", () => {
    const rows = platformSummary({ projects }, ok(report()));
    expect(rows.map((r) => [r.platform, r.state])).toEqual([["konnect", "not-reported"], ["pawpointers", "reported"]]);
  });

  it("when BOSS is unavailable every registered platform is an unavailable row and nothing is shown as reported", () => {
    const rows = platformSummary({ projects }, { status: "unavailable", reason: "timeout" });
    expect(rows.map((r) => r.state)).toEqual(["unavailable", "unavailable"]);
    expect(rows.every((r) => r.components.length === 0)).toBe(true);
  });

  it("an unknown platform that reports still appears", () => {
    const rows = platformSummary({ projects: [project()] }, ok(report({ platform: "mystery", environment: "staging" })));
    expect(rows.map((r) => r.platform)).toEqual(["mystery", "pawpointers"]);
  });
});

describe("platformCounts", () => {
  it("counts registered platforms with at least one report", () => {
    const rows = platformSummary({ projects }, ok(report(), report({ platform: "mystery" })));
    expect(platformCounts(rows, registeredPlatforms(projects))).toEqual({ reporting: 1, registered: 2 });
  });
});
