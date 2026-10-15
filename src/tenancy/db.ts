import { neon } from "@neondatabase/serverless";

type Row = Record<string, any>;
export type Role = "reader" | "admin";

const ENV: Record<Role, string> = { reader: "CONSOLE_DATABASE_URL", admin: "CONSOLE_ADMIN_DATABASE_URL" };

/**
 * The one place a connection string is chosen. Phase 1: every tenant uses the shared database.
 * A tenant with isolation 'dedicated' (db/006) will get its own connection here later, with no change to any caller.
 * Nothing else in the app reads CONSOLE_DATABASE_URL or CONSOLE_ADMIN_DATABASE_URL for tenant data.
 */
export function connectionFor(_tenantId: string, role: Role): string {
  const url = process.env[ENV[role]];
  if (!url) throw new Error(`${ENV[role]} is not set.`);
  return url;
}

export const tenantStoreConfigured = (role: Role = "reader") => Boolean(process.env[ENV[role]]);

const SET_TENANT = "select set_config('app.tenant_id', $1, true)";

/** One read, scoped to a tenant. The tenant is set inside the same transaction, so row-level security applies to exactly this query. */
export async function tenantQuery(tenantId: string, text: string, params: unknown[] = []): Promise<Row[]> {
  const sql = neon(connectionFor(tenantId, "reader"));
  const [, rows] = await sql.transaction([sql.query(SET_TENANT, [tenantId]), sql.query(text, params)]);
  return rows as Row[];
}

/** Statements run together as console_admin in one transaction: tenant first, then the audited actor, then the writes. */
export async function tenantWrite(tenantId: string, actor: string, statements: { text: string; params: unknown[] }[]): Promise<void> {
  const sql = neon(connectionFor(tenantId, "admin"));
  await sql.transaction([
    sql.query(SET_TENANT, [tenantId]),
    sql.query("select set_config('console.actor', $1, true)", [actor]),
    ...statements.map((s) => sql.query(s.text, s.params)),
  ]);
}

/**
 * Stand-in tenant id used only while db/006_tenants.sql has not been applied yet, so this code can be deployed first and the
 * migration applied right after without taking reads down. Before 006 nothing is tenant-scoped, so the id is never matched.
 */
export const PRE_MIGRATION_TENANT = "00000000-0000-0000-0000-000000000000";

/** Postgres error 42883: the function does not exist (006 not applied). */
export const isMissingFunction = (e: unknown): boolean => typeof e === "object" && e !== null && (e as { code?: string }).code === "42883";

/**
 * The id of a live tenant, or null for an unknown or retired one. The app roles cannot list tenants; this is the only lookup.
 * Before 006 is applied there is no resolve_tenant(): the single, unscoped registry is used (reads only; registry writes need 006).
 */
export async function resolveTenantId(slug: string): Promise<string | null> {
  try {
    const rows = (await neon(process.env[ENV.reader]!).query("select resolve_tenant($1) as id", [slug])) as Row[];
    return rows[0]?.id ?? null;
  } catch (e) {
    if (isMissingFunction(e)) {
      console.warn("db/006_tenants.sql is not applied: running without tenant scoping");
      return PRE_MIGRATION_TENANT;
    }
    throw e;
  }
}
