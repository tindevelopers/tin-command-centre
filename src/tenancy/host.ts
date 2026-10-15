/**
 * Which tenant a request is for, from its hostname. Pure, so it is easy to test.
 *   command.tinconnect.com          -> the default tenant ("tin": phase 1 has only this one)
 *   botski.command.tinconnect.com   -> "botski"
 *   anything else (localhost, previews, the old console address) -> the default tenant, or null when other hosts are rejected
 * A name that is not a valid, unreserved tenant slug yields null, which the app turns into a 404.
 */
export type TenantConfig = { baseDomain: string; defaultTenant: string; otherHosts: "default" | "reject" };

/** Must match the slug rules and reserved names in db/006_tenants.sql. */
export const RESERVED_SLUGS = ["admin", "www", "api", "auth", "command", "app", "platform"] as const;
const SLUG = /^[a-z0-9]([a-z0-9-]{0,28}[a-z0-9])?$/;

export const isTenantSlug = (s: string): boolean => SLUG.test(s) && !(RESERVED_SLUGS as readonly string[]).includes(s);

export function tenantConfig(env: Record<string, string | undefined> = process.env): TenantConfig {
  return {
    baseDomain: (env.COMMAND_BASE_DOMAIN || "command.tinconnect.com").toLowerCase(),
    defaultTenant: env.DEFAULT_TENANT || "tin",
    otherHosts: env.TENANT_OTHER_HOSTS === "reject" ? "reject" : "default",
  };
}

export function tenantSlugFromHost(host: string | null | undefined, cfg: TenantConfig): string | null {
  const h = (host ?? "").toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  if (h === cfg.baseDomain) return cfg.defaultTenant;
  if (h.endsWith("." + cfg.baseDomain)) {
    const label = h.slice(0, -(cfg.baseDomain.length + 1));
    return isTenantSlug(label) ? label : null; // a nested name such as a.b.command... has a dot, so it is not a slug
  }
  return cfg.otherHosts === "default" ? cfg.defaultTenant : null;
}
