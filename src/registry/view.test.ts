import { describe, expect, it } from "vitest";
import { applyProjectFilters, filterFindings, filterPackageRows, isNestedView, nest, packageMatrix, parseDriftFilters, parseProjectFilters, projectCounts, sortProjectRows, summarise } from "./view";
import type { Finding, Project, Registry } from "./types";
import type { PackageSnapshot } from "@/src/status/types";

const proj = (slug: string, over: Partial<Project> = {}): Project => ({ slug, name: slug.toUpperCase(), kind: "app", client: null, repo: null, lifecycle: "active", notes: null, ownerProject: null, path: null, ownerGroup: null, tier: null, annotations: {}, ...over });
const finding = (projectSlug: string, colour: Finding["colour"], message = "m", kind: Finding["kind"] = "pin", subject = "pkg"): Finding => ({ projectSlug, environment: "development", kind, subject, colour, message });

const reg: Registry = {
  projects: [
    proj("caas", { kind: "spoke", client: "konnect", ownerProject: "caas" }), proj("ops", { client: "konnect", ownerProject: "caas" }), proj("partner", { client: "konnect" }),
    proj("boss", { kind: "boss", ownerProject: "boss" }), proj("old", { lifecycle: "retired" }),
  ],
  environments: [], pins: [], adoption: [],
  assignments: [{ id: "1", projectSlug: "boss", assignee: "gene@tin.info", role: "owner", assignedBy: "x", assignedAt: new Date() }, { id: "2", projectSlug: "ops", assignee: "mary@tin.info", role: "maintainer", assignedBy: "x", assignedAt: new Date() }],
  relations: [{ fromSlug: "caas", toSlug: "ops", relation: "has_part" }, { fromSlug: "caas", toSlug: "partner", relation: "has_part" }, { fromSlug: "boss", toSlug: "caas", relation: "depends_on" }],
};
const findings = [finding("ops", "red", "behind a major"), finding("ops", "amber"), finding("partner", "amber"), finding("boss", "green"), finding("caas", "green")];
const rows = summarise(reg, findings);
const row = (slug: string) => rows.find((r) => r.slug === slug)!;

describe("summarise", () => {
  it("rolls findings up to a colour, counts and the worst finding", () => {
    expect(row("ops")).toMatchObject({ colour: "red", red: 1, amber: 1 });
    expect(row("ops").topFinding?.message).toBe("behind a major");
    expect(row("partner")).toMatchObject({ colour: "amber", red: 0, amber: 1 });
    expect(row("boss")).toMatchObject({ colour: "green", topFinding: null });
  });
  it("retired projects have no status", () => expect(row("old").colour).toBeNull());
  it("carries the owning project and its name", () => {
    expect(row("ops")).toMatchObject({ ownerProject: "caas", ownerName: "CAAS" });
    expect(row("partner")).toMatchObject({ ownerProject: null, ownerName: null });
  });
  it("takes owners from owner assignments only, and the parent from 'has_part' relations", () => {
    expect(row("boss").owners).toEqual(["gene@tin.info"]);
    expect(row("ops").owners).toEqual([]); // a maintainer is not an owner
    expect(row("ops").parent).toBe("caas");
    expect(row("caas").parent).toBeNull(); // 'depends_on' does not nest
  });
});

describe("parseProjectFilters", () => {
  it("defaults to severity, worst first", () => expect(parseProjectFilters({})).toMatchObject({ sort: "severity", dir: "desc", q: "" }));
  it("ignores values it does not recognise", () => {
    const f = parseProjectFilters({ kind: "wizard", status: "purple", sort: "drop table", dir: "sideways", lifecycle: "dead" });
    expect(f).toMatchObject({ kind: "", status: "", sort: "severity", dir: "desc", lifecycle: "" });
  });
  it("reads valid values, using the first of a repeated parameter", () => {
    expect(parseProjectFilters({ kind: ["hub", "app"], status: "red", sort: "name" })).toMatchObject({ kind: "hub", status: "red", sort: "name", dir: "asc" });
  });
  it("only the default, unfiltered view is nested", () => {
    expect(isNestedView(parseProjectFilters({}))).toBe(true);
    expect(isNestedView(parseProjectFilters({ q: "x" }))).toBe(false);
    expect(isNestedView(parseProjectFilters({ sort: "name" }))).toBe(false);
  });
});

describe("applyProjectFilters", () => {
  const names = (f: Record<string, string>) => applyProjectFilters(rows, parseProjectFilters(f)).map((r) => r.slug).sort();
  it("filters by status, kind, client and lifecycle", () => {
    expect(names({ status: "red" })).toEqual(["ops"]);
    expect(names({ status: "amber" })).toEqual(["partner"]);
    expect(names({ kind: "boss" })).toEqual(["boss"]);
    expect(names({ client: "konnect" })).toEqual(["caas", "ops", "partner"]);
    expect(names({ client: "none" })).toEqual(["boss", "old"]);
    expect(names({ lifecycle: "retired" })).toEqual(["old"]);
  });
  it("filters by owner, including 'none'", () => {
    expect(names({ owner: "gene@tin.info" })).toEqual(["boss"]);
    expect(names({ owner: "none" })).toEqual(["old", "partner"]); // owned by neither a project nor a person
    expect(names({ owner: "p:caas" })).toEqual(["caas", "ops"]);
    expect(names({ owner: "p:boss" })).toEqual(["boss"]);
  });
  it("searches name, slug, client and owner, ignoring case", () => {
    expect(names({ q: "KONNECT" })).toEqual(["caas", "ops", "partner"]);
    expect(names({ q: "gene" })).toEqual(["boss"]);
    expect(names({ q: "caas" })).toEqual(["caas", "ops"]); // matches the owning project's name too
    expect(names({ q: "zzz" })).toEqual([]);
  });
  it("combines filters", () => expect(names({ client: "konnect", status: "amber" })).toEqual(["partner"]));
});

describe("sortProjectRows and nest", () => {
  it("severity puts failing projects first, then by name", () => {
    expect(sortProjectRows(rows, "severity", "desc").map((r) => r.slug)).toEqual(["ops", "partner", "boss", "caas", "old"]);
  });
  it("sorts by a column in either direction", () => {
    expect(sortProjectRows(rows, "name", "asc")[0].slug).toBe("boss");
    expect(sortProjectRows(rows, "name", "desc")[0].slug).toBe("partner");
  });
  it("puts hosted projects under their parent (groups ordered by their worst member), only when the parent is listed", () => {
    const tree = nest(sortProjectRows(rows, "severity", "desc"));
    expect(tree.map((t) => `${t.depth}:${t.row.slug}`)).toEqual(["0:caas", "1:ops", "1:partner", "0:boss", "0:old"]);
    expect(tree.find((t) => t.row.slug === "caas")!.childCount).toBe(2);
    expect(tree.find((t) => t.row.slug === "caas")).toMatchObject({ childRed: 1, childAmber: 1 });
    const orphans = nest(rows.filter((r) => r.slug === "ops"));
    expect(orphans).toEqual([{ row: row("ops"), depth: 0, childCount: 0, childRed: 0, childAmber: 0 }]);
  });
});

describe("projectCounts", () => {
  it("counts live projects by status and without an owner; retired are excluded", () => {
    expect(projectCounts(rows)).toEqual({ total: 5, red: 1, amber: 1, green: 2, noOwner: 1 });
  });
});

describe("drift filters", () => {
  it("parses and defaults", () => {
    expect(parseDriftFilters({})).toEqual({ view: "project", q: "", status: "", kind: "" });
    expect(parseDriftFilters({ view: "package", status: "red", kind: "cell" })).toMatchObject({ view: "package", status: "red", kind: "cell" });
    expect(parseDriftFilters({ view: "x", status: "y", kind: "z" })).toEqual({ view: "project", q: "", status: "", kind: "" });
  });
  it("hides green by default, shows everything on 'all', and filters by colour, kind and text", () => {
    const f = (o: Record<string, string>) => filterFindings(findings, parseDriftFilters(o)).length;
    expect(f({})).toBe(3);
    expect(f({ status: "all" })).toBe(5);
    expect(f({ status: "red" })).toBe(1);
    expect(f({ q: "partner" })).toBe(1);
    expect(f({ kind: "cell" })).toBe(0);
  });
});

const snap = (pkg: string, latest: string | null, next: string | null = null): PackageSnapshot => ({ runId: "1", package: pkg, repo: "r", branchVersion: null, latest, next, divergence: "OK", dependents: null });

describe("packageMatrix", () => {
  const withPins: Registry = {
    ...reg,
    environments: [],
    pins: [
      { projectSlug: "ops", environment: "development", package: "@t/support", version: "5.1.0" },
      { projectSlug: "partner", environment: "development", package: "@t/support", version: "5.1.0" },
      { projectSlug: "boss", environment: "development", package: "@t/support", version: "6.0.0" },
      { projectSlug: "ops", environment: "development", package: "@t/ui", version: "1.2.0" },
      { projectSlug: "old", environment: "development", package: "@t/ui", version: "0.0.1" },
    ],
  };
  const matrix = packageMatrix(withPins, [snap("@t/support", "6.0.0"), snap("@t/ui", "1.2.0")]);

  it("groups every declared version of a package with the projects on it, worst package first", () => {
    expect(matrix.map((m) => m.package)).toEqual(["@t/support", "@t/ui"]);
    const support = matrix[0];
    expect(support).toMatchObject({ worst: "red", latest: "6.0.0", behind: 2 });
    expect(support.groups.map((g) => [g.version, g.colour, g.projects.map((p) => p.slug)])).toEqual([["5.1.0", "red", ["ops", "partner"]], ["6.0.0", "green", ["boss"]]]);
  });
  it("skips retired projects", () => expect(matrix[1].groups.map((g) => g.version)).toEqual(["1.2.0"]));
  it("a package the collector has not seen is amber, not green", () => {
    expect(packageMatrix(withPins, null)[0].worst).toBe("amber");
  });
  it("hides all-green packages by default and shows them with 'all'", () => {
    expect(filterPackageRows(matrix, parseDriftFilters({})).map((m) => m.package)).toEqual(["@t/support"]);
    expect(filterPackageRows(matrix, parseDriftFilters({ status: "all" })).length).toBe(2);
    expect(filterPackageRows(matrix, parseDriftFilters({ status: "all", q: "partner" })).map((m) => m.package)).toEqual(["@t/support"]);
  });
});
