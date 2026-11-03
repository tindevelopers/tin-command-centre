import { currentOperator, requireOperator } from "@/src/auth/access";
import { registryWritable } from "@/src/registry/db";
import { tenantStoreConfigured } from "@/src/tenancy/db";
import { currentSettings } from "@/src/tenancy/settings";
import { currentTenant } from "@/src/tenancy/tenant";
import { PageHeader, Panel } from "@/components/ControlPlane";
import { ErrorNotice } from "@/components/RegistryUi";
import WorkspaceForm from "@/components/WorkspaceForm";
import { Notice, PageHeading } from "@/components/StatusUi";
import { saveWorkspaceAction } from "./actions";

export const dynamic = "force-dynamic";

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

  return (
    <div>
      <PageHeader tenant={tenant.slug} title="Workspace" crumb="Workspace" crumbParent="Settings" subtitle="How this tenant's console looks and which parts of it are in the menu." />
      <ErrorNotice message={error} />
      {saved && <div role="status" className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-200">Saved. The menu and brand below are what this tenant sees now.</div>}

      <Panel title="Brand and menu">
        <WorkspaceForm settings={settings} action={saveWorkspaceAction} canEdit={canEdit} whyReadOnly={op?.role === "admin" ? "Saving needs CONSOLE_ADMIN_DATABASE_URL." : "Admins of this tenant change these settings."} />
      </Panel>
    </div>
  );
}
