import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { toCatalogEntities } from "@/src/registry/catalog";
import type { Registry } from "@/src/registry/types";

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");

describe("ownership seed draft", () => {
  it("is idempotent, audited, and leaves no project unowned in the catalog export", async () => {
    const db = new PGlite();
    await db.exec(read("001_status.sql"));
    for (const f of ["002_authority.sql", "003_owner_project.sql", "004_project_path_agent_runs.sql", "005_catalog_shape.sql"]) await db.exec(read(f));
    await db.exec(read("seed/001_projects.draft.sql"));
    // The live registry already carries the owner's owner_project chain (checked 2026-10-13); the seed must work on top of it.
    await db.exec(`select set_config('console.actor','fixture',false);
      update projects set owner_project = 'konnect-caas-base' where slug like 'konnect-%' or slug in ('shell-base-agents','shell-base-cxp','shell-base-knowledge','shell-base-meetings');
      update projects set owner_project = 'tin-boss-api' where owner_project is null;
      select set_config('console.actor','',false);`);
    const ownership = read("seed/002_ownership.draft.sql");
    await db.exec(ownership);
    const audited = async () => (await db.query<{ n: number }>("select count(*)::int n from registry_audit where actor = 'developer@tin.info'")).rows[0].n;
    const ownerProjects = async () => JSON.stringify((await db.query("select slug, owner_project from projects order by slug")).rows);
    const before = await ownerProjects();
    const afterFirst = await audited();
    await db.exec(ownership);
    expect(await audited()).toBe(afterFirst); // a second run changes nothing, so it audits nothing

    const rows = async (sql: string) => (await db.query<Record<string, any>>(sql)).rows;
    const registry: Registry = {
      projects: (await rows("select * from projects order by slug")).map((r) => ({ slug: r.slug, name: r.name, kind: r.kind, client: r.client, repo: r.repo, lifecycle: r.lifecycle, notes: r.notes, ownerProject: r.owner_project, path: r.path, ownerGroup: r.owner_group, tier: r.tier, annotations: r.annotations })),
      environments: (await rows("select * from environments")).map((r) => ({ projectSlug: r.project_slug, name: r.name, cell: r.cell, region: r.region, url: r.url })),
      pins: [], assignments: [],
      relations: (await rows("select * from project_relations")).map((r) => ({ fromSlug: r.from_slug, toSlug: r.to_slug, relation: r.relation })),
    };
    const groups = (await rows("select slug, name, parent from groups order by slug")).map((r) => ({ slug: r.slug, name: r.name, parent: r.parent }));
    const out = toCatalogEntities(registry, groups);

    expect(await ownerProjects()).toBe(before); // the seed never rewrites the owner's owner_project values
    expect(registry.projects).toHaveLength(24);
    expect(out.warnings).toEqual([]);
    const count = (kind: string) => out.entities.filter((e) => e.kind === kind).length;
    expect(count("System")).toBe(12);
    expect(count("Component")).toBe(12);
    expect(count("Group")).toBe(3);
    expect(out.entities.filter((e) => e.kind === "Domain").map((e) => e.metadata.name)).toEqual(["capability", "design", "domain", "foundation"]); // Domains come from Systems; Components keep their tier as a label
    const owner = (name: string) => out.entities.find((e) => e.kind === "Component" && e.metadata.name === name)!.spec.owner;
    expect(owner("konnect-ops")).toBe("group:default/konnect"); // inherited from konnect-caas-base
    expect(out.entities.find((e) => e.kind === "System" && e.metadata.name === "shell-base-cxp")!.spec.owner).toBe("group:default/konnect"); // built for Konnect
    expect(out.entities.find((e) => e.kind === "System" && e.metadata.name === "shared-api-hub")!.spec.owner).toBe("group:default/tin-platform");
    expect(owner("tin-boss-api")).toBe("group:default/tin-platform");
    expect(owner("tin-ops-console")).toBe("group:default/tin-platform");
  }, 60_000);
});
