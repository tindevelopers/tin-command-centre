import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
const MIGRATIONS = ["001_status.sql", "002_authority.sql", "003_owner_project.sql", "004_project_path_agent_runs.sql", "005_catalog_shape.sql"];
let db: PGlite;
let tin: string;
let botski: string;
let auditBefore: number;

/** Runs `sql` as `role` in one transaction scoped to `tenant` (null = no tenant set), the way src/tenancy/db.ts does. */
async function inTenant<T>(role: "console_reader" | "console_admin", tenant: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`SET ROLE ${role}`);
  try {
    await db.exec("BEGIN");
    if (tenant) await db.query("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
    await db.query("SELECT set_config('console.actor', 'gene@tin.info', true)");
    const r = await db.query<T>(sql, params);
    await db.exec("COMMIT");
    return r.rows;
  } catch (e) {
    await db.exec("ROLLBACK");
    throw e;
  } finally {
    await db.exec("RESET ROLE");
  }
}
const admin = <T = any>(tenant: string | null, sql: string, params?: unknown[]) => inTenant<T>("console_admin", tenant, sql, params);
const reader = <T = any>(tenant: string | null, sql: string, params?: unknown[]) => inTenant<T>("console_reader", tenant, sql, params);
const owner = async <T = any>(sql: string) => (await db.query<T>(sql)).rows;

beforeAll(async () => {
  db = new PGlite();
  for (const f of MIGRATIONS) await db.exec(read(f));
  // Data written before tenancy exists, as the live database has today.
  await db.exec(`select set_config('console.actor','seed',false);
    insert into projects (slug,name,kind) values ('boss','BOSS','boss'),('ops','Ops','app');
    insert into environments (project_slug,name) values ('ops','production');
    insert into declared_pins values ('ops','production','@tindevelopers/ui-shell','1.2.0');
    insert into project_relations values ('ops','boss','depends_on');
    insert into console_operators (user_id,email,role,added_by) values ('u1','gene@tin.info','admin','seed');
    select set_config('console.actor','',false);`);
  auditBefore = (await owner<{ n: number }>("select count(*)::int as n from registry_audit"))[0].n;
  await db.exec(read("006_tenants.sql"));
  await db.exec(read("006_tenants.sql")); // idempotent
  tin = (await owner<{ id: string }>("select id from tenants where slug='tin'"))[0].id;
  await db.exec("insert into tenants (slug,name) values ('botski','Botski')");
  botski = (await owner<{ id: string }>("select id from tenants where slug='botski'"))[0].id;
}, 60_000);

describe("006_tenants: existing data", () => {
  it("every existing row now belongs to the tin tenant", async () => {
    for (const t of ["projects", "environments", "declared_pins", "project_relations", "console_operators"]) {
      expect(await owner(`select distinct tenant_id from ${t}`)).toEqual([{ tenant_id: tin }]);
    }
  });
  it("did not write audit rows for the backfill", async () => {
    expect(auditBefore).toBeGreaterThan(0);
    expect((await owner<{ n: number }>("select count(*)::int as n from registry_audit where tenant_id = (select id from tenants where slug = 'tin')"))[0].n).toBe(auditBefore);
    expect((await owner<{ n: number }>("select count(*)::int as n from registry_audit"))[0].n).toBe(auditBefore);
  });
  it("the reader sees them inside tin", async () => {
    expect((await reader(tin, "select slug from projects order by slug")).map((r) => r.slug)).toEqual(["boss", "ops"]);
  });
});

describe("isolation", () => {
  it("fails closed with no tenant set: nothing is readable and nothing can be written", async () => {
    expect(await reader(null, "select * from projects")).toEqual([]);
    expect(await reader(null, "select * from console_operators")).toEqual([]);
    await expect(admin(null, "insert into projects (slug,name,kind) values ('x','X','app')")).rejects.toThrow(/null value|row-level security/i);
  });

  it("a tenant sees none of another tenant's rows, in any table", async () => {
    for (const t of ["projects", "environments", "declared_pins", "project_relations", "console_operators", "registry_audit"]) {
      expect(await reader(botski, `select * from ${t}`)).toEqual([]);
    }
  });

  it("the same slug can exist in two tenants, with different contents", async () => {
    await admin(botski, "insert into projects (slug,name,kind) values ('ops','Botski Ops','app')");
    expect((await reader(botski, "select name from projects")).map((r) => r.name)).toEqual(["Botski Ops"]);
    expect((await reader(tin, "select name from projects where slug='ops'")).map((r) => r.name)).toEqual(["Ops"]);
  });

  it("a tenant cannot change or delete another tenant's rows (zero rows match)", async () => {
    await admin(botski, "update projects set name = 'hacked' where slug = 'boss'");
    await admin(botski, "delete from declared_pins");
    expect((await reader(tin, "select name from projects where slug='boss'")).map((r) => r.name)).toEqual(["BOSS"]);
    expect((await reader(tin, "select version from declared_pins")).map((r) => r.version)).toEqual(["1.2.0"]);
  });

  it("a tenant cannot write a row into another tenant", async () => {
    await expect(admin(botski, "insert into projects (tenant_id,slug,name,kind) values ($1,'sneaky','S','app')", [tin])).rejects.toThrow(/row-level security/i);
    await expect(admin(tin, "update projects set tenant_id = $1 where slug = 'boss'", [botski])).rejects.toThrow(/row-level security/i);
  });

  it("a row cannot reference another tenant's project (composite foreign keys)", async () => {
    await expect(admin(botski, "insert into environments (project_slug,name) values ('boss','production')")).rejects.toThrow(/foreign key/i);
    await expect(admin(botski, "insert into project_relations (from_slug,to_slug,relation) values ('ops','boss','depends_on')")).rejects.toThrow(/foreign key/i);
    await expect(admin(botski, "update projects set owner_project = 'boss' where slug = 'ops'")).rejects.toThrow(/foreign key/i);
  });

  it("audit rows carry the tenant and are invisible to other tenants", async () => {
    const own = await reader(botski, "select table_name, tenant_id from registry_audit");
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((r) => r.tenant_id === botski)).toBe(true);
    expect((await reader(tin, "select count(*)::int as n from registry_audit where tenant_id = $1", [botski]))[0].n).toBe(0);
  });

  it("operators are per tenant: the same user can be a member of two", async () => {
    await admin(botski, "insert into console_operators (user_id,email,role,added_by) values ('u1','gene@tin.info','admin','gene')");
    expect((await reader(botski, "select user_id from console_operators")).length).toBe(1);
    expect((await reader(tin, "select user_id from console_operators")).length).toBe(1);
  });

  it("agent runs follow the same rules", async () => {
    await admin(tin, "insert into agent_runs (project_slug,environment,package,from_version,to_version,issue_url,requested_by) values ('ops','production','p','1','2','https://github.com/o/r/issues/1','a')");
    expect(await reader(botski, "select * from agent_runs")).toEqual([]);
    expect((await reader(tin, "select * from agent_runs")).length).toBe(1);
  });
});

describe("tenant lookup", () => {
  it("resolve_tenant gives an id for a live tenant and null for unknown or retired ones", async () => {
    expect((await reader(null, "select resolve_tenant('tin') as id"))[0].id).toBe(tin);
    expect((await reader(null, "select resolve_tenant('nope') as id"))[0].id).toBeNull();
    await db.exec("insert into tenants (slug,name,retired_at) values ('old','Old', now())");
    expect((await reader(null, "select resolve_tenant('old') as id"))[0].id).toBeNull();
  });

  it("the app roles cannot list tenants", async () => {
    await expect(reader(tin, "select * from tenants")).rejects.toThrow(/permission denied/i);
    await expect(admin(tin, "select * from tenants")).rejects.toThrow(/permission denied/i);
  });

  it("reserved and malformed slugs are refused", async () => {
    for (const slug of ["admin", "www", "api", "auth", "Bad", "-x", "x-", "a b", ""]) {
      await expect(db.query("insert into tenants (slug,name) values ($1,'x')", [slug])).rejects.toThrow(/check/i);
    }
  });

  it("a dedicated tenant must name its connection secret", async () => {
    await expect(db.query("insert into tenants (slug,name,isolation) values ('ent','Ent','dedicated')")).rejects.toThrow(/check/i);
    await db.query("insert into tenants (slug,name,isolation,connection_ref) values ('ent','Ent','dedicated','TENANT_ENT_DATABASE_URL')");
  });
});

/** Tables that describe the shared estate, not a tenant. Anything else must be tenant-scoped, or this test fails. */
const PLATFORM_TABLES = ["collector_runs", "package_snapshots", "cell_snapshots", "credential_snapshots", "tenants"];

describe("every table is accounted for", () => {
  it("each public table is either platform-level or tenant-scoped with RLS and a policy", async () => {
    const tables = await owner<{ name: string; rls: boolean; has_tenant: boolean; policies: number }>(`
      select c.relname as name, c.relrowsecurity as rls,
             exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped) as has_tenant,
             (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' order by 1`);
    const problems: string[] = [];
    for (const t of tables) {
      if (PLATFORM_TABLES.includes(t.name)) continue;
      if (!t.has_tenant) problems.push(`${t.name}: no tenant_id column (add it, or list the table as platform-level)`);
      else if (!t.rls || t.policies === 0) problems.push(`${t.name}: has tenant_id but no row-level security policy`);
    }
    expect(problems).toEqual([]);
  });
});
