import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
const REGISTRY = ["projects", "project_relations", "environments", "declared_pins", "assignments", "registry_audit"];

let db: PGlite;

async function as<T>(role: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`SET ROLE ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("RESET ROLE");
  }
}

/** Run a write as console_admin with the actor set, the way the console does it. */
const adminTx = (sql: string, actor = "gene@tin.info") =>
  as("console_admin", async () => {
    try {
      await db.exec(`BEGIN; SELECT set_config('console.actor', '${actor}', true); ${sql}; COMMIT;`);
    } catch (e) {
      await db.exec("ROLLBACK");
      throw e;
    }
  });

beforeAll(async () => {
  db = new PGlite();
  await db.exec(read("001_status.sql"));
  await db.exec(read("002_authority.sql"));
  await db.exec(read("002_authority.sql")); // idempotent
  await db.exec(`
    SELECT set_config('console.actor', 'seed', false);
    INSERT INTO projects (slug, name, kind) VALUES ('boss', 'BOSS', 'boss'), ('konnect', 'Konnect', 'app'), ('shared-api-hub', 'Shared API hub', 'hub');
    INSERT INTO environments (project_slug, name) VALUES ('konnect', 'development');
    SELECT set_config('console.actor', '', false);
  `);
});

describe("registry writes", () => {
  it("lets an admin register a project, its relations, pins and owner", async () => {
    await adminTx(`
      INSERT INTO project_relations VALUES ('konnect', 'shared-api-hub', 'consumes'), ('konnect', 'boss', 'calls');
      INSERT INTO declared_pins VALUES ('konnect', 'development', '@tindevelopers/ui-shell', '1.2.0');
      INSERT INTO assignments (project_slug, assignee, assigned_by) VALUES ('konnect', 'a@tin.info', 'gene@tin.info')`);
    const r = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM declared_pins");
    expect(r.rows[0].n).toBe(1);
  });

  it("refuses an unknown kind or environment", async () => {
    await expect(adminTx("INSERT INTO projects (slug, name, kind) VALUES ('x', 'X', 'wizard')")).rejects.toThrow(/check/i);
    await expect(adminTx("INSERT INTO environments VALUES ('konnect', 'qa')")).rejects.toThrow(/check/i);
  });

  it("refuses a pin for an environment the project does not have", async () => {
    await expect(adminTx("INSERT INTO declared_pins VALUES ('konnect', 'production', 'p', '1.0.0')")).rejects.toThrow(/foreign key/i);
  });

  it("allows only one active assignment per person, role and project", async () => {
    await expect(adminTx("INSERT INTO assignments (project_slug, assignee, assigned_by) VALUES ('konnect', 'a@tin.info', 'g')")).rejects.toThrow(/unique|duplicate/i);
  });
});

describe("audit", () => {
  it("records who changed what, with before and after", async () => {
    await adminTx("UPDATE projects SET notes = 'first client' WHERE slug = 'konnect'", "mary@tin.info");
    const r = await db.query<{ actor: string; action: string; before: any; after: any }>(
      "SELECT actor, action, before, after FROM registry_audit WHERE table_name = 'projects' AND action = 'UPDATE' ORDER BY id DESC LIMIT 1");
    expect(r.rows[0].actor).toBe("mary@tin.info");
    expect(r.rows[0].before.notes).toBeNull();
    expect(r.rows[0].after.notes).toBe("first client");
  });

  it("refuses a registry write with no actor", async () => {
    await expect(as("console_admin", () => db.exec("UPDATE projects SET notes = 'x'"))).rejects.toThrow(/console\.actor/);
  });

  it("cannot be edited or deleted by any role", async () => {
    for (const role of ["console_admin", "console_reader", "collector_writer"]) {
      await expect(as(role, () => db.exec("DELETE FROM registry_audit"))).rejects.toThrow(/permission denied/);
      await expect(as(role, () => db.exec("UPDATE registry_audit SET actor = 'x'"))).rejects.toThrow(/permission denied/);
      await expect(as(role, () => db.exec("INSERT INTO registry_audit (actor, table_name, action) VALUES ('x','x','x')"))).rejects.toThrow(/permission denied/);
    }
  });
});

describe("grants", () => {
  it.each(REGISTRY)("console_reader can SELECT but not write %s", async (t) => {
    await as("console_reader", () => db.exec(`SELECT * FROM ${t}`));
    await expect(as("console_reader", () => db.exec(`DELETE FROM ${t}`))).rejects.toThrow(/permission denied/);
    await expect(as("console_reader", () => db.exec(`INSERT INTO ${t} DEFAULT VALUES`))).rejects.toThrow(/permission denied/);
  });

  it.each(REGISTRY)("collector_writer has no access to %s", async (t) => {
    await expect(as("collector_writer", () => db.exec(`SELECT * FROM ${t}`))).rejects.toThrow(/permission denied/);
  });

  it("console_admin cannot delete projects, environments or assignments", async () => {
    for (const t of ["projects", "environments", "assignments"]) {
      await expect(adminTx(`DELETE FROM ${t}`)).rejects.toThrow(/permission denied/);
    }
  });

  it("console_admin cannot write collector snapshots", async () => {
    for (const t of ["collector_runs", "package_snapshots", "cell_snapshots", "credential_snapshots"]) {
      await expect(as("console_admin", () => db.exec(`DELETE FROM ${t}`))).rejects.toThrow(/permission denied/);
    }
  });

  it("operators can be admins, but not any other role, and the change is audited", async () => {
    await adminTx("INSERT INTO console_operators (user_id, email, role, added_by) VALUES ('u2', 'b@tin.info', 'admin', 'owner')");
    await expect(adminTx("INSERT INTO console_operators (user_id, email, role, added_by) VALUES ('u4', 'd@tin.info', 'root', 'owner')")).rejects.toThrow(/check/i);
    const r = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM registry_audit WHERE table_name = 'console_operators'");
    expect(r.rows[0].n).toBe(1);
  });
});
