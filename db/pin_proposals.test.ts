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
const owner = async <T = any>(sql: string) => (await db.query<T>(sql)).rows;

const INSERT = "insert into pin_proposals (platform, environment, pins, boss_id, requested_by) values ($1, 'development', $2, 'pp_1', 'gene@tin.info')";

beforeAll(async () => {
  db = new PGlite();
  for (const f of MIGRATIONS) await db.exec(read(f));
  tin = (await owner<{ id: string }>("select id from tenants where slug='tin'"))[0].id;
  await db.exec("insert into tenants (slug,name) values ('botski','Botski')");
  botski = (await owner<{ id: string }>("select id from tenants where slug='botski'"))[0].id;
  await db.exec(read("009_pin_proposals.sql"));
  await db.exec(read("009_pin_proposals.sql")); // idempotent
}, 60_000);

describe("009_pin_proposals", () => {
  it("console_admin records a sent proposal inside its tenant, audited with the actor", async () => {
    await admin(tin, INSERT, ["konnect", ["@tindevelopers/api-mcp@1.0.1", "@tindevelopers/domain-support@6.0.1"]]);
    const rows = await reader(tin, "select platform, pins, boss_id from pin_proposals");
    expect(rows).toEqual([{ platform: "konnect", pins: ["@tindevelopers/api-mcp@1.0.1", "@tindevelopers/domain-support@6.0.1"], boss_id: "pp_1" }]);
    const audit = await reader(tin, "select actor, action from registry_audit where table_name = 'pin_proposals'");
    expect(audit).toEqual([{ actor: "gene@tin.info", action: "INSERT" }]);
  });
  it("another tenant sees nothing, and nothing is visible with no tenant set", async () => {
    expect(await reader(botski, "select * from pin_proposals")).toEqual([]);
    expect(await reader(null, "select * from pin_proposals")).toEqual([]);
  });
  it("a write without an actor is refused, and the reader cannot write", async () => {
    await expect(admin(tin, INSERT, ["konnect", ["@tindevelopers/x@1.0.0"]], null)).rejects.toThrow(/console\.actor is not set/);
    await expect(reader(tin, INSERT, ["konnect", ["@tindevelopers/x@1.0.0"]])).rejects.toThrow(/permission denied/);
  });
  it("records are append-only", async () => {
    await expect(admin(tin, "update pin_proposals set boss_id = 'x'")).rejects.toThrow(/permission denied/);
    await expect(admin(tin, "delete from pin_proposals")).rejects.toThrow(/permission denied/);
  });
  it("refuses a bad platform, no pins, or more than ten pins", async () => {
    await expect(admin(tin, INSERT, ["Bad Platform", ["@tindevelopers/x@1.0.0"]])).rejects.toThrow(/check/i);
    await expect(admin(tin, INSERT, ["konnect", []])).rejects.toThrow(/check/i);
    await expect(admin(tin, INSERT, ["konnect", Array.from({ length: 11 }, (_, i) => `@tindevelopers/p${i}@1.0.0`)])).rejects.toThrow(/check/i);
  });
  it("a tenant cannot write into another tenant", async () => {
    await expect(admin(botski, "insert into pin_proposals (tenant_id, platform, environment, pins, boss_id, requested_by) values ($1, 'konnect', 'development', $2, 'pp_2', 'x')", [tin, ["@tindevelopers/x@1.0.0"]])).rejects.toThrow(/row-level security/i);
  });
});
