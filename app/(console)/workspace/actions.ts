"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/src/auth/access";
import { registryWritable } from "@/src/registry/db";
import { ValidationError } from "@/src/registry/validate";
import { currentTenant } from "@/src/tenancy/tenant";
import { parseSettingsForm, saveSettings } from "@/src/tenancy/settings-write";

const isMissingTable = (e: unknown): boolean => typeof e === "object" && e !== null && (e as { code?: string }).code === "42P01";

/**
 * Save this tenant's look and menu. A server action is a public endpoint, so it checks admin itself. The values are validated
 * to the shapes db/011 allows before anything is sent, and only fixed sentences come back to the page.
 */
export async function saveWorkspaceAction(f: FormData) {
  const admin = await requireAdmin();
  const tenant = await currentTenant();
  let result = "saved=1";
  try {
    if (!registryWritable()) throw new ValidationError("Saving needs CONSOLE_ADMIN_DATABASE_URL.");
    await saveSettings(tenant.id, admin.email, parseSettingsForm(f));
  } catch (e) {
    if (e instanceof ValidationError) result = `error=${encodeURIComponent(e.message)}`;
    else if (isMissingTable(e)) result = `error=${encodeURIComponent("Workspace settings are not switched on yet: db/011_tenant_settings.sql has not been applied. The owner applies it.")}`;
    else {
      console.error("save workspace settings failed", e instanceof Error ? e.message : e);
      result = `error=${encodeURIComponent("Could not save. Check the values and try again.")}`;
    }
  }
  // The sidebar and every page read the settings, so refresh the whole layout.
  revalidatePath("/", "layout");
  redirect(`/workspace?${result}`);
}
