import { isMissingFunction, tenantQuery, tenantWrite } from "./db";
import { parseSettings, type TenantSettings } from "./settings-shared";
import type { SettingsInput } from "./settings-write";

/**
 * Another tenant's workspace settings, through the functions of db/012_platform_tenant_settings.sql. The functions refuse anyone
 * whose tenant is not the platform tenant, so these helpers need no check of their own; the page and the action still check, to
 * fail early and say why.
 */
export type TenantSettingsRead = { settings: TenantSettings; hasRow: boolean; updatedAt: Date | null; updatedBy: string | null };

/** Null when db/012 has not been applied yet, so the page can say so instead of failing. */
export async function readTenantSettings(callerTenantId: string, slug: string): Promise<TenantSettingsRead | null> {
  try {
    const rows = await tenantQuery(callerTenantId, "select * from get_tenant_settings($1)", [slug]);
    const row = rows[0];
    return { settings: parseSettings(row), hasRow: Boolean(row), updatedAt: row?.updated_at ? new Date(row.updated_at) : null, updatedBy: row?.updated_by ?? null };
  } catch (e) {
    if (isMissingFunction(e)) return null;
    throw e;
  }
}

export async function writeTenantSettings(callerTenantId: string, actor: string, slug: string, s: SettingsInput): Promise<void> {
  await tenantWrite(callerTenantId, actor, [{ text: "select set_tenant_settings($1, $2, $3, $4, $5)", params: [slug, s.brandName, s.accent, s.logoPath, s.modules] }]);
}

export { isMissingFunction };
