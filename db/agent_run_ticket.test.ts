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

beforeAll(async () => {
  db = new PGlite();
  for (const f of ["001_status.sql", "002_authority.sql", "003_owner_project.sql", "004_project_path_agent_runs.sql", "005_agent_run_ticket.sql"]) await db.exec(read(f));
  await db.exec(read("005_agent_run_ticket.sql")); // idempotent
  await db.exec(`select set_config('console.actor','seed',false); insert into projects (slug,name,kind) values ('ops','Ops','app'); insert into environments (project_slug,name) values ('ops','development'); select set_config('console.actor','',false);`);
  await as("console_admin", () => db.exec("insert into agent_runs (project_slug,environment,package,from_version,to_version,issue_url,requested_by,ticket_id,ticket_ref) values ('ops','development','@x/y','1.0.0','1.1.0','https://github.com/o/r/issues/1','a@tin.info','t1','PLT-1')"));
}, 60_000);

describe("005_agent_run_ticket", () => {
  it("stores the ticket id and number with the hand-off, readable by console_reader", async () => {
    const r = await as("console_reader", () => db.query<{ ticket_id: string; ticket_ref: string; ticket_resolved_at: string | null }>("select ticket_id, ticket_ref, ticket_resolved_at from agent_runs"));
    expect(r.rows).toEqual([{ ticket_id: "t1", ticket_ref: "PLT-1", ticket_resolved_at: null }]);
  });
  it("lets console_admin stamp ticket_resolved_at, and only that column", async () => {
    await as("console_admin", () => db.exec("update agent_runs set ticket_resolved_at = now() where ticket_id = 't1'"));
    expect((await db.query("select 1 from agent_runs where ticket_resolved_at is not null")).rows).toHaveLength(1);
    for (const col of ["issue_url = 'x'", "ticket_id = 'x'", "ticket_ref = 'x'", "to_version = '9.9.9'", "requested_by = 'x'"]) {
      await expect(as("console_admin", () => db.exec(`update agent_runs set ${col}`))).rejects.toThrow(/permission denied/);
    }
  });
  it("still cannot be deleted, and the reader and collector cannot stamp it", async () => {
    await expect(as("console_admin", () => db.exec("delete from agent_runs"))).rejects.toThrow(/permission denied/);
    await expect(as("console_reader", () => db.exec("update agent_runs set ticket_resolved_at = null"))).rejects.toThrow(/permission denied/);
    await expect(as("collector_writer", () => db.exec("update agent_runs set ticket_resolved_at = null"))).rejects.toThrow(/permission denied/);
  });
});
