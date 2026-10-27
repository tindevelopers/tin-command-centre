import { describe, expect, it } from "vitest";
import type { Pin, Project } from "@/src/registry/types";
import { WATCHED_PACKAGES, compareReported, needsReports } from "./compare";
import type { BossReport, ReportsResult } from "./reports";

const KNOWLEDGE = "@tindevelopers/knowledge";
const WORKER = "@tindevelopers/knowledge-worker";
const CRYPTO = "@tindevelopers/credential-crypto";

const project = (over: Partial<Project> = {}): Project => ({ slug: "konnect-knowledge-worker", name: "Konnect knowledge worker", kind: "app", client: "konnect", repo: null, lifecycle: "active", notes: null, ownerProject: null, path: null, ownerGroup: null, tier: null, annotations: {}, ...over });
const pin = (over: Partial<Pin> = {}): Pin => ({ projectSlug: "konnect-knowledge-worker", environment: "staging", package: KNOWLEDGE, version: "0.4.2", ...over });
const report = (over: Partial<BossReport> = {}): BossReport => ({ platform: "konnect", environment: "staging", component: "knowledge-worker", versions: { [KNOWLEDGE]: "0.4.2", [WORKER]: "0.4.2" }, health: "ok", errors: [], reportedAt: new Date("2026-10-14T10:00:00Z"), ...over });
const ok = (...reports: BossReport[]): ReportsResult => ({ status: "ok", reports });

const compare = (pins: Pin[], result: ReportsResult, projects: Project[] = [project()]) => compareReported({ projects, pins }, result);

describe("compareReported", () => {
  it("watches knowledge, knowledge-worker and credential-crypto", () => {
    expect([...WATCHED_PACKAGES]).toEqual([KNOWLEDGE, WORKER, CRYPTO]);
  });

  it("pawpointers: a component named exactly like the slug is the one compared, not other components", () => {
    const dash = project({ slug: "pawpointers-dashboard", name: "PawPointers dashboard", client: "pawpointers" });
    const p = pin({ projectSlug: "pawpointers-dashboard", environment: "production", package: CRYPTO, version: "1.0.0" });
    const r = (component: string, version: string) => report({ platform: "pawpointers", environment: "production", component, versions: { [CRYPTO]: version } });
    const [c] = compare([p], ok(r("pawpointers-dashboard", "1.0.0"), r("pawpointers-admin", "0.9.0")), [dash]);
    expect(c).toMatchObject({ platform: "pawpointers", state: "deployed" });
    expect(c.reported.map((x) => x.component)).toEqual(["pawpointers-dashboard"]);
  });

  it("match: the reported version equals the declared pin, so it is deployed", () => {
    const [c] = compare([pin()], ok(report()));
    expect(c).toMatchObject({ projectSlug: "konnect-knowledge-worker", environment: "staging", platform: "konnect", package: KNOWLEDGE, declared: "0.4.2", state: "deployed" });
    expect(c.reported).toEqual([{ component: "knowledge-worker", version: "0.4.2", health: "ok", reportedAt: new Date("2026-10-14T10:00:00Z") }]);
  });

  it("compares both watched packages, and ignores other pins", () => {
    const out = compare([pin(), pin({ package: WORKER }), pin({ package: "@tindevelopers/ui-shell", version: "1.2.0" })], ok(report()));
    expect(out.map((c) => [c.package, c.state])).toEqual([[KNOWLEDGE, "deployed"], [WORKER, "deployed"]]);
  });

  it("mismatch: the reported version differs, so it is NOT deployed (merged pin is not deployed)", () => {
    const [c] = compare([pin({ version: "0.5.0" })], ok(report()));
    expect(c.state).toBe("not-deployed");
    expect(c.message).toMatch(/not deployed/i);
    expect(c.message).toContain("0.5.0");
    expect(c.message).toContain("0.4.2");
  });

  it("a reported version that differs only by build metadata or a leading v is the same version", () => {
    expect(compare([pin()], ok(report({ versions: { [KNOWLEDGE]: "v0.4.2+sha.abc" } })))[0].state).toBe("deployed");
  });

  it("a prerelease is not the release", () => {
    expect(compare([pin({ version: "0.5.0" })], ok(report({ versions: { [KNOWLEDGE]: "0.5.0-rc.1" } })))[0].state).toBe("not-deployed");
  });

  it("missing report: nothing reported for that platform environment", () => {
    const [c] = compare([pin()], ok(report({ environment: "production" }), report({ platform: "other" })));
    expect(c.state).toBe("not-reported");
    expect(c.reported).toEqual([]);
    expect(c.message).toMatch(/no report/i);
  });

  it("missing report: the environment reported, but not this package", () => {
    const [c] = compare([pin({ package: WORKER })], ok(report({ versions: { [KNOWLEDGE]: "0.4.2" } })));
    expect(c.state).toBe("not-reported");
  });

  it("missing report: no reports at all", () => {
    expect(compare([pin()], ok())[0].state).toBe("not-reported");
  });

  it("an unreported pin is never shown as deployed", () => {
    for (const c of compare([pin(), pin({ package: WORKER })], ok())) expect(c.state).not.toBe("deployed");
  });

  it("BOSS unavailable: every watched pin is 'unavailable', never deployed", () => {
    const out = compare([pin(), pin({ package: WORKER })], { status: "unavailable", reason: "timeout" });
    expect(out.map((c) => c.state)).toEqual(["unavailable", "unavailable"]);
    expect(out[0].message).toMatch(/BOSS/);
    expect(out[0].reported).toEqual([]);
  });

  it("not configured: 'unavailable' with a message that says so", () => {
    const [c] = compare([pin()], { status: "unconfigured" });
    expect(c.state).toBe("unavailable");
    expect(c.message).toMatch(/not configured/i);
  });

  it("malformed response: the reader returns unavailable/malformed, which is shown as unavailable", () => {
    const [c] = compare([pin()], { status: "unavailable", reason: "malformed" });
    expect(c.state).toBe("unavailable");
    expect(c.message).toMatch(/unexpected/i);
  });

  it("when several components report the package, the one named for the project wins", () => {
    const app = report({ component: "app", versions: { [KNOWLEDGE]: "0.3.0" } });
    const worker = report({ component: "knowledge-worker", versions: { [KNOWLEDGE]: "0.4.2" } });
    expect(compare([pin()], ok(app, worker))[0].state).toBe("deployed");
  });

  it("with no component named for the project, any reporter that disagrees makes it not deployed", () => {
    const a = report({ component: "app", versions: { [KNOWLEDGE]: "0.4.2" } });
    const b = report({ component: "other", versions: { [KNOWLEDGE]: "0.3.0" } });
    const [c] = compare([pin()], ok(a, b));
    expect(c.state).toBe("not-deployed");
    expect(c.reported.map((r) => r.component).sort()).toEqual(["app", "other"]);
  });

  it("only projects with a client (the BOSS platform) are compared", () => {
    expect(compare([pin({ projectSlug: "tin-ops-console" })], ok(report()), [project({ slug: "tin-ops-console", client: null })])).toEqual([]);
  });

  it("retired projects are not compared", () => {
    expect(compare([pin()], ok(report()), [project({ lifecycle: "retired" })])).toEqual([]);
  });

  it("a platform's reports do not leak into another platform's projects", () => {
    const other = project({ slug: "acme-worker", client: "acme" });
    const [c] = compare([pin({ projectSlug: "acme-worker" })], ok(report()), [other]);
    expect(c.state).toBe("not-reported");
  });

  it("orders by project, environment, package", () => {
    const out = compare([pin({ environment: "staging", package: WORKER }), pin({ environment: "production" }), pin({ environment: "staging" })], ok());
    expect(out.map((c) => `${c.environment}/${c.package}`)).toEqual([`production/${KNOWLEDGE}`, `staging/${KNOWLEDGE}`, `staging/${WORKER}`]);
  });
});

describe("needsReports", () => {
  it("is true only when the project has a client and a watched pin", () => {
    expect(needsReports(project(), [pin()])).toBe(true);
    expect(needsReports(project(), [pin({ package: "@tindevelopers/ui-shell" })])).toBe(false);
    expect(needsReports(project({ client: null }), [pin()])).toBe(false);
    expect(needsReports(project({ lifecycle: "retired" }), [pin()])).toBe(false);
  });
});
