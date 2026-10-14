import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { statementsFor } from "./commands";
import { parseCommand } from "./validate";

let db: PGlite;
let tin: string;
const form = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });

/** Same shape as db.ts: one transaction, as console_admin, actor set first. */
async function run(type: Parameters<typeof parseCommand>[0], o: Record<string, string>, actor = "gene@tin.info") {
  const stmts = statementsFor(parseCommand(type, form(o)));
  await db.exec("SET ROLE console_admin");
  try {
    await db.exec("BEGIN");
    await db.query("SELECT set_config('app.tenant_id', $1, true)", [tin]);
    await db.query("SELECT set_config('console.actor', $1, true)", [actor]);
    for (const s of stmts) await db.query(s.text, s.params);
    await db.exec("COMMIT");
  } catch (e) {
    await db.exec("ROLLBACK");
    throw e;
  } finally {
    await db.exec("RESET ROLE");
  }
}
const rows = async <T = any>(sql: string) => (await db.query<T>(sql)).rows;

beforeAll(async () => {
  db = new PGlite();
  for (const f of ["001_status.sql", "002_authority.sql", "003_owner_project.sql", "004_project_path_agent_runs.sql", "005_catalog_shape.sql", "006_tenants.sql"]) await db.exec(readFileSync(join(__dirname, "../../db", f), "utf8"));
  tin = (await db.query<{ id: string }>("select id from tenants where slug = 'tin'")).rows[0].id;
});

describe("registry commands run against the real schema as console_admin", () => {
  it("creates and then updates a project", async () => {
    await run("upsertProject", { slug: "konnect", name: "Konnect", kind: "app", lifecycle: "active" });
    await run("upsertProject", { slug: "konnect", name: "Konnect CaaS", kind: "app", lifecycle: "active", client: "konnect" });
    expect(await rows("SELECT name, client FROM projects")).toEqual([{ name: "Konnect CaaS", client: "konnect" }]);
  });

  it("sets, changes and clears the owning project, and a project may own itself", async () => {
    await run("upsertProject", { slug: "boss", name: "BOSS", kind: "boss", lifecycle: "active", ownerProject: "boss" });
    await run("upsertProject", { slug: "konnect", name: "Konnect CaaS", kind: "app", lifecycle: "active", client: "konnect", ownerProject: "boss" });
    expect(await rows("SELECT owner_project FROM projects WHERE slug = 'konnect'")).toEqual([{ owner_project: "boss" }]);
    expect(await rows("SELECT owner_project FROM projects WHERE slug = 'boss'")).toEqual([{ owner_project: "boss" }]);
    await run("upsertProject", { slug: "konnect", name: "Konnect CaaS", kind: "app", lifecycle: "active", client: "konnect" });
    expect(await rows("SELECT owner_project FROM projects WHERE slug = 'konnect'")).toEqual([{ owner_project: null }]);
    await run("upsertProject", { slug: "konnect", name: "Konnect CaaS", kind: "app", lifecycle: "active", client: "konnect", ownerProject: "boss" });
  });

  it("sets the owning group and tier, and rejects an unknown group", async () => {
    await db.exec(`BEGIN; select set_config('console.actor','gene@tin.info',true); select set_config('app.tenant_id','${tin}',true); insert into groups (slug,name) values ('tin','TIN'); COMMIT`);
    await run("upsertProject", { slug: "boss", name: "BOSS", kind: "boss", lifecycle: "active", ownerProject: "boss", ownerGroup: "tin", tier: "foundation" });
    expect(await rows("SELECT owner_group, tier FROM projects WHERE slug = 'boss'")).toEqual([{ owner_group: "tin", tier: "foundation" }]);
    await expect(run("upsertProject", { slug: "boss", name: "BOSS", kind: "boss", lifecycle: "active", ownerProject: "boss", ownerGroup: "nope" })).rejects.toThrow(/foreign key/i);
  });

  it("rejects an owning project that does not exist", async () => {
    await expect(run("upsertProject", { slug: "konnect", name: "Konnect CaaS", kind: "app", lifecycle: "active", ownerProject: "nope" })).rejects.toThrow(/foreign key/i);
    expect(await rows("SELECT owner_project FROM projects WHERE slug = 'konnect'")).toEqual([{ owner_project: "boss" }]);
  });

  it("registers an environment, a pin, an adoption mode and updates them in place", async () => {
    await run("upsertEnvironment", { slug: "konnect", name: "production", cell: "konnect-prod", region: "europe-west2" });
    await run("setPin", { slug: "konnect", environment: "production", package: "@tindevelopers/ui-shell", version: "1.1.0" });
    await run("setPin", { slug: "konnect", environment: "production", package: "@tindevelopers/ui-shell", version: "1.2.0" });
    await run("setAdoption", { slug: "konnect", environment: "production", domainMode: "shadow" });
    await run("setAdoption", { slug: "konnect", environment: "production", domainMode: "remote" });
    expect(await rows("SELECT version FROM declared_pins")).toEqual([{ version: "1.2.0" }]);
    expect(await rows("SELECT domain_mode FROM boss_adoption")).toEqual([{ domain_mode: "remote" }]);
  });

  it("a pin for an environment the project lacks fails and leaves nothing behind", async () => {
    await expect(run("setPin", { slug: "konnect", environment: "staging", package: "p", version: "1.0.0" })).rejects.toThrow(/foreign key/i);
    expect(await rows("SELECT 1 FROM declared_pins WHERE package = 'p'")).toEqual([]);
  });

  it("removes a pin", async () => {
    await run("removePin", { slug: "konnect", environment: "production", package: "@tindevelopers/ui-shell" });
    expect(await rows("SELECT 1 FROM declared_pins")).toEqual([]);
  });

  it("assigns an owner with assigned_by taken from the actor, ignoring duplicates, and ends it by timestamp", async () => {
    await run("assign", { slug: "konnect", assignee: "Mary@tin.info", role: "owner" }, "gene@tin.info");
    await run("assign", { slug: "konnect", assignee: "mary@tin.info", role: "owner" }, "gene@tin.info");
    const a = await rows<{ id: number; assigned_by: string }>("SELECT id, assigned_by FROM assignments");
    expect(a).toHaveLength(1);
    expect(a[0].assigned_by).toBe("gene@tin.info");
    await run("unassign", { slug: "konnect", id: String(a[0].id) });
    expect(await rows("SELECT 1 FROM assignments WHERE removed_at IS NULL")).toEqual([]);
    expect(await rows("SELECT 1 FROM assignments")).toHaveLength(1); // history kept
    await run("assign", { slug: "konnect", assignee: "mary@tin.info", role: "owner" }); // can be assigned again
    expect(await rows("SELECT 1 FROM assignments WHERE removed_at IS NULL")).toHaveLength(1);
  });

  it("adds and removes a relation", async () => {
    await run("upsertProject", { slug: "boss", name: "BOSS", kind: "boss", lifecycle: "active" });
    await run("addRelation", { slug: "konnect", to: "boss", relation: "consumes_api" });
    await run("addRelation", { slug: "konnect", to: "boss", relation: "consumes_api" });
    expect(await rows("SELECT 1 FROM project_relations")).toHaveLength(1);
    await run("removeRelation", { slug: "konnect", to: "boss", relation: "consumes_api" });
    expect(await rows("SELECT 1 FROM project_relations")).toEqual([]);
  });

  it("audits every command with the signed-in actor", async () => {
    const actors = await rows<{ actor: string }>("SELECT DISTINCT actor FROM registry_audit ORDER BY 1");
    expect(actors.map((r) => r.actor)).toEqual(["gene@tin.info"]);
    expect((await rows("SELECT 1 FROM registry_audit WHERE table_name = 'declared_pins' AND action = 'DELETE'")).length).toBe(1);
  });
});
