import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
const MIGRATIONS = ["001_status.sql", "002_authority.sql", "003_owner_project.sql", "004_project_path_agent_runs.sql", "005_catalog_shape.sql", "006_tenants.sql", "008_tenant_admin.sql", "011_tenant_settings.sql"];
let db: PGlite;
let tin: string;
let botski: string;
let acme: string;

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
const owner = async <T = any>(sql: string) => (await db.query<T>(sql)).rows;

const SET = "select set_tenant_settings($1, $2, $3, $4, $5)";

beforeAll(async () => {
  db = new PGlite();
  for (const f of MIGRATIONS) await db.exec(read(f));
  await db.exec("insert into tenants (slug,name) values ('botski','Botski'),('acme','Acme')");
  tin = (await owner<{ id: string }>("select id from tenants where slug='tin'"))[0].id;
  botski = (await owner<{ id: string }>("select id from tenants where slug='botski'"))[0].id;
  acme = (await owner<{ id: string }>("select id from tenants where slug='acme'"))[0].id;
  await db.exec(read("012_platform_tenant_settings.sql"));
  await db.exec(read("012_platform_tenant_settings.sql")); // idempotent
}, 60_000);

describe("012_platform_tenant_settings", () => {
  it("the platform tenant's admin sets another tenant's settings, and the tenant sees them", async () => {
    await admin(tin, SET, ["botski", "Botski Ops", "#0a84ff", "/images/logo/botski.svg", ["projects", "drift"]]);
    expect(await reader(botski, "select brand_name, accent, logo_path, modules, updated_by from tenant_settings")).toEqual([
      { brand_name: "Botski Ops", accent: "#0a84ff", logo_path: "/images/logo/botski.svg", modules: ["projects", "drift"], updated_by: "gene@tin.info" },
    ]);
    expect(await reader(tin, "select * from get_tenant_settings('botski')")).toHaveLength(1);
  });
  it("the change is audited twice: in the target tenant by the row trigger, and in the platform tenant by the function", async () => {
    expect(await reader(botski, "select actor, action from registry_audit where table_name = 'tenant_settings'")).toEqual([{ actor: "gene@tin.info", action: "INSERT" }]);
    const platform = await reader(tin, "select actor, action, before->>'slug' as slug from registry_audit where table_name = 'tenant_settings'");
    expect(platform).toEqual([{ actor: "gene@tin.info", action: "SET_FOR_TENANT", slug: "botski" }]);
  });
  it("a second set replaces the row in place and is audited as an update", async () => {
    await admin(tin, SET, ["botski", "Botski", null, null, null]);
    expect(await reader(botski, "select brand_name, accent, modules from tenant_settings")).toEqual([{ brand_name: "Botski", accent: null, modules: null }]);
    expect((await reader(botski, "select action from registry_audit where table_name = 'tenant_settings' order by id")).map((r) => r.action)).toEqual(["INSERT", "UPDATE"]);
  });
  it("another tenant cannot read or set a tenant's settings, and cannot reach the function as the reader", async () => {
    await expect(admin(botski, SET, ["acme", "Hijack", null, null, null])).rejects.toThrow(/only the platform tenant/i);
    await expect(admin(botski, "select * from get_tenant_settings('acme')")).rejects.toThrow(/only the platform tenant/i);
    await expect(reader(tin, SET, ["acme", "x", null, null, null])).rejects.toThrow(/permission denied/i);
    expect(await owner("select * from tenant_settings where tenant_id = '" + acme + "'")).toEqual([]);
  });
  it("a write without an actor, to an unknown tenant or to a retired tenant, is refused", async () => {
    await expect(admin(tin, SET, ["acme", "x", null, null, null], null)).rejects.toThrow(/console\.actor is not set/i);
    await expect(admin(tin, SET, ["nope", "x", null, null, null])).rejects.toThrow(/no active tenant/i);
    await admin(tin, "select retire_tenant('acme')");
    await expect(admin(tin, SET, ["acme", "x", null, null, null])).rejects.toThrow(/no active tenant/i);
  });
  it("the table's checks still decide the values", async () => {
    for (const args of [["botski", "x", "red", null, null], ["botski", "x", null, "https://evil.example/x.svg", null], ["botski", "x".repeat(41), null, null, null], ["botski", "x", null, null, ["Bad Module"]]]) {
      await expect(admin(tin, SET, args), JSON.stringify(args)).rejects.toThrow(/check/i);
    }
  });
  it("the platform tenant can set its own settings, adding a single audit row (the trigger's, not a second one)", async () => {
    const count = async () => (await reader<{ n: number }>(tin, "select count(*)::int as n from registry_audit where table_name = 'tenant_settings'"))[0].n;
    const before = await count();
    await admin(tin, SET, ["tin", "TIN", null, null, null]);
    expect(await count()).toBe(before + 1);
    expect((await reader(tin, "select action from registry_audit where table_name = 'tenant_settings' order by id desc limit 1"))[0].action).toBe("INSERT");
  });
  it("with no tenant set nothing is readable", async () => {
    await expect(reader(null, "select * from get_tenant_settings('botski')")).rejects.toThrow(/only the platform tenant/i);
  });
});
