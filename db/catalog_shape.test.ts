import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
let db: PGlite;
const as = async <T>(role: string, fn: () => Promise<T>) => {
  await db.exec(`SET ROLE ${role}`);
  try { return await fn(); } finally { await db.exec("RESET ROLE"); }
};
const adminTx = (sql: string) => as("console_admin", async () => {
  try { await db.exec(`BEGIN; select set_config('console.actor','gene@tin.info',true); ${sql}; COMMIT`); }
  catch (e) { await db.exec("ROLLBACK"); throw e; }
});

beforeAll(async () => {
  db = new PGlite();
  for (const f of ["001_status.sql", "002_authority.sql", "003_owner_project.sql", "004_project_path_agent_runs.sql"]) await db.exec(read(f));
  // Rows in the old vocabulary, written before 005 runs.
  await db.exec(`select set_config('console.actor','seed',false);
    insert into projects (slug,name,kind) values ('caas','Konnect CaaS','spoke'),('ops','Ops','app'),('boss','BOSS','boss');
    insert into project_relations values ('caas','ops','hosts'),('caas','boss','calls'),('ops','boss','consumes');
    select set_config('console.actor','',false);`);
  await db.exec(read("005_catalog_shape.sql"));
  await db.exec(read("005_catalog_shape.sql")); // idempotent
}, 60_000);

describe("005_catalog_shape", () => {
  it("rewrites existing relation values to the Backstage verbs and refuses the old ones", async () => {
    const r = await db.query<{ relation: string }>("select relation from project_relations order by 1");
    expect(r.rows.map((x) => x.relation)).toEqual(["consumes_api", "depends_on", "has_part"]);
    await expect(adminTx("insert into project_relations values ('boss','ops','hosts')")).rejects.toThrow(/check/i);
  });

  it("accepts the shared environment vocabulary and nothing else", async () => {
    await adminTx("insert into environments (project_slug,name) values ('ops','preview'),('ops','ci')");
    await expect(adminTx("insert into environments (project_slug,name) values ('ops','qa')")).rejects.toThrow(/check/i);
  });

  it("lets an admin create groups and own a project by group, audited", async () => {
    await adminTx("insert into groups (slug,name) values ('tin','TIN'); insert into groups (slug,name,parent) values ('tin-platform','TIN platform','tin')");
    await adminTx("update projects set owner_group = 'tin-platform', tier = 'foundation' where slug = 'boss'");
    const audit = await db.query<{ n: number }>("select count(*)::int n from registry_audit where table_name = 'groups' and actor = 'gene@tin.info'");
    expect(audit.rows[0].n).toBe(2);
    await expect(adminTx("update projects set owner_group = 'nope' where slug = 'boss'")).rejects.toThrow(/foreign key/i);
    await expect(adminTx("update projects set tier = 'sky' where slug = 'boss'")).rejects.toThrow(/check/i);
    await expect(adminTx("insert into groups (slug,name,parent) values ('loop','Loop','loop')")).rejects.toThrow(/check/i);
  });

  it("annotations default to an empty object and must stay an object", async () => {
    const r = await db.query<{ annotations: Record<string, unknown> }>("select annotations from projects where slug = 'boss'");
    expect(r.rows[0].annotations).toEqual({});
    await adminTx(`update projects set annotations = '{"backstage.io/techdocs-ref":"dir:."}' where slug = 'boss'`);
    await expect(adminTx("update projects set annotations = '[]' where slug = 'boss'")).rejects.toThrow(/check/i);
  });

  it("console_reader reads groups and cannot write them; collector_writer has no access", async () => {
    const r = await as("console_reader", () => db.query<{ n: number }>("select count(*)::int n from groups"));
    expect(r.rows[0].n).toBe(2);
    await expect(as("console_reader", () => db.exec("insert into groups (slug,name) values ('x','X')"))).rejects.toThrow(/permission denied/);
    await expect(as("collector_writer", () => db.exec("select * from groups"))).rejects.toThrow(/permission denied/);
    await expect(as("console_admin", () => db.exec("delete from groups"))).rejects.toThrow(/permission denied/);
  });
});
