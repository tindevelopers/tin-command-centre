"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/src/auth/access";
import { ValidationError } from "@/src/registry/validate";
import { createTenant, isPlatformTenant, retireTenant } from "@/src/tenancy/admin";
import { currentTenant } from "@/src/tenancy/tenant";
import { parseCreateTenant, parseRetireTenant } from "@/src/tenancy/validate";

/** Both actions re-check admin and the platform tenant themselves: server actions are callable without the page. */
async function run(fn: (tenantId: string, actor: string) => Promise<void>) {
  const admin = await requireAdmin();
  const tenant = await currentTenant();
  let error: string | null = null;
  try {
    if (!(await isPlatformTenant(tenant.id))) throw new ValidationError("Only the platform tenant manages tenants.");
    await fn(tenant.id, admin.email);
  } catch (e) {
    if (e instanceof ValidationError) error = e.message;
    else {
      const msg = e instanceof Error ? e.message : "";
      // The database's own refusals are safe, fixed sentences (db/008); anything else stays in the log.
      error = /tenant write refused|duplicate key|violates check/i.test(msg) ? friendly(msg) : "Could not save. Check the values and try again.";
      if (!/tenant write refused|duplicate key|violates check/i.test(msg)) console.error("tenant write failed", e);
    }
  }
  revalidatePath("/tenants");
  redirect(error ? `/tenants?error=${encodeURIComponent(error)}` : "/tenants");
}

function friendly(msg: string): string {
  if (/duplicate key/i.test(msg)) return "A tenant with that slug already exists (it may be retired).";
  if (/violates check/i.test(msg)) return "The database refused the values: the slug is reserved or malformed, or a dedicated tenant has no connection secret name.";
  return msg.replace(/^.*tenant write refused: /i, "Refused: ");
}

export async function addTenant(f: FormData) {
  return run((tenantId, actor) => createTenant(tenantId, actor, parseCreateTenant(f)));
}

export async function retireTenantAction(f: FormData) {
  return run((tenantId, actor) => retireTenant(tenantId, actor, parseRetireTenant(f).slug));
}
