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
  const t = await lookupTenant();
  if (!t) notFound();
  return t;
});

/**
 * The same lookup without the 404: null for an unknown, reserved or retired tenant. For callers that must not turn a missing tenant
 * into a failed page, such as the document title. Memoised per request, so asking both ways costs one lookup.
 */
export const lookupTenant = cache(async (): Promise<Tenant | null> => {
  const slug = tenantSlugFromHost((await headers()).get("host"), tenantConfig());
  const id = slug ? await resolveTenantId(slug) : null;
  return slug && id ? { id, slug } : null;
});
