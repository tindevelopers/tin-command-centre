import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
const BEFORE_TENANTS = ["001_status.sql", "002_authority.sql", "003_owner_project.sql", "004_project_path_agent_runs.sql", "005_catalog_shape.sql"];
const MIGRATION = "007_drop_boss_adoption.sql";

const exists = async (db: PGlite, t: string) => (await db.query<{ r: string | null }>("select to_regclass($1)::text as r", [t])).rows[0].r !== null;

describe("007_drop_boss_adoption", () => {
  it("is a forward migration, marked as needing the owner's yes before it is applied", () => {
    const sql = read(MIGRATION);
    expect(sql).toMatch(/DESTRUCTIVE/);
    expect(sql).toMatch(/owner/i);
    expect(sql).toMatch(/DROP TABLE IF EXISTS boss_adoption/);
  });

  it("drops the table after 006, keeps the audit history, leaves other tables alone, and is idempotent", async () => {
    const db = new PGlite();
    for (const f of BEFORE_TENANTS) await db.exec(read(f));
    await db.exec(`select set_config('console.actor','seed',false);
      insert into projects (slug,name,kind) values ('konnect','Konnect','app');
      insert into environments (project_slug,name) values ('konnect','staging');
      insert into declared_pins values ('konnect','staging','@tindevelopers/knowledge','0.4.1');
      insert into boss_adoption values ('konnect','staging','shadow');`);
    await db.exec(read("006_tenants.sql"));
    expect(await exists(db, "boss_adoption")).toBe(true);
    const audited = async () => (await db.query<{ n: number }>("select count(*)::int as n from registry_audit where table_name = 'boss_adoption'")).rows[0].n;
    const before = await audited();
    expect(before).toBe(1);

    await db.exec(read(MIGRATION));
    await db.exec(read(MIGRATION)); // idempotent

    expect(await exists(db, "boss_adoption")).toBe(false);
    expect(await audited()).toBe(before); // append-only history is not rewritten
    expect((await db.query<{ n: number }>("select count(*)::int as n from declared_pins")).rows[0].n).toBe(1);
    // The audit trigger still works for the tables that remain.
    await db.exec(`select set_config('console.actor','gene@tin.info',false); update projects set name = 'Konnect 2' where slug = 'konnect'`);
    expect((await db.query<{ n: number }>("select count(*)::int as n from registry_audit where table_name = 'projects' and actor = 'gene@tin.info'")).rows[0].n).toBe(1);
    // The app roles can no longer see it.
    await db.exec("SET ROLE console_admin");
    await expect(db.query("select * from boss_adoption")).rejects.toThrow(/does not exist/i);
    await db.exec("RESET ROLE");
  }, 60_000);

  it("also applies on a database that has not had 006", async () => {
    const db = new PGlite();
    for (const f of BEFORE_TENANTS) await db.exec(read(f));
    await db.exec(read(MIGRATION));
    expect(await exists(db, "boss_adoption")).toBe(false);
    expect(await exists(db, "declared_pins")).toBe(true);
  }, 60_000);
});
