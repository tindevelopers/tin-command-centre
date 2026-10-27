import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
const MIGRATIONS = ["001_status.sql", "002_authority.sql", "003_owner_project.sql", "004_project_path_agent_runs.sql", "005_catalog_shape.sql", "006_tenants.sql", "007_drop_boss_adoption.sql"];

async function migrated() {
  const db = new PGlite();
  for (const f of MIGRATIONS) await db.exec(read(f));
  return db;
}
const count = async (db: PGlite, sql: string) => (await db.query<{ n: number }>(sql)).rows[0].n;

describe("pawpointers seed draft", () => {
  it("applies twice on the post-007 schema, all in tenant tin, audited, skipping hubs that are not registered", async () => {
    const db = await migrated();
    const seed = read("seed/003_pawpointers.draft.sql");
    await db.exec(seed);
    await db.exec(seed); // idempotent
    const tables = { projects: 4, environments: 3, declared_pins: 3, project_relations: 3 };
    for (const [t, n] of Object.entries(tables)) expect(await count(db, `select count(*)::int n from ${t}`), t).toBe(n);
    expect(await count(db, "select count(*)::int n from projects where tenant_id <> (select id from tenants where slug = 'tin')")).toBe(0);
    expect(await count(db, "select count(*)::int n from environments where name not in ('development','staging','production')")).toBe(0);
    expect(await count(db, "select count(*)::int n from registry_audit where actor = 'developer@tin.info'")).toBe(14); // 13 rows + the group
    // Owned like Konnect: the monorepo owns itself and its apps; only the root has the group.
    const owners = await db.query<{ slug: string; owner_project: string; owner_group: string | null }>(
      "select slug, owner_project, owner_group from projects order by slug");
    expect(owners.rows.every((r) => r.owner_project === "pawpointers-listing-paas")).toBe(true);
    expect(owners.rows.filter((r) => r.owner_group).map((r) => [r.slug, r.owner_group])).toEqual([["pawpointers-listing-paas", "pawpointers"]]);
  }, 60_000);

  it("links the hubs and BOSS when they are already registered", async () => {
    const db = await migrated();
    await db.exec(`begin;
      select set_config('console.actor','seed',true);
      select set_config('app.tenant_id',(select id::text from tenants where slug='tin'),true);
      insert into projects (slug,name,kind) values ('tin-boss-api','BOSS','boss'),('shared-identity-hub','I','hub'),
        ('shared-client-care-hub','C','hub'),('shared-integration-hub','G','hub');
      commit;`);
    await db.exec(read("seed/003_pawpointers.draft.sql"));
    expect(await count(db, "select count(*)::int n from project_relations")).toBe(7);
  }, 60_000);
});
