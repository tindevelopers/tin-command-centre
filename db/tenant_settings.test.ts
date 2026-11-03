import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
const MIGRATIONS = ["001_status.sql", "002_authority.sql", "003_owner_project.sql", "004_project_path_agent_runs.sql", "005_catalog_shape.sql", "006_tenants.sql"];
let db: PGlite;
let tin: string;
let botski: string;

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

beforeAll(async () => {
  db = new PGlite();
  for (const f of MIGRATIONS) await db.exec(read(f));
  tin = (await db.query<{ id: string }>("select id from tenants where slug='tin'")).rows[0].id;
  await db.exec("insert into tenants (slug,name) values ('botski','Botski')");
  botski = (await db.query<{ id: string }>("select id from tenants where slug='botski'")).rows[0].id;
  await db.exec(read("011_tenant_settings.sql"));
  await db.exec(read("011_tenant_settings.sql")); // idempotent
}, 60_000);

describe("011_tenant_settings", () => {
  it("applying it changes nothing: no tenant has a row", async () => {
    expect(await reader(tin, "select * from tenant_settings")).toEqual([]);
  });
  it("an admin writes its own tenant's row, audited with the actor", async () => {
    await admin(botski, "insert into tenant_settings (brand_name, accent, logo_path, modules, updated_by) values ('Botski Ops', '#0a84ff', '/images/logo/botski.svg', $1, 'gene@tin.info')", [["projects", "drift"]]);
    expect(await reader(botski, "select brand_name, accent, logo_path, modules from tenant_settings")).toEqual([{ brand_name: "Botski Ops", accent: "#0a84ff", logo_path: "/images/logo/botski.svg", modules: ["projects", "drift"] }]);
    expect(await reader(botski, "select actor, action from registry_audit where table_name = 'tenant_settings'")).toEqual([{ actor: "gene@tin.info", action: "INSERT" }]);
  });
  it("another tenant sees nothing, and nothing is visible with no tenant set", async () => {
    expect(await reader(tin, "select * from tenant_settings")).toEqual([]);
    expect(await reader(null, "select * from tenant_settings")).toEqual([]);
  });
  it("a tenant cannot write another tenant's row", async () => {
    await expect(admin(tin, "insert into tenant_settings (tenant_id, brand_name) values ($1, 'Hijack')", [botski])).rejects.toThrow(/row-level security/i);
  });
  it("the reader cannot write, and a write needs an actor", async () => {
    await expect(reader(tin, "insert into tenant_settings (brand_name) values ('x')")).rejects.toThrow(/permission denied/);
    await expect(admin(tin, "insert into tenant_settings (brand_name) values ('x')", [], null)).rejects.toThrow(/console\.actor is not set/);
  });
  it("refuses a bad accent, a remote or traversing logo, an over-long name and a malformed module id", async () => {
    const put = (col: string, v: unknown) => admin(tin, `insert into tenant_settings (${col}) values ($1)`, [v]);
    await expect(put("accent", "red")).rejects.toThrow(/check/i);
    await expect(put("accent", "#12345")).rejects.toThrow(/check/i);
    await expect(put("logo_path", "https://evil.example/x.svg")).rejects.toThrow(/check/i);
    await expect(put("logo_path", "//evil.example/x.svg")).rejects.toThrow(/check/i);
    await expect(put("logo_path", "/a/../b.svg")).rejects.toThrow(/check/i);
    await expect(put("brand_name", "x".repeat(41))).rejects.toThrow(/check/i);
    await expect(put("brand_name", "")).rejects.toThrow(/check/i);
    await expect(put("modules", ["Bad Module"])).rejects.toThrow(/check/i);
  });
  it("the screen's upsert inserts, then updates in place, audited, and leaves one row", async () => {
    const UPSERT = `insert into tenant_settings (brand_name, accent, logo_path, modules, updated_by) values ($1, $2, $3, $4, $5)
      on conflict (tenant_id) do update set brand_name = excluded.brand_name, accent = excluded.accent, logo_path = excluded.logo_path,
      modules = excluded.modules, updated_at = now(), updated_by = excluded.updated_by`;
    await admin(tin, UPSERT, ["Tin", "#112233", null, null, "gene@tin.info"]);
    await admin(tin, UPSERT, ["Tin Ops", null, null, [], "gene@tin.info"]);
    expect(await reader(tin, "select brand_name, accent, modules from tenant_settings")).toEqual([{ brand_name: "Tin Ops", accent: null, modules: [] }]);
    expect(await reader(tin, "select action from registry_audit where table_name = 'tenant_settings' order by id")).toEqual([{ action: "INSERT" }, { action: "UPDATE" }]);
  });
  it("one row per tenant, and the application never deletes", async () => {
    await expect(admin(botski, "insert into tenant_settings (brand_name) values ('again')")).rejects.toThrow(/duplicate key|unique/i);
    // (the 'tin' row from the upsert test above is not 'botski', so this duplicate is still botski's own)
    await expect(admin(botski, "delete from tenant_settings")).rejects.toThrow(/permission denied/);
  });
});
