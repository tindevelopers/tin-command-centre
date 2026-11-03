import { MODULES } from "@/config/modules";
import { btnCls, inputCls } from "@/components/RegistryUi";
import type { TenantSettings } from "@/src/tenancy/settings-shared";

const mono = "font-mono text-xs";
const hint = "mt-1 text-xs text-gray-500 dark:text-gray-400";

/**
 * The form for a tenant's brand and menu, shared by the tenant's own Workspace screen and the platform admin's editor for another
 * tenant. A server component: `action` is a server action, `hidden` carries any extra fields (the target slug), and a disabled
 * fieldset shows the same values read-only.
 */
export default function WorkspaceForm({ settings, action, canEdit, hidden = {}, whyReadOnly }: {
  settings: TenantSettings;
  action: (f: FormData) => void | Promise<void>;
  canEdit: boolean;
  hidden?: Record<string, string>;
  whyReadOnly?: string;
}) {
  const optional = MODULES.filter((m) => !m.always);
  const always = MODULES.filter((m) => m.always);
  return (
    <form action={action} className="space-y-6">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
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

      {canEdit ? <button className={btnCls}>Save</button> : whyReadOnly ? <p className="text-xs text-gray-500 dark:text-gray-400">{whyReadOnly}</p> : null}
    </form>
  );
}
