import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
const MIGRATIONS = [
  "001_status.sql", "002_authority.sql", "003_owner_project.sql", "004_project_path_agent_runs.sql", "005_catalog_shape.sql",
  "006_tenants.sql", "007_drop_boss_adoption.sql", "008_tenant_admin.sql", "009_pin_proposals.sql", "010_agent_ledger.sql",
  "011_tenant_settings.sql", "012_platform_tenant_settings.sql",
];

async function migrated() {
  const db = new PGlite();
  for (const f of MIGRATIONS) await db.exec(read(f));
  return db;
}
const count = async (db: PGlite, sql: string) => (await db.query<{ n: number }>(sql)).rows[0].n;

describe("media platforms seed draft", () => {
  it("applies twice on the current schema, in tenant tin, audited, with no environments or pins", async () => {
    const db = await migrated();
    const seed = read("seed/004_media_platforms.draft.sql");
    await db.exec(seed);
    await db.exec(seed); // idempotent
    expect(await count(db, "select count(*)::int n from projects")).toBe(4);
    expect(await count(db, "select count(*)::int n from groups")).toBe(3);
    expect(await count(db, "select count(*)::int n from environments")).toBe(0);
    expect(await count(db, "select count(*)::int n from declared_pins")).toBe(0);
    expect(await count(db, "select count(*)::int n from project_relations")).toBe(0); // no hub registered in this database
    expect(await count(db, "select count(*)::int n from projects where tenant_id <> (select id from tenants where slug = 'tin')")).toBe(0);
    expect(await count(db, "select count(*)::int n from registry_audit where actor = 'developer@tin.info'")).toBe(7); // 4 projects + 3 groups
    const rows = await db.query<{ slug: string; kind: string; client: string | null; owner_group: string | null }>(
      "select slug, kind, client, owner_group from projects order by slug");
    expect(rows.rows).toEqual([
      { slug: "lifescape-platform-v1", kind: "spoke", client: "lifescape", owner_group: "lifescape" },
      { slug: "lockd-platform-v1-workos", kind: "spoke", client: "lockd", owner_group: "lockd" },
      { slug: "notarized-platform-v1", kind: "spoke", client: "notarized", owner_group: "notarized" },
      { slug: "shared-asset-hub", kind: "hub", client: null, owner_group: null },
    ]);
  }, 60_000);

  it("links the hubs the platforms depend on when they are registered, and never the asset hub", async () => {
    const db = await migrated();
    await db.exec(`begin;
      select set_config('console.actor','seed',true);
      select set_config('app.tenant_id',(select id::text from tenants where slug='tin'),true);
      insert into projects (slug,name,kind) values ('tin-boss-api','BOSS','boss'),('chassis','Ch','hub'),
        ('shared-identity-hub','I','hub'),('shared-client-care-hub','C','hub');
      commit;`);
    await db.exec(read("seed/004_media_platforms.draft.sql"));
    expect(await count(db, "select count(*)::int n from project_relations")).toBe(3);
    expect(await count(db, "select count(*)::int n from project_relations where to_slug = 'shared-asset-hub'")).toBe(0);
    expect(await count(db, "select count(*)::int n from projects where slug = 'shared-asset-hub' and owner_project = 'tin-boss-api'")).toBe(1);
  }, 60_000);
});
