"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/src/auth/access";
import { registryWritable } from "@/src/registry/db";
import { ValidationError } from "@/src/registry/validate";
import { isPlatformTenant } from "@/src/tenancy/admin";
import { isMissingFunction, writeTenantSettings } from "@/src/tenancy/settings-admin";
import { isTenantSlug } from "@/src/tenancy/host";
import { parseSettingsForm } from "@/src/tenancy/settings-write";
import { currentTenant } from "@/src/tenancy/tenant";

/**
 * Save ANOTHER tenant's workspace settings. A server action is a public endpoint, so it re-checks that the caller is an admin of
 * the platform tenant; db/012's function checks again and is the authority. The target slug comes from a hidden field and is
 * validated as a slug before it is used, and the values go through the same strict parser as the tenant's own screen.
 */
export async function saveTenantWorkspaceAction(f: FormData) {
  const admin = await requireAdmin();
  const caller = await currentTenant();
  const slug = String(f.get("slug") ?? "");
  let result = "saved=1";
  try {
    if (!isTenantSlug(slug)) throw new ValidationError("That is not a valid tenant. Go back to the tenant list.");
    if (!(await isPlatformTenant(caller.id))) throw new ValidationError("Only the platform tenant manages other tenants.");
    if (!registryWritable()) throw new ValidationError("Saving needs CONSOLE_ADMIN_DATABASE_URL.");
    await writeTenantSettings(caller.id, admin.email, slug, parseSettingsForm(f));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (e instanceof ValidationError) result = `error=${encodeURIComponent(e.message)}`;
    else if (isMissingFunction(e)) result = `error=${encodeURIComponent("Editing other tenants is not switched on yet: db/012_platform_tenant_settings.sql has not been applied. The owner applies it.")}`;
    else if (/tenant settings refused/i.test(msg)) result = `error=${encodeURIComponent(msg.replace(/^.*tenant settings refused: /i, "Refused: "))}`;
    else {
      console.error("save tenant workspace settings failed", msg);
      result = `error=${encodeURIComponent("Could not save. Check the values and try again.")}`;
    }
  }
  revalidatePath(`/tenants/${slug}`);
  redirect(`/tenants/${isTenantSlug(slug) ? slug : ""}?${result}`);
}
