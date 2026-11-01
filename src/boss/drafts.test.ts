import { describe, expect, it } from "vitest";
import type { Pin, Project } from "@/src/registry/types";
import type { PackageSnapshot } from "@/src/status/types";
import { buildDrafts, deployedState, findDraft, isPinString } from "./drafts";
import type { SentProposal } from "./drafts";

const proj = (slug: string, client: string | null = "konnect", over: Partial<Project> = {}): Project => ({ slug, name: slug, kind: "app", client, repo: null, lifecycle: "active", notes: null, ownerProject: null, path: null, ownerGroup: null, tier: null, annotations: {}, ...over });
const pin = (projectSlug: string, pkg: string, version: string, environment: Pin["environment"] = "development"): Pin => ({ projectSlug, environment, package: `@tindevelopers/${pkg}`, version });
const snap = (pkg: string, latest: string | null, next: string | null = latest): PackageSnapshot => ({ runId: "1", package: `@tindevelopers/${pkg}`, repo: "r", branchVersion: latest, latest, next, divergence: "OK", dependents: [] });

const projects = [proj("konnect-app"), proj("konnect-ops"), proj("pp", "pawpointers"), proj("old", "konnect", { lifecycle: "retired" }), proj("boss", null, { kind: "boss" })];
const pins = [
  pin("konnect-app", "api-mcp", "0.2.1"), pin("konnect-app", "domain-support", "6.0.0"), pin("konnect-ops", "domain-support", "5.9.0"),
  pin("konnect-app", "ui-shell", "1.2.0"), pin("konnect-app", "comms", "3.1.0"), pin("old", "api-mcp", "0.1.0"), pin("boss", "domain-support", "6.0.0"),
  pin("pp", "credential-crypto", "1.0.0", "production"), pin("pp", "knowledge", "0.5.0", "production"),
];
const packages = [snap("api-mcp", "1.0.1"), snap("domain-support", "6.0.1"), snap("ui-shell", "1.2.0"), snap("comms", "3.1.1", "3.1.0"), snap("credential-crypto", "1.0.0"), snap("knowledge", null, "0.7.0")];

describe("buildDrafts", () => {
  const drafts = buildDrafts({ projects, pins }, packages);
  const konnect = drafts.find((d) => d.platform === "konnect")!;

  it("one draft per platform environment, only pins behind latest, hub packages only, worst bump first", () => {
    expect(drafts.map((d) => [d.platform, d.environment])).toEqual([["konnect", "development"]]);
    // api-mcp and domain-support are major steps (support from konnect-ops's 5.9.0), comms a patch; majors first, then by name.
    expect(konnect.pins.map((p) => p.pin)).toEqual(["@tindevelopers/api-mcp@1.0.1", "@tindevelopers/domain-support@6.0.1", "@tindevelopers/comms@3.1.1"]);
    expect(konnect.bump).toBe("major");
  });
  it("merges the same package across projects, keeping every declared version and the largest step", () => {
    const support = konnect.pins.find((p) => p.package === "@tindevelopers/domain-support")!;
    expect(support).toMatchObject({ to: "6.0.1", from: ["5.9.0", "6.0.0"], bump: "major", projects: ["konnect-app", "konnect-ops"] });
    expect(konnect.pins.find((p) => p.package === "@tindevelopers/comms")).toMatchObject({ from: ["3.1.0"], bump: "patch" });
  });
  it("skips pins already at latest, retired projects, projects with no platform, and packages with no latest", () => {
    const names = konnect.pins.map((p) => p.package);
    expect(names).not.toContain("@tindevelopers/ui-shell"); // at latest
    expect(drafts.some((d) => d.platform === "pawpointers")).toBe(false); // crypto at latest, knowledge has no latest
    expect(konnect.pins.find((p) => p.package === "@tindevelopers/api-mcp")?.projects).toEqual(["konnect-app"]); // 'old' is retired, 'boss' has no client
  });
  it("gives nothing before the collector has run", () => {
    expect(buildDrafts({ projects, pins }, null)).toEqual([]);
  });
  it("splits more than ten pins into parts", () => {
    const many = Array.from({ length: 12 }, (_, i) => pin("konnect-app", `p${i}`, "1.0.0"));
    const snaps = Array.from({ length: 12 }, (_, i) => snap(`p${i}`, "1.1.0"));
    const parts = buildDrafts({ projects, pins: many }, snaps);
    expect(parts.map((d) => [d.part?.n, d.part?.of, d.pins.length])).toEqual([[1, 2, 10], [2, 2, 2]]);
    expect(findDraft(parts, "konnect", "development", 2)?.pins).toHaveLength(2);
    expect(findDraft(parts, "konnect", "development", null)).toBeUndefined();
  });
  it("marks a draft already sent when the newest recorded proposal carries exactly its pins", () => {
    const sent: SentProposal = { platform: "konnect", environment: "development", pins: ["@tindevelopers/domain-support@6.0.1", "@tindevelopers/comms@3.1.1", "@tindevelopers/api-mcp@1.0.1"], bossId: "pp_1", requestedBy: "a", requestedAt: new Date("2026-11-01T10:00:00Z") };
    expect(buildDrafts({ projects, pins }, packages, [sent])[0].alreadySent).toBe(true);
    const older = { ...sent, pins: ["@tindevelopers/api-mcp@1.0.1"], requestedAt: new Date("2026-10-01T10:00:00Z") };
    expect(buildDrafts({ projects, pins }, packages, [older, sent])[0].alreadySent).toBe(true);
    expect(buildDrafts({ projects, pins }, packages, [sent, { ...older, requestedAt: new Date("2026-11-02T10:00:00Z") }])[0].alreadySent).toBe(false);
  });
});

describe("pin strings and deployed state", () => {
  it("accepts only hub packages at exact versions", () => {
    expect(isPinString("@tindevelopers/api-mcp@1.0.1")).toBe(true);
    expect(isPinString("@tindevelopers/api-mcp@1.0.1-next.0")).toBe(true);
    expect(isPinString("@other/x@1.0.0")).toBe(false);
    expect(isPinString("@tindevelopers/x@^1.0.0")).toBe(false);
  });
  it("deployed only when every pin is reported at its version", () => {
    const sent: SentProposal = { platform: "konnect", environment: "development", pins: ["@tindevelopers/a@1.0.0", "@tindevelopers/b@2.0.0"], bossId: "x", requestedBy: "a", requestedAt: new Date() };
    const r = (versions: Record<string, string>, environment = "development") => ({ platform: "konnect", environment, versions });
    expect(deployedState(sent, [])).toBe("not-reported");
    expect(deployedState(sent, [r({}, "staging")])).toBe("not-reported");
    expect(deployedState(sent, [r({ "@tindevelopers/a": "0.9.0" })])).toBe("not-deployed");
    expect(deployedState(sent, [r({ "@tindevelopers/a": "1.0.0" })])).toBe("partly");
    expect(deployedState(sent, [r({ "@tindevelopers/a": "1.0.0" }), r({ "@tindevelopers/b": "2.0.0" })])).toBe("deployed");
  });
});
