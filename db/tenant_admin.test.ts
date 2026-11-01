import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
const MIGRATIONS = ["001_status.sql", "002_authority.sql", "003_owner_project.sql", "004_project_path_agent_runs.sql", "005_catalog_shape.sql", "006_tenants.sql"];
let db: PGlite;
let tin: string;
let botski: string;

/** Runs `sql` as `role` in one transaction scoped to `tenant` (null = no tenant set), with or without an audited actor, the way src/tenancy/db.ts does. */
async function inTenant<T>(role: "console_reader" | "console_admin", tenant: string | null, sql: string, params: unknown[] = [], actor: string | null = "gene@tin.info"): Promise<T[]> {
  await db.exec(`SET ROLE ${role}`);
  try {
    await db.exec("BEGIN");
    if (tenant) await db.query("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
    if (actor) await db.query("SELECT set_config('console.actor', $1, true)", [actor]);
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
const admin = <T = any>(tenant: string | null, sql: string, params?: unknown[], actor?: string | null) => inTenant<T>("console_admin", tenant, sql, params, actor);
const reader = <T = any>(tenant: string | null, sql: string, params?: unknown[]) => inTenant<T>("console_reader", tenant, sql, params);
const owner = async <T = any>(sql: string, params?: unknown[]) => (await db.query<T>(sql, params)).rows;

beforeAll(async () => {
  db = new PGlite();
  for (const f of MIGRATIONS) await db.exec(read(f));
  tin = (await owner<{ id: string }>("select id from tenants where slug='tin'"))[0].id;
  await db.exec("insert into tenants (slug,name) values ('botski','Botski')");
  botski = (await owner<{ id: string }>("select id from tenants where slug='botski'"))[0].id;
  await db.exec(`select set_config('console.actor','seed',false);
    insert into projects (tenant_id,slug,name,kind) values ('${tin}','boss','BOSS','boss'),('${tin}','old','Old','app'),('${botski}','bot','Bot','app');
    update projects set lifecycle = 'retired' where slug = 'old';
    insert into console_operators (tenant_id,user_id,email,role,added_by) values ('${tin}','u1','gene@tin.info','admin','seed'),('${botski}','u2','b@botski.io','viewer','seed');
    select set_config('console.actor','',false);`);
  await db.exec(read("008_tenant_admin.sql"));
  await db.exec(read("008_tenant_admin.sql")); // idempotent
}, 60_000);

describe("008_tenant_admin: the platform tenant", () => {
  it("marks tin as the platform tenant, exactly once", async () => {
    expect(await owner("select slug from tenants where platform order by slug")).toEqual([{ slug: "tin" }]);
    await expect(db.query("update tenants set platform = true where slug = 'botski'")).rejects.toThrow(/unique|duplicate/i);
  });
  it("adds 'control' to the reserved slugs", async () => {
    await expect(db.query("insert into tenants (slug,name) values ('control','x')")).rejects.toThrow(/check/i);
  });
  it("the app roles still cannot read tenants directly", async () => {
    await expect(reader(tin, "select * from tenants")).rejects.toThrow(/permission denied/i);
  });
});

describe("list_tenants", () => {
  it("from the platform tenant lists every tenant with live project and active operator counts, platform first", async () => {
    const rows = await reader(tin, "select slug, platform, projects, operators from list_tenants()");
    expect(rows).toEqual([
      { slug: "tin", platform: true, projects: 1, operators: 1 },
      { slug: "botski", platform: false, projects: 1, operators: 1 },
    ]);
  });
  it("from another tenant lists only that tenant", async () => {
    expect((await reader(botski, "select slug from list_tenants()")).map((r) => r.slug)).toEqual(["botski"]);
  });
  it("with no tenant set lists nothing", async () => {
    expect(await reader(null, "select slug from list_tenants()")).toEqual([]);
  });
});

describe("create_tenant and retire_tenant", () => {
  it("the platform tenant's admin creates a tenant and the audit row lands in the platform tenant", async () => {
    const [{ id }] = await admin<{ id: string }>(tin, "select create_tenant('acme','Acme') as id");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await reader(null, "select resolve_tenant('acme') as id"))[0].id).toBe(id);
    const audit = await reader(tin, "select actor, action, after->>'slug' as slug from registry_audit where table_name = 'tenants'");
    expect(audit).toEqual([{ actor: "gene@tin.info", action: "INSERT", slug: "acme" }]);
  });
  it("a dedicated tenant needs the name of its connection secret", async () => {
    await expect(admin(tin, "select create_tenant('ent','Ent','dedicated')")).rejects.toThrow(/check/i);
    await admin(tin, "select create_tenant('ent','Ent','dedicated','TENANT_ENT_DATABASE_URL')");
    expect((await reader(tin, "select isolation, connection_ref from list_tenants() where slug = 'ent'"))[0]).toEqual({ isolation: "dedicated", connection_ref: "TENANT_ENT_DATABASE_URL" });
  });
  it("another tenant's admin cannot create or retire tenants", async () => {
    await expect(admin(botski, "select create_tenant('sneaky','S')")).rejects.toThrow(/only the platform tenant/i);
    await expect(admin(botski, "select retire_tenant('acme')")).rejects.toThrow(/only the platform tenant/i);
  });
  it("a write without an actor is refused", async () => {
    await expect(admin(tin, "select create_tenant('noactor','N')", [], null)).rejects.toThrow(/console\.actor is not set/i);
  });
  it("the reader role cannot create tenants", async () => {
    await expect(reader(tin, "select create_tenant('r','R')")).rejects.toThrow(/permission denied/i);
  });
  it("reserved and malformed slugs are refused through the function too", async () => {
    for (const slug of ["control", "api", "Bad", "a b"]) {
      await expect(admin(tin, "select create_tenant($1,'x')", [slug])).rejects.toThrow(/check/i);
    }
  });
  it("retiring is audited and makes the tenant unresolvable; retiring twice changes nothing", async () => {
    await admin(tin, "select retire_tenant('acme')");
    expect((await reader(null, "select resolve_tenant('acme') as id"))[0].id).toBeNull();
    const n = async () => (await reader<{ n: number }>(tin, "select count(*)::int as n from registry_audit where table_name = 'tenants' and action = 'UPDATE'"))[0].n;
    expect(await n()).toBe(1);
    await admin(tin, "select retire_tenant('acme')");
    expect(await n()).toBe(1);
    expect((await reader(tin, "select slug, retired_at is not null as retired from list_tenants() where slug = 'acme'"))[0]).toEqual({ slug: "acme", retired: true });
  });
  it("the platform tenant and unknown tenants cannot be retired", async () => {
    await expect(admin(tin, "select retire_tenant('tin')")).rejects.toThrow(/platform tenant cannot be retired/i);
    await expect(admin(tin, "select retire_tenant('nope')")).rejects.toThrow(/no tenant named/i);
  });
});
