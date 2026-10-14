import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { resolveTenantId } from "./db";
import { tenantConfig, tenantSlugFromHost } from "./host";

export type Tenant = { id: string; slug: string };

/**
 * The tenant of the current request, from its Host header. An unknown, reserved or retired tenant is a 404.
 * Memoised per request. Only the Host header is trusted (the platform sets it); x-forwarded-host is ignored.
 */
export const currentTenant = cache(async (): Promise<Tenant> => {
  const slug = tenantSlugFromHost((await headers()).get("host"), tenantConfig());
  const id = slug ? await resolveTenantId(slug) : null;
  if (!slug || !id) notFound();
  return { id, slug };
});
