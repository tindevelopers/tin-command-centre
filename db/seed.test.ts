import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");

describe("registry seed draft", () => {
  it("applies cleanly twice on the real schema and audits every row", async () => {
    const db = new PGlite();
    await db.exec(read("001_status.sql"));
    for (const f of ["002_authority.sql", "003_owner_project.sql", "004_project_path_agent_runs.sql", "005_catalog_shape.sql"]) await db.exec(read(f));
    const seed = read("seed/001_projects.draft.sql");
    await db.exec(seed);
    const count = async (t: string) => (await db.query<{ n: number }>(`select count(*)::int n from ${t}`)).rows[0].n;
    const first = { projects: await count("projects"), pins: await count("declared_pins"), relations: await count("project_relations") };
    await db.exec(seed); // idempotent
    expect({ projects: await count("projects"), pins: await count("declared_pins"), relations: await count("project_relations") }).toEqual(first);
    expect(first.projects).toBe(24);
    const audited = (await db.query<{ n: number }>("select count(*)::int n from registry_audit where actor = 'developer@tin.info'")).rows[0].n;
    expect(audited).toBe(first.projects + (await count("environments")) + first.pins + (await count("boss_adoption")) + first.relations);
  }, 60_000);
});
