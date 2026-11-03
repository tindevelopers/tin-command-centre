import { MODULES } from "@/config/modules";
import { ValidationError } from "@/src/registry/validate";
import { tenantWrite } from "./db";

/** What an admin submits from the Workspace screen. Null for a field means "not set"; null modules means "every module". */
export type SettingsInput = { brandName: string | null; accent: string | null; logoPath: string | null; modules: string[] | null };

type Form = { get(name: string): unknown; getAll(name: string): unknown[] };

const OPTIONAL = MODULES.filter((m) => !m.always).map((m) => m.id);
const ALWAYS = MODULES.filter((m) => m.always).map((m) => m.id);

/**
 * Strict form parsing: unlike the reader (which quietly drops a bad stored value), a bad submission is refused with a sentence the
 * admin can act on. The same shapes db/011 enforces, so the database check is a second wall and not the first.
 */
export function parseSettingsForm(f: Form): SettingsInput {
  const brandName = String(f.get("brandName") ?? "").trim();
  if (brandName.length > 40) throw new ValidationError("The display name is at most 40 characters.");
  if (/\p{Cc}/u.test(brandName)) throw new ValidationError("The display name cannot contain control characters.");

  const accent = String(f.get("accent") ?? "").trim();
  if (accent && !/^#[0-9a-fA-F]{6}$/.test(accent)) throw new ValidationError("The accent colour is six hex digits after a #, for example #0a84ff.");

  const logoPath = String(f.get("logoPath") ?? "").trim();
  if (logoPath && (!/^\/[A-Za-z0-9._/-]{1,200}$/.test(logoPath) || logoPath.includes("//") || logoPath.includes(".."))) {
    throw new ValidationError("The logo is a path on this site, such as /images/logo/acme.svg, not a web address.");
  }

  const chosen = f.getAll("module").map(String);
  const unknown = chosen.filter((m) => !OPTIONAL.includes(m) && !ALWAYS.includes(m));
  if (unknown.length > 0) throw new ValidationError("That request names a module this console does not have. Reload the page.");
  const picked = OPTIONAL.filter((id) => chosen.includes(id));
  // Every optional module ticked is stored as NULL, so a module added later appears for this tenant without another edit.
  const modules = picked.length === OPTIONAL.length ? null : picked;

  return { brandName: brandName || null, accent: accent ? accent.toLowerCase() : null, logoPath: logoPath || null, modules };
}

/**
 * Save the current tenant's settings in one audited transaction (tenantWrite sets the tenant, then console.actor). One row per
 * tenant; the application never deletes it: reset a field by clearing it, or all modules by ticking them all.
 */
export async function saveSettings(tenantId: string, actor: string, s: SettingsInput): Promise<void> {
  await tenantWrite(tenantId, actor, [
    {
      text: `insert into tenant_settings (brand_name, accent, logo_path, modules, updated_by) values ($1, $2, $3, $4, $5)
             on conflict (tenant_id) do update set brand_name = excluded.brand_name, accent = excluded.accent, logo_path = excluded.logo_path,
               modules = excluded.modules, updated_at = now(), updated_by = excluded.updated_by`,
      params: [s.brandName, s.accent, s.logoPath, s.modules, actor],
    },
  ]);
}
