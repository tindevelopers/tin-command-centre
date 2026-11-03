import { currentOperator, requireOperator } from "@/src/auth/access";
import { registryWritable } from "@/src/registry/db";
import { tenantStoreConfigured } from "@/src/tenancy/db";
import { currentSettings } from "@/src/tenancy/settings";
import { currentTenant } from "@/src/tenancy/tenant";
import { MODULES } from "@/config/modules";
import { PageHeader, Panel } from "@/components/ControlPlane";
import { ErrorNotice, btnCls, inputCls } from "@/components/RegistryUi";
import { Notice, PageHeading } from "@/components/StatusUi";
import { saveWorkspaceAction } from "./actions";

export const dynamic = "force-dynamic";

const mono = "font-mono text-xs";
const hint = "mt-1 text-xs text-gray-500 dark:text-gray-400";

/**
 * Workspace: this tenant's display name, accent colour, logo and the modules in its menu (db/011_tenant_settings.sql). Everyone
 * signed in sees the current values; admins edit them. It is presentation: hiding a module removes it from the menu and 404s its
 * pages, while roles, BOSS scopes and row-level security still decide what anyone may do.
 */
export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  await requireOperator();
  const { error, saved } = await searchParams;
  if (!tenantStoreConfigured()) return <div><PageHeading title="Workspace" /><Notice>The status store is not connected. Set CONSOLE_DATABASE_URL.</Notice></div>;

  const [tenant, op, settings] = await Promise.all([currentTenant(), currentOperator(), currentSettings()]);
  const canEdit = op?.role === "admin" && registryWritable();
  const optional = MODULES.filter((m) => !m.always);
  const always = MODULES.filter((m) => m.always);

  return (
    <div>
      <PageHeader tenant={tenant.slug} title="Workspace" crumb="Workspace" crumbParent="Settings" subtitle="How this tenant's console looks and which parts of it are in the menu." />
      <ErrorNotice message={error} />
      {saved && <div role="status" className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-200">Saved. The menu and brand below are what this tenant sees now.</div>}

      <Panel title="Brand and menu">
        <form action={saveWorkspaceAction} className="space-y-6">
          <fieldset disabled={!canEdit} className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="text-sm">Display name
                <input name="brandName" defaultValue={settings.brand.name ?? ""} maxLength={40} autoComplete="off" placeholder="TIN Control" className={`${inputCls} mt-1 w-full`} />
                <span className={`${hint} block`}>Shown in the sidebar and header. At most 40 characters; blank uses the default.</span>
              </label>
              <label className="text-sm">Accent colour
                <input name="accent" defaultValue={settings.brand.accent ?? ""} maxLength={7} autoComplete="off" placeholder="#4f46e5" pattern="#[0-9a-fA-F]{6}" className={`${inputCls} mt-1 w-full ${mono}`} />
                <span className={`${hint} block`}>Six hex digits after a #. Blank keeps the standard colour.</span>
              </label>
              <label className="text-sm">Logo path
                <input name="logoPath" defaultValue={settings.brand.logoPath ?? ""} maxLength={200} autoComplete="off" placeholder="/images/logo/acme.svg" className={`${inputCls} mt-1 w-full ${mono}`} />
                <span className={`${hint} block`}>A file already on this site, never a web address. Adding the file is a code change.</span>
              </label>
            </div>

            <div>
              <h3 className="text-sm font-medium text-gray-800 dark:text-white/90">Modules in the menu</h3>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {optional.map((m) => (
                  <li key={m.id}>
                    <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-800">
                      <input type="checkbox" name="module" value={m.id} defaultChecked={settings.modules.includes(m.id)} />
                      <span>{m.label}</span>
                      <span className={`${mono} ml-auto text-gray-500 dark:text-gray-400`}>{m.paths.join(" ")}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <p className={hint}>Always on, so nobody is locked out: {always.map((m) => m.label).join(", ")}. A module switched off disappears from the menu and its pages answer 404. Ticking every module means &ldquo;all&rdquo;, including modules added later. This hides things; it does not change who may do what.</p>
            </div>
          </fieldset>

          {canEdit ? <button className={btnCls}>Save</button> : (
            <p className="text-xs text-gray-500 dark:text-gray-400">{op?.role === "admin" ? "Saving needs CONSOLE_ADMIN_DATABASE_URL." : "Admins of this tenant change these settings."}</p>
          )}
        </form>
      </Panel>
    </div>
  );
}
