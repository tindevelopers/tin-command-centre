import { describe, expect, it } from "vitest";
import { fileName, locationEntity, toCatalogEntities, toYaml } from "./catalog";
import type { Group, Project, Registry } from "./types";

const project = (over: Partial<Project> & { slug: string; kind: Project["kind"] }): Project => ({
  name: over.slug, client: null, repo: null, lifecycle: "active", notes: null, ownerProject: null, path: null, ownerGroup: null, tier: null, annotations: {}, ...over,
});
const groups: Group[] = [
  { slug: "tin", name: "TIN", parent: null },
  { slug: "tin-platform", name: "TIN platform", parent: "tin" },
];
const registry = (over: Partial<Registry> = {}): Registry => ({
  projects: [
    project({ slug: "shared-api-hub", kind: "hub", ownerGroup: "tin-platform", tier: "capability", repo: "tindevelopers/shared-api-hub" }),
    project({ slug: "api-credentials", kind: "package", ownerProject: "shared-api-hub" }),
    project({ slug: "tin-boss-api", kind: "boss", ownerGroup: "tin-platform", annotations: { "backstage.io/techdocs-ref": "dir:." } }),
    project({ slug: "konnect-ops", kind: "app", client: "konnect" }),
  ],
  environments: [{ projectSlug: "tin-boss-api", name: "development", cell: "konnect-dev", region: null, url: null }, { projectSlug: "tin-boss-api", name: "ci", cell: null, region: null, url: null }],
  pins: [], adoption: [],
  assignments: [{ id: "1", projectSlug: "konnect-ops", assignee: "Gene.Foo@tin.info", role: "owner", assignedBy: "x", assignedAt: new Date(0) }],
  relations: [
    { fromSlug: "konnect-ops", toSlug: "tin-boss-api", relation: "consumes_api" },
    { fromSlug: "api-credentials", toSlug: "shared-api-hub", relation: "depends_on" },
  ],
  ...over,
});
const find = (r: ReturnType<typeof toCatalogEntities>, kind: string, name: string) => r.entities.find((e) => e.kind === kind && e.metadata.name === name)!;

describe("toCatalogEntities", () => {
  const out = toCatalogEntities(registry(), groups);

  it("maps hubs to Systems and packages to library Components inside their owning System", () => {
    expect(find(out, "System", "shared-api-hub").spec).toMatchObject({ owner: "group:default/tin-platform", lifecycle: "production", domain: "capability" });
    expect(find(out, "Component", "api-credentials").spec).toMatchObject({ type: "library", system: "shared-api-hub" });
  });

  it("maps boss to a service, app to a website, and keeps the repo and annotations", () => {
    const boss = find(out, "Component", "tin-boss-api");
    expect(boss.spec.type).toBe("service");
    expect(boss.metadata.annotations).toMatchObject({ "backstage.io/techdocs-ref": "dir:.", "tin.info/environments": "development,ci" });
    expect(find(out, "Component", "konnect-ops").spec.type).toBe("website");
    expect(find(out, "System", "shared-api-hub").metadata.annotations?.["github.com/project-slug"]).toBe("tindevelopers/shared-api-hub");
  });

  it("owner falls back from group, to owning project's group, to the owner person, to an explicit unowned group", () => {
    expect(find(out, "Component", "api-credentials").spec.owner).toBe("group:default/tin-platform");
    expect(find(out, "Component", "konnect-ops").spec.owner).toBe("user:default/gene.foo");
    expect(find(out, "User", "gene.foo")).toBeDefined();
    const orphan = toCatalogEntities(registry({ projects: [project({ slug: "lonely", kind: "app" })], relations: [], environments: [], assignments: [] }), []);
    expect(find(orphan, "Component", "lonely").spec.owner).toBe("group:default/unowned");
    expect(find(orphan, "Group", "unowned")).toBeDefined();
    expect(orphan.warnings[0]).toMatch(/lonely: no owner/);
  });

  it("exports relations without dangling references", () => {
    expect(find(out, "Component", "konnect-ops").spec.dependsOn).toEqual(["component:default/tin-boss-api"]);
    expect(find(out, "Component", "api-credentials").spec.dependsOn).toEqual(["system:default/shared-api-hub"]);
  });

  it("gives every Group its required children, and one Domain per tier a System uses", () => {
    expect(find(out, "Group", "tin").spec).toEqual({ type: "team", children: ["tin-platform"] });
    expect(find(out, "Group", "tin-platform").spec).toEqual({ type: "team", parent: "tin", children: [] });
    expect(find(out, "Domain", "capability")).toBeDefined();
  });

  it("skips and reports a slug Backstage would reject, and is deterministic", () => {
    const long = toCatalogEntities(registry({ projects: [project({ slug: "a".repeat(64), kind: "app" })], relations: [], environments: [], assignments: [] }), []);
    expect(long.entities.filter((e) => e.kind === "Component")).toEqual([]);
    expect(long.warnings[0]).toMatch(/not a valid Backstage name/);
    expect(toCatalogEntities(registry(), groups)).toEqual(out);
  });
});

describe("YAML and Location", () => {
  const { entities } = toCatalogEntities(registry(), groups);
  it("lists every entity file in one Location", () => {
    const loc = locationEntity(entities);
    expect(loc.spec.targets).toEqual(entities.map((e) => `./${fileName(e)}`));
  });
  it("writes quoted, indented YAML", () => {
    const yaml = toYaml(find({ entities, warnings: [] }, "Component", "api-credentials"));
    expect(yaml).toContain('apiVersion: "backstage.io/v1alpha1"');
    expect(yaml).toContain('  "dependsOn":\n    - "system:default/shared-api-hub"');
    expect(yaml.endsWith("\n")).toBe(true);
  });
});
