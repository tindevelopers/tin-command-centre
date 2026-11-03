import { cache } from "react";
import { notFound } from "next/navigation";
import { tenantQuery, tenantStoreConfigured } from "./db";
import { currentTenant, lookupTenant } from "./tenant";
import { defaultSettings, parseSettings, type TenantSettings } from "./settings-shared";

export * from "./settings-shared";

/** Postgres 42P01: the table does not exist (db/011 not applied). */
const isMissingTable = (e: unknown): boolean => typeof e === "object" && e !== null && (e as { code?: string }).code === "42P01";

/** One tenant's settings, memoised per request so the layout, the document title and a guard share one read. */
const readSettings = cache(async (tenantId: string): Promise<TenantSettings> => {
  try {
    const rows = await tenantQuery(tenantId, "select brand_name, accent, logo_path, modules from tenant_settings limit 1");
    return parseSettings(rows[0]);
  } catch (e) {
    if (isMissingTable(e)) return defaultSettings();
    console.error("tenant settings could not be read", e instanceof Error ? e.message : e);
    return defaultSettings();
  }
});

/**
 * The current tenant's settings. Nothing waits on a remote read here beyond the one tenant-scoped query the page already makes;
 * with no store, no table (011 not applied) or no row, the defaults apply, which is today's console unchanged.
 */
export async function currentSettings(): Promise<TenantSettings> {
  if (!tenantStoreConfigured()) return defaultSettings();
  const { id } = await currentTenant();
  return readSettings(id);
}

/**
 * The same settings for places that must never fail the page, such as the document title: an unknown or retired tenant, a store
 * that is down or a lookup that throws all give the defaults instead of a 404 or a 500.
 */
export async function quietSettings(): Promise<TenantSettings> {
  if (!tenantStoreConfigured()) return defaultSettings();
  try {
    const tenant = await lookupTenant();
    return tenant ? await readSettings(tenant.id) : defaultSettings();
  } catch (e) {
    console.error("tenant settings could not be resolved for the title", e instanceof Error ? e.message : e);
    return defaultSettings();
  }
}

/** For a module's layout: a 404 when the tenant has the module switched off. */
export async function requireModule(id: string): Promise<void> {
  if (!(await currentSettings()).modules.includes(id)) notFound();
}
