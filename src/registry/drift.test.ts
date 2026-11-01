import { describe, expect, it } from "vitest";
import { cellFinding, compareVersions, computeDrift, ownerFinding, parseVersion, pinFinding, projectColour } from "./drift";
import type { Environment, Pin, Project, Registry } from "./types";
import type { CellSnapshot, PackageSnapshot } from "@/src/status/types";

const v = (s: string) => parseVersion(s)!;
const pin = (version: string): Pin => ({ projectSlug: "konnect", environment: "production", package: "@tindevelopers/ui-shell", version });
const snap = (latest: string | null, next: string | null = null): PackageSnapshot => ({
  runId: "1", package: "@tindevelopers/ui-shell", repo: "r", branchVersion: null, latest, next, divergence: "OK", dependents: null,
});

describe("versions", () => {
  it("orders by major, minor, patch", () => {
    expect(compareVersions(v("1.2.0"), v("1.10.0"))).toBe(-1);
    expect(compareVersions(v("2.0.0"), v("1.99.99"))).toBe(1);
    expect(compareVersions(v("1.2.0"), v("v1.2.0"))).toBe(0);
  });
  it("sorts a prerelease before its release", () => {
    expect(compareVersions(v("1.2.0-next.1"), v("1.2.0"))).toBe(-1);
  });
  it("rejects ranges", () => {
    expect(parseVersion("^1.2.0")).toBeNull();
    expect(parseVersion("1.2")).toBeNull();
  });
});

describe("pinFinding", () => {
  it("matching latest is green", () => expect(pinFinding(pin("1.2.0"), snap("1.2.0")).colour).toBe("green"));
  it("on next, awaiting promotion, is amber", () => expect(pinFinding(pin("1.3.0"), snap("1.2.0", "1.3.0")).colour).toBe("amber"));
  it("behind by minor or patch is amber", () => {
    expect(pinFinding(pin("1.1.0"), snap("1.2.0")).colour).toBe("amber");
    expect(pinFinding(pin("1.2.0"), snap("1.2.3")).colour).toBe("amber");
  });
  it("behind by a major is red", () => expect(pinFinding(pin("1.9.0"), snap("2.0.0")).colour).toBe("red"));
  it("ahead of anything published (and not next) is red", () => expect(pinFinding(pin("9.0.0"), snap("1.2.0", "1.3.0")).colour).toBe("red"));
  it("an unparseable declared version is red", () => expect(pinFinding(pin("^1.2.0"), snap("1.2.0")).colour).toBe("red"));
  it("a package the collector has not seen is amber, not green", () => expect(pinFinding(pin("1.2.0"), undefined).colour).toBe("amber"));
  it("a package with no published versions is amber", () => expect(pinFinding(pin("1.2.0"), snap(null)).colour).toBe("amber"));
  it("only on next, with the declared version equal to it, is amber", () => expect(pinFinding(pin("1.0.0"), snap(null, "1.0.0")).colour).toBe("amber"));
});

const env = (cell: string | null): Environment => ({ projectSlug: "konnect", name: "production", cell, region: null, url: null });
const cellSnap = (h: number | null, r: number | null): CellSnapshot => ({
  runId: "1", cell: "konnect-dev", client: "konnect", ring: 0, region: "eu", url: null, healthzStatus: h, readyzStatus: r, checkedAt: new Date(),
});

describe("cellFinding", () => {
  it("no declared cell means no finding", () => expect(cellFinding(env(null), [])).toBeNull());
  it("no collector data is amber", () => expect(cellFinding(env("konnect-dev"), null)?.colour).toBe("amber"));
  it("a declared cell the collector did not see is red", () => expect(cellFinding(env("konnect-dev"), [])?.colour).toBe("red"));
  it("unhealthy is red", () => expect(cellFinding(env("konnect-dev"), [cellSnap(200, 503)])?.colour).toBe("red"));
  it("healthy is green", () => expect(cellFinding(env("konnect-dev"), [cellSnap(200, 200)])?.colour).toBe("green"));
});

const project = (slug: string, lifecycle: Project["lifecycle"] = "active"): Project => ({ slug, name: slug, kind: "app", client: null, repo: null, lifecycle, notes: null, ownerProject: null, path: null, ownerGroup: null, tier: null, annotations: {} });

describe("computeDrift", () => {
  const reg = (over: Partial<Registry>): Registry => ({ projects: [], environments: [], pins: [], assignments: [], relations: [], ...over });

  it("flags an active project with no owner", () => {
    expect(ownerFinding(project("a"), 0)?.colour).toBe("amber");
    expect(ownerFinding(project("a"), 1)).toBeNull();
  });

  it("an owning project counts as an owner, even with no person assigned", () => {
    expect(ownerFinding({ ...project("a"), ownerProject: "boss" }, 0)).toBeNull();
    expect(ownerFinding({ ...project("a"), ownerProject: "a" }, 0)).toBeNull(); // top-level, owns itself
  });

  it("ignores retired projects entirely", () => {
    const r = reg({ projects: [project("konnect", "retired")], pins: [pin("1.0.0")], environments: [env("gone")] });
    expect(computeDrift(r, [snap("2.0.0")], [])).toEqual([]);
  });

  it("an owner who is only a maintainer does not count as an owner", () => {
    const r = reg({ projects: [project("konnect")], assignments: [{ id: "1", projectSlug: "konnect", assignee: "a@tin.info", role: "maintainer", assignedBy: "x", assignedAt: new Date() }] });
    expect(computeDrift(r, null, null).map((f) => f.kind)).toEqual(["owner"]);
  });

  it("rolls findings up to the worst colour per project", () => {
    const r = reg({
      projects: [project("konnect"), project("other")],
      assignments: [
        { id: "1", projectSlug: "konnect", assignee: "a@tin.info", role: "owner", assignedBy: "x", assignedAt: new Date() },
        { id: "2", projectSlug: "other", assignee: "a@tin.info", role: "owner", assignedBy: "x", assignedAt: new Date() },
      ],
      pins: [pin("1.1.0")],
    });
    const findings = computeDrift(r, [snap("1.2.0")], []);
    expect(projectColour("konnect", findings)).toBe("amber");
    expect(projectColour("other", findings)).toBe("green");
  });
});
