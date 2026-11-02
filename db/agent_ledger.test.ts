import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
const MIGRATIONS = ["001_status.sql", "002_authority.sql", "003_owner_project.sql", "004_project_path_agent_runs.sql", "005_catalog_shape.sql", "006_tenants.sql"];
let db: PGlite;
let tin: string;
let botski: string;

type Role = "console_reader" | "console_admin" | "agent_ledger_writer";
async function inTenant<T>(role: Role, tenant: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`SET ROLE ${role}`);
  try {
    await db.exec("BEGIN");
    if (tenant) await db.query("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
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
const writer = <T = any>(tenant: string | null, sql: string, params?: unknown[]) => inTenant<T>("agent_ledger_writer", tenant, sql, params);
const admin = <T = any>(tenant: string | null, sql: string, params?: unknown[]) => inTenant<T>("console_admin", tenant, sql, params);
const reader = <T = any>(tenant: string | null, sql: string, params?: unknown[]) => inTenant<T>("console_reader", tenant, sql, params);
const owner = async <T = any>(sql: string) => (await db.query<T>(sql)).rows;

const INSERT_RUN = "insert into agent_ledger_runs (agent, task_type, autonomy, repository, model, trigger) values ($1, $2, 'A1', 'tindevelopers/konnect-caas-base', 'model-x', 'issue') returning id";

beforeAll(async () => {
  db = new PGlite();
  for (const f of MIGRATIONS) await db.exec(read(f));
  tin = (await owner<{ id: string }>("select id from tenants where slug='tin'"))[0].id;
  await db.exec("insert into tenants (slug,name) values ('botski','Botski')");
  botski = (await owner<{ id: string }>("select id from tenants where slug='botski'"))[0].id;
  await db.exec(read("010_agent_ledger.sql"));
  await db.exec(read("010_agent_ledger.sql")); // idempotent
}, 60_000);

describe("010_agent_ledger", () => {
  let runId: string;
  it("the writer records a run and its events inside its tenant; the console reads them", async () => {
    runId = (await writer<{ id: string }>(tin, INSERT_RUN, ["estate-scanner", "upgrade.patch.non-security"]))[0].id;
    await writer(tin, "insert into agent_ledger_events (run_id, event, actor) values ($1, 'checks-passed', 'ci'), ($1, 'merged', 'gene')", [runId]);
    expect(await reader(tin, "select agent, task_type, autonomy from agent_ledger_runs")).toEqual([{ agent: "estate-scanner", task_type: "upgrade.patch.non-security", autonomy: "A1" }]);
    expect(await reader(tin, "select event from agent_ledger_events order by id")).toEqual([{ event: "checks-passed" }, { event: "merged" }]);
    expect(await admin(tin, "select task_type, runs::int, merged::int, human_changes::int, reverts_30d::int from agent_task_type_record")).toEqual([
      { task_type: "upgrade.patch.non-security", runs: 1, merged: 1, human_changes: 0, reverts_30d: 0 },
    ]);
  });
  it("the writer can close a run but not rewrite what it was", async () => {
    await writer(tin, "update agent_ledger_runs set finished_at = now(), cost_usd = 1.25, outcome = 'draft-pr', pr_url = 'https://github.com/o/r/pull/1' where id = $1", [runId]);
    await expect(writer(tin, "update agent_ledger_runs set task_type = 'docs.generated-section' where id = $1", [runId])).rejects.toThrow(/permission denied/);
    await expect(writer(tin, "delete from agent_ledger_runs where id = $1", [runId])).rejects.toThrow(/permission denied/);
    await expect(writer(tin, "delete from agent_ledger_events")).rejects.toThrow(/permission denied/);
  });
  it("the console cannot write the ledger", async () => {
    await expect(admin(tin, INSERT_RUN, ["x", "ci.fix"])).rejects.toThrow(/permission denied/);
    await expect(reader(tin, INSERT_RUN, ["x", "ci.fix"])).rejects.toThrow(/permission denied/);
  });
  it("another tenant sees nothing, nothing is visible with no tenant set, and no tenant means no insert", async () => {
    expect(await reader(botski, "select * from agent_ledger_runs")).toEqual([]);
    expect(await reader(botski, "select * from agent_task_type_record")).toEqual([]);
    expect(await reader(null, "select * from agent_ledger_runs")).toEqual([]);
    await expect(writer(null, INSERT_RUN, ["x", "ci.fix"])).rejects.toThrow();
    await expect(writer(botski, "insert into agent_ledger_runs (tenant_id, agent, task_type, autonomy, repository, model, trigger) values ($1, 'x', 'ci.fix', 'A1', 'o/r', 'm', 'manual')", [tin])).rejects.toThrow(/row-level security/i);
  });
  it("refuses a bad class, trigger, event or repository", async () => {
    await expect(writer(tin, "insert into agent_ledger_runs (agent, task_type, autonomy, repository, model, trigger) values ('x', 'ci.fix', 'A9', 'o/r', 'm', 'manual')")).rejects.toThrow(/check/i);
    await expect(writer(tin, "insert into agent_ledger_runs (agent, task_type, autonomy, repository, model, trigger) values ('x', 'ci.fix', 'A1', 'o/r', 'm', 'cron')")).rejects.toThrow(/check/i);
    await expect(writer(tin, "insert into agent_ledger_runs (agent, task_type, autonomy, repository, model, trigger) values ('x', 'ci.fix', 'A1', 'not a repo', 'm', 'manual')")).rejects.toThrow(/check/i);
    await expect(writer(tin, "insert into agent_ledger_events (run_id, event, actor) values ($1, 'exploded', 'ci')", [runId])).rejects.toThrow(/check/i);
  });
});
