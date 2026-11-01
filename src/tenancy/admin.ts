import { isMissingFunction, tenantQuery, tenantWrite } from "./db";
import type { CreateTenantInput } from "./validate";

/**
 * Tenants, through the functions of db/008_tenant_admin.sql. The app roles never read the `tenants` table itself; `list_tenants()`
 * returns every tenant from the platform tenant and only the caller's own from any other, so the page needs no check of its own.
 */
export type TenantRow = {
  id: string;
  slug: string;
  name: string;
  isolation: "shared" | "dedicated";
  /** The NAME of the secret holding a dedicated tenant's connection string; never a value. */
  connectionRef: string | null;
  platform: boolean;
  createdAt: Date;
  retiredAt: Date | null;
  projects: number;
  operators: number;
};

/** Null when db/008 has not been applied yet, so the page can say so instead of failing. */
export async function listTenants(tenantId: string): Promise<TenantRow[] | null> {
  try {
    const rows = await tenantQuery(tenantId, "select * from list_tenants()");
    return rows.map((r) => ({
      id: r.id, slug: r.slug, name: r.name, isolation: r.isolation, connectionRef: r.connection_ref ?? null, platform: Boolean(r.platform),
      createdAt: new Date(r.created_at), retiredAt: r.retired_at ? new Date(r.retired_at) : null, projects: Number(r.projects), operators: Number(r.operators),
    }));
  } catch (e) {
    if (isMissingFunction(e)) return null;
    throw e;
  }
}

/** Whether the caller's tenant is the platform tenant, or null before db/008. */
export async function isPlatformTenant(tenantId: string): Promise<boolean | null> {
  try {
    const rows = await tenantQuery(tenantId, "select is_platform_tenant() as platform");
    return Boolean(rows[0]?.platform);
  } catch (e) {
    if (isMissingFunction(e)) return null;
    throw e;
  }
}

export async function createTenant(tenantId: string, actor: string, input: CreateTenantInput): Promise<void> {
  await tenantWrite(tenantId, actor, [{ text: "select create_tenant($1, $2, $3, $4)", params: [input.slug, input.name, input.isolation, input.connectionRef] }]);
}

export async function retireTenant(tenantId: string, actor: string, slug: string): Promise<void> {
  await tenantWrite(tenantId, actor, [{ text: "select retire_tenant($1)", params: [slug] }]);
}

/** The host a tenant answers on, from the same configuration that resolves it (src/tenancy/host.ts). */
export function tenantHost(slug: string, cfg: { baseDomain: string; defaultTenant: string }): string {
  return slug === cfg.defaultTenant ? cfg.baseDomain : `${slug}.${cfg.baseDomain}`;
}

/**
 * Which integrations this deployment has configured, by environment variable NAME. Values are never read into the page.
 * One process serves every tenant today (P1), so this describes the deployment; per-tenant settings are phase P4.
 */
export type IntegrationStatus = { name: string; label: string; configured: boolean; note: string };

export function integrationStatus(env: Record<string, string | undefined> = process.env): IntegrationStatus[] {
  const has = (k: string) => Boolean(env[k]?.trim());
  return [
    { name: "CONSOLE_DATABASE_URL", label: "Status store (read)", configured: has("CONSOLE_DATABASE_URL"), note: "console_reader login" },
    { name: "CONSOLE_ADMIN_DATABASE_URL", label: "Registry writes", configured: has("CONSOLE_ADMIN_DATABASE_URL"), note: "console_admin login; without it the registry is read-only" },
    { name: "BOSS_API_URL", label: "BOSS cell", configured: has("BOSS_API_URL") && has("BOSS_REPORTS_KEY"), note: "with BOSS_REPORTS_KEY (scope boss.reports.read)" },
    { name: "AGENT_GITHUB_TOKEN", label: "Fix with agent", configured: has("AGENT_GITHUB_TOKEN"), note: "opens GitHub issues; replaced by the tin-estate-agent App later" },
    { name: "COLLECTOR_GITHUB_TOKEN", label: "Collect now", configured: has("COLLECTOR_GITHUB_TOKEN"), note: "dispatches the collector workflow" },
    { name: "TENANT_OTHER_HOSTS", label: "Unknown hosts", configured: env.TENANT_OTHER_HOSTS === "reject", note: env.TENANT_OTHER_HOSTS === "reject" ? "rejected (404)" : "fall back to the default tenant" },
  ];
}
